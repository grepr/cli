import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { JobListCommand } from '../../../../src/main/typescript/commands/job-command.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    listJobs: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    listJobs: vi.fn(),
  }))
}));

// Mock fs-extra for file writing tests
vi.mock('fs-extra', () => ({
  default: {
    writeFile: vi.fn(),
  },
}));

// Mock console methods
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

// Mock process.exit
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('JobListCommand', () => {
  let command: JobListCommand;
  let mockApiClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new JobListCommand();
    mockApiClient = {
      listJobs: vi.fn(),
    };
    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).formatAndOutput = vi.fn();
    (command as any).showQuerySummary = vi.fn();
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnJobList', () => {
      const result = command.getCommandName();
      expect(result).toBe('job:list');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();
      expect(result).toBe('List jobs with optional filtering (defaults: active, stopped, and recently finished or failed jobs since 6h ago)');
    });

    it('test_getCommandOptions_shouldReturnJobSpecificOptions', () => {
      const result = command.getCommandOptions();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Verify key options are present
      const optionFlags = result.map(opt => opt.flags);
      expect(optionFlags).toContain('--since <time>');
      expect(optionFlags).toContain('--processing <type>');
      expect(optionFlags).toContain('--state <states...>');
    });
  });

  describe('executeList Method', () => {
    const mockOptions = {
      quiet: false,
      format: 'table' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeList_successfulResponse_shouldFormatAndDisplayJobs', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING', createdAt: '2024-01-01T00:00:00Z' },
          { id: '2', name: 'job-2', state: 'FINISHED', createdAt: '2024-01-02T00:00:00Z' },
          { id: '3', name: 'job-3', state: 'PENDING', createdAt: '2024-01-03T00:00:00Z' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      await command.executeList(mockOptions);

      expect(mockApiClient.listJobs).toHaveBeenCalled();
      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockJobs.items,
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 3);
    });

    it('test_executeList_emptyJobs_shouldHandleEmptyResponse', async () => {
      mockApiClient.listJobs.mockResolvedValue({ items: [] });

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_nullResponse_shouldHandleNullResponse', async () => {
      mockApiClient.listJobs.mockResolvedValue(null);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_undefinedResponse_shouldHandleUndefinedResponse', async () => {
      mockApiClient.listJobs.mockResolvedValue(undefined);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_jobWithComplexProperties_shouldPreserveAllFields', async () => {
      const complexJob = {
        id: 'complex-job',
        name: 'Complex Job',
        description: 'A job with complex properties',
        state: 'RUNNING',
        processing: 'BATCH',
        query: 'SELECT * FROM logs',
        config: {
          timeout: 3600,
          maxRetries: 3,
          priority: 'high'
        },
        metadata: {
          owner: 'admin@example.com',
          team: 'platform'
        },
        tags: ['production', 'critical', 'analytics'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z'
      };

      mockApiClient.listJobs.mockResolvedValue({ items: [complexJob] });

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [complexJob],
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 1);

      // Verify the complex object is passed through unchanged
      const [[passedJobs]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(passedJobs[0]).toEqual(complexJob);
    });

    it('test_executeList_multipleJobStates_shouldHandleAllStates', async () => {
      const mockJobs = {
        items: [
          { id: 'job-1', name: 'Running Job', state: 'RUNNING' },
          { id: 'job-2', name: 'Pending Job', state: 'PENDING' },
          { id: 'job-3', name: 'Finished Job', state: 'FINISHED' },
          { id: 'job-4', name: 'Failed Job', state: 'FAILED' },
          { id: 'job-5', name: 'Cancelled Job', state: 'CANCELLED' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockJobs.items,
        mockOptions,
        'jobs'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 5);

      // Verify all job states are preserved
      const [[passedJobs]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const states = passedJobs.map((j: any) => j.state);
      expect(states).toContain('RUNNING');
      expect(states).toContain('PENDING');
      expect(states).toContain('FINISHED');
      expect(states).toContain('FAILED');
      expect(states).toContain('CANCELLED');
    });

    it('test_executeList_apiClientThrowsError_shouldCatchAndLogError', async () => {
      const mockError = new Error('API connection failed');
      mockApiClient.listJobs.mockRejectedValue(mockError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing jobs:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_networkTimeout_shouldHandleGracefully', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      mockApiClient.listJobs.mockRejectedValue(timeoutError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing jobs:',
        'Request timeout after 30000ms'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_unauthorizedAccess_shouldDisplayAppropriateError', async () => {
      const authError = new Error('Unauthorized: Invalid API token');
      mockApiClient.listJobs.mockRejectedValue(authError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing jobs:',
        'Unauthorized: Invalid API token'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_serverError_shouldHandleServerErrors', async () => {
      const serverError = new Error('Internal Server Error: Database connection failed');
      mockApiClient.listJobs.mockRejectedValue(serverError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing jobs:',
        'Internal Server Error: Database connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('Integration with Base Class', () => {
    const mockOptions = {
      quiet: false,
      format: 'table' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeList_shouldCallCorrectBaseMethods', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'test-job', state: 'RUNNING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      await command.executeList(mockOptions);

      // Verify base class methods are called with correct parameters
      expect((command as any).formatAndOutput).toHaveBeenCalledTimes(1);
      expect((command as any).showQuerySummary).toHaveBeenCalledTimes(1);

      const [formatArgs] = vi.mocked((command as any).formatAndOutput).mock.calls[0];
      expect(formatArgs).toHaveLength(1);
      expect(formatArgs[0]).toEqual({ id: '1', name: 'test-job', state: 'RUNNING' });
    });

    it('test_executeList_shouldPassCorrectResourceNameToFormatAndOutput', async () => {
      mockApiClient.listJobs.mockResolvedValue({ items: [] });

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'jobs'
      );
    });

    it('test_executeList_shouldCreateApiClientWithCorrectOptions', async () => {
      mockApiClient.listJobs.mockResolvedValue({ items: [] });

      await command.executeList(mockOptions);

      expect((command as any).createApiClient).toHaveBeenCalledWith(mockOptions);
    });
  });

  describe('Data Handling', () => {
    const mockOptions = {
      quiet: false,
      format: 'table' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeList_shouldPreserveOriginalJobProperties', async () => {
      const originalJob = {
        id: 'preserve-test',
        name: 'preservation-test',
        state: 'RUNNING',
        processing: 'BATCH',
        customField: 'custom-value',
        nestedObject: {
          key: 'value',
          number: 42
        },
        arrayField: ['item1', 'item2'],
        booleanField: true,
        nullField: null
      };

      mockApiClient.listJobs.mockResolvedValue({ items: [originalJob] });

      await command.executeList(mockOptions);

      const [[passedJobs]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedJob = passedJobs[0];

      // All original properties should be preserved exactly
      expect(transformedJob).toEqual(originalJob);
    });

    it('test_executeList_shouldHandleJobsWithoutStandardFields', async () => {
      const incompleteJob = {
        // Missing standard fields
        customId: 'custom-123',
        status: 'active',
        query: 'SELECT * FROM logs'
      };

      mockApiClient.listJobs.mockResolvedValue({ items: [incompleteJob] });

      await command.executeList(mockOptions);

      const [[passedJobs]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedJob = passedJobs[0];

      expect(transformedJob.customId).toBe('custom-123');
      expect(transformedJob.status).toBe('active');
      expect(transformedJob.query).toBe('SELECT * FROM logs');
    });
  });

      describe('File Output', () => {
    const mockOptions = {
      quiet: false,
      format: 'table' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeList_withOutputOption_shouldPassOutputPathToFormatAndOutput', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING', createdAt: '2024-01-01T00:00:00Z' },
          { id: '2', name: 'job-2', state: 'FINISHED', createdAt: '2024-01-02T00:00:00Z' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/jobs-output.json'
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockJobs.items,
        optionsWithOutput,
        'jobs'
      );

      // Verify output option is passed through
      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/jobs-output.json');
    });

    it('test_executeList_withOutputOptionAndQuiet_shouldNotShowConsoleMessages', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/jobs-output.csv',
        quiet: true
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockJobs.items,
        optionsWithOutput,
        'jobs'
      );
      // showQuerySummary is called but internally checks quiet flag
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(optionsWithOutput, 1);
      // Verify the quiet option is set to true
      const [[options]] = vi.mocked((command as any).showQuerySummary).mock.calls;
      expect(options.quiet).toBe(true);
    });

    it('test_executeList_withOutputOptionAndDifferentFormats_shouldPassCorrectFormat', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING' }
        ]
      };

      const formats = ['csv', 'pretty', 'raw', 'compact'] as const;

      for (const format of formats) {
        vi.clearAllMocks();
        mockApiClient.listJobs.mockResolvedValue(mockJobs);

        const optionsWithOutput = {
          ...mockOptions,
          output: `/tmp/jobs-output.${format}`,
          format
        };

        await command.executeList(optionsWithOutput);

        expect((command as any).formatAndOutput).toHaveBeenCalledWith(
          mockJobs.items,
          optionsWithOutput,
          'jobs'
        );

        const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
        expect(options.format).toBe(format);
        expect(options.output).toBe(`/tmp/jobs-output.${format}`);
      }
    });

    it('test_executeList_withOutputOptionAndEmptyJobs_shouldStillPassOutputOption', async () => {
      mockApiClient.listJobs.mockResolvedValue({ items: [] });

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/empty-jobs.json'
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        optionsWithOutput,
        'jobs'
      );

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/empty-jobs.json');
    });

    it('test_executeList_withOutputOptionAndRelativePath_shouldPassRelativePathUnmodified', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: './output/jobs.json'
      };

      await command.executeList(optionsWithOutput);

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('./output/jobs.json');
    });

    it('test_executeList_withOutputOptionAndComplexJobs_shouldPassAllDataToFormatAndOutput', async () => {
      const complexJobs = [
        {
          id: 'complex-1',
          name: 'Complex Job 1',
          state: 'RUNNING',
          processing: 'BATCH',
          query: 'SELECT * FROM logs WHERE level="ERROR"',
          config: {
            timeout: 3600,
            maxRetries: 3
          },
          tags: ['production', 'analytics'],
          metadata: {
            owner: 'admin@example.com',
            createdBy: 'system'
          }
        },
        {
          id: 'complex-2',
          name: 'Complex Job 2',
          state: 'FINISHED',
          processing: 'STREAMING',
          query: 'SELECT * FROM metrics',
          config: {
            timeout: 7200,
            maxRetries: 5
          },
          tags: ['development', 'testing'],
          metadata: {
            owner: 'dev@example.com',
            createdBy: 'api'
          }
        }
      ];

      mockApiClient.listJobs.mockResolvedValue({ items: complexJobs });

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/complex-jobs.json'
      };

      await command.executeList(optionsWithOutput);

      const [[jobs]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(jobs).toEqual(complexJobs);
      expect(jobs).toHaveLength(2);
      expect(jobs[0].metadata).toBeDefined();
      expect(jobs[0].tags).toBeDefined();
      expect(jobs[0].config).toBeDefined();
    });

    it('test_executeList_withOutputOptionAndFilteredResults_shouldPassFilteredDataCorrectly', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'filtered-job-1', state: 'RUNNING', processing: 'BATCH' },
          { id: '2', name: 'filtered-job-2', state: 'FINISHED', processing: 'BATCH' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/filtered-jobs.json',
        state: ['RUNNING', 'FINISHED'] as any,
        processing: 'BATCH' as any
      };

      await command.executeList(optionsWithOutput);

      const [[jobs, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(jobs).toHaveLength(2);
      expect(options.output).toBe('/tmp/filtered-jobs.json');
      expect(options.state).toEqual(['RUNNING', 'FINISHED']);
      expect(options.processing).toBe('BATCH');
    });

    it('test_executeList_withOutputOptionAndSinceFilter_shouldIncludeSinceInOptions', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'recent-job', state: 'RUNNING', createdAt: '2024-01-03T00:00:00Z' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/recent-jobs.json',
        since: 'PT1H'
      };

      await command.executeList(optionsWithOutput);

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/recent-jobs.json');
      expect(options.since).toBe('PT1H');
    });

    it('test_executeList_withOutputOptionAndMultipleFilters_shouldPassAllFilters', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'prod-job', state: 'RUNNING', processing: 'STREAMING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/prod-jobs.csv',
        format: 'csv' as const,
        state: ['RUNNING'] as any,
        processing: 'STREAMING' as any,
        name: ['prod-job'],
        since: 'PT6H'
      };

      await command.executeList(optionsWithOutput);

      const [[jobs, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(jobs).toHaveLength(1);
      expect(options.output).toBe('/tmp/prod-jobs.csv');
      expect(options.format).toBe('csv');
      expect(options.state).toEqual(['RUNNING']);
      expect(options.processing).toBe('STREAMING');
      expect(options.name).toEqual(['prod-job']);
      expect(options.since).toBe('PT6H');
    });
  });

  describe('formatAndOutput Implementation Tests', () => {
    let commandWithRealFormatAndOutput: JobListCommand;
    let mockFs: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      commandWithRealFormatAndOutput = new JobListCommand();

      // Mock the createApiClient but NOT formatAndOutput
      (commandWithRealFormatAndOutput as any).createApiClient = vi.fn(() => mockApiClient);
      (commandWithRealFormatAndOutput as any).showQuerySummary = vi.fn();

      // Get the mocked fs-extra module
      const fs = await import('fs-extra');
      mockFs = vi.mocked(fs.default);
      mockFs.writeFile.mockResolvedValue(undefined);
    });

    const mockOptions = {
      quiet: false,
      format: 'table' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_formatAndOutput_withFileOutput_shouldCallFsWriteFileCorrectly', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING', createdAt: '2024-01-01T00:00:00Z' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-jobs.json',
        format: 'pretty' as const
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/tmp/test-jobs.json',
        expect.any(String)
      );

      // Verify success message was logged
      expect(consoleSpy.log).toHaveBeenCalledWith('✓ Output written to /tmp/test-jobs.json');
    });

    it('test_formatAndOutput_verifyFsDefaultIsUsed_shouldNotFailOnImport', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-fs-default.json'
      };

      // This should not throw an error about fs.default being undefined
      await expect(
        commandWithRealFormatAndOutput.executeList(optionsWithOutput)
      ).resolves.toBeUndefined();

      // Verify the write was attempted
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it('test_formatAndOutput_fsWriteFileFails_shouldThrowError', async () => {
      const mockJobs = {
        items: [
          { id: '1', name: 'job-1', state: 'RUNNING' }
        ]
      };

      mockApiClient.listJobs.mockResolvedValue(mockJobs);

      // Mock fs.writeFile to fail
      const writeError = new Error('File system error');
      mockFs.writeFile.mockRejectedValue(writeError);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-jobs.json'
      };

      await expect((async () => {
        await commandWithRealFormatAndOutput.executeList(optionsWithOutput);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing jobs:',
        'File system error'
      );
    });
  });
});
