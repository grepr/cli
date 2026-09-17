/** Include transport causes without recursing forever through a malformed cause chain. */
export function readErrorMessage(error: unknown, seen = new Set<unknown>()): string {
  if (!(error instanceof Error)) return String(error);
  if (seen.has(error)) return '';
  seen.add(error);
  const message = error.message || ('code' in error ? String(error.code) : error.name);
  const cause = error.cause === undefined ? '' : readErrorMessage(error.cause, seen);
  return cause ? `${message}: ${cause}` : message;
}
