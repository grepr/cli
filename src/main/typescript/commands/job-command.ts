import { Command } from 'commander';
import { ListCommand, ListCommandOptions } from './list-command.js';
import { CrudCommand, CrudCommandOptions, CrudCreateUpdateOptions } from './crud-command.js';
import { parseSinceOption } from '../lib/time-utils.js';
import { StreamingJobExecutor } from '../lib/streaming-job-executor.js';
import { logHumanFooter } from '../lib/output-format.js';
import { parseIntArg } from '../lib/option-parsers.js';
import fs from 'fs-extra';
import { FormattableCommandOptions, CommandOption, MergeConfiguration, CommandOptionsRecord, JobExecution, JobProcessing, JobState } from '../types.js';
import { SchemaCreateJob, SchemaUpdateJob } from '../openapi/openApiTypes.js';

// Job-specific interfaces extending the base interfaces
export interface JobListCommandOptions extends ListCommandOptions {
  since?: string;
  processing?: JobProcessing;
  allVersions?: boolean;
  state?: JobState[];
  name?: string[];
  id?: string[];
  resolved?: boolean;
  all?: boolean;
}

export interface JobCrudCommandOptions extends CrudCommandOptions {
  forVersion?: number;
  resolved?: boolean;
}

export interface JobCreateUpdateOptions extends CrudCreateUpdateOptions {
  rollbackEnabled?: boolean;
}

/**
 * Job list command implementation using the new architecture
 * Shows smart defaults: PENDING + RUNNING + FINISHED jobs since 6 hours ago
 */
export class JobListCommand extends ListCommand<JobListCommandOptions> {
  getCommandName(): string {
    return 'job:list';
  }

  getCommandDescription(): string {
    return 'List jobs with optional filtering (defaults: PENDING + RUNNING + FINISHED since 6h ago)';
  }

  getCommandOptions(): CommandOption[] {
    return [
      {
        flags: '--since <time>',
        description: 'Filter to jobs that are still running or ended after this time (ISO 8601 timestamp or duration like PT5H, PT1D). Defaults to PT6H unless --all is set.'
      },
      {
        flags: '--processing <type>',
        description: 'Filter by processing type (BATCH, STREAMING)'
      },
      {
        flags: '--all-versions',
        description: 'Show all versions instead of only latest',
        defaultValue: false
      },
      {
        flags: '--state <states...>',
        description: 'Filter by job states (CREATED, PENDING, RUNNING, etc.). Defaults to PENDING,RUNNING,FINISHED unless --all is set.'
      },
      {
        flags: '--name <names...>',
        description: 'Filter by job names'
      },
      {
        flags: '--id <ids...>',
        description: 'Filter by job IDs'
      },
      {
        flags: '--resolved',
        description: 'Include resolved job definitions'
      },
      {
        flags: '--all',
        description: 'Show all jobs (overrides default state and time filtering)'
      }
    ];
  }

  async executeList(options: JobListCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      // Apply smart defaults unless --all is specified
      const params = this.buildJobListParams(options);

      const jobs = await this.apiClient.listJobs(Object.keys(params).length > 0 ? params : undefined);
      const jobList = jobs?.items || [];

      await this.formatAndOutput(jobList, options, 'jobs');
      this.showQuerySummary(options, jobList.length);

    } catch (error) {
      console.error('Error listing jobs:', (error as Error).message);
      process.exit(1);
    }
  }

  private buildJobListParams(options: JobListCommandOptions): Record<string, string | JobState[] | number | string[] | boolean> {
    const params: Record<string, string | JobState[] | number | string[] | boolean> = {};

    // Without --all, fall back to common "what's happening recently" filters.
    // With --all, no state/since filter is applied unless the user provides one explicitly.
    const effectiveState = options.state ?? (options.all ? undefined : ['PENDING', 'RUNNING', 'FINISHED']);
    const effectiveSince = options.since ?? (options.all ? undefined : 'PT6H');

    if (effectiveSince) params.since = parseSinceOption(effectiveSince);
    if (options.processing) params.processing = options.processing;
    if (options.allVersions !== undefined) params.latest = !options.allVersions;
    if (effectiveState && effectiveState.length > 0) params.state = effectiveState;
    if (options.name && options.name.length > 0) params.name = options.name;
    if (options.id && options.id.length > 0) params.id = options.id;

    return params;
  }


  /**
   * Override query summary to show job-specific filters
   */
  protected generateQuerySummary(options: JobListCommandOptions, resultCount: number): string {
    const filters: string[] = [];

    if (options.state) filters.push(`state=${options.state.join(',')}`);
    if (options.since) filters.push(`since=${options.since}`);
    if (options.processing) filters.push(`processing=${options.processing}`);
    filters.push(`allVersions=${!!options.allVersions}`);
    if (options.name) filters.push(`name=${options.name.join(',')}`);
    if (options.sort) filters.push(`sort=${options.sort}`);

    const filterStr = filters.length > 0 ? filters.join(', ') : 'defaults (PENDING,RUNNING,FINISHED since 6h)';

    return [
      '',
      'Query Summary:',
      `- Filters: ${filterStr}`,
      `- Results: ${resultCount} jobs found`
    ].join('\n');
  }
}

/**
 * Job CRUD command implementation using the new architecture
 */
export class JobCrudCommand extends CrudCommand<JobCrudCommandOptions> {
  private streamingExecutor: StreamingJobExecutor;

  constructor() {
    super();
    this.streamingExecutor = new StreamingJobExecutor();
  }

  getCommandPrefix(): string {
    return 'job';
  }

  getResourceName(): string {
    return 'job';
  }

  // job:create has extra streaming-format options (table format, --no-color,
  // --no-timestamps, etc.) because sync jobs stream results back. We register
  // our own create command in addToProgram below; signal to the parent to skip
  // its default registration so :create isn't listed twice.
  protected hasCustomCreate(): boolean {
    return true;
  }

  protected getGetOptions(): CommandOption[] {
    return [
      {
        flags: '--for-version <number>',
        description: 'Get specific version',
        parser: parseIntArg
      },
      {
        flags: '--resolved',
        description: 'Include resolved job definition'
      }
    ];
  }

  protected getUpdateOptions(): CommandOption[] {
    return [
      {
        flags: '--rollback-enabled',
        description: 'Enable rollback capability'
      }
    ];
  }

  async executeGet(jobId: string, options: JobCrudCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const job = await this.apiClient.getJob(jobId, options.forVersion, options.resolved);

      if (!job) {
        console.error(`Job ${jobId} not found`);
        process.exit(1);
      }

      await this.formatAndOutputSingle(job as Record<string, unknown>, options);

      if (!options.quiet) {
        logHumanFooter(
          options.format,
          `\nJob Details:
- ID: ${job.id}
- Name: ${job.name}
- State: ${job.state}
- Version: ${job.version ?? 'latest'}`
        );
      }

    } catch (error) {
      console.error(`Error getting job ${jobId}:`, (error as Error).message);
      process.exit(1);
    }
  }

  async executeCreate(options: CrudCreateUpdateOptions): Promise<void> {
    try {
      // Load job definition to determine execution type
      const jobDefinition = await this.loadJobDefinition(options.resourceFile);

      // Route based on execution type
      if (jobDefinition.execution === JobExecution.SYNCHRONOUS) {
        await this.executeSynchronousJobCreate(jobDefinition, options);
      } else {
        await this.executeAsynchronousJobCreate(jobDefinition, options);
      }

    } catch (error) {
      console.error('Error creating job:', (error as Error).message);
      process.exit(1);
    }
  }

  private async executeSynchronousJobCreate(jobDefinition: SchemaCreateJob, options: CrudCreateUpdateOptions): Promise<void> {
    // Use the streaming job executor for synchronous jobs. CrudCreateUpdateOptions and
    // FormattableCommandOptions overlap structurally but live in different inheritance
    // trees (ApiClientFactoryOptions vs CliOptions), so the type system can't bridge
    // them statically. Validate at runtime that the auth fields the executor needs
    // were actually resolved by mergeConfiguration upstream, then pass through narrowed.
    if (!isFormattableJobCreateOptions(options)) {
      throw new Error('Internal: job create options missing required auth fields before sync execution');
    }
    await this.streamingExecutor.execute(jobDefinition, options);
  }

  private async executeAsynchronousJobCreate(jobDefinition: SchemaCreateJob, options: CrudCreateUpdateOptions): Promise<void> {
    this.apiClient = this.createApiClient(options);
    const createdJob = await this.apiClient.createAsyncJob(jobDefinition);

    if (createdJob) {
      this.showCreateSuccess(createdJob, options);
      await this.formatAndOutputSingle(createdJob, options);
    }
  }

  private async loadJobDefinition(jobFile: string): Promise<SchemaCreateJob> {
    try {
      if (!await fs.pathExists(jobFile)) {
        throw new Error(`Job definition file not found: ${jobFile}`);
      }

      const jobDefinition = await fs.readJson(jobFile);

      // Validate required fields
      if (!jobDefinition.name || !jobDefinition.execution || !jobDefinition.processing) {
        throw new Error('Invalid job definition: missing required fields (name, execution, processing)');
      }

      return jobDefinition;
    } catch (error) {
      throw new Error(`Failed to load job definition: ${(error as Error).message}`);
    }
  }

  async executeUpdate(jobId: string, options: JobCreateUpdateOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      const jobData = await this.loadResourceFromFile<SchemaUpdateJob>(options.resourceFile);
      const updatedJob = await this.apiClient.updateJob(jobId, jobData, options.rollbackEnabled);

      if (!updatedJob) {
        console.error(`Failed to update job ${jobId}`);
        process.exit(1);
      }

      this.showUpdateSuccess(jobId, options);
      await this.formatAndOutputSingle(updatedJob as Record<string, unknown>, options);

    } catch (error) {
      console.error(`Error updating job ${jobId}:`, (error as Error).message);
      process.exit(1);
    }
  }

  async executeDelete(jobId: string, options: JobCrudCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      await this.apiClient.deleteJob(jobId);

      this.showDeleteSuccess(jobId, options);

    } catch (error) {
      console.error(`Error deleting job ${jobId}:`, (error as Error).message);
      process.exit(1);
    }
  }

  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    const prefix = this.getCommandPrefix();
    const resourceName = this.getResourceName();

    // Create command with sync-specific formatting options (matching original sync command)
    if (this.supportsCreate()) {
      program
        .command(`${prefix}:create <${resourceName}-file>`)
        .description(`Create a new ${resourceName} from file`)
        .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'table')
        .option('-s, --sort <column:order>', 'Sort table by column (e.g., "eventTimestamp:asc")', 'eventTimestamp:asc')
        .option('--max-depth <number>', 'Maximum object nesting depth for table columns', parseIntArg, 1)
        .option('--max-lines <number>', 'Maximum lines per table cell', parseIntArg, 4)
        .option('--no-color', 'Disable colored output')
        .option('--no-timestamps', 'Hide timestamps')
        .option('--no-job-state', 'Hide job state messages')
        .action(async (resourceFile: string, options: CommandOptionsRecord, command: Command) => {
          try {
            const globalOptions = command.parent?.opts() || {};
            const mergedGlobalOptions = await mergeConfiguration(globalOptions);
            const mergedOptions = {
              ...mergedGlobalOptions,
              ...options,
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

    // Use parent's implementation for other CRUD operations (get, update, delete)
    super.addToProgram(program, mergeConfiguration);
  }

}

/**
 * Narrows CrudCreateUpdateOptions to the additional shape that StreamingJobExecutor
 * needs (FormattableCommandOptions). The two interfaces overlap at runtime once
 * mergeConfiguration has populated the auth fields, but TypeScript can't bridge
 * them statically because they sit in different inheritance trees. Checking the
 * specific fields the executor uses is enough — the union check on authMethod also
 * doubles as runtime validation that mergeConfiguration ran.
 */
function isFormattableJobCreateOptions(
  options: CrudCreateUpdateOptions
): options is CrudCreateUpdateOptions & FormattableCommandOptions {
  return typeof options.authBaseUrl === 'string' &&
    typeof options.clientId === 'string' &&
    (options.authMethod === 'oauth' || options.authMethod === 'client-credentials');
}

