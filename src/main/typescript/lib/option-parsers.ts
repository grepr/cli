/**
 * Shared value-parsers for Commander option declarations.
 */

/**
 * Commander invokes the option `parser` as `(value, previous)`, so a bare
 * `parseInt` reference would receive the previous value as its radix and
 * silently return NaN. Use this wrapper everywhere a numeric option is
 * declared. The literal `10` is the decimal radix.
 */
export function parseIntArg(value: string): number {
  return parseInt(value, 10);
}
