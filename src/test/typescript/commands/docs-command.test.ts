import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DocsSearchCommand } from '../../../../src/main/typescript/commands/docs-command.js';
import { SearchResult } from '../../../../src/main/typescript/lib/docs-search.js';
import { DocumentTextSection } from 'vectra';

const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {})
};

describe('DocsSearchCommand', () => {
  let command: DocsSearchCommand;

  const mockSection: DocumentTextSection = {
    text: '# Getting Started\n\nThis is a tutorial about creating pipelines with detailed instructions.',
    tokenCount: 15,
    score: 0.85
  };

  const mockResults: SearchResult[] = [
    {
      score: 0.85,
      uri: 'doc://tutorials/first-pipeline/page.mdx',
      sections: [mockSection]
    },
    {
      score: 0.72,
      uri: 'doc://integrations/datadog/page.mdx',
      sections: [{ text: 'Datadog integration guide with configuration examples', tokenCount: 8, score: 0.72 }]
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    command = new DocsSearchCommand();
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnDocsSearch', () => {
      const result = command.getCommandName();

      expect(result).toBe('docs:search');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();

      expect(result).toBe('Search Grepr documentation using semantic search');
    });
  });

  describe('JSON Output Format', () => {
    it('test_outputJson_shouldOutputValidJsonWithAllFields', () => {
      (command as any).outputJson(mockResults);

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const output = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(output).toBeDefined();
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toBeDefined();
      expect(parsed[0]).toEqual({
        score: 0.85,
        uri: 'doc://tutorials/first-pipeline/page.mdx',
        sections: mockResults[0]?.sections
      });
      expect(parsed[1]).toBeDefined();
      expect(parsed[1]).toEqual({
        score: 0.72,
        uri: 'doc://integrations/datadog/page.mdx',
        sections: mockResults[1]?.sections
      });
    });

    it('test_outputJson_withEmptyResults_shouldOutputEmptyArray', () => {
      (command as any).outputJson([]);

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const output = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(output).toBeDefined();
      const parsed = JSON.parse(output);

      expect(parsed).toEqual([]);
    });

    it('test_outputJson_shouldFormatWithIndentation', () => {
      (command as any).outputJson(mockResults);

      const output = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(output).toBeDefined();

      expect(output).toContain('  ');
      expect(output).toContain('\n');
    });
  });

  describe('Compact Output Format', () => {
    it('test_outputCompact_withMultipleSections_shouldSeparateWithEllipsis', () => {
      const multiSectionResults: SearchResult[] = [{
        score: 0.9,
        uri: 'doc://test.mdx',
        sections: [
          { text: 'Section 1 content', tokenCount: 5, score: 0.9 },
          { text: 'Section 2 content', tokenCount: 5, score: 0.8 }
        ]
      }];

      (command as any).outputCompact(multiSectionResults);

      const previewLine = consoleSpy.log.mock.calls[1]?.[0] as string;
      expect(previewLine).toBeDefined();

      expect(previewLine).toContain('Section 1 content [...] Section 2 content');
    });

    it('test_outputCompact_withSingleSection_shouldNotShowSeparator', () => {
      (command as any).outputCompact(mockResults);

      const previewLine = consoleSpy.log.mock.calls[1]?.[0] as string;
      expect(previewLine).toBeDefined();

      expect(previewLine).toContain('creating pipelines');
      expect(previewLine).not.toContain('[...]');
    });

    it('test_outputCompact_shouldShowScoreAndUri', () => {
      (command as any).outputCompact(mockResults);

      const firstLine = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(firstLine).toBeDefined();

      expect(firstLine).toContain('1.');
      expect(firstLine).toContain('[0.850]');
      expect(firstLine).toContain('doc://tutorials/first-pipeline/page.mdx');
    });

    it('test_outputCompact_shouldReplaceNewlinesWithSpaces', () => {
      const multilineResults: SearchResult[] = [{
        score: 0.8,
        uri: 'doc://test.mdx',
        sections: [{ text: 'Line 1\nLine 2\nLine 3', tokenCount: 10, score: 0.8 }]
      }];

      (command as any).outputCompact(multilineResults);

      const previewLine = consoleSpy.log.mock.calls[1]?.[0] as string;
      expect(previewLine).toBeDefined();

      expect(previewLine).not.toContain('\n');
      expect(previewLine).toContain('Line 1 Line 2 Line 3');
    });

    it('test_outputCompact_withNoColor_shouldNotUseColorCodes', () => {
      (command as any).outputCompact(mockResults, false);

      const firstLine = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(firstLine).toBeDefined();

      expect(firstLine).toBe('1. [0.850] doc://tutorials/first-pipeline/page.mdx');
    });

    it('test_outputCompact_withColor_shouldCallChalk', () => {
      (command as any).outputCompact(mockResults, true);

      const firstLine = consoleSpy.log.mock.calls[0]?.[0] as string;
      expect(firstLine).toBeDefined();

      expect(firstLine).toContain('1.');
      expect(firstLine).toContain('[0.850]');
    });
  });

  describe('Pretty Output Format', () => {
    it('test_outputPretty_withMultipleSections_shouldShowSeparators', () => {
      const multiSectionResults: SearchResult[] = [{
        score: 0.95,
        uri: 'doc://test.mdx',
        sections: [
          { text: 'First section content', tokenCount: 5, score: 0.95 },
          { text: 'Second section content', tokenCount: 5, score: 0.85 }
        ]
      }];

      (command as any).outputPretty(multiSectionResults);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('\n');

      expect(allOutput).toContain('First section content');
      expect(allOutput).toContain('--- [Section 2] ---');
      expect(allOutput).toContain('Second section content');
    });

    it('test_outputPretty_withSingleSection_shouldNotShowSeparator', () => {
      (command as any).outputPretty(mockResults);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('\n');

      expect(allOutput).toContain('1. doc://tutorials/first-pipeline/page.mdx');
      expect(allOutput).toContain('creating pipelines');
      expect(allOutput).not.toContain('--- [Section');
    });

    it('test_outputPretty_shouldShowTitleAndRelevance', () => {
      (command as any).outputPretty(mockResults);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('\n');

      expect(allOutput).toContain('1. doc://tutorials/first-pipeline/page.mdx');
      expect(allOutput).toContain('Relevance: 0.850');
    });

    it('test_outputPretty_shouldShowResultCount', () => {
      (command as any).outputPretty(mockResults);

      const lastCall = consoleSpy.log.mock.calls[consoleSpy.log.mock.calls.length - 1]?.[0] as string;
      expect(lastCall).toBeDefined();

      expect(lastCall).toContain('Showing 2 results');
    });

    it('test_outputPretty_withSingleResult_shouldUseSingularForm', () => {
      (command as any).outputPretty([mockResults[0]]);

      const lastCall = consoleSpy.log.mock.calls[consoleSpy.log.mock.calls.length - 1]?.[0] as string;
      expect(lastCall).toBeDefined();

      expect(lastCall).toContain('Showing 1 result');
      expect(lastCall).not.toContain('results');
    });

    it('test_outputPretty_withNoColor_shouldNotUseColorCodes', () => {
      (command as any).outputPretty(mockResults, false);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('');

      expect(allOutput).not.toContain('\x1b[');
    });

    it('test_outputPretty_withColor_shouldDisplayOutput', () => {
      (command as any).outputPretty(mockResults, true);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('');

      expect(allOutput).toContain('tutorials/first-pipeline/page.mdx');
      expect(allOutput).toContain('Relevance: 0.850');
    });

    it('test_outputPretty_withNoColor_shouldShowPlainTitle', () => {
      (command as any).outputPretty(mockResults, false);

      const titleLine = consoleSpy.log.mock.calls.find(call =>
        (call[0] as string).includes('1. doc://tutorials/first-pipeline')
      )?.[0] as string;

      expect(titleLine).toBe('\n1. doc://tutorials/first-pipeline/page.mdx');
    });

    it('test_outputPretty_withMarkdownHeadings_andColor_shouldBoldThem', () => {
      (command as any).outputPretty(mockResults, true);

      const allOutput = consoleSpy.log.mock.calls.map(call => call[0]).join('\n');

      expect(allOutput).toContain('# Getting Started');
    });

    it('test_outputPretty_withMarkdownHeadings_andNoColor_shouldNotBoldThem', () => {
      (command as any).outputPretty(mockResults, false);

      const headingLine = consoleSpy.log.mock.calls.find(call =>
        call[0] && (call[0] as string).includes('# Getting Started')
      )?.[0] as string;

      expect(headingLine).toBeDefined();
      expect(headingLine).toBe('   # Getting Started');
      expect(headingLine).not.toContain('\x1b[');
    });
  });

});
