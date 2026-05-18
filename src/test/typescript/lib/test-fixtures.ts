/**
 * Test fixtures and helpers for creating job definitions in tests.
 *
 * These helpers use proper enum types to avoid TypeScript errors
 * while keeping test code readable.
 */

import {
  SchemaOperation,
  DatadogLogAgentSourceType,
  DatadogLogSinkType,
  SplunkLogSinkType,
  LogsFilterType,
  LogsIcebergTableSourceType,
  LogsIcebergTableSinkType,
  LogsSynchronousSinkType,
  LogsBranchType,
  DatadogQueryPredicateType,
  TagActionModification,
  TagActionType,
  LogTransformActionType,
  SchemaLogsIcebergTableSource,
  SchemaDatadogQueryPredicate
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
