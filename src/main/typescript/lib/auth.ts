import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { randomBytes, createHash } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import open from 'open';
import axios from 'axios';
import { ApiClientConfig } from '../types.js';

const AUTH_CACHE_DIR = path.join(os.homedir(), '.grepr', 'auth');

export interface AuthConfig extends ApiClientConfig {
}

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
}

interface ClientCredentialsConfig extends AuthConfig {
  clientSecret: string;
  authMethod: 'client-credentials';
}

interface OAuthAuthConfig extends AuthConfig {
  authMethod: 'oauth';
  authUrl: string;
  tokenUrl: string;
  redirectUrl: string;
  audience: string;
  clientId: string;
  orgId: string;
}

/**
 * Client credentials (2-legged) authentication for non-interactive use.
 * Exchanges client_id + client_secret for a Bearer token via Auth0's /oauth/token endpoint.
 *
 * Token resolution order (in priority):
 * 1. In-memory cache  (always checked first, no I/O)
 * 2. Disk cache       (if authCache === true and cache file exists and token not expired)
 * 3. Auth0 fetch      (last resort — saves result to in-memory and disk)
 */
export class ClientCredentialsAuth {
  public config: ClientCredentialsConfig;
  private cachedToken: TokenData | null = null;

  constructor(options: ApiClientConfig) {
    this.config = this.buildConfig(options);
  }

  /**
   * Get the path to the M2M token cache file for this client ID.
   */
  private get tokenCachePath(): string {
    return path.join(AUTH_CACHE_DIR, `${this.config.clientId}-m2m.json`);
  }

  /**
   * Build configuration from command-line options
   */
  private buildConfig(options: ApiClientConfig): ClientCredentialsConfig {
    const { clientSecret } = options;

    if (!clientSecret) {
      throw new Error('Client secret is required for client-credentials authentication. Use --client-secret option.');
    }

    return {
      ...options,
      clientSecret,
      authMethod: 'client-credentials' as const,
    };
  }

  /**
   * Get authentication headers for API requests
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * Load cached M2M token from disk. Returns null on cache miss or read error.
   */
  private async loadCachedToken(): Promise<TokenData | null> {
    try {
      if (await fs.pathExists(this.tokenCachePath)) {
        return await fs.readJson(this.tokenCachePath);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to load cached M2M token:', errorMessage);
    }
    return null;
  }

  /**
   * Save M2M token to disk cache with restricted permissions (0600).
   * Errors are swallowed with a warning so a write failure never blocks a CLI invocation.
   */
  private async saveCachedToken(tokenData: TokenData): Promise<void> {
    try {
      await fs.ensureDir(AUTH_CACHE_DIR, { mode: 0o700 });
      await fs.writeJson(this.tokenCachePath, tokenData, { spaces: 2, mode: 0o600 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to save M2M token to cache:', errorMessage);
    }
  }

  /**
   * Get a valid access token, fetching a new one if expired.
   * Checks in-memory cache first, then disk cache (if authCache is enabled), then Auth0.
   */
  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && !this.isTokenExpired(this.cachedToken)) {
      return this.cachedToken.access_token;
    }

    if (this.config.authCache) {
      const diskToken = await this.loadCachedToken();
      if (diskToken && !this.isTokenExpired(diskToken)) {
        this.cachedToken = diskToken;
        return diskToken.access_token;
      }
    }

    const tokenUrl = `${this.config.authBaseUrl}/oauth/token`;
    const tokenParams = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      audience: 'service',
      grant_type: 'client_credentials',
    };

    try {
      const response = await axios.post(tokenUrl, tokenParams, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const tokenData: TokenData = response.data;
      tokenData.expires_at = Date.now() + (tokenData.expires_in * 1000);
      this.cachedToken = tokenData;

      if (this.config.authCache) {
        await this.saveCachedToken(tokenData);
      }

      return tokenData.access_token;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const response =
        (error as { response?: { status?: number; data?: { error?: string; error_description?: string } } })?.response;
      const detail = response?.data?.error_description || response?.data?.error || errorMessage;
      const status = response?.status ? ` (HTTP ${response.status})` : '';
      throw new Error(`Client credentials token exchange failed${status} at ${tokenUrl}: ${detail}`);
    }
  }

  /**
   * Check if token is expired (with 5 minute buffer)
   */
  private isTokenExpired(tokenData: TokenData): boolean {
    if (!tokenData.expires_at) {
      return true;
    }
    const buffer = 5 * 60 * 1000;
    return Date.now() >= (tokenData.expires_at - buffer);
  }
}

/**
 * OAuth-based authentication (simplified version for now)
 */
export class GreprAuth {
  public config: OAuthAuthConfig;

  constructor(options: ApiClientConfig) {
    this.config = this.buildConfig(options);
  }

  /**
   * Get the path to the token cache file
   */
  private get tokenCachePath(): string {
    return path.join(AUTH_CACHE_DIR, `${this.config.orgId}.json`);
  }

  /**
   * Build configuration from command-line options
   */
  private buildConfig(options: ApiClientConfig): OAuthAuthConfig {
    const {
      orgName,
      authBaseUrl,
    } = options;

    if (!orgName) {
      throw new Error('Organization name is required. Use --org-name option.');
    }

    const orgId = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const oauthConf = {
      ...options,
      authMethod: 'oauth' as const,
      authUrl: `${authBaseUrl}/authorize`,
      tokenUrl: `${authBaseUrl}/oauth/token`,
      redirectUrl: `http://${orgId}.app.localhost:3000`,
      audience: 'service',
      orgId
    };

    if (options.debug) {
      console.log('OAuth configuration:', oauthConf);
    }

    return oauthConf;
  }

  /**
   * Get authentication headers for API requests (OAuth uses Bearer token)
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return {
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    // Skip cache if --no-auth-cache option is set
    if (!this.config.authCache) {
      console.log('Forcing fresh authentication (--no-auth-cache option enabled)');
      return await this.performFreshAuthentication();
    }

    const cachedToken = await this.loadCachedToken();

    if (cachedToken && !this.isTokenExpired(cachedToken)) {
      return cachedToken.access_token;
    }

    if (cachedToken?.refresh_token && this.isTokenExpired(cachedToken)) {
      try {
        const refreshedToken = await this.refreshToken(cachedToken.refresh_token);
        await this.saveCachedToken(refreshedToken);
        return refreshedToken.access_token;
      } catch {
        console.warn('Token refresh failed, starting new authentication flow');
      }
    }

    // Start new OAuth flow and cache the result
    return await this.performFreshAuthentication();
  }

  /**
   * Perform fresh OAuth authentication and optionally cache the result
   */
  private async performFreshAuthentication(): Promise<string> {
    const newToken = await this.authenticateWithPKCE();

    // Only save to cache if caching is enabled
    if (this.config.authCache) {
      await this.saveCachedToken(newToken);
    }

    return newToken.access_token;
  }

  /**
   * OAuth 2.0 PKCE flow with local callback server
   */
  async authenticateWithPKCE(): Promise<TokenData> {
    const { codeVerifier, codeChallenge } = this.generatePKCEPair();
    const state = randomBytes(16).toString('hex');

    // Build authorization URL with custom parameters
    const authParams = {
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUrl,
      scope: 'profile email offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: state,
      // Auth0 custom parameters
      audience: this.config.audience,
      organization: this.config.orgName,
    };

    const authUrl = `${this.config.authUrl}?${new URLSearchParams(authParams).toString()}`;

    console.log('Opening browser for authentication...');
    console.log(`If the browser doesn't open automatically, visit: ${authUrl}`);

    // Start local callback server
    const authCode = await this.startCallbackServer(state, authUrl);
    console.log('Authorization code received, exchanging for access token...');

    // Exchange authorization code for access token
    const tokenResponse = await this.exchangeCodeForToken(authCode, codeVerifier);
    console.log('Authentication successful!');

    return tokenResponse;
  }

  /**
   * Generate PKCE code verifier and challenge
   */
  generatePKCEPair(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Start local HTTP server to receive OAuth callback
   */
  async startCallbackServer(expectedState: string, authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url || '', `http://${this.config.orgId}.app.localhost:3000`);

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication Error</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Error</h1><p>Invalid state parameter</p>');
          server.close();
          reject(new Error('Invalid state parameter'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication Error</h1><p>No authorization code received</p>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication Successful</h1><p>You can close this window.</p>');
        server.close();
        resolve(code);
      });

      server.listen(3000, () => {
        console.log(`Callback server started on http://${this.config.orgId}.app.localhost:3000`);

        if (!this.config.browser) {
          console.log('Browser auto-launch disabled (--no-browser option enabled)');
        } else {
          open(authUrl).catch(err => {
            console.warn('Failed to open browser automatically:', err.message);
          });
        }
      });

      server.on('error', (err) => {
        reject(new Error(`Callback server error: ${err.message}`));
      });
    });
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(authCode: string, codeVerifier: string): Promise<TokenData> {
    const tokenParams = {
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code: authCode,
      redirect_uri: `http://${this.config.orgId}.app.localhost:3000`,
      code_verifier: codeVerifier
    };

    try {
      const response = await axios.post(this.config.tokenUrl, tokenParams, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = response.data;
      tokenData.expires_at = Date.now() + (tokenData['expires_in'] * 1000);

      return tokenData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorData = (error as { response?: { data?: { error_description?: string } } })?.response?.data;
      throw new Error(`Token exchange failed: ${errorData?.error_description || errorMessage}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenData> {
    const refreshParams = {
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      refresh_token: refreshToken
    };

    try {
      const response = await axios.post(this.config.tokenUrl, refreshParams, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const tokenData = response.data;
      tokenData.expires_at = Date.now() + (tokenData['expires_in'] * 1000);

      return tokenData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorData = (error as { response?: { data?: { error_description?: string } } })?.response?.data;
      throw new Error(`Token refresh failed: ${errorData?.error_description || errorMessage}`);
    }
  }

  /**
   * Load cached token from file system
   */
  async loadCachedToken(): Promise<TokenData | null> {
    try {
      if (await fs.pathExists(this.tokenCachePath)) {
        return await fs.readJson(this.tokenCachePath);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to load cached token:', errorMessage);
    }
    return null;
  }

  /**
   * Save token to cache
   */
  async saveCachedToken(tokenData: TokenData): Promise<void> {
    try {
      await fs.ensureDir(AUTH_CACHE_DIR, { mode: 0o700 });
      await fs.writeJson(this.tokenCachePath, tokenData, { spaces: 2, mode: 0o600 });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn('Failed to save token to cache:', errorMessage);
    }
  }

  /**
   * Check if token is expired (with 5 minute buffer)
   */
  isTokenExpired(tokenData: TokenData): boolean {
    if (!tokenData.expires_at) {
      return true;
    }

    const buffer = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= (tokenData.expires_at - buffer);
  }
}
