import path from 'path';
import { fileURLToPath } from 'url';
import { DocsIndex, IndexedChunk, IndexedDocument, docsIndexExists, readDocsIndex } from './docs-index.js';
import { KeywordScorer } from './keyword-scorer.js';
import { MiniLmEmbedder, TextEmbedder } from './text-embedder.js';

/** An excerpt of a matching document, cut verbatim from its text. */
export interface TextSection {
  text: string;
  /** Model tokens in text */
  tokenCount: number;
  /** Similarity of the best-matching chunk the excerpt covers */
  score: number;
}

/**
 * Represents a single search result from the documentation index.
 */
export interface SearchResult {
  /** Relevance score (0.0-1.0), higher is more relevant */
  score: number;
  /** Document URI in format 'doc://path/to/file.mdx', 'api://operation', or 'schema://SchemaName' */
  uri: string;
  /** Excerpts of the document around the matching chunks, most relevant first */
  sections: TextSection[];
}

/**
 * Options for customizing search behavior.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 5) */
  limit?: number;
  /** Minimum relevance score for results (0.0-1.0, default: 0.0) */
  threshold?: number;
  /** Number of best-matching chunks grouped into document results (default: 40) */
  maxChunks?: number;
  /** Filter results by document type (default: all) */
  type?: 'all' | 'doc' | 'api' | 'schema';
  /** Token budget per excerpt; an excerpt is still at least one whole matching chunk (default: 300) */
  contextTokens?: number;
}

/** Excerpts returned per matching document. */
const MAX_SECTIONS = 3;

/**
 * How much keyword (BM25) relevance counts next to embedding similarity in a chunk's score.
 * Swept from 0 to 1 on two labelled query sets (100 queries): both do well between 0.2 and 0.3,
 * and the set whose queries deliberately avoid the docs' own wording falls off above 0.3.
 */
const KEYWORD_WEIGHT = 0.25;

interface ChunkMatch {
  chunk: IndexedChunk;
  score: number;
}

/**
 * Semantic search engine for Grepr documentation.
 *
 * Key architectural decisions:
 *
 * 1. **Build-time indexing**: The documentation index is generated at build time
 *    by scripts/build-docs-index.ts and bundled with the CLI distribution. This
 *    makes the index immutable and version-synchronized with the CLI.
 *
 * 2. **Lazy initialization**: The embedding model and index are loaded only when
 *    first needed, keeping CLI startup fast for non-search commands.
 *
 * 3. **Index location**: The index is resolved relative to this compiled file's
 *    location (build/dist/lib/), pointing to build/dist/docs-index/. This works
 *    both during development and after npm publication.
 *
 * 4. **Exhaustive matching**: The index holds a few thousand chunks, so a query is
 *    compared against every one of them; there is no approximate-nearest-neighbour
 *    structure to build or tune.
 */
export class DocsSearch {
  private index: DocsIndex | null = null;
  private keywordScorer: KeywordScorer | null = null;
  private indexPath: string;
  private embedder: TextEmbedder;

  /**
   * Creates a new DocsSearch instance.
   *
   * The constructor sets up paths and creates the embedder, but does
   * NOT load the model or index yet (lazy initialization).
   *
   * @param indexPath - Optional path to the index directory. If not provided,
   *                    defaults to the bundled docs-index directory relative to
   *                    this file. Used primarily for testing with temporary indices.
   * @param embedder - Optional embedder; must be the one the index was built with.
   */
  constructor(indexPath?: string, embedder?: TextEmbedder) {
    if (indexPath) {
      this.indexPath = indexPath;
    } else {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      this.indexPath = path.resolve(__dirname, '../docs-index');
    }

    this.embedder = embedder ?? new MiniLmEmbedder();
  }

  private async openIndex(): Promise<DocsIndex> {
    if (this.index) {
      return this.index;
    }

    if (!(await docsIndexExists(this.indexPath))) {
      throw new Error(
        'Documentation index not found. The CLI package may be corrupted. ' +
        'Please reinstall the CLI: npm install -g @grepr/cli'
      );
    }

    this.index = await readDocsIndex(this.indexPath);
    return this.index;
  }

  /**
   * Initializes the search engine by loading the embedding model and opening the index.
   *
   * This method is idempotent - multiple calls have no effect after the first successful
   * initialization.
   *
   * @throws Error if the index is not found or corrupted. This typically indicates
   *         a corrupted CLI installation and the user should reinstall.
   */
  async initialize(): Promise<DocsIndex> {
    await this.embedder.initialize();
    return this.openIndex();
  }

  /**
   * Performs semantic search over the documentation.
   *
   * The search process:
   *
   * 1. Scores every chunk of the requested type by cosine similarity to the embedded query,
   *    blended with its keyword (BM25) relevance; see KEYWORD_WEIGHT
   * 2. Keeps the `maxChunks` best chunks and groups them by document
   * 3. Scores each document by its best kept chunk, and returns the top `limit`. Averaging
   *    instead would rank a long page below a short one whenever the long page also had
   *    weaker matching chunks; on a 60-query labelled set it cost 25 points of top-1 accuracy.
   * 4. Drops documents scoring below `threshold`
   * 5. Renders up to three excerpts per document around its matching chunks
   *
   * Note on threshold filtering: We apply threshold AFTER the top-`limit` cut.
   * This means if limit=5 and threshold=0.7, we might return fewer than 5 results
   * if some of the top 5 don't meet the threshold.
   *
   * @param query - Natural language search query
   * @param options - Search customization options
   * @returns Array of search results, sorted by relevance (highest first)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const index = await this.initialize();

    const {
      limit = 5,
      threshold = 0.0,
      maxChunks = 40,
      type = 'all',
      contextTokens = 300
    } = options;

    const queryVector = await this.embedder.embed(query);
    const keywordScores = this.keywordScores(index, query);
    const searched = index.chunks
      .map((chunk, i) => ({ chunk, keywordScore: keywordScores[i] ?? 0 }))
      .filter(({ chunk }) => type === 'all' || chunk.document.docType === type);
    // Scaled so the best searched chunk scores 1, putting keyword relevance on the same footing as
    // cosine similarity whatever the query's length or the --type filter.
    const bestKeywordScore = Math.max(0, ...searched.map(({ keywordScore }) => keywordScore));
    const matches: ChunkMatch[] = searched
      .map(({ chunk, keywordScore }) => {
        const keyword = bestKeywordScore > 0 ? keywordScore / bestKeywordScore : 0;
        const blended = (dotProduct(queryVector, chunk.vector) + KEYWORD_WEIGHT * keyword) / (1 + KEYWORD_WEIGHT);
        // Cosine similarity can be slightly negative; clamping keeps scores in the 0-1 range
        // --threshold is documented with, so the default threshold of 0 never drops every result.
        return { chunk, score: Math.max(0, blended) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks);

    const matchesByDocument = new Map<IndexedDocument, ChunkMatch[]>();
    for (const match of matches) {
      const documentMatches = matchesByDocument.get(match.chunk.document) ?? [];
      documentMatches.push(match);
      matchesByDocument.set(match.chunk.document, documentMatches);
    }

    return [...matchesByDocument]
      .map(([document, documentMatches]) => ({ document, documentMatches, score: bestScore(documentMatches) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(result => result.score >= threshold)
      .map(({ document, documentMatches, score }) => ({
        score,
        uri: document.uri,
        sections: this.renderSections(document, documentMatches, contextTokens)
      }));
  }

  /**
   * BM25 relevance of every chunk to the query, in index order. The scorer is built on first use;
   * over the bundled docs that takes a few tens of milliseconds.
   */
  private keywordScores(index: DocsIndex, query: string): number[] {
    this.keywordScorer ??= new KeywordScorer(index.chunks.map(chunk => chunk.document.text.slice(chunk.start, chunk.end)));
    return this.keywordScorer.score(query);
  }

  /**
   * Retrieves the full content of a document by its URI.
   *
   * This returns the complete document text exactly as indexed, not just the
   * excerpts a search shows, and does not load the embedding model.
   *
   * @param uri - Document URI in format 'doc://path/to/file.mdx'
   * @returns Complete document content as markdown text
   * @throws Error if document is not found in the index
   */
  async getDocument(uri: string): Promise<string> {
    const index = await this.openIndex();

    const doc = index.documents.find(d => d.uri === uri);
    if (!doc) {
      throw new Error(`Document not found: ${uri}`);
    }

    return doc.text;
  }

  /**
   * Retrieves statistics about the documentation index.
   *
   * Useful for debugging and verifying the index was built correctly.
   *
   * @returns Index metadata including document count and file path
   */
  async getIndexStats(): Promise<{ documentCount: number; indexPath: string }> {
    const index = await this.openIndex();

    return {
      documentCount: index.documents.length,
      indexPath: this.indexPath
    };
  }

  /**
   * Cuts up to MAX_SECTIONS excerpts from a document.
   *
   * A document that fits in maxTokens is returned whole. Otherwise matching chunks that
   * overlap or touch are merged into one excerpt while the result fits in maxTokens, each excerpt
   * is scored by the best chunk it covers, and the best excerpts are returned.
   *
   * The best excerpt is never cut inside a chunk: a chunk's score does not say where in it the
   * match is, so trimming it could drop exactly the passage that matched. Lower-ranked excerpts
   * only lose lines already shown above them. Excerpts are slices of the original text, so code,
   * tables and punctuation come back unchanged.
   */
  private renderSections(document: IndexedDocument, matches: ChunkMatch[], maxTokens: number): TextSection[] {
    const textTokens = this.embedder.countTokens(document.text);
    if (textTokens <= maxTokens) {
      return [{ text: document.text, tokenCount: textTokens, score: bestScore(matches) }];
    }

    const spans: { start: number; end: number; matches: ChunkMatch[] }[] = [];
    for (const match of [...matches].sort((a, b) => a.chunk.start - b.chunk.start)) {
      const span = spans[spans.length - 1];
      const mergedEnd = Math.max(span?.end ?? 0, match.chunk.end);
      if (span && match.chunk.start <= span.end &&
          this.embedder.countTokens(document.text.slice(span.start, mergedEnd)) <= maxTokens) {
        span.end = mergedEnd;
        span.matches.push(match);
      } else {
        spans.push({ start: match.chunk.start, end: match.chunk.end, matches: [match] });
      }
    }

    // Neighbouring chunks share a few lines. Keep the best excerpts whole and trim the shared lines
    // from lower-ranked ones, so no text is shown twice and the best match is never cut.
    const excerpts: { start: number; end: number; score: number }[] = [];
    for (const span of spans.map(s => ({ ...s, score: bestScore(s.matches) })).sort((a, b) => b.score - a.score)) {
      for (const shown of excerpts) {
        if (shown.start <= span.start && span.start < shown.end) {
          span.start = shown.end;
        }
        if (shown.start < span.end && span.end <= shown.end) {
          span.end = shown.start;
        }
      }
      if (span.start < span.end) {
        excerpts.push(span);
      }
      if (excerpts.length === MAX_SECTIONS) {
        break;
      }
    }

    return excerpts.map(({ start, end, score }) => {
      const text = document.text.slice(start, end);
      return { text, tokenCount: this.embedder.countTokens(text), score };
    });
  }
}

/** Cosine similarity, given unit-length vectors. */
function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return sum;
}

function bestScore(matches: ChunkMatch[]): number {
  return Math.max(...matches.map(match => match.score));
}
