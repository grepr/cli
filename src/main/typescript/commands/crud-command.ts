import { Command } from 'commander';
import fs from 'fs-extra';
import { JsonFormatter, JsonFormatterOptions } from '../lib/json-formatter.js';
import { ICommand } from '../lib/command-registry.js';
import { GreprApiClient } from '../lib/api-client.js';
import { createApiClient, ApiClientFactoryOptions } from '../lib/api-client-factory.js';
import { OutputFormat } from '../lib/output-format.js';
import { parseIntArg } from '../lib/option-parsers.js';
import { CommandOption, MergeConfiguration, CommandOptionsRecord } from '../types.js';

export interface CrudCommandOptions extends ApiClientFactoryOptions {
  quiet?: boolean;
  timezone?: string;
  output?: string;
  format?: OutputFormat;
  sort?: string;
  color?: boolean;
  timestamps?: boolean;
  jobState?: boolean;
  maxDepth?: number;
  maxLines?: number;
}

export interface CrudCreateUpdateOptions extends CrudCommandOptions {
  resourceFile: string;
}

/**
 * Base class for CRUD commands (job:*, integration:*, dataset:*)
 * Provides common functionality for create, read, update, delete operations
 */
export abstract class CrudCommand<T extends CrudCommandOptions> implements ICommand {
  protected formatter: JsonFormatter | null = null;
  protected apiClient: GreprApiClient | null = null;

  /**
   * Get the command prefix (e.g., 'job', 'integration', 'dataset')
   */
  abstract getCommandPrefix(): string;

  /**
   * Get singular resource name for messages (e.g., 'job', 'integration', 'dataset')
   */
  abstract getResourceName(): string;

  /**
   * Execute get operation
   */
  async executeGet(_resourceId: string, _options: T): Promise<void> {
    throw new Error(`${this.getResourceName()}:get operation is not supported`);
  }

  /**
   * Execute create operation
   */
  async executeCreate(_options: CrudCreateUpdateOptions): Promise<void> {
    throw new Error(`${this.getResourceName()}:create operation is not supported`);
  }

  /**
   * Execute update operation
   */
  async executeUpdate(_resourceId: string, _options: CrudCreateUpdateOptions): Promise<void> {
    throw new Error(`${this.getResourceName()}:update operation is not supported`);
  }

  /**
   * Execute delete operation
   */
  async executeDelete(_resourceId: string, _options: T): Promise<void> {
    throw new Error(`${this.getResourceName()}:delete operation is not supported`);
  }

  /**
   * Whether this command supports get operations
   */
  protected supportsGet(): boolean {
    return true;
  }

  /**
   * Whether this command supports create operations
   */
  protected supportsCreate(): boolean {
    return true;
  }

  /**
   * Subclasses override this when they register their own `:create` command
   * (e.g. JobCrudCommand registers a version with extra streaming-format
   * options). Returning true tells addToProgram to skip the default create
   * registration so the command isn't double-registered.
   */
  protected hasCustomCreate(): boolean {
    return false;
  }

  /**
   * Whether this command supports update operations
   */
  protected supportsUpdate(): boolean {
    return true;
  }

  /**
   * Whether this command supports delete operations
   */
  protected supportsDelete(): boolean {
    return true;
  }

  /**
   * Get command-specific options for get command
   */
  protected getGetOptions(): CommandOption[] {
    return [];
  }

  /**
   * Get command-specific options for update command
   */
  protected getUpdateOptions(): CommandOption[] {
    return [];
  }

  /**
   * Add this command to the program
   */
  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    const prefix = this.getCommandPrefix();
    const resourceName = this.getResourceName();

    // Get command
    if (this.supportsGet()) {
      let getCommand = program
        .command(`${prefix}:get <id>`)
        .description(`Get a specific ${resourceName} by ID`)
        .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'pretty')
        .option('-s, --sort <column:order>', 'Sort by column (e.g., "name:asc")', 'id:asc')
        .option('--no-color', 'Disable colored output')
        .option('--no-timestamps', 'Hide timestamps')
        .option('--no-job-state', 'Hide job state messages')
        .option('--max-depth <number>', 'Maximum object nesting depth for table columns', parseIntArg, 1)
        .option('--max-lines <number>', 'Maximum lines per table cell', parseIntArg, 4);

      // Add subclass-specific options (e.g. --version and --resolved for jobs).
      // Mirrors the wiring used by the update command below; without this the
      // options declared in getGetOptions() are silently ignored.
      this.getGetOptions().forEach(option => {
        if (option.parser && option.defaultValue !== undefined) {
          getCommand = getCommand.option(option.flags, option.description, option.parser, option.defaultValue as string | boolean);
        } else if (option.parser) {
          getCommand = getCommand.option(option.flags, option.description, option.parser);
        } else if (option.defaultValue !== undefined) {
          getCommand = getCommand.option(option.flags, option.description, option.defaultValue as string | boolean);
        } else {
          getCommand = getCommand.option(option.flags, option.description);
        }
      });

      getCommand.action(async (resourceId: string, options: CommandOptionsRecord, command: Command) => {
          try {
            const globalOptions = command.parent?.opts() || {};
            const mergedGlobalOptions = await mergeConfiguration(globalOptions);
            const mergedOptions = {
              ...mergedGlobalOptions,
              ...options
            } as T;

            await this.executeGet(resourceId, mergedOptions);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error getting ${resourceName} ${resourceId}:`, errorMessage);
            process.exit(1);
          }
        });
    }

    // Create command (skipped when a subclass registers a custom one)
    if (this.supportsCreate() && !this.hasCustomCreate()) {
      program
        .command(`${prefix}:create <${resourceName}-file>`)
        .description(`Create a new ${resourceName} from file`)
        .action(async (resourceFile: string, options: CommandOptionsRecord, command: Command) => {
          try {
            const globalOptions = command.parent?.opts() || {};
            const mergedGlobalOptions = await mergeConfiguration(globalOptions);
            const mergedOptions: CrudCreateUpdateOptions = {
              ...mergedGlobalOptions,
              resourceFile
            };

            await this.executeCreate(mergedOptions);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error creating ${resourceName}:`, errorMessage);
            process.exit(1);
          }
        });
    }

    // Update command
    if (this.supportsUpdate()) {
      let updateCommand = program
        .command(`${prefix}:update <id> <${resourceName}-file>`)
        .description(`Update an existing ${resourceName}`);

      // Add update-specific options
      this.getUpdateOptions().forEach(option => {
        if (option.parser && option.defaultValue !== undefined) {
          updateCommand = updateCommand.option(option.flags, option.description, option.parser, option.defaultValue as string | boolean);
        } else if (option.parser) {
          updateCommand = updateCommand.option(option.flags, option.description, option.parser);
        } else if (option.defaultValue !== undefined) {
          updateCommand = updateCommand.option(option.flags, option.description, option.defaultValue as string | boolean | string[]);
        } else {
          updateCommand = updateCommand.option(option.flags, option.description);
        }
      });

      updateCommand.action(async (resourceId: string, resourceFile: string, options: CommandOptionsRecord, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          const mergedOptions: CrudCreateUpdateOptions = {
            ...mergedGlobalOptions,
            resourceFile,
            ...options
          };

          await this.executeUpdate(resourceId, mergedOptions);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error updating ${resourceName} ${resourceId}:`, errorMessage);
          process.exit(1);
        }
      });
    }

    // Delete command
    if (this.supportsDelete()) {
      program
        .command(`${prefix}:delete <id>`)
        .description(`Delete a ${resourceName}`)
        .action(async (resourceId: string, options: CommandOptionsRecord, command: Command) => {
          try {
            const globalOptions = command.parent?.opts() || {};
            const mergedGlobalOptions = await mergeConfiguration(globalOptions);

            await this.executeDelete(resourceId, mergedGlobalOptions as T);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error deleting ${resourceName} ${resourceId}:`, errorMessage);
            process.exit(1);
          }
        });
    }
  }

  /**
   * Setup formatter for output
   */
  protected setupFormatter(options: T): void {
    const formatterOptions: JsonFormatterOptions = {
      format: (options.format as OutputFormat) || 'pretty',
      showTimestamps: options.timestamps !== false,
      colorize: options.color !== false && process.stdout.isTTY && !options.output,
      sortBy: options.sort || 'id:asc',
      maxDepth: options.maxDepth ?? 1,
      maxLines: options.maxLines ?? 4
    };

    // Only add timezone if it's defined
    if (options.timezone) {
      formatterOptions.timezone = options.timezone;
    }

    this.formatter = new JsonFormatter(formatterOptions);
  }

  /**
   * Create API client using shared factory
   */
  protected createApiClient(options: T): GreprApiClient {
    return createApiClient(options);
  }

  /**
   * Format and output single resource
   */
  protected async formatAndOutputSingle(
    data: Record<string, unknown>,
    options: T
  ): Promise<void> {
    // Setup formatter
    this.setupFormatter(options);

    // Handle output
    if (options.output) {
      // Write to file
      if (!this.formatter) {
        throw new Error('Formatter not initialized');
      }
      const formattedData = this.formatter.formatObject(data);
      await fs.writeFile(options.output, formattedData);

      if (!options.quiet) {
        console.log(`✓ Output written to ${options.output}`);
      }
    } else {
      // Write to stdout
      if (!this.formatter) {
        throw new Error('Formatter not initialized');
      }
      console.log(this.formatter.formatObject(data));
    }
  }

  /**
   * Load resource definition from file
   */
  protected async loadResourceFromFile<TResource>(resourceFile: string): Promise<TResource> {
    try {
      if (!await fs.pathExists(resourceFile)) {
        throw new Error(`${this.getResourceName()} definition file not found: ${resourceFile}`);
      }

      const resourceData = await fs.readJson(resourceFile);

      // Leave shape validation to the server — different operations need
      // different shapes (e.g. Job.UpdateApi has no `name` field but does
      // require `fromVersion`/`desiredState`). Client-side name-only checks
      // were rejecting otherwise-valid update payloads.
      return resourceData as TResource;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load ${this.getResourceName()} definition: ${errorMessage}`);
    }
  }

  /**
   * Show success message for create operation
   */
  protected showCreateSuccess(createdResource: Record<string, unknown>, options: T): void {
    if (!options.quiet) {
      console.log(`✓ ${this.getResourceName()} created successfully with ID: ${createdResource.id}`);
    }
  }

  /**
   * Show success message for update operation
   */
  protected showUpdateSuccess(resourceId: string, options: T): void {
    if (!options.quiet) {
      console.log(`✓ ${this.getResourceName()} ${resourceId} updated successfully`);
    }
  }

  /**
   * Show success message for delete operation
   */
  protected showDeleteSuccess(resourceId: string, options: T): void {
    if (!options.quiet) {
      console.log(`✓ ${this.getResourceName()} ${resourceId} deleted successfully`);
    }
  }
}