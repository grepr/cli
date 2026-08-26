import { describe, it, expect, vi } from 'bun:test';

// Mock the global fetch function and the auth classes before query-command.js
// is first imported: it pulls in grepr-api-client.js (for resolveQueryEngine),
// which constructs GreprAuth/ClientCredentialsAuth/NoAuth from auth.js. Static
// imports are hoisted ahead of these calls, so query-command.js must be
// imported dynamically, after the mocks are registered (same pattern as
// grepr-api-client.test.ts).
const mockFetch = vi.fn();
global.fetch = mockFetch;

interface MockAuthConfig {
  [key: string]: string | boolean | number | undefined;
}

class MockAuth {
  config: MockAuthConfig;
  constructor(config: MockAuthConfig) {
    this.config = config;
  }
  getAuthHeaders = vi.fn().mockResolvedValue({});
}

vi.mock('../../../main/typescript/lib/auth.js', () => ({
  ClientCredentialsAuth: MockAuth,
  GreprAuth: MockAuth,
  NoAuth: MockAuth
}));

const {
  buildQueryJobDefinition,
  validateQueryOptions,
  QueryCommand
} = await import('../../../main/typescript/commands/query-command.js');
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogQueryPredicateType,
  GreprRawLogsSourceType,
  GreprRawSpanSourceType,
  LogsIcebergTableSourceType,
  LogsSynchronousSinkType,
  ReadTrinoQueryEngineType,
  SpansSynchronousSinkType,
  TracesIcebergTableSourceType,
  TrinoRawLogsSourceType,
  TrinoRawSpanSourceType,
  type SchemaCreateJob
} from '../../../main/typescript/openapi/openApiTypes.js';
import type { QueryCommandOptions, ResolvedQueryEngine } from '../../../main/typescript/types.js';
import type { SignalDataType } from '../../../main/typescript/lib/signal-source.js';

interface BuildQueryJobDefinitionCase {
  dataType: SignalDataType;
  resolvedEngine: ResolvedQueryEngine;
  sourceType: string;
  sinkType: string;
}

const baseOptions: QueryCommandOptions = {
  orgName: 'test',
  authBaseUrl: 'http://auth',
  authMethod: 'oauth',
  clientId: 'cid',
  authCache: false,
  browser: false
};

const TRINO_INTEGRATION_ID = 'qe_trino_1';

describe('query-command', () => {
  describe('buildQueryJobDefinition', () => {
    for (const {
      dataType,
      resolvedEngine,
      sourceType,
      sinkType
    } of [
      {
        dataType: CreateLogsBackfillJobDataType.logs,
        resolvedEngine: { kind: 'athena' },
        sourceType: GreprRawLogsSourceType.grepr_raw_log_source,
        sinkType: LogsSynchronousSinkType.logs_sync_sink
      },
      {
        dataType: CreateLogsBackfillJobDataType.logs,
        resolvedEngine: { kind: 'flink' },
        sourceType: LogsIcebergTableSourceType.logs_iceberg_table_source,
        sinkType: LogsSynchronousSinkType.logs_sync_sink
      },
      {
        dataType: CreateLogsBackfillJobDataType.logs,
        resolvedEngine: { kind: 'trino', queryEngineIntegrationId: TRINO_INTEGRATION_ID },
        sourceType: TrinoRawLogsSourceType.trino_raw_log_source,
        sinkType: LogsSynchronousSinkType.logs_sync_sink
      },
      {
        dataType: CreateSpansBackfillJobDataType.spans,
        resolvedEngine: { kind: 'athena' },
        sourceType: GreprRawSpanSourceType.grepr_raw_span_source,
        sinkType: SpansSynchronousSinkType.spans_sync_sink
      },
      {
        dataType: CreateSpansBackfillJobDataType.spans,
        resolvedEngine: { kind: 'flink' },
        sourceType: TracesIcebergTableSourceType.traces_iceberg_table_source,
        sinkType: SpansSynchronousSinkType.spans_sync_sink
      },
      {
        dataType: CreateSpansBackfillJobDataType.spans,
        resolvedEngine: { kind: 'trino', queryEngineIntegrationId: TRINO_INTEGRATION_ID },
        sourceType: TrinoRawSpanSourceType.trino_raw_span_source,
        sinkType: SpansSynchronousSinkType.spans_sync_sink
      }
    ] satisfies BuildQueryJobDefinitionCase[]) {
      it(`test_buildQueryJobDefinition_${dataType}_${resolvedEngine.kind}_buildsSignalGraph`, () => {
        const job = buildQueryJobDefinition({
          ...baseOptions,
          datasetId: 'ds_raw',
          dataType,
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
        }, resolvedEngine, new Date('2026-07-07T12:00:00Z'));

        expect(job.jobGraph.vertices.map(vertex => vertex.type)).toEqual([
          sourceType,
          sinkType
        ]);
        expect(job.teamIds).toEqual(['team_alpha']);
        expect(job.jobGraph.edges).toEqual(['source -> sink']);
        if (resolvedEngine.kind === 'trino') {
          expect(job.jobGraph.vertices[0]).toMatchObject({
            queryEngineIntegrationId: resolvedEngine.queryEngineIntegrationId
          });
        } else {
          expect('queryEngineIntegrationId' in job.jobGraph.vertices[0]).toBe(false);
        }
        if (dataType === CreateSpansBackfillJobDataType.spans) {
          expect(job.jobGraph.vertices[0]).toMatchObject({
            query: {
              type: DatadogQueryPredicateType.datadog_query,
              query: 'serviceName:web'
            }
          });
          if (resolvedEngine.kind === 'flink') {
            expect(job.jobGraph.vertices[0]).toMatchObject({ serviceNames: ['web'] });
          } else {
            expect('serviceNames' in job.jobGraph.vertices[0]).toBe(false);
          }
        }
      });
    }

    it('test_buildQueryJobDefinition_resolvedEnginePassedIn_isPureWithNoNetworkCall', () => {
      // buildQueryJobDefinition takes an already-resolved engine and returns
      // synchronously: no integration lookup or feature-flag check happens
      // inside it, unlike the async resolveQueryEngine that produces this value.
      const job = buildQueryJobDefinition({
        ...baseOptions,
        datasetId: 'ds_raw',
        dataType: CreateLogsBackfillJobDataType.logs,
        query: 'service:web'
      }, {
        dataType: CreateLogsBackfillJobDataType.logs,
        datasetId: 'ds_raw',
        teamIds: [],
        sinkOperations: [],
        postReducerSqlOperations: []
      }, { kind: 'trino', queryEngineIntegrationId: TRINO_INTEGRATION_ID });

      expect(job).not.toBeInstanceOf(Promise);
      expect(job.jobGraph.vertices[0]).toMatchObject({
        type: TrinoRawLogsSourceType.trino_raw_log_source,
        queryEngineIntegrationId: TRINO_INTEGRATION_ID
      });
    });
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

  describe('QueryCommand.execute', () => {
    // Captures the job definition execute() would have submitted, instead of
    // actually streaming it, so the test can inspect what resolveQueryEngine's
    // result turned into on the wire — not just what the resolver returned.
    class TestableQueryCommand extends QueryCommand {
      capturedJob?: SchemaCreateJob;

      protected override async processJobStream(jobDefinition: SchemaCreateJob): Promise<void> {
        this.capturedJob = jobDefinition;
      }
    }

    it('test_execute_explicitTrino_propagatesResolvedIntegrationIdIntoSubmittedJob', async () => {
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: TRINO_INTEGRATION_ID,
          name: 'trino-prod',
          organizationId: 'org_1',
          jobIds: [],
          teamIds: [],
          type: ReadTrinoQueryEngineType.trino_query_engine,
          payload: {
            host: 'trino.internal.example.com',
            port: 443,
            catalog: 'lakehouse',
            ssl: true,
            user: 'grepr'
          },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          version: 1
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));

      const command = new TestableQueryCommand();
      await command.execute({
        ...baseOptions,
        queryEngine: 'trino',
        datasetId: 'ds_raw',
        dataType: CreateLogsBackfillJobDataType.logs,
        query: 'service:web',
        start: '2026-07-07T10:00:00Z',
        end: '2026-07-07T11:00:00Z',
        quiet: true
      });

      // resolveQueryEngine only produced the id (see the resolver tests in
      // grepr-api-client.test.ts) — this asserts it actually reaches the
      // source vertex of the job that would be submitted to the API.
      expect(command.capturedJob?.jobGraph.vertices[0]).toMatchObject({
        type: TrinoRawLogsSourceType.trino_raw_log_source,
        queryEngineIntegrationId: TRINO_INTEGRATION_ID
      });
    });
  });
});
