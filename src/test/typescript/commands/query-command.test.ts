import { describe, it, expect } from 'bun:test';
import {
  buildQueryJobDefinition,
  validateQueryOptions
} from '../../../main/typescript/commands/query-command.js';
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogQueryPredicateType,
  GreprRawLogsSourceType,
  GreprRawSpanSourceType,
  LogsIcebergTableSourceType,
  LogsSynchronousSinkType,
  SpansSynchronousSinkType,
  TracesIcebergTableSourceType
} from '../../../main/typescript/openapi/openApiTypes.js';
import type { QueryCommandOptions } from '../../../main/typescript/types.js';

const baseOptions: QueryCommandOptions = {
  orgName: 'test',
  authBaseUrl: 'http://auth',
  authMethod: 'oauth',
  clientId: 'cid',
  authCache: false,
  browser: false
};

describe('query-command', () => {
  describe('buildQueryJobDefinition', () => {
    for (const {
      dataType,
      queryEngine,
      sourceType,
      sinkType
    } of [
      {
        dataType: CreateLogsBackfillJobDataType.logs,
        queryEngine: 'athena',
        sourceType: GreprRawLogsSourceType.grepr_raw_log_source,
        sinkType: LogsSynchronousSinkType.logs_sync_sink
      },
      {
        dataType: CreateLogsBackfillJobDataType.logs,
        queryEngine: 'flink',
        sourceType: LogsIcebergTableSourceType.logs_iceberg_table_source,
        sinkType: LogsSynchronousSinkType.logs_sync_sink
      },
      {
        dataType: CreateSpansBackfillJobDataType.spans,
        queryEngine: 'athena',
        sourceType: GreprRawSpanSourceType.grepr_raw_span_source,
        sinkType: SpansSynchronousSinkType.spans_sync_sink
      },
      {
        dataType: CreateSpansBackfillJobDataType.spans,
        queryEngine: 'flink',
        sourceType: TracesIcebergTableSourceType.traces_iceberg_table_source,
        sinkType: SpansSynchronousSinkType.spans_sync_sink
      }
    ] as const) {
      it(`test_buildQueryJobDefinition_${dataType}_${queryEngine}_buildsSignalGraph`, () => {
        const job = buildQueryJobDefinition({
          ...baseOptions,
          datasetId: 'ds_raw',
          dataType,
          queryEngine,
          query: dataType === CreateSpansBackfillJobDataType.spans
            ? 'serviceName:web'
            : 'service:web',
          start: '2026-07-07T10:00:00Z',
          end: '2026-07-07T11:00:00Z'
        }, {
          dataType,
          datasetId: 'ds_raw',
          teamIds: ['team_alpha'],
          sinkOperations: [],
          postReducerSqlOperations: []
        }, new Date('2026-07-07T12:00:00Z'));

        expect(job.jobGraph.vertices.map(vertex => vertex.type)).toEqual([
          sourceType,
          sinkType
        ]);
        expect(job.teamIds).toEqual(['team_alpha']);
        expect(job.jobGraph.edges).toEqual(['source -> sink']);
        if (dataType === CreateSpansBackfillJobDataType.spans) {
          expect(job.jobGraph.vertices[0]).toMatchObject({
            query: {
              type: DatadogQueryPredicateType.datadog_query,
              query: 'serviceName:web'
            },
            serviceNames: ['web']
          });
        }
      });
    }
  });

  describe('validateQueryOptions', () => {
    it('test_validateQueryOptions_explicitDatasetAllowsOmittedDataType', () => {
      expect(() => validateQueryOptions({
        ...baseOptions,
        datasetId: 'ds_raw'
      })).not.toThrow();
    });

    it('test_validateQueryOptions_jobDerivedAllowsOmittedDataType', () => {
      expect(() => validateQueryOptions({
        ...baseOptions,
        jobId: 'job_1'
      })).not.toThrow();
    });
  });
});
