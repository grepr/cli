import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

vi.mock('../../../main/typescript/lib/auth.js', () => ({
  ClientCredentialsAuth: MockClientCredentialsAuth,
  GreprAuth: MockGreprAuth
}));

// Import after mocking
const { GreprApiClient } = await import('../../../main/typescript/lib/grepr-api-client.js');
import type { ApiClientConfig } from '../../../main/typescript/types.js';

describe('GreprApiClient sendHeartbeat', () => {
  let client: InstanceType<typeof GreprApiClient>;
  let config: ApiClientConfig;

  beforeEach(() => {
    vi.clearAllMocks();

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