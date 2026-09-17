import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Command, CommanderError } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentCommand } from '../../../main/typescript/commands/agent-command.js';
import { InvestigationCommand } from '../../../main/typescript/commands/investigation-command.js';
import { InvestigationMemoryCommand } from '../../../main/typescript/commands/investigation-memory-command.js';

const config = { orgName: 'acme', apiBaseUrl: 'https://example.test/api', authBaseUrl: 'https://auth.test',
  clientId: 'test', authMethod: 'none' as const, authCache: false, browser: false };
let output: string[];
let errors: string[];
let requests: Request[];
let fixture: object;
let status: number;
function program(): Command {
  const cli = new Command().exitOverride().configureOutput({ writeErr: text => { errors.push(text); } });
  cli.option('-o, --output <file>').option('--debug').option('-q, --quiet');
  const merge = async (opts: object) => ({ ...config, ...opts });
  for (const command of [new AgentCommand(), new InvestigationCommand(), new InvestigationMemoryCommand()]) command.addToProgram(cli, merge);
  return cli;
}
beforeEach(() => {
  output = []; errors = []; requests = []; fixture = {}; status = 200;
  vi.spyOn(console, 'log').mockImplementation(text => { output.push(String(text)); });
  vi.spyOn(console, 'error').mockImplementation(text => { errors.push(String(text)); });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    requests.push(new Request(input));
    return new Response(JSON.stringify(fixture), { status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });
const run = (...args: string[]) => program().parseAsync(args, { from: 'user' });

describe('Investigation command contracts', () => {
  it('discovers a lightweight roster unless details are explicitly requested', async () => {
    fixture = [{ id: 'agent-1', name: 'triage' }];
    await run('agent:list', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '')).toEqual([{ id: 'agent-1', name: 'triage' }]);
    await run('agent:list', '--details', '--format', 'raw');
    expect(requests.map(request => new URL(request.url).pathname)).toEqual(['/api/v1/agents/roster', '/api/v1/agents']);
  });

  it('keeps the page envelope and sends repeated status filters', async () => {
    fixture = { investigations: { items: [] }, start: 0, limit: 25, total: 0 };
    await run('investigation:list', '--agent-id', 'agent-1', '--status', 'FAILED', '--status', 'STOPPED', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '')).toEqual(fixture);
    expect(new URL(requests[0]?.url ?? '').searchParams.getAll('statuses')).toEqual(['FAILED', 'STOPPED']);
  });

  it('reading a failed run succeeds and preserves recorded actions', async () => {
    fixture = { investigationId: 'run-1', status: 'FAILED', actions: [{ toolCallId: 'call', description: 'updated pipeline' }] };
    await run('investigation:get', 'run-1', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '')).toEqual(fixture);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('returns a resumable cursor even for an empty turns page', async () => {
    fixture = { turns: [], hasMore: false };
    await run('investigation:turns', 'run-1', '--after-seq', '12', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '')).toEqual({ investigationId: 'run-1', turns: [], hasMore: false, nextAfterSeq: 12 });
  });

  it('times out a single turns page and cancels the pending request', async () => {
    let aborted = false;
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const request = new Request(input);
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('request aborted'));
        }, { once: true });
      });
    });
    const listeners = process.listenerCount('SIGINT');
    await run('investigation:turns', 'run', '--timeout', '20ms', '--format', 'raw');
    expect(process.exitCode).toBe(2);
    expect(aborted).toBe(true);
    expect(output).toHaveLength(0);
    expect(errors.join('')).toContain('timeout');
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  }, 1000);

  it('interrupts a single turns page without emitting a successful response', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      setTimeout(() => process.emit('SIGINT'), 5);
      return new Promise<Response>(() => {});
    });
    const listeners = process.listenerCount('SIGINT');
    await run('investigation:turns', 'run', '--format', 'raw');
    expect(process.exitCode).toBe(130);
    expect(output).toHaveLength(0);
    expect(errors.join('')).toContain('interrupted');
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it.each([
    [['investigation:list', '--agent-id', 'agent', '--page-size', '101'], 'integer between 1 and 100'],
    [['investigation:list', '--agent-id', 'agent', '--page', '1x'], 'integer between 0 and'],
    [['investigation:list', '--agent-id', 'agent', '--status', 'INVALID'], 'Expected one of'],
    [['investigation:turns', 'run', '--after-seq', '-2'], 'integer between -1 and'],
    [['investigation:transcript', 'run', '--all', '--max-turns', '5'], 'mutually exclusive'],
    [['investigation:transcript', 'run', '--timeout', '0s'], 'positive timeout'],
    [['investigation:transcript', 'run', '--format', 'table'], 'preserve coverage'],
    [['investigation:transcript', 'run', '--format', 'csv'], 'preserve coverage'],
    [['investigation:memory:search', '--mode', 'semantic', '--query', 'timeout'], 'semantic search requires --agent-id'],
    [['investigation:memory:search', '--mode', 'timeline'], 'timeline requires --entity-tag'],
    [['investigation:memory:search', '--mode', 'text', '--query', 'x', '--significance', 'BENIGN'], 'BENIGN is supported only in timeline mode'],
    [['investigation:memory:search', '--mode', 'semantic', '--query', 'x', '--agent-id', 'agent', '--entity-tag', 'signal:type=x'], 'only entity:-prefixed tags'],
    [['investigation:memory:search', '--mode', 'text', '--query', 'x', '--recorded-after', 'yesterday'], 'recorded-after'],
  ])('rejects invalid arguments with the intended diagnostic: %s', async (args, expected) => {
    try { await run(...args as string[]); expect(process.exitCode).toBe(1); }
    catch (error) { expect(error).toBeInstanceOf(CommanderError); expect((error as Error).message).toContain(expected as string); }
    expect(errors.join('\n')).toContain(expected as string);
    expect(requests).toHaveLength(0);
    expect(output).toHaveLength(0);
  });

  it('preserves semantic degradation and builds timeline tag filters', async () => {
    fixture = { results: [], semanticSearchUnavailable: true, note: 'No index', preamble: 'Historical records' };
    await run('investigation:memory:search', '--mode', 'semantic', '--query', 'timeout', '--agent-id', 'agent', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '')).toEqual(fixture);
    await run('investigation:memory:search', '--mode', 'timeline', '--entity-tag', 'entity:service=ingestion', '--limit', '5', '--format', 'raw');
    expect(await requests[1]?.json()).toEqual({ mode: 'TIMELINE', entityTags: { 'entity:service': 'ingestion' }, limit: 5 });
  });

  it('keeps raw stdout clean with debug and writes the same payload to a file', async () => {
    fixture = { investigationId: 'run-1', summary: 'full\ntext', actions: [] };
    await run('investigation:get', 'run-1', '--format', 'raw', '--debug');
    expect(output).toHaveLength(1);
    const dir = await fs.mkdtemp(path.resolve('build/investigation-output-'));
    try {
      const file = path.join(dir, 'result.json');
      await run('investigation:get', 'run-1', '--format', 'raw', '--output', file);
      expect((await fs.readFile(file, 'utf8')).trim()).toBe(output[0]);
      expect(output).toHaveLength(1);
    } finally { await fs.rm(dir, { recursive: true }); }
  });

  it('does not serialize journal errors as successful data', async () => {
    fixture = { message: 'journal unavailable' }; status = 503;
    await run('investigation:turns', 'run', '--format', 'raw');
    expect(process.exitCode).toBe(1);
    expect(output).toHaveLength(0);
  });

  it('defaults exports to 50 turns and explicitly reports remaining history', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const request = new Request(input);
      const url = new URL(request.url);
      const body = url.pathname.endsWith('/transcript')
        ? { investigationId: 'run', status: 'COMPLETED' }
        : { turns: Array.from({ length: Number(url.searchParams.get('pageSize')) }, (_, seq) => ({ seq })), hasMore: true };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    await run('investigation:transcript', 'run', '--format', 'raw');
    const result = JSON.parse(output[0] ?? '');
    expect(result.turns).toHaveLength(50);
    expect(result.coverage).toMatchObject({ lastSeq: 49, turnCount: 50, limitReached: true, hasMore: true });
  });

  it('streams intact tool evidence to a file, times out locally, and removes its signal listener', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = new URL(new Request(input).url);
      const body = url.pathname.endsWith('/transcript') ? { investigationId: 'run', status: 'RUNNING' }
        : { turns: [{ seq: 4, messages: [{ id: 'm1', toolCalls: [{ id: 'c1', name: 'query', argumentsJson: '{ "sql": "select 1" }' }] }] }], hasMore: false };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    });
    const listeners = process.listenerCount('SIGINT');
    const dir = await fs.mkdtemp(path.resolve('build/investigation-stream-'));
    try {
      const file = path.join(dir, 'events.jsonl');
      await run('investigation:turns', 'run', '--follow', '--timeout', '30ms', '--format', 'raw', '--output', file);
      const events = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(events.map(event => event.type)).toEqual(['status', 'turn', 'end']);
      expect(events[1].turn.messages[0].toolCalls[0]).toEqual({ id: 'c1', name: 'query', argumentsJson: '{ "sql": "select 1" }' });
      expect(events[2]).toMatchObject({ reason: 'timeout', nextAfterSeq: 4 });
      expect(process.exitCode).toBe(2);
      expect(process.listenerCount('SIGINT')).toBe(listeners);
    } finally { await fs.rm(dir, { recursive: true }); }
  });
});


describe('Investigation output and interrupt regressions', () => {
  it.each(['table', 'csv'])('projects detailed agents in %s', async format => {
    fixture = [{ agent: { id: 'a1', name: 'triage', systemPrompt: 'prompt-not-in-projection' }, recentHealth: 'HEALTHY', subscriptionCounts: { pipelines: 2 } }];
    await run('agent:list', '--details', '--format', format);
    expect(output.join('')).toContain('a1'); expect(output.join('')).toContain('triage');
    expect(output.join('')).not.toContain('prompt-not-in-projection');
  });
  it.each(['table', 'csv', 'raw', 'compact', 'pretty'])('honors quiet and keeps the data intact in %s', async format => {
    fixture = { investigations: { items: [{ investigationId: 'r1', status: 'FAILED' }] }, start: 0, limit: 1, total: 2 };
    await run('investigation:list', '--agent-id', 'a1', '--format', format);
    const diagnostics = format === 'table' ? output : errors;
    expect(diagnostics.join('')).toContain('Next: --page 1');
    if (['raw', 'compact', 'pretty'].includes(format)) expect(JSON.parse(output[0] ?? '')).toEqual(fixture);
    output = []; errors = [];
    await run('--quiet', 'investigation:list', '--agent-id', 'a1', '--format', format);
    expect(output.join('')).toContain('r1');
    expect(output.join('') + errors.join('')).not.toContain('Next:');
  });
  it('reports a fetch cause and debug stack without producing successful data', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') }));
    await run('investigation:get', 'run', '--debug', '--format', 'raw');
    expect(errors.join('')).toContain('fetch failed: connect ECONNREFUSED');
    expect(errors.join('')).toContain('TypeError: fetch failed');
    expect(process.exitCode).toBe(1); expect(output).toHaveLength(0);
  });
  it('reports timeout failure details in both coverage and stderr even when quiet', async () => {
    fixture = { message: 'journal unavailable' }; status = 503;
    await run('--quiet', 'investigation:transcript', 'run', '--timeout', '30ms', '--format', 'raw');
    expect(JSON.parse(output[0] ?? '').coverage.lastError.status).toBe(503);
    expect(errors.join('')).toContain('Read timeout:');
    expect(errors.join('')).toContain('journal unavailable');
    expect(process.exitCode).toBe(2);
  });
  it.each(['investigation:turns', 'investigation:transcript'])('SIGINT exits %s with 130 and preserves partial output', async command => {
    vi.mocked(globalThis.fetch).mockImplementation(async input => {
      const url = new URL(new Request(input).url);
      if (url.pathname.endsWith('/transcript')) return new Response(JSON.stringify({ status: 'RUNNING' }));
      setTimeout(() => process.emit('SIGINT'), 5);
      return new Promise<Response>(() => {});
    });
    const dir = await fs.mkdtemp(path.resolve('build/investigation-sigint-'));
    const listeners = process.listenerCount('SIGINT');
    try {
      const file = path.join(dir, 'result.jsonl');
      await run(command, 'run', ...(command === 'investigation:turns' ? ['--follow'] : []), '--format', 'raw', '--output', file);
      const values = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(command === 'investigation:turns' ? values.at(-1).reason : values[0].coverage.reason).toBe('interrupted');
      expect(process.exitCode).toBe(130);
      expect(process.listenerCount('SIGINT')).toBe(listeners);
    } finally { await fs.rm(dir, { recursive: true }); }
  });
});
