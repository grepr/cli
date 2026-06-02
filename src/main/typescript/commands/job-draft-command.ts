/**
 * Run a plan, or a live job via `--job-id`, in draft mode and stream NDJSON.
 *
 * Draft runs do not update the production pipeline.
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import { Writable } from 'stream';
import { ICommand } from '@/lib/command-registry';
import { MergeConfiguration, JobDraftCommandOptions, STREAM_EVENTS, LogEventData } from '@/types';
import { NDJsonStreamParser } from '@/lib/parser.js';
import { createApiClient } from '@/lib/api-client-factory.js';
import { generatePlan, JobPlan, loadPlanFromFile } from '@/lib/job-plan.js';
import {
  draftVerificationLimitations,
  findTemplateOperation,
} from '@/lib/job-patch.js';
import {
  DraftSamplerOptions,
  transformJobGraphToSourcePreservingDraft,
} from '@/lib/job-graph-transformer.js';
import { SchemaCreateJob, SchemaUpdateJob } from '@/openapi/openApiTypes';
import { JobExecution, JobProcessing } from '@/types';
import { parseFloatArg, parseIntArg } from '@/lib/option-parsers.js';

export class JobDraftCommand implements ICommand {
  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command('job:draft [plan-file]')
      .description('Run a plan (or a live pipeline as-is via --job-id) in draft mode and stream NDJSON output')
      .option('--job-id <id>', 'Draft the live pipeline as-is, no edits (instead of a plan file)')
      // Job-graph-only flags tuning the logs-event-sampler inserted after each live
      // source; rejected on template plans (sampling/duration are server-side there).
      .option('--sample-rate <n>', 'Sampler max allowed rate in messages/sec for the live draft (job-graph plans only)', parseFloatArg)
      .option('--sample-burst <n>', 'Sampler max burst limit in messages for the live draft (job-graph plans only)', parseIntArg)
      .option('--max-duration-seconds <n>', 'Stop the live draft after N seconds (job-graph plans only)', parseIntArg)
      .action(async (planFile: string | undefined, options: JobDraftCommandOptions, command: Command) => {
        try {
          const merged = { ...command.parent?.opts(), ...options } as Record<string, string | boolean | number | string[]>;
          const cliOptions = await mergeConfiguration(merged);

          if (planFile && options.jobId) {
            throw new Error('Pass either a plan file or --job-id, not both');
          }
          if (!planFile && !options.jobId) {
            throw new Error('Pass a plan file, or --job-id to draft the live pipeline as-is');
          }

          const apiClient = createApiClient(cliOptions);

          const plan = planFile
            ? await loadPlanFromFile(planFile)
            : await generatePlan(apiClient, options.jobId as string, { operations: [] });

          rejectSamplerFlagsOnTemplate(plan, options);

          const limitations = draftVerificationLimitations(plan.patch);

          // Template drafts use server-side draftMode; raw job graphs are rewritten
          // locally to keep live sources, with a logs-event-sampler per source.
          const draftJob = plan.backend === 'template'
            ? makeTemplateDraftJob(plan.proposed, plan.current.processing as JobProcessing | undefined)
            : makeJobGraphDraftJob(plan, options);

          if (!cliOptions.quiet) {
            const note = plan.backend === 'job-graph'
              ? ' (job-graph source-preserving live draft — external sink delivery is not verified)'
              : '';
            console.error(
              `Submitting draft pipeline run (jobId ${plan.jobId}, baseVersion ${plan.baseVersion})${note}…`,
            );
            for (const limitation of limitations) {
              console.error(`Draft verification limitation: ${limitation}`);
            }
          }

          // A live source-preserving draft on a STREAMING pipeline never ends on
          // its own; --max-duration-seconds aborts the stream after the cap.
          const durationCap = resolveMaxDurationSeconds(options);
          const controller = durationCap !== undefined ? new AbortController() : undefined;
          const durationTimer = durationCap !== undefined && controller
            ? setTimeout(() => controller.abort(), durationCap * 1000)
            : undefined;
          durationTimer?.unref?.();

          // The sync endpoint streams HEARTBEAT tokens that the client must echo
          // back to /v1/jobs/sync/heartbeat, or the server's watchdog cancels the
          // job (~20s). Stay alive by replying to each token; a failed reply isn't
          // fatal — the next heartbeat retries and a real stall surfaces as CANCELLED.
          const respondToHeartbeat = (token: string): void => {
            if (!token) return;
            void apiClient.sendHeartbeat(token).catch((heartbeatError: unknown) => {
              if (!cliOptions.quiet) {
                console.error(`Heartbeat reply failed: ${(heartbeatError as Error).message}`);
              }
            });
          };

          let failure: DraftRunFailure | null;
          try {
            const stream = await apiClient.submitSyncJob(draftJob, controller?.signal);
            // Route high-volume NDJSON to `--output` when provided.
            failure = await streamToDestination(stream, cliOptions.output, respondToHeartbeat);
          } finally {
            if (durationTimer) clearTimeout(durationTimer);
          }

          if (controller?.signal.aborted && !cliOptions.quiet) {
            console.error(`Draft run stopped after the ${durationCap}s max-duration cap.`);
          }

          if (cliOptions.output && !cliOptions.quiet && !failure) {
            console.error(`Draft output written to ${cliOptions.output}`);
          }

          // The draft run can fail server-side while the stream completes
          // cleanly; surface that as a non-zero exit so scripts keying off the
          // exit code don't read a failed preview as success.
          if (failure) {
            throw new Error(
              `Draft run ended in terminal state ${failure.state}` +
                (failure.message ? `: ${failure.message}` : ''),
            );
          }
        } catch (error) {
          console.error('Error running draft pipeline:', (error as Error).message);
          process.exit(1);
        }
      });
  }
}

/** Terminal non-success jobStates a draft run can end in. */
type TerminalFailureState = 'FAILED' | 'TIMED_OUT' | 'CANCELLED';

/** A terminal non-success jobState seen in the draft stream. */
interface DraftRunFailure {
  state: TerminalFailureState;
  message?: string;
}

/**
 * Pipe the API's NDJSON response to a file (`--output`) or stdout while scanning
 * it for a terminal non-success jobState. Returns the first such failure if the
 * draft run failed server-side, else null — the caller exits non-zero so a
 * failed preview isn't reported (and read by scripts) as success.
 *
 * `onHeartbeat` is invoked for every HEARTBEAT token in the stream; the caller
 * must echo it back to keep the sync job alive (else the server cancels it).
 */
async function streamToDestination(
  source: NodeJS.ReadableStream,
  outputPath: string | undefined,
  onHeartbeat: (token: string) => void,
): Promise<DraftRunFailure | null> {
  const parser = new NDJsonStreamParser();
  let failure: DraftRunFailure | null = null;
  // Record the first terminal failure; subsequent records don't override it.
  function recordFailure(state: TerminalFailureState, data?: LogEventData): void {
    if (!failure) failure = { state, message: data?.message };
  }
  parser.on(STREAM_EVENTS.HEARTBEAT_REQUEST, (token: string) => onHeartbeat(token));
  parser.on(STREAM_EVENTS.FAILED, (data?: LogEventData) => recordFailure('FAILED', data));
  parser.on(STREAM_EVENTS.CANCELLED, (data?: LogEventData) => recordFailure('CANCELLED', data));
  parser.on(STREAM_EVENTS.TIMED_OUT, (data?: LogEventData) => recordFailure('TIMED_OUT', data));
  source.on('data', (chunk: Buffer) => parser.processChunk(chunk));

  await new Promise<void>((resolve, reject) => {
    source.once('error', reject);
    if (outputPath) {
      const fileStream = fs.createWriteStream(outputPath);
      fileStream.once('error', reject);
      fileStream.once('finish', resolve);
      source.pipe(fileStream as Writable);
    } else {
      source.once('end', resolve);
      source.pipe(process.stdout, { end: false });
    }
  });
  parser.finalize();
  return failure;
}

/** Shared draft-submission skeleton: synchronous, one-off name. */
function makeDraftJobSkeleton(jobGraph: SchemaUpdateJob['jobGraph'], processing: JobProcessing): SchemaCreateJob {
  return {
    name: `draft_pipeline_${Date.now()}`,
    execution: JobExecution.SYNCHRONOUS,
    processing,
    jobGraph,
  } as unknown as SchemaCreateJob;
}

/** Enable server-side draftMode on a template-backed proposed job. */
function makeTemplateDraftJob(
  proposed: SchemaUpdateJob,
  processing: JobProcessing = JobProcessing.STREAMING,
): SchemaCreateJob {
  const cloned = structuredClone(proposed);
  const templateOp = findTemplateOperation(cloned);
  templateOp.draftMode = true;
  return makeDraftJobSkeleton(cloned.jobGraph, processing);
}

/**
 * Build a job-graph (raw, non-templated) draft: keep the live sources, insert a
 * logs-event-sampler after each, and fan output into a sync sink. This mirrors
 * the UI's template draft mode rather than replaying the raw data lake.
 */
function makeJobGraphDraftJob(
  plan: JobPlan,
  options: JobDraftCommandOptions,
): SchemaCreateJob {
  const processing = (plan.current.processing as JobProcessing | undefined) ?? JobProcessing.STREAMING;
  const sourceJob = makeDraftJobSkeleton(structuredClone(plan.proposed.jobGraph), processing);
  return transformJobGraphToSourcePreservingDraft(sourceJob, {
    processing,
    testName: sourceJob.name,
    testTag: plan.patch.operations.map(op => op.op).join(','),
    sampler: resolveSamplerOptions(options),
  });
}

/** Map the `--sample-rate`/`--sample-burst` flags to sampler options; omitted fields keep the UI defaults. */
function resolveSamplerOptions(options: JobDraftCommandOptions): DraftSamplerOptions {
  const sampler: DraftSamplerOptions = {};
  if (options.sampleRate !== undefined) sampler.maxAllowedRate = options.sampleRate;
  if (options.sampleBurst !== undefined) sampler.maxBurstLimit = options.sampleBurst;
  return sampler;
}

/** Normalize `--max-duration-seconds`: undefined when unset, else a validated positive integer. */
function resolveMaxDurationSeconds(options: JobDraftCommandOptions): number | undefined {
  const value = options.maxDurationSeconds;
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('--max-duration-seconds must be a positive number of seconds.');
  }
  return value;
}

/** The sampler/duration flags only apply to raw job-graph drafts; reject them on template plans rather than ignoring them. */
function rejectSamplerFlagsOnTemplate(plan: JobPlan, options: JobDraftCommandOptions): void {
  if (plan.backend !== 'template') return;
  const jobGraphOnlyFlags = [
    ['--sample-rate', options.sampleRate],
    ['--sample-burst', options.sampleBurst],
    ['--max-duration-seconds', options.maxDurationSeconds],
  ].filter(([, value]) => value !== undefined);
  if (jobGraphOnlyFlags.length > 0) {
    throw new Error(
      `Template-backed plans manage sampling and duration server-side; ` +
        `do not pass job-graph-only flags (${jobGraphOnlyFlags.map(([flag]) => flag).join(', ')}).`,
    );
  }
}
