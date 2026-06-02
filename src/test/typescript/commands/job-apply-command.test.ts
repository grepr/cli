import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { apply, JobApplyCommand } from '@/commands/job-apply-command.js';
import {
  PathsV1JobsGetParametersQueryState,
  SchemaReadJob,
  SchemaUpdateJob,
} from '@/openapi/openApiTypes.js';
import { ApiError, GreprApiClient } from '@/lib/grepr-api-client.js';

const fakeJob = (version: number): SchemaReadJob => ({
  id: 'job_1',
  name: 'p',
  organizationId: 'grepr',
  version,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
  state: PathsV1JobsGetParametersQueryState.RUNNING,
  execution: 'ASYNCHRONOUS',
  processing: 'STREAMING',
  tags: {},
  jobGraph: { vertices: [], edges: [] },
} as unknown as SchemaReadJob);

const fakeUpdate = (fromVersion: number): SchemaUpdateJob => ({
  desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
  fromVersion,
  jobGraph: { vertices: [], edges: [] },
} as unknown as SchemaUpdateJob);

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

async function writePlan(file: string, baseVersion: number, fromVersion = baseVersion): Promise<void> {
  await fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_1',
    backend: 'template',
    baseVersion,
    fetchedAt: '2026-01-01T00:00:00Z',
    classification: 'transform',
    patch: { operations: [{ op: 'add-message-attribute', attributePath: 'foo' }] },
    current: fakeJob(baseVersion),
    proposed: fakeUpdate(fromVersion),
    diff: [{ kind: 'add', path: 'x', summary: '+ x' }],
  });
}

describe('JobApplyCommand', () => {
  let tempDir: string;
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-apply-'));
    program = new Command();
    program.exitOverride();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('test_jobApply_versionMatches_callsUpdateJob', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writePlan(planFile, 5);
    const mockApi = {
      getJob: vi.fn().mockResolvedValue(fakeJob(5)),
      updateJob: vi.fn().mockResolvedValue(fakeJob(6)),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobApplyCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:apply', planFile]);

    expect(mockApi.updateJob).toHaveBeenCalledTimes(1);
  });

  it('test_jobApply_driftWithoutForce_refusesAndExits', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writePlan(planFile, 5);
    const mockApi = {
      getJob: vi.fn().mockResolvedValue(fakeJob(8)),
      updateJob: vi.fn(),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobApplyCommand().addToProgram(program, async opts => opts as never);
    await expect(program.parseAsync(['node', 'test', 'job:apply', planFile])).rejects.toThrow();

    expect(mockApi.updateJob).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error applying pipeline plan:',
      expect.stringContaining('Drift detected'),
    );
  });

  it('test_jobApply_driftWithForce_appliesAgainstNewVersion', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writePlan(planFile, 5);
    const mockApi = {
      getJob: vi.fn().mockResolvedValue(fakeJob(8)),
      updateJob: vi.fn().mockResolvedValue(fakeJob(9)),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobApplyCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:apply', planFile, '--force']);

    expect(mockApi.updateJob).toHaveBeenCalledTimes(1);
    const submitted = (mockApi.updateJob.mock.calls[0] as [string, SchemaUpdateJob])[1];
    expect(submitted.fromVersion).toBe(8);
  });
});

describe('apply', () => {
  it('test_apply_succeedsOnSecondTry_afterDeployInFlight409', async () => {
    let attempts = 0;
    const api = {
      getJob: vi.fn().mockResolvedValue(fakeJob(5)),
      updateJob: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) throw new ApiError('conflict', 409);
        return fakeJob(6);
      }),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();
    expect(attempts).toBe(2);
  });

  it('test_apply_drift409_surfacesDriftError', async () => {
    const api = {
      getJob: vi.fn().mockResolvedValue(fakeJob(99)), // version moved
      updateJob: vi.fn().mockRejectedValue(new ApiError('conflict', 409)),
    } as unknown as GreprApiClient;
    await expect(apply(api, 'job_1', fakeUpdate(5))).rejects.toThrow(/drift during apply/);
  });

  it('test_apply_deleted409_surfacesNotFoundError', async () => {
    const api = {
      getJob: vi.fn().mockResolvedValue(undefined), // job deleted between PUT and recheck
      updateJob: vi.fn().mockRejectedValue(new ApiError('conflict', 409)),
    } as unknown as GreprApiClient;
    await expect(apply(api, 'job_1', fakeUpdate(5))).rejects.toThrow(/not found during apply/);
    // Fatal immediately: no retry of a non-existent job.
    expect((api as unknown as { updateJob: { mock: { calls: unknown[] } } }).updateJob.mock.calls).toHaveLength(1);
  });

  it('test_apply_recheckFails409_thenRecovers_doesNotAbort', async () => {
    // A transient failure on the 409 classification fetch must not abort the
    // apply — it should fall through to retry, where the next PUT succeeds.
    let updateAttempts = 0;
    const api = {
      getJob: vi.fn().mockRejectedValueOnce(new ApiError('gateway', 503)),
      updateJob: vi.fn().mockImplementation(async () => {
        updateAttempts++;
        if (updateAttempts === 1) throw new ApiError('conflict', 409);
        return fakeJob(6);
      }),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();
    expect(updateAttempts).toBe(2);
  });

  it('test_apply_recheckFailsEveryAttempt_surfacesRecheckError', async () => {
    // If the classification fetch keeps failing, retries are exhausted and the
    // recheck error is surfaced rather than swallowed.
    const api = {
      getJob: vi.fn().mockRejectedValue(new ApiError('gateway', 503)),
      updateJob: vi.fn().mockRejectedValue(new ApiError('conflict', 409)),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    const rejection = expect(promise).rejects.toThrow(/gateway/);
    await vi.runAllTimersAsync();
    await rejection;
    vi.useRealTimers();
  });

  it('test_apply_drift409_onFinalAttempt_surfacesDriftNotExhaustion', async () => {
    // Mid-deploy 409s (live version unchanged) until the last attempt, when the
    // live version moves: the drift message must win over the exhaustion message.
    let attempts = 0;
    const api = {
      getJob: vi.fn().mockImplementation(async () => {
        attempts++;
        return attempts <= 3 ? fakeJob(5) : fakeJob(99);
      }),
      updateJob: vi.fn().mockRejectedValue(new ApiError('conflict', 409)),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    const rejection = expect(promise).rejects.toThrow(/drift during apply/);
    await vi.runAllTimersAsync();
    await rejection;
    vi.useRealTimers();
  });

  it('test_apply_givesUpAfterMaxRetries', async () => {
    const api = {
      getJob: vi.fn().mockResolvedValue(fakeJob(5)),
      updateJob: vi.fn().mockRejectedValue(new ApiError('conflict', 409)),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    const rejection = expect(promise).rejects.toThrow(/after 3 retries/);
    await vi.runAllTimersAsync();
    await rejection;
    vi.useRealTimers();
  });

  it('test_apply_retriesRetryableServerError', async () => {
    let attempts = 0;
    const api = {
      getJob: vi.fn(),
      updateJob: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) throw new ApiError('server error', 500);
        return fakeJob(6);
      }),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();
    expect(attempts).toBe(2);
    // 5xx is not a conflict, so no drift re-fetch.
    expect((api as unknown as { getJob: { mock: { calls: unknown[] } } }).getJob.mock.calls).toHaveLength(0);
  });

  it('test_apply_honorsRetryAfter', async () => {
    let attempts = 0;
    const api = {
      getJob: vi.fn(),
      updateJob: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) throw new ApiError('rate limited', 429, 2500);
        return fakeJob(6);
      }),
    } as unknown as GreprApiClient;
    vi.useFakeTimers();
    const promise = apply(api, 'job_1', fakeUpdate(5));
    // Backoff would be 1s on attempt 0; Retry-After overrides it to 2.5s.
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    vi.useRealTimers();
    expect(attempts).toBe(2);
  });

  it('test_apply_nonRetryableStatus_doesNotRetry', async () => {
    const api = {
      getJob: vi.fn(),
      updateJob: vi.fn().mockRejectedValue(new ApiError('bad request', 400)),
    } as unknown as GreprApiClient;
    await expect(apply(api, 'job_1', fakeUpdate(5))).rejects.toThrow(/bad request/);
    expect((api as unknown as { updateJob: { mock: { calls: unknown[] } } }).updateJob.mock.calls).toHaveLength(1);
  });

  it('test_apply_errorWithoutStatus_doesNotRetry', async () => {
    const api = {
      getJob: vi.fn(),
      updateJob: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as GreprApiClient;
    await expect(apply(api, 'job_1', fakeUpdate(5))).rejects.toThrow(/network down/);
    expect((api as unknown as { updateJob: { mock: { calls: unknown[] } } }).updateJob.mock.calls).toHaveLength(1);
  });
});
