/**
 * Job graph transformation utilities for converting production jobs to test configurations.
 *
 * This module provides functions to transform a production job definition into a test job
 * by replacing sources, sinks, and adding test-specific tagging. The transformations are
 * purely functional - they do not make any API calls or create resources.
 *
 * Key transformations:
 * - Source replacement: Replace vendor sources with dataset queries or keep originals with limits
 * - Sink replacement: Replace vendor sinks with synchronous test sinks or test dataset sinks
 * - Test tagging: Add test run ID and sink name tags to track test data
 *
 * The transformed job can then be executed using the standard job:create command.
 */

import { DEFAULT_INPUT, DEFAULT_OUTPUT, JobExecution, JobProcessing, Vertex, DEFAULT_LIMIT } from '../types.js';
import {
  SchemaOperation,
  SchemaGreprJobGraph,
  SchemaCreateJob,
  LogsIcebergTableSourceType,
  LogsSynchronousSinkType,
  LogsIcebergTableSinkType,
  LogTransformActionType,
  DatadogQueryPredicateType,
  TagActionModification,
  TagActionType,
  SchemaLogsIcebergTableSink,
  LogsValuesSourceType,
  SchemaLogEvent
} from '@/openapi/openApiTypes';
import {
  canLimit,
  parseEdge,
  generateUUID
} from './job-graph-utils.js';
import fs from 'fs-extra';

/**
 * Options for transforming a job to a test configuration.
 */
export interface JobToTestOptions {
  /** Target execution type (default: keep original) */
  execution?: JobExecution;

  /** Target processing type (default: keep original) */
  processing?: JobProcessing;

  /** Path to sample data file (not yet implemented) */
  sampleDataFile?: string;

  /** Dataset ID to use as data source (requires start and end) */
  datasetId?: string;

  /** Query to filter dataset source data (optional, requires datasetId) */
  query?: string;

  /** Start time for dataset query (ISO 8601 format) */
  start?: string;

  /** End time for dataset query (ISO 8601 format) */
  end?: string;

  /** Record limit for batch sources (default: 1000) */
  limitRecords?: number;

  /** Dataset ID for async test output (enables tagging) */
  testDataset?: string;

  /** Custom test run identifier (default: auto-generated) */
  testTag?: string;

  /** Custom test job name (default: {original}_test) */
  testName?: string;
}

/**
 * Transforms a production job configuration into a test job configuration.
 *
 * This is the main entry point for job transformation. It applies the following changes:
 * 1. Renames the job (appends "_test" or uses custom name)
 * 2. Updates execution and processing types if specified
 * 3. Adds test run ID tag to job tags
 * 4. Transforms sources (replace with dataset query, sample data, or add limits)
 * 5. Transforms sinks (replace with sync sink or test dataset sinks)
 * 6. Adds test tagging operations before sinks
 *
 * The transformation is purely functional and does not make any API calls.
 *
 * @param originalJob - The production job to transform
 * @param options - Transformation options
 * @returns A new job configuration suitable for testing
 * @throws Error if job graph is missing or invalid
 *
 * @example
 * const testJob = transformJobToTest(prodJob, {
 *   execution: 'SYNCHRONOUS',
 *   processing: 'BATCH',
 *   datasetId: 'my_dataset',
 *   start: '2025-01-01T00:00:00Z',
 *   end: '2025-01-01T01:00:00Z',
 *   limitRecords: 100
 * });
 */
export function transformJobToTest(
  originalJob: SchemaCreateJob,
  options: JobToTestOptions
): SchemaCreateJob {
  const job = { ...originalJob };

  // Determine target execution and processing types (use options or keep original)
  const targetExecution = options.execution || job.execution;
  const targetProcessing = options.processing || job.processing;

  // Create base transformed job with updated metadata
  const transformedJob: SchemaCreateJob = {
    ...job,
    name: options.testName || `${job.name}_test`,
    execution: targetExecution,
    processing: targetProcessing,
    tags: {
      ...(job.tags || {}),
      'grepr.test_run_id': options.testTag || generateUUID()
    }
  };

  if (!transformedJob.jobGraph) {
    throw new Error('Job graph is required');
  }

  const parsedGraph = parseGraph(transformedJob.jobGraph);

  // Step 1: Add test tagging operations on all edges BEFORE transforming sources/sinks
  // This captures the original source/sink names in the edge tags
  addTestTagging(parsedGraph, transformedJob.tags?.['grepr.test_run_id'] || generateUUID());

  // Step 2: Transform sources (replace with dataset, sample data, or add limits)
  transformSources(parsedGraph, targetProcessing, options);

  // Step 3: Transform sinks (replace with sync sink or test dataset sinks)
  transformSinks(parsedGraph, targetExecution, options);

  // Convert the parsed/modified graph back to SchemaGreprJobGraph format
  const transformedVertices: SchemaOperation[] = [];
  const transformedEdges: string[] = [];

  for (const vertex of parsedGraph.values()) {
    transformedVertices.push(vertex.operation);

    for (const [outputPort, nextIos] of vertex.next) {
      for (const nextIo of nextIos) {
        const edgeStr = `${vertex.name}:${outputPort} -> ${nextIo.vertex.name}:${nextIo.name}`;
        transformedEdges.push(edgeStr);
      }
    }
  }

  transformedJob.jobGraph = {
    vertices: transformedVertices,
    edges: transformedEdges
  };

  return transformedJob;
}

/**
 * Parses the job graph into a vertex-based representation, returning all vertices.
 */
function parseGraph(jobGraph: SchemaGreprJobGraph): Map<string, Vertex> {
  const verticesMap = new Map<string, Vertex>();

  // Create Vertex objects for each operation
  for (const operation of jobGraph.vertices) {
    verticesMap.set(operation.name, new Vertex(operation));
  }

  // Link vertices based on edges
  for (const edge of jobGraph.edges) {
    const {
      sourceVertex: sourceVertexName,
      targetVertex: targetVertexName,
      sourcePort,
      targetPort
    } = parseEdge(edge);

    const sourceVertex = verticesMap.get(sourceVertexName);
    const targetVertex = verticesMap.get(targetVertexName);

    if (sourceVertex && targetVertex) {
      sourceVertex.addNext(sourcePort, { name: targetPort, vertex: targetVertex });
    }
  }

  return verticesMap;
}


/**
 * Transforms job graph sources based on the specified options.
 *
 * Three transformation strategies are supported:
 * 1. Sample data file: Replace all sources with a LogsValuesSource (not yet implemented)
 * 2. Dataset query: Replace all sources with a single IcebergTableSource
 * 3. In-place: Keep original sources but add record limits for batch processing
 *
 * @param jobGraph - The job graph to transform
 * @param processing - Target processing type
 * @param options - Source transformation options
 * @returns Transformed job graph with updated sources
 */
function transformSources(
  jobGraph: Map<string, Vertex>,
  processing: JobProcessing,
  options: JobToTestOptions
): void {
  if (options.sampleDataFile) {
    transformSourcesToSampleData(jobGraph, options.sampleDataFile);
  } else if (options.datasetId) {
    transformSourcesToDatasetQuery(jobGraph, options.datasetId, options.query, options.start, options.end, processing, options.limitRecords);
  } else {
    transformSourcesInPlace(jobGraph, processing, options.limitRecords);
  }
}

/**
 * Transforms sources to use sample data from a file.
 *
 * This replaces all existing sources with a single LogsValuesSource that
 * emits the log events from the sample data file. The file should contain
 * a JSON array of log events matching the LogEvent schema.
 *
 * All edges from the old sources are rewired to connect from the new source
 * to the first downstream operation in the pipeline.
 *
 * @param jobGraph - The job graph to transform
 * @param sampleDataFile - Path to sample data file (JSON array of log events)
 * @throws Error if the file cannot be read or parsed
 */
function transformSourcesToSampleData(
  jobGraph: Map<string, Vertex>,
  sampleDataFile: string
): void {
  // Read and parse the sample data file
  if (!fs.existsSync(sampleDataFile)) {
    throw new Error(`Sample data file not found: ${sampleDataFile}`);
  }

  let sampleLogs: SchemaLogEvent[];
  try {
    const fileContent = fs.readFileSync(sampleDataFile, 'utf-8');
    sampleLogs = JSON.parse(fileContent) as SchemaLogEvent[];

    if (!Array.isArray(sampleLogs)) {
      throw new Error('Sample data must be a JSON array of log events');
    }
  } catch (error) {
    if ((error as Error).message.includes('Sample data')) {
      throw error;
    }
    throw new Error(`Failed to parse sample data file: ${(error as Error).message}`);
  }

  // Create a new LogsValuesSource with the sample data
  const newSource: SchemaOperation = {
    type: LogsValuesSourceType.logs_values_source,
    name: 'test_sample_source',
    values: sampleLogs,
    indefinite: false
  } as SchemaOperation;

  const newSourceVertex = new Vertex(newSource);

  // Remove all old sources and connect them to the new source
  for (const vertex of Array.from(jobGraph.values())) {
    if (isSource(vertex)) {
      // Rewire edges from old source's next vertices to new source
      for (const [port, nextIos] of vertex.next) {
        for (const nextIo of nextIos) {
          vertex.removeNext(port, nextIo);
          newSourceVertex.addNext(DEFAULT_OUTPUT, nextIo);
        }
      }
      jobGraph.delete(vertex.name);
    }
  }

  // Add the new source vertex to the graph
  jobGraph.set(newSourceVertex.name, newSourceVertex);
}

/**
 * Transforms sources to use an Iceberg dataset as the data source.
 *
 * This replaces all existing sources with a single IcebergTableSource that:
 * - Reads from the specified dataset
 * - Optionally filters data using a query
 * - Reads data within the specified time range
 * - Limits records for batch processing if specified
 *
 * All edges from the old sources are rewired to connect from the new source
 * to the first downstream operation in the pipeline.
 *
 * @param jobGraph - The job graph to transform
 * @param datasetId - ID of the dataset to read from
 * @param query - Optional query to filter dataset data
 * @param start - Start time for data query
 * @param end - End time for data query
 * @param processing - Processing type (BATCH or STREAMING)
 * @param limitRecords - Optional record limit for batch processing
 * @returns Transformed job graph with dataset source
 */
function transformSourcesToDatasetQuery(
  jobGraph: Map<string, Vertex>,
  datasetId: string,
  query: string | undefined,
  start: string | undefined,
  end: string | undefined,
  processing: JobProcessing,
  limitRecords?: number
): void {
  // Create a new Iceberg table source with the specified configuration
  const newSource: SchemaOperation = {
    type: LogsIcebergTableSourceType.logs_iceberg_table_source,
    name: 'test_dataset_source',
    datasetId,
    query: {
      type: DatadogQueryPredicateType.datadog_query,
      query: query || ''
    },
    start: start || '',
    end: end || '',
    limit: limitRecords ?? DEFAULT_LIMIT
  };

  const newSourceVertex: Vertex = new Vertex(newSource)

  // Remove all old sources and connect them to the new source
  for (const vertex of Array.from(jobGraph.values())) {
    if (isSource(vertex)) {
      // This is a source vertex since it has no inputs.
      // Rewire edges from old source's next vertices to new source
      for (const [port, nextIos] of vertex.next) {
        for (const nextIo of nextIos) {
          vertex.removeNext(port, nextIo);
          newSourceVertex.addNext(DEFAULT_OUTPUT, nextIo);
        }
      }
      jobGraph.delete(vertex.name)
    }
  }

  // Add the new source vertex to the graph
  jobGraph.set(newSourceVertex.name, newSourceVertex);
}

/**
 * Transforms sources in place by adding record limits for batch processing.
 *
 * This keeps the original sources but adds a 'limit' parameter to sources
 * that support it (e.g., IcebergTableSource). This is useful when you want
 * to test with the same data sources but limit the amount of data processed.
 *
 * @param jobGraph - The job graph to transform
 * @param processing - Processing type
 * @param limitRecords - Optional record limit to apply
 * @returns Transformed job graph with limited sources
 */
function transformSourcesInPlace(
  jobGraph: Map<string, Vertex>,
  processing: JobProcessing,
  limitRecords?: number
): void {

  for (const vertex of jobGraph.values()) {
    if (!isSource(vertex)) {
      // Not a source vertex
      continue;
    }

    if (processing === JobProcessing.BATCH && limitRecords && canLimit(vertex.operation)) {
      vertex.operation = {
        ...vertex.operation,
        limit: limitRecords
      } as SchemaOperation;
    }
  }
}

/**
 * Transforms job graph sinks based on the target execution type.
 *
 * Two transformation strategies:
 * 1. SYNCHRONOUS: Replace all sinks with a single synchronous sink that returns results
 * 2. ASYNCHRONOUS: Replace vendor sinks with test dataset sinks (if testDataset provided)
 *
 * @param jobGraph - The job graph to transform
 * @param execution - Target execution type
 * @param options - Sink transformation options
 * @returns Transformed job graph with updated sinks
 */
function transformSinks(
  jobGraph: Map<string, Vertex>,
  execution: JobExecution,
  options: JobToTestOptions
): void {
  if (execution === JobExecution.SYNCHRONOUS) {
    return transformSinksToSynchronous(jobGraph);
  } else {
    if (!options.testDataset) {
      throw new Error('Test dataset ID is required for ASYNCHRONOUS test job');
    }
    return transformSinksToAsynchronous(jobGraph, options.testDataset);
  }
}

/**
 * Transforms all sinks to a single synchronous sink.
 *
 * For synchronous testing, we replace all sink operations with a single
 * LogsSyncSink that returns the processed data in the API response.
 * This allows immediate verification of results.
 *
 * All operations that were feeding into the original sinks are rewired
 * to feed into the new synchronous sink.
 *
 * @param jobGraph - The job graph to transform
 */
function transformSinksToSynchronous(
  jobGraph: Map<string, Vertex>
): void {
  // Create a single synchronous sink to replace them all
  const syncSink: SchemaOperation = {
    type: LogsSynchronousSinkType.logs_sync_sink,
    name: 'test_synchronous_sink'
  } as SchemaOperation;

  const sinkVertex: Vertex = new Vertex(syncSink);

  wireNewSink(jobGraph, sinkVertex);
}

/**
 * Transforms sinks for asynchronous testing with a test dataset.
 *
 * If a test dataset ID is provided, this replaces vendor sinks, raw data sinks,
 * and event dedup sinks with Iceberg table sinks that write to the test dataset.
 *
 * The original sink names are preserved to maintain the graph structure.
 * Test tagging (added separately) allows distinguishing which sink the data came from.
 *
 * @param jobGraph - The job graph to transform
 * @param testDatasetId - Optional test dataset ID for output
 */
function transformSinksToAsynchronous(
  jobGraph: Map<string, Vertex>,
  testDatasetId: string
): void {

  // For each sink (no outputs), replace with test dataset sink.
  const sinkOp: SchemaLogsIcebergTableSink = {
    type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
    name: 'test_async_sink',
    datasetId: testDatasetId
  }

  const sinkVertex: Vertex = new Vertex(sinkOp);

  wireNewSink(jobGraph, sinkVertex);
}

function wireNewSink(jobGraph: Map<string, Vertex>, sinkVertex: Vertex): void {
  // Find all vertices that feed into sinks and rewire them to the new sync sink
  for (const vertex of Array.from(jobGraph.values())) {
    if (isSink(vertex)) {
      // This is a sink vertex since it has no outputs.
      // Rewire edges from old sink's prev vertices to new sync sink
      for (const [port, prevIos] of vertex.prev) {
        for (const prevIo of prevIos) {
          vertex.removePrev(port, prevIo);
          prevIo.vertex.addNext(prevIo.name, { name: DEFAULT_INPUT, vertex: sinkVertex });
        }
      }
      jobGraph.delete(vertex.name)
    }
  }

  // Add the new sink vertex to the graph
  jobGraph.set(sinkVertex.name, sinkVertex);
}

/**
 * Adds test tagging operations on all edges, with the id of the
 * original edge and the test run ID.
 *
 * @param jobGraph - The job graph to transform
 * @param testRunId - Unique test run identifier
 */
function addTestTagging(
  jobGraph: Map<string, Vertex>,
  testRunId: string
): void {
  for (const vertex of Array.from(jobGraph.values())) {
    for (const [output, nextIos] of Array.from(vertex.next)) {
      for (const nextIo of nextIos) {
        // insert a tagging operation before this io
        const edge = `${vertex.name}_${output}_${nextIo.vertex.name}_${nextIo.name}`;
        const tagOpName = `${edge}_test_tag`;
        const tagOp = createTestTagOperation(tagOpName, testRunId, edge);
        const tagVertex = new Vertex(tagOp);

        // Rewire edges: vertex -> tagOp -> nextIo.vertex
        vertex.removeNext(output, nextIo);
        vertex.addNext(output, { name: DEFAULT_INPUT, vertex: tagVertex });
        tagVertex.addNext(DEFAULT_OUTPUT, nextIo);

        // Add the new tagging vertex to the graph
        jobGraph.set(tagVertex.name, tagVertex);
      }
    }
  }
}

/**
 * Creates a log transform operation that adds test tags.
 *
 * The operation adds two tags:
 * - grepr.test_run_id: Identifies which test run this data belongs to
 * - grepr.edge: Identifies edge this data was going through
 *
 * These tags are added using the ADD modification, which appends to existing tag arrays.
 *
 * @param name - Name for the tagging operation
 * @param testRunId - Unique test run identifier
 * @param edge - Name of the edge
 * @returns A LogTransformAction operation that adds the tags
 */
function createTestTagOperation(name: string, testRunId: string, edge: string): SchemaOperation {
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
        tagKey: 'grepr.edge',
        values: [edge]
      }
    ]
  };
}

const isSource = (vertex: Vertex): boolean => vertex.prev.size === 0;
const isSink = (vertex: Vertex): boolean => vertex.next.size === 0;

/**
 * Displays a summary of the transformations applied to a job.
 *
 * This shows a before/after comparison including:
 * - Job name changes
 * - Execution type changes
 * - Processing type changes
 * - operation and edge changes
 * - Test run ID
 *
 * The output is formatted for console display.
 *
 * @param originalJob - The original production job
 * @param transformedJob - The transformed test job
 */
export function showDiff(
  originalJob: SchemaCreateJob,
  transformedJob: SchemaCreateJob
): void {
  console.log('\n=== TRANSFORMATION SUMMARY ===\n');

  console.log(`Name: ${originalJob.name} → ${transformedJob.name}`);
  console.log(`Execution: ${originalJob.execution} → ${transformedJob.execution}`);
  console.log(`Processing: ${originalJob.processing} → ${transformedJob.processing}`);

  if (originalJob.jobGraph && transformedJob.jobGraph) {
    // Show added/removed operations and added/removed edges
    // For each operation in original, check if in transformed, and if changed
    const originalOps = new Set(originalJob.jobGraph.vertices.map(v => v.name));
    const transformedOps = new Set(transformedJob.jobGraph.vertices.map(v => v.name));

    const originalOpsMap = new Map(originalJob.jobGraph.vertices.map(v => [v.name, v]));
    const transformedOpsMap = new Map(transformedJob.jobGraph.vertices.map(v => [v.name, v]));

    const addedOps = Array.from(transformedOps).filter(op => !originalOps.has(op));
    const removedOps = Array.from(originalOps).filter(op => !transformedOps.has(op));
    const changedOps = Array.from(originalOps).filter(op => transformedOps.has(op) &&
      JSON.stringify(originalOpsMap.get(op)) !== JSON.stringify(transformedOpsMap.get(op))
    );

    if (addedOps.length > 0) {
      console.log(`Added Operations:`);
      for (const opName of addedOps) {
        const op = transformedOpsMap.get(opName);
        console.log(`${JSON.stringify(op, null, 2)}`);
      }
    }

    if (removedOps.length > 0) {
      console.log(`Removed Operations:`);
      for (const opName of removedOps) {
        const op = originalOpsMap.get(opName);
        console.log(`${JSON.stringify(op, null, 2)}`);
      }
    }

    if (changedOps.length > 0) {
      console.log(`  Changed Operations:`);
      for (const opName of changedOps) {
        const originalOp = originalOpsMap.get(opName);
        const transformedOp = transformedOpsMap.get(opName);
        console.log(`- Original: ${JSON.stringify(originalOp, null, 2)}`);
        console.log(`+ Transformed: ${JSON.stringify(transformedOp, null, 2)}`);
      }
    }

    // Show edge changes
    const originalEdges = new Set(originalJob.jobGraph.edges);
    const transformedEdges = new Set(transformedJob.jobGraph.edges);

    const addedEdges = Array.from(transformedEdges).filter(edge => !originalEdges.has(edge));
    const removedEdges = Array.from(originalEdges).filter(edge => !transformedEdges.has(edge));

    if (addedEdges.length > 0) {
      console.log(`\n  Added Edges:`);
      for (const edge of addedEdges) {
        console.log(`+ ${edge}`);
      }
    }

    if (removedEdges.length > 0) {
      console.log(`\n  Removed Edges:`);
      for (const edge of removedEdges) {
        console.log(`- ${edge}`);
      }
    }

    console.log('\nOperations:');
  }

  console.log('\nTest Tag:');
  console.log(`  ${transformedJob.tags?.['grepr.test_run_id']}`);

  console.log('\n=== TRANSFORMED JOB JSON ===\n');
}
