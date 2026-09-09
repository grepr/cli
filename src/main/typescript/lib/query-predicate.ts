import {
  AndEventPredicateType,
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogQueryPredicateType,
  NewRelicQueryPredicateType,
  NrqlQueryPredicateType,
  type SchemaEventPredicate,
  type SchemaNrqlQueryPredicate,
  type SchemaQuery,
  type SchemaTracesIcebergTableSource
} from '../openapi/openApiTypes.js';
import type { SignalDataType } from './signal-source.js';

export type LanguageQueryType =
  | DatadogQueryPredicateType.datadog_query
  | NewRelicQueryPredicateType.newrelic_query;

export interface LanguageQueryOptions {
  query?: string;
  queryType?: LanguageQueryType;
}

export interface SourcePredicateOptions extends LanguageQueryOptions {
  messageLengthMin?: number;
  messageLengthMax?: number;
}

export interface SignalPredicateOptions extends SourcePredicateOptions {
  dataType: SignalDataType;
}

export type SpanQueryFilters = Pick<
  SchemaTracesIcebergTableSource,
  | 'serviceNames'
  | 'operationNames'
  | 'traceSignatures'
  | 'traceIds'
  | 'hasError'
  | 'minDuration'
  | 'maxDuration'
  | 'isRootSpan'
>;

const TRACE_ID_PATTERN = /^[0-9a-fA-F]{32}$/;

export type BuiltSignalPredicate =
  | {
      dataType: CreateLogsBackfillJobDataType.logs;
      query: SchemaEventPredicate;
    }
  | {
      dataType: CreateSpansBackfillJobDataType.spans;
      query: SchemaQuery;
    };

export function buildLanguageQueryPredicate(options: LanguageQueryOptions): SchemaQuery {
  const query = options.query ?? '';
  switch (options.queryType ?? DatadogQueryPredicateType.datadog_query) {
    case DatadogQueryPredicateType.datadog_query:
      return {
        type: DatadogQueryPredicateType.datadog_query,
        query
      };
    case NewRelicQueryPredicateType.newrelic_query:
      return {
        type: NewRelicQueryPredicateType.newrelic_query,
        query
      };
    default:
      throw new Error(`Unsupported --query-type: ${options.queryType}`);
  }
}

/**
 * A message length is a Java `String` length on the server, so it is an `int`.
 * Bounds outside that range have exact int-range equivalents.
 */
const INT_MAX_LENGTH = 2147483647;

/**
 * The message length as NRQL reads it. `char_length(NULL)` is NULL, which would make both bound
 * comparisons unknown; the conditional is what keeps a null message reading as length zero.
 */
const MESSAGE_LENGTH = 'if(message IS NULL, 0, char_length(message))';

/**
 * The reason a message-length range is unusable, or undefined when it is fine. A negative bound is
 * not a length, and a reversed range can never match. The removed structured predicate rejected
 * both with a 400; the NRQL replacement would instead be accepted and quietly return no rows.
 */
export function messageLengthBoundsError(min?: number, max?: number): string | undefined {
  if (isBound(min) && min < 0) {
    return '--message-length-min must not be negative';
  }
  if (isBound(max) && max < 0) {
    return '--message-length-max must not be negative';
  }
  if (isBound(min) && isBound(max) && min > max) {
    return `--message-length-min (${min}) must not be greater than --message-length-max (${max})`;
  }
  return undefined;
}

/**
 * Builds the NRQL a message-length range is expressed as, or undefined when no bound constrains
 * anything. This text must stay byte-identical to what the server converts a stored
 * `message-length` predicate into.
 *
 * Bounds outside int range clamp to their exact equivalents: every message satisfies an upper
 * bound at or above INT_MAX_LENGTH, so it is dropped, and no message satisfies a lower bound above
 * it, so it becomes a bound no length can meet. Clamping would hide an unusable range, so the
 * bounds are validated first.
 *
 * @throws RangeError when messageLengthBoundsError rejects the bounds
 */
export function messageLengthNrql(min?: number, max?: number): string | undefined {
  const boundsError = messageLengthBoundsError(min, max);
  if (boundsError !== undefined) {
    throw new RangeError(boundsError);
  }
  const bounds: string[] = [];
  if (isBound(min)) {
    bounds.push(
      min > INT_MAX_LENGTH
        ? `${MESSAGE_LENGTH} > ${INT_MAX_LENGTH}`
        : `${MESSAGE_LENGTH} >= ${min}`
    );
  }
  if (isBound(max) && max < INT_MAX_LENGTH) {
    bounds.push(`${MESSAGE_LENGTH} <= ${max}`);
  }
  if (bounds.length === 0) {
    return undefined;
  }
  return `SELECT * FROM Log WHERE ${bounds.join(' AND ')}`;
}

export function buildMessageLengthPredicate(
  options: SourcePredicateOptions
): SchemaNrqlQueryPredicate | undefined {
  const query = messageLengthNrql(options.messageLengthMin, options.messageLengthMax);
  if (query === undefined) {
    return undefined;
  }
  return {
    type: NrqlQueryPredicateType.nrql_query,
    query,
    strict: true
  };
}

function isBound(value: number | undefined): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

export function buildSourcePredicate(options: SourcePredicateOptions): SchemaEventPredicate {
  const languagePredicate = buildLanguageQueryPredicate(options);
  const lengthPredicate = buildMessageLengthPredicate(options);
  if (!lengthPredicate) {
    return languagePredicate;
  }
  if ((options.query ?? '').trim() === '') {
    return lengthPredicate;
  }
  return {
    type: AndEventPredicateType.and_predicate,
    queries: [languagePredicate, lengthPredicate]
  };
}

export function buildSignalPredicate(options: SignalPredicateOptions): BuiltSignalPredicate {
  switch (options.dataType) {
    case CreateLogsBackfillJobDataType.logs:
      return {
        dataType: CreateLogsBackfillJobDataType.logs,
        query: buildSourcePredicate(options)
      };
    case CreateSpansBackfillJobDataType.spans:
      return {
        dataType: CreateSpansBackfillJobDataType.spans,
        query: buildSpanQueryPredicate(options)
      };
  }
}

export function buildSpanQueryPredicate(options: SourcePredicateOptions): SchemaQuery {
  validateSpansPredicateOptions(options);
  return buildLanguageQueryPredicate(options);
}

/**
 * Lifts the subset of Datadog span-query syntax that synchronous structured source filters can
 * represent without changing its meaning. Synchronous queries reject lossy Boolean and wildcard
 * forms instead of silently narrowing or widening the query; span backfills do not use this path.
 */
export function deriveSpanQueryFilters(query: string): SpanQueryFilters {
  rejectNegatedSpanQuery(query);
  rejectUnsupportedSpanOr(query);
  const { minDuration, maxDuration } = extractDurationRange(query);
  return {
    serviceNames: nonEmpty(extractFieldValues(query, 'serviceName')),
    operationNames: nonEmpty(extractFieldValues(query, 'operationName')),
    traceSignatures: nonEmpty(extractFieldValues(query, 'traceSignature')),
    traceIds: nonEmpty(extractFieldValues(query, 'traceId')),
    hasError: extractBoolean(query, 'hasError'),
    minDuration,
    maxDuration,
    isRootSpan: extractBoolean(query, 'root')
  };
}

/**
 * Warns synchronous-query users when structured filters cannot represent the complete predicate.
 * The raw predicate remains on synchronous span sources, so this path does not need to fail.
 */
export function warnOnUnliftedSpanQuery(query: string): void {
  if (!hasUnliftedSpanQuery(query)) {
    return;
  }

  console.warn(
    '[WARNING] The span query contains clauses that the current structured span filters cannot ' +
    `apply and may read more spans than expected: ${query}`
  );
}

function hasUnliftedSpanQuery(query: string): boolean {
  if (!query.trim()) {
    return false;
  }
  const supportedTermPattern = new RegExp(
    [
      '(?:^|[\\s(])(?:serviceName|operationName|traceSignature|traceId):' +
        '(?:\\([^)]*\\)|"[^"]+"|[^\\s")]+)',
      '(?:^|[\\s(])(?:hasError|root):(true|false)\\b',
      '(?:^|[\\s(])durationNanos:\\s*(?:>=|>|<=|<)\\s*\\d+'
    ].join('|'),
    'gi'
  );
  const unlifted = query
    .replace(supportedTermPattern, ' ')
    .replace(/\bAND\b/gi, ' ')
    .replace(/[()\s]+/g, '');
  return Boolean(unlifted);
}

function validateSpansPredicateOptions(options: SourcePredicateOptions): void {
  if (
    options.queryType !== undefined &&
    options.queryType !== DatadogQueryPredicateType.datadog_query
  ) {
    throw new Error('Spans only support --query-type datadog-query');
  }
  if (options.messageLengthMin !== undefined || options.messageLengthMax !== undefined) {
    throw new Error('--message-length-min and --message-length-max only apply to logs');
  }
}

function extractFieldValues(query: string, field: string): string[] {
  if (!query) {
    return [];
  }
  const pattern = new RegExp(
    `(?:^|[\\s(])${field}:(?:\\(([^)]*)\\)|"([^"]*)"|([^\\s")]+))`,
    'gi'
  );
  const terms: string[][] = [];
  for (const match of query.matchAll(pattern)) {
    const group = match[1];
    if (group !== undefined) {
      terms.push(parseSpanFacetGroup(field, group));
    } else if (match[2]) {
      terms.push([match[2]]);
    } else if (match[3]) {
      terms.push([match[3]]);
    }
  }

  if (terms.length > 1) {
    const firstValue = terms[0]?.[0];
    const repeatedIdenticalValue = firstValue !== undefined &&
      terms.every(values => values.length === 1 && values[0] === firstValue);
    if (!repeatedIdenticalValue) {
      throw new Error(
        `Span queries require multiple ${field} values in one parenthesized OR group`
      );
    }
  }

  const values = terms.flat();
  if (field !== 'traceSignature' && values.some(value => value.includes('*'))) {
    throw new Error(`Span queries do not support wildcards for ${field}`);
  }
  if (field === 'traceId' && values.some(value => !TRACE_ID_PATTERN.test(value))) {
    throw new Error('Span query traceId values must be 32-character hexadecimal strings');
  }
  return [...new Set(values)];
}

function parseSpanFacetGroup(field: string, group: string): string[] {
  const values = group.split(/\s+OR\s+/i).map(value => value.trim());
  if (values.length === 0 || values.some(value => value.length === 0)) {
    throw new Error(`Span query ${field} OR groups must contain non-empty values`);
  }
  return values.map(value => {
    const quoted = /^"([^"]+)"$/.exec(value)?.[1];
    if (quoted !== undefined) {
      return quoted;
    }
    if (!/^[^\s()":]+$/.test(value)) {
      throw new Error(
        `Span query ${field} OR groups may contain only values separated by OR`
      );
    }
    return value;
  });
}

function rejectUnsupportedSpanOr(query: string): void {
  const withFacetGroupOrMasked = query.replace(
    /(^|[\s(])(serviceName|operationName|traceSignature|traceId):\(([^)]*)\)/gi,
    (match, _prefix: string, field: string, group: string) => {
      parseSpanFacetGroup(field, group);
      return match.replace(/\bOR\b/gi, '__SPAN_FACET_OR__');
    }
  );
  const unquotedQuery = withFacetGroupOrMasked.replace(/"[^"]*"/g, '""');
  if (/(?:^|[\s()])OR(?=$|[\s()])/i.test(unquotedQuery)) {
    throw new Error(
      'Span queries only support OR inside one parenthesized facet group, such as ' +
      'serviceName:(checkout OR payments)'
    );
  }
}

function rejectNegatedSpanQuery(query: string): void {
  const unquotedQuery = query.replace(/"[^"]*"/g, '""');
  if (
    /\bNOT[\s(]+[A-Za-z_@][\w.@-]*:/i.test(unquotedQuery) ||
    /(?:^|[\s(])-[A-Za-z_@][\w.@-]*:/.test(unquotedQuery)
  ) {
    throw new Error('Span queries do not support negated facets');
  }
}

function extractBoolean(query: string, field: string): boolean | undefined {
  const pattern = new RegExp(`(?:^|[\\s(])${field}:(true|false)\\b`, 'gi');
  const values = [...query.matchAll(pattern)].map(match => match[1]?.toLowerCase());
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length > 1) {
    throw new Error(`Span queries cannot combine conflicting ${field} values`);
  }
  const value = uniqueValues[0];
  return value === undefined ? undefined : value === 'true';
}

function extractDurationRange(query: string): {
  minDuration?: number;
  maxDuration?: number;
} {
  const result: { minDuration?: number; maxDuration?: number } = {};
  for (const match of query.matchAll(
    /(?:^|[\s(])durationNanos:\s*(>=|>|<=|<)\s*(\d+)/gi
  )) {
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) {
      throw new Error('Span query duration bounds must be safe integers');
    }
    const operator = match[1];
    if (operator?.startsWith('>')) {
      const lowerBound = operator === '>' ? value + 1 : value;
      if (!Number.isSafeInteger(lowerBound)) {
        throw new Error('Span query strict lower duration bound is too large');
      }
      result.minDuration = Math.max(result.minDuration ?? lowerBound, lowerBound);
    } else {
      const upperBound = operator === '<' ? value - 1 : value;
      if (upperBound < 0) {
        throw new Error('Span query strict upper duration bound cannot be less than zero');
      }
      result.maxDuration = Math.min(result.maxDuration ?? upperBound, upperBound);
    }
  }
  if (
    result.minDuration !== undefined &&
    result.maxDuration !== undefined &&
    result.minDuration > result.maxDuration
  ) {
    throw new Error('Span query minimum duration cannot exceed maximum duration');
  }
  return result;
}

function nonEmpty<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}
