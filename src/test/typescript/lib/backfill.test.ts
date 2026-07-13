import { describe, expect, it, vi } from 'bun:test';
import {
  buildBackfillJob,
  resolveBackfillInputs,
  validateBackfillInputs
} from '../../../main/typescript/lib/backfill.js';
import {
  DatadogLogSinkType,
  DatadogQueryPredicateType,
  LogsBackfillFlinkSourceType,
  LogsFilterType,
  NewRelicLogSinkType,
  OtlpLogSinkType,
  PathsV1JobsGetParametersQueryExecution,
  PathsV1JobsGetParametersQueryProcessing,
  ReadDataWarehouseType,
  SplunkLogSinkType,
  SumoLogSinkType,
  TemplateOperationType,
  VendorLogEventDedupIcebergTableSinkType,
  type SchemaReadDataWarehouse,
  type SchemaReadJob
} from '../../../main/typescript/openapi/openApiTypes.js';
import type { BackfillApiClient } from '../../../main/typescript/lib/backfill.js';
import {
  createDatadogIntegration as datadog,
  createNewRelicIntegration as newRelic,
  createOtlpIntegration as otlp,
  createSplunkIntegration as splunk,
  createSumoIntegration as sumo,
  recentBackfillRange
} from './test-fixtures.js';

const now = new Date('2026-07-07T12:00:00Z');
const baseOptions = {
  datasetId: 'ds_raw',
  sinkIds: ['dd_1'],
  start: '2026-07-07T10:00:00Z',
  end: '2026-07-07T11:00:00Z'
};

function dataWarehouse(id = 'warehouse_1'): SchemaReadDataWarehouse {
  return { id, type: ReadDataWarehouseType.data_warehouse, name: id } as SchemaReadDataWarehouse;
}

function apiClient(overrides: Partial<BackfillApiClient> = {}): BackfillApiClient {
  return {
    getJob: vi.fn(),
    listDatasets: vi.fn(async () => []),
    getDataset: vi.fn(async id => ({ id, name: id } as never)),
    getIntegrationById: vi.fn(async id => datadog(id)),
    createAsyncJob: vi.fn(),
    ...overrides
  };
}

function resolvedInputs(sinks = [datadog('dd_1')], teamIds: string[] = []) {
  return {
    datasetId: 'ds_raw',
    teamIds,
    sinks
  };
}

describe('backfill validation', () => {
  it('test_validateBackfillInputs_rejectsMutuallyExclusiveDatasetFlags', () => {
    expect(() => validateBackfillInputs({
      ...baseOptions,
      datasetName: 'raw'
    })).toThrow(/Cannot specify both --dataset-id and --dataset-name/);
  });

  it('test_validateBackfillInputs_requiresExplicitSink', () => {
    expect(() => validateBackfillInputs({
      datasetId: 'ds_raw',
      start: baseOptions.start,
      end: baseOptions.end
    })).toThrow(/requires at least one --sink-id/);
  });

  it('test_validateBackfillInputs_rejectsSinkIdsWithPipelineMode', () => {
    expect(() => validateBackfillInputs({
      jobId: 'job_1',
      sinkIds: ['dd_1'],
      start: baseOptions.start,
      end: baseOptions.end
    })).toThrow(/Cannot specify --sink-id with --job-id/);
  });

  it('test_validateBackfillInputs_rejectsInvalidLimit', () => {
    expect(() => validateBackfillInputs({
      ...baseOptions,
      limit: -2
    })).toThrow(/--limit must be an integer greater than or equal to -1/);
    expect(() => validateBackfillInputs({
      ...baseOptions,
      limit: 1.5
    })).toThrow(/--limit must be an integer greater than or equal to -1/);
    expect(() => validateBackfillInputs({
      ...baseOptions,
      limit: NaN
    })).toThrow(/--limit must be an integer greater than or equal to -1/);
  });

  it('test_validateBackfillInputs_rejectsStartAfterEnd', () => {
    expect(() => validateBackfillInputs({
      ...baseOptions,
      start: '2026-07-07T12:00:00Z'
    })).toThrow(/--start must be before or equal to --end/);
  });
});

describe('buildBackfillJob', () => {
  it('test_buildBackfillJob_generatesSourceAndPerSinkGraph', () => {
    const job = buildBackfillJob({
      ...baseOptions,
      sinkIds: ['dd_1', 'splunk_1'],
      query: 'status:error',
      limit: 500,
      tags: ['incident:INC-123', 'note:a:b']
    }, resolvedInputs([datadog('dd_1'), splunk('splunk_1')], ['team_alpha']), now);

    expect(job.name).toBe('backfill_2026_07_07t12_00_00_000z');
    expect(job.execution).toBe(PathsV1JobsGetParametersQueryExecution.ASYNCHRONOUS);
    expect(job.processing).toBe(PathsV1JobsGetParametersQueryProcessing.BATCH);
    expect(job.tags).toEqual({ type: 'backfill', backfillType: 'manual' });
    expect(job.teamIds).toEqual(['team_alpha']);

    const source = job.jobGraph.vertices[0];
    expect(source).toEqual({
      type: LogsBackfillFlinkSourceType.logs_backfill_iceberg_table_source,
      name: 'source',
      datasetId: 'ds_raw',
      start: '2026-07-07T10:00:00Z',
      end: '2026-07-07T11:00:00Z',
      query: {
        type: DatadogQueryPredicateType.datadog_query,
        query: 'status:error'
      },
      vendorSinkIntegrationIds: ['dd_1', 'splunk_1'],
      limit: 500
    });

    expect(job.jobGraph.edges).toEqual([
      'source -> backfill_sink_dd_1_filter',
      'backfill_sink_dd_1_filter -> sink_dd_1',
      'sink_dd_1 -> vendorlog_event_dedup_sink_dd_1_iceberg_sink',
      'source -> backfill_sink_splunk_1_filter',
      'backfill_sink_splunk_1_filter -> sink_splunk_1',
      'sink_splunk_1 -> vendorlog_event_dedup_sink_splunk_1_iceberg_sink'
    ]);
    expect(job.jobGraph.vertices).toContainEqual({
      type: LogsFilterType.logs_filter,
      name: 'backfill_sink_dd_1_filter',
      predicate: {
        type: DatadogQueryPredicateType.datadog_query,
        query: '-@meta.grepr.sentVendors:dd_1'
      }
    });
    expect(job.jobGraph.vertices).toContainEqual({
      type: VendorLogEventDedupIcebergTableSinkType.vendorlog_event_dedup_iceberg_table_sink,
      name: 'vendorlog_event_dedup_sink_dd_1_iceberg_sink',
      datasetId: 'ds_raw',
      vendorSinkId: 'dd_1'
    });
    expect(job.jobGraph.vertices).toContainEqual({
      type: DatadogLogSinkType.datadog_log_sink,
      name: 'sink_dd_1',
      integrationId: 'dd_1',
      additionalTags: [
        'grepr.backfilled.timestamp:2026-07-07T12:00:00.000Z',
        'grepr.backfilled:true',
        'processor:grepr',
        'incident:INC-123',
        'note:a:b'
      ]
    });
  });

  it('test_buildBackfillJob_usesAttributesForAttributeBasedSinks', () => {
    const job = buildBackfillJob({
      ...baseOptions,
      sinkIds: ['nr_1', 'sumo_1', 'otlp_1'],
      tags: ['team:platform']
    }, resolvedInputs([newRelic('nr_1'), sumo('sumo_1'), otlp('otlp_1')]), now);

    expect(job.jobGraph.vertices).toContainEqual({
      type: NewRelicLogSinkType.newrelic_log_sink,
      name: 'sink_nr_1',
      integrationId: 'nr_1',
      additionalAttributes: {
        'grepr.backfilled.timestamp': '2026-07-07T12:00:00.000Z',
        'grepr.backfilled': 'true',
        processor: 'grepr',
        team: 'platform'
      }
    });
    expect(job.jobGraph.vertices).toContainEqual({
      type: SumoLogSinkType.sumologic_log_sink,
      name: 'sink_sumo_1',
      integrationId: 'sumo_1',
      additionalAttributes: {
        'grepr.backfilled.timestamp': '2026-07-07T12:00:00.000Z',
        'grepr.backfilled': 'true',
        processor: 'grepr',
        team: 'platform'
      }
    });
    expect(job.jobGraph.vertices).toContainEqual({
      type: OtlpLogSinkType.otlp_log_sink,
      name: 'sink_otlp_1',
      integrationId: 'otlp_1',
      additionalAttributes: {
        'grepr.backfilled.timestamp': '2026-07-07T12:00:00.000Z',
        'grepr.backfilled': 'true',
        processor: 'grepr',
        team: 'platform'
      }
    });
  });

});

describe('resolveBackfillInputs', () => {
  it('test_resolveBackfillInputs_explicitDatasetAndMultipleSinks', async () => {
    const client = apiClient({
      getDataset: vi.fn(async id => ({ id, name: id, teamIds: ['team_alpha'] } as never)),
      getIntegrationById: vi.fn(async id => id === 'dd_1' ? datadog(id) : splunk(id))
    });

    const resolved = await resolveBackfillInputs({
      ...baseOptions,
      ...recentBackfillRange(),
      sinkIds: ['dd_1', 'splunk_1']
    }, client);

    expect(resolved.datasetId).toBe('ds_raw');
    expect(resolved.teamIds).toEqual(['team_alpha']);
    expect(resolved.sinks.map(sink => sink.id)).toEqual(['dd_1', 'splunk_1']);
    expect(resolved.skippedSinks).toEqual([]);
    expect(client.getDataset).toHaveBeenCalledWith('ds_raw');
    expect(client.listDatasets).not.toHaveBeenCalled();
  });

  it('test_resolveBackfillInputs_datasetAndSinkTeams_returnsDeduplicatedUnion', async () => {
    const client = apiClient({
      getDataset: vi.fn(async id => ({
        id,
        name: id,
        teamIds: ['team_dataset', 'team_shared']
      } as never)),
      getIntegrationById: vi.fn(async id => id === 'dd_1'
        ? datadog(id, { teamIds: ['team_dd', 'team_shared'] })
        : splunk(id, { teamIds: ['team_splunk'] }))
    });

    const resolved = await resolveBackfillInputs({
      ...baseOptions,
      ...recentBackfillRange(),
      sinkIds: ['dd_1', 'splunk_1']
    }, client);

    expect(resolved.teamIds).toEqual([
      'team_dataset',
      'team_shared',
      'team_dd',
      'team_splunk'
    ]);
  });

  it('test_resolveBackfillInputs_skipsDatadogOutsideItsAgeWindow', async () => {
    const options = {
      ...baseOptions,
      sinkIds: ['dd_1', 'splunk_1'],
      start: '2026-07-06T17:59:59Z'
    };
    const client = apiClient({
      getIntegrationById: vi.fn(async id => id === 'dd_1' ? datadog(id) : splunk(id))
    });

    const resolved = await resolveBackfillInputs(options, client, now);

    expect(resolved.sinks.map(sink => sink.id)).toEqual(['splunk_1']);
    expect(resolved.skippedSinks).toEqual([{
      sink: datadog('dd_1'),
      reason: 'Datadog cannot backfill logs older than 18 hours'
    }]);
    const job = buildBackfillJob(options, resolved, now);
    expect(job.jobGraph.vertices[0]).toMatchObject({ vendorSinkIntegrationIds: ['splunk_1'] });
    expect(job.jobGraph.vertices.some(vertex => vertex.name === 'sink_dd_1')).toBe(false);
    expect(job.jobGraph.vertices.some(vertex => vertex.name === 'sink_splunk_1')).toBe(true);
  });

  it('test_resolveBackfillInputs_skipsNewRelicOutsideItsAgeWindow', async () => {
    const client = apiClient({
      getIntegrationById: vi.fn(async id => id === 'nr_1' ? newRelic(id) : splunk(id))
    });

    const resolved = await resolveBackfillInputs({
      ...baseOptions,
      sinkIds: ['nr_1', 'splunk_1'],
      start: '2026-07-05T11:59:59Z'
    }, client, now);

    expect(resolved.sinks.map(sink => sink.id)).toEqual(['splunk_1']);
    expect(resolved.skippedSinks).toEqual([{
      sink: newRelic('nr_1'),
      reason: 'New Relic cannot backfill logs older than 48 hours'
    }]);
  });

  it('test_resolveBackfillInputs_rejectsWhenAllSinksAreOutsideTheirAgeWindows', async () => {
    const client = apiClient({
      getIntegrationById: vi.fn(async id => id === 'dd_1' ? datadog(id) : newRelic(id))
    });

    await expect(resolveBackfillInputs({
      ...baseOptions,
      sinkIds: ['dd_1', 'nr_1'],
      start: '2026-07-05T11:59:59Z'
    }, client, now)).rejects.toThrow(
      /No sinks are eligible.*Datadog cannot backfill logs older than 18 hours.*New Relic cannot backfill logs older than 48 hours/
    );
  });

  it('test_resolveBackfillInputs_explicitDatasetIdPropagatesLookupErrors', async () => {
    const client = apiClient({
      getDataset: vi.fn(async () => {
        throw new Error('Failed to get dataset ds_raw: unauthorized');
      }),
      listDatasets: vi.fn()
    });

    await expect(resolveBackfillInputs({
      ...baseOptions,
      ...recentBackfillRange()
    }, client)).rejects.toThrow(/unauthorized/);
    expect(client.listDatasets).not.toHaveBeenCalled();
  });

  it('test_resolveBackfillInputs_explicitDatasetNameUsesNameLookup', async () => {
    const client = apiClient({
      listDatasets: vi.fn(async () => [
        { id: 'ds_other', name: 'other logs' },
        { id: 'ds_raw', name: 'raw logs', teamIds: ['team_alpha'] }
      ] as never)
    });

    const resolved = await resolveBackfillInputs({
      datasetName: 'raw logs',
      sinkIds: ['dd_1'],
      ...recentBackfillRange()
    }, client);

    expect(resolved.datasetId).toBe('ds_raw');
    expect(resolved.teamIds).toEqual(['team_alpha']);
    expect(client.getDataset).not.toHaveBeenCalled();
    expect(client.listDatasets).toHaveBeenCalledTimes(1);
  });

  it('test_resolveBackfillInputs_infersDatasetAndSinksFromRawGraph', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_template_source'],
      jobGraph: {
        vertices: [
          { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'ds_raw' },
          { type: DatadogLogSinkType.datadog_log_sink, name: 'dd', integrationId: 'dd_1' },
          { type: SplunkLogSinkType.splunk_log_sink, name: 'splunk', integrationId: 'splunk_1' }
        ],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getDataset: vi.fn(async id => ({ id, name: id, teamIds: ['team_pipeline'] } as never)),
      getJob: vi.fn(async () => sourceJob),
      getIntegrationById: vi.fn(async id => id === 'dd_1' ? datadog(id) : splunk(id))
    });

    const resolved = await resolveBackfillInputs({
      jobId: 'job_1',
      ...recentBackfillRange()
    }, client);

    expect(resolved.datasetId).toBe('ds_raw');
    expect(resolved.teamIds).toEqual(['team_pipeline']);
    expect(resolved.sinks.map(sink => sink.id)).toEqual(['dd_1', 'splunk_1']);
    expect(client.getDataset).toHaveBeenCalledWith('ds_raw');
    expect(client.listDatasets).not.toHaveBeenCalled();
    expect(client.getJob).toHaveBeenCalledWith('job_1');
  });

  it('test_resolveBackfillInputs_prefersTemplateDatasetIdOverRawSinkConfig', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_template_source'],
      jobGraph: {
        vertices: [{
          type: TemplateOperationType.template_operation,
          name: 'log_reducer_template',
          templateId: 'log-reducer',
          templateVersion: 1,
          templateInputs: {
            input: {
              datasetId: 'ds_default',
              rawSinkConfig: { datasetId: 'ds_raw' },
              sinks: [
                { sink: { type: DatadogLogSinkType.datadog_log_sink, name: 'dd', integrationId: 'dd_1' } },
                { sink: { type: SplunkLogSinkType.splunk_log_sink, name: 'splunk', integrationId: 'splunk_1' } }
              ],
              exceptions: [],
              parsers: [],
              reducer: { type: 'log-reducer', name: 'log_reducer', delimiters: [], enabledMasks: [], masks: [] },
              sources: []
            }
          }
        }],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getJob: vi.fn(async () => sourceJob),
      getIntegrationById: vi.fn(async id => id === 'dd_1' ? datadog(id) : splunk(id))
    });

    const resolved = await resolveBackfillInputs({
      jobId: 'job_1',
      ...recentBackfillRange()
    }, client);

    expect(resolved.datasetId).toBe('ds_default');
    expect(client.getDataset).toHaveBeenCalledWith('ds_default');
    expect(resolved.teamIds).toEqual(['team_template_source']);
    expect(resolved.sinks.map(sink => sink.id)).toEqual(['dd_1', 'splunk_1']);
  });

  it('test_resolveBackfillInputs_rejectsUnsupportedSink', async () => {
    const client = apiClient({
      getIntegrationById: vi.fn(async () => dataWarehouse())
    });

    await expect(resolveBackfillInputs(baseOptions, client)).rejects.toThrow(/not a supported logs sink/);
  });

  it('test_resolveBackfillInputs_dedupesDuplicateSinkIds', async () => {
    const range = recentBackfillRange();
    const client = apiClient({
      getIntegrationById: vi.fn(async id => datadog(id))
    });

    const resolved = await resolveBackfillInputs({
      datasetId: 'ds_raw',
      sinkIds: ['dd_1', 'dd_1'],
      ...range
    }, client);
    expect(resolved.sinks.map(sink => sink.id)).toEqual(['dd_1']);

    const job = buildBackfillJob({ datasetId: 'ds_raw', sinkIds: ['dd_1', 'dd_1'], ...range }, resolved);
    expect(job.jobGraph.vertices.filter(vertex => vertex.name === 'sink_dd_1')).toHaveLength(1);
    expect(job.jobGraph.edges).toEqual([
      'source -> backfill_sink_dd_1_filter',
      'backfill_sink_dd_1_filter -> sink_dd_1',
      'sink_dd_1 -> vendorlog_event_dedup_sink_dd_1_iceberg_sink'
    ]);
  });

  it('test_resolveBackfillInputs_dedupesRepeatedSinkIntegrationInPipeline', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_pipeline'],
      jobGraph: {
        vertices: [
          { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'ds_raw' },
          { type: DatadogLogSinkType.datadog_log_sink, name: 'dd_a', integrationId: 'dd_1' },
          { type: DatadogLogSinkType.datadog_log_sink, name: 'dd_b', integrationId: 'dd_1' }
        ],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getDataset: vi.fn(async id => ({ id, name: id } as never)),
      getJob: vi.fn(async () => sourceJob),
      getIntegrationById: vi.fn(async id => datadog(id))
    });

    const resolved = await resolveBackfillInputs({ jobId: 'job_1', ...recentBackfillRange() }, client);
    expect(resolved.sinks.map(sink => sink.id)).toEqual(['dd_1']);
  });

  it('test_resolveBackfillInputs_rejectsStoreOnlyPipeline', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_pipeline'],
      jobGraph: {
        vertices: [
          { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'ds_raw' }
        ],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getDataset: vi.fn(async id => ({ id, name: id } as never)),
      getJob: vi.fn(async () => sourceJob)
    });

    await expect(resolveBackfillInputs({ jobId: 'job_1', ...recentBackfillRange() }, client))
      .rejects.toThrow(/No supported log sinks/);
  });

  it('test_resolveBackfillInputs_rejectsMissingOrDuplicateRawSink', async () => {
    const jobWithRawSinks = (count: number) => ({
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_pipeline'],
      jobGraph: {
        vertices: [
          ...Array.from({ length: count }, (_, index) => ({
            type: 'logs-iceberg-table-sink',
            name: `raw_data_sink_${index}`,
            datasetId: 'ds_raw'
          })),
          { type: DatadogLogSinkType.datadog_log_sink, name: 'dd', integrationId: 'dd_1' }
        ],
        edges: []
      }
    } as SchemaReadJob);

    for (const count of [0, 2]) {
      const client = apiClient({
        getJob: vi.fn(async () => jobWithRawSinks(count)),
        getIntegrationById: vi.fn(async id => datadog(id))
      });
      await expect(resolveBackfillInputs({ jobId: 'job_1', ...recentBackfillRange() }, client))
        .rejects.toThrow(/exactly one raw logs data lake sink/);
    }
  });

  it('test_resolveBackfillInputs_rejectsUnsupportedTemplate', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_template_source'],
      jobGraph: {
        vertices: [{
          type: TemplateOperationType.template_operation,
          name: 'traces_template',
          templateId: 'traces',
          templateVersion: 1,
          templateInputs: {
            input: {
              datasetId: 'ds_raw',
              sinks: []
            }
          }
        }],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getJob: vi.fn(async () => sourceJob)
    });

    await expect(resolveBackfillInputs({ jobId: 'job_1', ...recentBackfillRange() }, client))
      .rejects.toThrow('Template traces is not supported for logs backfill');
  });

  it('test_resolveBackfillInputs_templateFallsBackToRawSinkConfigDatasetId', async () => {
    const sourceJob = {
      id: 'job_1',
      name: 'pipeline',
      teamIds: ['team_template_source'],
      jobGraph: {
        vertices: [{
          type: TemplateOperationType.template_operation,
          name: 'log_reducer_template',
          templateId: 'log-reducer',
          templateVersion: 1,
          templateInputs: {
            input: {
              rawSinkConfig: { datasetId: 'ds_fallback' },
              sinks: [
                { sink: { type: DatadogLogSinkType.datadog_log_sink, name: 'dd', integrationId: 'dd_1' } }
              ],
              exceptions: [],
              parsers: [],
              reducer: { type: 'log-reducer', name: 'log_reducer', delimiters: [], enabledMasks: [], masks: [] },
              sources: []
            }
          }
        }],
        edges: []
      }
    } as SchemaReadJob;
    const client = apiClient({
      getDataset: vi.fn(async id => ({ id, name: id } as never)),
      getJob: vi.fn(async () => sourceJob),
      getIntegrationById: vi.fn(async id => datadog(id))
    });

    const resolved = await resolveBackfillInputs({ jobId: 'job_1', ...recentBackfillRange() }, client);
    expect(resolved.datasetId).toBe('ds_fallback');
    expect(client.getDataset).toHaveBeenCalledWith('ds_fallback');
  });
});
