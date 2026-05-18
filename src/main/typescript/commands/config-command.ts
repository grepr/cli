import { Command } from 'commander';
import { ConfigManager } from '../lib/config.js';
import { ICommand } from '../lib/command-registry.js';
import { CliOptions, CommandOption, MergeConfiguration, CommandOptionsRecord } from '../types.js';

export class ConfigCommand implements ICommand {

  getCommandName(): string {
    return 'config';
  }

  getCommandDescription(): string {
    return 'Configuration management commands';
  }

  getCommandOptions(): CommandOption[] {
    return [];
  }

  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    // config:save command
    program
      .command('config:save <name>')
      .description('Save current configuration for reuse')
      .option('--default', 'Set this configuration as the default')
      .action(async (name: string, options: CommandOptionsRecord, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          await this.saveConfig(name, mergedGlobalOptions, options.default === true);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error saving configuration:', errorMessage);
          process.exit(1);
        }
      });

    // config:list command
    program
      .command('config:list')
      .description('List saved configurations')
      .action(async () => {
        try {
          await this.listConfigs();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error listing configurations:', errorMessage);
          process.exit(1);
        }
      });

    // config:show command
    program
      .command('config:show <name>')
      .description('Show a saved configuration')
      .action(async (name: string) => {
        try {
          await this.showConfig(name);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error showing configuration:', errorMessage);
          process.exit(1);
        }
      });

    // config:delete command
    program
      .command('config:delete <name>')
      .description('Delete a saved configuration')
      .action(async (name: string) => {
        try {
          await this.deleteConfig(name);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error deleting configuration:', errorMessage);
          process.exit(1);
        }
      });

    // config:default command
    program
      .command('config:default <name>')
      .description('Set a configuration as the default')
      .action(async (name: string) => {
        try {
          await this.setDefaultConfig(name);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Error setting default configuration:', errorMessage);
          process.exit(1);
        }
      });
  }
  async saveConfig(name: string, options: CliOptions, setAsDefault = false): Promise<void> {
    if (!options.orgName) {
      console.error('Error: Cannot save configuration without --org-name');
      process.exit(1);
    }

    const configManager = new ConfigManager();
    const saveableConfig = ConfigManager.extractSaveableConfig(options);

    await configManager.setConfig(name, saveableConfig);
    console.log(`Configuration '${name}' saved successfully.`);

    if (setAsDefault) {
      await configManager.setDefaultConfig(name);
      console.log(`Configuration '${name}' set as default.`);
    }
  }

  async listConfigs(): Promise<void> {
    const configManager = new ConfigManager();
    const configs = await configManager.listConfigs();
    const defaultName = await configManager.getDefaultConfigName();

    if (configs.length === 0) {
      console.log('No saved configurations found.');
      console.log('Use "grepr config:save <name>" to save a configuration.');
    } else {
      console.log('Saved configurations:');
      configs.forEach(name => {
        const isDefault = name === defaultName;
        console.log(`  ${name}${isDefault ? ' (default)' : ''}`);
      });
    }
  }

  async showConfig(name: string): Promise<void> {
    const configManager = new ConfigManager();
    const config = await configManager.getConfig(name);

    if (config) {
      console.log(`Configuration '${name}':`);
      console.log(JSON.stringify(config, null, 2));
    }
  }

  async deleteConfig(name: string): Promise<void> {
    const configManager = new ConfigManager();
    await configManager.deleteConfig(name);
    console.log(`Configuration '${name}' deleted successfully.`);
  }

  async setDefaultConfig(name: string): Promise<void> {
    const configManager = new ConfigManager();
    await configManager.setDefaultConfig(name);
    console.log(`Configuration '${name}' set as default.`);
  }
}