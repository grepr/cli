import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { BackfillCommand } from '../../../../src/main/typescript/commands/backfill-command.js';
import { createApiClient } from '../../../../src/main/typescript/lib/api-client-factory.js';
import {
  createDatadogIntegration as datadog,
  createSplunkIntegration as splunk,
  recentBackfillRange
} from '../lib/test-fixtures.js';

vi.mock('../../../../src/main/typescript/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn()
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn()
}));

const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

function asMock(fn: unknown): ReturnType<typeof vi.fn> {
  return fn as ReturnType<typeof vi.fn>;
}

function backfillRangeHoursAgo(hours: number): { start: string; end: string } {
  const end = new Date();
  return {
    start: new Date(end.getTime() - hours * 60 * 60 * 1000).toISOString(),
    end: end.toISOString()
  };
}

function cliOptions() {
  return {
    orgName: 'test',
    apiBaseUrl: 'https://test.app.grepr.ai/api',
    authBaseUrl: 'https://auth',
    authMethod: 'oauth',
    clientId: 'client',
    authCache: true,
    browser: true
  };
}

describe('BackfillCommand', () => {
  let command: BackfillCommand;
  let mockApiClient: {
    getJob: ReturnType<typeof vi.fn>;
    getDataset: ReturnType<typeof vi.fn>;
    getIntegrationById: ReturnType<typeof vi.fn>;
    createBackfillJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    command = new BackfillCommand();
    mockApiClient = {
      getJob: vi.fn(),
      getDataset: vi.fn(async id => ({ id, name: id })),
      getIntegrationById: vi.fn(async id => datadog(id)),
      createBackfillJob: vi.fn(async request => ({ ...request, id: 'job_backfill' }))
    };
    asMock(createApiClient).mockReturnValue(mockApiClient as never);
    asMock(mkdir).mockResolvedValue(undefined);
    asMock(writeFile).mockResolvedValue(undefined);
  });

  function backfillOptions(overrides: Record<string, unknown> = {}) {
    return {
      ...cliOptions(),
      datasetId: 'ds_raw',
      sinkIds: ['dd_1'],
      ...recentBackfillRange(),
      ...overrides
    };
  }

  function addBackfillCommand(program: Command): void {
    command.addToProgram(program, vi.fn(async () => cliOptions()));
  }

  it('test_execute_dryRunPrintsBackfillParametersWithoutSubmitting', async () => {
    await command.execute(backfillOptions({
      dryRun: true
    }));

    expect(mockApiClient.createBackfillJob).not.toHaveBeenCalled();
    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      greprUrl?: string;
      datasetId?: string;
      limit?: number;
      jobGraph?: unknown;
    };
    // Parameters only: the server builds the graph from them.
    expect(printed.jobGraph).toBeUndefined();
    expect(printed.datasetId).toBe('ds_raw');
    expect(printed.limit).toBe(10000);
    expect(printed.greprUrl).toBeUndefined();
  });

  it('test_execute_submitSendsParametersToTheBackfillsEndpoint', async () => {
    await command.execute(backfillOptions({
      limit: -1
    }));

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('--limit -1'));
    expect(mockApiClient.createBackfillJob).toHaveBeenCalledTimes(1);
    const request = mockApiClient.createBackfillJob.mock.calls[0]?.[0];
    expect(request.jobGraph).toBeUndefined();
    expect(request.datasetId).toBe('ds_raw');
    expect(request.limit).toBe(-1);
    expect(request.vendorSinkIntegrationIds).toEqual(['dd_1']);
  });

  it('test_execute_skipsIneligibleSinkAndWarns', async () => {
    mockApiClient.getIntegrationById.mockImplementation(
      async id => id === 'dd_1' ? datadog(id) : splunk(id)
    );

    await command.execute(backfillOptions({
      dryRun: true,
      sinkIds: ['dd_1', 'splunk_1'],
      ...backfillRangeHoursAgo(24)
    }));

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Warning: Skipping dd_1 (dd_1): Datadog cannot backfill logs older than 18 hours.'
    );
    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      vendorSinkIntegrationIds?: string[];
      sinks?: { name?: string }[];
    };
    expect(printed.vendorSinkIntegrationIds).toEqual(['splunk_1']);
    expect(printed.sinks?.map(sink => sink.name)).toEqual(['sink_splunk_1']);
  });

  it('test_execute_quietSuppressesSkippedSinkWarning', async () => {
    mockApiClient.getIntegrationById.mockImplementation(
      async id => id === 'dd_1' ? datadog(id) : splunk(id)
    );

    await command.execute(backfillOptions({
      dryRun: true,
      quiet: true,
      sinkIds: ['dd_1', 'splunk_1'],
      ...backfillRangeHoursAgo(24)
    }));

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('test_execute_submitPrintsCreatedJobWithGreprAndVendorLinks', async () => {
    await command.execute(backfillOptions({
      tags: ['incident:INC-123']
    }));

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      id?: string;
      greprUrl?: string;
      vendorLinks?: { label?: string; url?: string; integrationId?: string }[];
    };
    expect(printed.id).toBe('job_backfill');
    const greprUrl = new URL(printed.greprUrl ?? '');
    expect(greprUrl.origin).toBe('https://test.app.grepr.ai');
    expect(greprUrl.pathname).toBe('/jobs');
    expect(greprUrl.searchParams.get('uiFilters.name')).toMatch(/^backfill_/);
    expect(printed.vendorLinks).toHaveLength(1);
    expect(printed.vendorLinks?.[0]?.integrationId).toBe('dd_1');
    expect(printed.vendorLinks?.[0]?.label).toBe('View in Datadog');
    expect(printed.vendorLinks?.[0]?.url).toContain('https://app.datadoghq.com/logs?');
    expect(printed.vendorLinks?.[0]?.url).toContain('incident%3A%28%22inc-123%22%29');
  });

  it('test_execute_submitOmitsGreprUrlWhenUiOriginCannotBeInferred', async () => {
    await command.execute(backfillOptions({
      apiBaseUrl: 'https://api.example.com/v1'
    }));

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      greprUrl?: string;
    };
    expect(printed.greprUrl).toBeUndefined();
  });

  it('test_execute_submitAddsOrgToUnscopedGreprUiHost', async () => {
    await command.execute(backfillOptions({
      orgName: 'greprstaging',
      apiBaseUrl: 'https://app.staging.grepr.ai/api'
    }));

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      greprUrl?: string;
    };
    expect(new URL(printed.greprUrl ?? '').origin).toBe(
      'https://greprstaging.app.staging.grepr.ai'
    );
  });

  it('test_parseThroughCommander_normalizesVariadicFlags', async () => {
    const program = new Command();
    program.exitOverride();
    addBackfillCommand(program);

    await program.parseAsync([
      'node',
      'grepr',
      'backfill',
      '--dataset-id', 'ds_raw',
      '--sink-id', 'dd_1', 'dd_2',
      '--tag', 'env:test', 'source:cli',
      ...Object.entries(recentBackfillRange()).flatMap(([flag, value]) => [`--${flag}`, value]),
      '--dry-run'
    ]);

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      vendorSinkIntegrationIds?: string[];
      sinks?: { name?: string; additionalTags?: string[] }[];
    };
    expect(printed.vendorSinkIntegrationIds).toEqual(['dd_1', 'dd_2']);
    expect(printed.sinks?.find(sink => sink.name === 'sink_dd_1')?.additionalTags).toEqual(
      expect.arrayContaining(['env:test', 'source:cli'])
    );
    expect(printed.sinks?.find(sink => sink.name === 'sink_dd_2')?.additionalTags).toEqual(
      expect.arrayContaining(['env:test', 'source:cli'])
    );
  });

  it('test_parseThroughCommander_stillMergesRepeatedVariadicFlags', async () => {
    const program = new Command();
    program.exitOverride();
    addBackfillCommand(program);

    await program.parseAsync([
      'node',
      'grepr',
      'backfill',
      '--dataset-id', 'ds_raw',
      '--sink-id', 'dd_1',
      '--sink-id', 'dd_2',
      '--tag', 'env:test',
      '--tag', 'source:cli',
      ...Object.entries(recentBackfillRange()).flatMap(([flag, value]) => [`--${flag}`, value]),
      '--dry-run'
    ]);

    const printed = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0])) as {
      vendorSinkIntegrationIds?: string[];
      sinks?: { name?: string; additionalTags?: string[] }[];
    };
    expect(printed.vendorSinkIntegrationIds).toEqual(['dd_1', 'dd_2']);
    expect(printed.sinks?.find(sink => sink.name === 'sink_dd_1')?.additionalTags).toEqual(
      expect.arrayContaining(['env:test', 'source:cli'])
    );
  });

  it('test_parseThroughCommander_rejectsDecimalLimit', async () => {
    const program = new Command();
    program.exitOverride();
    addBackfillCommand(program);

    await expect(program.parseAsync([
      'node',
      'grepr',
      'backfill',
      '--limit', '1.5'
    ])).rejects.toThrow('--limit must be an integer greater than or equal to -1');
    expect(mockApiClient.createBackfillJob).not.toHaveBeenCalled();
  });

  it('test_parseThroughCommander_rejectsTrailingJunkInLimit', async () => {
    const program = new Command();
    program.exitOverride();
    addBackfillCommand(program);

    await expect(program.parseAsync([
      'node',
      'grepr',
      'backfill',
      '--limit', '10junk'
    ])).rejects.toThrow('--limit must be an integer greater than or equal to -1');
    expect(mockApiClient.createBackfillJob).not.toHaveBeenCalled();
  });

  it('test_execute_dryRunCreatesOutputDirectoryBeforeWriting', async () => {
    await command.execute(backfillOptions({
      dryRun: true,
      output: 'build/nested/backfill-output.json'
    }));

    expect(mkdir).toHaveBeenCalledWith('build/nested', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      'build/nested/backfill-output.json',
      expect.stringContaining('"vendorSinkIntegrationIds"')
    );
    expect(mockApiClient.createBackfillJob).not.toHaveBeenCalled();
  });

  it('test_execute_outputWriteFailureAfterSubmit_includesCreatedJobId', async () => {
    asMock(writeFile).mockRejectedValue(new Error('disk full'));

    await expect(command.execute(backfillOptions({
      output: 'build/backfill-output.json'
    }))).rejects.toThrow('Backfill job job_backfill was created, but writing output to build/backfill-output.json failed: disk full');

    expect(mockApiClient.createBackfillJob).toHaveBeenCalledTimes(1);
  });
});
