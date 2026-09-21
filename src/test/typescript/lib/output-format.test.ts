import { describe, it, expect, afterEach, vi } from 'bun:test';
import {
  isMachineReadable,
  logHumanFooter,
  parseFieldsArg,
  parseOutputFormat,
  projectFields,
  resolveDefaultFormat
} from '../../../main/typescript/lib/output-format.js';

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
  it('test_resolveDefaultFormat_envUnset_shouldReturnCommandDefault', () => {
    setFormatEnv(undefined);
    expect(resolveDefaultFormat('table')).toBe('table');
    expect(resolveDefaultFormat('pretty')).toBe('pretty');
  });

  it('test_resolveDefaultFormat_envSet_shouldOverrideCommandDefault', () => {
    setFormatEnv('compact');
    expect(resolveDefaultFormat('table')).toBe('compact');
    expect(resolveDefaultFormat('pretty')).toBe('compact');
  });

  it('test_resolveDefaultFormat_envAlias_shouldResolve', () => {
    setFormatEnv('json');
    expect(resolveDefaultFormat('table')).toBe('compact');
  });

  it('test_resolveDefaultFormat_envEmpty_shouldReturnCommandDefault', () => {
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

describe('isMachineReadable', () => {
  it('test_isMachineReadable_streamFormats_shouldBeTrue', () => {
    expect(isMachineReadable('compact')).toBe(true);
    expect(isMachineReadable('raw')).toBe(true);
    expect(isMachineReadable('csv')).toBe(true);
  });

  it('test_isMachineReadable_humanFormats_shouldBeFalse', () => {
    expect(isMachineReadable('table')).toBe(false);
    expect(isMachineReadable('pretty')).toBe(false);
    expect(isMachineReadable(undefined)).toBe(false);
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

describe('logHumanFooter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('test_logHumanFooter_machineReadableFormat_shouldWriteToStderr', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    logHumanFooter('compact', 'Querying logs dataset 0abc');

    expect(error).toHaveBeenCalledWith('Querying logs dataset 0abc');
    expect(log).not.toHaveBeenCalled();
  });

  it('test_logHumanFooter_humanFormat_shouldWriteToStdout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    logHumanFooter('table', 'Querying logs dataset 0abc');

    expect(log).toHaveBeenCalledWith('Querying logs dataset 0abc');
    expect(error).not.toHaveBeenCalled();
  });
});
