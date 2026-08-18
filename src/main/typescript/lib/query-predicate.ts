import {
  AndEventPredicateType,
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogQueryPredicateType,
  MessageLengthPredicateType,
  NewRelicQueryPredicateType,
  type SchemaEventPredicate,
  type SchemaGreprRawSpanSource,
  type SchemaMessageLengthPredicate,
  type SchemaQuery
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
  SchemaGreprRawSpanSource,
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

export function buildMessageLengthPredicate(
  options: SourcePredicateOptions
): SchemaMessageLengthPredicate | undefined {
  const min = options.messageLengthMin;
  const max = options.messageLengthMax;
  const minIsNumber = typeof min === 'number' && !Number.isNaN(min);
  const maxIsNumber = typeof max === 'number' && !Number.isNaN(max);
  if (!minIsNumber && !maxIsNumber) {
    return undefined;
  }
  const predicate: SchemaMessageLengthPredicate = {
    type: MessageLengthPredicateType.message_length
  };
  if (minIsNumber) {
    predicate.minLength = min;
  }
  if (maxIsNumber) {
    predicate.maxLength = max;
  }
  return predicate;
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
