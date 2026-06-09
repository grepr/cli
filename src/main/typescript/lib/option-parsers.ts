/**
 * Shared value-parsers for Commander option declarations.
 */
import type { AuthMethod, QueryEngine } from '../types.js';

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

/** Validate an http(s) URL option/env var so a bad value fails fast. */
export function parseUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  throw new Error(`Invalid URL: ${url}. Must start with http:// or https://`);
}

/** Parse an env URL and include the variable name in validation errors. */
export function parseEnvUrl(envVarName: string, url: string): string {
  try {
    return parseUrl(url);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`${envVarName}: ${errorMessage}`);
  }
}

/** Parse an auth method; returns undefined when unset so the caller can default. */
export function parseAuthMethod(method?: string): AuthMethod | undefined {
  if (!method) {
    return undefined;
  }
  if (method === 'oauth' || method === 'client-credentials') {
    return method;
  }

  throw new Error(`Invalid authentication method: ${method}. Must be oauth or client-credentials`);
}

/** Parse a query engine; returns undefined when unset so the caller can default. */
export function parseQueryEngine(engine?: string): QueryEngine | undefined {
  if (!engine) {
    return undefined;
  }
  if (engine === 'athena' || engine === 'flink') {
    return engine;
  }

  throw new Error(`Invalid query engine: ${engine}. Must be athena or flink`);
}
