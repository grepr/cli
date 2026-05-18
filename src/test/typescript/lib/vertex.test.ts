/**
 * Tests for the Vertex class used in job graph manipulation.
 *
 * The Vertex class represents a node in a job graph with bidirectional
 * connections to previous (prev) and next vertices. Each connection is
 * identified by a port name (input/output) on this vertex.
 */

import { describe, it, expect } from 'vitest';
import { Vertex, IO, DEFAULT_INPUT, DEFAULT_OUTPUT } from '@/types.js';
import { SchemaOperation, LogsFilterType, DatadogQueryPredicateType, DatadogLogAgentSourceType, DatadogLogSinkType } from '@/openapi/openApiTypes.js';

/**
 * Helper function to create a simple filter operation.
 */
function createFilterOp(name: string): SchemaOperation {
  return {
    type: LogsFilterType.logs_filter,
    name,
    predicate: {
      type: DatadogQueryPredicateType.datadog_query,
      query: 'status:error'
    }
  };
}

/**
 * Helper function to create a source operation.
 */
function createSourceOp(name: string): SchemaOperation {
  return {
    type: DatadogLogAgentSourceType.datadog_log_agent_source,
    name,
    integrationId: 'integration_123'
  };
}

/**
 * Helper function to create a sink operation.
 */
function createSinkOp(name: string): SchemaOperation {
  return {
    type: DatadogLogSinkType.datadog_log_sink,
    name,
    integrationId: 'integration_123'
  };
}

describe('Vertex', () => {
  describe('constructor', () => {
    it('test_constructor_withOperation_shouldSetNameAndOperation', () => {
      // Given: An operation
      const operation = createFilterOp('my_filter');

      // When: Create a vertex
      const vertex = new Vertex(operation);

      // Then: Name and operation should be set correctly
      const expectedVertex = {
        name: 'my_filter',
        operation,
        prev: new Map<string, IO[]>(),
        next: new Map<string, IO[]>()
      };
      expect(vertex.name, 'Vertex name should match operation name').toBe(expectedVertex.name);
      expect(vertex.operation, 'Vertex operation should be the same object').toBe(operation);
      expect(vertex.prev.size, 'Prev map should be empty').toBe(0);
      expect(vertex.next.size, 'Next map should be empty').toBe(0);
    });

    it('test_constructor_withoutName_shouldSetEmptyString', () => {
      // Given: An operation without a name
      const operation = { type: LogsFilterType.logs_filter } as SchemaOperation;

      // When: Create a vertex
      const vertex = new Vertex(operation);

      // Then: Name should be empty string
      expect(vertex.name, 'Vertex name should be empty string when operation has no name').toBe('');
    });
  });

  describe('addNext', () => {
    it('test_addNext_singleConnection_shouldAddToNextMap', () => {
      // Given: Two vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Add next connection
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex });

      // Then: Connection should be in next map of source
      expect(sourceVertex.next.has(DEFAULT_OUTPUT), 'Source should have output port').toBe(true);
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) ?? [];
      expect(nextIos.length, 'Should have one connection').toBe(1);
      expect(nextIos[0]?.name, 'Connection input port should be input').toBe(DEFAULT_INPUT);
      expect(nextIos[0]?.vertex, 'Connection vertex should be filter').toBe(filterVertex);

      // And: Connection should be in prev map of filter (bidirectional)
      expect(filterVertex.prev.has(DEFAULT_INPUT), 'Filter should have input port').toBe(true);
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) ?? [];
      expect(prevIos.length, 'Should have one connection').toBe(1);
      expect(prevIos[0]?.name, 'Connection output port should be output').toBe(DEFAULT_OUTPUT);
      expect(prevIos[0]?.vertex, 'Connection vertex should be source').toBe(sourceVertex);
    });

    it('test_addNext_multipleConnections_shouldAddAllToNextMap', () => {
      // Given: One source and two targets
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filter1 = new Vertex(createFilterOp('filter1'));
      const filter2 = new Vertex(createFilterOp('filter2'));

      // When: Add multiple connections from same output port
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter1 });
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter2 });

      // Then: Both connections should be in next map
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) || [];
      expect(nextIos.length, 'Should have two connections').toBe(2);
      expect(nextIos.map(io => io.vertex.name).sort(), 'Should contain both filters')
        .toEqual(['filter1', 'filter2']);

      // And: Both filters should have source in prev
      expect(filter1.prev.get(DEFAULT_INPUT)?.length, 'Filter1 should have one prev').toBe(1);
      expect(filter2.prev.get(DEFAULT_INPUT)?.length, 'Filter2 should have one prev').toBe(1);
    });

    it('test_addNext_differentOutputPorts_shouldCreateSeparateEntries', () => {
      // Given: One source and two targets with different ports
      const branchVertex = new Vertex(createFilterOp('branch'));
      const filter1 = new Vertex(createFilterOp('filter1'));
      const filter2 = new Vertex(createFilterOp('filter2'));

      // When: Add connections to different output ports
      branchVertex.addNext('output', { name: DEFAULT_INPUT, vertex: filter1 });
      branchVertex.addNext('else', { name: DEFAULT_INPUT, vertex: filter2 });

      // Then: Each port should have its own connection
      expect(branchVertex.next.has('output'), 'Should have output port').toBe(true);
      expect(branchVertex.next.has('else'), 'Should have else port').toBe(true);
      expect(branchVertex.next.get('output')?.length, 'Output port should have one connection').toBe(1);
      expect(branchVertex.next.get('else')?.length, 'Else port should have one connection').toBe(1);
    });

    it('test_addNext_withAddToNextFalse_shouldNotAddBidirectional', () => {
      // Given: Two vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Add next with addToNext=false
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex }, false);

      // Then: Connection should be in next map of source
      expect(sourceVertex.next.has(DEFAULT_OUTPUT), 'Source should have output port').toBe(true);

      // But: Filter's prev should be empty (no bidirectional update)
      expect(filterVertex.prev.size, 'Filter prev should be empty').toBe(0);
    });
  });

  describe('addPrev', () => {
    it('test_addPrev_singleConnection_shouldAddToPrevMap', () => {
      // Given: Two vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Add prev connection
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex });

      // Then: Connection should be in prev map of filter
      expect(filterVertex.prev.has(DEFAULT_INPUT), 'Filter should have input port').toBe(true);
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) ?? [];
      expect(prevIos.length, 'Should have one connection').toBe(1);
      expect(prevIos[0]?.name, 'Connection output port should be output').toBe(DEFAULT_OUTPUT);
      expect(prevIos[0]?.vertex, 'Connection vertex should be source').toBe(sourceVertex);

      // And: Connection should be in next map of source (bidirectional)
      expect(sourceVertex.next.has(DEFAULT_OUTPUT), 'Source should have output port').toBe(true);
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) ?? [];
      expect(nextIos.length, 'Should have one connection').toBe(1);
      expect(nextIos[0]?.vertex, 'Connection vertex should be filter').toBe(filterVertex);
    });

    it('test_addPrev_multipleConnections_shouldAddAllToPrevMap', () => {
      // Given: Two sources and one target (merge scenario)
      const source1 = new Vertex(createSourceOp('source1'));
      const source2 = new Vertex(createSourceOp('source2'));
      const mergeVertex = new Vertex(createFilterOp('merge'));

      // When: Add multiple connections to same input port
      mergeVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: source1 });
      mergeVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: source2 });

      // Then: Both connections should be in prev map
      const prevIos = mergeVertex.prev.get(DEFAULT_INPUT) || [];
      expect(prevIos.length, 'Should have two connections').toBe(2);
      expect(prevIos.map(io => io.vertex.name).sort(), 'Should contain both sources')
        .toEqual(['source1', 'source2']);
    });

    it('test_addPrev_withAddToPrevFalse_shouldNotAddBidirectional', () => {
      // Given: Two vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Add prev with addToPrev=false
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex }, false);

      // Then: Connection should be in prev map of filter
      expect(filterVertex.prev.has(DEFAULT_INPUT), 'Filter should have input port').toBe(true);

      // But: Source's next should be empty (no bidirectional update)
      expect(sourceVertex.next.size, 'Source next should be empty').toBe(0);
    });
  });

  describe('removeNext', () => {
    it('test_removeNext_existingConnection_shouldRemoveFromBothVertices', () => {
      // Given: Connected vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex });

      // When: Remove the connection
      sourceVertex.removeNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex });

      // Then: Connection should be removed from source's next
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) || [];
      expect(nextIos.length, 'Source should have no connections').toBe(0);

      // And: Connection should be removed from filter's prev (bidirectional)
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) || [];
      expect(prevIos.length, 'Filter should have no connections').toBe(0);
    });

    it('test_removeNext_nonExistentPort_shouldDoNothing', () => {
      // Given: Vertex without connections
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Try to remove non-existent connection
      sourceVertex.removeNext('nonexistent', { name: DEFAULT_INPUT, vertex: filterVertex });

      // Then: No error should occur and maps should remain unchanged
      expect(sourceVertex.next.size, 'Next map should remain empty').toBe(0);
    });

    it('test_removeNext_oneOfMultiple_shouldOnlyRemoveSpecified', () => {
      // Given: Source connected to two filters
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filter1 = new Vertex(createFilterOp('filter1'));
      const filter2 = new Vertex(createFilterOp('filter2'));
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter1 });
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter2 });

      // When: Remove only filter1
      sourceVertex.removeNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter1 });

      // Then: Only filter2 should remain
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) ?? [];
      expect(nextIos.length, 'Should have one connection remaining').toBe(1);
      expect(nextIos[0]?.vertex.name, 'Remaining connection should be filter2').toBe('filter2');

      // And: filter1's prev should be empty, filter2's prev should still have source
      expect(filter1.prev.get(DEFAULT_INPUT)?.length || 0, 'Filter1 should have no prev').toBe(0);
      expect(filter2.prev.get(DEFAULT_INPUT)?.length, 'Filter2 should still have prev').toBe(1);
    });

    it('test_removeNext_withRemoveFromNextFalse_shouldNotRemoveBidirectional', () => {
      // Given: Connected vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));
      sourceVertex.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex });

      // When: Remove with removeFromNext=false
      sourceVertex.removeNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filterVertex }, false);

      // Then: Connection should be removed from source's next
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) || [];
      expect(nextIos.length, 'Source should have no connections').toBe(0);

      // But: Filter's prev should still have the connection
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) || [];
      expect(prevIos.length, 'Filter should still have connection').toBe(1);
    });
  });

  describe('removePrev', () => {
    it('test_removePrev_existingConnection_shouldRemoveFromBothVertices', () => {
      // Given: Connected vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex });

      // When: Remove the connection
      filterVertex.removePrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex });

      // Then: Connection should be removed from filter's prev
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) || [];
      expect(prevIos.length, 'Filter should have no connections').toBe(0);

      // And: Connection should be removed from source's next (bidirectional)
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) || [];
      expect(nextIos.length, 'Source should have no connections').toBe(0);
    });

    it('test_removePrev_nonExistentPort_shouldDoNothing', () => {
      // Given: Vertex without connections
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));

      // When: Try to remove non-existent connection
      filterVertex.removePrev('nonexistent', { name: DEFAULT_OUTPUT, vertex: sourceVertex });

      // Then: No error should occur and maps should remain unchanged
      expect(filterVertex.prev.size, 'Prev map should remain empty').toBe(0);
    });

    it('test_removePrev_oneOfMultiple_shouldOnlyRemoveSpecified', () => {
      // Given: Filter connected from two sources (merge)
      const source1 = new Vertex(createSourceOp('source1'));
      const source2 = new Vertex(createSourceOp('source2'));
      const filterVertex = new Vertex(createFilterOp('filter'));
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: source1 });
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: source2 });

      // When: Remove only source1
      filterVertex.removePrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: source1 });

      // Then: Only source2 should remain
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) ?? [];
      expect(prevIos.length, 'Should have one connection remaining').toBe(1);
      expect(prevIos[0]?.vertex.name, 'Remaining connection should be source2').toBe('source2');

      // And: source1's next should be empty, source2's next should still have filter
      expect(source1.next.get(DEFAULT_OUTPUT)?.length || 0, 'Source1 should have no next').toBe(0);
      expect(source2.next.get(DEFAULT_OUTPUT)?.length, 'Source2 should still have next').toBe(1);
    });

    it('test_removePrev_withRemoveFromPrevFalse_shouldNotRemoveBidirectional', () => {
      // Given: Connected vertices
      const sourceVertex = new Vertex(createSourceOp('source'));
      const filterVertex = new Vertex(createFilterOp('filter'));
      filterVertex.addPrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex });

      // When: Remove with removeFromPrev=false
      filterVertex.removePrev(DEFAULT_INPUT, { name: DEFAULT_OUTPUT, vertex: sourceVertex }, false);

      // Then: Connection should be removed from filter's prev
      const prevIos = filterVertex.prev.get(DEFAULT_INPUT) || [];
      expect(prevIos.length, 'Filter should have no connections').toBe(0);

      // But: Source's next should still have the connection
      const nextIos = sourceVertex.next.get(DEFAULT_OUTPUT) || [];
      expect(nextIos.length, 'Source should still have connection').toBe(1);
    });
  });

  describe('complex graph scenarios', () => {
    it('test_complexGraph_linearPipeline_shouldMaintainCorrectConnections', () => {
      // Given: Linear pipeline source -> filter -> sink
      const source = new Vertex(createSourceOp('source'));
      const filter = new Vertex(createFilterOp('filter'));
      const sink = new Vertex(createSinkOp('sink'));

      // When: Connect the pipeline
      source.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter });
      filter.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: sink });

      // Then: Verify all connections
      // Source
      expect(source.prev.size, 'Source should have no prev').toBe(0);
      expect(source.next.get(DEFAULT_OUTPUT)?.[0]?.vertex, 'Source next should be filter').toBe(filter);

      // Filter
      expect(filter.prev.get(DEFAULT_INPUT)?.[0]?.vertex, 'Filter prev should be source').toBe(source);
      expect(filter.next.get(DEFAULT_OUTPUT)?.[0]?.vertex, 'Filter next should be sink').toBe(sink);

      // Sink
      expect(sink.prev.get(DEFAULT_INPUT)?.[0]?.vertex, 'Sink prev should be filter').toBe(filter);
      expect(sink.next.size, 'Sink should have no next').toBe(0);
    });

    it('test_complexGraph_branchingPipeline_shouldSupportMultipleOutputs', () => {
      // Given: Branching pipeline source -> branch -> (sink1, sink2)
      const source = new Vertex(createSourceOp('source'));
      const branch = new Vertex(createFilterOp('branch'));
      const sink1 = new Vertex(createSinkOp('sink1'));
      const sink2 = new Vertex(createSinkOp('sink2'));

      // When: Connect with branch having two outputs
      source.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: branch });
      branch.addNext('output', { name: DEFAULT_INPUT, vertex: sink1 });
      branch.addNext('else', { name: DEFAULT_INPUT, vertex: sink2 });

      // Then: Branch should have two output ports
      expect(branch.next.size, 'Branch should have 2 output ports').toBe(2);
      expect(branch.next.get('output')?.[0]?.vertex, 'Output port should connect to sink1').toBe(sink1);
      expect(branch.next.get('else')?.[0]?.vertex, 'Else port should connect to sink2').toBe(sink2);
    });

    it('test_complexGraph_mergingPipeline_shouldSupportMultipleInputs', () => {
      // Given: Merging pipeline (source1, source2) -> merge -> sink
      const source1 = new Vertex(createSourceOp('source1'));
      const source2 = new Vertex(createSourceOp('source2'));
      const merge = new Vertex(createFilterOp('merge'));
      const sink = new Vertex(createSinkOp('sink'));

      // When: Connect multiple sources to merge
      source1.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: merge });
      source2.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: merge });
      merge.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: sink });

      // Then: Merge should have two inputs
      const mergeInputs = merge.prev.get(DEFAULT_INPUT) || [];
      expect(mergeInputs.length, 'Merge should have 2 inputs').toBe(2);
      expect(mergeInputs.map(io => io.vertex.name).sort(), 'Should have both sources')
        .toEqual(['source1', 'source2']);
    });

    it('test_complexGraph_rewiring_shouldMaintainConsistency', () => {
      // Given: Linear pipeline source -> filter -> sink
      const source = new Vertex(createSourceOp('source'));
      const filter = new Vertex(createFilterOp('filter'));
      const oldSink = new Vertex(createSinkOp('old_sink'));
      const newSink = new Vertex(createSinkOp('new_sink'));

      source.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: filter });
      filter.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: oldSink });

      // When: Rewire filter to new sink
      filter.removeNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: oldSink });
      filter.addNext(DEFAULT_OUTPUT, { name: DEFAULT_INPUT, vertex: newSink });

      // Then: Filter should connect to new sink
      const filterNexts = filter.next.get(DEFAULT_OUTPUT) ?? [];
      expect(filterNexts.length, 'Filter should have one next').toBe(1);
      expect(filterNexts[0]?.vertex, 'Filter next should be new sink').toBe(newSink);

      // And: Old sink should be disconnected, new sink should be connected
      expect(oldSink.prev.get(DEFAULT_INPUT)?.length ?? 0, 'Old sink should have no prev').toBe(0);
      expect(newSink.prev.get(DEFAULT_INPUT)?.[0]?.vertex, 'New sink prev should be filter').toBe(filter);
    });
  });
});
