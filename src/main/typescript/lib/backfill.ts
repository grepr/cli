import {
  DatadogLogSinkType,
  DatadogQueryPredicateType,
  LogsBackfillFlinkSourceType,
  LogsFilterType,
  LogsIcebergTableSinkType,
  NewRelicLogSinkType,
  OtlpLogSinkType,
  PathsV1JobsGetParametersQueryExecution,
  PathsV1JobsGetParametersQueryProcessing,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType,
  SplunkLogSinkType,
  SumoLogSinkType,
  TemplateOperationType,
  VendorLogEventDedupIcebergTableSinkType,
  type SchemaCreateJob,
  type SchemaDatasetRead,
  type SchemaLogReducerTemplateInput,
  type SchemaLogsBackfillFlinkSource,
  type SchemaOperation,
  type SchemaReadJob,
  type SchemaTemplate
} from '../openapi/openApiTypes.js';
import type { IntegrationReadType } from '../types.js';
import {
  findBackfillVendorByIntegrationType,
  isBackfillLogSink,
  isSupportedBackfillIntegrationType,
  type BackfillLogSink
} from './backfill-vendors.js';
import { buildLanguageQueryPredicate } from './query-predicate.js';
import type { LanguageQueryType } from './query-predicate.js';
import { requireTimestampRange } from './time-utils.js';

const DEFAULT_LIMIT = 10000;
const HOUR_MS = 60 * 60 * 1000;
const RAW_DATA_LAKE_SINK_NAME_PREFIX = 'raw_data_sink';
const LOG_REDUCER_TEMPLATE_NAME = 'log-reducer-job-graph-template';
const BACKFILL_TAGS = {
  type: 'backfill',
  backfillType: 'manual'
};

export interface BackfillCommandInputs {
  jobId?: string;
  datasetId?: string;
  datasetName?: string;
  sinkIds?: string[];
  start?: string;
  end?: string;
  query?: string;
  queryType?: LanguageQueryType;
  limit?: number;
  tags?: string[];
}

export interface BackfillApiClient {
  getJob(id: string, version?: number, resolved?: boolean): Promise<SchemaReadJob | undefined>;
  getTemplate(id: string, version: number): Promise<SchemaTemplate>;
  listDatasets(): Promise<SchemaDatasetRead[] | undefined>;
  getDataset(id: string): Promise<SchemaDatasetRead | undefined>;
  getIntegrationById(id: string): Promise<IntegrationReadType | null>;
  createAsyncJob(job: SchemaCreateJob): Promise<SchemaReadJob | undefined>;
}

interface BackfillJobInputs {
  datasetId: string;
  teamIds: string[];
  sinks: IntegrationReadType[];
}

interface SkippedBackfillSink {
  sink: IntegrationReadType;
  reason: string;
}

interface BackfillResolvedInputs extends BackfillJobInputs {
  skippedSinks: SkippedBackfillSink[];
}

interface BackfillSourceConfig {
  datasetId: string;
  sinkOperations: SchemaOperation[];
}

/**
 * Validates the mutually exclusive backfill modes and shared command bounds
 * before any API lookups or job graph construction happens.
 */
export function validateBackfillInputs(options: BackfillCommandInputs): void {
  const hasPipeline = Boolean(options.jobId);
  const hasDataset = Boolean(options.datasetId || options.datasetName);

  if (options.datasetId && options.datasetName) {
    throw new Error('Cannot specify both --dataset-id and --dataset-name');
  }
  if (hasPipeline && hasDataset) {
    throw new Error('Cannot specify explicit dataset flags with --job-id');
  }
  if (hasPipeline && options.sinkIds && options.sinkIds.length > 0) {
    throw new Error('Cannot specify --sink-id with --job-id');
  }
  if (!hasPipeline && !hasDataset) {
    throw new Error('Specify --job-id, --dataset-id, or --dataset-name');
  }
  if (!hasPipeline && (!options.sinkIds || options.sinkIds.length === 0)) {
    throw new Error('Explicit mode requires at least one --sink-id');
  }
  validateLimit(options.limit);
  requireTimestampRange(options);
  buildLanguageQueryPredicate(options);

  const tags = options.tags ?? [];
  tags.forEach(validateTag);
}

/**
 * Resolves CLI references into the concrete raw logs dataset and vendor log
 * sinks that the backfill job should read from and replay to.
 */
export async function resolveBackfillInputs(
  options: BackfillCommandInputs,
  apiClient: BackfillApiClient,
  now = new Date()
): Promise<BackfillResolvedInputs> {
  validateBackfillInputs(options);
  const startDate = requireTimestampRange(options).startDate;
  let dataset: { id: string; teamIds: string[] };
  let sinkIds: string[];

  if (options.jobId) {
    const job = await resolveSourceJob(options, apiClient);
    const source = await inferBackfillSource(job, apiClient);
    dataset = await resolveDataset(source.datasetId, apiClient, 'id', job.teamIds);
    sinkIds = inferSinkIds(source.sinkOperations);
    if (sinkIds.length === 0) {
      throw new Error(`No supported log sinks found in source job ${job.id ?? job.name}`);
    }
  } else {
    dataset = await resolveDatasetFromOptions(options, apiClient);
    sinkIds = options.sinkIds ?? [];
  }

  return buildResolvedInputs(dataset, await resolveSinks(sinkIds, apiClient), startDate, now);
}

/**
 * Builds the asynchronous batch job graph used for manual logs backfills,
 * including per-sink duplicate-delivery filters and vendor dedup sinks.
 */
export function buildBackfillJob(
  options: BackfillCommandInputs,
  resolved: BackfillJobInputs,
  now = new Date()
): SchemaCreateJob {
  validateBackfillInputs(options);
  validateResolvedSinks(resolved.sinks);
  const timeRange = requireTimestampRange(options);

  const limit = options.limit ?? DEFAULT_LIMIT;
  const vendorSinkIntegrationIds = resolved.sinks.map(sink => sink.id);
  const source: SchemaLogsBackfillFlinkSource = {
    type: LogsBackfillFlinkSourceType.logs_backfill_iceberg_table_source,
    name: 'source',
    datasetId: resolved.datasetId,
    start: timeRange.start,
    end: timeRange.end,
    query: buildLanguageQueryPredicate(options),
    vendorSinkIntegrationIds,
    limit
  };

  const vertices: SchemaOperation[] = [source];
  const edges: string[] = [];
  const sinkTags = buildVendorTags(options.tags ?? [], now);

  resolved.sinks.forEach(sink => {
    const filterName = `backfill_sink_${sink.id}_filter`;
    const sinkName = `sink_${sink.id}`;
    const dedupName = `vendorlog_event_dedup_${sinkName}_iceberg_sink`;

    vertices.push({
      type: LogsFilterType.logs_filter,
      name: filterName,
      predicate: {
        type: DatadogQueryPredicateType.datadog_query,
        query: `-@meta.grepr.sentVendors:${sink.id}`
      }
    });
    vertices.push(buildVendorSink(sink, sinkName, sinkTags));
    vertices.push({
      type: VendorLogEventDedupIcebergTableSinkType.vendorlog_event_dedup_iceberg_table_sink,
      name: dedupName,
      datasetId: resolved.datasetId,
      vendorSinkId: sink.id
    });

    edges.push(`source -> ${filterName}`);
    edges.push(`${filterName} -> ${sinkName}`);
    edges.push(`${sinkName} -> ${dedupName}`);
  });

  return {
    name: formatBackfillJobName(now),
    execution: PathsV1JobsGetParametersQueryExecution.ASYNCHRONOUS,
    processing: PathsV1JobsGetParametersQueryProcessing.BATCH,
    tags: BACKFILL_TAGS,
    teamIds: resolved.teamIds,
    jobGraph: {
      vertices,
      edges
    }
  };
}

async function resolveSourceJob(
  options: BackfillCommandInputs,
  apiClient: BackfillApiClient
): Promise<SchemaReadJob> {
  if (!options.jobId) {
    throw new Error('--job-id is required');
  }

  const job = await apiClient.getJob(options.jobId);
  if (!job) {
    throw new Error(`Job not found: ${options.jobId}`);
  }
  return job;
}

async function resolveDatasetFromOptions(
  options: BackfillCommandInputs,
  apiClient: BackfillApiClient
): Promise<{ id: string; teamIds: string[] }> {
  if (options.datasetId) {
    return resolveDataset(options.datasetId, apiClient, 'id');
  }

  if (!options.datasetName) {
    throw new Error('--dataset-name is required');
  }
  return resolveDataset(options.datasetName, apiClient, 'name');
}

async function resolveDataset(
  datasetReference: string,
  apiClient: BackfillApiClient,
  referenceType: 'id' | 'name',
  fallbackTeamIds: string[] = []
): Promise<{ id: string; teamIds: string[] }> {
  const dataset = referenceType === 'id'
    ? await apiClient.getDataset(datasetReference)
    : await findDatasetByName(datasetReference, apiClient);
  if (!dataset?.id) {
    throw new Error(`Dataset not found: ${datasetReference}`);
  }
  return {
    id: dataset.id,
    teamIds: dataset.teamIds ?? fallbackTeamIds
  };
}

async function findDatasetByName(
  datasetName: string,
  apiClient: BackfillApiClient
): Promise<SchemaDatasetRead | undefined> {
  const datasets = await apiClient.listDatasets();
  return datasets?.find(dataset => dataset.name === datasetName);
}

async function resolveSinks(
  sinkIds: string[],
  apiClient: BackfillApiClient
): Promise<IntegrationReadType[]> {
  const sinks: IntegrationReadType[] = [];
  for (const sinkId of [...new Set(sinkIds)]) {
    const sink = await apiClient.getIntegrationById(sinkId);
    if (!sink) {
      throw new Error(`Could not load sink integration ${sinkId}. It may not exist, you may not have access, or the request may have failed.`);
    }
    if (!isSupportedBackfillIntegrationType(sink.type)) {
      throw new Error(`Integration ${sinkId} is not a supported logs sink`);
    }
    sinks.push(sink);
  }
  validateResolvedSinks(sinks);
  return sinks;
}

function validateResolvedSinks(sinks: IntegrationReadType[]): void {
  sinks.forEach(sink => {
    if (!isSupportedBackfillIntegrationType(sink.type)) {
      throw new Error(`Integration ${sink.id} is not a supported logs sink`);
    }
  });
}

function adaptJobGraph(job: SchemaReadJob): BackfillSourceConfig {
  const rawSinks = job.jobGraph.vertices.filter(isRawDataLakeSink);
  if (rawSinks.length !== 1) {
    throw new Error(`Source job ${job.id ?? job.name} must have exactly one raw logs data lake sink`);
  }
  const datasetId = rawSinks[0]?.datasetId;
  if (!datasetId) {
    throw new Error(`Source job ${job.id ?? job.name} raw data lake sink has no datasetId`);
  }
  return {
    datasetId,
    sinkOperations: job.jobGraph.vertices
  };
}

function inferSinkIds(operations: SchemaOperation[]): string[] {
  return operations
    .filter(isBackfillLogSink)
    .map(sink => sink.integrationId)
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

async function inferBackfillSource(
  job: SchemaReadJob,
  apiClient: BackfillApiClient
): Promise<BackfillSourceConfig> {
  const templateOperation = job.jobGraph.vertices.find(
    vertex => vertex.type === TemplateOperationType.template_operation
  );
  if (!templateOperation || templateOperation.type !== TemplateOperationType.template_operation) {
    return adaptJobGraph(job);
  }

  const template = await apiClient.getTemplate(
    templateOperation.templateId,
    templateOperation.templateVersion
  );

  switch (template.name) {
    case LOG_REDUCER_TEMPLATE_NAME: {
      const templateInput = templateOperation.templateInputs?.input as
        SchemaLogReducerTemplateInput | undefined;
      const datasetId = templateInput?.datasetId ?? templateInput?.rawSinkConfig?.datasetId;
      if (!datasetId) {
        throw new Error('Log reducer template has no raw logs dataset');
      }

      return {
        datasetId,
        sinkOperations: (templateInput?.sinks ?? [])
          .map(templateSink => templateSink.sink)
          .filter(isOperation)
      };
    }
    default:
      throw new Error(
        `Template ${template.name} (${templateOperation.templateId}) is not supported for logs backfill`
      );
  }
}

function isRawDataLakeSink(
  vertex: SchemaOperation
): vertex is SchemaOperation & { datasetId: string } {
  return vertex.type === LogsIcebergTableSinkType.logs_iceberg_table_sink &&
    vertex.name.startsWith(RAW_DATA_LAKE_SINK_NAME_PREFIX);
}

function isOperation(value: SchemaOperation | undefined): value is SchemaOperation {
  return value !== undefined;
}

function buildVendorSink(
  integration: IntegrationReadType,
  name: string,
  tags: string[]
): BackfillLogSink {
  switch (integration.type) {
    case ReadDatadogType.datadog:
      return {
        type: DatadogLogSinkType.datadog_log_sink,
        name,
        integrationId: integration.id,
        additionalTags: tags
      };
    case ReadSplunkType.splunk:
      return {
        type: SplunkLogSinkType.splunk_log_sink,
        name,
        integrationId: integration.id,
        additionalTags: tags
      };
    case ReadNewRelicType.newrelic:
      return {
        type: NewRelicLogSinkType.newrelic_log_sink,
        name,
        integrationId: integration.id,
        additionalAttributes: tagsToAttributes(tags)
      };
    case ReadSumoType.sumo:
      return {
        type: SumoLogSinkType.sumologic_log_sink,
        name,
        integrationId: integration.id,
        additionalAttributes: tagsToAttributes(tags)
      };
    case ReadOtlpType.otlp:
      return {
        type: OtlpLogSinkType.otlp_log_sink,
        name,
        integrationId: integration.id,
        additionalAttributes: tagsToAttributes(tags)
      };
    default:
      throw new Error(`Integration ${integration.id} is not a supported logs sink`);
  }
}

function buildVendorTags(tags: string[], now: Date): string[] {
  return [
    `grepr.backfilled.timestamp:${now.toISOString()}`,
    'grepr.backfilled:true',
    'processor:grepr',
    ...tags
  ];
}

function formatBackfillJobName(now: Date): string {
  return `backfill-${now.toISOString()}`.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

function tagsToAttributes(tags: string[]): Record<string, string> {
  return Object.fromEntries(tags.map(splitTag));
}

function splitTag(tag: string): [string, string] {
  const separator = tag.indexOf(':');
  if (separator <= 0) {
    throw new Error(`Invalid --tag value "${tag}". Expected key:value.`);
  }
  return [tag.slice(0, separator), tag.slice(separator + 1)];
}

function validateTag(tag: string): void {
  splitTag(tag);
}

function validateLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < -1) {
    throw new Error('--limit must be an integer greater than or equal to -1');
  }
}

/**
 * Removes sinks that cannot accept the requested time window while preserving
 * the reasons so the command can report partial backfill behavior.
 */
function findBackfillEligibleSinks(
  sinks: IntegrationReadType[],
  startDate: Date,
  now: Date
): { eligibleSinks: IntegrationReadType[]; skippedSinks: SkippedBackfillSink[] } {
  const eligibleSinks: IntegrationReadType[] = [];
  const skippedSinks: SkippedBackfillSink[] = [];

  sinks.forEach(sink => {
    const vendor = findBackfillVendorByIntegrationType(sink.type);
    if (!vendor) {
      eligibleSinks.push(sink);
      return;
    }
    const maxAgeHours = vendor.maxBackfillAgeHours;
    if (maxAgeHours === undefined ||
        startDate.getTime() >= now.getTime() - maxAgeHours * HOUR_MS) {
      eligibleSinks.push(sink);
      return;
    }
    skippedSinks.push({
      sink,
      reason: `${vendor.vendorName} cannot backfill logs older than ${maxAgeHours} hours`
    });
  });

  return { eligibleSinks, skippedSinks };
}

function buildResolvedInputs(
  dataset: { id: string; teamIds: string[] },
  sinks: IntegrationReadType[],
  startDate: Date,
  now: Date
): BackfillResolvedInputs {
  const { eligibleSinks, skippedSinks } = findBackfillEligibleSinks(sinks, startDate, now);
  if (eligibleSinks.length === 0) {
    const reasons = skippedSinks
      .map(({ sink, reason }) => `${sink.name} (${sink.id}): ${reason}`)
      .join('; ');
    throw new Error(`No sinks are eligible for the requested backfill window. ${reasons}`);
  }

  return {
    datasetId: dataset.id,
    teamIds: [...new Set([...dataset.teamIds, ...eligibleSinks.flatMap(sink => sink.teamIds ?? [])])],
    sinks: eligibleSinks,
    skippedSinks
  };
}
