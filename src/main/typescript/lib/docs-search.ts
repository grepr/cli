import { LocalDocumentIndex, DocumentTextSection, MetadataFilter } from 'vectra';
import path from 'path';
import { fileURLToPath } from 'url';
import { TransformersEmbeddings } from './transformers-embeddings.js';

/**
 * Represents a single search result from the documentation index.
 */
export interface SearchResult {
  /** Relevance score (0.0-1.0), higher is more relevant */
  score: number;
  /** Document URI in format 'doc://path/to/file.mdx', 'api://operation', or 'schema://SchemaName' */
  uri: string;
  /** Rendered text sections from the document */
  sections: DocumentTextSection[];
}

/**
 * Options for customizing search behavior.
 */
export interface SearchOptions {
  /** Maximum number of results to return (default: 5) */
  limit?: number;
  /** Minimum relevance score for results (0.0-1.0, default: 0.0) */
  threshold?: number;
  /** Maximum number of document chunks to search (default: 20) */
  maxChunks?: number;
  /** Filter results by document type (default: all) */
  type?: 'all' | 'doc' | 'api' | 'schema';
  /** Number of tokens of context to show per section (default: 300) */
  contextTokens?: number;
}

/**
 * Semantic search engine for Grepr documentation.
 *
 * This class provides high-level search functionality over a pre-built Vectra index
 * of documentation files. Key architectural decisions:
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
 * 4. **Two-stage filtering**: Vectra returns top-K results by similarity, then we
 *    apply threshold filtering. This ensures we always consider the most relevant
 *    documents even if they're below threshold.
 */
export class DocsSearch {
  private index: LocalDocumentIndex | null = null;
  private indexPath: string;
  private embeddings: TransformersEmbeddings;

  /**
   * Creates a new DocsSearch instance.
   *
   * The constructor sets up paths and creates the embeddings provider, but does
   * NOT load the model or index yet (lazy initialization).
   *
   * @param indexPath - Optional path to the index directory. If not provided,
   *                    defaults to the bundled docs-index directory relative to
   *                    this file. Used primarily for testing with temporary indices.
   */
  constructor(indexPath?: string) {
    if (indexPath) {
      this.indexPath = indexPath;
    } else {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      this.indexPath = path.resolve(__dirname, '../docs-index');
    }

    this.embeddings = new TransformersEmbeddings('Xenova/all-MiniLM-L6-v2', 512);
  }

  /**
   * Initializes the search engine by loading the embedding model and opening the index.
   *
   * This method is idempotent - multiple calls have no effect after the first successful
   * initialization. It performs the following steps:
   * 1. Loads the Transformers.js embedding model (downloads on first run)
   * 2. Opens the Vectra index from the bundled docs-index directory
   * 3. Verifies the index exists and is valid
   *
   * @throws Error if the index is not found or corrupted. This typically indicates
   *         a corrupted CLI installation and the user should reinstall.
   */
  async initialize(): Promise<void> {
    if (this.index) {
      return;
    }

    await this.embeddings.initialize();

    this.index = new LocalDocumentIndex({
      folderPath: this.indexPath,
      embeddings: this.embeddings
    });

    if (!(await this.index.isIndexCreated())) {
      throw new Error(
        'Documentation index not found. The CLI package may be corrupted. ' +
        'Please reinstall the CLI: npm install -g @grepr/cli'
      );
    }
  }

  /**
   * Performs semantic search over the documentation.
   *
   * This method converts the query text into an embedding vector and finds the most
   * similar documents in the index using cosine similarity. The search process:
   *
   * 1. Auto-initializes if not already initialized
   * 2. Generates embedding for the query text
   * 3. Performs vector similarity search via Vectra
   * 4. Filters results by threshold (if specified)
   * 5. Renders document sections with minimal context (focused excerpts)
   * 6. Returns formatted results sorted by relevance
   *
   * Note on threshold filtering: We apply threshold AFTER Vectra's top-K search.
   * This means if limit=5 and threshold=0.7, we might return fewer than 5 results
   * if some of the top 5 don't meet the threshold.
   *
   * Note on section rendering: We use 300 tokens per section (roughly 1200 characters)
   * to show focused, relevant excerpts rather than large chunks that include
   * irrelevant content from the start of the document. This matches our 512-token
   * chunking strategy during indexing.
   *
   * @param query - Natural language search query
   * @param options - Search customization options
   * @returns Array of search results, sorted by relevance (highest first)
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (!this.index) {
      await this.initialize();
    }

    if (!this.index) {
      throw new Error('Failed to initialize index');
    }

    const {
      limit = 5,
      threshold = 0.0,
      maxChunks = 40,
      type = 'all',
      contextTokens = 300
    } = options;

    const filter = this.buildMetadataFilter(type);

    const results = await this.index.queryDocuments(query, {
      maxDocuments: limit,
      maxChunks,
      filter
    });

    const formatted: SearchResult[] = [];
    for (const result of results) {
      if (result.score < threshold) {
        continue;
      }

      const sections = await result.renderSections(contextTokens, 3, true);

      formatted.push({
        score: result.score,
        uri: result.uri,
        sections
      });
    }

    return formatted;
  }

  /**
   * Retrieves the full content of a document by its URI.
   *
   * This method fetches the complete raw text of a document, not just the top
   * matching sections from a search. It's designed for retrieving complete
   * documentation after finding it via search.
   *
   * Implementation details:
   *
   * 1. **Direct lookup**: Calls `listDocuments()` to get all indexed documents,
   *    then finds the matching URI. This is more efficient than query-based
   *    retrieval because it avoids unnecessary similarity calculations.
   *
   * 2. **Raw text loading**: Uses `loadText()` to read the original document text
   *    directly from disk, bypassing Vectra's `renderAllSections()` which runs text
   *    through a GPT-3 tokenizer encode/decode round-trip that corrupts special
   *    characters (e.g., pipe characters in GFM tables become `\|`).
   *
   * Performance: This method loads the entire document list into memory once,
   * which is acceptable since the index is immutable and relatively small (tens
   * to hundreds of documents). For larger indices, consider adding a caching layer.
   *
   * Alternative considered (Option B): Query-based retrieval using `queryDocuments()`
   * was rejected because it returns sections in relevance order rather than document
   * order, which would break the natural flow of documentation.
   *
   * @param uri - Document URI in format 'doc://path/to/file.mdx'
   * @returns Complete document content as markdown text
   * @throws Error if document is not found in the index
   */
  async getDocument(uri: string): Promise<string> {
    if (!this.index) {
      await this.initialize();
    }

    if (!this.index) {
      throw new Error('Failed to initialize index');
    }

    const docs = await this.index.listDocuments();
    const doc = docs.find(d => d.uri === uri);

    if (!doc) {
      throw new Error(`Document not found: ${uri}`);
    }

    return doc.loadText();
  }

  /**
   * Builds a metadata filter for the specified document type.
   *
   * @param type - Type filter to apply
   * @returns Metadata filter for Vectra query, or undefined for 'all'
   */
  private buildMetadataFilter(type: 'all' | 'doc' | 'api' | 'schema'): MetadataFilter | undefined {
    if (type === 'all') {
      return undefined;
    }

    return { docType: type };
  }

  /**
   * Retrieves statistics about the documentation index.
   *
   * Useful for debugging and verifying the index was built correctly.
   *
   * @returns Index metadata including document count and file path
   */
  async getIndexStats(): Promise<{ documentCount: number; indexPath: string }> {
    if (!this.index) {
      await this.initialize();
    }

    if (!this.index) {
      throw new Error('Failed to initialize index');
    }

    const stats = await this.index.listDocuments();

    return {
      documentCount: stats.length,
      indexPath: this.indexPath
    };
  }
}
