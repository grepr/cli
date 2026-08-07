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
  SqlOperationInputs,
  SqlOperationType,
  SqlOutputStatementType,
  TemplateOperationType,
  TraceReducerType,
  type SchemaDatasetRead,
  type SchemaOperation,
  type SchemaReadJob,
  type SchemaSqlOperation,
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

function job(
  vertices: SchemaOperation[],
  teamIds: string[] = ['team_job'],
  edges: string[] = []
): SchemaReadJob {
  return {
    id: 'job_1',
    name: 'pipeline',
    teamIds,
    jobGraph: { vertices, edges }
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

function rawLogsSink(datasetId = 'ds_raw', name = 'raw_data_sink_1'): SchemaOperation {
  return {
    type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
    name,
    datasetId
  } as SchemaOperation;
}

function traceReducer(datasetId = 'ds_spans'): SchemaOperation {
  return {
    type: TraceReducerType.trace_reducer,
    name: 'trace_reducer',
    datasetId
  } as unknown as SchemaOperation;
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

function sqlOperation(name: string): SchemaSqlOperation {
  return {
    type: SqlOperationType.sql_operation,
    name,
    inputs: { spans: SqlOperationInputs.COMPLETE_SPAN },
    statements: [{
      type: SqlOutputStatementType.sql_output,
      outputName: 'normalized_spans',
      outputType: SqlOperationInputs.COMPLETE_SPAN,
      sqlQuery: 'SELECT * FROM spans'
    }]
  };
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
      sinkOperations: [],
      postReducerSqlOperations: []
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

  it('test_resolveSignalSource_fallsBackToTheLogTemplateRawSinkConfigDataset', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        templateVertex('tpl_logs', 16, { rawSinkConfig: { datasetId: 'ds_from_raw_config' } })
      ]))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.datasetId).toBe('ds_from_raw_config');
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
    expect(resolved.postReducerSqlOperations).toEqual([sqlOperation]);
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

  it('test_resolveSignalSource_infersLogsFromARawGraph', async () => {
    const vertices = [rawLogsSink('ds_raw'), datadogLogSink('dd_1')];
    const client = apiClient({ getJob: vi.fn(async () => job(vertices)) });

    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved).toMatchObject({ dataType: logs, datasetId: 'ds_raw' });
    expect(resolved.sinkOperations).toEqual(vertices);
  });

  it('test_resolveSignalSource_ignoresNonRawLogsIcebergSinks', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_processed', 'processed_sink')]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/has no supported raw logs or spans dataset/);
  });

  it('test_resolveSignalSource_infersSpansFromARawGraph', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([traceReducer('ds_spans'), datadogTraceSink('dd_1')]))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved).toMatchObject({ dataType: spans, datasetId: 'ds_spans' });
  });

  it('test_resolveSignalSource_preservesPostReducerSqlFromARawGraph', async () => {
    const postReducerSql = sqlOperation('post_reducer_sql');
    const client = apiClient({
      getJob: vi.fn(async () => job(
        [traceReducer('ds_spans'), postReducerSql, datadogTraceSink('dd_1')],
        ['team_job'],
        [
          'trace_reducer:output -> post_reducer_sql:spans',
          'post_reducer_sql:normalized_spans -> sink_dd_1'
        ]
      ))
    });

    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.postReducerSqlOperations).toEqual([postReducerSql]);
  });

  it('test_resolveSignalSource_allowsMultiplePostReducerSqlBranches', async () => {
    const firstSql = sqlOperation('first_sql');
    const secondSql = sqlOperation('second_sql');
    const client = apiClient({
      getJob: vi.fn(async () => job(
        [traceReducer('ds_spans'), firstSql, secondSql, datadogTraceSink('dd_1')],
        ['team_job'],
        [
          'trace_reducer -> first_sql:spans',
          'trace_reducer -> second_sql:spans'
        ]
      ))
    });

    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.postReducerSqlOperations).toEqual([firstSql, secondSql]);
  });

  it('test_resolveSignalSource_rejectsARawGraphWithBothSignals', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw'), traceReducer('ds_spans')]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/contains both logs and spans datasets/);
  });

  it('test_resolveSignalSource_rejectsARawGraphWithTwoRawLogSinks', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        rawLogsSink('ds_a', 'raw_data_sink_a'),
        rawLogsSink('ds_b', 'raw_data_sink_b')
      ]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/multiple raw logs datasets; use --dataset-id/);
  });

  it('test_resolveSignalSource_rejectsARawGraphWithTwoTraceReducers', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([traceReducer('ds_a'), traceReducer('ds_b')]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/multiple spans datasets; use --dataset-id/);
  });

  it('test_resolveSignalSource_ignoresTraceReducersWithoutADataset', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([
        { type: TraceReducerType.trace_reducer, name: 'reducer' } as unknown as SchemaOperation
      ]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/has no supported raw logs or spans dataset/);
  });

  it('test_resolveSignalSource_rejectsARequestedDataTypeThatContradictsTheJob', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw')]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1', dataType: spans }, client))
      .rejects.toThrow(/Requested --data-type spans does not match source job type logs/);
  });

  it('test_resolveSignalSource_acceptsARequestedDataTypeThatMatchesTheJob', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw')]))
    });
    await expect(resolveSignalSource({ jobId: 'job_1', dataType: logs }, client))
      .resolves.toMatchObject({ dataType: logs });
  });

  it('test_resolveSignalSource_prefersDatasetTeamIdsOverJobTeamIds', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw')], ['team_job', 'team_shared'])),
      getDataset: vi.fn(async (id: string) => dataset(id, ['team_ds', 'team_shared']))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.teamIds).toEqual(['team_ds', 'team_shared']);
  });

  it('test_resolveSignalSource_fallsBackToJobTeamIdsWhenDatasetTeamsAreAbsent', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw')], ['team_job'])),
      getDataset: vi.fn(async (id: string) => ({ id, name: id } as SchemaDatasetRead))
    });
    const resolved = await resolveSignalSource({ jobId: 'job_1' }, client);
    expect(resolved.teamIds).toEqual(['team_job']);
  });

  it('test_resolveSignalSource_skipsJobDatasetMetadataWhenTeamIdsAreNotNeeded', async () => {
    const client = apiClient({
      getJob: vi.fn(async () => job([rawLogsSink('ds_raw')])),
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
      getJob: vi.fn(async () => job([rawLogsSink('ds_gone')])),
      getDataset: vi.fn(async () => undefined)
    });
    await expect(resolveSignalSource({ jobId: 'job_1' }, client))
      .rejects.toThrow(/Dataset not found: ds_gone/);
  });
});
