import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { Readable } from 'stream';
import { JobDraftCommand } from '@/commands/job-draft-command.js';
import {
  TemplateOperationType,
  PathsV1JobsGetParametersQueryState,
} from '@/openapi/openApiTypes.js';
import { makeRawJobGraphJob, makeTemplateJob } from '../lib/test-fixtures.js';

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

function writeTransformPlan(file: string): Promise<void> {
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_1',
    baseVersion: 5,
    fetchedAt: '2026-01-01T00:00:00Z',
    classification: 'transform',
    patch: { operations: [{ op: 'add-message-attribute', attributePath: 'foo' }] },
    current: {
      processing: 'BATCH',
    },
    proposed: {
      desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
      fromVersion: 5,
      jobGraph: {
        vertices: [
          {
            type: TemplateOperationType.template_operation,
            name: 'log_reducer_template',
            templateId: 'log-reducer',
            templateVersion: 1,
            draftMode: false,
            templateInputs: {
              input: {
                exceptions: [],
                parsers: [],
                reducer: {
                  name: 'log_reducer',
                  type: 'log-reducer',
                  delimiters: [' '],
                  enabledMasks: [],
                  masks: [],
                },
                sources: [],
              },
            },
          },
        ],
        edges: [],
      },
    },
    diff: [{ kind: 'add', path: 'x', summary: '+ x' }],
  });
}

function writeSinkTouchingPlan(file: string): Promise<void> {
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_1',
    baseVersion: 5,
    fetchedAt: '2026-01-01T00:00:00Z',
    classification: 'sink',
    patch: { operations: [{ op: 'set-input-field', path: 'sinks', value: [] }] },
    current: {},
    proposed: {
      desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
      fromVersion: 5,
      jobGraph: {
        vertices: [
          {
            type: TemplateOperationType.template_operation,
            name: 'log_reducer_template',
            templateId: 'log-reducer',
            templateVersion: 1,
            draftMode: false,
            templateInputs: {
              input: {
                exceptions: [],
                parsers: [],
                reducer: {
                  name: 'log_reducer',
                  type: 'log-reducer',
                  delimiters: [' '],
                  enabledMasks: [],
                  masks: [],
                },
                sources: [],
                sinks: [],
              },
            },
          },
        ],
        edges: [],
      },
    },
    diff: [],
  });
}

/** Wire `createApiClient` to return a mock whose `submitSyncJob` streams the given NDJSON lines. */
function mockSyncStream(lines: string[]): { submitSyncJob: ReturnType<typeof vi.fn> } {
  const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(Readable.from(lines)) };
  (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);
  return mockApi;
}

describe('JobDraftCommand', () => {
  let tempDir: string;
  let program: Command;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-draft-'));
    program = new Command();
    program.exitOverride();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    stdoutSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('test_jobDraft_transformPlan_submitsWithDraftModeAndPreservesProcessing', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as { jobGraph: { vertices: { draftMode: boolean }[] }; execution: string; processing: string };
    expect(submitted.execution).toBe('SYNCHRONOUS');
    expect(submitted.processing).toBe('BATCH');
    expect(submitted.jobGraph.vertices[0]?.draftMode).toBe(true);
    // Stream content reached stdout.
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('test_jobDraft_sinkTouchingPlan_submitsWithVerificationLimitation', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeSinkTouchingPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Draft verification limitation: Sink/data-lake output edits'),
    );
  });

  it('test_jobDraft_missingPlan_shouldErrorAndExit', async () => {
    new JobDraftCommand().addToProgram(program, async opts => opts as never);
    await expect(program.parseAsync(['node', 'test', 'job:draft', path.join(tempDir, 'nope.json')])).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('test_jobDraft_outputFlag_writesNdjsonToFileAndSkipsStdout', async () => {
    // With -o set, the NDJSON stream is written to the file and must not
    // also leak into stdout.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const outFile = path.join(tempDir, 'draft.ndjson');

    const ndjson = ['{"jobState":"RUNNING"}\n', '{"jobState":"FINISHED"}\n'];
    const stream = Readable.from(ndjson);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    // Mirror the parent program: register the global -o flag so commander
    // can parse it before dispatch into the subcommand.
    program.option('-o, --output <file>', 'Output file');
    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '-o', outFile]);

    const written = await fs.readFile(outFile, 'utf8');
    expect(written).toBe(ndjson.join(''));
    // Crucial: with -o set, the stream must NOT have leaked into stdout.
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('test_jobDraft_noOutputFlag_streamsToStdout', async () => {
    // Without -o, behavior unchanged: pipe to stdout.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(stdoutSpy).toHaveBeenCalled();
  });

  it('test_jobDraft_outputFlag_unwriteablePath_shouldErrorAndExit', async () => {
    // Surface filesystem errors instead of silently dropping them. Writing
    // to a path inside a nonexistent directory is the cheapest reliable
    // way to trigger an ENOENT from createWriteStream.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const unwriteablePath = path.join(tempDir, 'does-not-exist-subdir', 'draft.ndjson');

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    program.option('-o, --output <file>', 'Output file');
    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '-o', unwriteablePath]),
    ).rejects.toThrow();

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('ENOENT'),
    );
  });

  // A draft run can fail server-side while the NDJSON stream completes cleanly;
  // every terminal non-success state must drive a non-zero exit, not a silent
  // success. (Covers FAILED/CANCELLED/TIMED_OUT — the three streamToDestination scans.)
  it.each([
    ['FAILED', '{"jobState":"FAILED","data":{"message":"boom"}}\r\n', 'terminal state FAILED: boom'],
    ['CANCELLED', '{"jobState":"CANCELLED"}\r\n', 'terminal state CANCELLED'],
    ['TIMED_OUT', '{"jobState":"TIMED_OUT"}\r\n', 'terminal state TIMED_OUT'],
  ])('test_jobDraft_streamReportsTerminal_%s_exitsNonZero', async (_state, line, expectedMessage) => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    mockSyncStream([line]);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(program.parseAsync(['node', 'test', 'job:draft', planFile])).rejects.toThrow('process.exit called');

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining(expectedMessage),
    );
  });

  it('test_jobDraft_outputFlag_terminalFailure_writesFileButSuppressesSuccessAndExits', async () => {
    // With -o, the output is still written, but a terminal failure must not be
    // reported as "Draft output written …" and must exit non-zero.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const outFile = path.join(tempDir, 'draft.ndjson');

    const ndjson = ['{"jobState":"RUNNING"}\r\n', '{"jobState":"TIMED_OUT"}\r\n'];
    mockSyncStream(ndjson);

    program.option('-o, --output <file>', 'Output file');
    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '-o', outFile]),
    ).rejects.toThrow('process.exit called');

    // Output is still written despite the failure...
    expect(await fs.readFile(outFile, 'utf8')).toBe(ndjson.join(''));
    // ...but it is not reported as success, and the command exits non-zero.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Draft output written'));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('terminal state TIMED_OUT'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('test_jobDraft_noMaxDuration_passesNoSignal', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('test_jobDraft_nonPositiveMaxDuration_shouldRejectBeforeSubmit', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const mockApi = { submitSyncJob: vi.fn() };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--max-duration-seconds', '0']),
    ).rejects.toThrow();

    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('--max-duration-seconds must be a positive number'),
    );
  });

  it('test_jobDraft_respondsToHeartbeatTokens', async () => {
    // The sync endpoint streams HEARTBEAT tokens; the CLI must echo each one
    // back via sendHeartbeat or the server cancels the streaming draft.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const lines = [
      '{"jobState":"HEARTBEAT","heartbeatToken":"tok-1"}\r\n',
      '{"jobState":"HEARTBEAT","heartbeatToken":"tok-1"}\r\n',
      '{"jobState":"FINISHED"}\r\n',
    ];
    const mockApi = {
      submitSyncJob: vi.fn().mockResolvedValue(Readable.from(lines)),
      sendHeartbeat: vi.fn().mockResolvedValue(undefined),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.sendHeartbeat).toHaveBeenCalledTimes(2);
    expect(mockApi.sendHeartbeat).toHaveBeenCalledWith('tok-1');
  });

  it('test_jobDraft_templatePlan_maxDurationSeconds_passesAbortSignal', async () => {
    // The max-duration cap arms an AbortController whose signal is handed to
    // submitSyncJob; it cuts the stream after N seconds.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--max-duration-seconds', '30']);

    const signal = mockApi.submitSyncJob.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('test_jobDraft_jobId_noPlan_draftsLivePipelineAsIs', async () => {
    // --job-id with no plan file: fetch the live job, synthesize a no-op
    // plan, and draft the current config (draftMode flipped on).
    const liveJob = makeTemplateJob({}, 5, 'BATCH');
    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = {
      getJob: vi.fn().mockResolvedValue(liveJob),
      submitSyncJob: vi.fn().mockResolvedValue(stream),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', '--job-id', 'job_1']);

    // Unresolved fetch, then a single draft submission with draftMode on.
    expect(mockApi.getJob).toHaveBeenCalledWith('job_1', undefined, false);
    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as { jobGraph: { vertices: { draftMode: boolean }[] }; processing: string };
    expect(submitted.processing).toBe('BATCH');
    expect(submitted.jobGraph.vertices[0]?.draftMode).toBe(true);
  });

  it('test_jobDraft_jobId_rawJobGraph_exitsWithTemplateOnlyMessage', async () => {
    const mockApi = {
      getJob: vi.fn().mockResolvedValue(makeRawJobGraphJob()),
      submitSyncJob: vi.fn(),
    };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(program.parseAsync(['node', 'test', 'job:draft', '--job-id', 'job_jg'])).rejects.toThrow();

    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      'This pipeline uses a raw job graph (no template-operation vertex). job:plan, job:draft and job:apply support only template-backed pipelines. To change a raw job graph, edit it and run job:update.',
    );
  });

  it('test_jobDraft_bothPlanAndJobId_shouldErrorAndExit', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const mockApi = { getJob: vi.fn(), submitSyncJob: vi.fn() };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--job-id', 'job_1']),
    ).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('not both'),
    );
    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
  });

  it('test_jobDraft_sampleLogs_injectsDraftSourceWithLogTypeAndBatch', async () => {
    // --sample-logs injects a bounded logs-values-source as the template
    // input's draftSource, stamps type:log on every value, and runs BATCH.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    // One event already tagged, one missing the discriminator entirely.
    await fs.writeJson(sampleFile, [
      { id: 'a1', message: 'boom', eventTimestamp: 1, receivedTimestamp: 1, type: 'log' },
      { id: 'a2', message: 'bang', eventTimestamp: 2, receivedTimestamp: 2 },
    ]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      processing: string;
      jobGraph: { vertices: { draftMode?: boolean; templateInputs?: { input?: { draftSource?: { type: string; name: string; values: { type: string }[] } } } }[] };
    };
    // A bounded values-source demands BATCH.
    expect(submitted.processing).toBe('BATCH');
    const templateOp = submitted.jobGraph.vertices[0];
    expect(templateOp?.draftMode).toBe(true);
    const draftSource = templateOp?.templateInputs?.input?.draftSource;
    expect(draftSource?.type).toBe('logs-values-source');
    expect(draftSource?.name).toBe('draft_source');
    expect(draftSource?.values).toHaveLength(2);
    // Every value carries type:log, added where it was missing.
    expect(draftSource?.values.every(v => v.type === 'log')).toBe(true);
  });

  it('test_jobDraft_sampleLogs_fillsIdAndTimestampsFromContentOnlySample', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [
      {
        message: 'This is a sample log from grepr-flink-query service.',
        tags: { service: ['grepr-flink-query'] },
        severity: 9,
        eventtimestamp: 1785235200000,
      },
    ]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: {
        vertices: {
          templateInputs?: {
            input?: { draftSource?: { values: Record<string, unknown>[] } };
          };
        }[];
      };
    };
    const value = submitted.jobGraph.vertices[0]?.templateInputs?.input?.draftSource?.values[0];
    expect(value?.type).toBe('log');
    expect(typeof value?.id).toBe('string');
    expect((value?.id as string).length).toBeGreaterThan(0);
    expect(value?.eventTimestamp).toBe(1785235200000);
    expect(typeof value?.receivedTimestamp).toBe('number');
    expect(value?.message).toBe('This is a sample log from grepr-flink-query service.');
  });

  it('test_jobDraft_sampleLogs_isoTimestamps_areParsedNotRestamped', async () => {
    // Samples copied out of query output carry ISO-8601 timestamps; restamping them with the
    // current time collapses every event onto one instant, so time windows and dedup are then
    // exercised against times the author never wrote.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [
      { message: 'GET /checkout 200 ok', eventTimestamp: '2026-07-26T12:00:00.000Z' },
    ]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: {
        vertices: {
          templateInputs?: {
            input?: { draftSource?: { values: Record<string, unknown>[] } };
          };
        }[];
      };
    };
    const value = submitted.jobGraph.vertices[0]?.templateInputs?.input?.draftSource?.values[0];
    expect(value?.eventTimestamp).toBe(Date.parse('2026-07-26T12:00:00.000Z'));
    expect(value?.receivedTimestamp).toBe(Date.parse('2026-07-26T12:00:00.000Z'));
  });

  it('test_jobDraft_sampleLogs_unreadableTimestamp_failsInsteadOfSilentlyRestamping', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [
      { message: 'GET /checkout 200 ok', eventTimestamp: 'last tuesday' },
    ]);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);

    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]),
    ).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('eventTimestamp'),
    );
  });

  it('test_jobDraft_sampleLogs_tagsOfTheWrongType_failsInsteadOfDroppingThem', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [{ message: 'GET /checkout 200 ok', tags: ['service:checkout'] }]);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);

    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]),
    ).rejects.toThrow('process.exit called');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('tags'),
    );
  });

  it('test_jobDraft_sampleLogs_messageOnlySample_defaultsSeverityToInfo', async () => {
    // LogEvent.severity is a primitive int in the OTel 1-24 range, so an omitted severity would
    // deserialize to 0 — a level no severity rule matches.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [{ message: 'GET /checkout 200 ok' }]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: {
        vertices: {
          templateInputs?: {
            input?: { draftSource?: { values: Record<string, unknown>[] } };
          };
        }[];
      };
    };
    const value = submitted.jobGraph.vertices[0]?.templateInputs?.input?.draftSource?.values[0];
    expect(value?.severity).toBe(9);
  });

  it('test_jobDraft_sampleLogs_explicitSeverity_isPreserved', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [{ message: 'GET /checkout 500 upstream timeout', severity: 17 }]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: {
        vertices: {
          templateInputs?: {
            input?: { draftSource?: { values: Record<string, unknown>[] } };
          };
        }[];
      };
    };
    const value = submitted.jobGraph.vertices[0]?.templateInputs?.input?.draftSource?.values[0];
    expect(value?.severity).toBe(17);
  });

  it('test_jobDraft_sampleLogs_acceptsNdjson', async () => {
    // NDJSON (one event per line) is accepted alongside a JSON array.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.ndjson');
    await fs.writeFile(
      sampleFile,
      '{"id":"a1","message":"one","eventTimestamp":1,"receivedTimestamp":1}\n' +
        '{"id":"a2","message":"two","eventTimestamp":2,"receivedTimestamp":2}\n',
    );

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: { vertices: { templateInputs?: { input?: { draftSource?: { values: { id: string; type: string }[] } } } }[] };
    };
    const values = submitted.jobGraph.vertices[0]?.templateInputs?.input?.draftSource?.values;
    expect(values).toHaveLength(2);
    expect(values?.map(v => v.id)).toEqual(['a1', 'a2']);
    expect(values?.every(v => v.type === 'log')).toBe(true);
  });

  it('test_jobDraft_sampleLogs_applyPathNeverCarriesDraftSource', async () => {
    // The draftSource is injected onto a clone at draft-submit time, so the
    // plan's `proposed` (what job:apply PUTs) must never carry a draftSource.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);
    const sampleFile = path.join(tempDir, 'sample.json');
    await fs.writeJson(sampleFile, [{ id: 'a1', eventTimestamp: 1, receivedTimestamp: 1 }]);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', sampleFile]);

    // The plan file on disk (source of truth for job:apply) is untouched: its
    // proposed template input has no draftSource, and draftMode stays false.
    const planOnDisk = await fs.readJson(planFile);
    const inputOnDisk = planOnDisk.proposed.jobGraph.vertices[0];
    expect(inputOnDisk.templateInputs.input.draftSource).toBeUndefined();
    expect(inputOnDisk.draftMode).toBe(false);
  });

  it('test_jobDraft_sampleLogs_missingFile_shouldErrorAndExit', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const mockApi = { submitSyncJob: vi.fn() };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-logs', path.join(tempDir, 'nope.json')]),
    ).rejects.toThrow();

    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('Sample logs file not found'),
    );
  });

  it('test_jobDraft_neitherPlanNorJobId_shouldErrorAndExit', async () => {
    const mockApi = { getJob: vi.fn(), submitSyncJob: vi.fn() };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(program.parseAsync(['node', 'test', 'job:draft'])).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('Pass a plan file'),
    );
    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
  });
});
