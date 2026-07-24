import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GreprQueryCLI } from '../../../src/main/typescript/grepr.js';

// A representative slice of tools/skills' grepr subcommands: exact names (query, job:get, job:list)
// plus a colon-prefix (dataset:) that must match every dataset: subcommand.
const ALLOWLIST = 'query job:get job:list dataset:';

const INCLUDED_COMMANDS = ['query', 'job:get', 'job:list', 'dataset:list', 'dataset:get'];
const EXCLUDED_COMMANDS = ['job:apply', 'job:create', 'grok:parse', 'backfill', 'docs:search'];

/** Builds the CLI program and returns the names of the commands it exposes. */
function programCommandNames(): string[] {
  return new GreprQueryCLI().setupCLI().commands.map((command) => command.name());
}

describe('GREPR_ALLOWED_SUBCOMMANDS command gating', () => {
  const originalEnv = process.env.GREPR_ALLOWED_SUBCOMMANDS;

  beforeEach(() => {
    delete process.env.GREPR_ALLOWED_SUBCOMMANDS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GREPR_ALLOWED_SUBCOMMANDS;
    } else {
      process.env.GREPR_ALLOWED_SUBCOMMANDS = originalEnv;
    }
  });

  it('test_applyCommandAllowlist_unset_exposesAllCommands', () => {
    const names = programCommandNames();

    for (const command of [...INCLUDED_COMMANDS, ...EXCLUDED_COMMANDS]) {
      expect(names).toContain(command);
    }
  });

  it('test_applyCommandAllowlist_set_exposesOnlyAllowedCommands', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const names = programCommandNames();

    for (const command of INCLUDED_COMMANDS) {
      expect(names).toContain(command);
    }
    for (const command of EXCLUDED_COMMANDS) {
      expect(names).not.toContain(command);
    }
  });

  it('test_applyCommandAllowlist_bareNamespaceWithoutColon_doesNotFailOpen', () => {
    // A bare 'job' (no trailing ':') is an exact command name, NOT a namespace, so it must not
    // silently expose destructive 'job:*' commands. Only 'job:' would grant the whole namespace.
    process.env.GREPR_ALLOWED_SUBCOMMANDS = 'job';

    const names = programCommandNames();

    for (const command of ['job:apply', 'job:create', 'job:get', 'job:list']) {
      expect(names).not.toContain(command);
    }
  });

  it('test_applyCommandAllowlist_set_emptyExposesNoCommands', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = '';

    expect(programCommandNames()).toEqual([]);
  });

  it('test_applyCommandAllowlist_set_hidesExcludedCommandsFromHelp', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const help = new GreprQueryCLI().setupCLI().helpInformation();

    expect(help).toContain('query');
    for (const command of EXCLUDED_COMMANDS) {
      expect(help).not.toContain(command);
    }
  });

  it('test_applyCommandAllowlist_set_rejectsExcludedCommandOnInvocation', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const program = new GreprQueryCLI().setupCLI();
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });

    expect(() => program.parse(['job:apply', 'plan.json'], { from: 'user' })).toThrow(
      "error: unknown command 'job:apply'"
    );
  });
});
