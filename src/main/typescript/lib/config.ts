import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { CliOptions, SavedCliConfig, CliConfigFile } from '../types.js';

/**
 * Configuration manager for CLI settings
 */
export class ConfigManager {
  private readonly configDir: string;
  private readonly configFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(os.homedir(), '.grepr');
    this.configFile = path.join(this.configDir, 'cli-config.json');
  }
  /**
   * Load configuration from file
   */
  async loadConfigFile(): Promise<CliConfigFile | null> {
    try {
      if (await fs.pathExists(this.configFile)) {
        return await fs.readJson(this.configFile);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Warning: Failed to load CLI config file: ${errorMessage}`);
    }
    return null;
  }

  /**
   * Save configuration to file
   */
  async saveConfigFile(config: CliConfigFile): Promise<void> {
    try {
      await fs.ensureDir(this.configDir, { mode: 0o700 });
      await fs.writeJson(this.configFile, config, { spaces: 2, mode: 0o600 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to save CLI config file: ${errorMessage}`);
    }
  }

  /**
   * Get a specific configuration by name
   */
  async getConfig(configName: string): Promise<SavedCliConfig | null> {
    const configFile = await this.loadConfigFile();
    if (!configFile) {
      return null;
    }

    const config = configFile[configName];
    if (!config || typeof config === 'string') {
      throw new Error(`Configuration '${configName}' not found. Available configurations: ${Object.keys(configFile).filter(k => k !== '_default').join(', ')}`);
    }

    return config;
  }

  /**
   * Set a configuration by name
   */
  async setConfig(configName: string, config: SavedCliConfig): Promise<void> {
    const configFile = await this.loadConfigFile() || {};
    configFile[configName] = config;
    await this.saveConfigFile(configFile);
  }

  /**
   * List all available configurations
   */
  async listConfigs(): Promise<string[]> {
    const configFile = await this.loadConfigFile();
    return configFile ? Object.keys(configFile).filter(key => key !== '_default') : [];
  }

  /**
   * Delete a configuration by name
   */
  async deleteConfig(configName: string): Promise<void> {
    const configFile = await this.loadConfigFile();
    if (!configFile || !configFile[configName]) {
      throw new Error(`Configuration '${configName}' not found`);
    }

    const { [configName]: _removedConfig, ...remainingConfigs } = configFile;

    if (configFile._default === configName) {
      delete remainingConfigs._default;
    }

    await this.saveConfigFile(remainingConfigs);
  }

  /**
   * Get the name of the default configuration
   */
  async getDefaultConfigName(): Promise<string | null> {
    const configFile = await this.loadConfigFile();
    return configFile?._default || null;
  }

  /**
   * Set the default configuration by name
   */
  async setDefaultConfig(configName: string): Promise<void> {
    const configFile = await this.loadConfigFile();
    if (!configFile || !configFile[configName]) {
      throw new Error(`Configuration '${configName}' not found. Cannot set as default.`);
    }

    configFile._default = configName;
    await this.saveConfigFile(configFile);
  }

  /**
   * Get the default configuration
   */
  async getDefaultConfig(): Promise<SavedCliConfig | null> {
    const defaultName = await this.getDefaultConfigName();
    if (!defaultName) {
      return null;
    }

    return await this.getConfig(defaultName);
  }

  /**
   * Merge saved configuration with CLI options
   * CLI options take precedence over saved config
   */
  static mergeConfigWithOptions(savedConfig: SavedCliConfig, cliOptions: Partial<CliOptions>): Partial<CliOptions> {
    return {
      // Saved config provides defaults
      ...savedConfig,
      // CLI options override saved config
      ...Object.fromEntries(
        Object.entries(cliOptions).filter(([, value]) => value !== undefined)
      )
    };
  }

  /**
   * Extract saveable configuration from CLI options
   */
  static extractSaveableConfig(cliOptions: CliOptions): SavedCliConfig {
    const config: SavedCliConfig = {
      orgName: cliOptions.orgName,
      authBaseUrl: cliOptions.authBaseUrl,
      authMethod: cliOptions.authMethod,
      clientId: cliOptions.clientId,
      authCache: cliOptions.authCache !== false,
      browser: cliOptions.browser !== false,
    };

    // Only include apiBaseUrl if it's defined
    if (cliOptions.apiBaseUrl) {
      config.apiBaseUrl = cliOptions.apiBaseUrl;
    }

    // Only include timezone if it's defined and not the default
    if (cliOptions.timezone && cliOptions.timezone !== 'system') {
      config.timezone = cliOptions.timezone;
    }

    return config;
  }
}