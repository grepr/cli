import { Command } from 'commander';
import { JsonFormatter, JsonFormatterOptions } from '../lib/json-formatter.js';
import { ICommand } from '../lib/command-registry.js';
import { GreprApiClient } from '../lib/api-client.js';
import { createApiClient, ApiClientFactoryOptions } from '../lib/api-client-factory.js';
import { CommandOption, MergeConfiguration, CommandOptionsRecord } from '../types.js';

export interface ListCommandOptions extends ApiClientFactoryOptions {
  quiet?: boolean;
  timezone?: string;
  output?: string;
  format?: 'table' | 'csv' | 'pretty' | 'raw' | 'compact';
  sort?: string;
  color?: boolean;
  timestamps?: boolean;
  jobState?: boolean;
  maxDepth?: number;
  maxLines?: number;
}

/**
 * Base class for list commands (job:list, integration:list, dataset:list)
 * Provides common functionality for filtering, formatting, and output
 */
export abstract class ListCommand<T extends ListCommandOptions> implements ICommand {
  protected formatter: JsonFormatter | null = null;
  protected apiClient: GreprApiClient | null = null;

  /**
   * Get the command name (e.g., 'job:list', 'integration:list')
   */
  abstract getCommandName(): string;

  /**
   * Get the command description
   */
  abstract getCommandDescription(): string;

  /**
   * Get command-specific options
   */
  abstract getCommandOptions(): CommandOption[];

  /**
   * Execute the list operation
   */
  abstract executeList(options: T): Promise<void>;

  /**
   * Add this command to the program
   */
  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    let command = program.command(this.getCommandName());

    // Set aliases for common commands
    if (this.getCommandName() === 'job:list') {
      command = command.alias('jobs');
    } else if (this.getCommandName() === 'dataset:list') {
      command = command.alias('datasets');
    }

    command = command.description(this.getCommandDescription());

    // Add command-specific options
    this.getCommandOptions().forEach(option => {
      if (option.parser && option.defaultValue !== undefined) {
        command = command.option(option.flags, option.description, option.parser, option.defaultValue as string | boolean);
      } else if (option.parser) {
        command = command.option(option.flags, option.description, option.parser);
      } else if (option.defaultValue !== undefined) {
        command = command.option(option.flags, option.description, option.defaultValue as string | boolean | string[]);
      } else {
        command = command.option(option.flags, option.description);
      }
    });

    // Add common formatting options
    command
      .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'table')
      .option('-s, --sort <column:order>', 'Sort by column (e.g., "name:asc")', 'id:asc')
      .option('--no-color', 'Disable colored output')
      .option('--no-timestamps', 'Hide timestamps')
      .option('--no-job-state', 'Hide job state messages')
      .option('--max-depth <number>', 'Maximum object nesting depth for table columns', parseInt, 1)
      .option('--max-lines <number>', 'Maximum lines per table cell', parseInt, 4)
      .action(async (options: CommandOptionsRecord, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          const mergedOptions = {
            ...mergedGlobalOptions,
            ...options
          } as T;

          await this.executeList(mergedOptions);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage);
          process.exit(1);
        }
      });
  }

  /**
   * Setup formatter for output
   */
  protected setupFormatter(options: T): void {
    const formatterOptions: JsonFormatterOptions = {
      format: (options.format as 'table' | 'csv' | 'pretty' | 'raw' | 'compact') || 'table',
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
   * Format and output data
   */
  protected async formatAndOutput(
    data: Record<string, unknown>[],
    options: T,
    dataType: string
  ): Promise<void> {
    if (!data || data.length === 0) {
      if (!options.quiet) {
        console.log(`No ${dataType} found.`);
      }
      return;
    }

    // Setup formatter
    this.setupFormatter(options);

    // Handle output
    if (options.output) {
      // Write to file
      if (!this.formatter) {
        throw new Error('Formatter not initialized');
      }
      const formattedData = this.formatter.formatObjects(data);
      const fs = await import('fs-extra');
      await fs.writeFile(options.output, formattedData);

      if (!options.quiet) {
        console.log(`✓ Output written to ${options.output}`);
      }
    } else {
      // Write to stdout
      if (!this.formatter) {
        throw new Error('Formatter not initialized');
      }
      console.log(this.formatter.formatObjects(data));
    }
  }

  /**
   * Generate query summary showing applied filters and results
   */
  protected generateQuerySummary(options: T, resultCount: number): string {
    const filters: string[] = [];
    const duration = '0.5s'; // TODO: Track actual duration

    // Add filters based on options (subclasses can override)
    if (options.sort) {
      filters.push(`sort=${options.sort}`);
    }

    const filterStr = filters.length > 0 ? filters.join(', ') : 'none';

    return `\nQuery Summary:
- Filters: ${filterStr}
- Results: ${resultCount} ${this.getCommandName().split(':')[0]}s found
- Duration: ${duration}`;
  }

  /**
   * Show query summary if not in quiet mode
   */
  protected showQuerySummary(options: T, resultCount: number): void {
    if (!options.quiet) {
      console.log(this.generateQuerySummary(options, resultCount));
    }
  }
}