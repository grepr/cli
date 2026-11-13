/**
 * Test fixtures and helpers for creating job definitions in tests.
 *
 * These helpers use proper enum types to avoid TypeScript errors
 * while keeping test code readable.
 */

import {
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType,
  LogAttributesRemapperType,
  LogReducerType,
  TemplateOperationType,
  PathsV1JobsGetParametersQueryState,
  type SchemaReadJob,
  type SchemaUpdateJob,
  type SchemaLogReducerTemplateInput,
  type SchemaReadDatadog,
  type SchemaReadNewRelic,
  type SchemaReadOtlp,
  type SchemaReadSplunk,
  type SchemaReadSumo
} from '@/openapi/openApiTypes.js';

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
 * Build a raw job graph pipeline job: jobGraph.vertices holds the remapper and
 * reducer operations directly, with no template-operation vertex. The CLI
 * rejects this shape.
 */
export function makeRawJobGraphJob(): SchemaReadJob {
  return {
    id: 'job_jg',
    name: 'p',
    organizationId: 'grepr',
    version: 3,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
    state: PathsV1JobsGetParametersQueryState.RUNNING,
    execution: 'ASYNCHRONOUS',
    processing: 'STREAMING',
    tags: {},
    jobGraph: {
      vertices: [
        { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper', messageReservedAttributes: ['message', 'msg'] },
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
      ] as never[],
      edges: ['log_attributes_remapper -> log_reducer'],
    },
  } as unknown as SchemaReadJob;
}

