import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { CrudCommand, CrudCommandOptions } from '../../../main/typescript/commands/crud-command.js';

class TestCrudCommand extends CrudCommand<CrudCommandOptions> {
  getCommandPrefix(): string {
    return 'test';
  }

  getResourceName(): string {
    return 'test';
  }

  async output(data: Record<string, unknown>, options: CrudCommandOptions): Promise<void> {
    await (this as unknown as {
      formatAndOutputSingle(d: Record<string, unknown>, o: CrudCommandOptions): Promise<void>;
    }).formatAndOutputSingle(data, options);
  }
}

const baseOptions: CrudCommandOptions = {
  apiBaseUrl: 'https://api.test.com',
  authMethod: 'oauth',
  orgName: 'test-org',
  authCache: true,
  browser: true,
  quiet: true
};

const resource = {
  id: '0abc',
  name: 'pipeline-1',
  state: 'RUNNING',
  jobGraph: { vertices: [{ type: 'source', name: 'src' }] }
};

describe('CrudCommand.formatAndOutputSingle', () => {
  let command: TestCrudCommand;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    command = new TestCrudCommand();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function loggedOutput(): string {
    return logSpy.mock.calls.map(call => String(call[0])).join('\n');
  }

  it('test_formatAndOutputSingle_tableFormat_shouldRenderTheRow', async () => {
    await command.output(resource, { ...baseOptions, format: 'table' });

    const output = loggedOutput();
    expect(output).toContain('| id');
    expect(output).toContain('0abc');
    expect(output).toContain('pipeline-1');
  });

  it('test_formatAndOutputSingle_compactFormat_shouldEmitOneJsonLine', async () => {
    await command.output(resource, { ...baseOptions, format: 'compact' });

    const output = loggedOutput().trim();
    expect(output.split('\n')).toHaveLength(1);
    expect(JSON.parse(output)).toEqual(resource);
  });

  it('test_formatAndOutputSingle_prettyFormat_shouldEmitIndentedJson', async () => {
    await command.output(resource, { ...baseOptions, format: 'pretty' });

    const output = loggedOutput();
    expect(JSON.parse(output)).toEqual(resource);
    expect(output).toContain('\n  ');
  });

  it('test_formatAndOutputSingle_fields_shouldKeepOnlyRequestedPaths', async () => {
    await command.output(resource, { ...baseOptions, format: 'compact', fields: ['id', 'state'] });

    expect(JSON.parse(loggedOutput().trim())).toEqual({ id: '0abc', state: 'RUNNING' });
  });

  it('test_formatAndOutputSingle_dottedField_shouldReadNestedValue', async () => {
    await command.output(resource, {
      ...baseOptions,
      format: 'compact',
      fields: ['id', 'jobGraph.vertices']
    });

    expect(JSON.parse(loggedOutput().trim())).toEqual({
      id: '0abc',
      'jobGraph.vertices': [{ type: 'source', name: 'src' }]
    });
  });
});

describe('CrudCommand success messages', () => {
  let command: TestCrudCommand;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    command = new TestCrudCommand();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const helpers = (options: CrudCommandOptions): void => {
    const c = command as unknown as {
      showCreateSuccess(r: Record<string, unknown>, o: CrudCommandOptions): void;
      showUpdateSuccess(id: string, o: CrudCommandOptions): void;
      showDeleteSuccess(id: string, o: CrudCommandOptions): void;
    };
    c.showCreateSuccess({ id: '0abc' }, options);
    c.showUpdateSuccess('0abc', options);
    c.showDeleteSuccess('0abc', options);
  };

  it('test_successMessages_machineReadableFormat_shouldGoToStderr', () => {
    // create and update print these onto the same stdout as the record that
    // follows them, so they must not land in a parsed stream.
    helpers({ ...baseOptions, quiet: false, format: 'compact' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  it('test_successMessages_humanFormat_shouldStayOnStdout', () => {
    helpers({ ...baseOptions, quiet: false, format: 'pretty' });

    expect(logSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('test_successMessages_quiet_shouldBeSilent', () => {
    helpers({ ...baseOptions, quiet: true, format: 'compact' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
