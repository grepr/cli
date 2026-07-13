import { describe, it, expect } from 'bun:test';
import {
  buildLanguageQueryPredicate,
  buildMessageLengthPredicate,
  buildSourcePredicate
} from '../../../main/typescript/lib/query-predicate.js';
import {
  AndEventPredicateType,
  DatadogQueryPredicateType,
  MessageLengthPredicateType
} from '../../../main/typescript/openapi/openApiTypes.js';
import type { QueryCommandOptions } from '../../../main/typescript/types.js';

const baseOptions: QueryCommandOptions = {
  orgName: 'test',
  authBaseUrl: 'http://auth',
  authMethod: 'oauth',
  clientId: 'cid',
  authCache: false,
  browser: false
};

describe('query-command predicate builders', () => {
  describe('buildLanguageQueryPredicate', () => {
    it('test_buildLanguageQueryPredicate_defaultType_returnsDatadogPredicate', () => {
      expect(buildLanguageQueryPredicate({ query: 'service:web' })).toEqual({
        type: DatadogQueryPredicateType.datadog_query,
        query: 'service:web'
      });
    });
  });

  describe('buildMessageLengthPredicate', () => {
    it('test_buildMessageLengthPredicate_neitherBoundSet_returnsUndefined', () => {
      expect(buildMessageLengthPredicate(baseOptions)).toBeUndefined();
    });

    it('test_buildMessageLengthPredicate_NaNBounds_returnsUndefined', () => {
      expect(
        buildMessageLengthPredicate({
          ...baseOptions,
          messageLengthMin: NaN,
          messageLengthMax: NaN
        })
      ).toBeUndefined();
    });

    it('test_buildMessageLengthPredicate_minOnly_emitsMinLengthOnly', () => {
      expect(
        buildMessageLengthPredicate({ ...baseOptions, messageLengthMin: 100 })
      ).toEqual({
        type: MessageLengthPredicateType.message_length,
        minLength: 100
      });
    });

    it('test_buildMessageLengthPredicate_maxOnly_emitsMaxLengthOnly', () => {
      expect(
        buildMessageLengthPredicate({ ...baseOptions, messageLengthMax: 0 })
      ).toEqual({
        type: MessageLengthPredicateType.message_length,
        maxLength: 0
      });
    });

    it('test_buildMessageLengthPredicate_bothBounds_emitsBoth', () => {
      expect(
        buildMessageLengthPredicate({
          ...baseOptions,
          messageLengthMin: 0,
          messageLengthMax: 32768
        })
      ).toEqual({
        type: MessageLengthPredicateType.message_length,
        minLength: 0,
        maxLength: 32768
      });
    });
  });

  describe('buildSourcePredicate', () => {
    it('test_buildSourcePredicate_noLength_returnsLanguagePredicate', () => {
      expect(
        buildSourcePredicate({ ...baseOptions, query: 'service:web' })
      ).toEqual({
        type: DatadogQueryPredicateType.datadog_query,
        query: 'service:web'
      });
    });

    it('test_buildSourcePredicate_withLength_wrapsInAndPredicate', () => {
      expect(
        buildSourcePredicate({
          ...baseOptions,
          query: 'service:web',
          messageLengthMax: 200
        })
      ).toEqual({
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

    it('test_buildSourcePredicate_emptyQueryWithLength_collapsesToLengthAlone', () => {
      // Empty datadog query matches everything so the AND wrap would just
      // add noise; the length predicate alone is equivalent.
      expect(
        buildSourcePredicate({
          ...baseOptions,
          query: '',
          messageLengthMax: 0
        })
      ).toEqual({
        type: MessageLengthPredicateType.message_length,
        maxLength: 0
      });
    });

    it('test_buildSourcePredicate_whitespaceQueryWithLength_collapsesToLengthAlone', () => {
      expect(
        buildSourcePredicate({
          ...baseOptions,
          query: '   ',
          messageLengthMin: 500
        })
      ).toEqual({
        type: MessageLengthPredicateType.message_length,
        minLength: 500
      });
    });
  });
});
