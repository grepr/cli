import { Command } from 'commander';
import { promises as fs } from 'fs';
import { createInterface } from 'readline/promises';
import { ICommand } from '../lib/command-registry.js';
import { createApiClient, defaultApiBaseUrl } from '../lib/api-client-factory.js';
import type { RawResponse } from '../lib/grepr-api-client.js';
import { indentJsonText } from '../lib/json-indent.js';
import {
  ApiRequest,
  ApiRequestError,
  JsonValue,
  assertPublicApiBaseUrl,
  buildApiRequest,
  parseMethod,
  requiresConfirmation,
} from '../lib/api-request.js';
import { CliOptions, MergeConfiguration } from '../types.js';

const HAS_MORE_HINT =
  'More results available. Narrow with filters, or request the next page'
  + ' (e.g. -f page=N, or the cursor parameter the endpoint documents, such as afterSeq).';
const UNAUTHORIZED_HINT =
  'Authentication failed. Re-run with --no-auth-cache to sign in again, or check the credentials'
  + ' in your saved configuration (grepr config:show <name>).';
const UNAUTHORIZED = 401;
/** Request body characters shown in the confirmation prompt before it is cut off. */
const MAX_BODY_PREVIEW = 120;

interface ApiCommandOptions {
  method?: string;
  rawField: string[];
  field: string[];
  input?: string;
  header: string[];
  include?: boolean;
  yes?: boolean;
}

/** Terminal and IO seams, injectable so tests can drive prompts and TTY detection. */
export interface ApiCommandIo {
  isInteractive(): boolean;
  stdoutIsTTY(): boolean;
  /** Writes text to stdout as given, with nothing appended. */
  writeStdout(text: string): void;
  confirm(question: string): Promise<boolean>;
  readStdin(): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function promptYesNo(question: string): Promise<boolean> {
  // The prompt goes to stderr so stdout stays a clean response stream.
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export const defaultApiCommandIo: ApiCommandIo = {
  // The prompt reads stdin and writes stderr, so a piped stdout still leaves someone to ask.
  isInteractive: () => Boolean(process.stdin.isTTY && process.stderr.isTTY),
  stdoutIsTTY: () => Boolean(process.stdout.isTTY),
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  confirm: promptYesNo,
  readStdin: readAllStdin,
  readFile: (path) => fs.readFile(path, 'utf8'),
  writeFile: (path, content) => fs.writeFile(path, content),
};

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Parses a response body as JSON, or undefined when it is not JSON. */
function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/** `METHOD /path?query`, as the request will be sent, so the prompt names the actual target. */
function describeTarget(request: ApiRequest): string {
  const query = new URLSearchParams(request.query).toString();
  return `${request.method} ${request.path}${query ? `?${query}` : ''}`;
}

/** A one-line preview of the request body for the prompt, cut to {@link MAX_BODY_PREVIEW}. */
function describeBody(body: string | undefined): string {
  if (body === undefined) return '';
  const oneLine = body.replace(/\s+/g, ' ').trim();
  const preview = oneLine.length > MAX_BODY_PREVIEW ? `${oneLine.slice(0, MAX_BODY_PREVIEW - 3)}...` : oneLine;
  return ` with body ${preview}`;
}

function hasMore(body: JsonValue | undefined): boolean {
  return typeof body === 'object' && body !== null && !Array.isArray(body) && body.hasMore === true;
}

/**
 * `grepr api <endpoint>`: an authenticated request to any public Grepr API endpoint, for the API
 * surface no dedicated command covers. Discover endpoints with `docs:search` / `docs:get`.
 */
export class ApiCommand implements ICommand {
  constructor(private readonly io: ApiCommandIo = defaultApiCommandIo) {}

  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command('api')
      .description('Make authenticated requests directly to the Grepr API')
      .argument('<endpoint>', 'API endpoint path (e.g. v1/jobs or /api/v1/jobs)')
      .option('-X, --method <method>', 'HTTP method (default: GET, or POST when --input is given)')
      .option('-f, --raw-field <key=value>', 'String field; query param for GET/HEAD/DELETE, else JSON body (repeatable; key[]=value builds an array)', collect, [])
      .option('-F, --field <key=value>', 'Typed field: numbers, true/false and null are sent as JSON literals (repeatable; key[]=value builds an array)', collect, [])
      .option('--input <file>', 'Raw request body from a file, or - for stdin')
      .option('-H, --header <header>', "Extra request header, 'Name: value' (repeatable)", collect, [])
      .option('-i, --include', 'Print the status line and response headers to stderr')
      .option('--yes', 'Skip the confirmation prompt for non-GET requests')
      .addHelpText('after', [
        '',
        'Sends an HTTP request to a Grepr API endpoint using your current credentials',
        '(the same OAuth or client-credentials login as every other grepr command). Useful',
        'for endpoints not yet covered by a dedicated grepr command.',
        '',
        'The endpoint is the path under the API root: v1/jobs, /v1/jobs and /api/v1/jobs',
        'are the same endpoint. Find endpoints and their parameters in the API reference',
        '(`grepr docs:search -t api "<what you want to do>"`, then `grepr docs:get <uri>`).',
        '',
        'In a JSON body a key with one value is a scalar and a repeated key is an array.',
        'Write key[]=value to always send an array, even with one value: -f teamIds[]=t1.',
        '',
        'Examples:',
        '  # List pipelines',
        '  grepr api v1/jobs',
        '',
        '  # GET with query parameters',
        '  grepr api v1/agent-suggestions -F page=1 -F pageSize=20',
        '',
        '  # POST a JSON body from a file (or - for stdin)',
        '  grepr api -X POST v1/datasets --input dataset.json',
        '',
        '  # POST with key=value fields (no file needed)',
        '  grepr api -X POST v1/datasets -f name=checkout-logs -f teamIds[]=team-1',
        '',
        '  # Show the response status and headers',
        '  grepr api -i v1/jobs',
        '',
        'Requests other than GET/HEAD ask for confirmation; pass --yes in scripts and agents.',
      ].join('\n'))
      .action(async (endpoint: string, options: ApiCommandOptions, command: Command) => {
        let exitCode: number;
        try {
          const cliOptions = await mergeConfiguration({ ...command.parent?.opts() });
          exitCode = await this.execute(endpoint, options, cliOptions);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Error: ${message}`);
          exitCode = 1;
        }
        // exitCode rather than exit(): stderr is asynchronous on a POSIX pipe, and exiting at once
        // could cut off a large error body still being written.
        if (exitCode !== 0) process.exitCode = exitCode;
      });
  }

  /** Runs the request and returns the process exit code. */
  async execute(endpoint: string, options: ApiCommandOptions, cliOptions: CliOptions): Promise<number> {
    const apiBaseUrl = cliOptions.apiBaseUrl || defaultApiBaseUrl(cliOptions.orgName);
    assertPublicApiBaseUrl(apiBaseUrl);
    this.assertStdinBodyConfirmable(options);
    const input = options.input;
    // buildApiRequest validates every flag before calling readInputBody, so a bad flag fails
    // without waiting on stdin.
    const request = await buildApiRequest({
      endpoint,
      method: options.method,
      rawFields: options.rawField,
      typedFields: options.field,
      headers: options.header,
      readInputBody: input === undefined ? undefined : (): Promise<string> => this.readInput(input),
    });

    if (requiresConfirmation(request.method) && !options.yes && !(await this.confirmWrite(request, cliOptions))) {
      return 1;
    }

    const client = createApiClient({ ...cliOptions, apiBaseUrl });
    const response = await client.rawRequest(request.method, request.path, {
      query: request.query,
      body: request.body,
      headers: request.headers,
    });
    return this.report(response, options, cliOptions);
  }

  /**
   * A body read from stdin leaves stdin at EOF, so a confirmation prompt after it could never be
   * answered and the command would exit without sending or failing. Refuse before reading it.
   */
  private assertStdinBodyConfirmable(options: ApiCommandOptions): void {
    if (options.input === '-' && !options.yes && requiresConfirmation(parseMethod(options.method, true))) {
      throw new ApiRequestError('a request body from stdin cannot be confirmed at a prompt; pass --yes');
    }
  }

  private async readInput(input: string): Promise<string> {
    return input === '-' ? this.io.readStdin() : this.io.readFile(input);
  }

  /** Prompts on a terminal; refuses outright when there is no one to ask. */
  private async confirmWrite(request: ApiRequest, cliOptions: CliOptions): Promise<boolean> {
    if (!this.io.isInteractive()) {
      throw new ApiRequestError(
        `${describeTarget(request)} changes data; pass --yes to confirm in non-interactive use`);
    }
    const confirmed = await this.io.confirm(
      `${describeTarget(request)} on org '${cliOptions.orgName}'${describeBody(request.body)} — continue? [y/N] `);
    if (!confirmed) {
      console.error('Aborted.');
    }
    return confirmed;
  }

  private async report(response: RawResponse, options: ApiCommandOptions, cliOptions: CliOptions): Promise<number> {
    if (options.include) {
      console.error(`HTTP ${response.status} ${response.statusText}`.trimEnd());
      response.headers.forEach((value, name) => console.error(`${name}: ${value}`));
      console.error('');
    }
    const ok = response.status >= 200 && response.status < 300;
    if (!ok) {
      // Never on stdout or into -o: a failed GET piped or saved as if it were the resource would
      // turn into a PUT that clears every field the error body lacks.
      if (response.body.length > 0) console.error(response.body);
      console.error(`HTTP ${response.status}`);
      if (response.status === UNAUTHORIZED) console.error(UNAUTHORIZED_HINT);
      return 1;
    }
    const json = parseJson(response.body);
    await this.writeBody(response.body, json, cliOptions);
    if (hasMore(json) && !cliOptions.quiet) console.error(HAS_MORE_HINT);
    return 0;
  }

  /**
   * A piped stdout gets the body byte for byte, the same as -o. A terminal gets JSON indented and a
   * final newline. Indenting works on the text, never a parsed copy, so int64 values and numbers
   * like 1.0 print exactly as sent.
   */
  private async writeBody(body: string, json: JsonValue | undefined, cliOptions: CliOptions): Promise<void> {
    if (cliOptions.output) {
      await this.io.writeFile(cliOptions.output, body);
      return;
    }
    if (!this.io.stdoutIsTTY()) {
      this.io.writeStdout(body);
      return;
    }
    const text = json === undefined ? body : indentJsonText(body);
    if (text.length > 0) this.io.writeStdout(text.endsWith('\n') ? text : `${text}\n`);
  }
}
