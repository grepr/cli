import { describe, it, expect } from 'bun:test';
import {
  ApiRequestError,
  assertPublicApiBaseUrl,
  buildApiRequest,
  parseEndpoint,
  parseHeaders,
  parseMethod,
  typedFieldJson,
  requiresConfirmation,
} from '../../../main/typescript/lib/api-request.js';

const NO_FLAGS = { rawFields: [], typedFields: [], headers: [] };

describe('parseEndpoint', () => {
  it.each([
    ['v1/jobs', '/v1/jobs'],
    ['/v1/jobs', '/v1/jobs'],
    ['/api/v1/jobs', '/v1/jobs'],
    ['api/v1/jobs', '/v1/jobs'],
    ['  /v1/jobs/abc  ', '/v1/jobs/abc'],
  ])('test_parseEndpoint_%s_normalizesTo_%s', (endpoint, expected) => {
    expect(parseEndpoint(endpoint).path).toBe(expected);
  });

  it('test_parseEndpoint_queryString_isSplitIntoParams', () => {
    expect(parseEndpoint('v1/jobs?latest=true&state=RUNNING&state=STOPPED')).toEqual({
      path: '/v1/jobs',
      query: [['latest', 'true'], ['state', 'RUNNING'], ['state', 'STOPPED']],
    });
  });

  it.each([
    'internal/agents', '/internal/agents', '/api/internal/agents', '/internal',
    // The base URL may not end in /api (e.g. http://localhost:8080), so api/api/internal is internal too.
    'api/api/internal/v1/jobs', '/v1/internal/x', '/INTERNAL/x', '/%69nternal/x', '/v1/%49NTERNAL',
  ])(
    'test_parseEndpoint_internalPath_%s_isRefused', (endpoint) => {
      expect(() => parseEndpoint(endpoint)).toThrow('not part of the public Grepr API');
    });

  it.each([['v2/logs', '/v2/logs'], ['health', '/health'], ['/internals/x', '/internals/x'], ['/api/v1', '/v1']])(
    'test_parseEndpoint_anyPublicPath_%s_isAccepted', (endpoint, expected) => {
      expect(parseEndpoint(endpoint).path).toBe(expected);
    });

  it.each(['/', '/api/'])('test_parseEndpoint_apiRootOnly_%s_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow('endpoint is required');
  });

  it.each([
    'https://example.com/v1/jobs',
    'http://localhost/api/v1/jobs',
    '//example.com/v1/jobs',
    'file:///etc/passwd',
  ])('test_parseEndpoint_fullUrl_%s_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow('not a full URL');
  });

  it.each([
    '/v1/../internal/agents',
    '/v1/jobs/..',
    '/v1/./jobs',
    '/api/v1/../../internal',
  ])('test_parseEndpoint_dotSegment_%s_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow('"." or ".." segments');
  });

  it.each([
    '/v1/jobs;x=1',
    '/v1\\..\\internal',
    '/v1//jobs',
    '/api//v1/jobs',
  ])('test_parseEndpoint_delimiter_%s_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow(ApiRequestError);
  });

  it.each([
    '/v1/%2e%2e/internal',
    '/v1/%2E%2E/internal',
    '/v1/jobs%2finternal',
    '/v1/jobs%2Finternal',
    '/v1/jobs%5cinternal',
    '/v1/jobs%3bx',
    '/v1/jobs%3Bx',
  ])('test_parseEndpoint_encodedDelimiter_%s_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow('percent-encoded');
  });

  it('test_parseEndpoint_encodedDelimiterInQuery_isAllowed', () => {
    expect(parseEndpoint('/v1/jobs?name=a%2Fb').query).toEqual([['name', 'a/b']]);
  });

  it.each([
    // The URL parser strips tabs and newlines, which would turn "\t.." into a real ".." segment.
    '/v1/\t../internal',
    '/v1/jo\nbs',
    '/v1/jo bs',
    '/v1/jobs#frag',
  ])('test_parseEndpoint_whitespaceOrFragment_%j_isRefused', (endpoint) => {
    expect(() => parseEndpoint(endpoint)).toThrow('whitespace, control characters or "#"');
  });

  it('test_parseEndpoint_invalidPercentEncoding_isRefused', () => {
    expect(() => parseEndpoint('/v1/%E0%A4%A')).toThrow('invalid percent-encoding');
  });

  it('test_parseEndpoint_empty_isRefused', () => {
    expect(() => parseEndpoint('  ')).toThrow('endpoint is required');
  });
});

describe('assertPublicApiBaseUrl', () => {
  it('test_assertPublicApiBaseUrl_publicHost_passes', () => {
    expect(() => assertPublicApiBaseUrl('https://acme.app.grepr.ai/api')).not.toThrow();
  });

  it.each([
    'https://internal-grepr-123.us-east-1.elb.amazonaws.com/api',
    'http://INTERNAL-lb.example.com/api',
  ])('test_assertPublicApiBaseUrl_internalHost_%s_isRefused', (url) => {
    expect(() => assertPublicApiBaseUrl(url)).toThrow('configured API base URL is internal');
  });

  it.each([
    'https://acme.app.grepr.ai/api/internal',
    'http://localhost:8080/api/internal/',
    'http://localhost:8080/internal',
    'http://localhost:8080/api/%69nternal',
  ])('test_assertPublicApiBaseUrl_internalPath_%s_isRefused', (url) => {
    expect(() => assertPublicApiBaseUrl(url)).toThrow('configured API base URL is internal');
  });

  it.each(['http://localhost:8080', 'http://localhost:8080/api', 'https://acme.app.grepr.ai/api/'])(
    'test_assertPublicApiBaseUrl_publicPath_%s_passes', (url) => {
      expect(() => assertPublicApiBaseUrl(url)).not.toThrow();
    });

  it('test_assertPublicApiBaseUrl_invalidUrl_isRefused', () => {
    expect(() => assertPublicApiBaseUrl('not a url')).toThrow('invalid API base URL');
  });
});

describe('parseHeaders', () => {
  it('test_parseHeaders_splitsOnFirstColon', () => {
    expect(parseHeaders(['Accept: application/json', 'X-Trace: a:b'])).toEqual({
      Accept: 'application/json',
      'X-Trace': 'a:b',
    });
  });

  it.each([
    'Authorization: Bearer x',
    'authorization: Bearer x',
    'Cookie: session=1',
    'X-Grepr-Api-Key: k',
    'X-Grepr-Auth-User: someone',
    'x-grepr-auth: anything',
    'X-GREPR-AUTHORITY: x',
  ])('test_parseHeaders_managedHeader_%s_isRefusedGenerically', (header) => {
    expect(() => parseHeaders([header])).toThrow(
      "authentication headers are managed by the CLI and can't be set with -H");
  });

  it.each(['NoColon', ': value', 'Bad Name: v'])('test_parseHeaders_malformed_%s_isRefused', (header) => {
    expect(() => parseHeaders([header])).toThrow("expected 'Name: value'");
  });

  it.each(['X-Test: a\nb', 'X-Test: a\rb', 'X-Test: a\0b'])(
    'test_parseHeaders_valueFetchWouldReject_%j_isRefused', (header) => {
      expect(() => parseHeaders([header])).toThrow('the value has characters HTTP does not allow');
    });
});

describe('typedFieldJson', () => {
  it.each([
    ['42', '42'],
    ['-3', '-3'],
    ['1.5', '1.5'],
    ['1.0', '1.0'],
    ['1e3', '1e3'],
    ['1234567890123456789', '1234567890123456789'],
    ['true', 'true'],
    ['false', 'false'],
    ['null', 'null'],
    ['abc', '"abc"'],
    ['', '""'],
    ['007', '"007"'],
    ['0x10', '"0x10"'],
    ['1.', '"1."'],
    ['True', '"True"'],
  ])('test_typedFieldJson_%s', (value, expected) => {
    expect(typedFieldJson(value)).toBe(expected);
  });
});

describe('parseMethod', () => {
  it('test_parseMethod_default_isGetWithoutBodyAndPostWithOne', () => {
    expect(parseMethod(undefined, false)).toBe('GET');
    expect(parseMethod(undefined, true)).toBe('POST');
  });

  it('test_parseMethod_lowercase_isNormalized', () => {
    expect(parseMethod('patch', false)).toBe('PATCH');
  });

  it('test_parseMethod_unsupported_isRefused', () => {
    expect(() => parseMethod('TRACE', false)).toThrow('unsupported method');
  });

  it('test_requiresConfirmation_onlyForNonSafeMethods', () => {
    expect(requiresConfirmation('GET')).toBe(false);
    expect(requiresConfirmation('HEAD')).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect(requiresConfirmation(method)).toBe(true);
    }
  });
});

describe('buildApiRequest', () => {
  it('test_buildApiRequest_plainGet_hasNoBodyOrContentType', async () => {
    expect(await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/jobs' })).toEqual({
      method: 'GET', path: '/v1/jobs', query: [], headers: {}, body: undefined,
    });
  });

  it('test_buildApiRequest_typedFieldsInBody_keepExactDigits', async () => {
    const request = await buildApiRequest({
      ...NO_FLAGS,
      endpoint: 'v1/things',
      method: 'POST',
      typedFields: ['startTimeNanos=1234567890123456789', 'ratio=1.0', 'id=007', 'tag=a', 'tag=2'],
    });

    expect(request.body).toBe('{"startTimeNanos":1234567890123456789,"ratio":1.0,"id":"007","tag":["a",2]}');
  });

  it('test_buildApiRequest_typedFieldsInQuery_areSentAsTyped', async () => {
    const request = await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/things', typedFields: ['after=1234567890123456789', 'ratio=1.0'] });

    expect(request.query).toEqual([['after', '1234567890123456789'], ['ratio', '1.0']]);
  });

  it('test_buildApiRequest_fieldsWithoutMethod_stayGetQueryParams', async () => {
    const request = await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/jobs', rawFields: ['state=RUNNING'], typedFields: ['page=2'] });

    expect(request.method).toBe('GET');
    expect(request.query).toEqual([['state', 'RUNNING'], ['page', '2']]);
    expect(request.body).toBeUndefined();
  });

  it('test_buildApiRequest_postFields_becomeJsonBody', async () => {
    const request = await buildApiRequest({
      ...NO_FLAGS, endpoint: 'v1/datasets', method: 'POST',
      rawFields: ['name=a=b', 'count=7'], typedFields: ['n=7', 'on=true'],
    });

    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body ?? '')).toEqual({ name: 'a=b', count: '7', n: 7, on: true });
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('test_buildApiRequest_arrayKey_alwaysBuildsAnArray', async () => {
    const request = await buildApiRequest({
      ...NO_FLAGS, endpoint: 'v1/x', method: 'POST',
      rawFields: ['teamIds[]=t1', 'name=x', 'tags=a', 'tags[]=b'], typedFields: ['ids[]=7'],
    });

    expect(request.body).toBe('{"teamIds":["t1"],"name":"x","tags":["a","b"],"ids":[7]}');
  });

  it('test_buildApiRequest_arrayKeyInQuery_repeatsThePlainKey', async () => {
    const request = await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', rawFields: ['state[]=RUNNING', 'state[]=STOPPED'] });

    expect(request.query).toEqual([['state', 'RUNNING'], ['state', 'STOPPED']]);
  });

  it('test_buildApiRequest_badFlag_failsWithoutReadingInput', async () => {
    let read = false;
    const readInputBody = async (): Promise<string> => {
      read = true;
      return '{}';
    };

    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', method: 'GET', readInputBody })).rejects.toThrow('cannot send a body');
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', method: 'NOPE', readInputBody })).rejects.toThrow('unsupported method');
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', headers: ['bad'], readInputBody })).rejects.toThrow('invalid header');
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'internal/x', readInputBody })).rejects.toThrow('not part of the public');

    expect(read).toBe(false);
  });

  it('test_buildApiRequest_repeatedBodyField_collectsAnArray', async () => {
    const request = await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', method: 'POST', typedFields: ['id=1', 'id=2', 'id=3'] });

    expect(JSON.parse(request.body ?? '')).toEqual({ id: [1, 2, 3] });
  });

  it.each(['GET', 'HEAD', 'DELETE'])('test_buildApiRequest_%s_sendsFieldsAsQuery', async (method) => {
    const request = await buildApiRequest({
      ...NO_FLAGS, endpoint: 'v1/jobs?latest=true', method, rawFields: ['state=RUNNING'], typedFields: ['page=2'],
    });

    expect(request.query).toEqual([['latest', 'true'], ['state', 'RUNNING'], ['page', '2']]);
    expect(request.body).toBeUndefined();
  });

  it('test_buildApiRequest_input_isSentVerbatimAsJson', async () => {
    const request = await buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/jobs/1', method: 'PUT', readInputBody: async () => '{"a":1}' });

    expect(request).toMatchObject({ method: 'PUT', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
  });

  it('test_buildApiRequest_userContentType_isKept', async () => {
    const request = await buildApiRequest({
      ...NO_FLAGS, endpoint: 'v1/validation/sql/flink', headers: ['content-type: text/plain'], readInputBody: async () => 'SELECT 1',
    });

    expect(request.headers).toEqual({ 'content-type': 'text/plain' });
  });

  it('test_buildApiRequest_inputWithBodyFields_isRefused', async () => {
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', rawFields: ['a=1'], readInputBody: async () => '{}' })).rejects.toThrow('--input cannot be combined');
  });

  it('test_buildApiRequest_inputOnGet_isRefused', async () => {
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', method: 'GET', readInputBody: async () => '{}' })).rejects.toThrow('GET requests cannot send a body');
  });

  it.each(['novalue', '=value', '[]=value'])('test_buildApiRequest_malformedField_%s_isRefused', async (field) => {
    await expect(buildApiRequest({ ...NO_FLAGS, endpoint: 'v1/x', rawFields: [field] })).rejects.toThrow('expected key=value');
  });
});
