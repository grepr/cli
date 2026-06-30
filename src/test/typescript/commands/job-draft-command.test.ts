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
import { makeTemplateJob } from '../lib/test-fixtures.js';

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

function writeTransformPlan(file: string): Promise<void> {
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_1',
    backend: 'template',
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
                filters: {},
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

function writeJobGraphPlan(file: string): Promise<void> {
  // Direct job-graph plan: no template-operation vertex, just bare
  // source/remapper/reducer vertices. The raw draft keeps this source live and
  // interposes a logs-event-sampler after it.
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_jg',
    backend: 'job-graph',
    baseVersion: 3,
    fetchedAt: '2026-01-01T00:00:00Z',
    classification: 'transform',
    patch: { operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }] },
    current: {},
    proposed: {
      desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
      fromVersion: 3,
      jobGraph: {
        vertices: [
          { type: 'logs-iceberg-table-source', name: 'src', datasetId: 'raw_ds_x' },
          { type: 'log-attributes-remapper', name: 'log_attributes_remapper' },
          { type: 'log-reducer', name: 'log_reducer' },
        ],
        edges: ['src -> log_attributes_remapper', 'log_attributes_remapper -> log_reducer'],
      },
    },
    diff: [],
  });
}

function writeSourceTouchingJobGraphPlan(file: string): Promise<void> {
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_jg',
    backend: 'job-graph',
    baseVersion: 4,
    fetchedAt: '2026-01-01T00:00:00Z',
    classification: 'source',
    patch: { operations: [{ op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' } }] },
    current: {
      processing: 'STREAMING',
    },
    proposed: {
      desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
      fromVersion: 4,
      jobGraph: {
        vertices: [
          { type: 'logs-iceberg-table-source', name: 'src', datasetId: 'raw_ds_x' },
          { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' },
          { type: 'logs-filter', name: 'pre_parser_filter' },
          { type: 'log-attributes-remapper', name: 'log_attributes_remapper' },
          { type: 'log-reducer', name: 'log_reducer' },
          { type: 'logs-sync-sink', name: 'sink' },
        ],
        edges: [
          'src -> pre_parser_filter',
          'dd_source -> pre_parser_filter',
          'pre_parser_filter -> log_attributes_remapper',
          'log_attributes_remapper -> log_reducer',
          'log_reducer -> sink',
        ],
      },
    },
    diff: [],
  });
}

function writeSinkTouchingPlan(file: string): Promise<void> {
  return fs.writeJson(file, {
    schemaVersion: 2,
    jobId: 'job_1',
    backend: 'template',
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
                filters: {},
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

  it('test_jobDraft_jobGraphBackend_keepsLiveSourceAndInsertsSampler', async () => {
    // A raw (non-templated) draft mirrors the UI: keep the live source and
    // interpose a logs-event-sampler after it rather than replaying iceberg.
    const planFile = path.join(tempDir, 'plan.json');
    await writeJobGraphPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: { vertices: { name: string; type: string }[]; edges: string[] };
    };
    const names = submitted.jobGraph.vertices.map(v => v.name);
    // Live source preserved, no iceberg replay source.
    expect(names).toContain('src');
    expect(names).not.toContain('draft_tapped_source');
    // A sampler is interposed between the source and its old downstream.
    expect(names).toContain('src_draft_sampler');
    expect(submitted.jobGraph.edges).toContain('src -> src_draft_sampler');
    expect(submitted.jobGraph.edges).toContain('src_draft_sampler -> log_attributes_remapper');
    expect(submitted.jobGraph.edges).not.toContain('src -> log_attributes_remapper');
  });

  it('test_jobDraft_jobGraphBackend_sampleFlagsTuneSampler', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeJobGraphPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-rate', '5', '--sample-burst', '50']);

    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      jobGraph: { vertices: { name: string; maxAllowedRate?: number; maxBurstLimit?: number }[] };
    };
    const sampler = submitted.jobGraph.vertices.find(v => v.name === 'src_draft_sampler');
    expect(sampler?.maxAllowedRate).toBe(5);
    expect(sampler?.maxBurstLimit).toBe(50);
  });

  it('test_jobDraft_jobGraphBackend_maxDurationSeconds_passesAbortSignal', async () => {
    // The max-duration cap arms an AbortController whose signal is handed to
    // submitSyncJob; without the flag, no signal is passed.
    const planFile = path.join(tempDir, 'plan.json');
    await writeJobGraphPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile, '--max-duration-seconds', '30']);

    const signal = mockApi.submitSyncJob.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('test_jobDraft_jobGraphBackend_noMaxDuration_passesNoSignal', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeJobGraphPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('test_jobDraft_nonPositiveMaxDuration_shouldRejectBeforeSubmit', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeJobGraphPlan(planFile);

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
    await writeJobGraphPlan(planFile);

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

  it('test_jobDraft_templatePlan_rejectsSamplerFlags', async () => {
    // --sample-rate/--sample-burst only apply to raw job-graph drafts;
    // template plans manage sampling server-side.
    const planFile = path.join(tempDir, 'plan.json');
    await writeTransformPlan(planFile);

    const mockApi = { submitSyncJob: vi.fn() };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:draft', planFile, '--sample-rate', '5']),
    ).rejects.toThrow();

    expect(mockApi.submitSyncJob).not.toHaveBeenCalled();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error running draft pipeline:',
      expect.stringContaining('do not pass job-graph-only flags'),
    );
  });

  it('test_jobDraft_templatePlan_maxDurationSeconds_passesAbortSignal', async () => {
    // --max-duration-seconds works for template drafts: the AbortController is
    // backend-agnostic and simply cuts the stream after N seconds.
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

  it('test_jobDraft_jobGraphSourceTouching_preservesProposedSources', async () => {
    const planFile = path.join(tempDir, 'plan.json');
    await writeSourceTouchingJobGraphPlan(planFile);

    const stream = Readable.from(['{"jobState":"FINISHED"}\n']);
    const mockApi = { submitSyncJob: vi.fn().mockResolvedValue(stream) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobDraftCommand().addToProgram(program, async opts => ({ ...opts, quiet: true }) as never);
    await program.parseAsync(['node', 'test', 'job:draft', planFile]);

    expect(mockApi.submitSyncJob).toHaveBeenCalledTimes(1);
    const submitted = mockApi.submitSyncJob.mock.calls[0]?.[0] as {
      tags: Record<string, string>;
      jobGraph: { vertices: { name: string }[]; edges: string[] };
    };
    const names = submitted.jobGraph.vertices.map(v => v.name);
    expect(submitted.tags['grepr.draft_mode']).toBeUndefined();
    expect(names).toContain('dd_source');
    expect(names).not.toContain('draft_tapped_source');
    expect(names).toContain('draft_source_preserving_sink');
    expect(names).not.toContain('sink');
    // Each live source streams through its own sampler into the old downstream.
    expect(submitted.jobGraph.edges).toContain('dd_source -> dd_source_draft_sampler');
    expect(submitted.jobGraph.edges).toContain('dd_source_draft_sampler -> pre_parser_filter');
    expect(submitted.jobGraph.edges).not.toContain('dd_source -> pre_parser_filter');
    // log_reducer is tap-eligible, so it reaches the sync sink through its
    // tagger (tagged, attributable) rather than a direct untagged edge.
    expect(submitted.jobGraph.edges).toContain('log_reducer -> tap_log_reducer');
    expect(submitted.jobGraph.edges).toContain('tap_log_reducer -> draft_source_preserving_sink');
    expect(submitted.jobGraph.edges).not.toContain('log_reducer -> draft_source_preserving_sink');
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
