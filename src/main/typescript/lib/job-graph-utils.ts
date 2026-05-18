/**
 * Utility functions for working with Grepr job graphs.
 *
 * This module provides helper functions for:
 * - Identifying different types of operations (sources, sinks, etc.)
 * - Parsing and manipulating job graph edges
 * - Traversing the job graph to find related vertices
 * - Generating test identifiers
 *
 * All functions work with the OpenAPI-generated types to ensure type safety.
 */

import {
  SchemaOperation,
  LogsIcebergTableSourceType, MetricsIcebergTableSourceType, TracesIcebergTableSourceType, LogsBackfillFlinkSourceType,
  ReducerLogsQuerySourceType, GreprRawLogsSourceType, GreprReducerLogSourceType,
} from '@/openapi/openApiTypes';
import { DEFAULT_INPUT, DEFAULT_OUTPUT } from '@/types'

/**
 * Checks if a source vertex supports record limiting.
 *
 * Some source operations (like Iceberg table sources and Grepr internal sources)
 * support a 'limit' parameter to restrict the number of records read, which is
 * useful for batch testing.
 *
 * @param vertex - The operation to check
 * @returns true if the vertex supports limiting
 */
export function canLimit(vertex: SchemaOperation): boolean {
  // Iceberg table sources and Grepr internal sources support limiting
  const limitableSources = new Set([
    LogsIcebergTableSourceType.logs_iceberg_table_source,
    MetricsIcebergTableSourceType.metrics_iceberg_table_source,
    TracesIcebergTableSourceType.traces_iceberg_table_source,
    LogsBackfillFlinkSourceType.logs_backfill_iceberg_table_source,
    ReducerLogsQuerySourceType.reducer_logs_iceberg_table_source,
    GreprRawLogsSourceType.grepr_raw_log_source,
    GreprReducerLogSourceType.grepr_reducer_log_source,
  ]) as Set<string>;

  return limitableSources.has(vertex.type);
}

/**
 * Parses a job graph edge string into source and target vertex names.
 *
 * Edges are represented as strings in the format "source -> target".
 * Or "source:out -> target:in".
 * This function splits the edge and validates the format.
 *
 * @param edge - The edge string to parse (e.g., "source -> target")
 * @returns A tuple of [source, target] vertex/port names
 * @throws Error if the edge format is invalid
 */
export function parseEdge(edge: string): {
  sourceVertex: string;
  sourcePort: string;
  targetVertex: string;
  targetPort: string
} {
  const parts = edge.split('->').map(p => p.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid edge format: ${edge}`);
  }

  // split source and target to extract vertex names with ports
  const source = parts[0];
  const target = parts[1];

  const sourceParts = source.split(":").map(p => p.trim());
  const targetParts = target.split(":").map(p => p.trim());

  if (sourceParts.length > 2 || targetParts.length > 2) {
    throw new Error(`Invalid edge format with ports: ${edge}`);
  }

  // These are guaranteed to exist by the split operation
  const sourceVertex = sourceParts[0] as string;
  const targetVertex = targetParts[0] as string;
  const sourcePort = sourceParts.length === 2 ? (sourceParts[1] as string) : DEFAULT_OUTPUT;
  const targetPort = targetParts.length === 2 ? (targetParts[1] as string) : DEFAULT_INPUT;

  return {
    sourceVertex,
    sourcePort,
    targetVertex,
    targetPort
  }
}

/**
 * Generates a unique test identifier.
 *
 * Creates a unique ID for test runs using a combination of timestamp and random string.
 * Format: test_{timestamp}_{random}
 *
 * @returns A unique test identifier string
 */
export function generateUUID(): string {
  return `test_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
