/**
 * Type definitions for the Grepr CLI tool
 */

// Import OpenAPI generated types
import {
  type AgentSessionEventsIcebergTableSourceSortOrder,
  PathsV1JobsGetParametersQueryExecution,
  PathsV1JobsGetParametersQueryProcessing,
  PathsV1JobsGetParametersQueryState,
  // openapi-typescript dedupes identical SortOrder enums under one canonical
  // name; AgentSessionEventsIcebergTableSourceSortOrder is the surviving member of
  // the dedupe equivalence class. The runtime values are the canonical
  // ASCENDING / DESCENDING / UNSORTED.
  type SchemaReadDatadog, type SchemaReadDataWarehouse, type SchemaReadS3DataWarehouse,
  type SchemaReadNewRelic, type SchemaReadOtlp, type SchemaReadSplunk, type SchemaReadSumo,
} from './openapi/openApiTypes.js';
import type { SourcePredicateOptions } from './lib/query-predicate.js';
import type { SignalSourceInputs } from './lib/signal-source.js';

export type AuthMethod = 'oauth' | 'client-credentials' | 'none';

export type QueryEngine = 'athena' | 'flink' | 'trino';

/**
 * The concrete query engine a query will execute against, resolved locally from the explicit
 * `queryEngine` option with Athena as the default.
 */
export type ResolvedQueryEngine =
  | { kind: 'athena' }
  | { kind: 'flink' }
  | { kind: 'trino' };

export interface CliOptions {
  orgName: string;
  apiBaseUrl?: string;
  authBaseUrl: string;
  authMethod: AuthMethod;
  queryEngine?: QueryEngine;
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
  authMethod?: AuthMethod;
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

export interface QueryCommandOptions
  extends FormattableCommandOptions, SignalSourceInputs, SourcePredicateOptions {
  sortOrder?: AgentSessionEventsIcebergTableSourceSortOrder;
  start?: string;
  end?: string;
  limit?: number;
}

export interface JobPlanCommandOptions extends CliOptions {
  jobId?: string;
  patch?: string;
  color?: boolean;
  dryRun?: boolean;
}

export interface JobApplyCommandOptions extends CliOptions {
  force?: boolean;
  rollbackEnabled?: boolean;
}

export interface JobDraftCommandOptions extends CliOptions {
  /**
   * Draft the live pipeline as-is with no edits (no plan file). Fetches the
   * job by id and runs the current config through draft mode. Mutually
   * exclusive with the positional plan-file argument.
   */
  jobId?: string;
  /** Wall-clock cap in seconds; the streaming sync job is aborted client-side after it. */
  maxDurationSeconds?: number;
  /**
   * Path to a JSON array (or NDJSON, one event per line) of LogEvents to draft
   * the proposed pipeline against instead of live traffic. Injected as the
   * template input's `draftSource` (a bounded logs-values-source) and forces the
   * draft to run as BATCH so the bounded source runs to completion and streams
   * its sink-source-tagged outputs back. This is the deterministic equivalent of
   * drafting against a signal's sample, avoiding the HEARTBEAT-only result sparse
   * live traffic produces.
   */
  sampleLogs?: string;
}

export interface ApiClientConfig {
  orgName: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  authMethod: AuthMethod;
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
  QUERY_TOO_LARGE: 'query_too_large',
  RESOURCES_EXHAUSTED: 'resources_exhausted',
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

// Re-export job enum values for convenience.
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
