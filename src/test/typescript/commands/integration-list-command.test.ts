import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationListCommand } from '../../../../src/main/typescript/commands/integration-command.js';

// Mock the GreprApiClient
vi.mock('../../../../src/main/typescript/lib/grepr-api-client.js', () => ({
  GreprApiClient: vi.fn(() => ({
    getAllIntegrations: vi.fn(),
  }))
}));

// Mock the API client factory
vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(() => ({
    getAllIntegrations: vi.fn(),
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

describe('IntegrationListCommand', () => {
  let command: IntegrationListCommand;
  let mockApiClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new IntegrationListCommand();
    mockApiClient = {
      getAllIntegrations: vi.fn(),
    };
    // Mock the createApiClient method to return our mock
    (command as any).createApiClient = vi.fn(() => mockApiClient);
    (command as any).formatAndOutput = vi.fn();
    (command as any).showQuerySummary = vi.fn();
  });

  describe('Basic Properties', () => {
    it('test_getCommandName_shouldReturnIntegrationList', () => {
      const result = command.getCommandName();
      expect(result).toBe('integration:list');
    });

    it('test_getCommandDescription_shouldReturnCorrectDescription', () => {
      const result = command.getCommandDescription();
      expect(result).toBe('List integrations with optional filtering');
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

    it('test_executeList_successfulResponse_shouldFormatAndDisplayIntegrations', async () => {
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            { id: '1', name: 'datadog-prod', createdAt: '2024-01-01T00:00:00Z' },
            { id: '2', name: 'datadog-dev', createdAt: '2024-01-02T00:00:00Z' }
          ]
        },
        {
          type: 'newrelic',
          items: [
            { id: '3', name: 'newrelic-main', createdAt: '2024-01-03T00:00:00Z' }
          ]
        },
        {
          type: 'splunk',
          items: [
            { id: '4', name: 'splunk-logs', createdAt: '2024-01-04T00:00:00Z' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const expectedFlattenedList = [
        { id: '1', name: 'datadog-prod', createdAt: '2024-01-01T00:00:00Z', type: 'datadog' },
        { id: '2', name: 'datadog-dev', createdAt: '2024-01-02T00:00:00Z', type: 'datadog' },
        { id: '3', name: 'newrelic-main', createdAt: '2024-01-03T00:00:00Z', type: 'newrelic' },
        { id: '4', name: 'splunk-logs', createdAt: '2024-01-04T00:00:00Z', type: 'splunk' }
      ];

      expect(mockApiClient.getAllIntegrations).toHaveBeenCalled();
      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        expectedFlattenedList,
        mockOptions,
        'integrations'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 4);
    });

    it('test_executeList_emptyIntegrations_shouldHandleEmptyResponse', async () => {
      const mockIntegrations = [
        { type: 'datadog', items: [] },
        { type: 'newrelic', items: [] },
        { type: 'splunk', items: [] }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'integrations'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_noIntegrationTypes_shouldHandleEmptyTypesList', async () => {
      mockApiClient.getAllIntegrations.mockResolvedValue([]);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'integrations'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 0);
    });

    it('test_executeList_mixedIntegrationTypes_shouldPreserveTypeInformation', async () => {
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            { id: 'dd1', name: 'datadog-integration', site: 'datadoghq.com' }
          ]
        },
        {
          type: 'data-warehouse',
          items: [
            { id: 'dw1', name: 'warehouse-integration', host: 'warehouse.example.com' }
          ]
        },
        {
          type: 's3-data-warehouse',
          items: [
            { id: 's3dw1', name: 's3-warehouse', bucket: 'my-bucket' }
          ]
        },
        {
          type: 'otlp',
          items: [
            { id: 'otlp1', name: 'otlp-collector', endpoint: 'http://otlp.example.com' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const expectedFlattenedList = [
        { id: 'dd1', name: 'datadog-integration', site: 'datadoghq.com', type: 'datadog' },
        { id: 'dw1', name: 'warehouse-integration', host: 'warehouse.example.com', type: 'data-warehouse' },
        { id: 's3dw1', name: 's3-warehouse', bucket: 'my-bucket', type: 's3-data-warehouse' },
        { id: 'otlp1', name: 'otlp-collector', endpoint: 'http://otlp.example.com', type: 'otlp' }
      ];

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        expectedFlattenedList,
        mockOptions,
        'integrations'
      );
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, 4);
    });

    it('test_executeList_integrationWithComplexProperties_shouldFlattenCorrectly', async () => {
      const mockIntegrations = [
        {
          type: 'splunk',
          items: [
            {
              id: 'splunk1',
              name: 'complex-splunk',
              config: {
                host: 'splunk.example.com',
                port: 8089,
                index: 'main'
              },
              tags: ['production', 'logs'],
              metadata: {
                createdBy: 'admin',
                lastUpdated: '2024-01-01T00:00:00Z'
              }
            }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const expectedFlattenedList = [
        {
          id: 'splunk1',
          name: 'complex-splunk',
          config: {
            host: 'splunk.example.com',
            port: 8089,
            index: 'main'
          },
          tags: ['production', 'logs'],
          metadata: {
            createdBy: 'admin',
            lastUpdated: '2024-01-01T00:00:00Z'
          },
          type: 'splunk'
        }
      ];

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        expectedFlattenedList,
        mockOptions,
        'integrations'
      );
    });

    it('test_executeList_allSupportedIntegrationTypes_shouldIncludeAllTypes', async () => {
      const allIntegrationTypes = ['datadog', 'data-warehouse', 's3-data-warehouse', 'newrelic', 'otlp', 'splunk', 'sumo'];
      const mockIntegrations = allIntegrationTypes.map((type, index) => ({
        type,
        items: [{
          id: `${type}-${index}`,
          name: `${type}-integration-${index}`,
          status: 'active'
        }]
      }));

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const expectedCount = allIntegrationTypes.length;
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(mockOptions, expectedCount);

      // Verify that each type is represented in the flattened list
      const [[flattenedList]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const typesIncluded = [...new Set(flattenedList.map((item: any) => item.type))];
      expect(typesIncluded).toHaveLength(allIntegrationTypes.length);
      allIntegrationTypes.forEach(type => {
        expect(typesIncluded).toContain(type);
      });
    });

    it('test_executeList_apiClientThrowsError_shouldCatchAndLogError', async () => {
      const mockError = new Error('API connection failed');
      mockApiClient.getAllIntegrations.mockRejectedValue(mockError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing integrations:',
        'API connection failed'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_networkTimeout_shouldHandleGracefully', async () => {
      const timeoutError = new Error('Request timeout after 30000ms');
      mockApiClient.getAllIntegrations.mockRejectedValue(timeoutError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing integrations:',
        'Request timeout after 30000ms'
      );
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });

    it('test_executeList_unauthorizedAccess_shouldDisplayAppropriateError', async () => {
      const authError = new Error('Unauthorized: Invalid API token');
      mockApiClient.getAllIntegrations.mockRejectedValue(authError);

      await expect(async () => {
        await command.executeList(mockOptions);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing integrations:',
        'Unauthorized: Invalid API token'
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
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [{ id: '1', name: 'test-integration' }]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      // Verify base class methods are called with correct parameters
      expect((command as any).formatAndOutput).toHaveBeenCalledTimes(1);
      expect((command as any).showQuerySummary).toHaveBeenCalledTimes(1);

      const [formatArgs] = vi.mocked((command as any).formatAndOutput).mock.calls[0];
      expect(formatArgs).toHaveLength(1);
      expect(formatArgs[0]).toEqual({ id: '1', name: 'test-integration', type: 'datadog' });
    });

    it('test_executeList_shouldPassCorrectResourceNameToFormatAndOutput', async () => {
      const mockIntegrations: any[] = [];
      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        mockOptions,
        'integrations'
      );
    });
  });

  describe('Data Transformation', () => {
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

    it('test_executeList_shouldPreserveOriginalIntegrationProperties', async () => {
      const originalIntegration = {
        id: 'preserve-test',
        name: 'preservation-test',
        customField: 'custom-value',
        nestedObject: {
          key: 'value',
          number: 42
        },
        arrayField: ['item1', 'item2']
      };

      const mockIntegrations = [
        {
          type: 'newrelic',
          items: [originalIntegration]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const [[flattenedList]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedIntegration = flattenedList[0];

      // Original properties should be preserved
      expect(transformedIntegration.id).toBe(originalIntegration.id);
      expect(transformedIntegration.name).toBe(originalIntegration.name);
      expect(transformedIntegration.customField).toBe(originalIntegration.customField);
      expect(transformedIntegration.nestedObject).toEqual(originalIntegration.nestedObject);
      expect(transformedIntegration.arrayField).toEqual(originalIntegration.arrayField);

      // Type should be added
      expect(transformedIntegration.type).toBe('newrelic');
    });

    it('test_executeList_shouldHandleIntegrationsWithoutIdOrName', async () => {
      const incompleteIntegration = {
        // Missing id and name
        status: 'active',
        endpoint: 'https://example.com'
      };

      const mockIntegrations = [
        {
          type: 'otlp',
          items: [incompleteIntegration]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      await command.executeList(mockOptions);

      const [[flattenedList]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      const transformedIntegration = flattenedList[0];

      expect(transformedIntegration.status).toBe('active');
      expect(transformedIntegration.endpoint).toBe('https://example.com');
      expect(transformedIntegration.type).toBe('otlp');
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
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            { id: '1', name: 'datadog-prod', status: 'active' },
            { id: '2', name: 'datadog-dev', status: 'inactive' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/integrations-output.json'
      };

      await command.executeList(optionsWithOutput);

      const expectedFlattenedList = [
        { id: '1', name: 'datadog-prod', status: 'active', type: 'datadog' },
        { id: '2', name: 'datadog-dev', status: 'inactive', type: 'datadog' }
      ];

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        expectedFlattenedList,
        optionsWithOutput,
        'integrations'
      );

      // Verify output option is passed through
      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/integrations-output.json');
    });

    it('test_executeList_withOutputOptionAndQuiet_shouldNotShowConsoleMessages', async () => {
      const mockIntegrations = [
        {
          type: 'newrelic',
          items: [
            { id: '1', name: 'newrelic-main', status: 'active' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/integrations-output.csv',
        quiet: true
      };

      await command.executeList(optionsWithOutput);

      const expectedFlattenedList = [
        { id: '1', name: 'newrelic-main', status: 'active', type: 'newrelic' }
      ];

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        expectedFlattenedList,
        optionsWithOutput,
        'integrations'
      );
      // showQuerySummary is called but internally checks quiet flag
      expect((command as any).showQuerySummary).toHaveBeenCalledWith(optionsWithOutput, 1);
      // Verify the quiet option is set to true
      const [[options]] = vi.mocked((command as any).showQuerySummary).mock.calls;
      expect(options.quiet).toBe(true);
    });

    it('test_executeList_withOutputOptionAndDifferentFormats_shouldPassCorrectFormat', async () => {
      const mockIntegrations = [
        {
          type: 'splunk',
          items: [
            { id: '1', name: 'splunk-logs', status: 'active' }
          ]
        }
      ];

      const formats = ['csv', 'pretty', 'raw', 'compact'] as const;

      for (const format of formats) {
        vi.clearAllMocks();
        mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

        const optionsWithOutput = {
          ...mockOptions,
          output: `/tmp/integrations-output.${format}`,
          format
        };

        await command.executeList(optionsWithOutput);

        const expectedFlattenedList = [
          { id: '1', name: 'splunk-logs', status: 'active', type: 'splunk' }
        ];

        expect((command as any).formatAndOutput).toHaveBeenCalledWith(
          expectedFlattenedList,
          optionsWithOutput,
          'integrations'
        );

        const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
        expect(options.format).toBe(format);
        expect(options.output).toBe(`/tmp/integrations-output.${format}`);
      }
    });

    it('test_executeList_withOutputOptionAndEmptyIntegrations_shouldStillPassOutputOption', async () => {
      mockApiClient.getAllIntegrations.mockResolvedValue([]);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/empty-integrations.json'
      };

      await command.executeList(optionsWithOutput);

      expect((command as any).formatAndOutput).toHaveBeenCalledWith(
        [],
        optionsWithOutput,
        'integrations'
      );

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('/tmp/empty-integrations.json');
    });

    it('test_executeList_withOutputOptionAndRelativePath_shouldPassRelativePathUnmodified', async () => {
      const mockIntegrations = [
        {
          type: 'otlp',
          items: [
            { id: '1', name: 'otlp-collector', status: 'active' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: './output/integrations.json'
      };

      await command.executeList(optionsWithOutput);

      const [[, options]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(options.output).toBe('./output/integrations.json');
    });

    it('test_executeList_withOutputOptionAndComplexIntegrations_shouldPassAllDataToFormatAndOutput', async () => {
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            {
              id: 'dd-1',
              name: 'Complex Datadog Integration',
              config: {
                site: 'datadoghq.com',
                apiKey: 'encrypted',
                tags: ['env:prod', 'team:platform']
              },
              metadata: {
                createdAt: '2024-01-01T00:00:00Z',
                createdBy: 'admin@example.com'
              }
            }
          ]
        },
        {
          type: 's3-data-warehouse',
          items: [
            {
              id: 's3dw-1',
              name: 'Complex S3 Warehouse',
              config: {
                bucket: 'my-warehouse-bucket',
                region: 'us-west-2',
                prefix: 'data/'
              },
              metadata: {
                createdAt: '2024-01-02T00:00:00Z',
                createdBy: 'system'
              }
            }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/complex-integrations.json'
      };

      await command.executeList(optionsWithOutput);

      const [[integrations]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(integrations).toHaveLength(2);
      expect(integrations[0].type).toBe('datadog');
      expect(integrations[0].config).toBeDefined();
      expect(integrations[0].metadata).toBeDefined();
      expect(integrations[1].type).toBe('s3-data-warehouse');
      expect(integrations[1].config).toBeDefined();
      expect(integrations[1].metadata).toBeDefined();
    });

    it('test_executeList_withOutputOptionAndMultipleTypes_shouldFlattenAndPassAllTypesCorrectly', async () => {
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            { id: 'dd1', name: 'Datadog Main' }
          ]
        },
        {
          type: 'newrelic',
          items: [
            { id: 'nr1', name: 'NewRelic Prod' },
            { id: 'nr2', name: 'NewRelic Dev' }
          ]
        },
        {
          type: 'splunk',
          items: [
            { id: 'sp1', name: 'Splunk Logs' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/multi-type-integrations.json'
      };

      await command.executeList(optionsWithOutput);

      const [[integrations]] = vi.mocked((command as any).formatAndOutput).mock.calls;
      expect(integrations).toHaveLength(4);

      const types = integrations.map((i: any) => i.type);
      expect(types).toContain('datadog');
      expect(types).toContain('newrelic');
      expect(types).toContain('splunk');
      expect(types.filter((t: string) => t === 'newrelic')).toHaveLength(2);
    });
  });

  describe('formatAndOutput Implementation Tests', () => {
    let commandWithRealFormatAndOutput: IntegrationListCommand;
    let mockFs: any;

    beforeEach(async () => {
      vi.clearAllMocks();
      commandWithRealFormatAndOutput = new IntegrationListCommand();

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
      const mockIntegrations = [
        {
          type: 'datadog',
          items: [
            { id: '1', name: 'datadog-prod', status: 'active' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-integrations.json',
        format: 'pretty' as const
      };

      await commandWithRealFormatAndOutput.executeList(optionsWithOutput);

      // Verify fs.default.writeFile was called
      expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/tmp/test-integrations.json',
        expect.any(String)
      );

      // Verify success message was logged
      expect(consoleSpy.log).toHaveBeenCalledWith('✓ Output written to /tmp/test-integrations.json');
    });

    it('test_formatAndOutput_fsWriteFileFails_shouldThrowError', async () => {
      const mockIntegrations = [
        {
          type: 'splunk',
          items: [
            { id: '1', name: 'splunk-logs', status: 'active' }
          ]
        }
      ];

      mockApiClient.getAllIntegrations.mockResolvedValue(mockIntegrations);

      // Mock fs.writeFile to fail
      const writeError = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(writeError);

      const optionsWithOutput = {
        ...mockOptions,
        output: '/tmp/test-integrations.json'
      };

      await expect(async () => {
        await commandWithRealFormatAndOutput.executeList(optionsWithOutput);
      }).rejects.toThrow('process.exit called');

      expect(consoleSpy.error).toHaveBeenCalledWith(
        'Error listing integrations:',
        'Disk full'
      );
    });
  });
});
