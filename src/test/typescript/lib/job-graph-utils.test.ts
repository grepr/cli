/**
 * Tests for job graph utility functions.
 *
 * These tests verify the helper functions used for job graph manipulation,
 * including vertex identification, edge parsing, and graph traversal.
 */

import { describe, expect, it } from 'bun:test'
import {
  canLimit,
  generateUUID,
  parseEdge
} from '@/lib/job-graph-utils.js'
import {
  GreprRawLogsSourceType,
  GreprRawSpanSourceType,
  GreprReducerLogSourceType,
  TrinoLlmPromptResultsSourceType,
  TrinoRawLogsSourceType,
  TrinoRawSpanSourceType,
  TrinoReducerLogSourceType,
  type SchemaOperation
} from '@/openapi/openApiTypes.js'

function vertexOfType(type: string): SchemaOperation {
  return { type, name: 'source' } as SchemaOperation;
}

describe('job-graph-utils', () => {
  describe('canLimit', () => {
    it('test_canLimit_trinoRawLogSource_returnsTrue', () => {
      expect(canLimit(vertexOfType(TrinoRawLogsSourceType.trino_raw_log_source))).toBe(true);
    });

    it('test_canLimit_trinoReducerLogSource_returnsTrue', () => {
      expect(canLimit(vertexOfType(TrinoReducerLogSourceType.trino_reducer_log_source))).toBe(true);
    });

    it('test_canLimit_trinoRawSpanSource_returnsFalse', () => {
      // Truncating a span source mid-trace produces broken traces, so Trino
      // spans must not gain a truncation behavior Athena's span source avoids.
      expect(canLimit(vertexOfType(TrinoRawSpanSourceType.trino_raw_span_source))).toBe(false);
    });

    it('test_canLimit_trinoLlmPromptResultsSource_returnsFalse', () => {
      expect(canLimit(vertexOfType(TrinoLlmPromptResultsSourceType.trino_llm_prompt_results_source))).toBe(false);
    });

    it('test_canLimit_greprRawLogSource_returnsTrue', () => {
      // The Athena counterpart of trino-raw-log-source stays limitable too.
      expect(canLimit(vertexOfType(GreprRawLogsSourceType.grepr_raw_log_source))).toBe(true);
    });

    it('test_canLimit_greprReducerLogSource_returnsTrue', () => {
      expect(canLimit(vertexOfType(GreprReducerLogSourceType.grepr_reducer_log_source))).toBe(true);
    });

    it('test_canLimit_greprRawSpanSource_returnsFalse', () => {
      // The pre-existing Athena span exclusion this ticket mirrors for Trino.
      expect(canLimit(vertexOfType(GreprRawSpanSourceType.grepr_raw_span_source))).toBe(false);
    });
  });

  describe('parseEdge', () => {
    it('test_parseEdge_simpleEdge_shouldReturnSourceAndTargetWithDefaultPorts', () => {
      const result = parseEdge('source -> target');

      expect(result).toEqual({
        sourceVertex: 'source',
        sourcePort: 'output',
        targetVertex: 'target',
        targetPort: 'input'
      });
    });

    it('test_parseEdge_edgeWithPorts_shouldReturnCorrectPorts', () => {
      const result = parseEdge('source:out1 -> target:in1');

      expect(result).toEqual({
        sourceVertex: 'source',
        sourcePort: 'out1',
        targetVertex: 'target',
        targetPort: 'in1'
      });
    });

    it('test_parseEdge_edgeWithOnlySourcePort_shouldUseDefaultTargetPort', () => {
      const result = parseEdge('source:out1 -> target');

      expect(result).toEqual({
        sourceVertex: 'source',
        sourcePort: 'out1',
        targetVertex: 'target',
        targetPort: 'input'
      });
    });

    it('test_parseEdge_edgeWithOnlyTargetPort_shouldUseDefaultSourcePort', () => {
      const result = parseEdge('source -> target:in1');

      expect(result).toEqual({
        sourceVertex: 'source',
        sourcePort: 'output',
        targetVertex: 'target',
        targetPort: 'in1'
      });
    });

    it('test_parseEdge_invalidFormat_shouldThrowError', () => {
      expect(() => parseEdge('invalid')).toThrow('Invalid edge format: invalid');
    });

    it('test_parseEdge_emptyString_shouldThrowError', () => {
      expect(() => parseEdge('')).toThrow('Invalid edge format: ');
    });

    it('test_parseEdge_tooManyArrows_shouldThrowError', () => {
      expect(() => parseEdge('a -> b -> c')).toThrow('Invalid edge format');
    });

    it('test_parseEdge_tooManyColons_shouldThrowError', () => {
      expect(() => parseEdge('source:a:b -> target')).toThrow('Invalid edge format with ports');
    });
  });

  describe('utility functions', () => {
    describe('generateUUID', () => {
      it('test_generateUUID_shouldReturnStringWithCorrectFormat', () => {
        const uuid = generateUUID();

        expect(uuid).toMatch(/^test_\d+_[a-z0-9]+$/);
      });

      it('test_generateUUID_multipleCallsShouldReturnUniqueValues', () => {
        const uuid1 = generateUUID();
        const uuid2 = generateUUID();

        expect(uuid1).not.toBe(uuid2);
      });

      it('test_generateUUID_shouldStartWithTestPrefix', () => {
        const uuid = generateUUID();

        expect(uuid).toMatch(/^test_/);
      });
    });
  });
});
