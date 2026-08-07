import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  LogsIcebergTableSinkType,
  SqlOperationType,
  TemplateOperationType,
  TraceReducerType,
  type SchemaCreateBackfillJob,
  type SchemaDatasetRead,
  type SchemaLogReducerTemplateInput,
  type SchemaOperation,
  type SchemaReadJob,
  type SchemaSqlOperation,
  type SchemaTemplate,
  type SchemaTemplateOperation,
  type SchemaTraceReducerTemplateInput
} from '../openapi/openApiTypes.js';
import { parseEdge } from './job-graph-utils.js';

const LOG_REDUCER_TEMPLATE_NAME = 'log-reducer-job-graph-template';
const TRACE_REDUCER_TEMPLATE_NAME = 'trace-reducer-job-graph-template';
const RAW_LOGS_SINK_NAME_PREFIX = 'raw_data_sink';

export type SignalDataType = SchemaCreateBackfillJob['dataType'];

export interface SignalSourceInputs {
  jobId?: string;
  datasetId?: string;
  datasetName?: string;
  dataType?: SignalDataType;
}

export interface SignalSourceApiClient {
  getJob(id: string, version?: number, resolved?: boolean): Promise<SchemaReadJob | undefined>;
  getTemplate(id: string, version: number): Promise<SchemaTemplate>;
  listDatasets(): Promise<SchemaDatasetRead[] | undefined>;
  getDataset(id: string): Promise<SchemaDatasetRead | undefined>;
  lookupDataset(nameOrId: string): Promise<SchemaDatasetRead | undefined>;
}

export interface SignalSourceResolutionOptions {
  includeTeamIds?: boolean;
}

export interface ResolvedSignalSource {
  dataType: SignalDataType;
  datasetId: string;
  teamIds: string[];
  sinkOperations: SchemaOperation[];
  postReducerSqlOperations: SchemaSqlOperation[];
}

type InferredJobSource = Omit<ResolvedSignalSource, 'teamIds'>;

export function parseSignalDataType(value: string): SignalDataType {
  switch (value) {
    case CreateLogsBackfillJobDataType.logs:
      return CreateLogsBackfillJobDataType.logs;
    case CreateSpansBackfillJobDataType.spans:
      return CreateSpansBackfillJobDataType.spans;
    default:
      throw new Error('--data-type must be one of: logs, spans');
  }
}

export function validateSignalSourceInputs(options: SignalSourceInputs): void {
  const hasJob = Boolean(options.jobId);
  const hasDataset = Boolean(options.datasetId || options.datasetName);

  if (options.datasetId && options.datasetName) {
    throw new Error('Cannot specify both --dataset-id and --dataset-name');
  }
  if (hasJob && hasDataset) {
    throw new Error('Cannot specify explicit dataset flags with --job-id');
  }
  if (!hasJob && !hasDataset) {
    throw new Error('Specify --job-id, --dataset-id, or --dataset-name');
  }
}

export async function resolveSignalSource(
  options: SignalSourceInputs,
  apiClient: SignalSourceApiClient,
  resolutionOptions: SignalSourceResolutionOptions = {}
): Promise<ResolvedSignalSource> {
  validateSignalSourceInputs(options);
  const includeTeamIds = resolutionOptions.includeTeamIds ?? true;

  if (!options.jobId) {
    if (options.datasetId && !includeTeamIds) {
      return {
        dataType: options.dataType ?? CreateLogsBackfillJobDataType.logs,
        datasetId: options.datasetId,
        teamIds: [],
        sinkOperations: [],
        postReducerSqlOperations: []
      };
    }
    const dataset = await resolveDatasetFromOptions(options, apiClient);
    return {
      dataType: options.dataType ?? CreateLogsBackfillJobDataType.logs,
      datasetId: dataset.id,
      teamIds: includeTeamIds ? dataset.teamIds ?? [] : [],
      sinkOperations: [],
      postReducerSqlOperations: []
    };
  }

  const job = await apiClient.getJob(options.jobId);
  if (!job) {
    throw new Error(`Job not found: ${options.jobId}`);
  }
  const inferred = await inferJobSource(job, apiClient);
  if (options.dataType && options.dataType !== inferred.dataType) {
    throw new Error(
      `Requested --data-type ${options.dataType} does not match source job type ${inferred.dataType}`
    );
  }

  if (!includeTeamIds) {
    return {
      ...inferred,
      teamIds: []
    };
  }

  const dataset = await resolveDataset(inferred.datasetId, 'id', apiClient);
  return {
    ...inferred,
    teamIds: dataset.teamIds ?? job.teamIds ?? []
  };
}

async function inferJobSource(
  job: SchemaReadJob,
  apiClient: SignalSourceApiClient
): Promise<InferredJobSource> {
  const templateOperations = job.jobGraph.vertices.filter(isTemplateOperation);
  if (templateOperations.length > 1) {
    throw new Error(`Source job ${job.id ?? job.name} has an ambiguous pipeline definition`);
  }
  const templateOperation = templateOperations[0];
  if (templateOperation) {
    return inferTemplateJobSource(templateOperation, apiClient);
  }
  return inferRawJobSource(job);
}

async function inferTemplateJobSource(
  operation: SchemaTemplateOperation,
  apiClient: SignalSourceApiClient
): Promise<InferredJobSource> {
  const template = await apiClient.getTemplate(operation.templateId, operation.templateVersion);
  const input = operation.templateInputs?.input as unknown;

  switch (template.name) {
    case LOG_REDUCER_TEMPLATE_NAME: {
      const logsInput = input as SchemaLogReducerTemplateInput | undefined;
      const datasetId = logsInput?.datasetId ?? logsInput?.rawSinkConfig?.datasetId;
      if (!datasetId) {
        throw new Error('Log reducer template has no raw logs dataset');
      }
      const sinks = logsInput?.sinks ?? [];
      return {
        dataType: CreateLogsBackfillJobDataType.logs,
        datasetId,
        sinkOperations: sinks
          .map(wrapper => wrapper.sink)
          .filter(isOperation),
        postReducerSqlOperations: []
      };
    }
    case TRACE_REDUCER_TEMPLATE_NAME: {
      const spansInput = input as SchemaTraceReducerTemplateInput | undefined;
      if (!spansInput?.datasetId) {
        throw new Error('Trace reducer template has no raw spans dataset');
      }
      return {
        dataType: CreateSpansBackfillJobDataType.spans,
        datasetId: spansInput.datasetId,
        sinkOperations: (spansInput.sinks ?? [])
          .map(wrapper => wrapper.sink)
          .filter(isOperation),
        postReducerSqlOperations: spansInput.sqlOperations?.postReducer?.sqlOperation
          ? [spansInput.sqlOperations.postReducer.sqlOperation]
          : []
      };
    }
    default:
      throw new Error(
        `Source job uses unsupported pipeline template ${template.name} (${operation.templateId})`
      );
  }
}

function inferRawJobSource(job: SchemaReadJob): InferredJobSource {
  const operations = job.jobGraph.vertices;
  const rawLogSinks = operations.filter(isRawLogsSink);
  const traceReducers = operations.filter(isTraceReducerWithDataset);

  if (rawLogSinks.length > 0 && traceReducers.length > 0) {
    throw new Error(`Source job ${job.id ?? job.name} contains both logs and spans datasets`);
  }
  if (rawLogSinks.length > 1) {
    throw new Error(
      `Source job ${job.id ?? job.name} has multiple raw logs datasets; ` +
      'use --dataset-id to select one explicitly'
    );
  }
  if (traceReducers.length > 1) {
    throw new Error(
      `Source job ${job.id ?? job.name} has multiple spans datasets; ` +
      'use --dataset-id to select one explicitly'
    );
  }
  const rawLogSink = rawLogSinks[0];
  if (rawLogSinks.length === 1 && rawLogSink) {
    return {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: rawLogSink.datasetId,
      sinkOperations: operations,
      postReducerSqlOperations: []
    };
  }
  const traceReducer = traceReducers[0];
  if (traceReducers.length === 1 && traceReducer) {
    const postReducerSqlOperations = job.jobGraph.vertices
      .filter(isSqlOperation)
      .filter(operation =>
        job.jobGraph.edges.some(
          edge => {
            const parsed = parseEdge(edge);
            return parsed.sourceVertex === traceReducer.name &&
              parsed.targetVertex === operation.name;
          }
        )
      );
    return {
      dataType: CreateSpansBackfillJobDataType.spans,
      datasetId: traceReducer.datasetId,
      sinkOperations: operations,
      postReducerSqlOperations
    };
  }

  throw new Error(
    `Source job ${job.id ?? job.name} has no supported raw logs or spans dataset`
  );
}

async function resolveDatasetFromOptions(
  options: SignalSourceInputs,
  apiClient: SignalSourceApiClient
): Promise<SchemaDatasetRead & { id: string }> {
  if (options.datasetId) {
    return resolveDataset(options.datasetId, 'id', apiClient);
  }
  return resolveDataset(requireDatasetName(options.datasetName), 'name', apiClient);
}

async function resolveDataset(
  reference: string,
  referenceType: 'id' | 'name',
  apiClient: SignalSourceApiClient
): Promise<SchemaDatasetRead & { id: string }> {
  const dataset = referenceType === 'id'
    ? await apiClient.getDataset(reference)
    : await apiClient.lookupDataset(reference);
  const id = dataset?.id;
  if (!dataset || !id) {
    throw new Error(`Dataset not found: ${reference}`);
  }
  return { ...dataset, id };
}

function requireDatasetName(datasetName: string | undefined): string {
  if (!datasetName) {
    throw new Error('--dataset-name is required');
  }
  return datasetName;
}

function isTemplateOperation(operation: SchemaOperation): operation is SchemaTemplateOperation {
  return operation.type === TemplateOperationType.template_operation;
}

function isSqlOperation(operation: SchemaOperation): operation is SchemaSqlOperation {
  return operation.type === SqlOperationType.sql_operation;
}

function isRawLogsSink(
  operation: SchemaOperation
): operation is Extract<
  SchemaOperation,
  { type: LogsIcebergTableSinkType.logs_iceberg_table_sink }
> {
  return operation.type === LogsIcebergTableSinkType.logs_iceberg_table_sink &&
    operation.name.startsWith(RAW_LOGS_SINK_NAME_PREFIX);
}

function isTraceReducerWithDataset(
  operation: SchemaOperation
): operation is Extract<
  SchemaOperation,
  { type: TraceReducerType.trace_reducer }
> & { datasetId: string } {
  return operation.type === TraceReducerType.trace_reducer &&
    typeof operation.datasetId === 'string' &&
    operation.datasetId.length > 0;
}

function isOperation(operation: SchemaOperation | undefined): operation is SchemaOperation {
  return operation !== undefined;
}
