import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { Command, CommanderError } from 'commander';
import { GreprQueryCLI } from '../../../src/main/typescript/grepr.js';

// A representative slice of tools/skills' grepr subcommands: exact names (query, job:get, job:list)
// plus a colon-prefix (dataset:) that must match every dataset: subcommand.
const ALLOWLIST = 'query job:get job:list dataset:';

const INCLUDED_COMMANDS = ['query', 'job:get', 'job:list', 'dataset:list', 'dataset:get'];
const EXCLUDED_COMMANDS = ['job:apply', 'job:create', 'grok:parse', 'backfill', 'docs:search'];

/**
 * The commands the program exposes: listed in help and run for real. Commands the allowlist removed
 * stay as hidden stand-ins that refuse, so they're not among these, and neither is commander's
 * implicit `help`, which it lists whenever the program has any command.
 */
function visibleCommandNames(program: Command = new GreprQueryCLI().setupCLI()): string[] {
  return program
    .createHelp()
    .visibleCommands(program)
    .map((command) => command.name())
    .filter((name) => name !== 'help');
}

/**
 * The program, with commander's exits turned into throws and its output captured. A command copies
 * these settings only when it's created, so each one gets them too.
 */
function quietProgram(): { program: Command; out: string[] } {
  const out: string[] = [];
  const program = new GreprQueryCLI().setupCLI();
  for (const command of [program, ...program.commands]) {
    command.exitOverride();
    command.configureOutput({ writeOut: (s) => out.push(s), writeErr: () => undefined });
  }
  return { program, out };
}

/** Parses the arguments and returns the CommanderError they end in. */
function failureOf(args: string[]): CommanderError {
  const { program } = quietProgram();
  try {
    program.parse(args, { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) return error;
    throw error;
  }
  throw new Error(`${args.join(' ')} parsed without failing`);
}

const AVAILABLE =
  'Available grepr commands: query, job:list, job:get, dataset:list, dataset:get, dataset:create, '
  + 'dataset:update, dataset:delete, dataset:table-config.';

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

  it('test_applyCommandAllowlist_unset_exposesAllCommandsAndAddsNoStandIns', () => {
    const program = new GreprQueryCLI().setupCLI();
    const names = visibleCommandNames(program);

    for (const command of [...INCLUDED_COMMANDS, ...EXCLUDED_COMMANDS]) {
      expect(names).toContain(command);
    }
    // Every registered command is a visible one: nothing hidden was added.
    expect(program.commands.map((command) => command.name())).toEqual(names);
  });

  it('test_applyCommandAllowlist_set_exposesOnlyAllowedCommands', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const program = new GreprQueryCLI().setupCLI();
    const names = visibleCommandNames(program);

    for (const command of INCLUDED_COMMANDS) {
      expect(names).toContain(command);
    }
    for (const command of EXCLUDED_COMMANDS) {
      expect(names).not.toContain(command);
      // Still registered, as a hidden stand-in that refuses.
      expect(program.commands.map((c) => c.name())).toContain(command);
    }
  });

  it('test_applyCommandAllowlist_bareNamespaceWithoutColon_doesNotFailOpen', () => {
    // A bare 'job' (no trailing ':') is an exact command name, NOT a namespace, so it must not
    // silently expose destructive 'job:*' commands. Only 'job:' would grant the whole namespace.
    process.env.GREPR_ALLOWED_SUBCOMMANDS = 'job';

    const names = visibleCommandNames();

    for (const command of ['job:apply', 'job:create', 'job:get', 'job:list']) {
      expect(names).not.toContain(command);
    }
  });

  it('test_applyCommandAllowlist_set_emptyExposesNoCommands', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = '';

    expect(visibleCommandNames()).toEqual([]);
  });

  it('test_applyCommandAllowlist_set_hidesExcludedCommandsFromHelp', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const help = new GreprQueryCLI().setupCLI().helpInformation();

    expect(help).toContain('query');
    for (const command of EXCLUDED_COMMANDS) {
      expect(help).not.toContain(command);
    }
  });

  it('test_applyCommandAllowlist_set_excludedCommandSaysItIsNotAvailableAndListsTheRest', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const failure = failureOf(['job:apply', 'plan.json']);

    expect(failure.code).toBe('grepr.commandUnavailable');
    expect(failure.exitCode).toBe(1);
    expect(failure.message).toBe(`error: grepr job:apply isn't available to this agent. ${AVAILABLE}`);
  });

  it('test_applyCommandAllowlist_set_excludedCommandNeverRunsTheRealOne', async () => {
    // Every real command's action starts by merging its configuration, so a stand-in that ran the
    // removed command, even after refusing, would show here.
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;
    const merge = spyOn(GreprQueryCLI.prototype, 'mergeConfiguration');
    try {
      failureOf(['job:apply', 'plan.json']);
      // Let anything the parse started asynchronously run.
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(merge).not.toHaveBeenCalled();
    } finally {
      merge.mockRestore();
    }
  });

  it('test_applyCommandAllowlist_empty_theProbesQueryCommandSaysItIsNotAvailable', () => {
    // The exact command #5354's probe run sent: with nothing allowed it used to fail as
    // "unknown option '--query'", which sent the agent chasing the CLI's syntax.
    process.env.GREPR_ALLOWED_SUBCOMMANDS = '';

    const failure = failureOf([
      'query', '--query', "tags.service = 'checkout-x'", '--start', '2026-10-19T16:00:00Z',
      '--end', '2026-10-19T18:00:00Z', '--limit', '10000', '-q', '-f', 'raw', '-o', 'logs.ndjson',
    ]);

    expect(failure.code).toBe('grepr.commandUnavailable');
    expect(failure.message).toBe(
      "error: grepr query isn't available to this agent. No grepr commands are available to it."
    );
  });

  it('test_applyCommandAllowlist_empty_queryHelpRefusesInsteadOfTheRootHelp', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = '';

    expect(failureOf(['query', '--help']).code).toBe('grepr.commandUnavailable');
  });

  it('test_applyCommandAllowlist_set_helpForAnExcludedCommandRefuses', () => {
    // commander's `help <command>` calls the command's help() directly, past its action.
    process.env.GREPR_ALLOWED_SUBCOMMANDS = 'job:get';

    const failure = failureOf(['help', 'query']);

    expect(failure.code).toBe('grepr.commandUnavailable');
    expect(failure.message).toBe(
      "error: grepr query isn't available to this agent. Available grepr commands: job:get."
    );
  });

  it('test_applyCommandAllowlist_set_helpForAnAllowedCommandShowsIt', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = 'job:get';
    const { program, out } = quietProgram();

    let failure: unknown;
    try {
      program.parse(['help', 'job:get'], { from: 'user' });
    } catch (error) {
      failure = error;
    }

    expect((failure as CommanderError).code).toBe('commander.help');
    expect(out.join('')).toContain('Usage: grepr job:get');
  });

  it('test_applyCommandAllowlist_set_excludedAliasRefusesNamingItsCommand', () => {
    // `jobs` is job:list's alias; it must not fall back to "unknown command".
    process.env.GREPR_ALLOWED_SUBCOMMANDS = 'query';

    const failure = failureOf(['jobs']);

    expect(failure.code).toBe('grepr.commandUnavailable');
    expect(failure.message).toBe(
      "error: grepr job:list isn't available to this agent. Available grepr commands: query."
    );
  });

  it('test_applyCommandAllowlist_set_aNameThatIsNoCommandStaysUnknown', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;

    const failure = failureOf(['nonsense']);

    expect(failure.code).toBe('commander.unknownCommand');
    expect(failure.message).toBe("error: unknown command 'nonsense'");
  });

  it('test_applyCommandAllowlist_set_anAllowedCommandStillParsesItsOptions', () => {
    process.env.GREPR_ALLOWED_SUBCOMMANDS = ALLOWLIST;
    const { program } = quietProgram();
    const query = program.commands.find((command) => command.name() === 'query');
    if (!query) throw new Error('query is allowed, so it must be there');
    let parsed: Record<string, unknown> | undefined;
    query.action((options: Record<string, unknown>) => {
      parsed = options;
    });

    program.parse(['query', '--query', 'service:x', '--limit', '10'], { from: 'user' });

    expect(parsed?.query).toBe('service:x');
  });
});
