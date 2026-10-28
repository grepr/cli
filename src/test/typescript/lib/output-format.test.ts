import { describe, it, expect, afterEach, vi } from 'bun:test';
import {
  isAgentRun,
  isMachineReadable,
  logHumanFooter,
  logHumanSummary,
  parseFieldsArg,
  parseOutputFormat,
  projectFields,
  resolveDefaultFormat
} from '../../../main/typescript/lib/output-format.js';
import { restoreStdoutTerminal, setStdoutTerminal } from '../stdout-terminal.js';

const originalFormatEnv = process.env.GREPR_OUTPUT_FORMAT;

/** Restore the env var a test changed, keeping it unset when it started unset. */
function setFormatEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.GREPR_OUTPUT_FORMAT;
  } else {
    process.env.GREPR_OUTPUT_FORMAT = value;
  }
}

afterEach(() => {
  setFormatEnv(originalFormatEnv);
  delete process.env.CLAUDECODE;
  restoreStdoutTerminal();
});

describe('parseOutputFormat', () => {
  it('test_parseOutputFormat_knownFormat_shouldReturnUnchanged', () => {
    expect(parseOutputFormat('compact')).toBe('compact');
    expect(parseOutputFormat('table')).toBe('table');
    expect(parseOutputFormat('csv')).toBe('csv');
    expect(parseOutputFormat('pretty')).toBe('pretty');
    expect(parseOutputFormat('raw')).toBe('raw');
  });

  it('test_parseOutputFormat_json_shouldAliasToCompact', () => {
    expect(parseOutputFormat('json')).toBe('compact');
  });

  it('test_parseOutputFormat_objectPrototypeKey_shouldThrow', () => {
    expect(() => parseOutputFormat('constructor')).toThrow();
    expect(() => parseOutputFormat('__proto__')).toThrow();
  });

  it('test_parseOutputFormat_mixedCaseAndPadding_shouldNormalize', () => {
    expect(parseOutputFormat('  CoMpAcT ')).toBe('compact');
  });

  it('test_parseOutputFormat_unknownFormat_shouldThrow', () => {
    expect(() => parseOutputFormat('bogus')).toThrow(
      'must be one of table, csv, pretty, raw, compact (or json, an alias for compact)'
    );
  });

  it('test_parseOutputFormat_emptyString_shouldThrow', () => {
    expect(() => parseOutputFormat('')).toThrow('must be one of');
  });
});

describe('resolveDefaultFormat', () => {
  it('test_resolveDefaultFormat_terminalEnvUnset_shouldReturnCommandDefault', () => {
    setStdoutTerminal(true);
    setFormatEnv(undefined);
    expect(resolveDefaultFormat('table')).toBe('table');
    expect(resolveDefaultFormat('pretty')).toBe('pretty');
  });

  it('test_resolveDefaultFormat_notTerminal_shouldReturnCompact', () => {
    setStdoutTerminal(false);
    setFormatEnv(undefined);
    expect(resolveDefaultFormat('table')).toBe('compact');
    expect(resolveDefaultFormat('pretty')).toBe('compact');
  });

  it('test_resolveDefaultFormat_envSet_shouldOverrideCommandDefault', () => {
    setStdoutTerminal(true);
    setFormatEnv('compact');
    expect(resolveDefaultFormat('table')).toBe('compact');
    expect(resolveDefaultFormat('pretty')).toBe('compact');
  });

  it('test_resolveDefaultFormat_envSetNotTerminal_shouldUseEnvFormat', () => {
    setStdoutTerminal(false);
    setFormatEnv('table');
    expect(resolveDefaultFormat('pretty')).toBe('table');
  });

  it('test_resolveDefaultFormat_envAlias_shouldResolve', () => {
    setFormatEnv('json');
    expect(resolveDefaultFormat('table')).toBe('compact');
  });

  it('test_resolveDefaultFormat_envEmptyInTerminal_shouldReturnCommandDefault', () => {
    setStdoutTerminal(true);
    setFormatEnv('');
    expect(resolveDefaultFormat('raw')).toBe('raw');
  });

  it('test_resolveDefaultFormat_envInvalid_shouldThrowNamingTheVariable', () => {
    setFormatEnv('nope');
    expect(() => resolveDefaultFormat('table')).toThrow(
      "GREPR_OUTPUT_FORMAT: 'nope' is invalid. It must be one of table, csv, pretty, raw, compact"
    );
  });
});

describe('agent runs', () => {
  it('test_resolveDefaultFormat_agentRunInTerminal_shouldReturnCompact', () => {
    setStdoutTerminal(true);
    setFormatEnv(undefined);
    process.env.CLAUDECODE = '1';
    expect(resolveDefaultFormat('table')).toBe('compact');
    expect(resolveDefaultFormat('pretty')).toBe('compact');
  });

  it('test_resolveDefaultFormat_agentRunWithEnvFormat_shouldUseEnvFormat', () => {
    setStdoutTerminal(true);
    setFormatEnv('table');
    process.env.CLAUDECODE = '1';
    expect(resolveDefaultFormat('pretty')).toBe('table');
  });

  it('test_isAgentRun_agentVars_shouldDetectEachAgent', () => {
    expect(isAgentRun({ AI_AGENT: 'claude-code_2.1_agent' })).toBe(true);
    expect(isAgentRun({ CODEX_THREAD_ID: 'thread-1' })).toBe(true);
    expect(isAgentRun({ CURSOR_AGENT: '1' })).toBe(true);
    expect(isAgentRun({ GEMINI_CLI: '1' })).toBe(true);
    expect(isAgentRun({ OPENCODE: '1' })).toBe(true);
  });

  it('test_isAgentRun_emptyOrUnrelatedVars_shouldBeFalse', () => {
    expect(isAgentRun({})).toBe(false);
    expect(isAgentRun({ CLAUDECODE: '', CODEX_CI: '' })).toBe(false);
    expect(isAgentRun({ CURSOR_TRACE_ID: 'trace-1', TERM_PROGRAM: 'vscode' })).toBe(false);
  });
});

describe('isMachineReadable', () => {
  it('test_isMachineReadable_jsonAndCsvFormats_shouldBeTrue', () => {
    expect(isMachineReadable('compact')).toBe(true);
    expect(isMachineReadable('raw')).toBe(true);
    expect(isMachineReadable('pretty')).toBe(true);
    expect(isMachineReadable('csv')).toBe(true);
  });

  it('test_isMachineReadable_table_shouldBeFalse', () => {
    expect(isMachineReadable('table')).toBe(false);
  });
});

describe('parseFieldsArg', () => {
  it('test_parseFieldsArg_commaSeparated_shouldReturnOrderedPaths', () => {
    expect(parseFieldsArg('id,name,state')).toEqual(['id', 'name', 'state']);
  });

  it('test_parseFieldsArg_paddedAndEmptySegments_shouldBeTrimmed', () => {
    expect(parseFieldsArg(' id , , name ')).toEqual(['id', 'name']);
  });

  it('test_parseFieldsArg_duplicates_shouldBeRemovedKeepingFirstOrder', () => {
    expect(parseFieldsArg('id,name,id')).toEqual(['id', 'name']);
  });

  it('test_parseFieldsArg_noUsableSegments_shouldThrow', () => {
    expect(() => parseFieldsArg(',,')).toThrow('expected a comma-separated list of field paths');
  });
});

describe('projectFields', () => {
  const rows = [
    { id: '1', name: 'a', state: 'RUNNING', jobGraph: { vertices: [{ type: 'source' }] } },
    { id: '2', name: 'b', state: 'FAILED', jobGraph: { vertices: [] } }
  ];

  it('test_projectFields_topLevelPaths_shouldKeepOnlyRequested', () => {
    expect(projectFields(rows, ['id', 'state'])).toEqual([
      { id: '1', state: 'RUNNING' },
      { id: '2', state: 'FAILED' }
    ]);
  });

  it('test_projectFields_requestedOrder_shouldBePreserved', () => {
    expect(Object.keys(projectFields(rows, ['state', 'id'])[0] ?? {})).toEqual(['state', 'id']);
  });

  it('test_projectFields_dottedPath_shouldReadNestedValue', () => {
    expect(projectFields(rows, ['jobGraph.vertices'])).toEqual([
      { 'jobGraph.vertices': [{ type: 'source' }] },
      { 'jobGraph.vertices': [] }
    ]);
  });

  it('test_projectFields_missingPath_shouldOmitTheKey', () => {
    expect(projectFields(rows, ['id', 'nope', 'jobGraph.missing.deep'])).toEqual([
      { id: '1' },
      { id: '2' }
    ]);
  });

  it('test_projectFields_falsyValues_shouldBeKept', () => {
    const falsyRows = [{ id: '', count: 0, enabled: false, missing: null }];
    expect(projectFields(falsyRows, ['id', 'count', 'enabled', 'missing'])).toEqual([
      { id: '', count: 0, enabled: false, missing: null }
    ]);
  });
});

describe('human output routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function route(log: (format: string, message: string) => void, format: string): { stdout: number; stderr: number } {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    log(format, 'status');
    const calls = { stdout: stdout.mock.calls.length, stderr: stderr.mock.calls.length };
    vi.restoreAllMocks();
    return calls;
  }

  it('test_logHumanSummary_perFormat_shouldPrintOnlyForTable', () => {
    expect(route(logHumanSummary, 'table')).toEqual({ stdout: 1, stderr: 0 });
    for (const format of ['pretty', 'compact', 'raw', 'csv']) {
      expect(route(logHumanSummary, format)).toEqual({ stdout: 0, stderr: 0 });
    }
  });

  it('test_logHumanFooter_perFormat_shouldUseStdoutOnlyForTable', () => {
    expect(route(logHumanFooter, 'table')).toEqual({ stdout: 1, stderr: 0 });
    for (const format of ['pretty', 'compact', 'raw', 'csv']) {
      expect(route(logHumanFooter, format)).toEqual({ stdout: 0, stderr: 1 });
    }
  });
});
