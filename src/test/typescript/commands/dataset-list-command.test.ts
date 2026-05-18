import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatasetListCommand } from '../../../../src/main/typescript/commands/dataset-command.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    listDatasets: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    listDatasets: vi.fn(),
  }))
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

describe('DatasetListCommand', () => {
  let command: DatasetListCommand;
  let mockApiClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new DatasetListCommand();
    mockApiClient = {
      listDatasets: vi.fn(),
    };
    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).formatAndOutput = vi.fn();
    (command as any).showQuerySummary = vi.fn();
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnDatasetList', () => {
      const result = command.getCommandName();
      expect(result).toBe('dataset:list');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();
      expect(result).toBe('List datasets with optional filtering');
    });

    it('test_getCommandOptions_shouldReturnEmptyArray', () => {
      const result = command.getCommandOptions();
      expect(result).toEqual([]);
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

    it('test_executeList_successfulResponse_shouldFormatAndDisplayDatasets', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', createdAt: '2024-01-01T00:00:00Z', status: 'active' },
        { id: '2', name: 'dataset-2', createdAt: '2024-01-02T00:00:00Z', status: 'active' },
        { id: '3', name: 'dataset-3', createdAt: '2024-01-03T00:00:00Z', status: 'inactive' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      await command.executeList(mockOptions);

      expect(mockApiClient.listDatasets).toHaveBeenCalled();
      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockDatasets,
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 3);
    });

    it('test_executeList_emptyDatasets_shouldHandleEmptyResponse', async () => {
      mockApiClient.listDatasets.mockResolvedValue([]);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_nullResponse_shouldHandleNullResponse', async () => {
      mockApiClient.listDatasets.mockResolvedValue(null);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_undefinedResponse_shouldHandleUndefinedResponse', async () => {
      mockApiClient.listDatasets.mockResolvedValue(undefined);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_datasetWithComplexProperties_shouldPreserveAllFields', async () => {
      const complexDataset = {
        id: 'complex-dataset',
        name: 'Complex Dataset',
        description: 'A dataset with complex properties',
        metadata: {
          source: 'logs',
          format: 'iceberg',
          compression: 'snappy'
        },
        tags: ['production', 'logs', 'analytics'],
        config: {
          retention: 30,
          partitionBy: 'timestamp',
          location: 's3://bucket/path'
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        status: 'active'
      };

      mockApiClient.listDatasets.mockResolvedValue([complexDataset]);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [complexDataset],
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 1);

      // Verify the complex object is passed through unchanged
      const [[passedDatasets]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(passedDatasets[0]).toEqual(complexDataset);
    });

    it('test_executeList_multipleDatasetTypes_shouldHandleAllTypes', async () => {
      const mockDatasets = [
        { id: 'logs-dataset', name: 'Logs Dataset', type: 'logs', format: 'iceberg' },
        { id: 'metrics-dataset', name: 'Metrics Dataset', type: 'metrics', format: 'parquet' },
        { id: 'traces-dataset', name: 'Traces Dataset', type: 'traces', format: 'json' },
        { id: 'events-dataset', name: 'Events Dataset', type: 'events', format: 'avro' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockDatasets,
        mockOptions,
        'datasets'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 4);

      // Verify all dataset types are preserved
      const [[passedDatasets]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const types = passedDatasets.map((d: any) => d.type);
      expect(types).toContain('logs');
      expect(types).toContain('metrics');
      expect(types).toContain('traces');
      expect(types).toContain('events');
    });

    it('test_executeList_apiClientThrowsError_shouldCatchAndLogError', async () => {
      const mockError = new Error('API connection failed');
      mockApiClient.listDatasets.mockRejectedValue(mockError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_networkTimeout_shouldHandleGracefully', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      mockApiClient.listDatasets.mockRejectedValue(timeoutError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'Request timeout after 30000ms'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_unauthorizedAccess_shouldDisplayAppropriateError', async () => {
      const authError = new Error('Unauthorized: Invalid API token');
      mockApiClient.listDatasets.mockRejectedValue(authError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'Unauthorized: Invalid API token'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_serverError_shouldHandleServerErrors', async () => {
      const serverError = new Error('Internal Server Error: Database connection failed');
      mockApiClient.listDatasets.mockRejectedValue(serverError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
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
      const mockDatasets = [
        { id: '1', name: 'test-dataset', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      await command.executeList(mockOptions);

      // Verify base class methods are called with correct parameters
      expect((command as any).formatAndOutput).toHaveBeenCalledTimes(1);
      expect((command as any).showQuerySummary).toHaveBeenCalledTimes(1);

      const [formatArgs] = vi.mocked((command as any).formatAndOutput).mock.calls[0];
      expect(formatArgs).toHaveLength(1);
      expect(formatArgs[0]).toEqual({ id: '1', name: 'test-dataset', status: 'active' });
    });

    it('test_executeList_shouldPassCorrectResourceNameToFormatAndOutput', async () => {
      const mockDatasets: any[] = [];
      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'datasets'
      );
    });

    it('test_executeList_shouldCreateApiClientWithCorrectOptions', async () => {
      mockApiClient.listDatasets.mockResolvedValue([]);

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

    it('test_executeList_shouldPreserveOriginalDatasetProperties', async () => {
      const originalDataset = {
        id: 'preserve-test',
        name: 'preservation-test',
        customField: 'custom-value',
        nestedObject: {
          key: 'value',
          number: 42
        },
        arrayField: ['item1', 'item2'],
        booleanField: true,
        nullField: null
      };

      mockApiClient.listDatasets.mockResolvedValue([originalDataset]);

      await command.executeList(mockOptions);

      const [[passedDatasets]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedDataset = passedDatasets[0];

      // All original properties should be preserved exactly
      expect(transformedDataset).toEqual(originalDataset);
    });

    it('test_executeList_shouldHandleDatasetsWithoutStandardFields', async () => {
      const incompleteDataset = {
        // Missing id and name
        status: 'active',
        location: 's3://bucket/path',
        customIdentifier: 'unique-id-123'
      };

      mockApiClient.listDatasets.mockResolvedValue([incompleteDataset]);

      await command.executeList(mockOptions);

      const [[passedDatasets]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedDataset = passedDatasets[0];

      expect(transformedDataset.status).toBe('active');
      expect(transformedDataset.location).toBe('s3://bucket/path');
      expect(transformedDataset.customIdentifier).toBe('unique-id-123');
    });
  });
});