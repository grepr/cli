import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { ApiCommand, type ApiCommandIo } from '@/commands/api-command.js';
import type { RawResponse } from '@/lib/grepr-api-client.js';

vi.mock('@/lib/api-client-factory.js', () => ({
  createApiClient: vi.fn(),
}));

import { createApiClient } from '@/lib/api-client-factory.js';

const CLI_OPTIONS = {
  orgName: 'acme',
  apiBaseUrl: 'https://acme.app.grepr.ai/api',
  authBaseUrl: 'https://auth.grepr.ai',
  authMethod: 'none',
  clientId: 'client',
  authCache: true,
  browser: false,
};

function response(status: number, body: string, headers: Record<string, string> = {}): RawResponse {
  return { status, statusText: status === 200 ? 'OK' : '', headers: new Headers(headers), body };
}

function fakeIo(overrides: Partial<ApiCommandIo> = {}): ApiCommandIo {
  return {
    isInteractive: () => false,
    stdoutIsTTY: () => false,
    writeStdout: vi.fn(),
    confirm: vi.fn().mockResolvedValue(false),
    readStdin: vi.fn().mockResolvedValue('{"from":"stdin"}'),
    readFile: vi.fn().mockResolvedValue('{"from":"file"}'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ApiCommand', () => {
  let program: Command;
  let rawRequest: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let cliOverrides: Record<string, string>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    cliOverrides = {};
    rawRequest = vi.fn().mockResolvedValue(response(200, '{"items":[{"id":"a"}]}'));
    (createApiClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rawRequest });
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    // Failures set process.exitCode and never call process.exit, which could cut off a large error
    // body still being written to a piped stderr.
    expect(processExitSpy).not.toHaveBeenCalled();
    process.exitCode = 0;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  /** Runs `grepr api <args>` and returns the exit code it set. */
  async function run(args: string[], io: ApiCommandIo = fakeIo()): Promise<number> {
    new ApiCommand(io).addToProgram(program, async () => ({ ...CLI_OPTIONS, ...cliOverrides }) as never);
    await program.parseAsync(['node', 'grepr', 'api', ...args]);
    return Number(process.exitCode ?? 0);
  }

  /** Everything written to stdout, concatenated exactly as written. */
  function stdout(io: ApiCommandIo): string {
    return vi.mocked(io.writeStdout).mock.calls.map(([text]) => text).join('');
  }

  function stderr(): string {
    return consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
  }

  it('test_api_get_sendsRequestAndPrintsCompactJson', async () => {
    const io = fakeIo();

    await run(['v1/jobs?latest=true'], io);

    expect(rawRequest).toHaveBeenCalledWith('GET', '/v1/jobs', {
      query: [['latest', 'true']], body: undefined, headers: {},
    });
    expect(stdout(io)).toBe('{"items":[{"id":"a"}]}');
    expect(process.exitCode).toBe(0);
  });

  it.each([
    // Re-serializing through JSON.parse would round the int64 and turn 1.0 into 1.
    ['{"timestampNanos":1760000000123456789,"ratio":1.0}'],
    // Nothing is appended or stripped, so piping matches -o even for a body ending in CRLF.
    ['id,name\r\na,b\r\n'],
    ['{"items":[]}\n'],
  ])('test_api_piped_%j_writesBodyByteForByte', async (body) => {
    rawRequest.mockResolvedValue(response(200, body));
    const io = fakeIo();

    await run(['v1/jobs'], io);

    expect(stdout(io)).toBe(body);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('test_api_stdoutIsTty_prettyPrintsJsonWithFinalNewline', async () => {
    const io = fakeIo({ stdoutIsTTY: () => true });

    await run(['v1/jobs'], io);

    expect(stdout(io)).toBe(`${JSON.stringify({ items: [{ id: 'a' }] }, null, 2)}\n`);
  });

  it('test_api_stdoutIsTty_indentsWithoutRoundingInt64', async () => {
    rawRequest.mockResolvedValue(response(200, '{"timestampNanos":1234567890123456789,"ratio":1.0}'));
    const io = fakeIo({ stdoutIsTTY: () => true });

    await run(['v1/jobs'], io);

    expect(stdout(io)).toBe('{\n  "timestampNanos": 1234567890123456789,\n  "ratio": 1.0\n}\n');
  });

  it.each([
    ['plain text', 'plain text\n'],
    ['plain text\n', 'plain text\n'],
    ['', ''],
  ])('test_api_stdoutIsTty_nonJsonBody_%j_endsWithOneNewline', async (body, expected) => {
    rawRequest.mockResolvedValue(response(200, body));
    const io = fakeIo({ stdoutIsTTY: () => true });

    await run(['v1/jobs'], io);

    expect(stdout(io)).toBe(expected);
  });

  it('test_api_outputOption_writesBodyToFile', async () => {
    cliOverrides = { output: 'out.json' };
    const io = fakeIo();

    await run(['v1/jobs'], io);

    expect(io.writeFile).toHaveBeenCalledWith('out.json', '{"items":[{"id":"a"}]}');
    expect(io.writeStdout).not.toHaveBeenCalled();
  });

  it('test_api_non2xx_printsBodyAndStatusToStderrAndExitsOne', async () => {
    rawRequest.mockResolvedValue(response(404, '{"message":"not found"}'));
    const io = fakeIo();

    expect(await run(['v1/jobs/x'], io)).toBe(1);

    expect(io.writeStdout).not.toHaveBeenCalled();
    expect(stderr()).toContain('{"message":"not found"}');
    expect(stderr()).toContain('HTTP 404');
  });

  it('test_api_non2xxWithOutputOption_leavesFileUnwritten', async () => {
    cliOverrides = { output: 'dataset.json' };
    rawRequest.mockResolvedValue(response(404, '{"message":"not found"}'));
    const io = fakeIo();

    expect(await run(['v1/datasets/x'], io)).toBe(1);

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(stderr()).toContain('{"message":"not found"}');
  });

  it('test_api_401_addsReauthenticationHint', async () => {
    rawRequest.mockResolvedValue(response(401, ''));

    expect(await run(['v1/jobs'])).toBe(1);

    expect(stderr()).toContain('HTTP 401');
    expect(stderr()).toContain('--no-auth-cache');
  });

  it('test_api_hasMoreTrue_printsOnePagingHint', async () => {
    rawRequest.mockResolvedValue(response(200, '{"items":[],"hasMore":true}'));

    await run(['v1/jobs']);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(stderr()).toContain('More results available.');
  });

  it('test_api_hasMoreTrueWithQuiet_printsNoHint', async () => {
    rawRequest.mockResolvedValue(response(200, '{"items":[],"hasMore":true}'));
    cliOverrides = { quiet: true } as never;

    await run(['v1/jobs']);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('test_api_include_printsStatusAndHeadersToStderr', async () => {
    rawRequest.mockResolvedValue(response(200, '{}', { 'x-request-id': 'r1' }));

    await run(['-i', 'v1/jobs']);

    expect(stderr()).toContain('HTTP 200 OK');
    expect(stderr()).toContain('x-request-id: r1');
  });

  it('test_api_unknownEndpoint_isSentAsIs', async () => {
    await run(['v2/brand-new']);

    expect(rawRequest).toHaveBeenCalledWith('GET', '/v2/brand-new', expect.anything());
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('test_api_writeWithoutYesNonInteractive_isRefusedWithoutSending', async () => {
    expect(await run(['-X', 'DELETE', 'v1/things', '-f', 'id=prod-123'])).toBe(1);

    // Names the request as it would be sent, query string included, the same as the prompt.
    expect(stderr()).toContain('DELETE /v1/things?id=prod-123 changes data; pass --yes');
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('test_api_writeInteractiveDeclined_abortsWithoutSending', async () => {
    const io = fakeIo({ isInteractive: () => true });

    expect(await run(['-X', 'PUT', 'v1/jobs/abc', '--input', 'job.json'], io)).toBe(1);

    expect(io.confirm).toHaveBeenCalledWith(
      "PUT /v1/jobs/abc on org 'acme' with body {\"from\":\"file\"} — continue? [y/N] ");
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('test_api_writeInteractiveConfirmed_sendsFileBody', async () => {
    const io = fakeIo({ isInteractive: () => true, confirm: vi.fn().mockResolvedValue(true) });

    await run(['-X', 'PUT', 'v1/jobs/abc', '--input', 'job.json'], io);

    expect(io.readFile).toHaveBeenCalledWith('job.json');
    expect(rawRequest).toHaveBeenCalledWith('PUT', '/v1/jobs/abc', {
      query: [], body: '{"from":"file"}', headers: { 'Content-Type': 'application/json' },
    });
  });

  it('test_api_yes_skipsPromptAndSendsTypedFields', async () => {
    const io = fakeIo({ isInteractive: () => true });

    await run(['-X', 'POST', 'v1/datasets', '-F', 'n=2', '-f', 'name=x', '--yes'], io);

    expect(io.confirm).not.toHaveBeenCalled();
    expect(rawRequest).toHaveBeenCalledWith('POST', '/v1/datasets', {
      query: [], body: '{"name":"x","n":2}', headers: { 'Content-Type': 'application/json' },
    });
  });

  it('test_api_inputDash_readsStdin', async () => {
    const io = fakeIo();

    await run(['v1/datasets', '--input', '-', '--yes'], io);

    expect(io.readStdin).toHaveBeenCalled();
    expect(rawRequest.mock.calls[0]?.[2]?.body).toBe('{"from":"stdin"}');
  });

  it.each([
    [['v1/datasets', '--input', '-']],
    [['-X', 'PUT', 'v1/datasets/abc', '--input', '-']],
  ])('test_api_inputDashWithoutYes_%j_isRefusedBeforeReadingStdin', async (args) => {
    // On a terminal the prompt would read the same stdin the body just drained, and never be answered.
    const io = fakeIo();

    expect(await run(args, io)).toBe(1);

    expect(stderr()).toContain('pass --yes');
    expect(io.readStdin).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('test_api_confirmPrompt_namesTheQueryTarget', async () => {
    const io = fakeIo({ isInteractive: () => true });

    await run(['-X', 'DELETE', 'v1/things', '-f', 'id=prod-123'], io);

    expect(io.confirm).toHaveBeenCalledWith("DELETE /v1/things?id=prod-123 on org 'acme' — continue? [y/N] ");
  });

  it('test_api_confirmPrompt_cutsLongBodyPreview', async () => {
    const io = fakeIo({ isInteractive: () => true });

    await run(['-X', 'POST', 'v1/things', '-f', `note=${'x'.repeat(200)}`], io);

    const prompt = String(vi.mocked(io.confirm).mock.calls[0]?.[0]);
    expect(prompt).toContain(`with body {"note":"${'x'.repeat(108)}... — continue?`);
  });

  it.each([
    [['-X', 'GET', 'v1/jobs', '--input', '-', '--yes']],
    [['-X', 'BOGUS', 'v1/jobs', '--input', '-', '--yes']],
    [['-X', 'POST', 'v1/jobs', '--input', '-', '--yes', '-H', 'not a header']],
    [['-X', 'POST', 'v1/jobs', '--input', '-', '--yes', '-H', 'X-Test: a\nb']],
    [['-X', 'POST', 'v1/jobs', '--input', '-', '--yes', '-f', 'a=1']],
    [['-X', 'DELETE', 'v1/jobs', '--input', '-', '--yes', '-f', '=nokey']],
  ])('test_api_badFlagWithStdinBody_%j_failsBeforeReadingStdin', async (args) => {
    const io = fakeIo();

    expect(await run(args, io)).toBe(1);

    expect(io.readStdin).not.toHaveBeenCalled();
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('test_api_badEndpoint_failsBeforeReadingInput', async () => {
    const io = fakeIo();

    expect(await run(['internal/x', '--input', '-', '--yes'], io)).toBe(1);

    expect(io.readStdin).not.toHaveBeenCalled();
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it.each([
    [['/api/internal/agents']],
    [['https://evil.example/v1/jobs']],
    [['v1/jobs', '-H', 'X-Grepr-Auth-User: someone']],
    [['v1/jobs', '-H', 'Authorization: Bearer x']],
  ])('test_api_guard_%j_refusesWithoutSending', async (args) => {
    expect(await run(args)).toBe(1);

    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('test_api_internalApiBaseUrl_isRefusedWithoutSending', async () => {
    cliOverrides = { apiBaseUrl: 'https://internal-lb.example.com/api' };

    expect(await run(['v1/jobs'])).toBe(1);

    expect(stderr()).toContain('configured API base URL is internal');
    expect(rawRequest).not.toHaveBeenCalled();
  });
});
