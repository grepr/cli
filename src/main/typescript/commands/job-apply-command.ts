/**
 * Apply a generated plan to a live job.
 *
 * Checks drift locally and through the API's `fromVersion` guard; transient
 * failures are retried with backoff.
 */
import { Command } from 'commander';
import { ICommand } from '@/lib/command-registry';
import { MergeConfiguration, JobApplyCommandOptions } from '@/types';
import { createApiClient } from '@/lib/api-client-factory.js';
import { ApiError, GreprApiClient } from '@/lib/grepr-api-client.js';
import { loadPlanFromFile, JobPlan } from '@/lib/job-plan.js';
import { SchemaReadJob, SchemaUpdateJob } from '@/openapi/openApiTypes';

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
/** Transient HTTP statuses worth retrying (besides 409, handled specially). */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

export class JobApplyCommand implements ICommand {
  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command('job:apply <plan-file>')
      .description('Apply a generated plan file to the live pipeline')
      .option('--force', 'Apply even if the live job has changed since the plan was generated')
      .option('--rollback-enabled', 'Enable automatic rollback if the apply fails (default)')
      .option('--no-rollback-enabled', 'Disable automatic rollback if the apply fails')
      .action(async (planFile: string, options: JobApplyCommandOptions, command: Command) => {
        try {
          const merged = { ...command.parent?.opts(), ...options } as Record<string, string | boolean | number | string[]>;
          const cliOptions = await mergeConfiguration(merged);
          const apiClient = createApiClient(cliOptions);

          const plan = await loadPlanFromFile(planFile);

          await this.checkDrift(apiClient, plan, options.force ?? false);
          await apply(apiClient, plan.jobId, plan.proposed, options.rollbackEnabled);

          if (!cliOptions.quiet) {
            console.log(`Applied ${plan.diff.length} change(s) to job ${plan.jobId}`);
          }
        } catch (error) {
          console.error('Error applying pipeline plan:', (error as Error).message);
          process.exit(1);
        }
      });
  }

  private async checkDrift(apiClient: GreprApiClient, plan: JobPlan, force: boolean): Promise<void> {
    const live = await apiClient.getJob(plan.jobId, undefined, false);
    if (!live) {
      throw new Error(`Job not found: ${plan.jobId}`);
    }
    if (live.version === plan.baseVersion) return;
    if (!force) {
      throw new Error(
        `Drift detected: plan was generated against version ${plan.baseVersion}, live job is at version ${live.version}. ` +
          `Re-run job:plan to regenerate the plan, or pass --force to override.`,
      );
    }
    // --force accepts overwriting the current live version, so update the API guard.
    plan.proposed.fromVersion = live.version;
  }
}

/**
 * PUT the proposed job, retrying transient failures and rechecking drift after conflicts.
 * rollbackEnabled is forwarded to the API; when undefined the client defaults it to on.
 */
export async function apply(
  apiClient: GreprApiClient,
  jobId: string,
  proposed: SchemaUpdateJob,
  rollbackEnabled?: boolean,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await apiClient.updateJob(jobId, proposed, rollbackEnabled);
      return;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      const isConflict = status === 409;
      if (!isConflict && !(status !== undefined && RETRYABLE_STATUSES.has(status))) {
        throw error;
      }
      if (isConflict) {
        // 409: re-fetch to classify. A deleted job or a moved live version is
        // fatal drift (throw, even on the last attempt); an unchanged version
        // means a deploy is in flight, so fall through and retry.
        let live: SchemaReadJob | undefined;
        try {
          live = await apiClient.getJob(jobId, undefined, false);
        } catch (recheckError) {
          // The classification fetch itself failed — likely the same mid-deploy
          // turbulence that caused the 409. Don't abort the apply on it; retry
          // until the budget runs out, then surface it.
          if (attempt === MAX_RETRIES) throw recheckError;
          await delay(retryDelayMs(attempt, error));
          continue;
        }
        if (!live) {
          throw new Error(
            `Job ${jobId} not found during apply — it may have been deleted. Re-run job:plan to regenerate the plan.`,
          );
        }
        if (live.version !== proposed.fromVersion) {
          throw new Error(
            `Server reported drift during apply: expected version ${proposed.fromVersion}, live is ${live.version}. ` +
              `Re-run job:plan to regenerate the plan.`,
          );
        }
      }
      if (attempt === MAX_RETRIES) {
        throw new Error(
          `Update failed after ${MAX_RETRIES} retries (last error: HTTP ${status}). ` +
            `The pipeline may be mid-deploy or the server unhealthy; check pipeline status manually.`,
        );
      }
      await delay(retryDelayMs(attempt, error));
    }
  }
}

/** Honor a server `Retry-After` when present, else exponential backoff (1s, 2s, 4s). */
function retryDelayMs(attempt: number, error: unknown): number {
  if (error instanceof ApiError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs;
  }
  return BASE_BACKOFF_MS * 2 ** attempt;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
