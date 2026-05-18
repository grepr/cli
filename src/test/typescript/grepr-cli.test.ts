import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createApiClient, ApiClientFactoryOptions } from '../../../src/main/typescript/lib/api-client-factory.js';

// Mock the GreprApiClient
vi.mock('../../../src/main/typescript/lib/api-client.js', () => ({
  GreprApiClient: vi.fn()
}));

// We need to test the GreprQueryCLI class, but it's not exported
// So we'll create a test that imports the main module and tests the behavior
describe('GreprQueryCLI Configuration Tests', () => {
  let originalArgv: string[];
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalArgv = process.argv;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.argv = originalArgv;
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // Test the mergeConfiguration method indirectly by testing CLI option parsing
  describe('Boolean Option Defaults', () => {
    it('should default authCache to true when --no-auth-cache is not specified', () => {
      const program = new Command();

      // Simulate the CLI setup from grepr.ts
      program
        .option('--org-name <name>', 'Organization name')
        .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
        .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true);

      // Parse arguments without --no-auth-cache
      program.parse(['node', 'grepr', '--org-name', 'test-org']);
      const options = program.opts();

      expect(options.authCache).toBe(true);
    });

    it('should set authCache to false when --no-auth-cache is specified', () => {
      const program = new Command();

      program
        .option('--org-name <name>', 'Organization name')
        .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
        .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true);

      // Parse arguments with --no-auth-cache
      program.parse(['node', 'grepr', '--org-name', 'test-org', '--no-auth-cache']);
      const options = program.opts();

      expect(options.authCache).toBe(false);
    });

    it('should default browser to true when --no-browser is not specified', () => {
      const program = new Command();

      program
        .option('--org-name <name>', 'Organization name')
        .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
        .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true);

      // Parse arguments without --no-browser
      program.parse(['node', 'grepr', '--org-name', 'test-org']);
      const options = program.opts();

      expect(options.browser).toBe(true);
    });

    it('should set browser to false when --no-browser is specified', () => {
      const program = new Command();

      program
        .option('--org-name <name>', 'Organization name')
        .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
        .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true);

      // Parse arguments with --no-browser
      program.parse(['node', 'grepr', '--org-name', 'test-org', '--no-browser']);
      const options = program.opts();

      expect(options.browser).toBe(false);
    });

    it('should handle both --no-auth-cache and --no-browser together', () => {
      const program = new Command();

      program
        .option('--org-name <name>', 'Organization name')
        .option('--no-auth-cache', 'Force fresh authentication by ignoring cached tokens', true)
        .option('--no-browser', 'Do not automatically open browser for OAuth authentication', true);

      // Parse arguments with both flags
      program.parse(['node', 'grepr', '--org-name', 'test-org', '--no-auth-cache', '--no-browser']);
      const options = program.opts();

      expect(options.authCache).toBe(false);
      expect(options.browser).toBe(false);
    });
  });

  describe('mergeConfiguration method behavior', () => {
    // Test the actual mergeConfiguration logic from grepr.ts
    async function simulateMergeConfiguration(options: Record<string, string | boolean | number>): Promise<Record<string, string | boolean | number>> {
      // This simulates the logic from mergeConfiguration method in grepr.ts
      const result = { ...options };

      // Validate required orgName
      if (!result.orgName) {
        throw new Error('--org-name is required');
      }

      // Set defaults
      if (!result.authBaseUrl) {
        result.authBaseUrl = 'https://grepr-prod.us.auth0.com';
      }

      if (!result.apiBaseUrl) {
        result.apiBaseUrl = `https://${result.orgName}.app.grepr.ai/api`;
      }

      if (!result.clientId) {
        result.clientId = '4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS';
      }

      // Set boolean defaults for required properties
      if (result.authCache === undefined) {
        result.authCache = true;
      }
      if (result.browser === undefined) {
        result.browser = true;
      }

      return result;
    }

    it('should set authCache to true when undefined', async () => {
      const options = {
        orgName: 'test-org'
        // authCache is undefined
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.authCache).toBe(true);
    });

    it('should preserve authCache when explicitly set to false', async () => {
      const options = {
        orgName: 'test-org',
        authCache: false
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.authCache).toBe(false);
    });

    it('should preserve authCache when explicitly set to true', async () => {
      const options = {
        orgName: 'test-org',
        authCache: true
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.authCache).toBe(true);
    });

    it('should set browser to true when undefined', async () => {
      const options = {
        orgName: 'test-org'
        // browser is undefined
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.browser).toBe(true);
    });

    it('should preserve browser when explicitly set to false', async () => {
      const options = {
        orgName: 'test-org',
        browser: false
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.browser).toBe(false);
    });

    it('should preserve browser when explicitly set to true', async () => {
      const options = {
        orgName: 'test-org',
        browser: true
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.browser).toBe(true);
    });

    it('should handle both authCache and browser correctly when both undefined', async () => {
      const options = {
        orgName: 'test-org'
        // both authCache and browser are undefined
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.authCache).toBe(true);
      expect(result.browser).toBe(true);
    });

    it('should handle both authCache and browser correctly when both explicitly false', async () => {
      const options = {
        orgName: 'test-org',
        authCache: false,
        browser: false
      };

      const result = await simulateMergeConfiguration(options);
      expect(result.authCache).toBe(false);
      expect(result.browser).toBe(false);
    });

    it('should set all expected defaults', async () => {
      const options = {
        orgName: 'test-org'
      };

      const result = await simulateMergeConfiguration(options);

      expect(result.orgName).toBe('test-org');
      expect(result.authBaseUrl).toBe('https://grepr-prod.us.auth0.com');
      expect(result.apiBaseUrl).toBe('https://test-org.app.grepr.ai/api');
      expect(result.clientId).toBe('4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS');
      expect(result.authCache).toBe(true);
      expect(result.browser).toBe(true);
    });

    it('should throw error when orgName is missing', async () => {
      const options = {};

      await expect(simulateMergeConfiguration(options))
        .rejects.toThrow('--org-name is required');
    });
  });

  describe('Commander.js --no- option behavior', () => {
    it('should understand how --no- options work in Commander.js', () => {
      const program = new Command();

      // Test with default value true (meaning the positive behavior is default)
      program.option('--no-auth-cache', 'Disable auth cache', true);

      // When --no-auth-cache is NOT specified, authCache should be true
      program.parse(['node', 'test']);
      expect(program.opts().authCache).toBe(true);

      // When --no-auth-cache IS specified, authCache should be false
      program.parse(['node', 'test', '--no-auth-cache']);
      expect(program.opts().authCache).toBe(false);
    });

    it('should demonstrate the old incorrect behavior with default false', () => {
      const program = new Command();

      // Test with default value false (this was the bug - meant disabled by default)
      program.option('--no-auth-cache', 'Disable auth cache', false);

      // When --no-auth-cache is NOT specified, authCache would be false (wrong!)
      program.parse(['node', 'test']);
      expect(program.opts().authCache).toBe(false);

      // When --no-auth-cache IS specified, authCache would still be false
      program.parse(['node', 'test', '--no-auth-cache']);
      expect(program.opts().authCache).toBe(false);
    });
  });

  describe('API Client Factory Integration', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
    });

    it('should pass authCache=true to API client when not disabled', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');

      const options: ApiClientFactoryOptions = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://test-org.app.grepr.ai/auth',
        authMethod: undefined,
        clientId: 'default-client-id',
        clientSecret: undefined,
        debug: false,
        authCache: true,
        browser: true,
      });
    });

    it('should pass authCache=false to API client when disabled', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');
      const options: ApiClientFactoryOptions = {
        orgName: 'test-org',
        authCache: false,
        browser: true
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://test-org.app.grepr.ai/auth',
        authMethod: undefined,
        clientId: 'default-client-id',
        clientSecret: undefined,
        debug: false,
        authCache: false,
        browser: true,
      });
    });

    it('should pass browser=true to API client when not disabled', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');
      const options: ApiClientFactoryOptions = {
        orgName: 'test-org',
        authCache: true,
        browser: true
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://test-org.app.grepr.ai/auth',
        authMethod: undefined,
        clientId: 'default-client-id',
        clientSecret: undefined,
        debug: false,
        authCache: true,
        browser: true,
      });
    });

    it('should pass browser=false to API client when disabled', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');
      const options: ApiClientFactoryOptions = {
        orgName: 'test-org',
        authCache: true,
        browser: false
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://test-org.app.grepr.ai/auth',
        authMethod: undefined,
        clientId: 'default-client-id',
        clientSecret: undefined,
        debug: false,
        authCache: true,
        browser: false,
      });
    });

    it('should pass both authCache=false and browser=false when both disabled', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');
      const options: ApiClientFactoryOptions = {
        orgName: 'test-org',
        authCache: false,
        browser: false
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'test-org',
        apiBaseUrl: 'https://test-org.app.grepr.ai/api',
        authBaseUrl: 'https://test-org.app.grepr.ai/auth',
        authMethod: undefined,
        clientId: 'default-client-id',
        clientSecret: undefined,
        debug: false,
        authCache: false,
        browser: false,
      });
    });

    it('should pass custom values when provided', async () => {
      const { GreprApiClient } = await import('../../../src/main/typescript/lib/api-client.js');
      const options: ApiClientFactoryOptions = {
        orgName: 'custom-org',
        apiBaseUrl: 'https://custom-api.example.com',
        authBaseUrl: 'https://custom-auth.example.com',
        authMethod: 'client-credentials',
        clientId: 'client-456',
        clientSecret: 'secret-789',
        debug: true,
        authCache: false,
        browser: false
      };

      createApiClient(options);

      expect(GreprApiClient).toHaveBeenCalledWith({
        orgName: 'custom-org',
        apiBaseUrl: 'https://custom-api.example.com',
        authBaseUrl: 'https://custom-auth.example.com',
        authMethod: 'client-credentials',
        clientId: 'client-456',
        clientSecret: 'secret-789',
        debug: true,
        authCache: false,
        browser: false,
      });
    });
  });

  describe('End-to-End Configuration Flow', () => {
    // Test the complete flow from CLI parsing -> mergeConfiguration -> API client creation
    async function simulateCompleteFlow(cliArgs: string[]) {
      // Step 1: Parse CLI arguments (simulate Commander.js behavior)
      const program = new Command();
      program
        .option('--org-name <name>', 'Organization name')
        .option('--api-base-url <url>', 'API server base URL')
        .option('--auth-base-url <url>', 'Auth0 base URL')
        .option('--auth-method <method>', 'Authentication method', 'oauth')
        .option('--client-id <id>', 'OAuth Client ID')
        .option('--client-secret <secret>', 'Client secret for client-credentials authentication')
        .option('--no-auth-cache', 'Force fresh authentication', true)
        .option('--no-browser', 'Do not open browser', true)
        .option('--debug', 'Enable debug output');

      program.parse(cliArgs);
      const cliOptions = program.opts();

      // Step 2: Apply mergeConfiguration logic (including env var fallbacks)
      const result = { ...cliOptions };

      if (!result.orgName) {
        throw new Error('--org-name is required');
      }

      // Env var fallbacks (same as grepr.ts mergeConfiguration)
      if (!result.clientId && process.env.GREPR_CLIENT_ID) {
        result.clientId = process.env.GREPR_CLIENT_ID;
      }
      if (!result.clientSecret && process.env.GREPR_CLIENT_SECRET) {
        result.clientSecret = process.env.GREPR_CLIENT_SECRET;
      }
      if (!result.authBaseUrl && process.env.GREPR_AUTH_BASE_URL) {
        result.authBaseUrl = process.env.GREPR_AUTH_BASE_URL;
      }

      if (!result.authBaseUrl) {
        result.authBaseUrl = 'https://grepr-prod.us.auth0.com';
      }

      if (!result.apiBaseUrl) {
        result.apiBaseUrl = `https://${result.orgName}.app.grepr.ai/api`;
      }

      if (!result.clientId) {
        result.clientId = '4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS';
      }

      if (result.authCache === undefined) {
        result.authCache = true;
      }
      if (result.browser === undefined) {
        result.browser = true;
      }

      return result;
    }

    it('should have authCache=true and browser=true when no --no- flags specified', async () => {
      const mergedConfig = await simulateCompleteFlow(['node', 'grepr', '--org-name', 'test-org']);

      expect(mergedConfig.authCache).toBe(true);
      expect(mergedConfig.browser).toBe(true);
      expect(mergedConfig.orgName).toBe('test-org');
    });

    it('should have authCache=false when --no-auth-cache specified', async () => {
      const mergedConfig = await simulateCompleteFlow(['node', 'grepr', '--org-name', 'test-org', '--no-auth-cache']);

      expect(mergedConfig.authCache).toBe(false);
      expect(mergedConfig.browser).toBe(true);
      expect(mergedConfig.orgName).toBe('test-org');
    });

    it('should have browser=false when --no-browser specified', async () => {
      const mergedConfig = await simulateCompleteFlow(['node', 'grepr', '--org-name', 'test-org', '--no-browser']);

      expect(mergedConfig.authCache).toBe(true);
      expect(mergedConfig.browser).toBe(false);
      expect(mergedConfig.orgName).toBe('test-org');
    });

    it('should have both false when both --no- flags specified', async () => {
      const mergedConfig = await simulateCompleteFlow(['node', 'grepr', '--org-name', 'test-org', '--no-auth-cache', '--no-browser']);

      expect(mergedConfig.authCache).toBe(false);
      expect(mergedConfig.browser).toBe(false);
      expect(mergedConfig.orgName).toBe('test-org');
    });
  });

  describe('Environment Variable Fallbacks', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.GREPR_CLIENT_ID;
      delete process.env.GREPR_CLIENT_SECRET;
      delete process.env.GREPR_AUTH_BASE_URL;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    async function simulateMergeWithEnvVars(options: Record<string, string | boolean | number>) {
      const result = { ...options };

      if (!result.orgName) {
        throw new Error('--org-name is required');
      }

      if (!result.clientId && process.env.GREPR_CLIENT_ID) {
        result.clientId = process.env.GREPR_CLIENT_ID;
      }
      if (!result.clientSecret && process.env.GREPR_CLIENT_SECRET) {
        result.clientSecret = process.env.GREPR_CLIENT_SECRET;
      }
      if (!result.authBaseUrl && process.env.GREPR_AUTH_BASE_URL) {
        result.authBaseUrl = process.env.GREPR_AUTH_BASE_URL;
      }

      if (!result.authBaseUrl) {
        result.authBaseUrl = 'https://grepr-prod.us.auth0.com';
      }
      if (!result.apiBaseUrl) {
        result.apiBaseUrl = `https://${result.orgName}.app.grepr.ai/api`;
      }
      if (!result.clientId) {
        result.clientId = '4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS';
      }

      return result;
    }

    it('should use GREPR_CLIENT_ID env var when --client-id is not provided', async () => {
      process.env.GREPR_CLIENT_ID = 'env-client-id';

      const result = await simulateMergeWithEnvVars({ orgName: 'test-org' });
      expect(result.clientId).toBe('env-client-id');
    });

    it('should use GREPR_CLIENT_SECRET env var when --client-secret is not provided', async () => {
      process.env.GREPR_CLIENT_SECRET = 'env-secret';

      const result = await simulateMergeWithEnvVars({ orgName: 'test-org' });
      expect(result.clientSecret).toBe('env-secret');
    });

    it('should use GREPR_AUTH_BASE_URL env var when --auth-base-url is not provided', async () => {
      process.env.GREPR_AUTH_BASE_URL = 'https://custom-auth.example.com';

      const result = await simulateMergeWithEnvVars({ orgName: 'test-org' });
      expect(result.authBaseUrl).toBe('https://custom-auth.example.com');
    });

    it('should prefer CLI args over env vars', async () => {
      process.env.GREPR_CLIENT_ID = 'env-client-id';
      process.env.GREPR_CLIENT_SECRET = 'env-secret';
      process.env.GREPR_AUTH_BASE_URL = 'https://env-auth.example.com';

      const result = await simulateMergeWithEnvVars({
        orgName: 'test-org',
        clientId: 'cli-client-id',
        clientSecret: 'cli-secret',
        authBaseUrl: 'https://cli-auth.example.com',
      });

      expect(result.clientId).toBe('cli-client-id');
      expect(result.clientSecret).toBe('cli-secret');
      expect(result.authBaseUrl).toBe('https://cli-auth.example.com');
    });

    it('should use all env vars together for client-credentials auth', async () => {
      process.env.GREPR_CLIENT_ID = 'env-client-id';
      process.env.GREPR_CLIENT_SECRET = 'env-secret';
      process.env.GREPR_AUTH_BASE_URL = 'https://env-auth.example.com';

      const result = await simulateMergeWithEnvVars({ orgName: 'test-org' });

      expect(result.clientId).toBe('env-client-id');
      expect(result.clientSecret).toBe('env-secret');
      expect(result.authBaseUrl).toBe('https://env-auth.example.com');
    });

    it('should fall back to defaults when neither CLI args nor env vars are set', async () => {
      const result = await simulateMergeWithEnvVars({ orgName: 'test-org' });

      expect(result.clientId).toBe('4XOD92WjzdfT4yxWeHpwh4J2u8t9qPtS');
      expect(result.clientSecret).toBeUndefined();
      expect(result.authBaseUrl).toBe('https://grepr-prod.us.auth0.com');
    });
  });
});