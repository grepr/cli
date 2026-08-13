import type { Command } from 'commander';
import { BaseCommand } from './base-command.js';
import type { ICommand } from '../lib/command-registry.js';
import { createApiClient } from '../lib/api-client-factory.js';
import { parseIntArg } from '../lib/option-parsers.js';
import { validateOptionalTimestampRange } from '../lib/time-utils.js';
import {
  JobExecution,
  JobProcessing,
  type CommandOption,
  type MergeConfiguration,
  type QueryCommandOptions
} from '../types.js';
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  GreprLlmPromptResultsSourceSortOrder,
  GreprRawLogsSourceType,
  GreprRawSpanSourceType,
  LogsIcebergTableSourceType,
  LogsSynchronousSinkType,
  SpansSynchronousSinkType,
  TracesIcebergTableSourceType,
  type SchemaCreateJob,
  type SchemaEventPredicate,
  type SchemaGreprRawLogsSource,
  type SchemaGreprRawSpanSource,
  type SchemaLogsIcebergTableSource,
  type SchemaOperation,
  type SchemaSpansSynchronousSink,
  type SchemaTracesIcebergTableSource
} from '../openapi/openApiTypes.js';
import {
  buildLanguageQueryPredicate,
  buildMessageLengthPredicate,
  buildSignalPredicate,
  buildSourcePredicate,
  deriveSpanQueryFilters,
  warnOnUnliftedSpanQuery,
  type BuiltSignalPredicate
} from '../lib/query-predicate.js';
import {
  parseSignalDataType,
  resolveSignalSource,
  validateSignalSourceInputs,
  type ResolvedSignalSource
} from '../lib/signal-source.js';

export {
  buildLanguageQueryPredicate,
  buildMessageLengthPredicate,
  buildSignalPredicate,
  buildSourcePredicate
};

export function validateQueryOptions(options: QueryCommandOptions): void {
  validateSignalSourceInputs(options);
  validateOptionalTimestampRange(options);

  if (options.dataType) {
    buildSignalPredicate({
      ...options,
      dataType: options.dataType
    });
  }
}

export function buildQueryJobDefinition(
  options: QueryCommandOptions,
  resolved: ResolvedSignalSource,
  now = new Date()
): SchemaCreateJob {
  const predicate = buildSignalPredicate({
    ...options,
    dataType: resolved.dataType
  });
  const common: QuerySourceCommonFields = {
    name: 'source',
    datasetId: resolved.datasetId,
    start: options.start ?? new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    end: options.end ?? now.toISOString(),
    sortOrder: options.sortOrder ?? GreprLlmPromptResultsSourceSortOrder.UNSORTED,
    limit: options.limit ?? 100
  };

  const vertices: SchemaOperation[] = predicate.dataType === CreateLogsBackfillJobDataType.logs
    ? buildLogsQueryVertices(options, common, predicate.query)
    : buildSpansQueryVertices(options, common, predicate);

  return {
    name: `query_tool_job_${now.getTime()}`,
    execution: JobExecution.SYNCHRONOUS,
    processing: JobProcessing.BATCH,
    jobGraph: {
      vertices,
      edges: ['source -> sink']
    },
    tags: {},
    teamIds: resolved.teamIds
  };
}

interface QuerySourceCommonFields {
  name: string;
  datasetId: string;
  start: string;
  end: string;
  sortOrder: GreprLlmPromptResultsSourceSortOrder;
  limit: number;
}

function buildLogsQueryVertices(
  options: QueryCommandOptions,
  common: QuerySourceCommonFields,
  query: SchemaEventPredicate
): SchemaOperation[] {
  const source: SchemaGreprRawLogsSource | SchemaLogsIcebergTableSource = {
    ...common,
    type: options.queryEngine === 'flink'
      ? LogsIcebergTableSourceType.logs_iceberg_table_source
      : GreprRawLogsSourceType.grepr_raw_log_source,
    query
  };
  return [
    source,
    {
      type: LogsSynchronousSinkType.logs_sync_sink,
      name: 'sink'
    }
  ];
}

function buildSpansQueryVertices(
  options: QueryCommandOptions,
  common: QuerySourceCommonFields,
  predicate: Extract<
    BuiltSignalPredicate,
    { dataType: CreateSpansBackfillJobDataType.spans }
  >
): SchemaOperation[] {
  const sourceFields = {
    ...common,
    query: predicate.query,
    ...deriveSpanQueryFilters(options.query ?? '')
  };
  const source: SchemaGreprRawSpanSource | SchemaTracesIcebergTableSource =
    options.queryEngine === 'flink'
      ? {
          ...sourceFields,
          type: TracesIcebergTableSourceType.traces_iceberg_table_source
        }
      : {
          ...sourceFields,
          type: GreprRawSpanSourceType.grepr_raw_span_source
        };
  const sink: SchemaSpansSynchronousSink = {
    type: SpansSynchronousSinkType.spans_sync_sink,
    name: 'sink'
  };

  return [source, sink];
}

export class QueryCommand extends BaseCommand<QueryCommandOptions> implements ICommand {
  getCommandName(): string {
    return 'query';
  }

  getCommandDescription(): string {
    return 'Execute a logs or spans query against a dataset';
  }

  getCommandOptions(): CommandOption[] {
    return [
      {
        flags: '--job-id <id>',
        description: 'Source pipeline/job ID'
      },
      {
        flags: '--dataset-id <id>',
        description: 'Dataset ID to query'
      },
      {
        flags: '--dataset-name <name>',
        description: 'Dataset name to query (will be resolved to ID)'
      },
      {
        flags: '--data-type <type>',
        description: 'Data type (logs or spans; defaults to logs unless inferred from --job-id)',
        parser: parseSignalDataType
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
        description: 'Inclusive minimum message length in characters (logs only)',
        parser: parseIntArg
      },
      {
        flags: '--message-length-max <number>',
        description: 'Inclusive maximum message length in characters (logs only)',
        parser: parseIntArg
      }
    ];
  }

  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    let command = program.command(this.getCommandName())
      .description(this.getCommandDescription());

    this.getCommandOptions().forEach(option => {
      if (option.parser && option.defaultValue !== undefined) {
        command = command.option(
          option.flags,
          option.description,
          option.parser,
          option.defaultValue as string | boolean
        );
      } else if (option.parser) {
        command = command.option(option.flags, option.description, option.parser);
      } else if (option.defaultValue !== undefined) {
        command = command.option(
          option.flags,
          option.description,
          option.defaultValue as string | boolean | string[]
        );
      } else {
        command = command.option(option.flags, option.description);
      }
    });

    command
      .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'table')
      .option('-s, --sort <column:order>', 'Sort table by column (e.g., "eventTimestamp:asc")', 'eventTimestamp:asc')
      .option('--no-color', 'Disable colored output')
      .option('--no-timestamps', 'Hide timestamps')
      .option('--no-job-state', 'Hide job state messages')
      .option('--max-lines <number>', 'Maximum lines per table cell', parseIntArg, 4)
      .action(async (options: Record<string, string | boolean | number>, actionCommand: Command) => {
        try {
          const globalOptions = actionCommand.parent?.opts() ?? {};
          const mergedOptions: QueryCommandOptions = {
            ...await mergeConfiguration(globalOptions),
            ...options
          } as QueryCommandOptions;
          await this.execute(mergedOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Fatal error:', message);
          process.exit(1);
        }
      });
  }

  async execute(options: QueryCommandOptions): Promise<void> {
    try {
      validateQueryOptions(options);
      const resolved = await resolveSignalSource(
        options,
        createApiClient(options),
        { includeTeamIds: false }
      );
      const jobDefinition = buildQueryJobDefinition(options, resolved);
      if (resolved.dataType === CreateSpansBackfillJobDataType.spans) {
        warnOnUnliftedSpanQuery(options.query ?? '');
      }
      if (!options.quiet && !options.datasetId) {
        console.log(`Querying ${resolved.dataType} dataset ${resolved.datasetId}`);
      }
      await this.processJobStream(jobDefinition, options);
    } catch (error) {
      this.handleError(error, 'Query initialization error');
    }
  }
}
