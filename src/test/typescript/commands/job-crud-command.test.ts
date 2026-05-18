import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobCrudCommand } from '../../../../src/main/typescript/commands/job-command.js';
import { StreamingJobExecutor } from '../../../../src/main/typescript/lib/streaming-job-executor.js';
import { PathsV1JobsGetParametersQueryExecution } from '../../../../src/main/typescript/openapi/openApiTypes.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    getJob: vi.fn(),
    createAsyncJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    getJob: vi.fn(),
    createAsyncJob: vi.fn(),
    updateJob: vi.fn(),
    deleteJob: vi.fn(),
  }))
}));

// Mock the StreamingJobExecutor
vi.mock('../../../../src/main/typescript/lib/streaming-job-executor.js', () => ({
  StreamingJobExecutor: vi.fn(() => ({
    execute: vi.fn()
  }))
}));

// Mock fs-extra for file operations
vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readJson: vi.fn(),
  },
  pathExists: vi.fn(),
  readJson: vi.fn(),
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

describe('JobCrudCommand', () => {
  let command: JobCrudCommand;
  let mockApiClient: any;
  let mockStreamingExecutor: any;
  let mockFs: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockApiClient = {
      getJob: vi.fn(),
      createAsyncJob: vi.fn(),
      updateJob: vi.fn(),
      deleteJob: vi.fn(),
    };

    mockStreamingExecutor = {
      execute: vi.fn()
    };

    // Mock StreamingJobExecutor constructor
    vi.mocked(StreamingJobExecutor).mockImplementation(function(this: any) {
      return mockStreamingExecutor;
    });

    command = new JobCrudCommand();

    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).formatAndOutputSingle = vi.fn();
    (command as any).showCreateSuccess = vi.fn();
    (command as any).showUpdateSuccess = vi.fn();
    (command as any).showDeleteSuccess = vi.fn();

    // Replace the streamingExecutor instance with our mock
    (command as any).streamingExecutor = mockStreamingExecutor;

    // Mock fs-extra
    const fs = await import('fs-extra');
    mockFs = vi.mocked(fs.default || fs);
    mockFs.pathExists.mockResolvedValue(true);
  });

  describe('Basic Properties', () => {
    it('test_getCommandPrefix_shouldReturnJob', () => {
      const result = command.getCommandPrefix();
      expect(result).toBe('job');
    });

    it('test_getResourceName_shouldReturnJob', () => {
      const result = command.getResourceName();
      expect(result).toBe('job');
    });
  });

  describe('Support Methods', () => {
    it('test_supportsGet_shouldReturnTrue', () => {
      const result = (command as any).supportsGet();
      expect(result).toBe(true);
    });

    it('test_supportsCreate_shouldReturnTrue', () => {
      const result = (command as any).supportsCreate();
      expect(result).toBe(true);
    });

    it('test_supportsUpdate_shouldReturnTrue', () => {
      const result = (command as any).supportsUpdate();
      expect(result).toBe(true);
    });

    it('test_supportsDelete_shouldReturnTrue', () => {
      const result = (command as any).supportsDelete();
      expect(result).toBe(true);
    });
  });

  describe('executeGet Method', () => {
    const mockOptions = {
      quiet: false,
      format: 'pretty' as const,
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeGet_jobFound_shouldFormatAndDisplayJob', async () => {
      const mockJob = {
        id: '123',
        name: 'test-job',
        state: 'FINISHED',
        version: 1,
        execution: 'ASYNCHRONOUS'
      };

      mockApiClient.getJob.mockResolvedValue(mockJob);

      await command.executeGet('123', mockOptions);

      expect(mockApiClient.getJob).toHaveBeenCalledWith('123', undefined, undefined);
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockJob,
        mockOptions
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Job Details:')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('ID: 123')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Name: test-job')
      );
    });

    it('test_executeGet_jobNotFound_shouldLogErrorAndExit', async () => {
      mockApiClient.getJob.mockResolvedValue(null);

      await expect(async () => {
        await command.executeGet('non-existent', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(mockApiClient.getJob).toHaveBeenCalledWith('non-existent', undefined, undefined);
      expect(consoleSpy.error).toHaveBeenCalledWith('Job non-existent not found');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeGet_withVersionAndResolved_shouldPassParameters', async () => {
      const optionsWithVersion = { ...mockOptions, version: 2, resolved: true };
      const mockJob = { id: '123', name: 'test-job', version: 2 };

      mockApiClient.getJob.mockResolvedValue(mockJob);

      await command.executeGet('123', optionsWithVersion);

      expect(mockApiClient.getJob).toHaveBeenCalledWith('123', 2, true);
    });
  });

  describe('executeCreate Method - Asynchronous Jobs', () => {
    const mockOptions = {
      resourceFile: '/path/to/job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_asynchronousJobFile_shouldCreateAsyncJob', async () => {
      const mockJobDefinition = {
        name: 'test-async-job',
        execution: PathsV1JobsGetParametersQueryExecution.ASYNCHRONOUS,
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };
      const mockCreatedJob = {
        ...mockJobDefinition,
        id: '123',
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);
      mockApiClient.createAsyncJob.mockResolvedValue(mockCreatedJob);

      await command.executeCreate(mockOptions);

      expect(mockApiClient.createAsyncJob).toHaveBeenCalledWith(mockJobDefinition);
      expect((command as any).showCreateSuccess).toHaveBeenCalledWith(
        mockCreatedJob,
        mockOptions
      );
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockCreatedJob,
        mockOptions
      );
    });
  });

  describe('executeCreate Method - Synchronous Jobs', () => {
    const mockOptions = {
      resourceFile: '/path/to/sync-job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      format: 'table' as const,
      sort: 'eventTimestamp:asc',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_synchronousJobFile_shouldNotCallAsyncJobCreation', async () => {
      const mockJobDefinition = {
        name: 'test-sync-job',
        execution: PathsV1JobsGetParametersQueryExecution.SYNCHRONOUS,
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);

      // Mock the streaming executor to resolve and then exit
      mockStreamingExecutor.execute.mockImplementation(() => {
        // Simulate that the streaming executor finishes and exits
        process.exit(0);
      });

      // Since synchronous jobs exit the process, we expect process.exit to be called
      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      // Should NOT call createAsyncJob for sync jobs
      expect(mockApiClient.createAsyncJob).not.toHaveBeenCalled();
    });
  });

  describe('Job Definition Loading', () => {
    const mockOptions = {
      resourceFile: '/path/to/job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_loadJobDefinition_validFile_shouldLoadAndValidate', async () => {
      const mockJobDefinition = {
        name: 'valid-job',
        execution: 'ASYNCHRONOUS',
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);
      mockApiClient.createAsyncJob.mockResolvedValue({ ...mockJobDefinition, id: '123' });

      await command.executeCreate(mockOptions);

      expect(mockFs.pathExists).toHaveBeenCalledWith('/path/to/job.json');
      expect(mockFs.readJson).toHaveBeenCalledWith('/path/to/job.json');
    });

    it('test_loadJobDefinition_fileNotFound_shouldLogErrorAndExit', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating job:',
        expect.stringContaining('Job definition file not found')
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_loadJobDefinition_invalidJson_shouldLogErrorAndExit', async () => {
      mockFs.readJson.mockRejectedValue(new Error('Invalid JSON'));

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating job:',
        expect.stringContaining('Failed to load job definition')
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_loadJobDefinition_missingRequiredFields_shouldLogErrorAndExit', async () => {
      const invalidJobDefinition = {
        name: 'incomplete-job',
        // Missing execution and processing fields
        jobGraph: {
          vertices: [],
          edges: []
        }
      };
      mockFs.readJson.mockResolvedValue(invalidJobDefinition);

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating job:',
        expect.stringContaining('Invalid job definition: missing required fields')
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('executeUpdate Method', () => {
    const mockOptions = {
      resourceFile: '/path/to/job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      rollbackEnabled: true,
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeUpdate_validJobFile_shouldUpdateJob', async () => {
      const mockJobData = {
        name: 'updated-job',
        execution: 'ASYNCHRONOUS',
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'updated-source', name: 'src' }],
          edges: []
        }
      };
      const mockUpdatedJob = {
        ...mockJobData,
        id: '123',
        updatedAt: '2024-01-02T00:00:00Z'
      };

      mockFs.readJson.mockResolvedValue(mockJobData);
      mockApiClient.updateJob.mockResolvedValue(mockUpdatedJob);

      await command.executeUpdate('123', mockOptions);

      expect(mockApiClient.updateJob).toHaveBeenCalledWith('123', mockJobData, true);
      expect((command as any).showUpdateSuccess).toHaveBeenCalledWith('123', mockOptions);
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockUpdatedJob,
        mockOptions
      );
    });

    it('test_executeUpdate_apiUpdateReturnsNull_shouldLogErrorAndExit', async () => {
      const mockJobData = { name: 'test-job', execution: 'ASYNCHRONOUS', processing: 'BATCH' };
      mockFs.readJson.mockResolvedValue(mockJobData);
      mockApiClient.updateJob.mockResolvedValue(null);

      await expect(async () => {
        await command.executeUpdate('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith('Failed to update job 123');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('executeDelete Method', () => {
    const mockOptions = {
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeDelete_shouldDeleteJob', async () => {
      mockApiClient.deleteJob.mockResolvedValue(undefined);

      await command.executeDelete('123', mockOptions);

      expect(mockApiClient.deleteJob).toHaveBeenCalledWith('123');
      expect((command as any).showDeleteSuccess).toHaveBeenCalledWith('123', mockOptions);
    });

    it('test_executeDelete_apiDeleteFails_shouldLogErrorAndExit', async () => {
      mockApiClient.deleteJob.mockRejectedValue(new Error('Delete failed'));

      await expect(async () => {
        await command.executeDelete('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error deleting job 123:',
        'Delete failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('Execution Type Routing', () => {
    const mockOptions = {
      resourceFile: '/path/to/job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_unknownExecutionType_shouldDefaultToAsync', async () => {
      const mockJobDefinition = {
        name: 'unknown-execution-job',
        execution: 'UNKNOWN_TYPE' as any, // Invalid execution type
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };
      const mockCreatedJob = { ...mockJobDefinition, id: '123' };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);
      mockApiClient.createAsyncJob.mockResolvedValue(mockCreatedJob);

      await command.executeCreate(mockOptions);

      // Should default to async path for unknown execution types
      expect(mockApiClient.createAsyncJob).toHaveBeenCalledWith(mockJobDefinition);
      expect(mockStreamingExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe('Sync Command Options Integration', () => {
    const mockOptions = {
      resourceFile: '/path/to/sync-job.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      format: 'csv' as const,
      sort: 'eventTimestamp:desc',
      color: false,
      timestamps: false,
      jobState: false,
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_withSyncOptionsAndSyncJob_shouldPassOptionsToExecutor', async () => {
      const mockJobDefinition = {
        name: 'test-sync-job-with-options',
        execution: PathsV1JobsGetParametersQueryExecution.SYNCHRONOUS,
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);

      // Mock the streaming executor to resolve and then exit
      mockStreamingExecutor.execute.mockImplementation(() => {
        process.exit(0);
      });

      // Since synchronous jobs exit the process, we expect process.exit to be called
      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      // Verify that the streaming executor was called with the options including sync-specific ones
      expect(mockStreamingExecutor.execute).toHaveBeenCalledWith(
        mockJobDefinition,
        expect.objectContaining({
          format: 'csv',
          sort: 'eventTimestamp:desc',
          color: false,
          timestamps: false,
          jobState: false
        })
      );

      // Should NOT call createAsyncJob for sync jobs
      expect(mockApiClient.createAsyncJob).not.toHaveBeenCalled();
    });

    it('test_executeCreate_withDefaultSyncOptions_shouldUseDefaults', async () => {
      const optionsWithDefaults = {
        resourceFile: '/path/to/sync-job.json',
        apiBaseUrl: 'https://api.test.com',
        authMethod: 'oauth' as const,
        headerName: 'X-Test-Token',
        headerValue: 'test-token',
        orgName: 'test-org',
        authCache: true,
        browser: true
        // No explicit format, sort, etc. - should use defaults
      };

      const mockJobDefinition = {
        name: 'test-sync-job-defaults',
        execution: PathsV1JobsGetParametersQueryExecution.SYNCHRONOUS,
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);

      mockStreamingExecutor.execute.mockImplementation(() => {
        process.exit(0);
      });

      await expect(async () => {
        await command.executeCreate(optionsWithDefaults);
      }).rejects.toThrow('process.exit called');

      // Verify that the streaming executor was called (defaults are applied by Commander.js)
      expect(mockStreamingExecutor.execute).toHaveBeenCalledWith(
        mockJobDefinition,
        expect.objectContaining({
          resourceFile: '/path/to/sync-job.json'
        })
      );
    });

    it('test_executeCreate_withSyncOptionsAndAsyncJob_shouldIgnoreStreamingOptions', async () => {
      const mockJobDefinition = {
        name: 'test-async-job-with-sync-options',
        execution: PathsV1JobsGetParametersQueryExecution.ASYNCHRONOUS,
        processing: 'BATCH',
        jobGraph: {
          vertices: [{ type: 'source', name: 'src' }],
          edges: []
        }
      };
      const mockCreatedJob = { ...mockJobDefinition, id: '123' };

      mockFs.readJson.mockResolvedValue(mockJobDefinition);
      mockApiClient.createAsyncJob.mockResolvedValue(mockCreatedJob);

      await command.executeCreate(mockOptions);

      // Should create async job normally, ignoring streaming-specific options
      expect(mockApiClient.createAsyncJob).toHaveBeenCalledWith(mockJobDefinition);
      expect(mockStreamingExecutor.execute).not.toHaveBeenCalled();

      // Should still show creation success and format output
      expect((command as any).showCreateSuccess).toHaveBeenCalledWith(
        mockCreatedJob,
        mockOptions
      );
    });
  });
});