import { describe, expect, it, vi } from 'bun:test';
import {
  parseSignalDataType,
  resolveSignalSource,
  validateSignalSourceInputs,
  type SignalSourceApiClient
} from '../../../main/typescript/lib/signal-source.js';
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogLogSinkType,
  DatadogTraceSinkType,
  LogsIcebergTableSinkType,
  TemplateOperationType,
  TraceReducerType,
  type SchemaDatasetRead,
  type SchemaOperation,
  type SchemaReadJob,
  type SchemaTemplate
} from '../../../main/typescript/openapi/openApiTypes.js';

const logs = CreateLogsBackfillJobDataType.logs;
const spans = CreateSpansBackfillJobDataType.spans;

const LOG_REDUCER_TEMPLATE: SchemaTemplate = {
  id: 'tpl_logs',
  name: 'log-reducer-job-graph-template',
  template: '',
  version: 16
};
const TRACE_REDUCER_TEMPLATE: SchemaTemplate = {
  id: 'tpl_spans',
  name: 'trace-reducer-job-graph-template',
  template: '',
  version: 4
};

function dataset(id: string, teamIds: string[] = [], name = id): SchemaDatasetRead {
  return { id, name, teamIds } as SchemaDatasetRead;
}

function apiClient(overrides: Partial<SignalSourceApiClient> = {}): SignalSourceApiClient {
  const listDatasets = overrides.listDatasets ??
    vi.fn(async () => [dataset('ds_raw', ['team_ds'], 'raw-logs')]);
  return {
    getJob: vi.fn(async () => undefined),
    getTemplate: vi.fn(async () => LOG_REDUCER_TEMPLATE),
    listDatasets,
    getDataset: vi.fn(async (id: string) => dataset(id, ['team_ds'])),
    lookupDataset: vi.fn(async (reference: string) =>
      (await listDatasets())?.find(candidate => candidate.name === reference)),
    ...overrides
  };
}

function job(vertices: SchemaOperation[], teamIds: string[] = ['team_job']): SchemaReadJob {
  return {
    id: 'job_1',
    name: 'pipeline',
    teamIds,
    jobGraph: { vertices, edges: [] }
  } as SchemaReadJob;
}

function templateVertex(
  templateId: string,
  templateVersion: number,
  input: unknown
): SchemaOperation {
  return {
    type: TemplateOperationType.template_operation,
    name: 'template_op',
    templateId,
    templateVersion,
    templateInputs: { input }
  } as unknown as SchemaOperation;
}

function logTemplateJob(datasetId = 'ds_raw', teamIds?: string[]): SchemaReadJob {
  return job([templateVertex('tpl_logs', 16, { datasetId })], teamIds);
}

function datadogLogSink(integrationId = 'dd_1'): SchemaOperation {
  return {
    type: DatadogLogSinkType.datadog_log_sink,
    name: `sink_${integrationId}`,
    integrationId
  } as SchemaOperation;
}

function datadogTraceSink(integrationId = 'dd_1'): SchemaOperation {
  return {
    type: DatadogTraceSinkType.datadog_trace_sink,
    name: `sink_${integrationId}`,
    integrationId
  } as SchemaOperation;
}

describe('parseSignalDataType', () => {
  it('test_parseSignalDataType_acceptsTheTwoPublicSignals', () => {
    expect(parseSignalDataType('logs')).toBe(logs);
    expect(parseSignalDataType('spans')).toBe(spans);
  });

  it('test_parseSignalDataType_rejectsAnythingElse', () => {
    expect(() => parseSignalDataType('traces')).toThrow(/--data-type must be one of: logs, spans/);
    expect(() => parseSignalDataType('LOGS')).toThrow(/must be one of/);
    expect(() => parseSignalDataType('')).toThrow(/must be one of/);
  });
});

describe('validateSignalSourceInputs', () => {
  it('test_validateSignalSourceInputs_acceptsEachSupportedSelector', () => {
    expect(() => validateSignalSourceInputs({ jobId: 'job_1' })).not.toThrow();
    expect(() => validateSignalSourceInputs({ datasetId: 'ds_1' })).not.toThrow();
    expect(() => validateSignalSourceInputs({ datasetId: 'ds_1', dataType: logs })).not.toThrow();
    expect(() => validateSignalSourceInputs({ datasetName: 'raw', dataType: spans })).not.toThrow();
  });

  it('test_validateSignalSourceInputs_rejectsBothDatasetSelectors', () => {
    expect(() => validateSignalSourceInputs({ datasetId: 'ds_1', datasetName: 'raw', dataType: logs }))
      .toThrow(/Cannot specify both --dataset-id and --dataset-name/);
  });

  it('test_validateSignalSourceInputs_rejectsDatasetFlagsWithJobId', () => {
    expect(() => validateSignalSourceInputs({ jobId: 'job_1', datasetId: 'ds_1' }))
      .toThrow(/Cannot specify explicit dataset flags with --job-id/);
    expect(() => validateSignalSourceInputs({ jobId: 'job_1', datasetName: 'raw' }))
      .toThrow(/Cannot specify explicit dataset flags with --job-id/);
  });

  it('test_validateSignalSourceInputs_rejectsNoSelector', () => {
    expect(() => validateSignalSourceInputs({}))
      .toThrow(/Specify --job-id, --dataset-id, or --dataset-name/);
    expect(() => validateSignalSourceInputs({ jobId: '' }))
      .toThrow(/Specify --job-id, --dataset-id, or --dataset-name/);
  });

  it('test_validateSignalSourceInputs_ignoresAnEmptyJobIdWithAValidDataset', () => {
    expect(() => validateSignalSourceInputs({ jobId: '', datasetName: 'raw-logs' }))
      .not.toThrow();
  });

});

describe('resolveSignalSource explicit dataset mode', () => {
  it('test_resolveSignalSource_defaultsExplicitDatasetToLogs', async () => {
    await expect(resolveSignalSource({ datasetId: 'ds_1' }, apiClient())).resolves.toMatchObject({
      dataType: logs,
      datasetId: 'ds_1'
    });
  });

  it('test_resolveSignalSource_resolvesByDatasetId', async () => {
    const client = apiClient();
    await expect(resolveSignalSource({ datasetId: 'ds_1', dataType: spans }, client)).resolves.toEqual({
      dataType: spans,
      datasetId: 'ds_1',
      teamIds: ['team_ds'],
      sinkOperations: []
    });
    expect(client.getDataset).toHaveBeenCalledWith('ds_1');
  });

  it('test_resolveSignalSource_passesDatasetIdThroughWhenTeamIdsAreNotNeeded', async () => {
    const client = apiClient({
      getDataset: vi.fn(async () => {
        throw new Error('dataset metadata is unavailable');
      })
    });
    await expect(resolveSignalSource(
      { datasetId: 'ds_1', dataType: spans },
      client,
      { includeTeamIds: false }
    )).resolves.toMatchObject({
      dataType: spans,
      datasetId: 'ds_1',
      teamIds: []
    });
    expect(client.getDataset).not.toHaveBeenCalled();
  });

  it('test_resolveSignalSource_resolvesByDatasetName', async () => {
    const resolved = await resolveSignalSource(
      { datasetName: 'raw-logs', dataType: logs },
      apiClient()
    );
    expect(resolved).toMatchObject({ dataType: logs, datasetId: 'ds_raw' });
  });

  it('test_resolveSignalSource_resolvesIdShapedDatasetNamesForCompatibility', async () => {
    const client = apiClient({
      lookupDataset: vi.fn(async reference => dataset(reference, ['team_ds']))
    });
    await expect(
      resolveSignalSource({ datasetName: 'ds_raw', dataType: logs }, client)
    ).resolves.toMatchObject({ datasetId: 'ds_raw' });
  });

  it('test_resolveSignalSource_throwsWhenTheDatasetIdIsUnknown', async () => {
    const client = apiClient({ getDataset: vi.fn(async () => undefined) });
    await expect(resolveSignalSource({ datasetId: 'missing', dataType: logs }, client))
      .rejects.toThrow(/Dataset not found: missing/);
  });

  it('test_resolveSignalSource_throwsWhenTheDatasetListIsUnavailable', async () => {
    const client = apiClient({ listDatasets: vi.fn(async () => undefined) });
    await expect(resolveSignalSource({ datasetName: 'raw-logs', dataType: spans }, client))
      .rejects.toThrow(/Dataset not found: raw-logs/);
  });

  it('test_resolveSignalSource_defaultsTeamIdsToEmptyWhenTheDatasetHasNone', async () => {
    const client = apiClient({
      getDataset: vi.fn(async (id: string) => ({ id, name: id } as SchemaDatasetRead))
    });
    const resolved = await resolveSignalSource({ datasetId: 'ds_1', dataType: logs }, client);
    expect(resolved.teamIds).toEqual([]);
  });
});

describe('resolveSignalSource job-derived mode', () => {
  it('test_resolveSignalSource_throwsWhenTheJobIsMissing', async () => {
    await expect(resolveSignalSource({ jobId: 'nope' }, apiClient()))
      .rejects.toThrow(/Job not found: nope/);
  });

  it('test_resolveSignalSource_infersLogsFromTheLogReducerTemplate', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        templateVertex('tpl_logs', 16, {
          datasetId: 'ds_raw',
          sinks: [{ sink: datadogLogSink('dd_1') }]
        })
      ])),
      getTemplate: vi.fn(async () => LOG_REDUCER_TEMPLATE)
    });

    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved).toMatchObject({ dataType: logs, datasetId: 'ds_raw' });
    expect(resolved.sinkOperations).toEqual([datadogLogSink('dd_1')]);
    expect(client.getTemplate).toHaveBeenCalledWith('tpl_logs', 16);
  });

  it('test_resolveSignalSource_throwsWhenTheLogTemplateHasNoDataset', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([templateVertex('tpl_logs', 16, {})]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/Log reducer template has no raw logs dataset/);
  });

  it('test_resolveSignalSource_infersSpansFromTheTraceReducerTemplate', async () => {
    const sqlOperation = { type: 'sql-operation', name: 'post' };
    const client = apiClient({
      getJob: vi.fn(async () => job([
        templateVertex('tpl_spans', 4, {
          datasetId: 'ds_spans',
          sinks: [{ sink: datadogTraceSink('dd_1') }],
          sqlOperations: { postReducer: { sqlOperation } }
        })
      ])),
      getTemplate: vi.fn(async () => TRACE_REDUCER_TEMPLATE)
    });

    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved).toMatchObject({ dataType: spans, datasetId: 'ds_spans' });
    expect(resolved.sinkOperations).toEqual([datadogTraceSink('dd_1')]);
    expect(resolved.postReducerSqlOperation).toEqual(sqlOperation);
  });

  it('test_resolveSignalSource_throwsWhenTheTraceTemplateHasNoDataset', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([templateVertex('tpl_spans', 4, {})])),
      getTemplate: vi.fn(async () => TRACE_REDUCER_TEMPLATE)
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/Trace reducer template has no raw spans dataset/);
  });

  it('test_resolveSignalSource_throwsWhenTemplateInputsAreMissingEntirely', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        {
          type: TemplateOperationType.template_operation,
          name: 'template_op',
          templateId: 'tpl_logs',
          templateVersion: 16
        } as unknown as SchemaOperation
      ]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/Log reducer template has no raw logs dataset/);
  });

  it('test_resolveSignalSource_rejectsUnsupportedTemplates', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([templateVertex('tpl_other', 1, {})])),
      getTemplate: vi.fn(async () => ({
        ...LOG_REDUCER_TEMPLATE,
        name: 'metrics-job-graph-template'
      }))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(
        /unsupported pipeline template metrics-job-graph-template \(tpl_other\)/
      );
  });

  it('test_resolveSignalSource_rejectsRawJobGraphsAndNamesTheDatasetFlags', async () => {
    const rawLogsGraph = job([
      { type: LogsIcebergTableSinkType.logs_iceberg_table_sink, name: 'raw_data_sink', datasetId: 'ds_raw' } as SchemaOperation,
      datadogLogSink('dd_1')
    ]);
    const rawSpansGraph = job([
      { type: TraceReducerType.trace_reducer, name: 'trace_reducer', datasetId: 'ds_spans' } as unknown as SchemaOperation,
      datadogTraceSink('dd_1')
    ]);
    for (const rawJob of [rawLogsGraph, rawSpansGraph]) {
      const client = apiClient({ getJob: vi.fn(async () => rawJob) });
      await expect(resolveSignalSource({ jobId: 'job_1' }, client)).rejects.toThrow(
        /job_1 uses a raw job graph.*supports only template-backed pipelines.*--dataset-id or --dataset-name.*--data-type spans/
      );
    }
  });

  it('test_resolveSignalSource_rejectsMultipleTemplateOperations', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        templateVertex('tpl_logs', 16, { datasetId: 'ds_a' }),
        templateVertex('tpl_spans', 4, { datasetId: 'ds_b' })
      ]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/has an ambiguous pipeline definition/);
  });

  it('test_resolveSignalSource_rejectsARequestedDataTypeThatContradictsTheJob', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob())
    });
    await expect(resolveSignalSource({ jobId: 'job_1', dataType: spans }, client))
      .rejects.toThrow(/Requested --data-type spans does not match source job type logs/);
  });

  it('test_resolveSignalSource_acceptsARequestedDataTypeThatMatchesTheJob', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob())
    });
    await expect(resolveSignalSource({ jobId: 'job_1', dataType: logs }, client))
      .resolves.toMatchObject({ dataType: logs });
  });

  it('test_resolveSignalSource_prefersDatasetTeamIdsOverJobTeamIds', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob('ds_raw', ['team_job', 'team_shared'])),
      getDataset: vi.fn(async (id: string) => dataset(id, ['team_ds', 'team_shared']))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.teamIds).toEqual(['team_ds', 'team_shared']);
  });

  it('test_resolveSignalSource_fallsBackToJobTeamIdsWhenDatasetTeamsAreAbsent', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob('ds_raw', ['team_job'])),
      getDataset: vi.fn(async (id: string) => ({ id, name: id } as SchemaDatasetRead))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.teamIds).toEqual(['team_job']);
  });

  it('test_resolveSignalSource_skipsJobDatasetMetadataWhenTeamIdsAreNotNeeded', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob()),
      getDataset: vi.fn(async () => {
        throw new Error('dataset metadata is unavailable');
      })
    });
    const resolved = await resolveSignalSource(
      { jobId: 'job_1' },
      client,
      { includeTeamIds: false }
    );
    expect(resolved).toMatchObject({ datasetId: 'ds_raw', teamIds: [] });
    expect(client.getDataset).not.toHaveBeenCalled();
  });

  it('test_resolveSignalSource_throwsWhenTheInferredDatasetCannotBeLoaded', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => logTemplateJob('ds_gone')),
      getDataset: vi.fn(async () => undefined)
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/Dataset not found: ds_gone/);
  });
});
