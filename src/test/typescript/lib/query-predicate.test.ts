import { describe, expect, it, vi } from 'bun:test';
import {
  buildMessageLengthPredicate,
  buildSignalPredicate,
  buildSourcePredicate,
  deriveSpanQueryFilters,
  warnOnUnliftedSpanQuery
} from '../../../main/typescript/lib/query-predicate.js';
import {
  AndEventPredicateType,
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogQueryPredicateType,
  MessageLengthPredicateType,
  NewRelicQueryPredicateType
} from '../../../main/typescript/openapi/openApiTypes.js';

const spans = CreateSpansBackfillJobDataType.spans;
const logs = CreateLogsBackfillJobDataType.logs;

describe('deriveSpanQueryFilters', () => {
  it('test_deriveSpanQueryFilters_liftsEverySupportedFacet', () => {
    expect(
      deriveSpanQueryFilters(
        'serviceName:(web OR api) operationName:checkout traceSignature:"sig-1" ' +
        'traceId:0123456789abcdef0123456789abcdef hasError:true root:false ' +
        'durationNanos:>=1000 durationNanos:<5000'
      )
    ).toEqual({
      serviceNames: ['web', 'api'],
      operationNames: ['checkout'],
      traceSignatures: ['sig-1'],
      traceIds: ['0123456789abcdef0123456789abcdef'],
      hasError: true,
      isRootSpan: false,
      minDuration: 1000,
      maxDuration: 4999
    });
  });

  it('test_deriveSpanQueryFilters_returnsNoFiltersForAnEmptyQuery', () => {
    expect(deriveSpanQueryFilters('')).toEqual({
      serviceNames: undefined,
      operationNames: undefined,
      traceSignatures: undefined,
      traceIds: undefined,
      hasError: undefined,
      minDuration: undefined,
      maxDuration: undefined,
      isRootSpan: undefined
    });
  });

  it('test_deriveSpanQueryFilters_dedupesRepeatedIdenticalValues', () => {
    expect(deriveSpanQueryFilters('serviceName:web serviceName:web'))
      .toMatchObject({ serviceNames: ['web'] });
  });

  it('test_deriveSpanQueryFilters_matchesFacetNamesCaseInsensitively', () => {
    expect(deriveSpanQueryFilters('servicename:web HASERROR:true'))
      .toMatchObject({ serviceNames: ['web'], hasError: true });
  });

  it('test_deriveSpanQueryFilters_preservesStrictDurationBounds', () => {
    expect(deriveSpanQueryFilters('durationNanos:>1000')).toMatchObject({ minDuration: 1001 });
    expect(deriveSpanQueryFilters('durationNanos:>=1000')).toMatchObject({ minDuration: 1000 });
    expect(deriveSpanQueryFilters('durationNanos:<5000')).toMatchObject({ maxDuration: 4999 });
    expect(deriveSpanQueryFilters('durationNanos:<=5000')).toMatchObject({ maxDuration: 5000 });
  });

  it('test_deriveSpanQueryFilters_combinesDurationBoundsWithoutWidening', () => {
    expect(deriveSpanQueryFilters(
      'durationNanos:>=1000 AND durationNanos:>1500 AND durationNanos:<=5000'
    )).toMatchObject({ minDuration: 1501, maxDuration: 5000 });
    expect(() => deriveSpanQueryFilters(
      'durationNanos:>=5000 AND durationNanos:<5000'
    )).toThrow(/minimum duration cannot exceed maximum duration/);
  });

  it('test_deriveSpanQueryFilters_rejectsNegatedFacets', () => {
    for (const query of [
      'NOT serviceName:web',
      'NOT (serviceName:web)',
      '-serviceName:web',
      '-hasError:true',
      '-durationNanos:>=1000'
    ]) {
      expect(() => deriveSpanQueryFilters(query)).toThrow(/do not support negated facets/);
    }
  });

  it('test_deriveSpanQueryFilters_notInsideFacetValues_doesNotTreatAsNegation', () => {
    expect(deriveSpanQueryFilters('serviceName:not-found')).toMatchObject({
      serviceNames: ['not-found']
    });
    expect(deriveSpanQueryFilters('operationName:GET/not-cached')).toMatchObject({
      operationNames: ['GET/not-cached']
    });
  });

  it('test_deriveSpanQueryFilters_orInsideFacetValues_doesNotTreatAsBooleanOr', () => {
    expect(deriveSpanQueryFilters('serviceName:foo-or-bar')).toMatchObject({
      serviceNames: ['foo-or-bar']
    });
    expect(deriveSpanQueryFilters('serviceName:or')).toMatchObject({
      serviceNames: ['or']
    });
  });

  it('test_deriveSpanQueryFilters_preservesQuotedMultiWordValues', () => {
    expect(deriveSpanQueryFilters(
      'serviceName:"my service" AND operationName:"GET /users"'
    )).toMatchObject({
      serviceNames: ['my service'],
      operationNames: ['GET /users']
    });
  });

  it('test_deriveSpanQueryFilters_liftsTraceSignatureOrGroups', () => {
    expect(deriveSpanQueryFilters(
      'traceSignature:("checkout-a" OR "checkout-b")'
    )).toMatchObject({
      traceSignatures: ['checkout-a', 'checkout-b']
    });
  });

  it('test_deriveSpanQueryFilters_rejectsBooleanFormsThatChangeMeaningWhenLifted', () => {
    for (const query of [
      'serviceName:web OR operationName:checkout',
      '(serviceName:web OR operationName:checkout)',
      'serviceName:web OR serviceName:api',
      'serviceName:web AND serviceName:api',
      'hasError:true AND hasError:false'
    ]) {
      expect(() => deriveSpanQueryFilters(query)).toThrow(/Span queries/);
    }
  });

  it('test_deriveSpanQueryFilters_doesNotLiftNestedCustomAttributes', () => {
    expect(deriveSpanQueryFilters(
      '@deployment.serviceName:web AND @span.hasError:true AND @timing.durationNanos:>=1000'
    )).toEqual({
      serviceNames: undefined,
      operationNames: undefined,
      traceSignatures: undefined,
      traceIds: undefined,
      hasError: undefined,
      minDuration: undefined,
      maxDuration: undefined,
      isRootSpan: undefined
    });
  });

  it('test_deriveSpanQueryFilters_rejectsWildcardsThatStructuredFiltersTreatAsLiterals', () => {
    for (const query of [
      'serviceName:checkout-*',
      'operationName:GET*',
      'traceId:0123*'
    ]) {
      expect(() => deriveSpanQueryFilters(query)).toThrow(/do not support wildcards/);
    }
    expect(deriveSpanQueryFilters('traceSignature:checkout-*')).toMatchObject({
      traceSignatures: ['checkout-*']
    });
  });

  it('test_deriveSpanQueryFilters_rejectsMalformedTraceIds', () => {
    for (const query of [
      'traceId:0123456789abcdef',
      `traceId:${'g'.repeat(32)}`
    ]) {
      expect(() => deriveSpanQueryFilters(query)).toThrow(
        /traceId values must be 32-character hexadecimal strings/
      );
    }
  });

  it('test_warnOnUnliftedSpanQuery_warnsWithoutRejectingUnsupportedClauses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() => warnOnUnliftedSpanQuery(
        'serviceName:checkout AND @http.status_code:500'
      )).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(
        /WARNING.*may read more spans than expected/
      ));
    } finally {
      warn.mockRestore();
    }
  });

  it('test_warnOnUnliftedSpanQuery_doesNotWarnForSupportedClauses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      warnOnUnliftedSpanQuery(
        'serviceName:(checkout OR payments) AND operationName:"GET /users"'
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('test_warnOnUnliftedSpanQuery_warnsForNestedNamesThatEndInSupportedFacets', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      warnOnUnliftedSpanQuery(
        '@deployment.serviceName:web AND @span.hasError:true AND @timing.durationNanos:>=1000'
      );
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('log predicate builders', () => {
  it('test_buildMessageLengthPredicate_bothBounds_preservesZero', () => {
    expect(buildMessageLengthPredicate({
      messageLengthMin: 0,
      messageLengthMax: 32768
    })).toEqual({
      type: MessageLengthPredicateType.message_length,
      minLength: 0,
      maxLength: 32768
    });
  });

  it('test_buildSourcePredicate_nonEmptyQuery_combinesPredicates', () => {
    expect(buildSourcePredicate({
      query: 'service:web',
      messageLengthMax: 200
    })).toEqual({
      type: AndEventPredicateType.and_predicate,
      queries: [
        {
          type: DatadogQueryPredicateType.datadog_query,
          query: 'service:web'
        },
        {
          type: MessageLengthPredicateType.message_length,
          maxLength: 200
        }
      ]
    });
  });

  it('test_buildSourcePredicate_emptyQuery_returnsLengthPredicateOnly', () => {
    expect(buildSourcePredicate({
      query: '   ',
      messageLengthMin: 500
    })).toEqual({
      type: MessageLengthPredicateType.message_length,
      minLength: 500
    });
  });
});

describe('buildSignalPredicate', () => {
  it('test_buildSignalPredicate_returnsTheLogsPredicateWithoutSpanFilters', () => {
    expect(buildSignalPredicate({ dataType: logs, query: 'level:ERROR' })).toEqual({
      dataType: logs,
      query: { type: DatadogQueryPredicateType.datadog_query, query: 'level:ERROR' }
    });
  });

  it('test_buildSignalPredicate_returnsTheQueryWithoutDerivedFiltersForSpans', () => {
    expect(buildSignalPredicate({ dataType: spans, query: 'serviceName:web' })).toEqual({
      dataType: spans,
      query: { type: DatadogQueryPredicateType.datadog_query, query: 'serviceName:web' }
    });
  });

  it('test_buildSignalPredicate_rejectsNewRelicForSpans', () => {
    expect(() =>
      buildSignalPredicate({
        dataType: spans,
        queryType: NewRelicQueryPredicateType.newrelic_query,
        query: ''
      })
    ).toThrow(/Spans only support --query-type datadog-query/);
  });

  it('test_buildSignalPredicate_rejectsMessageLengthForSpans', () => {
    expect(() => buildSignalPredicate({ dataType: spans, messageLengthMin: 1 }))
      .toThrow(/only apply to logs/);
    expect(() => buildSignalPredicate({ dataType: spans, messageLengthMax: 1 }))
      .toThrow(/only apply to logs/);
  });
});
