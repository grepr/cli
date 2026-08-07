import type { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { ICommand } from '../lib/command-registry.js';
import { createApiClient } from '../lib/api-client-factory.js';
import {
  buildBackfillRequest,
  resolveBackfillInputs
} from '../lib/backfill.js';
import type { BackfillCommandInputs } from '../lib/backfill.js';
import { buildBackfillGreprUrl } from '../lib/backfill-grepr-link.js';
import { buildBackfillVendorLinks } from '../lib/backfill-vendor-links.js';
import type { CliOptions, MergeConfiguration } from '../types.js';
import type { SchemaCreateLogsBackfillJob, SchemaReadJob } from '../openapi/openApiTypes.js';

interface BackfillCommandOptions extends CliOptions, BackfillCommandInputs {
  dryRun?: boolean;
  output?: string;
}

interface CommanderBackfillCommandOptions extends Partial<BackfillCommandOptions> {
  sinkId?: string[];
  tag?: string[];
}

function normalizeBackfillOptions(options: CommanderBackfillCommandOptions): Partial<BackfillCommandOptions> {
  return {
    ...options,
    sinkIds: options.sinkIds ?? options.sinkId,
    tags: options.tags ?? options.tag
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
    return 'Create a manual logs backfill job';
  }

  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command(this.getCommandName())
      .description(this.getCommandDescription())
      .option('--job-id <id>', 'Source pipeline/job ID')
      .option('--dataset-id <id>', 'Raw logs dataset ID')
      .option('--dataset-name <name>', 'Raw logs dataset name')
      .option('--sink-id <ids...>', 'Destination observability integration IDs')
      .option('--start <timestamp>', 'Backfill start timestamp (ISO 8601)')
      .option('--end <timestamp>', 'Backfill end timestamp (ISO 8601)')
      .option('--query <query>', 'Log query string', '')
      .option('--query-type <type>', 'Query type', 'datadog-query')
      .option('--limit <number>', 'Maximum number of records to backfill (-1 for no limit)', parseBackfillLimitArg, 10000)
      .option('--tag <key:value...>', 'Vendor-visible tags or attributes')
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
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage);
          process.exit(1);
        }
      });
  }

  async execute(options: BackfillCommandOptions): Promise<void> {
    const apiClient = createApiClient(options);
    const resolved = await resolveBackfillInputs(options, apiClient);
    const request = buildBackfillRequest(options, resolved);

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
      throw new Error('Backfill job creation returned no job');
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Backfill job ${createdJob.id ?? '<unknown id>'} was created, but writing output to ${outputPath} failed: ${errorMessage}`);
      }
      throw error;
    }
  }

  private async outputJson(
    data: SchemaCreateLogsBackfillJob | SchemaReadJob,
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
