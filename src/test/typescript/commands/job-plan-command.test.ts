import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { JobPlanCommand } from '@/commands/job-plan-command.js';
import {
  LogAttributesRemapperType,
  SchemaReadJob,
} from '@/openapi/openApiTypes.js';
import { makeTemplateJob } from '../lib/test-fixtures.js';

/** Template-backed unresolved job with a single template-operation vertex. */
const fakeJob = (version = 3): SchemaReadJob =>
  makeTemplateJob({
    parsers: [
      {
        type: LogAttributesRemapperType.log_attributes_remapper,
        name: 'log_attributes_remapper',
        messageReservedAttributes: ['message'],
      } as never,
    ],
  }, version);

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

describe('JobPlanCommand', () => {
  let tempDir: string;
  let program: Command;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-plan-cmd-'));
    program = new Command();
    program.exitOverride();
    program.option('-o, --output <file>', 'Output file');
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

  it('test_jobPlan_writesPlanFileWithCorrectShape', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    const outputFile = path.join(tempDir, 'plan.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }],
    });
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob(5)) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'job_1', '--patch', patchFile, '-o', outputFile]);

    // Critical: unresolved fetch (resolved: false).
    expect(mockApi.getJob).toHaveBeenCalledWith('job_1', undefined, false);
    const plan = await fs.readJson(outputFile);
    expect(plan.schemaVersion).toBe(2);
    expect(plan.jobId).toBe('job_1');
    expect(plan.backend).toBe('template');
    expect(plan.baseVersion).toBe(5);
    expect(plan.classification).toBe('transform');
    expect(plan.diff.length).toBeGreaterThan(0);
  });

  it('test_jobPlan_noOutputFile_shouldPrintPlanJson', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }],
    });
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob(5)) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'j', '--patch', patchFile]);

    const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(printed).toContain('"schemaVersion": 2');
    expect(printed).toContain('"baseVersion": 5');
  });

  it('test_jobPlan_missingPatchFile_shouldErrorAndExit', async () => {
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob(1)) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);

    await expect(
      program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'j', '--patch', '/no/such/file.json']),
    ).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Error generating pipeline plan:', expect.any(String));
  });

  it('test_jobPlan_invalidPatchShape_shouldErrorAndExit', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, { notAPatch: true });
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob(1)) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);

    await expect(
      program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'j', '--patch', patchFile]),
    ).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error generating pipeline plan:',
      expect.stringContaining('operations'),
    );
  });

  it('test_jobPlan_jobGraphBackend_shouldGeneratePlanWithJobGraphBackend', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }],
    });
    const outputFile = path.join(tempDir, 'plan.json');
    // Build a non-template job: no template-operation vertex, just a
    // remapper sitting directly in jobGraph.vertices.
    const job = fakeJob(7);
    if (job.jobGraph) {
      job.jobGraph.vertices = [
        { type: 'log-attributes-remapper', name: 'log_attributes_remapper', messageReservedAttributes: ['message'] } as never,
        { type: 'log-reducer', name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] } as never,
      ];
    }
    const mockApi = { getJob: vi.fn().mockResolvedValue(job) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'j', '--patch', patchFile, '-o', outputFile]);

    const plan = await fs.readJson(outputFile);
    expect(plan.backend).toBe('job-graph');
    expect(plan.baseVersion).toBe(7);
    // The proposed update should carry the patched remapper.
    const remapper = plan.proposed.jobGraph.vertices.find((v: { name: string }) => v.name === 'log_attributes_remapper');
    expect(remapper.messageReservedAttributePaths).toEqual([['body', 'action']]);
  });

  it('test_jobPlan_jobGraphBackend_unsupportedOp_shouldErrorAndExit', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'set-filter', phase: 'pre-parser', filter: { type: 'logs-filter', name: 'f' } }],
    });
    const job = fakeJob(1);
    if (job.jobGraph) job.jobGraph.vertices = [{ type: 'log-attributes-remapper', name: 'r' } as never];
    const mockApi = { getJob: vi.fn().mockResolvedValue(job) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await expect(
      program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'j', '--patch', patchFile]),
    ).rejects.toThrow();
    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error generating pipeline plan:',
      expect.stringContaining('unsupported raw job graph shape'),
    );
  });

  it('test_jobPlan_dryRun_printsRenderedDiffToStdout', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }],
    });
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob()) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'job_1', '--patch', patchFile, '--dry-run', '--no-color']);

    const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(printed).toContain('parsers[log_attributes_remapper].messageReservedAttributePaths');
    expect(printed).toContain('version 3');
  });

  it('test_jobPlan_dryRun_noChanges_shouldReportNoChanges', async () => {
    const patchFile = path.join(tempDir, 'patch.json');
    await fs.writeJson(patchFile, {
      operations: [{ op: 'add-message-attribute', attributePath: 'message' }],
    });
    const mockApi = { getJob: vi.fn().mockResolvedValue(fakeJob()) };
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockApi);

    new JobPlanCommand().addToProgram(program, async opts => opts as never);
    await program.parseAsync(['node', 'test', 'job:plan', '--job-id', 'job_1', '--patch', patchFile, '--dry-run', '--no-color']);

    const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(printed).toContain('(no changes)');
  });
});
