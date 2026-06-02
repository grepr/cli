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

/**
 * Float counterpart to {@link parseIntArg} for numeric options that accept a
 * fractional value (e.g. a sub-1 messages-per-second sampler rate).
 */
export function parseFloatArg(value: string): number {
  return parseFloat(value);
}
