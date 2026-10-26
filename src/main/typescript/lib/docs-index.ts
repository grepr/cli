import { readFile, writeFile, mkdir, access } from 'fs/promises';
import path from 'path';

export type DocType = 'doc' | 'api' | 'schema';

/** A documentation page, kept verbatim so search excerpts and docs:get are exact slices of it. */
export interface IndexedDocument {
  /** 'doc://path/to/file.mdx', 'api://operation', or 'schema://SchemaName' */
  uri: string;
  docType: DocType;
  text: string;
}

/** A searchable span of a document: the characters [start, end) and their embedding. */
export interface IndexedChunk {
  document: IndexedDocument;
  start: number;
  end: number;
  vector: Float32Array;
}

export interface DocsIndex {
  documents: IndexedDocument[];
  chunks: IndexedChunk[];
}

/** On disk, chunks point at documents by position and vectors are base64 float32, about a third the size of JSON numbers. */
interface StoredIndex {
  version: number;
  documents: IndexedDocument[];
  chunks: { document: number; start: number; end: number; vector: string }[];
}

const INDEX_FILE = 'index.json';
const INDEX_VERSION = 2;

export async function docsIndexExists(indexDir: string): Promise<boolean> {
  try {
    await access(path.join(indexDir, INDEX_FILE));
    return true;
  } catch {
    return false;
  }
}

export async function readDocsIndex(indexDir: string): Promise<DocsIndex> {
  const stored: StoredIndex = JSON.parse(await readFile(path.join(indexDir, INDEX_FILE), 'utf-8'));
  if (stored.version !== INDEX_VERSION) {
    throw new Error(`Unsupported documentation index version ${stored.version}; expected ${INDEX_VERSION}`);
  }

  const chunks = stored.chunks.map(({ document, start, end, vector }) => {
    const owner = stored.documents[document];
    if (!owner) {
      throw new Error(`Documentation index chunk points at missing document ${document}`);
    }
    // Copy into a fresh buffer: Float32Array needs 4-byte alignment that a decoded Buffer may not have.
    const bytes = Uint8Array.from(Buffer.from(vector, 'base64'));
    return { document: owner, start, end, vector: new Float32Array(bytes.buffer) };
  });

  return { documents: stored.documents, chunks };
}

export async function writeDocsIndex(indexDir: string, index: DocsIndex): Promise<void> {
  const position = new Map(index.documents.map((document, i) => [document, i]));
  const stored: StoredIndex = {
    version: INDEX_VERSION,
    documents: index.documents,
    chunks: index.chunks.map(({ document, start, end, vector }) => {
      const documentPosition = position.get(document);
      if (documentPosition === undefined) {
        throw new Error(`Chunk of ${document.uri} belongs to no document in the index`);
      }
      return {
        document: documentPosition,
        start,
        end,
        vector: Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64')
      };
    })
  };

  await mkdir(indexDir, { recursive: true });
  await writeFile(path.join(indexDir, INDEX_FILE), JSON.stringify(stored));
}

/**
 * Splits text into spans of at most maxTokens tokens, each a verbatim [start, end) slice.
 *
 * Spans break at line ends, or between words when a single line is too long, and inside a word
 * only when that word alone is too long.
 * Each span after the first repeats up to overlapTokens tokens of the previous one's closing
 * lines, so a passage that straddles a break still appears whole in one span.
 *
 * Token counts are summed per line, which matches counting the whole span because the tokenizer
 * never merges across whitespace.
 */
export function chunkText(
  text: string,
  countTokens: (text: string) => number,
  maxTokens: number,
  overlapTokens: number
): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  const emit = (segments: Segment[]): void => {
    const first = segments[0];
    const last = segments[segments.length - 1];
    if (first && last && totalTokens(segments) > 0) {
      chunks.push({ start: first.start, end: last.end });
    }
  };

  let current: Segment[] = [];
  for (const segment of splitIntoSegments(text, countTokens, maxTokens)) {
    if (current.length > 0 && totalTokens(current) + segment.tokens > maxTokens) {
      emit(current);
      current = closingSegments(current, Math.min(overlapTokens, maxTokens - segment.tokens));
    }
    current.push(segment);
  }
  emit(current);

  return chunks;
}

/**
 * The page title and the section headings enclosing position `start`, such as
 * "Bypass aggregation with exceptions > Exception queries". Embedded in front of a chunk so that
 * a chunk from the middle of a page still says what the page is about; without it, "To write
 * queries for exception configurations..." never mentions the reducer it belongs to.
 */
export function headingContext(text: string, start: number): string {
  let title: string | undefined;
  // sections[0] is the enclosing ## heading, sections[1] the ### heading inside it.
  const sections: string[] = [];
  // Lines inside code fences are code, not headings: a shell or YAML `# comment` is not a title.
  // As in CommonMark, only a fence of the same character, at least as long, closes the block, so
  // a `~~~` or shorter fence shown inside a code sample does not end it.
  let openFence: string | null = null;
  let lineStart = 0;
  for (const line of text.split('\n')) {
    const isBeforeStart = lineStart < start;
    lineStart += line.length + 1;
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const [, marker = '', rest = ''] = fence;
      if (openFence === null) {
        openFence = marker;
        continue;
      }
      if (marker[0] === openFence[0] && marker.length >= openFence.length && rest.trim() === '') {
        openFence = null;
        continue;
      }
    }
    const [, hashes = '', heading = ''] = (openFence === null && line.match(/^(#{1,3}) (.+)$/)) || [];
    if (hashes.length === 1) {
      title ??= heading;
    } else if (hashes.length > 1 && isBeforeStart) {
      const depth = hashes.length - 2;
      sections.length = depth;
      sections[depth] = heading;
    }
  }
  return [title, ...sections].filter(Boolean).join(' > ');
}

interface Segment {
  start: number;
  end: number;
  tokens: number;
}

function totalTokens(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + segment.tokens, 0);
}

/** The longest run of trailing segments within budget, never the whole list, so each chunk adds new text. */
function closingSegments(segments: Segment[], budget: number): Segment[] {
  const kept: Segment[] = [];
  let tokens = 0;
  for (const segment of segments.slice(1).reverse()) {
    if (tokens + segment.tokens > budget) {
      break;
    }
    kept.unshift(segment);
    tokens += segment.tokens;
  }
  return kept;
}

/**
 * Lines, with a line over maxTokens split into words, and a word over maxTokens (minified JSON,
 * a long URL) cut into the longest pieces that fit, so no segment is ever over maxTokens.
 */
function splitIntoSegments(text: string, countTokens: (text: string) => number, maxTokens: number): Segment[] {
  const segments: Segment[] = [];
  for (const line of text.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const lineTokens = countTokens(line[0]);
    if (lineTokens <= maxTokens) {
      segments.push({ start: line.index, end: line.index + line[0].length, tokens: lineTokens });
      continue;
    }
    for (const word of line[0].matchAll(/\S+\s*|\s+/g)) {
      segments.push(...splitToFit(line.index + word.index, word[0], countTokens, maxTokens));
    }
  }
  return segments;
}

/** Cuts text, found at offset, into consecutive pieces of at most maxTokens tokens, each as long as possible. */
function splitToFit(offset: number, text: string, countTokens: (text: string) => number, maxTokens: number): Segment[] {
  const tokens = countTokens(text);
  if (tokens <= maxTokens) {
    return [{ start: offset, end: offset + text.length, tokens }];
  }

  const pieces: Segment[] = [];
  let start = 0;
  while (start < text.length) {
    // Binary search for the longest prefix of the rest that fits, always taking at least one character.
    let fits = start + 1;
    let tooLong = text.length + 1;
    while (tooLong - fits > 1) {
      const middle = Math.floor((fits + tooLong) / 2);
      if (countTokens(text.slice(start, middle)) <= maxTokens) {
        fits = middle;
      } else {
        tooLong = middle;
      }
    }
    // Never separate the two halves of a surrogate pair (an emoji, say).
    if (fits < text.length && fits - 1 > start && isHighSurrogate(text.charCodeAt(fits - 1))) {
      fits--;
    }

    pieces.push({ start: offset + start, end: offset + fits, tokens: countTokens(text.slice(start, fits)) });
    start = fits;
  }
  return pieces;
}

function isHighSurrogate(charCode: number): boolean {
  return charCode >= 0xd800 && charCode <= 0xdbff;
}
