/**
 * Shared helpers for output-format-aware behavior.
 *
 * `compact`, `raw`, and `csv` are consumed by jq / CSV parsers, so any
 * human-readable chatter must go to stderr there to keep stdout a clean
 * data stream. `table` and `pretty` are for humans and can keep chatter
 * on stdout.
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

const MACHINE_READABLE_FORMATS: ReadonlySet<string> = new Set(['compact', 'raw', 'csv']);

export function isMachineReadable(format: string | undefined): boolean {
  return format !== undefined && MACHINE_READABLE_FORMATS.has(format);
}

/**
 * Validate an output format, resolving aliases. Throws on anything else so a
 * mistyped or invented value fails loudly instead of silently falling through
 * to an undocumented shape.
 */
export function parseOutputFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();
  const aliased = FORMAT_ALIASES[normalized];
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
 * Resolve a command's default format, letting {@link OUTPUT_FORMAT_ENV} override
 * it. An explicit `-f` flag still wins, because commander only applies this
 * value when the flag is absent.
 */
export function resolveDefaultFormat(commandDefault: OutputFormat): OutputFormat {
  const configured = process.env[OUTPUT_FORMAT_ENV];
  if (!configured) {
    return commandDefault;
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

/**
 * Log a human-readable footer / status line, routing to stderr in
 * machine-readable formats so the stdout stream stays parseable.
 */
export function logHumanFooter(format: string | undefined, message: string): void {
  if (isMachineReadable(format)) {
    console.error(message);
  } else {
    console.log(message);
  }
}
