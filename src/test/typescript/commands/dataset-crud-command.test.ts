import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatasetCrudCommand } from '../../../main/typescript/commands/dataset-command';

// Mock the GreprApiClient
vi.mock('../../../main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    getDataset: vi.fn(),
    createDataset: vi.fn(),
    updateDataset: vi.fn(),
    deleteDataset: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    getDataset: vi.fn(),
    createDataset: vi.fn(),
    updateDataset: vi.fn(),
    deleteDataset: vi.fn(),
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

describe('DatasetCrudCommand', () => {
  let command: DatasetCrudCommand;
  let mockApiClient: any;
  let mockFs: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    command = new DatasetCrudCommand();
    mockApiClient = {
      getDataset: vi.fn(),
      createDataset: vi.fn(),
      updateDataset: vi.fn(),
      deleteDataset: vi.fn(),
    };
    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).formatAndOutputSingle = vi.fn();
    (command as any).showCreateSuccess = vi.fn();
    (command as any).showUpdateSuccess = vi.fn();
    (command as any).showDeleteSuccess = vi.fn();
    // Don't mock loadResourceFromFile - let it use the real implementation

    // Mock fs-extra
    const fs = await import('fs-extra');
    mockFs = vi.mocked(fs.default || fs);
    mockFs.pathExists.mockResolvedValue(true);
    mockFs.readJson.mockResolvedValue({ name: 'test-dataset' });
  });

  describe('Basic Properties', () => {
    it('test_getCommandPrefix_shouldReturnDataset', () => {
      const result = command.getCommandPrefix();
      expect(result).toBe('dataset');
    });

    it('test_getResourceName_shouldReturnDataset', () => {
      const result = command.getResourceName();
      expect(result).toBe('dataset');
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

    it('test_executeGet_datasetFound_shouldFormatAndDisplayDataset', async () => {
      const mockDataset = {
        id: '123',
        name: 'test-dataset',
        type: 'logs',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'active'
      };

      mockApiClient.getDataset.mockResolvedValue(mockDataset);

      await command.executeGet('123', mockOptions);

      expect(mockApiClient.getDataset).toHaveBeenCalledWith('123');
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockDataset,
        mockOptions
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Dataset Details:')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('ID: 123')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Name: test-dataset')
      );
    });

    it('test_executeGet_datasetFoundQuietMode_shouldNotDisplayDetails', async () => {
      const mockDataset = {
        id: '456',
        name: 'quiet-dataset',
        type: 'metrics'
      };

      mockApiClient.getDataset.mockResolvedValue(mockDataset);

      const quietOptions = { ...mockOptions, quiet: true };
      await command.executeGet('456', quietOptions);

      expect(mockApiClient.getDataset).toHaveBeenCalledWith('456');
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockDataset,
        quietOptions
      );
      // Should not log details in quiet mode
      expect(consoleSpy.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Dataset Details:')
      );
    });

    it('test_executeGet_datasetNotFound_shouldLogErrorAndExit', async () => {
      mockApiClient.getDataset.mockResolvedValue(null);

      await expect(async () => {
        await command.executeGet('non-existent', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(mockApiClient.getDataset).toHaveBeenCalledWith('non-existent');
      expect(consoleSpy.error).toHaveBeenCalledWith('Dataset non-existent not found');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeGet_apiClientThrowsError_shouldCatchAndLogError', async () => {
      const mockError = new Error('API connection failed');
      mockApiClient.getDataset.mockRejectedValue(mockError);

      await expect(async () => {
        await command.executeGet('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error getting dataset 123:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeGet_datasetWithMissingFields_shouldHandleGracefully', async () => {
      const mockDataset = {
        id: '999'
        // Missing name field
      };

      mockApiClient.getDataset.mockResolvedValue(mockDataset);

      await command.executeGet('999', mockOptions);

      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockDataset,
        mockOptions
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('ID: 999')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Name: undefined')
      );
    });
  });

  describe('executeCreate Method', () => {
    const mockOptions = {
      resourceFile: '/path/to/dataset.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_validDatasetFile_shouldCreateDataset', async () => {
      const mockDatasetData = {
        name: 'new-dataset',
        type: 'logs',
        description: 'A new dataset'
      };
      const mockCreatedDataset = {
        ...mockDatasetData,
        id: '123',
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockFs.readJson.mockResolvedValue(mockDatasetData);
      mockApiClient.createDataset.mockResolvedValue(mockCreatedDataset);

      await command.executeCreate(mockOptions);

      expect(mockApiClient.createDataset).toHaveBeenCalledWith(mockDatasetData);
      expect((command as any).showCreateSuccess).toHaveBeenCalledWith(
        mockCreatedDataset,
        mockOptions
      );
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockCreatedDataset,
        mockOptions
      );
    });

    it('test_executeCreate_fileNotFound_shouldLogErrorAndExit', async () => {
      mockFs.pathExists.mockResolvedValue(false);

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating dataset:',
        expect.stringContaining('dataset definition file not found')
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeCreate_invalidJsonFile_shouldLogErrorAndExit', async () => {
      mockFs.readJson.mockRejectedValue(new Error('Invalid JSON'));

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating dataset:',
        expect.stringContaining('Failed to load dataset definition')
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeCreate_missingNameField_shouldDelegateValidationToServer', async () => {
      // Client-side name validation was removed because Job.UpdateApi has no
      // `name` field, and the server already validates names with a clearer
      // error message. The CLI now sends payloads through and surfaces any
      // server error to the user.
      const datasetWithoutName = {
        type: 'logs',
        description: 'Dataset without name'
      };
      mockFs.readJson.mockResolvedValue(datasetWithoutName);
      mockApiClient.createDataset.mockRejectedValue(new Error('name must not be null'));

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(mockApiClient.createDataset).toHaveBeenCalledWith(datasetWithoutName);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating dataset:',
        'name must not be null'
      );
    });

    it('test_executeCreate_apiCreateFails_shouldLogErrorAndExit', async () => {
      const mockDatasetData = { name: 'test-dataset', type: 'logs' };
      mockFs.readJson.mockResolvedValue(mockDatasetData);
      mockApiClient.createDataset.mockRejectedValue(new Error('Create failed'));

      await expect(async () => {
        await command.executeCreate(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error creating dataset:',
        'Create failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('executeUpdate Method', () => {
    const mockOptions = {
      resourceFile: '/path/to/dataset.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeUpdate_validDatasetFile_shouldUpdateDataset', async () => {
      const mockDatasetData = {
        name: 'updated-dataset',
        type: 'logs',
        description: 'Updated dataset'
      };
      const mockUpdatedDataset = {
        ...mockDatasetData,
        id: '123',
        updatedAt: '2024-01-02T00:00:00Z'
      };

      mockFs.readJson.mockResolvedValue(mockDatasetData);
      mockApiClient.updateDataset.mockResolvedValue(mockUpdatedDataset);

      await command.executeUpdate('123', mockOptions);

      expect(mockApiClient.updateDataset).toHaveBeenCalledWith('123', mockDatasetData);
      expect((command as any).showUpdateSuccess).toHaveBeenCalledWith('123', mockOptions);
      expect((command as any).formatAndOutputSingle).toHaveBeenCalledWith(
        mockUpdatedDataset,
        mockOptions
      );
    });

    it('test_executeUpdate_apiUpdateReturnsNull_shouldLogErrorAndExit', async () => {
      const mockDatasetData = { name: 'test-dataset', type: 'logs' };
      mockFs.readJson.mockResolvedValue(mockDatasetData);
      mockApiClient.updateDataset.mockResolvedValue(null);

      await expect(async () => {
        await command.executeUpdate('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith('Failed to update dataset 123');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeUpdate_apiUpdateFails_shouldLogErrorAndExit', async () => {
      const mockDatasetData = { name: 'test-dataset', type: 'logs' };
      mockFs.readJson.mockResolvedValue(mockDatasetData);
      mockApiClient.updateDataset.mockRejectedValue(new Error('Update failed'));

      await expect(async () => {
        await command.executeUpdate('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error updating dataset 123:',
        'Update failed'
      );
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

    it('test_executeDelete_shouldDeleteDataset', async () => {
      mockApiClient.deleteDataset.mockResolvedValue(undefined);

      await command.executeDelete('123', mockOptions);

      expect(mockApiClient.deleteDataset).toHaveBeenCalledWith('123');
      expect((command as any).showDeleteSuccess).toHaveBeenCalledWith('123', mockOptions);
    });

    it('test_executeDelete_apiDeleteFails_shouldLogErrorAndExit', async () => {
      mockApiClient.deleteDataset.mockRejectedValue(new Error('Delete failed'));

      await expect(async () => {
        await command.executeDelete('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error deleting dataset 123:',
        'Delete failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeDelete_datasetNotFound_shouldLogErrorAndExit', async () => {
      mockApiClient.deleteDataset.mockRejectedValue(new Error('Dataset not found'));

      await expect(async () => {
        await command.executeDelete('non-existent', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error deleting dataset non-existent:',
        'Dataset not found'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe('API Client Creation', () => {
    it('test_createApiClient_shouldCreateClientWithCorrectOptions', async () => {
      const mockOptions = {
        apiBaseUrl: 'https://custom-api.test.com',
        authMethod: 'oauth' as const,
        headerName: 'X-Custom-Token',
        headerValue: 'custom-token',
        debug: true,
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      // Reset the mock to use the real implementation
      delete (command as any).createApiClient;

      const mockDataset = { id: '123', name: 'test' };

      // Mock the actual API client creation and methods
      const mockCreatedClient = {
        getDataset: vi.fn().mockResolvedValue(mockDataset)
      };

      const { createApiClient } = await import('../../../../src/main/typescript/lib/api-client-factory.js');
      vi.mocked(createApiClient).mockReturnValue(mockCreatedClient as any);
      (command as any).formatAndOutputSingle = vi.fn();

      await command.executeGet('123', mockOptions);

      expect(createApiClient).toHaveBeenCalledWith(mockOptions);
      expect(mockCreatedClient.getDataset).toHaveBeenCalledWith('123');
    });
  });

  describe('File Loading', () => {
    const mockOptions = {
      resourceFile: '/path/to/dataset.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_loadResourceFromFile_shouldLoadAndValidateDatasetFile', async () => {
      const expectedDataset = {
        name: 'valid-dataset',
        type: 'logs',
        description: 'A valid dataset definition'
      };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readJson.mockResolvedValue(expectedDataset);
      mockApiClient.createDataset.mockResolvedValue({ ...expectedDataset, id: '123' });

      await command.executeCreate(mockOptions);

      expect(mockFs.pathExists).toHaveBeenCalledWith('/path/to/dataset.json');
      expect(mockFs.readJson).toHaveBeenCalledWith('/path/to/dataset.json');
    });

    it('test_loadResourceFromFile_shouldNotEnforceClientSideNameRequirement', async () => {
      // loadResourceFromFile used to enforce a `name` field; that check broke
      // valid Job.UpdateApi payloads which don't include `name`. The file load
      // path now passes the parsed JSON through unchanged.
      const datasetWithoutName = {
        type: 'logs',
        description: 'Dataset without name'
      };

      mockFs.pathExists.mockResolvedValue(true);
      mockFs.readJson.mockResolvedValue(datasetWithoutName);
      mockApiClient.createDataset.mockResolvedValue({
        id: 'some-id',
        name: 'server-assigned'
      });

      await command.executeCreate(mockOptions);

      expect(mockApiClient.createDataset).toHaveBeenCalledWith(datasetWithoutName);
    });
  });
});
