import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrokParseCommand } from '../../../../src/main/typescript/commands/grok-command.js';
import { SchemaGrokParseResponse, SchemaGrokParseBatchRequest, SchemaGrokParseBatchResponse, GrokParserType } from '../../../../src/main/typescript/openapi/openApiTypes.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    getClient: vi.fn(() => ({
      POST: vi.fn()
    }))
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    getClient: vi.fn(() => ({
      POST: vi.fn()
    }))
  }))
}));

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn()
  },
  pathExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn()
}));

// Mock console methods
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {})
};

// Mock process.exit
const _mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('GrokParseCommand', () => {
  let command: GrokParseCommand;
  let mockApiClient: any;
  let mockFs: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mockPOST = vi.fn();
    mockApiClient = {
      getClient: vi.fn(() => ({
        POST: mockPOST
      }))
    };

    command = new GrokParseCommand();

    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).setupFormatter = vi.fn();
    (command as any).formatAndOutput = vi.fn();

    // Mock fs-extra
    const fs = await import('fs-extra');
    mockFs = vi.mocked(fs.default || fs);
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnGrokParse', () => {
      const result = command.getCommandName();
      expect(result).toBe('grok:parse');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();
      expect(result).toBe('Test Grok patterns against log samples');
    });
  });

  describe('buildGrokParseBatchRequest Method', () => {
    it('test_buildGrokParseBatchRequest_withSampleOption_shouldCreateRequestWithSample', async () => {
      const options = {
        pattern: '%{WORD:user} logged in',
        sample: 'alice logged in'
      };

      const result = await (command as any).buildGrokParseBatchRequest(options);

      const expected: SchemaGrokParseBatchRequest = {
        grokParser: {
          name: 'cli_test_parser',
          grokParsingRules: ['%{WORD:user} logged in'],
          type: GrokParserType.grok_parser
        },
        logSamples: ['alice logged in']
      };

      expect(result).toEqual(expected);
    });

    it('test_buildGrokParseBatchRequest_withSamplesFile_shouldCreateRequestWithAllSamples', async () => {
      const options = {
        pattern: '%{WORD:user} logged in',
        samplesFile: '/path/to/samples.txt'
      };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue('alice logged in\nbob logged out\ncharlie failed');

      const result = await (command as any).buildGrokParseBatchRequest(options);

      const expected: SchemaGrokParseBatchRequest = {
        grokParser: {
          name: 'cli_test_parser',
          grokParsingRules: ['%{WORD:user} logged in'],
          type: GrokParserType.grok_parser
        },
        logSamples: ['alice logged in', 'bob logged out', 'charlie failed']
      };

      expect(result).toEqual(expected);
      expect(mockFs.pathExists).toHaveBeenCalledWith('/path/to/samples.txt');
      expect(mockFs.readFile).toHaveBeenCalledWith('/path/to/samples.txt', 'utf-8');
    });

    it('test_buildGrokParseBatchRequest_withOptionalFields_shouldIncludeAllFields', async () => {
      const options = {
        pattern: '%{WORD:user} logged in',
        sample: 'alice logged in',
        extractAttribute: 'user',
        helperRules: ['CUSTOM_PATTERN \\d+']
      };

      const result = await (command as any).buildGrokParseBatchRequest(options);

      const expected: SchemaGrokParseBatchRequest = {
        grokParser: {
          name: 'cli_test_parser',
          grokParsingRules: ['%{WORD:user} logged in'],
          type: GrokParserType.grok_parser,
          extractAttribute: 'user',
          grokHelperRules: ['CUSTOM_PATTERN \\d+']
        },
        logSamples: ['alice logged in']
      };

      expect(result).toEqual(expected);
    });

    it('test_buildGrokParseBatchRequest_withoutPattern_shouldThrowError', async () => {
      const options = {
        sample: 'alice logged in'
      };

      await expect((command as any).buildGrokParseBatchRequest(options))
        .rejects
        .toThrow('--pattern is required');
    });

    it('test_buildGrokParseBatchRequest_withoutSampleOrFile_shouldThrowError', async () => {
      const options = {
        pattern: '%{WORD:user} logged in'
      };

      await expect((command as any).buildGrokParseBatchRequest(options))
        .rejects
        .toThrow('Either --sample or --samples-file must be specified');
    });

    it('test_buildGrokParseBatchRequest_withNonExistentFile_shouldThrowError', async () => {
      const options = {
        pattern: '%{WORD:user} logged in',
        samplesFile: '/path/to/nonexistent.txt'
      };

      mockFs.pathExists.mockResolvedValue(false);

      await expect((command as any).buildGrokParseBatchRequest(options))
        .rejects
        .toThrow('Samples file not found: /path/to/nonexistent.txt');
    });

    it('test_buildGrokParseBatchRequest_withEmptySamplesFile_shouldThrowError', async () => {
      const options = {
        pattern: '%{WORD:user} logged in',
        samplesFile: '/path/to/empty.txt'
      };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue('   \n  \n  '); // Only whitespace

      await expect((command as any).buildGrokParseBatchRequest(options))
        .rejects
        .toThrow('Samples file is empty or contains no valid samples');
    });
  });

  describe('execute Method', () => {
    const mockOptions = {
      pattern: '%{WORD:user} logged in',
      sample: 'alice logged in',
      quiet: false,
      format: 'raw' as const,
      color: true,
      timestamps: true,
      orgName: 'test-org',
      authCache: true,
      browser: false
    };

    it('test_execute_successfulResponse_shouldFormatAndDisplayResults', async () => {
      const mockResponse: SchemaGrokParseBatchResponse = {
        results: [{
          match: true,
          matchingRuleName: 'login_rule',
          attributes: { user: 'alice' },
          tags: {},
          topLevelFields: {}
        }]
      };

      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      await command.execute(mockOptions);

      expect(mockPOST).toHaveBeenCalledWith('/v1/grok/parse/batch', {
        body: {
          grokParser: {
            name: 'cli_test_parser',
            grokParsingRules: ['%{WORD:user} logged in'],
            type: GrokParserType.grok_parser
          },
          logSamples: ['alice logged in']
        }
      });

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(mockResponse.results?.[0], mockOptions);
    });

    it('test_execute_multipleSamples_shouldProcessAll', async () => {
      const mockOptionsWithFile = { ...mockOptions, sample: undefined, samplesFile: '/path/to/samples.txt' };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readFile.mockResolvedValue('alice logged in\nbob logged out');

      const mockResponse: SchemaGrokParseBatchResponse = {
        results: [{
          match: true,
          matchingRuleName: 'login_rule',
          attributes: { user: 'alice' },
          tags: {},
          topLevelFields: {}
        }, {
          match: false,
          attributes: {},
          tags: {},
          topLevelFields: {}
        }]
      };

      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      await command.execute(mockOptionsWithFile);

      expect(mockPOST).toHaveBeenCalledWith('/v1/grok/parse/batch', {
        body: {
          grokParser: {
            name: 'cli_test_parser',
            grokParsingRules: ['%{WORD:user} logged in'],
            type: GrokParserType.grok_parser
          },
          logSamples: ['alice logged in', 'bob logged out']
        }
      });

      expect((command as any).formatAndOutput).toHaveBeenCalledTimes(2);
      expect(consoleSpy.log).toHaveBeenCalledWith('\n=== Sample 1 ===');
      expect(consoleSpy.log).toHaveBeenCalledWith('\n=== Sample 2 ===');
    });

    it('test_execute_apiError_shouldThrowError', async () => {
      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: null,
        error: { message: 'Invalid grok pattern' }
      });

      await expect(command.execute(mockOptions))
        .rejects
        .toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error parsing with Grok:',
        'Grok parse failed: {"message":"Invalid grok pattern"}'
      );
    });

    it('test_execute_noDataReturned_shouldHandleGracefully', async () => {
      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: null,
        error: null
      });

      await command.execute(mockOptions);

      expect(consoleSpy.log).toHaveBeenCalledWith('No data returned from grok parsing API.');
    });

    it('test_execute_emptyResults_shouldHandleGracefully', async () => {
      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: { results: [] },
        error: null
      });

      await command.execute(mockOptions);

      expect(consoleSpy.log).toHaveBeenCalledWith('No data returned from grok parsing API.');
    });

    it('test_execute_quietMode_shouldNotShowSummary', async () => {
      const quietOptions = { ...mockOptions, quiet: true };

      const mockResponse: SchemaGrokParseBatchResponse = {
        results: [{
          match: true,
          matchingRuleName: 'login_rule',
          attributes: { user: 'alice' },
          tags: {},
          topLevelFields: {}
        }]
      };

      const mockPOST = mockApiClient.getClient().POST;
      mockPOST.mockResolvedValue({
        data: mockResponse,
        error: null
      });

      await command.execute(quietOptions);

      expect(consoleSpy.log).toHaveBeenCalledWith(JSON.stringify(mockResponse, null, 2));
      expect(consoleSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('Grok Parse Summary:'));
      expect(consoleSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('=== Sample'));
    });
  });

  describe('formatGrokResults Method', () => {
    it('test_formatGrokResults_completeResponse_shouldFormatAllFields', () => {
      const apiData: SchemaGrokParseResponse = {
        match: true,
        matchingRuleName: 'test_rule',
        attributes: { user: 'alice', action: 'login' },
        tags: { environment: ['prod'], service: ['auth'] },
        topLevelFields: { timestamp: '2024-01-01T00:00:00Z' }
      };

      const result = (command as any).formatGrokResults(apiData);

      expect(result).toEqual({
        match: true,
        matchingRuleName: 'test_rule',
        attributes: { user: 'alice', action: 'login' },
        tags: { environment: ['prod'], service: ['auth'] },
        topLevelFields: { timestamp: '2024-01-01T00:00:00Z' }
      });
    });

    it('test_formatGrokResults_partialResponse_shouldUseDefaults', () => {
      const apiData: SchemaGrokParseResponse = {
        match: false,
        attributes: {},
        tags: {},
        topLevelFields: {}
      };

      const result = (command as any).formatGrokResults(apiData);

      expect(result).toEqual({
        match: false,
        matchingRuleName: null,
        attributes: {},
        tags: {},
        topLevelFields: {}
      });
    });
  });

  describe('showParsingSummary Method', () => {
    it('test_showParsingSummary_successfulMatch_shouldDisplayCorrectSummary', () => {
      const data: SchemaGrokParseResponse = {
        match: true,
        matchingRuleName: 'login_rule',
        attributes: { user: 'alice', action: 'login' },
        tags: { environment: ['prod'] },
        topLevelFields: { timestamp: '2024-01-01' }
      };

      const options = { quiet: false };

      (command as any).showParsingSummary(data, options);

      expect(consoleSpy.log).toHaveBeenCalledWith(`
Grok Parse Summary:
- Match successful: Yes
- Matching rule: login_rule
- Attributes extracted: 2
- Tags extracted: 1
- Top level fields: 1`);
    });

    it('test_showParsingSummary_noMatch_shouldDisplayFailureSummary', () => {
      const data: SchemaGrokParseResponse = {
        match: false,
        attributes: {},
        tags: {},
        topLevelFields: {}
      };

      const options = { quiet: false };

      (command as any).showParsingSummary(data, options);

      expect(consoleSpy.log).toHaveBeenCalledWith(`
Grok Parse Summary:
- Match successful: No
- Matching rule: None
- Attributes extracted: 0
- Tags extracted: 0
- Top level fields: 0`);
    });

    it('test_showParsingSummary_quietMode_shouldNotDisplay', () => {
      const data: SchemaGrokParseResponse = {
        match: true,
        matchingRuleName: 'test_rule',
        attributes: {},
        tags: {},
        topLevelFields: {}
      };

      const options = { quiet: true };

      (command as any).showParsingSummary(data, options);

      expect(consoleSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('Grok Parse Summary:'));
    });
  });

  describe('showBatchSummary Method', () => {
    it('test_showBatchSummary_mixedResults_shouldDisplayCorrectStats', () => {
      const results: SchemaGrokParseResponse[] = [
        { match: true, attributes: {}, tags: {}, topLevelFields: {} },
        { match: false, attributes: {}, tags: {}, topLevelFields: {} },
        { match: true, attributes: {}, tags: {}, topLevelFields: {} }
      ];

      const options = { quiet: false };

      (command as any).showBatchSummary(results, options);

      expect(consoleSpy.log).toHaveBeenCalledWith(`
=== Batch Summary ===
- Total samples processed: 3
- Successful matches: 2
- Failed matches: 1
- Success rate: 67%`);
    });

    it('test_showBatchSummary_quietMode_shouldNotDisplay', () => {
      const results: SchemaGrokParseResponse[] = [
        { match: true, attributes: {}, tags: {}, topLevelFields: {} }
      ];

      const options = { quiet: true };

      (command as any).showBatchSummary(results, options);

      expect(consoleSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('=== Batch Summary ==='));
    });
  });
});