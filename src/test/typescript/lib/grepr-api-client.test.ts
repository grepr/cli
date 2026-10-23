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
const { GreprApiClient } = await import('../../../main/typescript/lib/grepr-api-client.js');
import type { ApiClientConfig } from '../../../main/typescript/types.js';
import { parseEndpoint, type ApiPath } from '../../../main/typescript/lib/api-request.js';
import {
  CreateLogsBackfillJobDataType,
  DatadogQueryPredicateType,
  type SchemaCreateBackfillJob
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

/** Returns the Request openapi-fetch handed to the mocked global fetch. */
function issuedRequest(callIndex = 0): Request {
  const request = mockFetch.mock.calls[callIndex]?.[0];
  if (!(request instanceof Request)) {
    throw new Error('Expected openapi-fetch to issue a Request');
  }
  return request;
}

describe('GreprApiClient with authMethod none', () => {
  it('sends requests with no Authorization header and never calls the oauth/client-credentials auth classes', async () => {
    vi.clearAllMocks();
    const noAuthConfig: ApiClientConfig = { ...API_CLIENT_CONFIG, authMethod: 'none' };
    const client = new GreprApiClient(noAuthConfig);

    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat('irrelevant-token');

    expect(issuedRequest().headers.get('Authorization')).toBeNull();
    expect(mockNoAuthGetAuthHeaders).toHaveBeenCalled();
    expect(mockGetAuthHeaders).not.toHaveBeenCalled();
  });
});

describe('GreprApiClient sendHeartbeat', () => {
  let client: InstanceType<typeof GreprApiClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-token' });
    client = new GreprApiClient(API_CLIENT_CONFIG);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should send heartbeat token as raw string WITHOUT JSON encoding (no quotes)', async () => {
    const heartbeatToken = 'test-heartbeat-token-123';
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat(heartbeatToken);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const request = issuedRequest();
    expect(request.url).toBe('https://test.app.grepr.ai/api/v1/jobs/sync/heartbeat');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(request.headers.get('Authorization')).toBe('Bearer test-token');
    // CRITICAL: the body is the raw token, not '"test-heartbeat-token-123"'
    expect(await request.text()).toBe(heartbeatToken);
  });

  it('should send empty heartbeat token as empty string (not JSON empty string)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat('');

    expect(await issuedRequest().text()).toBe('');
  });

  it('should send heartbeat token with special characters as raw string', async () => {
    const heartbeatToken = 'token-with-"quotes"-and-{brackets}';
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

    await client.sendHeartbeat(heartbeatToken);

    expect(await issuedRequest().text()).toBe(heartbeatToken);
  });

  it('should throw error when heartbeat request fails', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error Details', { status: 500, statusText: 'Internal Server Error' })
    );

    await expect(client.sendHeartbeat('failing-token')).rejects.toThrow(
      'Failed to send heartbeat: HTTP 500: Internal Server Error - Server Error Details'
    );
  });
});

describe('GreprApiClient debug logging', () => {
  const FULL_BEARER_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.full-secret-payload.signature';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthHeaders.mockResolvedValue({ Authorization: `Bearer ${FULL_BEARER_TOKEN}` });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  /** Everything the client printed to stdout and stderr while debug was on. */
  function capturedOutput(...spies: ReturnType<typeof vi.spyOn>[]): string {
    return spies.flatMap(spy => spy.mock.calls.flat()).map(arg => JSON.stringify(arg)).join('\n');
  }

  it('never prints the full bearer token, for heartbeat or sync-job requests', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new GreprApiClient({ ...API_CLIENT_CONFIG, debug: true });
    mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));
    mockFetch.mockResolvedValueOnce(new Response('{"jobState":"RUNNING"}\r\n', { status: 200 }));

    await client.sendHeartbeat('debug-token');
    await client.submitSyncJob({ name: 'draft' } as never);

    const output = capturedOutput(logSpy, errorSpy);
    expect(output).toContain('/v1/jobs/sync/heartbeat');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(FULL_BEARER_TOKEN);
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

  /** A 200 response whose body hands out the given reader, so tests can script stream chunks and failures. */
  function streamingResponse(reader: { read: ReturnType<typeof vi.fn> }): Response {
    const response = new Response('', { status: 200 });
    Object.defineProperty(response, 'body', { value: { getReader: () => reader } });
    return response;
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
    mockFetch.mockResolvedValueOnce(streamingResponse(reader));

    const stream = await client.submitSyncJob({ name: 'draft' } as never, controller.signal);

    await expect(drain(stream)).resolves.toContain('"jobState":"RUNNING"');
  });

  it('destroys the stream with the error when it fails without an abort', async () => {
    const reader = { read: vi.fn().mockRejectedValueOnce(new Error('network boom')) };
    mockFetch.mockResolvedValueOnce(streamingResponse(reader));

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

describe('GreprApiClient rawRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_rawRequest_sendsAuthorizedRequestAndReturnsTextBody', async () => {
    const client = new GreprApiClient({ ...API_CLIENT_CONFIG, apiBaseUrl: 'https://test.app.grepr.ai/api/' });
    mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', {
      status: 201,
      headers: { 'x-request-id': 'r1' }
    }));

    const result = await client.rawRequest('POST', parseEndpoint('/v1/datasets').path, {
      query: [['a', '1'], ['a', '2']],
      body: '{"name":"x"}',
      headers: { 'Content-Type': 'application/json' }
    });

    const request = mockFetch.mock.calls[0]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Expected rawRequest to issue a Request');
    }
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://test.app.grepr.ai/api/v1/datasets?a=1&a=2');
    expect(request.headers.get('authorization')).toBe('Bearer test-token');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.text()).toBe('{"name":"x"}');
    expect(result.status).toBe(201);
    expect(result.body).toBe('{"ok":true}');
    expect(result.headers.get('x-request-id')).toBe('r1');
  });

  it('test_rawRequest_debug_logsRedactedAuthHeader', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetAuthHeaders.mockResolvedValueOnce({ 'Authorization': 'Bearer abcdefgh-secret-part' });
    const client = new GreprApiClient({ ...API_CLIENT_CONFIG, debug: true });
    mockFetch.mockResolvedValueOnce(new Response('', { status: 204 }));

    await client.rawRequest('GET', parseEndpoint('/v1/jobs').path);

    const logged = JSON.stringify(errorSpy.mock.calls);
    errorSpy.mockRestore();
    expect(logged).toContain('abcdefgh...[REDACTED]');
    expect(logged).not.toContain('secret-part');
  });

  it.each(['.evil.com/x', '//evil.com/x'])('test_rawRequest_nonAbsolutePath_%s_isRefusedWithoutSending', async (path) => {
    const client = new GreprApiClient({ ...API_CLIENT_CONFIG, apiBaseUrl: 'https://test.app.grepr.ai' });

    // Forged on purpose: parseEndpoint never yields these, and rawRequest must not trust that alone.
    await expect(client.rawRequest('GET', path as ApiPath)).rejects.toThrow('absolute API path');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [200, '{"startTimeNanos":1234567890123456789,"ratio":1.0}'],
    [400, '{"message":"bad field","value":1234567890123456789}'],
    [502, '<html>bad gateway</html>'],
  ])('test_rawRequest_status%s_returnsBodyByteForByte', async (status, body) => {
    const client = new GreprApiClient(API_CLIENT_CONFIG);
    mockFetch.mockResolvedValueOnce(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));

    const result = await client.rawRequest('GET', parseEndpoint('/v1/jobs').path);

    expect(result.status).toBe(status);
    expect(result.body).toBe(body);
  });
});
