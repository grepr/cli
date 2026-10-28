/**
 * Shared helpers for output-format-aware behavior.
 *
 * The JSON formats (`compact`, `raw`, `pretty`) and `csv` are consumed by jq /
 * CSV parsers, so stdout carries only data there and status lines go to
 * stderr. Only `table` keeps status lines and summaries on stdout.
 */

import { InvalidArgumentError } from 'commander';

export const OUTPUT_FORMATS = ['table', 'csv', 'pretty', 'raw', 'compact'] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * `json` is not a distinct format, but callers reach for it often enough that
 * rejecting it costs a round trip. It maps to `compact`, the single-line JSON
 * stream, which is what a caller asking for "json" wants.
 */
const FORMAT_ALIASES: Readonly<Record<string, OutputFormat>> = { json: 'compact' };

/** Env var that overrides every command's built-in default output format. */
export const OUTPUT_FORMAT_ENV = 'GREPR_OUTPUT_FORMAT';

/** Only `table` is for humans. Every other format is data that a parser reads. */
export function isMachineReadable(format: OutputFormat): boolean {
  return format !== 'table';
}

/**
 * Validate an output format, resolving aliases. Throws on anything else so a
 * mistyped or invented value fails loudly instead of silently falling through
 * to an undocumented shape.
 */
export function parseOutputFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();
  const aliased = Object.hasOwn(FORMAT_ALIASES, normalized) ? FORMAT_ALIASES[normalized] : undefined;
  if (aliased) {
    return aliased;
  }
  if ((OUTPUT_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as OutputFormat;
  }

  // InvalidArgumentError so commander renders this as a normal option error
  // rather than an uncaught throw with a stack trace.
  throw new InvalidArgumentError(
    `must be one of ${OUTPUT_FORMATS.join(', ')} (or json, an alias for compact)`
  );
}

/**
 * Env vars that coding agents set in the shells they run commands in. Each
 * value is not empty only in an agent run.
 */
export const AGENT_ENV_VARS = [
  'AI_AGENT',
  'CLAUDECODE',
  'CODEX_CI',
  'CODEX_THREAD_ID',
  'CURSOR_AGENT',
  'GEMINI_CLI',
  'OPENCODE'
] as const;

/** True when a coding agent runs the CLI. */
export function isAgentRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return AGENT_ENV_VARS.some(name => Boolean(env[name]));
}

/**
 * Resolve the default format of a command. The order is:
 * 1. An explicit `-f` flag. Commander uses this value only when the flag is absent.
 * 2. {@link OUTPUT_FORMAT_ENV}.
 * 3. `compact` in an agent run, because agents parse the output.
 * 4. `compact` when stdout is not a terminal, because a pipe or a file gets parsed.
 * 5. The default of the command.
 */
export function resolveDefaultFormat(commandDefault: OutputFormat): OutputFormat {
  const configured = process.env[OUTPUT_FORMAT_ENV];
  if (!configured) {
    return isAgentRun() || process.stdout.isTTY !== true ? 'compact' : commandDefault;
  }

  try {
    return parseOutputFormat(configured);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Plain Error, not InvalidArgumentError: this runs while commands are being
    // registered, where commander has no option context to attach it to.
    throw new Error(`${OUTPUT_FORMAT_ENV}: '${configured}' is invalid. It ${message}`);
  }
}

/** Parse a comma-separated `--fields` list into ordered, de-duplicated paths. */
export function parseFieldsArg(value: string): string[] {
  const fields = value
    .split(',')
    .map(field => field.trim())
    .filter(field => field.length > 0);

  if (fields.length === 0) {
    throw new InvalidArgumentError('expected a comma-separated list of field paths');
  }

  return [...new Set(fields)];
}

/**
 * Read a dot-separated path out of a record. Returns undefined when any segment
 * is missing, so an absent field is simply omitted rather than rendered as an
 * empty column.
 */
function readPath(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, row);
}

/**
 * Narrow rows to the requested field paths, keeping the caller's order. A
 * nested path is emitted under its full dotted name so the projection stays
 * flat and predictable for a downstream parser.
 */
export function projectFields(
  rows: Record<string, unknown>[],
  fields: string[]
): Record<string, unknown>[] {
  return rows.map(row => {
    const projected: Record<string, unknown> = {};
    fields.forEach(field => {
      const value = readPath(row, field);
      if (value !== undefined) {
        projected[field] = value;
      }
    });
    return projected;
  });
}

/** Print a summary that restates the data. Only `table` prints it; the other formats get only the data. */
export function logHumanSummary(format: OutputFormat, message: string): void {
  if (!isMachineReadable(format)) {
    console.log(message);
  }
}

/**
 * Log a status line. Only `table` prints it on stdout; the JSON formats and
 * `csv` send it to stderr so that stdout stays parseable.
 */
export function logHumanFooter(format: OutputFormat, message: string): void {
  if (isMachineReadable(format)) {
    console.error(message);
  } else {
    console.log(message);
  }
}
