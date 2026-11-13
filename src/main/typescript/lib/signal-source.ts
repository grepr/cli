import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  TemplateOperationType,
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

const LOG_REDUCER_TEMPLATE_NAME = 'log-reducer-job-graph-template';
const TRACE_REDUCER_TEMPLATE_NAME = 'trace-reducer-job-graph-template';

export type SignalDataType = SchemaCreateBackfillJob['dataType'];

export interface SignalSourceInputs {
  jobId?: string;
  datasetId?: string;
  datasetName?: string;
  dataType?: SignalDataType;
}

export interface SignalSourceApiClient {
  getJob(id: string, version?: number, resolved?: boolean): Promise<SchemaReadJob | undefined>;
  getTemplate(id: string, version?: number): Promise<SchemaTemplate>;
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
  postReducerSqlOperation?: SchemaSqlOperation;
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
        sinkOperations: []
      };
    }
    const dataset = await resolveDatasetFromOptions(options, apiClient);
    return {
      dataType: options.dataType ?? CreateLogsBackfillJobDataType.logs,
      datasetId: dataset.id,
      teamIds: includeTeamIds ? dataset.teamIds ?? [] : [],
      sinkOperations: []
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
  if (!templateOperation) {
    throw new Error(
      `Source job ${job.id ?? job.name} uses a raw job graph (no template-operation vertex). ` +
      '--job-id supports only template-backed pipelines. ' +
      'Pass --dataset-id or --dataset-name instead. For a trace pipeline, also pass --data-type spans.'
    );
  }
  return inferTemplateJobSource(templateOperation, apiClient);
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
      const datasetId = logsInput?.datasetId;
      if (!datasetId) {
        throw new Error('Log reducer template has no raw logs dataset');
      }
      const sinks = logsInput?.sinks ?? [];
      return {
        dataType: CreateLogsBackfillJobDataType.logs,
        datasetId,
        sinkOperations: sinks
          .map(wrapper => wrapper.sink)
          .filter(isOperation)
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
        postReducerSqlOperation: spansInput.sqlOperations?.postReducer?.sqlOperation
      };
    }
    default:
      throw new Error(
        `Source job uses unsupported pipeline template ${template.name} (${operation.templateId})`
      );
  }
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

function isOperation(operation: SchemaOperation | undefined): operation is SchemaOperation {
  return operation !== undefined;
}
