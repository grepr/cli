import { describe, it, expect } from 'vitest';
import {
  buildMessageLengthPredicate,
  buildSourcePredicate
} from '../../../main/typescript/commands/query-command';
import {
  AndEventPredicateType,
  DatadogQueryPredicateType,
  MessageLengthPredicateType,
  NrqlQueryPredicateType
} from '../../../main/typescript/openapi/openApiTypes';
import type { QueryCommandOptions } from '../../../main/typescript/types';

const baseOptions: QueryCommandOptions = {
  orgName: 'test',
  authBaseUrl: 'http://auth',
  authMethod: 'oauth',
  clientId: 'cid',
  authCache: false,
  browser: false
};

describe('query-command predicate builders', () => {
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

    it('test_buildSourcePredicate_nrqlQueryWithLength_wrapsInAndPredicate', () => {
      expect(
        buildSourcePredicate({
          ...baseOptions,
          query: "SELECT * FROM Log WHERE service = 'foo'",
          queryType: NrqlQueryPredicateType.nrql_query,
          messageLengthMin: 100,
          messageLengthMax: 200
        })
      ).toEqual({
        type: AndEventPredicateType.and_predicate,
        queries: [
          {
            type: NrqlQueryPredicateType.nrql_query,
            query: "SELECT * FROM Log WHERE service = 'foo'"
          },
          {
            type: MessageLengthPredicateType.message_length,
            minLength: 100,
            maxLength: 200
          }
        ]
      });
    });
  });
});
