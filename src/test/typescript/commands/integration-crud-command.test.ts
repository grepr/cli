import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationCrudCommand } from '../../../../src/main/typescript/commands/integration-command.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    getIntegrationById: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    getIntegrationById: vi.fn(),
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

describe('IntegrationCrudCommand', () => {
  let command: IntegrationCrudCommand;
  let mockApiClient: { getIntegrationById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    command = new IntegrationCrudCommand();
    mockApiClient = {
      getIntegrationById: vi.fn(),
    };
    // Mock the createApiClient method to return our mock
    (command as unknown as { createApiClient: () => typeof mockApiClient }).createApiClient = vi.fn(() => mockApiClient);
    (command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle = vi.fn();
  });

  describe('Basic Properties', () => {
    it('test_getCommandPrefix_shouldReturnIntegration', () => {
      const result = command.getCommandPrefix();
      expect(result).toBe('integration');
    });

    it('test_getResourceName_shouldReturnIntegration', () => {
      const result = command.getResourceName();
      expect(result).toBe('integration');
    });
  });

  describe('Support Methods', () => {
    it('test_supportsGet_shouldReturnTrue', () => {
      const result = (command as unknown as { supportsGet: () => boolean }).supportsGet();
      expect(result).toBe(true);
    });

    it('test_supportsCreate_shouldReturnFalse', () => {
      const result = (command as unknown as { supportsCreate: () => boolean }).supportsCreate();
      expect(result).toBe(false);
    });

    it('test_supportsUpdate_shouldReturnFalse', () => {
      const result = (command as unknown as { supportsUpdate: () => boolean }).supportsUpdate();
      expect(result).toBe(false);
    });

    it('test_supportsDelete_shouldReturnFalse', () => {
      const result = (command as unknown as { supportsDelete: () => boolean }).supportsDelete();
      expect(result).toBe(false);
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

    it('test_executeGet_integrationFound_shouldFormatAndDisplayIntegration', async () => {
      // The integration is returned directly with type as a field on the object
      const mockIntegration = {
        id: '123',
        name: 'test-integration',
        type: 'datadog',
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockApiClient.getIntegrationById.mockResolvedValue(mockIntegration);

      await command.executeGet('123', mockOptions);

      expect(mockApiClient.getIntegrationById).toHaveBeenCalledWith('123');
      expect((command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle).toHaveBeenCalledWith(
        mockIntegration,
        mockOptions
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Integration Details:')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('ID: 123')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Name: test-integration')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Type: datadog')
      );
    });

    it('test_executeGet_integrationFoundQuietMode_shouldNotDisplayDetails', async () => {
      const mockIntegration = {
        id: '456',
        name: 'quiet-integration',
        type: 'newrelic'
      };

      mockApiClient.getIntegrationById.mockResolvedValue(mockIntegration);

      const quietOptions = { ...mockOptions, quiet: true };
      await command.executeGet('456', quietOptions);

      expect(mockApiClient.getIntegrationById).toHaveBeenCalledWith('456');
      expect((command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle).toHaveBeenCalledWith(
        mockIntegration,
        quietOptions
      );
      // Should not log details in quiet mode
      expect(consoleSpy.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Integration Details:')
      );
    });

    it('test_executeGet_integrationNotFound_shouldLogErrorAndExit', async () => {
      mockApiClient.getIntegrationById.mockResolvedValue(null);

      await expect(async () => {
        await command.executeGet('non-existent', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(mockApiClient.getIntegrationById).toHaveBeenCalledWith('non-existent');
      expect(consoleSpy.error).toHaveBeenCalledWith('Integration non-existent not found');
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeGet_apiClientThrowsError_shouldCatchAndLogError', async () => {
      const mockError = new Error('API connection failed');
      mockApiClient.getIntegrationById.mockRejectedValue(mockError);

      await expect(async () => {
        await command.executeGet('123', mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error getting integration 123:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeGet_differentIntegrationTypes_shouldHandleAllTypes', async () => {
      // Integration objects have the type as a field directly on them
      const integrationTypes = [
        { id: '1', name: 'datadog-int', type: 'datadog' },
        { id: '2', name: 'dw-int', type: 'data_warehouse' },
        { id: '3', name: 's3-dw-int', type: 's3_data_warehouse' },
        { id: '4', name: 'nr-int', type: 'newrelic' },
        { id: '5', name: 'otlp-int', type: 'otlp' },
        { id: '6', name: 'splunk-int', type: 'splunk' },
        { id: '7', name: 'sumo-int', type: 'sumo' },
      ];

      for (const integration of integrationTypes) {
        vi.clearAllMocks();
        mockApiClient.getIntegrationById.mockResolvedValue(integration);

        await command.executeGet(integration.id, mockOptions);

        expect((command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle).toHaveBeenCalledWith(
          integration,
          mockOptions
        );
        expect(consoleSpy.log).toHaveBeenCalledWith(
          expect.stringContaining(`Type: ${integration.type}`)
        );
      }
    });

    it('test_executeGet_integrationWithMissingFields_shouldHandleGracefully', async () => {
      const mockIntegration = {
        id: '999',
        type: 'splunk'
        // Missing name field
      };

      mockApiClient.getIntegrationById.mockResolvedValue(mockIntegration);

      await command.executeGet('999', mockOptions);

      expect((command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle).toHaveBeenCalledWith(
        mockIntegration,
        mockOptions
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('ID: 999')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Name: undefined')
      );
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('Type: splunk')
      );
    });
  });

  describe('Unsupported Operations', () => {
    const mockOptions = {
      resourceFile: 'integration.json',
      apiBaseUrl: 'https://api.test.com',
      authMethod: 'oauth' as const,
      headerName: 'X-Test-Token',
      headerValue: 'test-token',
      orgName: 'test-org',
      authCache: true,
      browser: true
    };

    it('test_executeCreate_shouldThrowNotSupportedError', async () => {
      await expect(command.executeCreate(mockOptions)).rejects.toThrow(
        'integration:create operation is not supported'
      );
    });

    it('test_executeUpdate_shouldThrowNotSupportedError', async () => {
      await expect(command.executeUpdate('123', mockOptions)).rejects.toThrow(
        'integration:update operation is not supported'
      );
    });

    it('test_executeDelete_shouldThrowNotSupportedError', async () => {
      const deleteOptions = {
        apiBaseUrl: 'https://api.test.com',
        authMethod: 'oauth' as const,
        headerName: 'X-Test-Token',
        headerValue: 'test-token',
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await expect(command.executeDelete('123', deleteOptions)).rejects.toThrow(
        'integration:delete operation is not supported'
      );
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
      delete (command as unknown as { createApiClient?: unknown }).createApiClient;

      // Return integration directly with type as a field
      const mockIntegration = { id: '123', name: 'test', type: 'datadog' };

      // Mock the actual API client creation and methods
      const mockCreatedClient = {
        getIntegrationById: vi.fn().mockResolvedValue(mockIntegration)
      };

      const { createApiClient } = await import('../../../../src/main/typescript/lib/api-client-factory.js');
      vi.mocked(createApiClient).mockReturnValue(mockCreatedClient as unknown as ReturnType<typeof createApiClient>);
      (command as unknown as { formatAndOutputSingle: ReturnType<typeof vi.fn> }).formatAndOutputSingle = vi.fn();

      await command.executeGet('123', mockOptions);

      expect(createApiClient).toHaveBeenCalledWith(mockOptions);
      expect(mockCreatedClient.getIntegrationById).toHaveBeenCalledWith('123');
    });
  });
});
