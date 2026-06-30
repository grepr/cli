import { describe, it, expect, beforeEach, vi } from 'bun:test';
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

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_networkTimeout_shouldHandleGracefully', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      mockApiClient.listDatasets.mockRejectedValue(timeoutError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'Request timeout after 30000ms'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_unauthorizedAccess_shouldDisplayAppropriateError', async () => {
      const authError = new Error('Unauthorized: Invalid API token');
      mockApiClient.listDatasets.mockRejectedValue(authError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'Unauthorized: Invalid API token'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_serverError_shouldHandleServerErrors', async () => {
      const serverError = new Error('Internal Server Error: Database connection failed');
      mockApiClient.listDatasets.mockRejectedValue(serverError);

      await expect((async () => {
        await command.executeList(mockOptions);
      })()).rejects.toThrow('process.exit called');

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
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' },
        { id: '2', name: 'dataset-2', status: 'inactive' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/datasets-output.json'
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockDatasets,
        optionsWithOutput,
        'datasets'
      );

      // Verify output option is passed through
      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/datasets-output.json');
    });

    it('test_executeList_withOutputOptionAndQuiet_shouldNotShowConsoleMessages', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/datasets-output.csv',
        quiet: true
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        mockDatasets,
        optionsWithOutput,
        'datasets'
      );
      // showQuerySummary is called but internally checks quiet flag
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(optionsWithOutput, 1);
      // Verify the quiet option is set to true
      const [[options]] = vi.mocked((command as any).showQuerySummary).mock.calls;
      expect(options.quiet).toBe(true);
    });

    it('test_executeList_withOutputOptionAndDifferentFormats_shouldPassCorrectFormat', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      const formats = ['csv', 'pretty', 'raw', 'compact'] as const;

      for (const format of formats) {
        vi.clearAllMocks();
        mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

        const optionsWithOutput = {
          ...mockOptions,
          output: `/tmp/datasets-output.${format}`,
          format
        };

        await command.executeList(optionsWithOutput);

        expect((command as any).formatAndOutput).toHaveBeenCalledWith(
          mockDatasets,
          optionsWithOutput,
          'datasets'
        );

        const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
        expect(options.format).toBe(format);
        expect(options.output).toBe(`/tmp/datasets-output.${format}`);
      }
    });

    it('test_executeList_withOutputOptionAndEmptyDatasets_shouldStillPassOutputOption', async () => {
      mockApiClient.listDatasets.mockResolvedValue([]);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/empty-datasets.json'
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        optionsWithOutput,
        'datasets'
      );

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/empty-datasets.json');
    });

    it('test_executeList_withOutputOptionAndRelativePath_shouldPassRelativePathUnmodified', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: './output/datasets.json'
      };

      await command.executeList(optionsWithOutput);

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('./output/datasets.json');
    });

    it('test_executeList_withOutputOptionAndComplexDatasets_shouldPassAllDataToFormatAndOutput', async () => {
      const complexDatasets = [
        {
          id: 'complex-1',
          name: 'Complex Dataset 1',
          metadata: {
            source: 'logs',
            format: 'iceberg',
            compression: 'snappy'
          },
          tags: ['production', 'analytics'],
          config: {
            retention: 30,
            partitionBy: 'timestamp'
          }
        },
        {
          id: 'complex-2',
          name: 'Complex Dataset 2',
          metadata: {
            source: 'metrics',
            format: 'parquet',
            compression: 'gzip'
          },
          tags: ['development', 'testing'],
          config: {
            retention: 7,
            partitionBy: 'date'
          }
        }
      ];

      mockApiClient.listDatasets.mockResolvedValue(complexDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/complex-datasets.json'
      };

      await command.executeList(optionsWithOutput);

      const [[datasets]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(datasets).toEqual(complexDatasets);
      expect(datasets).toHaveLength(2);
      expect(datasets[0].metadata).toBeDefined();
      expect(datasets[0].tags).toBeDefined();
      expect(datasets[0].config).toBeDefined();
    });
  });

  describe('formatAndOutput Implementation Tests', () => {
    let commandWithRealFormatAndOutput: DatasetListCommand;
    let mockFs: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      commandWithRealFormatAndOutput = new DatasetListCommand();

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
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' },
        { id: '2', name: 'dataset-2', status: 'inactive' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-datasets.json',
        format: 'pretty' as const
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/tmp/test-datasets.json',
        expect.any(String)
      );

      // Verify success message was logged
      expect(consoleSpy.log).toHaveBeenCalledWith('✓ Output written to /tmp/test-datasets.json');
    });

    it('test_formatAndOutput_withFileOutputAndQuietMode_shouldNotLogSuccessMessage', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-datasets-quiet.json',
        quiet: true
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

      // Verify success message was NOT logged (quiet mode)
      expect(consoleSpy.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Output written to')
      );
    });

    it('test_formatAndOutput_withFileOutput_shouldWriteFormattedData', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-datasets-formatted.json',
        format: 'raw' as const
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was called with formatted data
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      const [filePath, data] = mockFs.writeFile.mock.calls[0];

      expect(filePath).toBe('/tmp/test-datasets-formatted.json');
      expect(typeof data).toBe('string');
      expect(data.length).toBeGreaterThan(0);
    });

    it('test_formatAndOutput_withDifferentFormats_shouldWriteCorrectFormat', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      const formats = ['csv', 'pretty', 'raw', 'compact'] as const;

      for (const format of formats) {
        vi.clearAllMocks();
        mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

        const optionsWithOutput = {
          ...mockOptions,
          output: `/tmp/test-datasets.${format}`,
          format
        };

        await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

        // Verify fs.default.writeFile was called for each format
        expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
        expect(mockFs.writeFile).toHaveBeenCalledWith(
          `/tmp/test-datasets.${format}`,
          expect.any(String)
        );
      }
    });

    it('test_formatAndOutput_fsWriteFileFails_shouldThrowError', async () => {
      const mockDatasets = [
        { id: '1', name: 'dataset-1', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      // Mock fs.writeFile to fail
      const writeError = new Error('Permission denied: /tmp/test-datasets.json');
      mockFs.writeFile.mockRejectedValue(writeError);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-datasets.json'
      };

      await expect((async () => {
        await commandWithRealFormatAndOutput.executeList(optionsWithOutput);
      })()).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing datasets:',
        'Permission denied: /tmp/test-datasets.json'
      );
    });

    it('test_formatAndOutput_emptyDataWithFileOutput_shouldNotWriteFile', async () => {
      mockApiClient.listDatasets.mockResolvedValue([]);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/empty-datasets.json'
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was NOT called for empty data
      expect(mockFs.writeFile).not.toHaveBeenCalled();

      // Verify "No datasets found" message
      expect(consoleSpy.log).toHaveBeenCalledWith('No datasets found.');
    });

    it('test_formatAndOutput_explicitFsDefaultCheck_shouldUseCorrectImportPattern', async () => {
      // IMPORTANT: This test explicitly checks that the implementation uses
      // fs.default.writeFile (line 161 of list-command.ts)
      //
      // The previous bug was that fs.writeFile() was called directly without
      // accessing the default export, which caused failures in certain environments.
      //
      // This test ensures:
      // 1. The dynamic import returns an object with a 'default' property
      // 2. The 'default' property has a 'writeFile' method
      // 3. That method is actually called when writing files

      const mockDatasets = [
        { id: 'verify-1', name: 'fs-default-verification', status: 'active' }
      ];

      mockApiClient.listDatasets.mockResolvedValue(mockDatasets);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/verify-fs-default-structure.json'
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify that fs.default.writeFile was called (not fs.writeFile)
      // This would fail if the implementation was changed to fs.writeFile()
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);

      // Verify the exact arguments match what we expect
      const [filepath, content] = mockFs.writeFile.mock.calls[0];
      expect(filepath).toBe('/tmp/verify-fs-default-structure.json');
      expect(typeof content).toBe('string');
      expect(content).toContain('verify-1');
      expect(content).toContain('fs-default-verification');
    });
  });
});