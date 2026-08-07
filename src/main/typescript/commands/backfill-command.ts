import type { Command } from 'commander';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { ICommand } from '../lib/command-registry.js';
import { createApiClient } from '../lib/api-client-factory.js';
import {
  buildBackfillRequest,
  resolveBackfillInputs,
  validateSpansSqlOperation
} from '../lib/backfill.js';
import type { BackfillCommandInputs } from '../lib/backfill.js';
import { buildBackfillGreprUrl } from '../lib/backfill-grepr-link.js';
import { buildBackfillVendorLinks } from '../lib/backfill-vendor-links.js';
import type { CliOptions, MergeConfiguration } from '../types.js';
import type {
  SchemaCreateBackfillJob,
  SchemaReadJob,
  SchemaSqlOperation
} from '../openapi/openApiTypes.js';
import { parseSignalDataType } from '../lib/signal-source.js';

interface BackfillCommandOptions extends CliOptions, BackfillCommandInputs {
  dryRun?: boolean;
  output?: string;
  sqlOperationPath?: string;
}

interface CommanderBackfillCommandOptions
  extends Omit<Partial<BackfillCommandOptions>, 'sqlOperation'> {
  sinkId?: string[];
  tag?: string[];
  sqlOperation?: string;
}

function normalizeBackfillOptions(options: CommanderBackfillCommandOptions): Partial<BackfillCommandOptions> {
  const { sqlOperation, ...rest } = options;
  return {
    ...rest,
    sinkIds: options.sinkIds ?? options.sinkId,
    tags: options.tags ?? options.tag,
    sqlOperationPath: sqlOperation
  };
}

function parseBackfillLimitArg(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error('--limit must be an integer greater than or equal to -1');
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) {
    throw new Error('--limit must be an integer greater than or equal to -1');
  }
  return limit;
}

export class BackfillCommand implements ICommand {
  getCommandName(): string {
    return 'backfill';
  }

  getCommandDescription(): string {
    return 'Create a manual logs or spans backfill job';
  }

  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command(this.getCommandName())
      .description(this.getCommandDescription())
      .option('--job-id <id>', 'Source pipeline/job ID')
      .option('--dataset-id <id>', 'Raw dataset ID')
      .option('--dataset-name <name>', 'Raw dataset name')
      .option(
        '--data-type <type>',
        'Data type (logs or spans; explicit datasets default to logs)',
        parseSignalDataType
      )
      .option('--sink-id <ids...>', 'Destination observability integration IDs')
      .option('--start <timestamp>', 'Backfill start timestamp (ISO 8601)')
      .option('--end <timestamp>', 'Backfill end timestamp (ISO 8601)')
      .option('--query <query>', 'Query string', '')
      .option('--query-type <type>', 'Query type', 'datadog-query')
      .option(
        '--limit <number>',
        'Maximum records to backfill (per vendor source for spans; -1 for no limit)',
        parseBackfillLimitArg,
        10000
      )
      .option('--tag <key:value...>', 'Vendor-visible tags or attributes')
      .option('--sql-operation <file>', 'Span SQL operation JSON file')
      .option('--preserve-sql', 'Preserve post-reducer SQL from a source trace pipeline')
      .option('--dry-run', 'Print the generated job JSON and do not submit')
      .option('--output <file>', 'Write dry-run JSON or created job response')
      .action(async (options: Record<string, string | boolean | number | string[]>, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          await this.execute({
            ...mergedGlobalOptions,
            ...normalizeBackfillOptions(options as CommanderBackfillCommandOptions)
          } as BackfillCommandOptions);
        } catch (error) {
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage(error));
          process.exit(1);
        }
      });
  }

  async execute(options: BackfillCommandOptions): Promise<void> {
    const apiClient = createApiClient(options);
    const inputs: BackfillCommandInputs = {
      ...options,
      ...(options.sqlOperationPath
        ? { sqlOperation: await loadSqlOperation(options.sqlOperationPath) }
        : {})
    };
    const resolved = await resolveBackfillInputs(inputs, apiClient);
    const request = buildBackfillRequest(inputs, resolved);

    if (!options.quiet) {
      resolved.skippedSinks.forEach(({ sink, reason }) => {
        console.warn(`Warning: Skipping ${sink.name} (${sink.id}): ${reason}.`);
      });
    }

    if (options.limit === -1 && !options.quiet) {
      console.warn('Warning: --limit -1 means no limit and may be expensive.');
    }

    if (options.dryRun) {
      await this.outputJson(request, options);
      return;
    }

    const createdJob = await apiClient.createBackfillJob(request);
    if (!createdJob) {
      throw new Error(
        'The backfill request succeeded but returned no job. The backfill may be running: ' +
        'check `grepr job:list` before retrying, to avoid submitting it twice.'
      );
    }
    try {
      const vendorLinks = buildBackfillVendorLinks(request, resolved.sinks);
      const greprUrl = buildBackfillGreprUrl(
        createdJob,
        options.apiBaseUrl,
        options.orgName
      );
      const outputJob: SchemaReadJob & {
        vendorLinks: typeof vendorLinks;
        greprUrl?: string;
      } = {
        ...createdJob,
        vendorLinks,
        ...(greprUrl ? { greprUrl } : {})
      };
      await this.outputJson(outputJob, options);
    } catch (error) {
      const outputPath = options.output;
      if (outputPath) {
        throw new Error(
          `Backfill job ${createdJob.id ?? '<unknown id>'} was created, but writing output ` +
          `to ${outputPath} failed: ${errorMessage(error)}`
        );
      }
      throw error;
    }
  }

  private async outputJson(
    data: SchemaCreateBackfillJob | SchemaReadJob,
    options: BackfillCommandOptions
  ): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, json);
      if (!options.quiet) {
        console.log(`Output written to ${options.output}`);
      }
      return;
    }
    console.log(json);
  }
}

async function loadSqlOperation(path: string): Promise<SchemaSqlOperation> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Could not read --sql-operation ${path}: ${errorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in --sql-operation ${path}: ${errorMessage(error)}`);
  }

  validateSpansSqlOperation(parsed);
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
