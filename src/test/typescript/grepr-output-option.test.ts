import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { GreprQueryCLI } from '../../main/typescript/grepr.js';
import { restoreStdoutTerminal, setStdoutTerminal } from './stdout-terminal.js';

const jobs = [
  { id: 'job-1', name: 'alpha', state: 'RUNNING' },
  { id: 'job-2', name: 'beta', state: 'STOPPED' }
];
const connection = ['--org-name', 'acme', '--api-base-url', 'https://example.test/api', '--auth-method', 'none'];
const originalCwd = process.cwd();
let workDir: string;
let stdout: string[];
let stderr: string[];
let fixture: object;

async function run(...args: string[]): Promise<void> {
  await new GreprQueryCLI().setupCLI().exitOverride().parseAsync([...connection, ...args], { from: 'user' });
}

beforeEach(async () => {
  stdout = [];
  stderr = [];
  fixture = { items: jobs };
  workDir = await fs.mkdtemp(path.resolve('build/output-option-'));
  process.chdir(workDir);
  vi.spyOn(console, 'log').mockImplementation(text => { stdout.push(String(text)); });
  vi.spyOn(console, 'error').mockImplementation(text => { stderr.push(String(text)); });
  vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`process.exit(${code}): ${stderr.join('\n')}`); });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.chdir(originalCwd);
  await fs.rm(workDir, { recursive: true });
  delete process.env.CLAUDECODE;
  delete process.env.GREPR_OUTPUT_FORMAT;
  restoreStdoutTerminal();
});

const filesInWorkDir = (): Promise<string[]> => fs.readdir(workDir);
// Table and pretty output carry chalk colors when the test runs in a real terminal.
const plainText = (lines: string[]): string => stripVTControlCharacters(lines.join('\n'));
const ndjsonRows = (lines: string[]): unknown[] =>
  lines.join('\n').split('\n').filter(line => line.length > 0).map(line => JSON.parse(line));

describe('-o with a format name', () => {
  it('prints compact NDJSON to stdout and writes no file', async () => {
    await run('job:list', '-o', 'json');

    expect(ndjsonRows(stdout)).toEqual(jobs);
    expect(stderr.join('\n')).not.toContain('Query Summary');
    expect(await filesInWorkDir()).toEqual([]);
  });

  it('applies to commands that write a single JSON document', async () => {
    fixture = [{ id: 'agent-1', name: 'triage' }];
    await run('agent:list', '-o', 'json');

    expect(JSON.parse(stdout.join(''))).toEqual(fixture);
    expect(await filesInWorkDir()).toEqual([]);
  });

  it('keeps a value that is not a format as the output file', async () => {
    process.env.CLAUDECODE = '1';
    await run('job:list', '-o', 'out.ndjson');

    expect(await filesInWorkDir()).toEqual(['out.ndjson']);
    expect(ndjsonRows([await fs.readFile(path.join(workDir, 'out.ndjson'), 'utf8')])).toEqual(jobs);
    expect(stdout).toEqual([]);
  });

  it('keeps -o as the output file when -f is explicit', async () => {
    await run('job:list', '-f', 'table', '-o', 'json');

    expect(await filesInWorkDir()).toEqual(['json']);
    expect(await fs.readFile(path.join(workDir, 'json'), 'utf8')).toContain('alpha');
  });
});

describe('list query summary', () => {
  it('is absent in compact format', async () => {
    await run('job:list', '-f', 'compact');

    expect(ndjsonRows(stdout)).toEqual(jobs);
    expect(stderr.join('\n')).not.toContain('Query Summary');
  });

  it('is present in table format', async () => {
    await run('job:list', '-f', 'table');

    expect(stdout.join('\n')).toContain('Query Summary');
    expect(stdout.join('\n')).toContain('alpha');
  });
});

describe('get details summary', () => {
  it('is absent in compact format', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1', '-f', 'compact');

    expect(ndjsonRows(stdout)).toEqual([jobs[0]]);
    expect(stderr.join('\n')).not.toContain('Job Details');
  });

  it('is absent in pretty format, which prints one JSON document', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1', '-f', 'pretty');

    expect(JSON.parse(plainText(stdout))).toEqual(jobs[0]);
    expect(stderr.join('\n')).not.toContain('Job Details');
  });

  it('is present in table format', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1', '-f', 'table');

    expect(stdout.join('\n')).toContain('Job Details');
  });
});

describe('create status line', () => {
  it('goes to stderr so that stdout is the created resource as JSON', async () => {
    fixture = { id: 'ds-1', name: 'logs' };
    await fs.writeFile(path.join(workDir, 'dataset.json'), JSON.stringify({ name: 'logs' }));
    await run('dataset:create', 'dataset.json');

    expect(JSON.parse(plainText(stdout))).toEqual(fixture);
    expect(stderr.join('\n')).toContain('created successfully with ID: ds-1');
  });
});

describe('default format in a terminal', () => {
  beforeEach(() => {
    setStdoutTerminal(true);
  });

  it('is a table with a query summary for a list without -f', async () => {
    await run('job:list');

    const text = plainText(stdout);
    expect(text).toContain('Query Summary');
    expect(text).toContain('alpha');
    expect(text).toContain('beta');
    expect(() => JSON.parse(text)).toThrow();
  });

  it('is multi-line pretty JSON for a get without -f', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1');

    const text = plainText(stdout);
    expect(JSON.parse(text)).toEqual(jobs[0]);
    expect(text.trim().split('\n').length).toBeGreaterThan(1);
  });
});

describe('default format when stdout is not a terminal', () => {
  beforeEach(() => {
    setStdoutTerminal(false);
  });

  it('is compact NDJSON for a list without -f', async () => {
    await run('job:list');

    expect(ndjsonRows(stdout)).toEqual(jobs);
    expect([...stdout, ...stderr].join('\n')).not.toContain('Query Summary');
  });

  it('is one compact JSON line for a get without -f', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1');

    expect(stdout).toEqual([JSON.stringify(jobs[0])]);
  });
});

describe('GREPR_OUTPUT_FORMAT', () => {
  it('gives a table when stdout is not a terminal', async () => {
    setStdoutTerminal(false);
    process.env.GREPR_OUTPUT_FORMAT = 'table';
    await run('job:list');

    expect(plainText(stdout)).toContain('Query Summary');
  });

  it('gives a table in an agent run', async () => {
    setStdoutTerminal(true);
    process.env.CLAUDECODE = '1';
    process.env.GREPR_OUTPUT_FORMAT = 'table';
    await run('job:list');

    expect(plainText(stdout)).toContain('Query Summary');
  });

  it('gives compact NDJSON in a terminal', async () => {
    setStdoutTerminal(true);
    process.env.GREPR_OUTPUT_FORMAT = 'compact';
    await run('job:list');

    expect(ndjsonRows(stdout)).toEqual(jobs);
  });
});

describe('grok:parse summaries', () => {
  const summaryMarkers = ['=== Sample', 'Grok Parse Summary', '=== Batch Summary'];

  beforeEach(async () => {
    fixture = {
      results: [
        { match: true, matchingRuleName: 'login', attributes: { user: 'alice' }, tags: {}, topLevelFields: {} },
        { match: false, attributes: {}, tags: {}, topLevelFields: {} }
      ]
    };
    await fs.writeFile(path.join(workDir, 'samples.txt'), 'alice logged in\nbob logged out\n');
  });

  const parse = (...args: string[]): Promise<void> =>
    run('grok:parse', '-p', 'login %{WORD:user} logged in', '--samples-file', 'samples.txt', ...args);

  it.each([[[]], [['-f', 'raw']], [['-f', 'compact']]])('are absent from stdout and stderr with %p', async args => {
    await parse(...args);

    const output = [...stdout, ...stderr].join('\n');
    for (const marker of summaryMarkers) {
      expect(output).not.toContain(marker);
    }
    expect(ndjsonRows(stdout)).toHaveLength(2);
  });

  it('are absent from stdout and stderr in pretty format', async () => {
    await parse('-f', 'pretty');

    const output = [...stdout, ...stderr].join('\n');
    for (const marker of summaryMarkers) {
      expect(output).not.toContain(marker);
    }
  });

  it('are present on stdout in table format', async () => {
    await parse('-f', 'table');

    const output = stdout.join('\n');
    for (const marker of summaryMarkers) {
      expect(output).toContain(marker);
    }
  });
});

describe('agent runs in a terminal', () => {
  beforeEach(() => {
    setStdoutTerminal(true);
    process.env.CLAUDECODE = '1';
  });

  it('default a list to compact NDJSON', async () => {
    await run('job:list');

    expect(ndjsonRows(stdout)).toEqual(jobs);
    expect([...stdout, ...stderr].join('\n')).not.toContain('Query Summary');
  });

  it('default a get to one compact NDJSON line', async () => {
    fixture = jobs[0];
    await run('job:get', 'job-1');

    expect(stdout).toEqual([JSON.stringify(jobs[0])]);
  });
});
