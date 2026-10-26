import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { DocsSearch } from '../../../main/typescript/lib/docs-search.js';
import { DocType, IndexedChunk, IndexedDocument, chunkText, writeDocsIndex } from '../../../main/typescript/lib/docs-index.js';
import { TextEmbedder } from '../../../main/typescript/lib/text-embedder.js';
import { rmSync } from 'fs';
import path from 'path';

/** Embeds text as which of a few keywords it mentions; one token per whitespace-separated word. */
class TestEmbedder implements TextEmbedder {
  public initializeCalls = 0;

  async initialize(): Promise<void> {
    this.initializeCalls++;
  }

  async embed(text: string): Promise<Float32Array> {
    const keywords = ['grok', 'job', 'pipeline', 'datadog', 'integration', 'schema', 'api', 'log'];
    const normalized = text.toLowerCase();
    const vector = Float32Array.from(keywords, keyword => normalized.includes(keyword) ? 1 : 0.01);
    const norm = Math.hypot(...vector);
    return vector.map(value => value / norm);
  }

  countTokens(text: string): number {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }
}

async function writeTestIndex(indexPath: string, embedder: TextEmbedder, entries: [string, string, DocType][]): Promise<void> {
  const documents: IndexedDocument[] = entries.map(([uri, text, docType]) => ({ uri, text, docType }));
  const chunks: IndexedChunk[] = [];
  for (const document of documents) {
    for (const { start, end } of chunkText(document.text, text => embedder.countTokens(text), 254, 32)) {
      chunks.push({ document, start, end, vector: await embedder.embed(document.text.slice(start, end)) });
    }
  }
  await writeDocsIndex(indexPath, { documents, chunks });
}

describe('DocsSearch Type Filtering Integration', () => {
  let docsSearch: DocsSearch;
  let tempIndexPath: string;

  beforeAll(async () => {
    tempIndexPath = path.resolve('build', `docs-search-test-${Date.now()}`);

    const embedder = new TestEmbedder();
    await writeTestIndex(tempIndexPath, embedder, [
      ['doc://getting-started.mdx', 'Getting Started\n\nLearn how to create your first job pipeline in Grepr.', 'doc'],
      ['doc://integrations/datadog.mdx', 'Datadog Integration Guide\n\nConnect Grepr to your Datadog account for seamless log forwarding.', 'doc'],
      ['doc://parsers/grok.mdx', 'Grok Parser Documentation\n\nUse grok patterns to parse unstructured logs into structured data.', 'doc'],
      ['api://Job/createJob', 'Create Job\n\nPOST /api/v1/jobs\n\nCreates a new job pipeline with the specified configuration.', 'api'],
      ['api://Job/updateJob', 'Update Job\n\nPUT /api/v1/jobs/{id}\n\nUpdates an existing job pipeline configuration.', 'api'],
      ['api://Job/listJobs', 'List Jobs\n\nGET /api/v1/jobs\n\nRetrieves a list of all job pipelines.', 'api'],
      ['schema://GrokParser', 'GrokParser Schema\n\nDefines the structure for grok parser configuration including pattern and field mappings.', 'schema'],
      ['schema://JobConfiguration', 'JobConfiguration Schema\n\nDefines the structure for job pipeline configuration.', 'schema'],
      ['schema://DatadogIntegration', 'DatadogIntegration Schema\n\nDefines the configuration structure for Datadog integration setup.', 'schema'],
      [
        'doc://table-test.mdx',
        '# Table Example\n\n' +
          '| Column A | Column B | Column C |\n' +
          '| --- | --- | --- |\n' +
          '| value1 | value2 | value3 |\n' +
          '| foo | bar | baz |',
        'doc'
      ]
    ]);

    docsSearch = new DocsSearch(tempIndexPath, embedder);
    await docsSearch.initialize();
  });

  afterAll(() => {
    if (tempIndexPath) {
      rmSync(tempIndexPath, { recursive: true, force: true });
    }
  });

  const runTypeFilterTest = async (
    type: 'all' | 'doc' | 'api' | 'schema',
    expectedPrefix: string | null
  ) => {
    const results = await docsSearch.search('job pipeline', {
      limit: 10,
      threshold: 0.0,
      type
    });

    expect(results.length, `Expected results for type=${type}`).toBeGreaterThan(0);

    if (expectedPrefix) {
      results.forEach((result, index) => {
        expect(
          result.uri.startsWith(expectedPrefix),
          `Result ${index} with URI ${result.uri} should start with ${expectedPrefix}`
        ).toBe(true);
      });
    }

    return results;
  };

  describe('Type Filter Returns Correct Document Types', () => {
    it('test_search_docType_shouldOnlyReturnDocumentation', async () => {
      await runTypeFilterTest('doc', 'doc://');
    });

    it('test_search_apiType_shouldOnlyReturnApiOperations', async () => {
      await runTypeFilterTest('api', 'api://');
    });

    it('test_search_schemaType_shouldOnlyReturnSchemas', async () => {
      await runTypeFilterTest('schema', 'schema://');
    });

    it('test_search_allType_shouldReturnAllDocumentTypes', async () => {
      const results = await runTypeFilterTest('all', null);

      const uriPrefixes = new Set(results.map(r => r.uri.split('://')[0] + '://'));
      expect(uriPrefixes.size).toBeGreaterThan(0);
    });
  });

  describe('Type Filter Exclusivity', () => {
    const verifyNoMixedTypes = (results: any[], allowedPrefix: string) => {
      const otherPrefixes = ['doc://', 'api://', 'schema://'].filter(p => p !== allowedPrefix);

      results.forEach((result, index) => {
        otherPrefixes.forEach(prefix => {
          expect(
            result.uri.startsWith(prefix),
            `Result ${index} with URI ${result.uri} should not start with ${prefix}`
          ).toBe(false);
        });
      });
    };

    it('test_search_docType_shouldNotIncludeApiOrSchemaResults', async () => {
      const results = await docsSearch.search('create grok parser', {
        limit: 10,
        threshold: 0.0,
        type: 'doc'
      });

      expect(results.length).toBeGreaterThan(0);
      verifyNoMixedTypes(results, 'doc://');
    });

    it('test_search_apiType_shouldNotIncludeDocOrSchemaResults', async () => {
      const results = await docsSearch.search('create job', {
        limit: 10,
        threshold: 0.0,
        type: 'api'
      });

      expect(results.length).toBeGreaterThan(0);
      verifyNoMixedTypes(results, 'api://');
    });

    it('test_search_schemaType_shouldNotIncludeDocOrApiResults', async () => {
      const results = await docsSearch.search('grok parser', {
        limit: 10,
        threshold: 0.0,
        type: 'schema'
      });

      expect(results.length).toBeGreaterThan(0);
      verifyNoMixedTypes(results, 'schema://');
    });
  });

  describe('Type Filter with Query Relevance', () => {
    const testCases: {
      query: string;
      type: 'doc' | 'api' | 'schema';
      expectedUriSubstring: string;
      description: string;
    }[] = [
      {
        query: 'GrokParser schema structure',
        type: 'schema',
        expectedUriSubstring: 'GrokParser',
        description: 'schema query should find GrokParser schema'
      },
      {
        query: 'create job API endpoint',
        type: 'api',
        expectedUriSubstring: 'Job',
        description: 'API query should find job-related API operations'
      },
      {
        query: 'datadog integration guide',
        type: 'doc',
        expectedUriSubstring: 'datadog',
        description: 'doc query should find integration documentation'
      }
    ];

    testCases.forEach(({ query, type, expectedUriSubstring, description }) => {
      it(`test_search_${type}Type_${description.replace(/ /g, '_')}`, async () => {
        const results = await docsSearch.search(query, {
          limit: 10,
          threshold: 0.0,
          type
        });

        expect(results.length).toBeGreaterThan(0);
        expect(
          results.some(r => r.uri.toLowerCase().includes(expectedUriSubstring.toLowerCase())),
          `Expected at least one result to contain "${expectedUriSubstring}"`
        ).toBe(true);

        const expectedPrefix = `${type}://`;
        results.forEach(result => {
          expect(result.uri.startsWith(expectedPrefix)).toBe(true);
        });
      });
    });
  });

  describe('Type Filter with Limit and Threshold', () => {
    it('test_search_withLimit_shouldRespectLimitWithinFilteredType', async () => {
      const limit = 3;
      const results = await docsSearch.search('job', {
        limit,
        threshold: 0.0,
        type: 'schema'
      });

      expect(results.length).toBeLessThanOrEqual(limit);
      results.forEach(result => {
        expect(result.uri.startsWith('schema://')).toBe(true);
      });
    });

    it('test_search_withThreshold_shouldFilterByRelevanceWithinType', async () => {
      const threshold = 0.3;
      const results = await docsSearch.search('grok', {
        limit: 10,
        threshold,
        type: 'schema'
      });

      results.forEach(result => {
        expect(result.score).toBeGreaterThanOrEqual(threshold);
        expect(result.uri.startsWith('schema://')).toBe(true);
      });
    });

    it('test_search_allTypeWithLimit_shouldReturnMixedTypesUpToLimit', async () => {
      const limit = 5;
      const results = await docsSearch.search('job pipeline', {
        limit,
        threshold: 0.0,
        type: 'all'
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('Type Filter Edge Cases', () => {
    it('test_search_specificQueryForWrongType_shouldReturnEmptyOrLowScores', async () => {
      const results = await docsSearch.search('GrokParser', {
        limit: 10,
        threshold: 0.6,
        type: 'api'
      });

      expect(results.length).toBeLessThanOrEqual(10);
      results.forEach(result => {
        expect(result.uri.startsWith('api://')).toBe(true);
      });
    });

    it('test_search_broadQueryWithAllTypes_shouldIncludeVariousTypes', async () => {
      const results = await docsSearch.search('log', {
        limit: 20,
        threshold: 0.0,
        type: 'all'
      });

      expect(results.length).toBeGreaterThan(0);

      const uriPrefixes = results.map(r => r.uri.split('://')[0] + '://');
      const uniquePrefixes = new Set(uriPrefixes);

      expect(
        uniquePrefixes.size,
        'Expected multiple document types in results'
      ).toBeGreaterThan(0);
    });

    it('test_search_undefinedTypeOption_shouldDefaultToAll', async () => {
      const results = await docsSearch.search('job', {
        limit: 10,
        threshold: 0.0
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getDocument', () => {
    it('test_getDocument_shouldNotInitializeEmbeddings', async () => {
      const embedder = new TestEmbedder();
      const retrieval = new DocsSearch(tempIndexPath, embedder);

      await retrieval.getDocument('doc://getting-started.mdx');

      expect(embedder.initializeCalls).toBe(0);
    });

    it('test_getDocument_existingUri_shouldReturnFullDocumentText', async () => {
      const content = await docsSearch.getDocument('doc://getting-started.mdx');

      expect(content).toBe('Getting Started\n\nLearn how to create your first job pipeline in Grepr.');
    });

    it('test_getDocument_nonExistentUri_shouldThrowError', async () => {
      await expect(docsSearch.getDocument('doc://nonexistent.mdx')).rejects.toThrow(
        'Document not found: doc://nonexistent.mdx'
      );
    });

    it('test_getDocument_withSpecialCharacters_shouldPreservePipesAndFormatting', async () => {
      const expectedContent =
        '# Table Example\n\n' +
        '| Column A | Column B | Column C |\n' +
        '| --- | --- | --- |\n' +
        '| value1 | value2 | value3 |\n' +
        '| foo | bar | baz |';

      const result = await docsSearch.getDocument('doc://table-test.mdx');

      expect(
        result,
        'Pipe characters in GFM tables should not be escaped'
      ).toBe(expectedContent);
    });
  });

  describe('Type Filter Consistency Across Queries', () => {
    it('test_search_sameQueryDifferentTypes_shouldReturnDifferentResultSets', async () => {
      const query = 'create job';

      const docResults = await docsSearch.search(query, {
        limit: 10,
        threshold: 0.0,
        type: 'doc'
      });
      const apiResults = await docsSearch.search(query, {
        limit: 10,
        threshold: 0.0,
        type: 'api'
      });
      const schemaResults = await docsSearch.search(query, {
        limit: 10,
        threshold: 0.0,
        type: 'schema'
      });

      const docUris = new Set(docResults.map(r => r.uri));
      const apiUris = new Set(apiResults.map(r => r.uri));
      const schemaUris = new Set(schemaResults.map(r => r.uri));

      expect(
        [...docUris].some(uri => apiUris.has(uri)),
        'Doc and API results should not overlap'
      ).toBe(false);

      expect(
        [...docUris].some(uri => schemaUris.has(uri)),
        'Doc and Schema results should not overlap'
      ).toBe(false);

      expect(
        [...apiUris].some(uri => schemaUris.has(uri)),
        'API and Schema results should not overlap'
      ).toBe(false);
    });

    it('test_search_allTypeResultsAreSuperset_ofFilteredResults', async () => {
      const query = 'pipeline';

      const allResults = await docsSearch.search(query, {
        limit: 50,
        threshold: 0.0,
        type: 'all'
      });
      const schemaResults = await docsSearch.search(query, {
        limit: 50,
        threshold: 0.0,
        type: 'schema'
      });

      const allUris = new Set(allResults.map(r => r.uri));

      schemaResults.forEach(result => {
        expect(
          allUris.has(result.uri),
          `Schema result ${result.uri} should be in 'all' results`
        ).toBe(true);
      });
    });
  });
});

describe('DocsSearch excerpts', () => {
  const indexPath = path.resolve('build', `docs-search-excerpts-test-${Date.now()}`);
  const filler = (count: number): string =>
    Array.from({ length: count }, (_, i) => `Paragraph ${i} talks about \`config\` | tables | and --flags.\n`).join('');
  const longText = filler(200) + 'The datadog integration forwards logs.\n' + filler(200);
  let docsSearch: DocsSearch;

  beforeAll(async () => {
    const embedder = new TestEmbedder();
    await writeTestIndex(indexPath, embedder, [
      ['doc://long.mdx', longText, 'doc'],
      ['doc://short.mdx', 'Datadog setup in one line.', 'doc']
    ]);
    docsSearch = new DocsSearch(indexPath, embedder);
  });

  afterAll(() => {
    rmSync(indexPath, { recursive: true, force: true });
  });

  it('test_search_longDocument_shouldReturnVerbatimExcerptsWithinBudget', async () => {
    const results = await docsSearch.search('datadog integration', { contextTokens: 300, maxChunks: 50 });
    const long = results.find(result => result.uri === 'doc://long.mdx');

    expect(long).toBeDefined();
    expect(long?.sections.length).toBeGreaterThan(0);
    expect(long?.sections.length).toBeLessThanOrEqual(3);
    for (const section of long?.sections ?? []) {
      expect(longText.includes(section.text)).toBe(true);
      expect(section.tokenCount).toBeLessThanOrEqual(300);
    }
    expect(long?.sections[0]?.text).toContain('datadog integration');
  });

  it('test_search_overlappingChunks_shouldNotRepeatTextAcrossExcerpts', async () => {
    const results = await docsSearch.search('datadog integration', { contextTokens: 50, maxChunks: 50 });
    const sections = results.find(result => result.uri === 'doc://long.mdx')?.sections ?? [];
    const spans = sections.map(section => {
      const start = longText.indexOf(section.text);
      return { start, end: start + section.text.length };
    });

    expect(sections.length).toBeGreaterThan(1);
    for (const a of spans) {
      for (const b of spans) {
        expect(a === b || a.end <= b.start || b.end <= a.start).toBe(true);
      }
    }
  });

  it('test_search_budgetSmallerThanChunk_shouldKeepWholeMatchingChunk', async () => {
    const results = await docsSearch.search('datadog integration', { contextTokens: 50, maxChunks: 50 });
    const best = results.find(result => result.uri === 'doc://long.mdx')?.sections[0];

    expect(best?.text).toContain('datadog integration');
    expect(longText.includes(best?.text ?? '-')).toBe(true);
  });

  it('test_search_documentWithinBudget_shouldReturnWholeDocument', async () => {
    const results = await docsSearch.search('datadog', { contextTokens: 100 });

    expect(results.find(result => result.uri === 'doc://short.mdx')?.sections.map(section => section.text))
      .toEqual(['Datadog setup in one line.']);
  });
});

describe('DocsSearch keyword blending', () => {
  const indexPath = path.resolve('build', `docs-search-keyword-test-${Date.now()}`);

  afterAll(() => {
    rmSync(indexPath, { recursive: true, force: true });
  });

  it('test_search_embeddingTie_shouldBeBrokenByExactTerm', async () => {
    // TestEmbedder sees "job" in both, so their embeddings are identical; only "heartbeat" tells them apart.
    const embedder = new TestEmbedder();
    await writeTestIndex(indexPath, embedder, [
      ['api://Jobs/submitSyncJob', 'Submit a synchronous job.', 'api'],
      ['api://Jobs/heartbeatSyncJob', 'Heartbeat a synchronous job so it stays alive.', 'api']
    ]);
    const search = new DocsSearch(indexPath, embedder);

    const results = await search.search('job heartbeat', { type: 'api' });

    expect(results.map(result => result.uri)).toEqual(['api://Jobs/heartbeatSyncJob', 'api://Jobs/submitSyncJob']);
    for (const result of results) {
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });
});
