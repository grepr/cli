import { describe, it, expect } from 'bun:test';
import { parseAuthMethod, parseEnvUrl, parseQueryEngine, parseUrl } from '../../../main/typescript/lib/option-parsers.js';

describe('parseUrl', () => {
  it('test_parseUrl_httpsUrl_shouldReturnUnchanged', () => {
    expect(parseUrl('https://acme.app.grepr.ai/api')).toBe('https://acme.app.grepr.ai/api');
  });

  it('test_parseUrl_httpUrl_shouldReturnUnchanged', () => {
    expect(parseUrl('http://app.grepr.localhost:7665/api')).toBe('http://app.grepr.localhost:7665/api');
  });

  it('test_parseUrl_missingScheme_shouldThrow', () => {
    expect(() => parseUrl('acme.app.grepr.ai/api')).toThrow(
      'Invalid URL: acme.app.grepr.ai/api. Must start with http:// or https://'
    );
  });

  it('test_parseUrl_unsupportedScheme_shouldThrow', () => {
    expect(() => parseUrl('ftp://example.com')).toThrow('Invalid URL');
  });
});

describe('parseEnvUrl', () => {
  it('test_parseEnvUrl_validUrl_shouldReturnUnchanged', () => {
    expect(parseEnvUrl('GREPR_API_BASE_URL', 'https://acme.app.grepr.ai/api')).toBe('https://acme.app.grepr.ai/api');
  });

  it('test_parseEnvUrl_invalidUrl_shouldIncludeEnvVarName', () => {
    expect(() => parseEnvUrl('GREPR_API_BASE_URL', 'acme.app.grepr.ai/api')).toThrow(
      'GREPR_API_BASE_URL: Invalid URL: acme.app.grepr.ai/api. Must start with http:// or https://'
    );
  });
});

describe('parseAuthMethod', () => {
  it('test_parseAuthMethod_oauth_shouldReturnOauth', () => {
    expect(parseAuthMethod('oauth')).toBe('oauth');
  });

  it('test_parseAuthMethod_clientCredentials_shouldReturnClientCredentials', () => {
    expect(parseAuthMethod('client-credentials')).toBe('client-credentials');
  });

  it('test_parseAuthMethod_none_shouldReturnNone', () => {
    expect(parseAuthMethod('none')).toBe('none');
  });

  it('test_parseAuthMethod_undefined_shouldReturnUndefinedForCallerDefault', () => {
    expect(parseAuthMethod(undefined)).toBeUndefined();
  });

  it('test_parseAuthMethod_emptyString_shouldReturnUndefinedForCallerDefault', () => {
    expect(parseAuthMethod('')).toBeUndefined();
  });

  it('test_parseAuthMethod_invalidValue_shouldThrow', () => {
    expect(() => parseAuthMethod('client_credentials')).toThrow(
      'Invalid authentication method: client_credentials. Must be oauth, client-credentials, or none'
    );
  });
});

describe('parseQueryEngine', () => {
  it('test_parseQueryEngine_athena_shouldReturnAthena', () => {
    expect(parseQueryEngine('athena')).toBe('athena');
  });

  it('test_parseQueryEngine_flink_shouldReturnFlink', () => {
    expect(parseQueryEngine('flink')).toBe('flink');
  });

  it('test_parseQueryEngine_undefined_shouldReturnUndefinedForCallerDefault', () => {
    expect(parseQueryEngine(undefined)).toBeUndefined();
  });

  it('test_parseQueryEngine_emptyString_shouldReturnUndefinedForCallerDefault', () => {
    expect(parseQueryEngine('')).toBeUndefined();
  });

  it('test_parseQueryEngine_invalidValue_shouldThrow', () => {
    expect(() => parseQueryEngine('iceberg')).toThrow(
      'Invalid query engine: iceberg. Must be athena or flink'
    );
  });
});
