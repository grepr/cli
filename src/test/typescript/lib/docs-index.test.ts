import { describe, it, expect, afterAll } from 'bun:test';
import { chunkText, headingContext, readDocsIndex, writeDocsIndex, IndexedDocument } from '../../../main/typescript/lib/docs-index.js';
import { rmSync } from 'fs';
import path from 'path';

/** One token per whitespace-separated word, like WordPiece on plain English words. */
const countWords = (text: string): number => text.split(/\s+/).filter(word => word.length > 0).length;

const lines = (count: number, wordsPerLine: number): string =>
  Array.from({ length: count }, (_, line) =>
    Array.from({ length: wordsPerLine }, (_, word) => `l${line}w${word}`).join(' ') + '\n').join('');

describe('chunkText', () => {
  it('test_chunkText_shortText_shouldReturnOneChunkCoveringIt', () => {
    const text = 'Getting Started\n\nCreate your first pipeline.\n';

    expect(chunkText(text, countWords, 254, 32)).toEqual([{ start: 0, end: text.length }]);
  });

  it('test_chunkText_longText_shouldKeepEveryChunkWithinMaxTokens', () => {
    const text = lines(100, 10);

    const chunks = chunkText(text, countWords, 50, 10);

    expect(chunks.length).toBeGreaterThan(1);
    for (const { start, end } of chunks) {
      expect(countWords(text.slice(start, end))).toBeLessThanOrEqual(50);
    }
  });

  it('test_chunkText_longText_shouldBreakAtLineEndsAndCoverAllText', () => {
    const text = lines(100, 10);

    const chunks = chunkText(text, countWords, 50, 10);

    expect(chunks[0]?.start).toBe(0);
    expect(chunks[chunks.length - 1]?.end).toBe(text.length);
    for (const { start, end } of chunks) {
      expect(start === 0 || text[start - 1] === '\n').toBe(true);
      expect(text[end - 1]).toBe('\n');
    }
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.start).toBeLessThanOrEqual(chunks[i - 1]?.end ?? 0);
    }
  });

  it('test_chunkText_overlap_shouldRepeatClosingLinesOfPreviousChunk', () => {
    const text = lines(100, 10);

    const [first, second] = chunkText(text, countWords, 50, 10);

    // 50 tokens = 5 lines of 10; the 10-token overlap repeats the last line.
    expect(first).toEqual({ start: 0, end: text.indexOf('l5w0') });
    expect(second?.start).toBe(text.indexOf('l4w0'));
  });

  it('test_chunkText_lineLongerThanMax_shouldSplitBetweenWords', () => {
    const text = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');

    const chunks = chunkText(text, countWords, 50, 0);

    expect(chunks.map(({ start, end }) => countWords(text.slice(start, end)))).toEqual([50, 50, 20]);
    expect(chunks.map(({ start, end }) => text.slice(start, end)).join('')).toBe(text);
  });

  it('test_chunkText_wordLongerThanMax_shouldCutIntoPiecesWithinMax', () => {
    // A whitespace-free run, like minified JSON; count one token per 4 characters.
    const text = JSON.stringify(Array.from({ length: 150 }, () => ({ key: 'value' })));
    const countChars = (piece: string): number => Math.ceil(piece.length / 4);

    const chunks = chunkText(text, countChars, 50, 10);

    expect(chunks.length).toBeGreaterThan(1);
    for (const { start, end } of chunks) {
      expect(countChars(text.slice(start, end))).toBeLessThanOrEqual(50);
    }
    expect(chunks.map(({ start, end }) => text.slice(start, end)).join('')).toBe(text);
  });

  it('test_chunkText_cutInsideWord_shouldNotSplitSurrogatePairs', () => {
    const text = '🚀'.repeat(100);
    const countCodeUnits = (piece: string): number => piece.length;

    const chunks = chunkText(text, countCodeUnits, 25, 0);

    for (const { start, end } of chunks) {
      expect(text.slice(start, end)).toMatch(/^(🚀)+$/u);
    }
  });

  it('test_chunkText_whitespaceOnly_shouldReturnNoChunks', () => {
    expect(chunkText('\n\n   \n', countWords, 254, 32)).toEqual([]);
  });
});

describe('headingContext', () => {
  const text = [
    'Learn about exceptions.',
    '',
    '# Bypass aggregation with exceptions',
    '',
    '## Exception queries',
    '',
    '### Query syntax',
    '',
    'Write queries like this.',
    '',
    '## Exception limits',
    '',
    'At most ten.'
  ].join('\n');

  it('test_headingContext_insideSubsection_shouldJoinTitleSectionAndSubsection', () => {
    expect(headingContext(text, text.indexOf('Write queries'))).toBe('Bypass aggregation with exceptions > Exception queries > Query syntax');
  });

  it('test_headingContext_afterLaterSection_shouldDropTheEarlierSubsection', () => {
    expect(headingContext(text, text.indexOf('At most'))).toBe('Bypass aggregation with exceptions > Exception limits');
  });

  it('test_headingContext_beforeAnyHeading_shouldBeJustTheTitle', () => {
    expect(headingContext(text, 0)).toBe('Bypass aggregation with exceptions');
  });

  it('test_headingContext_hashLinesInsideCodeFences_shouldBeIgnored', () => {
    const withCode = [
      '```bash',
      '# install the agent',
      '```',
      '# Install Grepr',
      '## Configure',
      '```yaml',
      '## not a section',
      '```',
      'Set the endpoint.'
    ].join('\n');

    expect(headingContext(withCode, withCode.indexOf('Set the endpoint'))).toBe('Install Grepr > Configure');
  });

  it('test_headingContext_fenceInsideFence_shouldNotCloseTheOuterFence', () => {
    for (const inner of ['~~~', '```']) {
      const outer = inner === '```' ? '````' : '```';
      const nested = ['# Page', '## Real', `${outer}text`, inner, '## Fake', outer, 'Body'].join('\n');

      expect(headingContext(nested, nested.indexOf('Body'))).toBe('Page > Real');
    }
  });

  it('test_headingContext_noHeadings_shouldBeEmpty', () => {
    expect(headingContext('Plain text only.', 5)).toBe('');
  });
});

describe('docs index file', () => {
  const indexPath = path.resolve('build', `docs-index-test-${Date.now()}`);

  afterAll(() => {
    rmSync(indexPath, { recursive: true, force: true });
  });

  it('test_writeThenRead_shouldRoundTripDocumentsAndExactVectors', async () => {
    const schema: IndexedDocument = { uri: 'schema://B', docType: 'schema', text: 'B schema' };
    const documents: IndexedDocument[] = [{ uri: 'doc://a.mdx', docType: 'doc', text: '| a | b |\n| --- | --- |' }, schema];
    const vector = Float32Array.from([0.1, -0.25, 1 / 3]);

    await writeDocsIndex(indexPath, { documents, chunks: [{ document: schema, start: 0, end: 8, vector }] });
    const index = await readDocsIndex(indexPath);

    expect(index.documents).toEqual(documents);
    expect(index.chunks).toHaveLength(1);
    expect(index.chunks[0]?.document.uri).toBe('schema://B');
    expect(index.chunks[0]?.vector).toEqual(vector);
  });
});
