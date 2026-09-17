import { afterEach, describe, expect, it, vi } from 'bun:test';
import { GreprApiClient, ApiError } from '../../../main/typescript/lib/grepr-api-client.js';
import { GreprAuth } from '../../../main/typescript/lib/auth.js';
import { createApiClient } from '../../../main/typescript/lib/api-client-factory.js';
import { InvestigationSummaryStatus, MemorySearchRequestMode } from '../../../main/typescript/openapi/openApiTypes.js';

const options = { orgName: 'acme', apiBaseUrl: 'https://example.test/api', authBaseUrl: 'https://auth.test',
  clientId: 'test', authMethod: 'none' as const, authCache: false, browser: false };
const reply = (body: object, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers }
});
afterEach(() => vi.restoreAllMocks());

describe('Investigation API transport', () => {
  it('uses the configured organization endpoint and authenticated headers for agent detail', async () => {
    vi.spyOn(GreprAuth.prototype, 'getAuthHeaders').mockResolvedValue({ Authorization: 'Bearer test-token' });
    let request: Request | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      request = new Request(input);
      return reply({ agent: { id: 'agent-1' }, metrics: { total: 3 } });
    });
    const result = await createApiClient({ ...options, apiBaseUrl: 'https://acme.app.grepr.ai/api', authMethod: 'oauth' }).getAgent('agent-1');
    expect(request?.url).toBe('https://acme.app.grepr.ai/api/v1/agents/agent-1');
    expect(request?.headers.get('Authorization')).toBe('Bearer test-token');
    expect(result).toMatchObject({ agent: { id: 'agent-1' }, metrics: { total: 3 } });
  });
  it('preserves empty page metadata and serializes repeated status parameters', async () => {
    let request: Request | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      request = new Request(input);
      return reply({ investigations: { items: [] }, start: 50, limit: 25, total: 50 });
    });
    const result = await new GreprApiClient(options).listInvestigations('agent-1', {
      page: 2, pageSize: 25, statuses: [InvestigationSummaryStatus.FAILED, InvestigationSummaryStatus.STOPPED]
    });
    expect(result).toEqual({ investigations: { items: [] }, start: 50, limit: 25, total: 50 });
    if (!request) throw new Error('No request received');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/v1/agents/agent-1/investigations');
    expect(url.searchParams.getAll('statuses')).toEqual(['FAILED', 'STOPPED']);
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('reads metadata and turns separately and retains tool evidence', async () => {
    const requests: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(new Request(input).url);
      requests.push(url.pathname + url.search);
      return url.pathname.endsWith('/transcript')
        ? reply({ investigationId: 'run-1', status: 'FAILED', actions: [] })
        : reply({ turns: [{ seq: 9, messages: [{ id: 'message', role: 'TOOL_RESULT', toolCallId: 'call-1', text: 'full result' }] }], hasMore: false });
    });
    const client = new GreprApiClient(options);
    expect((await client.getInvestigation('run-1')).status).toBe('FAILED');
    expect(await client.getInvestigationTurns('run-1', 3, 10)).toMatchObject({ turns: [{ seq: 9, messages: [{ toolCallId: 'call-1', text: 'full result' }] }], hasMore: false });
    expect(requests).toEqual(['/api/v1/investigations/run-1/transcript', '/api/v1/investigations/run-1/turns?afterSeq=3&pageSize=10']);
  });

  it('preserves memory search degradation and request filters', async () => {
    let body: object | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const request = new Request(input);
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/api/v1/agent-memory/search');
      body = await request.json();
      return reply({ results: [], semanticSearchUnavailable: true, note: 'No index', preamble: 'Historical records', entityTagVocabulary: {} });
    });
    const result = await new GreprApiClient(options).searchInvestigationMemory({ mode: MemorySearchRequestMode.SEMANTIC, query: 'timeout', agentId: 'agent-1', limit: 5 });
    expect(body).toEqual({ mode: 'SEMANTIC', query: 'timeout', agentId: 'agent-1', limit: 5 });
    expect(result).toMatchObject({ results: [], semanticSearchUnavailable: true, note: 'No index', preamble: 'Historical records' });
  });

  it('retains HTTP and retry details when journal storage is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ message: 'journal unavailable' }, 503, { 'retry-after': '2' }));
    try {
      await new GreprApiClient(options).getInvestigationTurns('run-1', -1, 50);
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 503, retryAfterMs: 2000 });
      expect(String(error)).toContain('journal unavailable');
    }
  });

  it('sends debug diagnostics to stderr without exposing the client secret', async () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply([]));
    await createApiClient({ ...options, debug: true, clientSecret: 'do-not-print-me' }).listAgentRoster();
    new GreprAuth({ ...options, authMethod: 'oauth', debug: true, clientSecret: 'do-not-print-me' });
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('do-not-print-me');
  });
});
