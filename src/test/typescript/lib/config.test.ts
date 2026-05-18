import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../../../src/main/typescript/lib/config.js';
import { SavedCliConfig } from '../../../../src/main/typescript/types.js';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `grepr-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.ensureDir(tempDir);
    configManager = new ConfigManager(tempDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  describe('Basic Configuration Operations', () => {
    it('test_setConfig_shouldSaveConfiguration', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://grepr-prod.us.auth0.com',
        authMethod: 'oauth',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);

      const retrieved = await configManager.getConfig('test');
      expect(retrieved).toEqual(config);
    });

    it('test_getConfig_noConfigFile_shouldReturnNull', async () => {
      const result = await configManager.getConfig('nonexistent');

      expect(result).toBeNull();
    });

    it('test_getConfig_configFileExists_nonExistentConfig_shouldThrowError', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };
      await configManager.setConfig('existing', config);

      await expect(configManager.getConfig('nonexistent')).rejects.toThrow(
        'Configuration \'nonexistent\' not found'
      );
    });

    it('test_listConfigs_empty_shouldReturnEmptyArray', async () => {
      const configs = await configManager.listConfigs();

      expect(configs).toEqual([]);
    });

    it('test_listConfigs_withConfigs_shouldReturnConfigNames', async () => {
      const config1: SavedCliConfig = {
        orgName: 'org1',
        authCache: true,
        browser: true
      };
      const config2: SavedCliConfig = {
        orgName: 'org2',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('config1', config1);
      await configManager.setConfig('config2', config2);

      const configs = await configManager.listConfigs();

      expect(configs).toHaveLength(2);
      expect(configs).toContain('config1');
      expect(configs).toContain('config2');
    });

    it('test_deleteConfig_shouldRemoveConfiguration', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);
      await configManager.deleteConfig('test');

      await expect(configManager.getConfig('test')).rejects.toThrow();
    });

    it('test_deleteConfig_nonExistent_shouldThrowError', async () => {
      await expect(configManager.deleteConfig('nonexistent')).rejects.toThrow(
        'Configuration \'nonexistent\' not found'
      );
    });
  });

  describe('Default Configuration', () => {
    it('test_getDefaultConfig_noDefault_shouldReturnNull', async () => {
      const defaultConfig = await configManager.getDefaultConfig();

      expect(defaultConfig).toBeNull();
    });

    it('test_getDefaultConfigName_noDefault_shouldReturnNull', async () => {
      const defaultName = await configManager.getDefaultConfigName();

      expect(defaultName).toBeNull();
    });

    it('test_setDefaultConfig_shouldSetDefault', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);
      await configManager.setDefaultConfig('test');

      const defaultName = await configManager.getDefaultConfigName();
      expect(defaultName).toBe('test');
    });

    it('test_setDefaultConfig_nonExistent_shouldThrowError', async () => {
      await expect(configManager.setDefaultConfig('nonexistent')).rejects.toThrow(
        'Configuration \'nonexistent\' not found. Cannot set as default.'
      );
    });

    it('test_getDefaultConfig_shouldReturnDefaultConfiguration', async () => {
      const config: SavedCliConfig = {
        orgName: 'default-org',
        apiBaseUrl: 'https://default-org.app.grepr.ai/api',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('mydefault', config);
      await configManager.setDefaultConfig('mydefault');

      const defaultConfig = await configManager.getDefaultConfig();

      expect(defaultConfig).toEqual(config);
    });

    it('test_listConfigs_withDefault_shouldNotIncludeDefaultField', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);
      await configManager.setDefaultConfig('test');

      const configs = await configManager.listConfigs();

      expect(configs).toEqual(['test']);
      expect(configs).not.toContain('_default');
    });

    it('test_deleteConfig_default_shouldClearDefault', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);
      await configManager.setDefaultConfig('test');
      await configManager.deleteConfig('test');

      const defaultName = await configManager.getDefaultConfigName();
      expect(defaultName).toBeNull();
    });

    it('test_deleteConfig_nonDefault_shouldPreserveDefault', async () => {
      const config1: SavedCliConfig = {
        orgName: 'org1',
        authCache: true,
        browser: true
      };
      const config2: SavedCliConfig = {
        orgName: 'org2',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('config1', config1);
      await configManager.setConfig('config2', config2);
      await configManager.setDefaultConfig('config1');
      await configManager.deleteConfig('config2');

      const defaultName = await configManager.getDefaultConfigName();
      expect(defaultName).toBe('config1');
    });

    it('test_setDefaultConfig_changeDefault_shouldUpdateDefault', async () => {
      const config1: SavedCliConfig = {
        orgName: 'org1',
        authCache: true,
        browser: true
      };
      const config2: SavedCliConfig = {
        orgName: 'org2',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('config1', config1);
      await configManager.setConfig('config2', config2);
      await configManager.setDefaultConfig('config1');

      let defaultName = await configManager.getDefaultConfigName();
      expect(defaultName).toBe('config1');

      await configManager.setDefaultConfig('config2');

      defaultName = await configManager.getDefaultConfigName();
      expect(defaultName).toBe('config2');
    });
  });

  describe('Configuration File Format', () => {
    it('test_configFile_withDefault_shouldContainDefaultField', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);
      await configManager.setDefaultConfig('test');

      const configFile = await configManager.loadConfigFile();

      expect(configFile).toBeDefined();
      expect(configFile?._default).toBe('test');
      expect(configFile?.test).toEqual(config);
    });

    it('test_configFile_withoutDefault_shouldNotContainDefaultField', async () => {
      const config: SavedCliConfig = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      await configManager.setConfig('test', config);

      const configFile = await configManager.loadConfigFile();

      expect(configFile).toBeDefined();
      expect(configFile?._default).toBeUndefined();
      expect(configFile?.test).toEqual(config);
    });
  });

  describe('Static Helper Methods', () => {
    it('test_mergeConfigWithOptions_cliOptionsShouldOverrideSavedConfig', () => {
      const savedConfig: SavedCliConfig = {
        orgName: 'saved-org',
        apiBaseUrl: 'https://saved.app.grepr.ai/api',
        authCache: true,
        browser: true
      };

      const cliOptions = {
        orgName: 'cli-org'
      };

      const merged = ConfigManager.mergeConfigWithOptions(savedConfig, cliOptions);

      expect(merged.orgName).toBe('cli-org');
      expect(merged.apiBaseUrl).toBe('https://saved.app.grepr.ai/api');
    });

    it('test_mergeConfigWithOptions_undefinedCliOptionsShouldNotOverride', () => {
      const savedConfig: SavedCliConfig = {
        orgName: 'saved-org',
        apiBaseUrl: 'https://saved.app.grepr.ai/api',
        authCache: true,
        browser: true
      };

      const cliOptions = {
        orgName: undefined,
        debug: true
      };

      const merged = ConfigManager.mergeConfigWithOptions(savedConfig, cliOptions);

      expect(merged.orgName).toBe('saved-org');
      expect(merged.debug).toBe(true);
    });

    it('test_extractSaveableConfig_shouldExtractRelevantFields', () => {
      const cliOptions = {
        orgName: 'test-org',
        apiBaseUrl: 'https://test.app.grepr.ai/api',
        authBaseUrl: 'https://grepr-prod.us.auth0.com',
        authMethod: 'oauth' as const,
        clientId: 'test-client-id',
        authCache: true,
        browser: false,
        debug: true,
        quiet: false,
        timezone: 'America/New_York'
      };

      const saveable = ConfigManager.extractSaveableConfig(cliOptions);

      expect(saveable.orgName).toBe('test-org');
      expect(saveable.apiBaseUrl).toBe('https://test.app.grepr.ai/api');
      expect(saveable.authCache).toBe(true);
      expect(saveable.browser).toBe(false);
      expect(saveable.timezone).toBe('America/New_York');
      expect((saveable as any).debug).toBeUndefined();
      expect((saveable as any).quiet).toBeUndefined();
    });

    it('test_extractSaveableConfig_systemTimezone_shouldNotBeSaved', () => {
      const cliOptions = {
        orgName: 'test-org',
        authBaseUrl: 'https://grepr-prod.us.auth0.com',
        authMethod: 'oauth' as const,
        clientId: 'test-client-id',
        authCache: true,
        browser: true,
        timezone: 'system'
      };

      const saveable = ConfigManager.extractSaveableConfig(cliOptions);

      expect(saveable.timezone).toBeUndefined();
    });
  });
});
