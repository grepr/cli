/**
 * Shared helpers for output-format-aware behavior.
 *
 * `compact`, `raw`, and `csv` are consumed by jq / CSV parsers, so any
 * human-readable chatter must go to stderr there to keep stdout a clean
 * data stream. `table` and `pretty` are for humans and can keep chatter
 * on stdout.
 */

export type OutputFormat = 'table' | 'csv' | 'pretty' | 'raw' | 'compact';

const MACHINE_READABLE_FORMATS: ReadonlySet<string> = new Set(['compact', 'raw', 'csv']);

export function isMachineReadable(format: string | undefined): boolean {
  return format !== undefined && MACHINE_READABLE_FORMATS.has(format);
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
