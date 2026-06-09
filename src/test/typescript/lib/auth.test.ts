import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ApiClientConfig } from '../../../main/typescript/types.js';

const mockPathExists = vi.fn();
const mockReadJson = vi.fn();
const mockEnsureDir = vi.fn();
const mockWriteJson = vi.fn();

vi.mock('fs-extra', () => ({
  default: {
    pathExists: mockPathExists,
    readJson: mockReadJson,
    ensureDir: mockEnsureDir,
    writeJson: mockWriteJson,
  },
}));

const mockAxiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
  },
}));

const { ClientCredentialsAuth } = await import('../../../main/typescript/lib/auth.js');

const BASE_CONFIG: ApiClientConfig = {
  orgName: 'test-org',
  apiBaseUrl: 'https://test.app.grepr.ai/api',
  authBaseUrl: 'https://auth.grepr.ai',
  authMethod: 'client-credentials',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authCache: true,
  browser: true,
  debug: false,
};

function validToken(accessToken = 'cached-access-token') {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 86400,
    expires_at: Date.now() + 60 * 60 * 1000,
  };
}

function expiredToken(accessToken = 'expired-access-token') {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 86400,
    expires_at: Date.now() - 60 * 60 * 1000,
  };
}

function mockAuth0Success(accessToken = 'fresh-access-token') {
  mockAxiosPost.mockResolvedValueOnce({
    data: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400,
    },
  });
}

function mockAuth0Failure(description = 'invalid client') {
  mockAxiosPost.mockRejectedValueOnce({
    response: { data: { error_description: description } },
    message: 'Request failed',
  });
}

function mockDiskTokenFound(token: object) {
  mockPathExists.mockResolvedValueOnce(true);
  mockReadJson.mockResolvedValueOnce(token);
}

function mockDiskTokenMissing() {
  mockPathExists.mockResolvedValueOnce(false);
}

function mockDiskWriteSuccess() {
  mockEnsureDir.mockResolvedValueOnce(undefined);
  mockWriteJson.mockResolvedValueOnce(undefined);
}

describe('ClientCredentialsAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('test_constructor_missingClientSecret_shouldThrow', () => {
      const configWithoutSecret: ApiClientConfig = { ...BASE_CONFIG, clientSecret: undefined };
      expect(() => new ClientCredentialsAuth(configWithoutSecret)).toThrow(
        'Client secret is required for client-credentials authentication. Use --client-secret option.'
      );
    });

    it('test_constructor_withClientSecret_shouldNotThrow', () => {
      expect(() => new ClientCredentialsAuth(BASE_CONFIG)).not.toThrow();
    });
  });

  describe('getAuthHeaders', () => {
    it('test_getAuthHeaders_validInMemoryToken_shouldReturnWithoutAnyIO', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockAuth0Success('first-token');
      mockDiskTokenMissing();
      mockDiskWriteSuccess();

      await auth.getAuthHeaders();

      vi.clearAllMocks();

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer first-token' });
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockPathExists).not.toHaveBeenCalled();
      expect(mockWriteJson).not.toHaveBeenCalled();
    });

    it('test_getAuthHeaders_expiredInMemoryValidDisk_shouldUseDiskTokenWithoutCallingAuth0', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      const diskToken = validToken('disk-access-token');
      mockDiskTokenFound(diskToken);

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer disk-access-token' });
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockPathExists).toHaveBeenCalledTimes(1);
    });

    it('test_getAuthHeaders_expiredInMemoryExpiredDisk_shouldCallAuth0AndSaveToDisk', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenFound(expiredToken());
      mockAuth0Success('fresh-from-auth0');
      mockDiskWriteSuccess();

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer fresh-from-auth0' });
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(mockEnsureDir).toHaveBeenCalledTimes(1);
      expect(mockWriteJson).toHaveBeenCalledTimes(1);
    });

    it('test_getAuthHeaders_noCacheFile_shouldCallAuth0AndSaveToDisk', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenMissing();
      mockAuth0Success('brand-new-token');
      mockDiskWriteSuccess();

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer brand-new-token' });
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(mockPathExists).toHaveBeenCalledTimes(1);
      expect(mockEnsureDir).toHaveBeenCalledTimes(1);
      expect(mockWriteJson).toHaveBeenCalledTimes(1);

      const [, savedToken] = mockWriteJson.mock.calls[0] as [string, object];
      expect(savedToken).toMatchObject({ access_token: 'brand-new-token' });
    });

    it('test_getAuthHeaders_authCacheDisabled_shouldSkipDiskReadAndWrite', async () => {
      const noCacheConfig: ApiClientConfig = { ...BASE_CONFIG, authCache: false };
      const auth = new ClientCredentialsAuth(noCacheConfig);

      mockAuth0Success('no-cache-token');

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer no-cache-token' });
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(mockPathExists).not.toHaveBeenCalled();
      expect(mockEnsureDir).not.toHaveBeenCalled();
      expect(mockWriteJson).not.toHaveBeenCalled();
    });

    it('test_getAuthHeaders_auth0BaseUrl_shouldExchangeJsonAtOauthTokenEndpoint', async () => {
      const auth = new ClientCredentialsAuth({ ...BASE_CONFIG, authCache: false });

      mockAuth0Success('auth0-token');

      await auth.getAuthHeaders();

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://auth.grepr.ai/oauth/token',
        {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          audience: 'service',
          grant_type: 'client_credentials',
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
    });

    it('test_getAuthHeaders_auth0Failure_shouldPropagateErrorWithEndpoint', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenMissing();
      mockAuth0Failure('invalid_client: client credentials are invalid');

      await expect(auth.getAuthHeaders()).rejects.toThrow(
        'Client credentials token exchange failed at https://auth.grepr.ai/oauth/token: ' +
          'invalid_client: client credentials are invalid'
      );
    });

    it('test_getAuthHeaders_auth0FailureWithStatusAndErrorCode_shouldIncludeBoth', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenMissing();
      mockAxiosPost.mockRejectedValueOnce({
        response: { status: 401, data: { error: 'access_denied' } },
        message: 'Request failed with status code 401',
      });

      await expect(auth.getAuthHeaders()).rejects.toThrow(
        'Client credentials token exchange failed (HTTP 401) at https://auth.grepr.ai/oauth/token: access_denied'
      );
    });

    it('test_getAuthHeaders_auth0FailureGenericError_shouldPropagateMessage', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenMissing();
      mockAxiosPost.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(auth.getAuthHeaders()).rejects.toThrow(
        'Client credentials token exchange failed at https://auth.grepr.ai/oauth/token: Network timeout'
      );
    });

    it('test_getAuthHeaders_diskReadError_shouldFallThroughToAuth0', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockPathExists.mockResolvedValueOnce(true);
      mockReadJson.mockRejectedValueOnce(new Error('Permission denied'));
      mockAuth0Success('fallback-token');
      mockDiskWriteSuccess();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer fallback-token' });
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load cached M2M token:',
        'Permission denied'
      );

      consoleSpy.mockRestore();
    });

    it('test_getAuthHeaders_diskWriteError_shouldStillReturnToken', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      mockDiskTokenMissing();
      mockAuth0Success('token-despite-write-error');
      mockEnsureDir.mockRejectedValueOnce(new Error('Disk full'));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer token-despite-write-error' });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save M2M token to cache:',
        'Disk full'
      );

      consoleSpy.mockRestore();
    });

    it('test_getAuthHeaders_diskTokenUsed_shouldUpdateInMemoryCacheForSubsequentCalls', async () => {
      const auth = new ClientCredentialsAuth(BASE_CONFIG);

      const diskToken = validToken('disk-token');
      mockDiskTokenFound(diskToken);

      await auth.getAuthHeaders();

      vi.clearAllMocks();

      const headers = await auth.getAuthHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer disk-token' });
      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(mockPathExists).not.toHaveBeenCalled();
    });
  });
});
