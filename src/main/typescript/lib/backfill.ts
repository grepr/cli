import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogLogSinkType,
  DatadogTraceSinkType,
  NewRelicLogSinkType,
  OtlpLogSinkType,
  OtlpTraceSinkType,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType,
  SplunkLogSinkType,
  SqlOperationInputs,
  SqlOperationType,
  SqlOutputStatementType,
  SqlViewStatementType,
  SumoLogSinkType,
  type SchemaCreateBackfillJob,
  type SchemaDatadogTraceSink,
  type SchemaOperation,
  type SchemaOtlpTraceSink,
  type SchemaSqlOperation
} from '../openapi/openApiTypes.js';
import type { IntegrationReadType } from '../types.js';
import {
  findBackfillVendorByIntegrationType,
  isBackfillLogSink,
  isBackfillTraceSink,
  isSupportedBackfillIntegrationType,
  type BackfillLogSink
} from './backfill-vendors.js';
import {
  buildSignalPredicate,
  validateSpanBackfillQuery,
  type BuiltSignalPredicate,
  type LanguageQueryType
} from './query-predicate.js';
import {
  resolveSignalSource,
  validateSignalSourceInputs,
  type SignalDataType,
  type SignalSourceApiClient,
  type SignalSourceInputs
} from './signal-source.js';
import { requireTimestampRange } from './time-utils.js';

const DEFAULT_LIMIT = 10000;
const HOUR_MS = 60 * 60 * 1000;
const PROCESSOR_TAG = 'processor:grepr';
const OPERATION_NAME_PATTERN = /^[a-z0-9_]{1,128}$/;
const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SQL_OUTPUT_NAME_PATTERN = /^(?=.*_)[A-Za-z_][A-Za-z0-9_]*$/;
const BACKFILL_TAGS = {
  type: 'backfill',
  backfillType: 'manual'
};

export interface BackfillCommandInputs extends SignalSourceInputs {
  sinkIds?: string[];
  start?: string;
  end?: string;
  query?: string;
  queryType?: LanguageQueryType;
  limit?: number;
  tags?: string[];
  sqlOperation?: SchemaSqlOperation;
  preserveSql?: boolean;
}

export interface BackfillApiClient extends SignalSourceApiClient {
  getIntegrationById(id: string): Promise<IntegrationReadType | null>;
}

interface BackfillJobInputs {
  dataType: SignalDataType;
  datasetId: string;
  teamIds: string[];
  sinks: IntegrationReadType[];
  sqlOperation?: SchemaSqlOperation;
}

interface SkippedBackfillSink {
  sink: IntegrationReadType;
  reason: string;
}

export interface BackfillResolvedInputs extends BackfillJobInputs {
  skippedSinks: SkippedBackfillSink[];
}

export function validateBackfillInputs(options: BackfillCommandInputs): void {
  validateSignalSourceInputs(options);
  const hasJob = Boolean(options.jobId);

  if (hasJob && options.sinkIds && options.sinkIds.length > 0) {
    throw new Error('Cannot specify --sink-id with --job-id');
  }
  if (!hasJob && (!options.sinkIds || options.sinkIds.length === 0)) {
    throw new Error('Explicit mode requires at least one --sink-id');
  }
  if (options.sqlOperation && options.preserveSql) {
    throw new Error('--sql-operation and --preserve-sql are mutually exclusive');
  }
  if (options.preserveSql && !hasJob) {
    throw new Error('--preserve-sql requires --job-id');
  }

  validateLimit(options.limit);
  requireTimestampRange(options);
  options.tags?.forEach(validateTag);

  if (options.dataType) {
    validateForDataType(options, options.dataType);
  }
  if (options.sqlOperation) {
    validateSpansSqlOperation(options.sqlOperation);
  }
}

function validateForDataType(
  options: BackfillCommandInputs,
  dataType: SignalDataType
): BuiltSignalPredicate {
  if (
    dataType === CreateLogsBackfillJobDataType.logs &&
    (options.sqlOperation || options.preserveSql)
  ) {
    throw new Error('SQL options only apply to spans backfills');
  }
  if (dataType === CreateSpansBackfillJobDataType.spans) {
    validateSpanBackfillQuery(options.query ?? '');
  }
  return buildSignalPredicate({ ...options, dataType });
}

export async function resolveBackfillInputs(
  options: BackfillCommandInputs,
  apiClient: BackfillApiClient,
  now = new Date()
): Promise<BackfillResolvedInputs> {
  validateBackfillInputs(options);
  const source = await resolveSignalSource(options, apiClient);
  validateForDataType(options, source.dataType);

  const sqlOperation = resolveSqlOperation(options, source.postReducerSqlOperations);
  const sinkIds = options.jobId
    ? inferSinkIds(source.sinkOperations, source.dataType)
    : options.sinkIds ?? [];
  if (sinkIds.length === 0) {
    throw new Error(
      `No supported ${source.dataType} sinks found in source job ${options.jobId ?? ''}`.trim()
    );
  }

  const sinks = await resolveSinks(sinkIds, source.dataType, apiClient);
  const { eligibleSinks, skippedSinks } = findBackfillEligibleSinks(
    sinks,
    source.dataType,
    requireTimestampRange(options).startDate,
    now
  );
  if (eligibleSinks.length === 0) {
    const reasons = skippedSinks
      .map(({ sink, reason }) => `${sink.name} (${sink.id}): ${reason}`)
      .join('; ');
    throw new Error(`No sinks are eligible for the requested backfill window. ${reasons}`);
  }

  return {
    dataType: source.dataType,
    datasetId: source.datasetId,
    teamIds: [
      ...new Set([
        ...source.teamIds,
        ...eligibleSinks.flatMap(sink => sink.teamIds ?? [])
      ])
    ],
    sinks: eligibleSinks,
    skippedSinks,
    sqlOperation
  };
}

export function buildBackfillRequest(
  options: BackfillCommandInputs,
  resolved: BackfillJobInputs,
  now = new Date()
): SchemaCreateBackfillJob {
  validateResolvedSinks(resolved.sinks, resolved.dataType);
  const range = requireTimestampRange(options);
  const predicate = validateForDataType(options, resolved.dataType);
  const common = {
    name: formatBackfillJobName(now),
    datasetId: resolved.datasetId,
    start: range.start,
    end: range.end,
    limit: options.limit ?? DEFAULT_LIMIT,
    tags: BACKFILL_TAGS,
    teamIds: resolved.teamIds
  };

  if (predicate.dataType === CreateLogsBackfillJobDataType.logs) {
    const tags = buildLogVendorTags(options.tags ?? []);
    return {
      ...common,
      dataType: CreateLogsBackfillJobDataType.logs,
      query: predicate.query,
      sinks: resolved.sinks.map(sink => buildLogSink(sink, tags)),
      vendorSinkIntegrationIds: resolved.sinks.map(sink => sink.id)
    };
  }

  const attributes = buildSpanVendorAttributes(options.tags ?? []);
  return {
    ...common,
    dataType: CreateSpansBackfillJobDataType.spans,
    sinks: resolved.sinks.map(sink => buildTraceSink(sink, attributes)),
    ...predicate.spanFilters,
    ...(resolved.sqlOperation ? { sqlOperation: resolved.sqlOperation } : {})
  };
}

export function validateSpansSqlOperation(sql: unknown): asserts sql is SchemaSqlOperation {
  if (
    !isRecord(sql) ||
    sql.type !== SqlOperationType.sql_operation
  ) {
    throw new Error('Spans backfill SQL must be a sql-operation object');
  }
  if (!isNonBlankString(sql.name)) {
    throw new Error('Spans backfill SQL operation name must be a non-empty string');
  }
  if (!OPERATION_NAME_PATTERN.test(sql.name)) {
    throw new Error(
      'Spans backfill SQL operation name must match [a-z0-9_]{1,128}'
    );
  }
  if (
    !isOptionalStringArray(sql.availableDatasets) ||
    !isOptionalString(sql.globalStateTtl) ||
    !isOptionalString(sql.watermarkDelay)
  ) {
    throw new Error('Spans backfill SQL has invalid operation settings');
  }
  const inputEntries = isRecord(sql.inputs) ? Object.entries(sql.inputs) : [];
  if (
    inputEntries.length !== 1 ||
    inputEntries[0]?.[1] !== SqlOperationInputs.COMPLETE_SPAN
  ) {
    throw new Error('Spans backfill SQL must define exactly one COMPLETE_SPAN input');
  }
  const inputName = inputEntries[0][0];
  if (!SQL_IDENTIFIER_PATTERN.test(inputName)) {
    throw new Error(
      `Spans backfill SQL input name '${inputName}' must be a simple identifier`
    );
  }
  if (
    !Array.isArray(sql.statements) ||
    sql.statements.length === 0 ||
    !sql.statements.every(isRecord)
  ) {
    throw new Error('Spans backfill SQL statements must be a non-empty list of objects');
  }
  const statements: Record<string, unknown>[] = sql.statements;
  if (!statements.every(isValidSpanSqlStatement)) {
    throw new Error('Spans backfill SQL only supports VIEW and OUTPUT statements');
  }
  const outputs = statements.filter(
    statement => statement.type === SqlOutputStatementType.sql_output
  );
  if (
    outputs.length !== 1 ||
    outputs[0]?.outputType !== SqlOperationInputs.COMPLETE_SPAN
  ) {
    throw new Error('Spans backfill SQL must define exactly one COMPLETE_SPAN output');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined ||
    (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

function hasValidStatementOptions(statement: Record<string, unknown>): boolean {
  return isOptionalString(statement.eventTimeAttribute) &&
    (statement.materialized === undefined || typeof statement.materialized === 'boolean');
}

function isValidSpanSqlStatement(statement: Record<string, unknown>): boolean {
  if (!hasValidStatementOptions(statement) || !isNonBlankString(statement.sqlQuery)) {
    return false;
  }
  switch (statement.type) {
    case SqlViewStatementType.sql_view:
      return typeof statement.tableName === 'string' &&
        SQL_IDENTIFIER_PATTERN.test(statement.tableName);
    case SqlOutputStatementType.sql_output:
      return typeof statement.outputName === 'string' &&
        SQL_OUTPUT_NAME_PATTERN.test(statement.outputName) &&
        typeof statement.outputType === 'string';
    default:
      return false;
  }
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveSqlOperation(
  options: BackfillCommandInputs,
  preserved: SchemaSqlOperation[]
): SchemaSqlOperation | undefined {
  if (options.sqlOperation) {
    return options.sqlOperation;
  }
  if (!options.preserveSql) {
    return undefined;
  }
  if (preserved.length === 0) {
    throw new Error('Source job has no post-reducer SQL to preserve');
  }
  if (preserved.length > 1) {
    throw new Error(
      'Source job has multiple post-reducer SQL operations; --preserve-sql requires exactly one'
    );
  }
  const operation = preserved[0];
  validateSpansSqlOperation(operation);
  return operation;
}

function inferSinkIds(operations: SchemaOperation[], dataType: SignalDataType): string[] {
  return [
    ...new Set(
      operations.flatMap(operation => {
        if (
          (dataType === CreateLogsBackfillJobDataType.logs && isBackfillLogSink(operation)) ||
          (dataType === CreateSpansBackfillJobDataType.spans && isBackfillTraceSink(operation))
        ) {
          return [operation.integrationId];
        }
        return [];
      })
    )
  ];
}

async function resolveSinks(
  sinkIds: string[],
  dataType: SignalDataType,
  apiClient: BackfillApiClient
): Promise<IntegrationReadType[]> {
  const sinks: IntegrationReadType[] = [];
  for (const sinkId of [...new Set(sinkIds)]) {
    const sink = await apiClient.getIntegrationById(sinkId);
    if (!sink) {
      throw new Error(
        `Could not load sink integration ${sinkId}. It may not exist, ` +
        'you may not have access, or the request may have failed.'
      );
    }
    if (!isSupportedBackfillIntegrationType(sink.type, dataType)) {
      throw new Error(`Integration ${sinkId} is not a supported ${dataType} sink`);
    }
    sinks.push(sink);
  }
  return sinks;
}

function validateResolvedSinks(
  sinks: IntegrationReadType[],
  dataType: SignalDataType
): void {
  sinks.forEach(sink => {
    if (!isSupportedBackfillIntegrationType(sink.type, dataType)) {
      throw new Error(`Integration ${sink.id} is not a supported ${dataType} sink`);
    }
  });
}

function buildLogSink(
  integration: IntegrationReadType,
  tags: string[]
): BackfillLogSink {
  const name = `sink_${integration.id}`;
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

function buildTraceSink(
  integration: IntegrationReadType,
  attributes: Record<string, string>
): SchemaDatadogTraceSink | SchemaOtlpTraceSink {
  const common = {
    name: `sink_${integration.id}`,
    integrationId: integration.id,
    additionalAttributes: attributes
  };
  switch (integration.type) {
    case ReadDatadogType.datadog:
      return {
        ...common,
        type: DatadogTraceSinkType.datadog_trace_sink
      };
    case ReadOtlpType.otlp:
      return {
        ...common,
        type: OtlpTraceSinkType.otlp_trace_sink
      };
    default:
      throw new Error(`Integration ${integration.id} is not a supported spans sink`);
  }
}

function buildLogVendorTags(tags: string[]): string[] {
  return [PROCESSOR_TAG, ...tags];
}

function buildSpanVendorAttributes(tags: string[]): Record<string, string> {
  return {
    ...tagsToAttributes(tags),
    processor: 'grepr',
    'grepr.backfilled': 'true'
  };
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
  if (limit !== undefined && (!Number.isInteger(limit) || limit < -1)) {
    throw new Error('--limit must be an integer greater than or equal to -1');
  }
}

function findBackfillEligibleSinks(
  sinks: IntegrationReadType[],
  dataType: SignalDataType,
  startDate: Date,
  now: Date
): { eligibleSinks: IntegrationReadType[]; skippedSinks: SkippedBackfillSink[] } {
  const eligibleSinks: IntegrationReadType[] = [];
  const skippedSinks: SkippedBackfillSink[] = [];

  sinks.forEach(sink => {
    const vendor = findBackfillVendorByIntegrationType(sink.type, dataType);
    const maxAgeHours = vendor?.maxBackfillAgeHours;
    if (
      !vendor ||
      maxAgeHours === undefined ||
      startDate.getTime() >= now.getTime() - maxAgeHours * HOUR_MS
    ) {
      eligibleSinks.push(sink);
      return;
    }
    skippedSinks.push({
      sink,
      reason: `${vendor.vendorName} cannot backfill ${dataType} older than ${maxAgeHours} hours`
    });
  });

  return { eligibleSinks, skippedSinks };
}
