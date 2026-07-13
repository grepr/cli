import {
  AndEventPredicateType,
  DatadogQueryPredicateType,
  MessageLengthPredicateType,
  NewRelicQueryPredicateType,
  type SchemaEventPredicate,
  type SchemaMessageLengthPredicate,
  type SchemaQuery
} from '../openapi/openApiTypes.js';

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

/**
 * Build a language query predicate from the public query fields.
 */
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
 * Build a {@link SchemaMessageLengthPredicate} from optional bounds, or
 * undefined when neither bound is set.
 */
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

/**
 * Build the source-vertex query predicate by combining the language query
 * with an optional message-length filter. When length is set the result is
 * an AndEventPredicate; otherwise the bare language predicate is returned.
 * An empty language query plus a length filter collapses to the equivalent
 * length predicate alone.
 */
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
