import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Mock the global fetch function first
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the auth classes with proper constructor functions
const mockGetAuthHeaders = vi.fn().mockResolvedValue({ 'Authorization': 'Bearer test-token' });

interface AuthConfig {
  [key: string]: string | boolean | number;
}

class MockClientCredentialsAuth {
  config: AuthConfig;
  constructor(config: AuthConfig) {
    this.config = config;
  }
  getAuthHeaders = mockGetAuthHeaders;
}

class MockGreprAuth {
  config: AuthConfig;
  constructor(config: AuthConfig) {
    this.config = config;
  }
  getAuthHeaders = mockGetAuthHeaders;
}

const mockNoAuthGetAuthHeaders = vi.fn().mockResolvedValue({});

class MockNoAuth {
  config: AuthConfig;
  constructor(config: AuthConfig) {
    this.config = config;
  }
  getAuthHeaders = mockNoAuthGetAuthHeaders;
}

vi.mock('../../../main/typescript/lib/auth.js', () => ({
  ClientCredentialsAuth: MockClientCredentialsAuth,
  GreprAuth: MockGreprAuth,
  NoAuth: MockNoAuth
}));

// Import after mocking
const { GreprApiClient, resolveQueryEngine } = await import('../../../main/typescript/lib/grepr-api-client.js');
import type { QueryEngineResolutionApiClient } from '../../../main/typescript/lib/grepr-api-client.js';
import type { ApiClientConfig } from '../../../main/typescript/types.js';
import {
  CreateLogsBackfillJobDataType,
  DatadogQueryPredicateType,
  ReadFeatureFlags,
  ReadTrinoQueryEngineType,
  type SchemaCreateBackfillJob,
  type SchemaRead,
  type SchemaReadTrinoQueryEngine
} from '../../../main/typescript/openapi/openApiTypes.js';

const API_CLIENT_CONFIG: ApiClientConfig = {
  orgName: 'test-org',
  apiBaseUrl: 'https://test.app.grepr.ai/api',
  authBaseUrl: 'https://test.app.grepr.ai/auth',
  authMethod: 'client-credentials',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  debug: false,
  authCache: true,
  browser: true
};

const BACKFILL_REQUEST: SchemaCreateBackfillJob = {
  dataType: CreateLogsBackfillJobDataType.logs,
  name: 'backfill_test',
  datasetId: 'dataset_1',
  start: '2026-07-07T10:00:00Z',
  end: '2026-07-07T11:00:00Z',
  query: {
    type: DatadogQueryPredicateType.datadog_query,
    query: 'service:test'
  },
  sinks: []
};

describe('GreprApiClient getTemplate', () => {
  it('requests the pinned version and unwraps the template collection', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{
        id: '0qqtysycrgp1a',
        name: 'log-reducer-job-graph-template',
        template: '',
        version: 16
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const template = await client.getTemplate('0qqtysycrgp1a', 16);

    expect(template).toMatchObject({
      id: '0qqtysycrgp1a',
      name: 'log-reducer-job-graph-template',
      version: 16
    });
    const request = mockFetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Expected openapi-fetch to issue a Request');
    }
    expect(request.url).toBe(
      'https://test.app.grepr.ai/api/v1/templates/0qqtysycrgp1a?version=16'
    );
  });

  it('throws when the template version is not found', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(client.getTemplate('0qqtysycrgp1a', 16)).rejects.toThrow(
      'Template 0qqtysycrgp1a version 16 not found'
    );
  });
});

describe('GreprApiClient createBackfillJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_createBackfillJob_success_sendsRequestAndReturnsJob', async () => {
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'job_backfill'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const job = await client.createBackfillJob(BACKFILL_REQUEST);

    expect(job).toMatchObject({ id: 'job_backfill' });
    const request = mockFetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Expected openapi-fetch to issue a Request');
    }
    expect(await request.json()).toEqual(BACKFILL_REQUEST);
  });

  it('test_createBackfillJob_bodylessFailure_preservesHttpStatus', async () => {
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 502 }));

    const promise = client.createBackfillJob(BACKFILL_REQUEST);

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
      message: 'Failed to create backfill job (HTTP 502)'
    });
  });

  it('test_createBackfillJob_structuredFailure_includesResponseBody', async () => {
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      message: 'Invalid trace sink'
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(client.createBackfillJob(BACKFILL_REQUEST)).rejects.toThrow(
      'Failed to create backfill job (HTTP 422): {"message":"Invalid trace sink"}'
    );
  });
});

describe('GreprApiClient with authMethod none', () => {
  it('sends requests with no Authorization header and never calls the oauth/client-credentials auth classes', async () => {
    vi.clearAllMocks();
    const noAuthConfig: ApiClientConfig = { ...API_CLIENT_CONFIG, authMethod: 'none' };
    const client = new GreprApiClient(noAuthConfig);

    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat('irrelevant-token');

    const [, options] = mockFetch.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(mockNoAuthGetAuthHeaders).toHaveBeenCalled();
    expect(mockGetAuthHeaders).not.toHaveBeenCalled();
  });
});

describe('GreprApiClient sendHeartbeat', () => {
  let client: InstanceType<typeof GreprApiClient>;
  let config: ApiClientConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    config = API_CLIENT_CONFIG;

    client = new GreprApiClient(config);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should send heartbeat token as raw string WITHOUT JSON encoding (no quotes)', async () => {
    const heartbeatToken = 'test-heartbeat-token-123';

    // Mock successful response
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat(heartbeatToken);

    // Verify fetch was called with correct parameters
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];

    // Verify URL
    expect(url).toBe('https://test.app.grepr.ai/api/v1/jobs/sync/heartbeat');

    // Verify method and headers
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token'
    });

    // CRITICAL: Verify body is the raw string WITHOUT JSON encoding
    expect(options.body).toBe(heartbeatToken);
    expect(options.body).toBe('test-heartbeat-token-123');
  });

  it('should send empty heartbeat token as empty string (not JSON empty string)', async () => {
    const heartbeatToken = '';

    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat(heartbeatToken);

    const [, options] = mockFetch.mock.calls[0] as [string, any];

    // Verify empty string is sent as-is, not as JSON empty string
    expect(options.body).toBe('');
  });

  it('should send heartbeat token with special characters as raw string', async () => {
    const heartbeatToken = 'token-with-"quotes"-and-{brackets}';

    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat(heartbeatToken);

    const [, options] = mockFetch.mock.calls[0] as [string, any];

    // Verify special characters are sent as-is in the raw string
    expect(options.body).toBe('token-with-"quotes"-and-{brackets}');
  });

  it('should include debug logging when debug is enabled', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Create client with debug enabled
    const debugConfig = { ...config, debug: true };
    const debugClient = new GreprApiClient(debugConfig);

    const heartbeatToken = 'debug-token';
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await debugClient.sendHeartbeat(heartbeatToken);

    // Verify debug logging shows the raw token, not JSON-encoded
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sending heartbeat to'),
      expect.objectContaining({
        method: 'POST',
        body: 'debug-token' // Raw string, not '"debug-token"'
      })
    );

    consoleSpy.mockRestore();
  });

  it('should throw error when heartbeat request fails', async () => {
    const heartbeatToken = 'failing-token';

    // Mock failed response with error body
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: {
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined })
        })
      },
      text: () => Promise.resolve('Server Error Details')
    };

    mockFetch.mockResolvedValueOnce(mockResponse);

    await expect(client.sendHeartbeat(heartbeatToken)).rejects.toThrow(
      'Failed to send heartbeat: HTTP 500: Internal Server Error - Server Error Details'
    );
  });
});

describe('GreprApiClient submitSyncJob', () => {
  let client: InstanceType<typeof GreprApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GreprApiClient(API_CLIENT_CONFIG);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  /** Drains a Node stream, resolving with its concatenated text or rejecting on stream 'error'. */
  function drain(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk as Buffer));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
      stream.on('error', reject);
    });
  }

  it('ends the stream cleanly (no error) when the abort signal fires mid-stream', async () => {
    // A max-duration abort must surface already-streamed records as a clean
    // end, not a stream error — otherwise the draft would be read as failed.
    const controller = new AbortController();
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('{"jobState":"RUNNING"}\r\n') })
        .mockImplementationOnce(() => {
          controller.abort();
          return Promise.reject(new Error('The operation was aborted'));
        }),
    };
    mockFetch.mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } });

    const stream = await client.submitSyncJob({ name: 'draft' } as never, controller.signal);

    await expect(drain(stream)).resolves.toContain('"jobState":"RUNNING"');
  });

  it('destroys the stream with the error when it fails without an abort', async () => {
    const reader = { read: vi.fn().mockRejectedValueOnce(new Error('network boom')) };
    mockFetch.mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } });

    const stream = await client.submitSyncJob({ name: 'draft' } as never);

    await expect(drain(stream)).rejects.toThrow('network boom');
  });
});

describe('GreprApiClient updateJob rollback default', () => {
  let client: InstanceType<typeof GreprApiClient>;
  let config: ApiClientConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' });

    config = {
      orgName: 'test-org',
      apiBaseUrl: 'https://test.app.grepr.ai/api',
      authBaseUrl: 'https://test.app.grepr.ai/auth',
      authMethod: 'client-credentials',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      debug: false,
      authCache: true,
      browser: true
    };

    client = new GreprApiClient(config);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const jobUpdateResponse = () =>
    new Response(JSON.stringify({ id: '123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  const requestedUrl = (): string => {
    const [arg] = mockFetch.mock.calls[0] as [string | Request];
    return typeof arg === 'string' ? arg : arg.url;
  };

  it('test_updateJob_noRollbackArg_defaultsToRollbackEnabledTrue', async () => {
    mockFetch.mockResolvedValueOnce(jobUpdateResponse());

    await client.updateJob('123', { name: 'job' } as never);

    expect(requestedUrl()).toContain('rollbackEnabled=true');
  });

  it('test_updateJob_rollbackDisabled_sendsRollbackEnabledFalse', async () => {
    mockFetch.mockResolvedValueOnce(jobUpdateResponse());

    await client.updateJob('123', { name: 'job' } as never, false);

    expect(requestedUrl()).toContain('rollbackEnabled=false');
  });
});

function trinoIntegration(id: string): SchemaReadTrinoQueryEngine {
  return {
    id,
    name: `trino-integration-${id}`,
    organizationId: 'org_1',
    jobIds: ['job_1'],
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
    updatedAt: '2026-01-02T00:00:00Z',
    version: 1
  };
}

// Only `name` and `featureFlags` are populated: resolveQueryEngine reads
// featureFlags exclusively, and the other required Organization.Read fields
// (accessConfig, constraints, plan) are irrelevant to that behavior.
function organization(featureFlags: ReadFeatureFlags[] = []): SchemaRead {
  return { name: 'test-org', featureFlags } as SchemaRead;
}

function queryEngineApiClient(
  overrides: Partial<QueryEngineResolutionApiClient> = {}
): QueryEngineResolutionApiClient {
  return {
    getOrganization: vi.fn(async () => organization()),
    listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [] })),
    ...overrides
  };
}

describe('GreprApiClient getOrganization', () => {
  it('test_getOrganization_success_returnsOrganizationWithFeatureFlags', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      name: 'acme',
      featureFlags: [ReadFeatureFlags.TRINO_QUERY_ENGINE]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const org = await client.getOrganization();

    expect(org).toMatchObject({ name: 'acme', featureFlags: [ReadFeatureFlags.TRINO_QUERY_ENGINE] });
    const request = mockFetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Expected openapi-fetch to issue a Request');
    }
    expect(request.url).toBe('https://test.app.grepr.ai/api/v1/organization');
  });

  it('test_getOrganization_apiError_throws', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(client.getOrganization()).rejects.toThrow('Failed to get organization');
  });
});

describe('GreprApiClient listTrinoQueryEngineIntegrations', () => {
  it('test_listTrinoQueryEngineIntegrations_success_returnsItems', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [trinoIntegration('qe_1')]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const integrations = await client.listTrinoQueryEngineIntegrations();

    expect(integrations?.items).toHaveLength(1);
    expect(integrations?.items?.[0]).toMatchObject({ id: 'qe_1' });
    const request = mockFetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Expected openapi-fetch to issue a Request');
    }
    expect(request.url).toBe('https://test.app.grepr.ai/api/v1/integrations/trino-query-engine');
  });

  it('test_listTrinoQueryEngineIntegrations_apiError_throws', async () => {
    vi.clearAllMocks();
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }));

    await expect(client.listTrinoQueryEngineIntegrations()).rejects.toThrow(
      'Failed to list Trino query engine integrations'
    );
  });
});

describe('resolveQueryEngine', () => {
  it('test_resolveQueryEngine_explicitAthena_winsWithNoNetworkCalls', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    const resolved = await resolveQueryEngine('athena', client);

    // Explicit athena wins even though a Trino integration exists and the flag is on.
    expect(resolved).toEqual({ kind: 'athena' });
    expect(client.getOrganization).not.toHaveBeenCalled();
    expect(client.listTrinoQueryEngineIntegrations).not.toHaveBeenCalled();
  });

  it('test_resolveQueryEngine_explicitFlink_winsWithNoNetworkCalls', async () => {
    const client = queryEngineApiClient();

    const resolved = await resolveQueryEngine('flink', client);

    expect(resolved).toEqual({ kind: 'flink' });
    expect(client.getOrganization).not.toHaveBeenCalled();
    expect(client.listTrinoQueryEngineIntegrations).not.toHaveBeenCalled();
  });

  it('test_resolveQueryEngine_explicitTrino_exactlyOneIntegration_resolvesToTrino', async () => {
    const client = queryEngineApiClient({
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    const resolved = await resolveQueryEngine('trino', client);

    expect(resolved).toEqual({ kind: 'trino', queryEngineIntegrationId: 'qe_1' });
  });

  it('test_resolveQueryEngine_explicitTrino_noIntegration_throwsClearError', async () => {
    const client = queryEngineApiClient();

    const failure = resolveQueryEngine('trino', client);

    await expect(failure).rejects.toThrow(
      'No Trino query engine integration is configured for this organization.'
    );
    // There is no --query-engine CLI flag (the setting is env-only,
    // GREPR_QUERY_ENGINE) — the remedy must name the real mechanism.
    await expect(failure).rejects.toThrow('GREPR_QUERY_ENGINE');
    await expect(failure).rejects.not.toThrow(/--query-engine/);
  });

  it('test_resolveQueryEngine_explicitTrino_twoIntegrations_throwsAmbiguityError', async () => {
    const client = queryEngineApiClient({
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({
        items: [trinoIntegration('qe_1'), trinoIntegration('qe_2')]
      }))
    });

    const failure = resolveQueryEngine('trino', client);

    await expect(failure).rejects.toThrow(
      'This organization has 2 Trino query engine integrations; the CLI will not guess which one to use.'
    );
    // Setting the engine to trino cannot pick which integration to use, so
    // the message must not imply it can, or reference the non-existent
    // --query-engine flag.
    await expect(failure).rejects.not.toThrow(/--query-engine/);
    await expect(failure).rejects.toThrow('GREPR_QUERY_ENGINE=athena');
  });

  it('test_resolveQueryEngine_unsetFlagOff_keepsTodaysDefaultWithoutListingIntegrations', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    const resolved = await resolveQueryEngine(undefined, client);

    expect(resolved).toEqual({ kind: 'athena' });
    // Discovery must not list integrations once the flag says it is off.
    expect(client.listTrinoQueryEngineIntegrations).not.toHaveBeenCalled();
  });

  it('test_resolveQueryEngine_unsetFlagOnExactlyOneIntegration_discoversTrino', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    const resolved = await resolveQueryEngine(undefined, client);

    expect(resolved).toEqual({ kind: 'trino', queryEngineIntegrationId: 'qe_1' });
  });

  it('test_resolveQueryEngine_unsetFlagOnNoIntegrations_keepsTodaysDefault', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE]))
    });

    const resolved = await resolveQueryEngine(undefined, client);

    expect(resolved).toEqual({ kind: 'athena' });
  });

  it('test_resolveQueryEngine_unsetFlagOnTwoIntegrations_throwsAmbiguityErrorNotArbitraryPick', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({
        items: [trinoIntegration('qe_1'), trinoIntegration('qe_2')]
      }))
    });

    await expect(resolveQueryEngine(undefined, client)).rejects.toThrow(
      'This organization has 2 Trino query engine integrations; the CLI will not guess which one to use.'
    );
  });

  it('test_resolveQueryEngine_unsetIntegrationListFails_throwsNotAthenaFallThrough', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => {
        throw new Error('Failed to list Trino query engine integrations: {"message":"boom"}');
      })
    });

    await expect(resolveQueryEngine(undefined, client)).rejects.toThrow(
      'Failed to list Trino query engine integrations'
    );
  });

  it('test_resolveQueryEngine_unsetOrganizationLookupFails_throwsNotAthenaFallThrough', async () => {
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => {
        throw new Error('Failed to get organization: {"message":"boom"}');
      }),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    await expect(resolveQueryEngine(undefined, client)).rejects.toThrow('Failed to get organization');
    // A failed feature-flag lookup must not fall through to listing integrations either.
    expect(client.listTrinoQueryEngineIntegrations).not.toHaveBeenCalled();
  });

  it('test_resolveQueryEngine_unsetOrganizationResponseUndefined_throwsRatherThanTreatingFlagAsOff', async () => {
    // A 2xx with no body resolves getOrganization() to undefined without
    // throwing (see GreprApiClient.getOrganization) — that must not be read
    // as "flag off" and silently fall through to Athena.
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => undefined),
      listTrinoQueryEngineIntegrations: vi.fn(async () => ({ items: [trinoIntegration('qe_1')] }))
    });

    await expect(resolveQueryEngine(undefined, client)).rejects.toThrow(
      'GET /v1/organization returned no data'
    );
    expect(client.listTrinoQueryEngineIntegrations).not.toHaveBeenCalled();
  });

  it('test_resolveQueryEngine_unsetIntegrationsResponseUndefined_throwsRatherThanTreatingListAsEmpty', async () => {
    // Same shape of bug on the other lookup: a bodiless 2xx resolves
    // listTrinoQueryEngineIntegrations() to undefined without throwing, which
    // must not be read as "zero integrations" and silently fall through to
    // Athena — that is a genuinely different answer.
    const client = queryEngineApiClient({
      getOrganization: vi.fn(async () => organization([ReadFeatureFlags.TRINO_QUERY_ENGINE])),
      listTrinoQueryEngineIntegrations: vi.fn(async () => undefined)
    });

    await expect(resolveQueryEngine(undefined, client)).rejects.toThrow(
      'GET /v1/integrations/trino-query-engine returned no data'
    );
  });
});
