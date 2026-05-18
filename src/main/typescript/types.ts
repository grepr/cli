/**
 * Type definitions for the Grepr CLI tool
 */

// Import OpenAPI generated types
import {
  PathsV1JobsGetParametersQueryExecution,
  PathsV1JobsGetParametersQueryProcessing,
  PathsV1JobsGetParametersQueryState,
  GreprRawLogsSourceType,
  LogsIcebergTableSourceType,
  GreprRawLogsSourceSortOrder,
  DatadogQueryPredicateType,
  NewRelicQueryPredicateType,
  SplQueryPredicateType, SchemaReadDatadog, SchemaReadDataWarehouse, SchemaReadS3DataWarehouse,
  SchemaReadNewRelic, SchemaReadOtlp, SchemaReadSplunk, SchemaReadSumo, SchemaOperation,
} from './openapi/openApiTypes.js';

export interface CliOptions {
  orgName: string;
  apiBaseUrl?: string;
  authBaseUrl: string;
  authMethod: 'oauth' | 'client-credentials';
  debug?: boolean;
  quiet?: boolean;
  clientId: string;
  clientSecret?: string;
  timezone?: string;
  conf?: string;
  output?: string;
  authCache: boolean;
  browser: boolean;
}

export interface SavedCliConfig {
  orgName?: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  authMethod?: 'oauth' | 'client-credentials';
  clientId?: string;
  clientSecret?: string;
  timezone?: string;
  authCache: boolean;
  browser: boolean;
}

export interface CliConfigFile {
  _default?: string;
  [configName: string]: SavedCliConfig | string | undefined;
}

export interface FormattableCommandOptions extends CliOptions {
  format?: 'table' | 'pretty' | 'raw' | 'compact' | 'csv';
  sort?: string;
  color?: boolean;
  timestamps?: boolean;
  jobState?: boolean;
  maxDepth?: number;
  maxLines?: number;
}

export interface QueryCommandOptions extends FormattableCommandOptions {
  datasetId?: string;
  datasetName?: string;
  sortOrder?: GreprRawLogsSourceSortOrder;
  queryEngine?: GreprRawLogsSourceType.grepr_raw_log_source | LogsIcebergTableSourceType.logs_iceberg_table_source;
  queryType?: DatadogQueryPredicateType.datadog_query | NewRelicQueryPredicateType.newrelic_query | SplQueryPredicateType.spl_query;
  query?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface ApiClientConfig {
  orgName: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  authMethod: 'oauth' | 'client-credentials';
  clientId: string;
  clientSecret?: string;
  authCache: boolean;
  browser: boolean;
  debug: boolean;
}

export interface ProcessStats {
  recordsProcessed: number;
  heartbeatsSent: number;
  errors: number;
  errorMessages: string[];
  startTime: number | null;
  endTime: number | null;
  duration?: string;
}

export interface EventRecord {
  jobState: string;
  data?: LogEventData;
  heartbeatToken?: string;
}

export interface LogEventData {
  id?: string;
  receivedTimestamp?: string | number;
  eventTimestamp?: string | number;
  tags?: Record<string, unknown>;
  severity?: string;
  message?: string;
  [key: string]: unknown;
}

export const STREAM_EVENTS = {
  HEARTBEAT_REQUEST: 'heartbeat_request',
  DATA: 'data',
  FINISHED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  SCANNED_MAX: 'scanned_max',
  PARSE_ERROR: 'parse_error'
};

export const HEARTBEAT_EVENTS = {
  REQUEST: 'request',
  SENT: 'sent',
  ERROR: 'error',
  RETRY: 'retry'
};

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: string | boolean | string[];
  parser?: (value: string) => string | boolean | number;
}

// Re-export only enum types for convenience
export {
  PathsV1JobsGetParametersQueryExecution as JobExecution,
  PathsV1JobsGetParametersQueryProcessing as JobProcessing,
  PathsV1JobsGetParametersQueryState as JobState
}

export type MergeConfiguration = (options: Record<string, string | boolean | number | string[]>) => Promise<CliOptions>;

export type CommandOptionValue = string | boolean | number | string[];
export type CommandOptionsRecord = Record<string, CommandOptionValue>;

export type IntegrationReadType = SchemaReadDatadog|SchemaReadDataWarehouse|SchemaReadS3DataWarehouse|SchemaReadNewRelic|SchemaReadOtlp|SchemaReadSplunk|SchemaReadSumo
export interface IntegrationTypeAndList<T extends IntegrationReadType> { type: T['type'], items: T[] }

export const DEFAULT_INPUT = "input";
export const DEFAULT_OUTPUT = "output";
export const DEFAULT_LIMIT = 100;

export interface IO {
  name: string;
  vertex: Vertex;
}

export class Vertex {
  name: string;
  operation: SchemaOperation;
  // Map from input name to connected prev vertices
  prev: Map<string, IO[]>;
  // Map from output name to connected next vertices
  next: Map<string, IO[]>;

  constructor(operation: SchemaOperation) {
    this.operation = operation;
    this.name = operation.name || '';
    this.prev = new Map<string, IO[]>();
    this.next = new Map<string, IO[]>();
  }

  addPrev(inputPort: string, prev: IO, addToPrev = true): void {
    if (!this.prev.has(inputPort)) {
      this.prev.set(inputPort, []);
    }
    this.prev.get(inputPort)?.push(prev);

    // Add this vertex as next of the previous IO's vertex
    if (addToPrev) {
      prev.vertex.addNext(prev.name, { name: inputPort, vertex: this }, false);
    }
  }

  addNext(outputPort: string, next: IO, addToNext = true): void {
    if (!this.next.has(outputPort)) {
      this.next.set(outputPort, []);
    }
    this.next.get(outputPort)?.push(next);

    // Add this vertex as prev of the next IO's vertex
    if (addToNext) {
      next.vertex.addPrev(next.name, { name: outputPort, vertex: this }, false);
    }
  }

  removePrev(inputPort: string, prev: IO, removeFromPrev = true): void {
    if (!this.prev.has(inputPort)) {
      return;
    }

    if (!prev) {
      return;
    }

    const existingIoList = this.prev.get(inputPort) || [];

    // Filter out the IO matching the prevName and prevOutput
    const updatedList = existingIoList.filter((existingIo: IO) => existingIo.vertex.name !== prev.vertex.name || existingIo.name !== prev.name) || [];
    this.prev.set(inputPort, updatedList);

    // Remove this vertex as next of the previous IO's vertex
    if (removeFromPrev) {
      prev.vertex.removeNext(prev.name, { name: inputPort, vertex: this }, false);
    }
  }

  removeNext(outputPort: string, next: IO, removeFromNext = true): void {
    if (!this.next.has(outputPort)) {
      return;
    }

    if (!next) {
      return;
    }

    const existingIoList = this.next.get(outputPort) || [];

    // Filter out the IO matching the nextName and nextInput
    const updatedList = existingIoList.filter((existingIo: IO) => existingIo.vertex.name !== next.vertex.name || existingIo.name !== next.name) || [];
    this.next.set(outputPort, updatedList);

    // Remove this vertex as prev of the next IO's vertex
    if (removeFromNext) {
      next.vertex.removePrev(next.name, { name: outputPort, vertex: this }, false);
    }
  }
}