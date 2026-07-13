/**
 * Test fixtures and helpers for creating job definitions in tests.
 *
 * These helpers use proper enum types to avoid TypeScript errors
 * while keeping test code readable.
 */

import {
  DatadogLogAgentSourceType,
  DatadogLogSinkType,
  SplunkLogSinkType,
  LogsFilterType,
  LogsIcebergTableSourceType,
  LogsIcebergTableSinkType,
  LogsSynchronousSinkType,
  LogsBranchType,
  DatadogQueryPredicateType,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType,
  TagActionModification,
  TagActionType,
  LogTransformActionType,
  LogAttributesRemapperType,
  LogReducerType,
  JsonLogProcessorType,
  TemplateOperationType,
  PathsV1JobsGetParametersQueryState,
  type SchemaOperation,
  type SchemaLogsIcebergTableSource,
  type SchemaDatadogQueryPredicate,
  type SchemaReadJob,
  type SchemaUpdateJob,
  type SchemaLogReducerTemplateInput,
  type SchemaReadDatadog,
  type SchemaReadNewRelic,
  type SchemaReadOtlp,
  type SchemaReadSplunk,
  type SchemaReadSumo
} from '@/openapi/openApiTypes.js';
import { DEFAULT_LIMIT } from '@/types.js';

/**
 * Creates a Datadog log agent source.
 */
export function createDatadogSource(name: string, integrationId: string): SchemaOperation {
  return {
    type: DatadogLogAgentSourceType.datadog_log_agent_source,
    name,
    integrationId
  };
}

/**
 * Creates a Datadog log sink.
 */
export function createDatadogSink(name: string, integrationId: string): SchemaOperation {
  return {
    type: DatadogLogSinkType.datadog_log_sink,
    name,
    integrationId
  };
}

/**
 * Creates a Splunk log sink.
 */
export function createSplunkSink(name: string, integrationId: string): SchemaOperation {
  return {
    type: SplunkLogSinkType.splunk_log_sink,
    name,
    integrationId
  };
}

/**
 * Creates an Iceberg table source.
 */
export function createIcebergSource(name: string, datasetId: string, start?: string, end?: string, limit?: number, query?: SchemaDatadogQueryPredicate): SchemaLogsIcebergTableSource {
  return {
    type: LogsIcebergTableSourceType.logs_iceberg_table_source,
    name,
    datasetId,
    query: query || {
      type: DatadogQueryPredicateType.datadog_query,
      query: ''
    },
    start: start || '',
    end: end || '',
    limit: limit ?? DEFAULT_LIMIT,
  };
}

/**
 * Creates an Iceberg table sink.
 */
export function createIcebergSink(name: string, datasetId: string): SchemaOperation {
  return {
    type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
    name,
    datasetId
  };
}

/**
 * Creates a synchronous sink.
 */
export function createSyncSink(name: string): SchemaOperation {
  return {
    type: LogsSynchronousSinkType.logs_sync_sink,
    name
  };
}

/**
 * Creates a logs filter operation.
 */
export function createFilter(name: string, query: string): SchemaOperation {
  return {
    type: LogsFilterType.logs_filter,
    name,
    predicate: {
      type: DatadogQueryPredicateType.datadog_query,
      query
    }
  };
}

export function recentBackfillRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

interface IntegrationFixtureOptions<T> {
  name?: string;
  teamIds?: string[];
  payload?: Partial<T>;
}

export function createDatadogIntegration(
  id = 'dd_1',
  options: IntegrationFixtureOptions<NonNullable<SchemaReadDatadog['payload']>> = {}
): SchemaReadDatadog {
  return {
    id,
    type: ReadDatadogType.datadog,
    name: options.name ?? id,
    ...(options.teamIds ? { teamIds: options.teamIds } : {}),
    payload: {
      additionalTags: [],
      filterQuery: '',
      site: 'datadoghq.com',
      ...options.payload
    }
  } as SchemaReadDatadog;
}

export function createSplunkIntegration(
  id = 'splunk_1',
  options: IntegrationFixtureOptions<NonNullable<SchemaReadSplunk['payload']>> = {}
): SchemaReadSplunk {
  return {
    id,
    type: ReadSplunkType.splunk,
    name: options.name ?? id,
    ...(options.teamIds ? { teamIds: options.teamIds } : {}),
    payload: {
      additionalTags: [],
      filterQuery: '',
      splunkHost: 'splunk.example.com',
      secure: true,
      ...options.payload
    }
  } as SchemaReadSplunk;
}

export function createNewRelicIntegration(
  id = 'nr_1',
  options: IntegrationFixtureOptions<NonNullable<SchemaReadNewRelic['payload']>> = {}
): SchemaReadNewRelic {
  return {
    id,
    type: ReadNewRelicType.newrelic,
    name: options.name ?? id,
    ...(options.teamIds ? { teamIds: options.teamIds } : {}),
    payload: {
      accountId: '1234567',
      site: 'newrelic.com',
      ...options.payload
    }
  } as SchemaReadNewRelic;
}

export function createSumoIntegration(
  id = 'sumo_1',
  options: IntegrationFixtureOptions<NonNullable<SchemaReadSumo['payload']>> = {}
): SchemaReadSumo {
  return {
    id,
    type: ReadSumoType.sumo,
    name: options.name ?? id,
    ...(options.teamIds ? { teamIds: options.teamIds } : {}),
    payload: { ...options.payload }
  } as SchemaReadSumo;
}

export function createOtlpIntegration(
  id = 'otlp_1',
  options: IntegrationFixtureOptions<NonNullable<SchemaReadOtlp['payload']>> = {}
): SchemaReadOtlp {
  return {
    id,
    type: ReadOtlpType.otlp,
    name: options.name ?? id,
    ...(options.teamIds ? { teamIds: options.teamIds } : {}),
    payload: {
      endpoint: 'https://otlp.example.com:4318',
      logsEndpoint: 'https://logs.example.com:4318/v1/logs',
      ...options.payload
    }
  } as SchemaReadOtlp;
}

/**
 * Creates a branch operation.
 */
export function createBranch(name: string, query = ''): SchemaOperation {
  return {
    type: LogsBranchType.logs_branch,
    name,
    predicate: {
      type: DatadogQueryPredicateType.datadog_query,
      query
    }
  };
}

/**
 * Creates a log transform operation.
 */
export function createTransform(name: string): SchemaOperation {
  return {
    type: LogTransformActionType.log_transform,
    name,
    transforms: []
  };
}

/**
 * Creates a test tagging operation.
 */
export function createTestTagOp(name: string, testRunId: string, sinkName: string): SchemaOperation {
  return {
    type: LogTransformActionType.log_transform,
    name,
    transforms: [
      {
        order: 0,
        type: TagActionType.tag_action,
        modification: TagActionModification.ADD,
        tagKey: 'grepr.test_run_id',
        values: [testRunId]
      },
      {
        order: 1,
        type: TagActionType.tag_action,
        modification: TagActionModification.ADD,
        tagKey: 'grepr.test_sink',
        values: [sinkName]
      }
    ]
  };
}

/**
 * Builds a full LogReducerTemplateInput from a partial override, filling in the
 * default reducer/empty collections expected by template-backed pipeline tests.
 */
export function buildTemplateInput(input: Partial<SchemaLogReducerTemplateInput> = {}): SchemaLogReducerTemplateInput {
  return {
    exceptions: [], parsers: [],
    reducer: { delimiters: [' '], enabledMasks: [], masks: [], name: 'log_reducer', type: 'log-reducer' } as never,
    sources: [],
    ...input,
  } as SchemaLogReducerTemplateInput;
}

/**
 * Construct a template-backed pipeline job for tests. The shape mirrors what
 * the API returns for an unresolved job: jobGraph contains exactly one
 * template-operation vertex whose templateInputs.input is a
 * LogReducerTemplateInput.
 */
export function makeTemplateJob(
  input: Partial<SchemaLogReducerTemplateInput> = {},
  version = 7,
  processing = 'STREAMING',
): SchemaReadJob {
  return {
    id: 'job_test', name: 'p', organizationId: 'grepr', version,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    desiredState: PathsV1JobsGetParametersQueryState.RUNNING, state: PathsV1JobsGetParametersQueryState.RUNNING,
    execution: 'ASYNCHRONOUS', processing, tags: {},
    jobGraph: { vertices: [{
      type: TemplateOperationType.template_operation, name: 'log_reducer_template',
      templateId: 'log-reducer', templateVersion: 1, draftMode: false,
      templateInputs: { input: buildTemplateInput(input) as unknown as Record<string, never> },
    } as never], edges: [] },
  } as unknown as SchemaReadJob;
}

/** Build a SchemaUpdateJob containing a template-operation vertex with the given input. */
export function makeTemplateUpdate(input: Partial<SchemaLogReducerTemplateInput> = {}, fromVersion = 1): SchemaUpdateJob {
  return {
    desiredState: PathsV1JobsGetParametersQueryState.RUNNING, fromVersion,
    jobGraph: { vertices: [{
      type: TemplateOperationType.template_operation, name: 'log_reducer_template',
      templateId: 'log-reducer', templateVersion: 1,
      templateInputs: { input: buildTemplateInput(input) as unknown as Record<string, never> },
    } as never], edges: [] },
  } as unknown as SchemaUpdateJob;
}

/**
 * Build a non-template (job-graph) pipeline job for tests. The shape mirrors
 * what the API returns for a resolved/non-template job: jobGraph.vertices
 * contains parser/remapper/reducer operations directly, with no
 * template-operation wrapper.
 */
export function makeJobGraphJob(overrides?: { vertices?: Record<string, unknown>[]; edges?: string[] }, version = 3): SchemaReadJob {
  const defaultVertices: Record<string, unknown>[] = [
    { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper', messageReservedAttributes: ['message', 'msg'] },
    { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
  ];
  return {
    id: 'job_jg',
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
    jobGraph: {
      vertices: (overrides?.vertices ?? defaultVertices) as never[],
      edges: overrides?.edges ?? [],
    },
  } as unknown as SchemaReadJob;
}

export function makeUiRawJobGraphJob(overrides?: { vertices?: Record<string, unknown>[]; edges?: string[] }): SchemaReadJob {
  const vertices: Record<string, unknown>[] = [
    { type: 'logs-iceberg-table-source', name: 'src', datasetId: 'raw_ds' },
    {
      type: LogsFilterType.logs_filter,
      name: 'pre_parser_filter',
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' },
    },
    { type: JsonLogProcessorType.json_log_processor, name: 'json_log_processor' },
    { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper' },
    {
      type: LogsFilterType.logs_filter,
      name: 'pre_data_warehouse_filter',
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' },
    },
    {
      type: LogsFilterType.logs_filter,
      name: 'pre_exceptions_filter',
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' },
    },
    { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
    { type: 'logs-sync-sink', name: 'sink' },
  ];
  const edges = [
    'src -> pre_parser_filter',
    'pre_parser_filter -> json_log_processor',
    'json_log_processor -> log_attributes_remapper',
    'log_attributes_remapper -> pre_data_warehouse_filter',
    'pre_data_warehouse_filter -> pre_exceptions_filter',
    'pre_exceptions_filter -> log_reducer',
    'log_reducer -> sink',
  ];
  return makeJobGraphJob({
    vertices: overrides?.vertices ?? vertices,
    edges: overrides?.edges ?? edges,
  });
}

export function findJobGraphVertex(update: { jobGraph?: { vertices?: { name?: string }[] } }, name: string): Record<string, unknown> {
  const v = update.jobGraph?.vertices?.find(vert => vert.name === name);
  if (!v) throw new Error(`vertex ${name} not found in update`);
  return v as unknown as Record<string, unknown>;
}
