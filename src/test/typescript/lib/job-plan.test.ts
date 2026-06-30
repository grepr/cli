import { describe, it, expect, beforeEach } from 'bun:test';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {
  computeDiff,
  generatePlan,
  loadPlanFromFile,
  parsePlan,
  PLAN_SCHEMA_VERSION,
  renderDiffHuman,
} from '@/lib/job-plan.js';
import {
  SchemaReadJob,
  SchemaUpdateJob,
  LogAttributesRemapperType,
  PathsV1JobsGetParametersQueryState,
} from '@/openapi/openApiTypes.js';
import { GreprApiClient } from '@/lib/grepr-api-client.js';
import { makeTemplateJob, makeTemplateUpdate, makeJobGraphJob } from './test-fixtures.js';

describe('computeDiff', () => {
  it('test_computeDiff_identicalInputs_shouldReturnEmpty', () => {
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({});
    expect(computeDiff(cur, prop)).toEqual([]);
  });

  it('test_computeDiff_jobGraphBackend_missingProposedJobGraph_shouldThrow', () => {
    // A job-graph-backed proposed with an absent jobGraph must fail loudly rather
    // than rendering the whole pipeline as added/removed.
    const cur = makeJobGraphJob();
    const proposed = { desiredState: 'RUNNING', fromVersion: 1 } as unknown as SchemaUpdateJob;
    expect(() => computeDiff(cur, proposed)).toThrow(/proposed job has no jobGraph/);
  });

  it('test_computeDiff_jobGraphBackend_missingCurrentJobGraph_shouldThrow', () => {
    // detectBackend treats an absent jobGraph as job-graph; the guard must fire
    // before the diff renders everything as added.
    const cur = { ...makeJobGraphJob(), jobGraph: undefined } as unknown as SchemaReadJob;
    const proposed = makeTemplateUpdate({});
    expect(() => computeDiff(cur, proposed)).toThrow(/current job has no jobGraph/);
  });

  it('test_computeDiff_multipleNamelessSinks_shouldNotCollapse', () => {
    // Two sinks lacking sink.name must not collide on a single map key, or an
    // added sink would silently drop from the diff the user reviews before apply.
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({
      sinks: [
        { sink: { type: 'datadog-log-sink' } },
        { sink: { type: 'splunk-log-sink' } },
      ] as never,
    });
    const diff = computeDiff(cur, prop);
    const sinkAdds = diff.filter(d => d.kind === 'add' && d.path.startsWith('sinks['));
    expect(sinkAdds).toHaveLength(2);
    expect(new Set(sinkAdds.map(d => d.path)).size).toBe(2);
  });

  it('test_computeDiff_addedParserField_shouldEmitChangeOnParser', () => {
    const cur = makeTemplateJob({
      parsers: [
        { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper' } as never,
      ],
    }, 1);
    const prop = makeTemplateUpdate({
      parsers: [
        {
          type: LogAttributesRemapperType.log_attributes_remapper,
          name: 'log_attributes_remapper',
          messageReservedAttributes: ['message', 'msg'],
        } as never,
      ],
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.path).toBe('parsers[log_attributes_remapper].messageReservedAttributes');
    expect(diff[0]?.kind).toBe('add');
  });

  it('test_computeDiff_addedParser_shouldEmitAdd', () => {
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({
      parsers: [{ type: 'grok-parser', name: 'my_grok', patterns: [] } as never],
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.kind).toBe('add');
    expect(diff[0]?.path).toBe('parsers[my_grok]');
  });

  it('test_computeDiff_changedReducerField', () => {
    const cur = makeTemplateJob({
      reducer: { name: 'log_reducer', type: 'log-reducer', dedupThreshold: 4, delimiters: [' '], enabledMasks: [], masks: [] } as never,
    }, 1);
    const prop = makeTemplateUpdate({
      reducer: { name: 'log_reducer', type: 'log-reducer', dedupThreshold: 8, delimiters: [' '], enabledMasks: [], masks: [] } as never,
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.path).toBe('reducer.dedupThreshold');
    expect(diff[0]?.before).toBe(4);
    expect(diff[0]?.after).toBe(8);
  });

  it('test_computeDiff_setFilter', () => {
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({
      transforms: {
        preParser: {
          kind: 'condition-node',
          predicate: { type: 'datadog-query', query: 'a' },
          thenAction: { kind: 'passthrough-node' },
          elseAction: { kind: 'drop-node' },
        },
      } as never,
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.path).toBe('transforms.preParser');
    expect(diff[0]?.kind).toBe('add');
  });

  it('test_computeDiff_addedException', () => {
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({
      exceptions: [{ type: 'query-exception', predicate: { type: 'datadog-query', query: 'x' } } as never],
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.path).toBe('exceptions[0]');
  });

  it('test_computeDiff_addedSource', () => {
    const cur = makeTemplateJob({}, 1);
    const prop = makeTemplateUpdate({
      sources: [{ type: 'datadog-log-agent-source', name: 'dd', integrationId: 'i' } as never],
    });
    const diff = computeDiff(cur, prop);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.path).toBe('sources[dd]');
    expect(diff[0]?.kind).toBe('add');
  });

  it('test_computeDiff_jobGraphEdges_shouldEmitEdgeAddsAndRemoves', () => {
    const cur = {
      ...makeTemplateJob({}, 1),
      jobGraph: {
        vertices: [
          { type: 'source', name: 'a' },
          { type: 'transform', name: 'b' },
          { type: 'sink', name: 'c' },
        ],
        edges: ['a -> b', 'b -> c'],
      },
    } as unknown as SchemaReadJob;
    const prop = {
      desiredState: PathsV1JobsGetParametersQueryState.RUNNING,
      fromVersion: 1,
      jobGraph: {
        vertices: [
          { type: 'source', name: 'a' },
          { type: 'transform', name: 'b' },
          { type: 'sink', name: 'c' },
        ],
        edges: ['a -> c'],
      },
    } as unknown as SchemaUpdateJob;
    const diff = computeDiff(cur, prop);
    expect(diff.map(entry => entry.path)).toContain('edges[a -> c]');
    expect(diff.map(entry => entry.path)).toContain('edges[a -> b]');
    expect(diff.map(entry => entry.path)).toContain('edges[b -> c]');
  });
});

describe('renderDiffHuman', () => {
  it('test_renderDiffHuman_emptyDiff_shouldReturnNoChanges', () => {
    expect(renderDiffHuman([])).toBe('(no changes)');
  });

  it('test_renderDiffHuman_noColor_shouldReturnPlainSummaries', () => {
    const output = renderDiffHuman(
      [
        { kind: 'add', path: 'a', summary: '+ a' },
        { kind: 'change', path: 'b', summary: '~ b' },
        { kind: 'remove', path: 'c', summary: '- c' },
      ],
      false,
    );
    expect(output).toBe('+ a\n~ b\n- c');
  });

  it('test_renderDiffHuman_scalarChange_shouldUsePrecomputedSummary', () => {
    // Scalars: the summary already carries everything readably. We don't
    // touch it — the new structural renderer only kicks in for arrays/objects.
    const output = renderDiffHuman(
      [{ kind: 'change', path: 'reducer.dedupThreshold', before: 4, after: 8, summary: '~ reducer.dedupThreshold: 4 → 8' }],
      false,
    );
    expect(output).toBe('~ reducer.dedupThreshold: 4 → 8');
  });

  it('test_renderDiffHuman_arrayAppend_shouldRenderAddedElementOnSeparateLine', () => {
    // This is the reviewer's headline example. Before the structural
    // renderer this collapsed both whole arrays onto one line. After: a
    // path-only header followed by an indented `+ <added element>` line.
    const output = renderDiffHuman(
      [{
        kind: 'change',
        path: 'parsers[log_attributes_remapper].messageReservedAttributePaths',
        before: [['body', 'action']],
        after: [['body', 'action'], ['body', 'actiontwo']],
        summary: 'should-be-ignored-for-structural',
      }],
      false,
    );
    expect(output).toBe(
      '~ parsers[log_attributes_remapper].messageReservedAttributePaths\n' +
      '    + [1]: ["body","actiontwo"]',
    );
  });

  it('test_renderDiffHuman_arrayPrepend_shouldRenderRemovedAndAddedIndices', () => {
    // Inserts that don't align by index produce noisier output by design —
    // we walk by index, not by LCS. Documents the chosen behavior so future
    // contributors understand the tradeoff.
    const output = renderDiffHuman(
      [{
        kind: 'change',
        path: 'reducer.partitionByAttributes',
        before: ['service'],
        after: ['cluster', 'service'],
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '~ reducer.partitionByAttributes\n' +
      '    ~ [0]: "service" → "cluster"\n' +
      '    + [1]: "service"',
    );
  });

  it('test_renderDiffHuman_objectAddedField_shouldShowOnlyAddedKey', () => {
    // Object-vs-object: walk keys, only emit lines for differing leaves.
    // Unchanged keys (e.g. `delimiters`) are silent — the whole point of
    // Option A's per-leaf marking.
    const output = renderDiffHuman(
      [{
        kind: 'change',
        path: 'reducer',
        before: { dedupThreshold: 4, delimiters: [' '] },
        after: { dedupThreshold: 4, delimiters: [' '], partitionByAttributes: ['service'] },
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '~ reducer\n' +
      '    + partitionByAttributes: ["service"]',
    );
  });

  it('test_renderDiffHuman_nestedObjectChange_shouldRecurse', () => {
    const output = renderDiffHuman(
      [{
        kind: 'change',
        path: 'parsers[log_attributes_remapper]',
        before: { messageReservedAttributes: ['message'], serviceReservedAttributes: ['service'] },
        after: { messageReservedAttributes: ['message', 'msg'], serviceReservedAttributes: ['service'] },
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '~ parsers[log_attributes_remapper]\n' +
      '    ~ messageReservedAttributes:\n' +
      '      + [1]: "msg"',
    );
  });

  it('test_renderDiffHuman_addStructuralValue_shouldRenderInlineWhenShort', () => {
    // Whole-leaf add (a new exception). JSON < 80 chars inlines on one line.
    const output = renderDiffHuman(
      [{
        kind: 'add',
        path: 'exceptions[0]',
        after: { type: 'datadog-query', query: 'status:error' },
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '+ exceptions[0]\n' +
      '    + {"type":"datadog-query","query":"status:error"}',
    );
  });

  it('test_renderDiffHuman_addStructuralValue_shouldPrettyPrintWhenLong', () => {
    // JSON > 80 chars pretty-prints across multiple lines, each carrying the
    // `+` marker so a left-column scan still finds every added line. Body
    // is indented one extra level past the path's indent.
    const longQuery = 'status:error AND service:checkout AND severity:>=ERROR AND env:prod AND region:us-east-1';
    const output = renderDiffHuman(
      [{
        kind: 'add',
        path: 'exceptions[5]',
        after: { type: 'query-exception', predicate: { type: 'datadog-query', query: longQuery } },
        summary: 'ignored',
      }],
      false,
    );
    const lines = output.split('\n');
    expect(lines[0]).toBe('+ exceptions[5]');
    expect(lines[1]).toBe('    +');                              // header line, empty body suffix
    expect(lines.slice(2).every(l => l.startsWith('    +   '))).toBe(true);
    expect(output).toContain('"query"');
    expect(output).toContain(longQuery);
  });

  it('test_renderDiffHuman_removeStructuralValue_shouldUseMinusMarkers', () => {
    const output = renderDiffHuman(
      [{
        kind: 'remove',
        path: 'parsers[old_parser]',
        before: { type: 'grok-parser', name: 'old_parser', grokParsingRules: ['Rule %{INT:n}'] },
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '- parsers[old_parser]\n' +
      '    - {"type":"grok-parser","name":"old_parser","grokParsingRules":["Rule %{INT:n}"]}',
    );
  });

  it('test_renderDiffHuman_arrayElementWholeReplace_shouldShowChangeOnSameLine', () => {
    // When [i] differs and both sides are scalar (not structural), emit a
    // single `~ [i]: before → after` line. No recursion needed.
    const output = renderDiffHuman(
      [{
        kind: 'change',
        path: 'reducer.enabledMasks',
        before: ['ipport', 'uuid'],
        after: ['ipport', 'timestamp'],
        summary: 'ignored',
      }],
      false,
    );
    expect(output).toBe(
      '~ reducer.enabledMasks\n' +
      '    ~ [1]: "uuid" → "timestamp"',
    );
  });

  it('test_renderDiffHuman_mixedEntries_scalarAndStructural', () => {
    // Sanity check that we can interleave scalar-summary entries with
    // structural-renderer entries in one call.
    const output = renderDiffHuman(
      [
        { kind: 'change', path: 'reducer.dedupThreshold', before: 4, after: 8, summary: '~ reducer.dedupThreshold: 4 → 8' },
        { kind: 'change', path: 'reducer.partitionByAttributes', before: [], after: ['service'], summary: 'ignored' },
      ],
      false,
    );
    expect(output).toBe(
      '~ reducer.dedupThreshold: 4 → 8\n' +
      '~ reducer.partitionByAttributes\n' +
      '    + [0]: "service"',
    );
  });
});

describe('parsePlan / loadPlanFromFile', () => {
  let tempDir: string;

  function validPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      jobId: 'j',
      backend: 'template',
      baseVersion: 1,
      fetchedAt: '2026-01-01T00:00:00Z',
      classification: 'transform',
      patch: { operations: [] },
      current: {},
      proposed: { jobGraph: { vertices: [], edges: [] } },
      diff: [],
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-plan-'));
  });

  it('test_parsePlan_validShape_shouldReturnPlan', () => {
    const plan = parsePlan(validPlan());
    expect(plan.jobId).toBe('j');
    expect(plan.backend).toBe('template');
    expect(plan.baseVersion).toBe(1);
    expect(plan.classification).toBe('transform');
    expect(plan.patch.operations).toEqual([]);
    expect(plan.proposed.jobGraph).toEqual({ vertices: [], edges: [] });
  });

  it('test_parsePlan_wrongSchemaVersion_shouldThrow', () => {
    expect(() => parsePlan(validPlan({ schemaVersion: 99 }))).toThrow(
      /schemaVersion/,
    );
  });

  it('test_parsePlan_missingJobId_shouldThrow', () => {
    const planObj = validPlan();
    delete planObj['jobId'];
    expect(() => parsePlan(planObj)).toThrow(
      /required fields/,
    );
  });

  it('test_parsePlan_missingBackend_shouldThrow', () => {
    const planObj = validPlan();
    delete planObj['backend'];
    expect(() => parsePlan(planObj)).toThrow(
      /backend/,
    );
  });

  it('test_parsePlan_invalidBackend_shouldThrow', () => {
    expect(() => parsePlan(validPlan({ backend: 'bogus' }))).toThrow(/backend/);
  });

  it('test_parsePlan_classificationDisagreesWithPatch_shouldThrow', () => {
    // A stale/hand-edited plan can carry a classification that disagrees with
    // its patch; parsePlan recomputes and rejects the mismatch.
    expect(() => parsePlan(validPlan({
      classification: 'transform', // patch below touches a sink → should be 'sink'
      patch: { operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] },
    }))).toThrow(/classification.*disagrees/);
  });

  it('test_parsePlan_classificationMatchesPatch_shouldNotThrow', () => {
    expect(() => parsePlan(validPlan({
      classification: 'sink',
      patch: { operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] },
    }))).not.toThrow();
  });

  it('test_parsePlan_invalidCurrent_shouldThrow', () => {
    expect(() => parsePlan(validPlan({ current: null }))).toThrow(/current.*object/);
    expect(() => parsePlan(validPlan({ current: [] }))).toThrow(/current.*object/);
  });

  it('test_parsePlan_invalidProposed_shouldThrow', () => {
    expect(() => parsePlan(validPlan({ proposed: null }))).toThrow(/proposed.*jobGraph/);
    expect(() => parsePlan(validPlan({ proposed: {} }))).toThrow(/proposed.*jobGraph/);
    expect(() => parsePlan(validPlan({ proposed: { jobGraph: null } }))).toThrow(/proposed.*jobGraph/);
  });

  it('test_loadPlanFromFile_missingFile_shouldThrow', async () => {
    await expect(loadPlanFromFile(path.join(tempDir, 'nope.json'))).rejects.toThrow(/not found/);
  });

  it('test_loadPlanFromFile_validFile_shouldReturnPlan', async () => {
    const file = path.join(tempDir, 'plan.json');
    await fs.writeJson(file, validPlan());
    const plan = await loadPlanFromFile(file);
    expect(plan.jobId).toBe('j');
  });
});

describe('generatePlan', () => {
  it('test_generatePlan_buildsPlanFromUnresolvedJobAndPatch', async () => {
    const job = makeTemplateJob({
      parsers: [
        {
          type: LogAttributesRemapperType.log_attributes_remapper,
          name: 'log_attributes_remapper',
          messageReservedAttributes: ['message'],
        } as never,
      ],
    }, 11);
    const apiClient = {
      getJob: async (id: string, _v?: number, resolved?: boolean) => {
        expect(id).toBe('j');
        expect(resolved).toBe(false); // unresolved!
        return job;
      },
    } as unknown as GreprApiClient;
    const plan = await generatePlan(apiClient, 'j', {
      operations: [{ op: 'add-message-attribute', attributePath: 'newField' }],
    });
    expect(plan.baseVersion).toBe(11);
    expect(plan.classification).toBe('transform');
    expect(plan.diff).toHaveLength(1);
    expect(plan.diff[0]?.path).toBe('parsers[log_attributes_remapper].messageReservedAttributes');
    expect(plan.proposed.fromVersion).toBe(11);
  });

  it('test_generatePlan_jobNotFound_shouldThrow', async () => {
    const apiClient = { getJob: async () => undefined } as unknown as GreprApiClient;
    await expect(generatePlan(apiClient, 'nope', { operations: [] })).rejects.toThrow(/not found/);
  });
});
