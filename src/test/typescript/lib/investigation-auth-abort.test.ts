import { afterEach, expect, it, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';

let listening = false;
let opened = 0;
let closed = 0;
const server = Object.assign(new EventEmitter(), {
  listen: (_port: number, callback: () => void) => { listening = true; opened++; callback(); },
  close: () => { listening = false; closed++; server.emit('close'); },
  closeAllConnections: () => {},
});
const http = await import('http');
vi.mock('http', () => ({ ...http, createServer: () => server,
  default: { ...http.default, createServer: () => server } }));
const { GreprApiClient } = await import('../../../main/typescript/lib/grepr-api-client.js');
const { captureTranscript } = await import('../../../main/typescript/lib/investigation-transcript.js');
const { InvestigationCommand } = await import('../../../main/typescript/commands/investigation-command.js');
const { ClientCredentialsAuth } = await import('../../../main/typescript/lib/auth.js');
const axios = (await import('axios')).default;

afterEach(() => {
  server.removeAllListeners(); listening = false; opened = 0; closed = 0; vi.restoreAllMocks(); process.exitCode = 0;
});
const config = { orgName: 'acme', apiBaseUrl: 'https://example.test', authBaseUrl: 'https://auth.test',
  clientId: 'client', authMethod: 'oauth' as const, browser: false, authCache: false };

it('an export deadline closes a fresh OAuth callback server', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await captureTranscript(new GreprApiClient(config), 'run', { timeoutMs: 20 });
  expect(result.coverage.reason).toBe('timeout');
  expect(opened).toBe(1);
  expect(closed).toBe(1);
  expect(listening).toBe(false);
});

it('a single turns page deadline closes its OAuth callback server', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const program = new Command();
  new InvestigationCommand().addToProgram(program, async () => config);
  await program.parseAsync(['investigation:turns', 'run', '--timeout', '20ms'], { from: 'user' });
  expect(process.exitCode).toBe(2);
  expect(opened).toBe(1);
  expect(closed).toBe(1);
  expect(listening).toBe(false);
});

it('aborts an in-flight client-credentials token exchange', async () => {
  vi.spyOn(axios, 'post').mockImplementation((_url, _body, options) => new Promise((_resolve, reject) => {
    const abort = () => reject(new Error('token request aborted'));
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener?.('abort', abort, { once: true });
  }));
  const controller = new AbortController();
  const auth = new ClientCredentialsAuth({ ...config, authMethod: 'client-credentials', clientSecret: 'secret' });
  const request = auth.getAuthHeaders(controller.signal);
  controller.abort();
  await expect(Promise.race([request, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('still waiting')), 30))]))
    .rejects.toThrow('token request aborted');
});
