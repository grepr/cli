import { GreprApiClient } from './api-client.js';

/**
 * Common interface for options needed to create an API client
 */
export interface ApiClientFactoryOptions {
  orgName: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  authMethod?: 'oauth' | 'client-credentials';
  clientId?: string;
  clientSecret?: string;
  debug?: boolean;
  authCache: boolean;
  browser: boolean;
}

/**
 * Factory function to create GreprApiClient instances
 * Shared across all command types to ensure DRY principle
 */
export function createApiClient(options: ApiClientFactoryOptions): GreprApiClient {
  const clientConfig = {
    orgName: options.orgName,
    apiBaseUrl: options.apiBaseUrl || `https://${options.orgName}.app.grepr.ai/api`,
    authBaseUrl: options.authBaseUrl || `https://${options.orgName}.app.grepr.ai/auth`,
    authMethod: options.authMethod as 'oauth' | 'client-credentials',
    clientId: options.clientId || 'default-client-id',
    clientSecret: options.clientSecret,
    debug: options.debug || false,
    authCache: options.authCache,
    browser: options.browser,
  };

  if (options.debug) {
    console.log("API Client Config:", clientConfig);
  }

  return new GreprApiClient(clientConfig);
}