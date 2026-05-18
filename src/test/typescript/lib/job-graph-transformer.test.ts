/**
 * Tests for job graph transformation logic.
 *
 * These tests verify that the transformation functions correctly convert
 * production job definitions into test configurations. Each test uses
 * complete JSON fixtures for both input and expected output to ensure
 * the entire transformation is correct, not just individual fields.
 */

import { describe, it, expect } from 'vitest';
import { transformJobToTest, JobToTestOptions } from '@/lib/job-graph-transformer.js';
import { JobExecution, JobProcessing } from '@/types.js';
import { SchemaCreateJob, SchemaOperation, LogsIcebergTableSourceType, DatadogQueryPredicateType, LogsIcebergTableSinkType, LogTransformActionType, TagActionModification, TagActionType } from '@/openapi/openApiTypes.js';
import {
  createDatadogSource,
  createDatadogSink,
  createFilter,
  createIcebergSource,
  createIcebergSink,
  createBranch,
  createTransform,
  createSyncSink
} from './test-fixtures.js';

/**
 * Helper to sort job graph edges and vertices for comparison.
 * Map iteration order is not guaranteed, so we need to sort before comparing.
 */
function sortJobGraph(job: SchemaCreateJob): void {
  if (job.jobGraph) {
    job.jobGraph.edges.sort();
    job.jobGraph.vertices.sort((a: SchemaOperation, b: SchemaOperation) =>
      (a.name ?? '').localeCompare(b.name ?? '')
    );
  }
}

describe('job-graph-transformer', () => {
  describe('transformJobToTest', () => {
    describe('synchronous batch transformation', () => {
      it('test_sourceTransformation_datasetQueryWithLimit_shouldReplaceAllSourcesWithSingleIcebergSource', () => {
        // Given: A production async streaming job with vendor source
        const productionJob: SchemaCreateJob = {
          name: 'prod_pipeline',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createDatadogSource('datadog_source', 'integration_123'),
              createFilter('filter_errors', 'status:error'),
              createDatadogSink('datadog_sink', 'integration_123')
            ],
            edges: [
              'datadog_source -> filter_errors',
              'filter_errors -> datadog_sink'
            ]
          },
          tags: {
            'env': 'production'
          }
        };

        const options: JobToTestOptions = {
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          datasetId: 'test_dataset_abc',
          query: 'service:my-service',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          limitRecords: 100,
          testTag: 'test_run_12345'
        };

        // Expected: Transformed job with dataset source, sync sink, and tagging operations
        // Note: Tagging uses ORIGINAL source/sink names (datadog_source, datadog_sink)
        const expectedJob: SchemaCreateJob = {
          name: 'prod_pipeline_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createFilter('filter_errors', 'status:error'),
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset_abc',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: 'service:my-service'
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'datadog_source_output_filter_errors_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_run_12345']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['datadog_source_output_filter_errors_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'filter_errors_output_datadog_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_run_12345']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['filter_errors_output_datadog_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'test_dataset_source:output -> datadog_source_output_filter_errors_input_test_tag:input',
              'datadog_source_output_filter_errors_input_test_tag:output -> filter_errors:input',
              'filter_errors:output -> filter_errors_output_datadog_sink_input_test_tag:input',
              'filter_errors_output_datadog_sink_input_test_tag:output -> test_synchronous_sink:input'
            ]
          },
          tags: {
            'env': 'production',
            'grepr.test_run_id': 'test_run_12345'
          }
        };

        // When: Transform job to test configuration
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Transformed job should match expected job structure').toEqual(expectedJob);
      });

      it('test_sinkTransformation_multipleSinks_shouldReplaceWithSingleSyncSink', () => {
        // Given: Job with multiple sinks
        const productionJob: SchemaCreateJob = {
          name: 'multi_sink_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'integration_123'),
              createBranch('branch'),
              createDatadogSink('sink_datadog', 'integration_123'),
              createIcebergSink('sink_warehouse', 'warehouse_dataset')
            ],
            edges: [
              'source -> branch',
              'branch -> sink_datadog',
              'branch:else -> sink_warehouse'
            ]
          }
        };

        const options: JobToTestOptions = {
          execution: JobExecution.SYNCHRONOUS,
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          testTag: 'test_abc'
        };

        // Expected: All sinks replaced with single sync sink, tagging uses original names
        const expectedJob: SchemaCreateJob = {
          name: 'multi_sink_job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createBranch('branch'),
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_branch_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_abc']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_branch_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_output_sink_datadog_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_abc']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_output_sink_datadog_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_else_sink_warehouse_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_abc']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_else_sink_warehouse_input']
                  }
                ]
              }
            ],
            edges: [
              'test_dataset_source:output -> source_output_branch_input_test_tag:input',
              'source_output_branch_input_test_tag:output -> branch:input',
              'branch:output -> branch_output_sink_datadog_input_test_tag:input',
              'branch_output_sink_datadog_input_test_tag:output -> test_synchronous_sink:input',
              'branch:else -> branch_else_sink_warehouse_input_test_tag:input',
              'branch_else_sink_warehouse_input_test_tag:output -> test_synchronous_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_abc'
          }
        };

        // When: Transform to synchronous
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Transformed job should have single sync sink replacing all original sinks').toEqual(expectedJob);
      });
    });

    describe('asynchronous transformation with test dataset', () => {
      it('test_asyncTransformation_withTestDataset_shouldReplaceWithIcebergSinkAndAddTagging', () => {
        // Given: Production job with vendor sinks
        const productionJob: SchemaCreateJob = {
          name: 'vendor_pipeline',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'prod_dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
              createTransform('transform'),
              createDatadogSink('sink_datadog', 'dd_integration')
            ],
            edges: [
              'source -> transform',
              'transform -> sink_datadog'
            ]
          }
        };

        const options: JobToTestOptions = {
          testDataset: 'test_output_dataset',
          limitRecords: 50,
          testTag: 'test_xyz'
        };

        // Expected: Vendor sinks replaced with test dataset sink, tagging added
        const expectedJob: SchemaCreateJob = {
          name: 'vendor_pipeline_test',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'prod_dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z', 50),
              createTransform('transform'),
              {
                type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
                name: 'test_async_sink',
                datasetId: 'test_output_dataset'
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_transform_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_xyz']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_transform_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'transform_output_sink_datadog_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_xyz']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['transform_output_sink_datadog_input']
                  }
                ]
              }
            ],
            edges: [
              'source:output -> source_output_transform_input_test_tag:input',
              'source_output_transform_input_test_tag:output -> transform:input',
              'transform:output -> transform_output_sink_datadog_input_test_tag:input',
              'transform_output_sink_datadog_input_test_tag:output -> test_async_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_xyz'
          }
        };

        // When: Transform with test dataset
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Transformed job should have test dataset sink and tagging operations').toEqual(expectedJob);
      });

      it('test_asyncTransformation_withoutTestDataset_shouldThrowError', () => {
        // Given: Production job
        const productionJob: SchemaCreateJob = {
          name: 'simple_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'integration_123'),
              createDatadogSink('sink', 'integration_123')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          testTag: 'test_123'
        };

        // When/Then: Transform without test dataset should throw
        expect(
          () => transformJobToTest(productionJob, options),
          'Should throw error when async job has no testDataset'
        ).toThrow('Test dataset ID is required for ASYNCHRONOUS test job');
      });
    });

    describe('source transformation modes', () => {
      it('test_sourceTransformation_keepOriginalBatch_shouldAddLimitToSources', () => {
        // Given: Job with Iceberg source (keeps original when no datasetId specified)
        const productionJob: SchemaCreateJob = {
          name: 'iceberg_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('iceberg_source', 'prod_dataset', '2025-01-01T00:00:00Z', '2025-01-01T02:00:00Z'),
              createIcebergSink('iceberg_sink', 'output_dataset')
            ],
            edges: ['iceberg_source -> iceberg_sink']
          }
        };

        const options: JobToTestOptions = {
          limitRecords: 250,
          testTag: 'test_limit',
          testDataset: 'test_output'
        };

        // Expected: Source modified with limit, sink replaced with test dataset sink
        // Tagging uses original sink name (iceberg_sink)
        const expectedJob: SchemaCreateJob = {
          name: 'iceberg_job_test',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('iceberg_source', 'prod_dataset', '2025-01-01T00:00:00Z', '2025-01-01T02:00:00Z', 250),
              {
                type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
                name: 'test_async_sink',
                datasetId: 'test_output'
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'iceberg_source_output_iceberg_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_limit']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['iceberg_source_output_iceberg_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'iceberg_source:output -> iceberg_source_output_iceberg_sink_input_test_tag:input',
              'iceberg_source_output_iceberg_sink_input_test_tag:output -> test_async_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_limit'
          }
        };

        // When: Transform keeping original sources
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Transformed job should have limit added to source').toEqual(expectedJob);
      });

      it('test_sourceTransformation_keepOriginalStreaming_shouldNotAddLimit', () => {
        // Given: Streaming job
        const productionJob: SchemaCreateJob = {
          name: 'streaming_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset'),
              createIcebergSink('sink', 'output')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          limitRecords: 100,
          testTag: 'test_stream',
          testDataset: 'test_output'
        };

        // Expected: No limit added for streaming, tagging uses original sink name
        const expectedJob: SchemaCreateJob = {
          name: 'streaming_job_test',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset'),
              {
                type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
                name: 'test_async_sink',
                datasetId: 'test_output'
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_stream']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source:output -> source_output_sink_input_test_tag:input',
              'source_output_sink_input_test_tag:output -> test_async_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_stream'
          }
        };

        // When: Transform streaming job
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Streaming job should not have limit added to source').toEqual(expectedJob);
      });
    });

    describe('complex job graphs', () => {
      it('test_complexGraph_multipleOperations_shouldPreserveIntermediateOperations', () => {
        // Given: Complex job with filters, transforms, branches
        const productionJob: SchemaCreateJob = {
          name: 'complex_pipeline',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'dd_int'),
              createFilter('filter_errors', 'status:error'),
              createTransform('add_tags'),
              createBranch('branch'),
              createIcebergSink('sink_raw', 'raw_dataset'),
              createDatadogSink('sink_processed', 'dd_int')
            ],
            edges: [
              'source -> filter_errors',
              'filter_errors -> add_tags',
              'add_tags -> branch',
              'branch -> sink_raw',
              'branch -> sink_processed'
            ]
          },
          tags: {
            'pipeline': 'prod'
          }
        };

        const options: JobToTestOptions = {
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          datasetId: 'test_data',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T00:30:00Z',
          limitRecords: 50,
          testName: 'complex_test',
          testTag: 'test_complex'
        };

        // Expected: Intermediate operations preserved, sources/sinks replaced
        // Tagging uses ORIGINAL source/sink names (source, sink_raw, sink_processed)
        const expectedJob: SchemaCreateJob = {
          name: 'complex_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createFilter('filter_errors', 'status:error'),
              createTransform('add_tags'),
              createBranch('branch'),
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_data',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T00:30:00Z',
                limit: 50
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_filter_errors_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_complex']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_filter_errors_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'filter_errors_output_add_tags_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_complex']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['filter_errors_output_add_tags_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'add_tags_output_branch_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_complex']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['add_tags_output_branch_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_output_sink_raw_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_complex']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_output_sink_raw_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_output_sink_processed_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_complex']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_output_sink_processed_input']
                  }
                ]
              }
            ],
            edges: [
              'test_dataset_source:output -> source_output_filter_errors_input_test_tag:input',
              'source_output_filter_errors_input_test_tag:output -> filter_errors:input',
              'filter_errors:output -> filter_errors_output_add_tags_input_test_tag:input',
              'filter_errors_output_add_tags_input_test_tag:output -> add_tags:input',
              'add_tags:output -> add_tags_output_branch_input_test_tag:input',
              'add_tags_output_branch_input_test_tag:output -> branch:input',
              'branch:output -> branch_output_sink_raw_input_test_tag:input',
              'branch_output_sink_raw_input_test_tag:output -> test_synchronous_sink:input',
              'branch:output -> branch_output_sink_processed_input_test_tag:input',
              'branch_output_sink_processed_input_test_tag:output -> test_synchronous_sink:input'
            ]
          },
          tags: {
            'pipeline': 'prod',
            'grepr.test_run_id': 'test_complex'
          }
        };

        // When: Transform complex job
        const testJob = transformJobToTest(productionJob, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Complex job should preserve intermediate operations').toEqual(expectedJob);
      });
    });

    describe('edge cases', () => {
      it('test_edgeCases_noJobGraph_shouldThrowError', () => {
        // Given: Job without job graph (intentionally invalid for testing)
        const invalidJob = {
          name: 'invalid_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.STREAMING
        } as SchemaCreateJob;

        const options: JobToTestOptions = {
          testTag: 'test_invalid',
          testDataset: 'test_output'
        };

        // When/Then: Should throw error
        expect(
          () => transformJobToTest(invalidJob, options),
          'Should throw when job graph is missing'
        ).toThrow('Job graph is required');
      });

      it('test_edgeCases_autoGeneratedTestTag_shouldCreateUniqueTag', () => {
        // Given: Job without custom test tag
        const job: SchemaCreateJob = {
          name: 'job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z'
        };

        // When: Transform without test tag
        const testJob = transformJobToTest(job, options);

        // Then: Auto-generated tag should be present and follow pattern
        expect(testJob.tags, 'Tags should be defined').toBeDefined();
        expect(testJob.tags?.['grepr.test_run_id'], 'Test run ID should be defined').toBeDefined();
        expect(
          testJob.tags?.['grepr.test_run_id'],
          'Auto-generated tag should match pattern test_{timestamp}_{random}'
        ).toMatch(/^test_\d+_[a-z0-9]+$/);
      });

      it('test_edgeCases_noExistingTags_shouldCreateTagsObject', () => {
        // Given: Job without tags
        const job: SchemaCreateJob = {
          name: 'job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          testTag: 'test_123',
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z'
        };

        // Expected: Tags object created with test run ID, tagging operation added
        const expectedJob: SchemaCreateJob = {
          name: 'job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_123']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input',
              'test_dataset_source:output -> source_output_sink_input_test_tag:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_123'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Job without tags should have tags object created').toEqual(expectedJob);
      });

      it('test_edgeCases_syncJobWithDataset_shouldNotRequireTestDataset', () => {
        // Given: Sync job (doesn't require testDataset)
        const job: SchemaCreateJob = {
          name: 'sync_job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          testTag: 'test_sync'
        };

        // Expected: Sync job with tagging operation
        const expectedJob: SchemaCreateJob = {
          name: 'sync_job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_sync']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input',
              'test_dataset_source:output -> source_output_sink_input_test_tag:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_sync'
          }
        };

        // When: Transform sync job without testDataset
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Sync job should work without testDataset').toEqual(expectedJob);
      });
    });

    describe('query transformation', () => {
      it('test_query_withDatadogQuery_shouldIncludeInSource', () => {
        // Given: Job with query option
        const job: SchemaCreateJob = {
          name: 'query_job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          query: 'service:api AND status:error',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          testTag: 'test_query'
        };

        // Expected: Source should have the query, plus tagging operation
        const expectedJob: SchemaCreateJob = {
          name: 'query_job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: 'service:api AND status:error'
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_query']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input',
              'test_dataset_source:output -> source_output_sink_input_test_tag:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_query'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Query should be included in transformed source').toEqual(expectedJob);
      });

      it('test_query_withLimitRecords_shouldIncludeLimitInBatchSource', () => {
        // Given: Batch job with limit
        const job: SchemaCreateJob = {
          name: 'limit_job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          limitRecords: 500,
          testTag: 'test_limit'
        };

        // Expected: Source should have the limit, plus tagging operation
        const expectedJob: SchemaCreateJob = {
          name: 'limit_job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 500
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_limit']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input',
              'test_dataset_source:output -> source_output_sink_input_test_tag:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_limit'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Limit should be included in batch source').toEqual(expectedJob);
      });
    });

    describe('tagging operations', () => {
      it('test_tagging_asyncWithTestDataset_shouldAddTaggingBeforeSink', () => {
        // Given: Simple async job with test dataset
        const job: SchemaCreateJob = {
          name: 'tagged_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          testDataset: 'test_output',
          testTag: 'test_tagging'
        };

        // Expected: Tagging operation added between source and sink, preserving original names
        const expectedJob: SchemaCreateJob = {
          name: 'tagged_job_test',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
              {
                type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
                name: 'test_async_sink',
                datasetId: 'test_output'
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_tagging']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source:output -> source_output_sink_input_test_tag:input',
              'source_output_sink_input_test_tag:output -> test_async_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_tagging'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Async job with testDataset should have tagging operation').toEqual(expectedJob);
      });

      it('test_tagging_syncJob_shouldAlsoAddTagging', () => {
        // Given: Sync job
        const job: SchemaCreateJob = {
          name: 'sync_job',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          testTag: 'test_sync_tagging'
        };

        // Expected: Tagging operations are always added, preserving original names
        const expectedJob: SchemaCreateJob = {
          name: 'sync_job_test',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset'),
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_sync_tagging']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source:output -> source_output_sink_input_test_tag:input',
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_sync_tagging'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Sync job should also have tagging operations').toEqual(expectedJob);
      });
    });

    describe('custom test name', () => {
      it('test_testName_customName_shouldUseProvidedName', () => {
        // Given: Job with custom test name
        const job: SchemaCreateJob = {
          name: 'original_name',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createDatadogSource('source', 'int'),
              createDatadogSink('sink', 'int')
            ],
            edges: ['source -> sink']
          }
        };

        const options: JobToTestOptions = {
          datasetId: 'test_dataset',
          start: '2025-01-01T00:00:00Z',
          end: '2025-01-01T01:00:00Z',
          testTag: 'test_custom',
          testName: 'my_custom_test_name'
        };

        // Expected: Custom name used instead of default, plus tagging operation with original names
        const expectedJob: SchemaCreateJob = {
          name: 'my_custom_test_name',
          execution: JobExecution.SYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              {
                type: LogsIcebergTableSourceType.logs_iceberg_table_source,
                name: 'test_dataset_source',
                datasetId: 'test_dataset',
                query: {
                  type: DatadogQueryPredicateType.datadog_query,
                  query: ''
                },
                start: '2025-01-01T00:00:00Z',
                end: '2025-01-01T01:00:00Z',
                limit: 100
              },
              createSyncSink('test_synchronous_sink'),
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_sink_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_custom']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_sink_input']
                  }
                ]
              }
            ],
            edges: [
              'source_output_sink_input_test_tag:output -> test_synchronous_sink:input',
              'test_dataset_source:output -> source_output_sink_input_test_tag:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_custom'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Custom test name should be used').toEqual(expectedJob);
      });
    });

    describe('non-default ports', () => {
      it('test_nonDefaultPorts_branchElseToCustomInput_shouldPreservePortNames', () => {
        // Given: Job with branch using else output and custom input port
        const job: SchemaCreateJob = {
          name: 'custom_ports_job',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
              createBranch('branch'),
              createFilter('filter_matched', 'status:ok'),
              createFilter('filter_else', 'status:error'),
              createDatadogSink('sink_matched', 'int'),
              createDatadogSink('sink_else', 'int')
            ],
            edges: [
              'source -> branch',
              'branch:output -> filter_matched:input',
              'branch:else -> filter_else:secondary_input',
              'filter_matched -> sink_matched',
              'filter_else -> sink_else'
            ]
          }
        };

        const options: JobToTestOptions = {
          testDataset: 'test_output',
          testTag: 'test_ports'
        };

        // Expected: Non-default port names should be preserved in tagging operation names
        const expectedJob: SchemaCreateJob = {
          name: 'custom_ports_job_test',
          execution: JobExecution.ASYNCHRONOUS,
          processing: JobProcessing.BATCH,
          jobGraph: {
            vertices: [
              createIcebergSource('source', 'dataset', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
              createBranch('branch'),
              createFilter('filter_matched', 'status:ok'),
              createFilter('filter_else', 'status:error'),
              {
                type: LogsIcebergTableSinkType.logs_iceberg_table_sink,
                name: 'test_async_sink',
                datasetId: 'test_output'
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'source_output_branch_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_ports']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['source_output_branch_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_output_filter_matched_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_ports']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_output_filter_matched_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'branch_else_filter_else_secondary_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_ports']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['branch_else_filter_else_secondary_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'filter_matched_output_sink_matched_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_ports']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['filter_matched_output_sink_matched_input']
                  }
                ]
              },
              {
                type: LogTransformActionType.log_transform,
                name: 'filter_else_output_sink_else_input_test_tag',
                transforms: [
                  {
                    order: 0,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.test_run_id',
                    values: ['test_ports']
                  },
                  {
                    order: 1,
                    type: TagActionType.tag_action,
                    modification: TagActionModification.ADD,
                    tagKey: 'grepr.edge',
                    values: ['filter_else_output_sink_else_input']
                  }
                ]
              }
            ],
            edges: [
              'branch:else -> branch_else_filter_else_secondary_input_test_tag:input',
              'branch:output -> branch_output_filter_matched_input_test_tag:input',
              'branch_else_filter_else_secondary_input_test_tag:output -> filter_else:secondary_input',
              'branch_output_filter_matched_input_test_tag:output -> filter_matched:input',
              'filter_else:output -> filter_else_output_sink_else_input_test_tag:input',
              'filter_else_output_sink_else_input_test_tag:output -> test_async_sink:input',
              'filter_matched:output -> filter_matched_output_sink_matched_input_test_tag:input',
              'filter_matched_output_sink_matched_input_test_tag:output -> test_async_sink:input',
              'source:output -> source_output_branch_input_test_tag:input',
              'source_output_branch_input_test_tag:output -> branch:input'
            ]
          },
          tags: {
            'grepr.test_run_id': 'test_ports'
          }
        };

        // When: Transform
        const testJob = transformJobToTest(job, options);

        // Then: Sort for comparison since Map iteration order is not guaranteed
        sortJobGraph(testJob);
        sortJobGraph(expectedJob);
        expect(testJob, 'Non-default port names should be preserved in edge names').toEqual(expectedJob);
      });
    });
  });
});
