import type { Command } from 'commander'
import { BaseCommand } from './base-command.js'
import type { ICommand } from '../lib/command-registry.js'
import { parseIntArg } from '../lib/option-parsers.js'
import { validateOptionalTimestampRange } from '../lib/time-utils.js'
import {
  JobExecution,
  JobProcessing,
  type CommandOption,
  type MergeConfiguration,
  type QueryCommandOptions
} from '../types.js'
import {
  GreprLlmPromptResultsSourceSortOrder,
  GreprRawLogsSourceType,
  LogsIcebergTableSourceType,
  LogsSynchronousSinkType,
  type SchemaGreprRawLogsSource,
  type SchemaLogsIcebergTableSource,
  type SchemaCreateJob
} from '../openapi/openApiTypes.js'
import { buildSourcePredicate } from '../lib/query-predicate.js'
export {
  buildLanguageQueryPredicate,
  buildMessageLengthPredicate,
  buildSourcePredicate
} from '../lib/query-predicate.js'

export class QueryCommand extends BaseCommand<QueryCommandOptions> implements ICommand {

  getCommandName(): string {
    return 'query';
  }

  getCommandDescription(): string {
    return 'Execute a query against a dataset';
  }

  getCommandOptions(): CommandOption[] {
    return [
      {
        flags: '--dataset-id <id>',
        description: 'Dataset ID to query'
      },
      {
        flags: '--dataset-name <name>',
        description: 'Dataset name to query (will be resolved to ID)'
      },
      {
        flags: '--sort-order <order>',
        description: 'Sort order for results (UNSORTED, ASCENDING, DESCENDING)',
        defaultValue: 'UNSORTED'
      },
      {
        flags: '--query-type <type>',
        description: 'Query type (e.g., datadog-query)',
        defaultValue: 'datadog-query'
      },
      {
        flags: '--query <query>',
        description: 'Query string',
        defaultValue: ''
      },
      {
        flags: '--start <timestamp>',
        description: 'Start timestamp (ISO 8601 format)'
      },
      {
        flags: '--end <timestamp>',
        description: 'End timestamp (ISO 8601 format)'
      },
      {
        flags: '--limit <number>',
        description: 'Maximum number of records to return',
        parser: parseIntArg
      },
      {
        flags: '--message-length-min <number>',
        description:
          'Inclusive minimum message length in characters. Combined with --query as an AND predicate. Use 0 with --message-length-max 0 to find empty messages.',
        parser: parseIntArg
      },
      {
        flags: '--message-length-max <number>',
        description:
          'Inclusive maximum message length in characters. Combined with --query as an AND predicate. Use a large value (e.g., 32768) to find oversized messages with --message-length-min.',
        parser: parseIntArg
      }
    ];
  }

  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    let command = program.command(this.getCommandName())
      .description(this.getCommandDescription());

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

    // Add streaming options
    command
      .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'table')
      .option('-s, --sort <column:order>', 'Sort table by column (e.g., "eventTimestamp:asc")', 'eventTimestamp:asc')
      .option('--no-color', 'Disable colored output')
      .option('--no-timestamps', 'Hide timestamps')
      .option('--no-job-state', 'Hide job state messages')
      .option('--max-lines <number>', 'Maximum lines per table cell', parseIntArg, 4)
      .action(async (options: Record<string, string | boolean | number>, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          const mergedOptions: QueryCommandOptions = {
            ...mergedGlobalOptions,
            ...options
          };

          await this.execute(mergedOptions);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error('Fatal error:', errorMessage);
          process.exit(1);
        }
      });
  }

  async execute(options: QueryCommandOptions): Promise<void> {
    try {
      this.validateQueryOptions(options);
      this.initializeComponents(options);

      // Resolve dataset ID
      const datasetId = await this.resolveDatasetId(options);

      // Create job definition
      const jobDefinition = await this.createJobDefinition(options, datasetId);

      await this.processJobStream(jobDefinition, options);

    } catch (error) {
      this.handleError(error as Error, 'Query initialization error');
      process.exit(1);
    }
  }

  private validateQueryOptions(options: QueryCommandOptions): void {
    if (!options.datasetId && !options.datasetName) {
      console.error('Error: Either --dataset-id or --dataset-name is required');
      process.exit(1);
    }

    if (options.datasetId && options.datasetName) {
      console.error('Error: Cannot specify both --dataset-id and --dataset-name');
      process.exit(1);
    }

    validateOptionalTimestampRange(options);
  }

  private async resolveDatasetId(options: QueryCommandOptions): Promise<string> {
    if (options.datasetId) {
      return options.datasetId;
    }

    if (!options.quiet) {
      console.log(`Looking up dataset: ${options.datasetName}`);
    }

    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }
    if (!options.datasetName) {
      throw new Error('Dataset name is required');
    }
    const dataset = await this.apiClient.lookupDataset(options.datasetName);

    if (!dataset) {
      throw new Error(`Dataset not found: ${options.datasetName}`);
    }

    if (!options.quiet) {
      console.log(`Found dataset: ${dataset.name} (ID: ${dataset.id})`);
    }

    if (!dataset.id) {
      throw new Error(`Dataset ${options.datasetName} found but has no ID`);
    }

    return dataset.id;
  }

  private async createJobDefinition(options: QueryCommandOptions, datasetId: string): Promise<SchemaCreateJob> {
    try {
      // Defaults to SchemaGreprRawLogsSource when unset.
      const sourceQuery = buildSourcePredicate(options);
      const source: SchemaGreprRawLogsSource | SchemaLogsIcebergTableSource = {
        type:
          options.queryEngine === 'flink'
            ? LogsIcebergTableSourceType.logs_iceberg_table_source
            : GreprRawLogsSourceType.grepr_raw_log_source,
        name: 'source',
        datasetId: datasetId,
        start: options.start || new Date(Date.now() - 10 * 60 * 1000).toISOString(), // Default: 10 minutes ago
        end: options.end || new Date().toISOString(), // Default: now
        query: sourceQuery,
        sortOrder: options.sortOrder || GreprLlmPromptResultsSourceSortOrder.UNSORTED,
        limit: options.limit || 100 // Default limit to stay under sync query limit
      };
      return {
        name: `query_tool_job_${Date.now()}`,
        execution: JobExecution.SYNCHRONOUS,
        processing: JobProcessing.BATCH,
        jobGraph: {
          vertices: [
            source,
            {
              type: LogsSynchronousSinkType.logs_sync_sink,
              name: 'sink'
            }
          ],
          edges: ['source -> sink']
        },
        tags: {}
      };
    } catch (error) {
      throw new Error(`Failed to create job definition: ${(error as Error).message}`);
    }
  }
}
