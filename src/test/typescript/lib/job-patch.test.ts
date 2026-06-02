import { describe, it, expect } from 'vitest';
import {
  applyPatch,
  classifyPatch,
  detectBackend,
  findTemplateOperation,
  parsePatch,
  JobPatch,
  JobPatchOp,
  draftVerificationLimitations,
} from '@/lib/job-patch.js';
import {
  SchemaReadJob,
  SchemaLogReducerTemplateInput,
  LogAttributesRemapperType,
  JsonLogProcessorType,
  GrokParserType,
  LogReducerType,
  LogsFilterType,
  TemplateOperationType,
  DatadogQueryPredicateType,
  PathsV1JobsGetParametersQueryState,
} from '@/openapi/openApiTypes.js';
import {
  makeTemplateJob,
  makeJobGraphJob,
  makeUiRawJobGraphJob,
  findJobGraphVertex,
} from './test-fixtures.js';

function readInputFromUpdate(update: { jobGraph?: { vertices?: { name?: string; templateInputs?: Record<string, unknown> }[] } }): SchemaLogReducerTemplateInput {
  const vertex = update.jobGraph?.vertices?.[0];
  return (vertex?.templateInputs?.['input'] ?? {}) as SchemaLogReducerTemplateInput;
}

const remapperParser = (): Record<string, unknown> => ({
  type: LogAttributesRemapperType.log_attributes_remapper,
  name: 'log_attributes_remapper',
  messageReservedAttributes: ['message', 'msg'],
  messageReservedAttributePaths: [['body', 'message']],
});

const jsonProcessor = (): Record<string, unknown> => ({
  type: JsonLogProcessorType.json_log_processor,
  name: 'json_log_processor',
});

const grokParser = (name = 'my_grok'): Record<string, unknown> => ({
  type: GrokParserType.grok_parser,
  name,
  grokParsingRules: ['MyRule %{INT:foo}'],
});

describe('parsePatch', () => {
  it('test_parsePatch_validShape_shouldReturnPatch', () => {
    const patch = parsePatch({ operations: [{ op: 'add-message-attribute', attributePath: 'body.action' }] });
    expect(patch.operations).toHaveLength(1);
  });

  it('test_parsePatch_missingOperations_shouldThrow', () => {
    expect(() => parsePatch({})).toThrow(/operations/);
  });

  it('test_parsePatch_opMissingOpField_shouldThrow', () => {
    expect(() => parsePatch({ operations: [{ attributePath: 'x' }] })).toThrow(/string "op" field/);
  });

  it('test_parsePatch_knownOpMissingRequiredField_shouldThrowAtParseTime', () => {
    expect(() => parsePatch({ operations: [{ op: 'add-group-by' }] })).toThrow(
      /add-group-by.*"attributePath" is required and must be a string/,
    );
  });

  it('test_parsePatch_requiredFieldWrongType_shouldThrow', () => {
    expect(() => parsePatch({ operations: [{ op: 'add-aggregation-strategy', attributePath: 'x', strategies: 'sum' }] })).toThrow(
      /add-aggregation-strategy.*"strategies" is required and must be an array/,
    );
  });

  it('test_parsePatch_unknownOp_shouldThrowAtParseTime', () => {
    expect(() => parsePatch({ operations: [{ op: 'totally-fake' }] })).toThrow(/unknown op "totally-fake"/);
  });

  it('test_parsePatch_setInputFieldFalsyValue_shouldPass', () => {
    // `value: false` is a defined value and must not be rejected as missing.
    const patch = parsePatch({ operations: [{ op: 'set-input-field', path: 'a.b', value: false }] });
    expect(patch.operations).toHaveLength(1);
  });
});

describe('findTemplateOperation', () => {
  it('test_findTemplate_exactlyOne_shouldReturn', () => {
    const job = makeTemplateJob({});
    expect(findTemplateOperation(job).name).toBe('log_reducer_template');
  });

  it('test_findTemplate_none_shouldThrow', () => {
    const job = {
      ...makeTemplateJob({}),
      jobGraph: { vertices: [{ type: 'some-other-type', name: 'x' } as never], edges: [] },
    } as unknown as SchemaReadJob;
    expect(() => findTemplateOperation(job)).toThrow(/not template-backed/);
  });

  it('test_findTemplate_multiple_shouldThrow', () => {
    const job = makeTemplateJob({});
    job.jobGraph?.vertices.push({
      type: TemplateOperationType.template_operation,
      name: 'second',
      templateId: 'x',
      templateVersion: 1,
    } as never);
    expect(() => findTemplateOperation(job)).toThrow(/expected exactly 1/);
  });
});

describe('applyPatch — add-message-attribute', () => {
  it('test_addMessageAttribute_singlePart_shouldAppendFlat', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'newField' }] });
    const remapper = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(remapper['messageReservedAttributes']).toEqual(['message', 'msg', 'newField']);
  });

  it('test_addMessageAttribute_multiPart_shouldAppendToPaths', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'body.data.message' }] });
    const remapper = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(remapper['messageReservedAttributePaths']).toEqual([['body', 'message'], ['body', 'data', 'message']]);
  });

  it('test_addMessageAttribute_idempotent', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    const update = applyPatch(job, {
      operations: [
        { op: 'add-message-attribute', attributePath: 'message' },
        { op: 'add-message-attribute', attributePath: 'body.message' },
      ],
    });
    const remapper = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(remapper['messageReservedAttributes']).toEqual(['message', 'msg']);
    expect(remapper['messageReservedAttributePaths']).toEqual([['body', 'message']]);
  });

  it('test_addMessageAttribute_noRemapper_shouldThrow', () => {
    const job = makeTemplateJob({ parsers: [jsonProcessor() as never] });
    expect(() => applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'x' }] })).toThrow(
      /no log-attributes-remapper in input\.parsers/,
    );
  });

  it('test_addMessageAttribute_emptyPath_shouldThrow', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    expect(() => applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: '' }] })).toThrow(
      /must not be empty/,
    );
  });
});

describe('applyPatch — add-group-by / add-aggregation-strategy', () => {
  it('test_addGroupBy_multiPart', () => {
    const job = makeTemplateJob({});
    const update = applyPatch(job, { operations: [{ op: 'add-group-by', attributePath: 'msg.operationName' }] });
    const reducer = readInputFromUpdate(update).reducer as unknown as Record<string, unknown>;
    expect(reducer['partitionByAttributePaths']).toEqual([['msg', 'operationName']]);
  });

  it('test_addGroupBy_singlePart', () => {
    const job = makeTemplateJob({});
    const update = applyPatch(job, { operations: [{ op: 'add-group-by', attributePath: 'service' }] });
    const reducer = readInputFromUpdate(update).reducer as unknown as Record<string, unknown>;
    expect(reducer['partitionByAttributes']).toEqual(['service']);
  });

  it('test_addAggregation_multipleStrategies', () => {
    const job = makeTemplateJob({});
    const update = applyPatch(job, {
      operations: [{ op: 'add-aggregation-strategy', attributePath: 'request.duration', strategies: ['min', 'max', 'avg'] }],
    });
    const reducer = readInputFromUpdate(update).reducer as unknown as Record<string, unknown>;
    const entries = reducer['attributeMergeStrategyEntries'] as { strategy: { type: string } }[];
    expect(entries.map(e => e.strategy.type)).toEqual(['min', 'max', 'avg']);
  });

  it('test_addAggregation_emptyStrategies_shouldThrow', () => {
    const job = makeTemplateJob({});
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-aggregation-strategy', attributePath: 'x', strategies: [] }] }),
    ).toThrow(/strategies array must not be empty/);
  });
});

describe('applyPatch — add-reducer-exception', () => {
  it('test_addReducerException_appendsTemplateQueryException', () => {
    const job = makeTemplateJob({});
    const predicate = { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' };
    const update = applyPatch(job, {
      operations: [{ op: 'add-reducer-exception', predicate }],
    });
    const exceptions = readInputFromUpdate(update).exceptions as { type: string; predicate: unknown }[];
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.type).toBe('query-exception');
    expect(exceptions[0]?.predicate).toEqual(predicate);
  });

  it('test_addReducerException_idempotent', () => {
    const job = makeTemplateJob({});
    const predicate = { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' };
    const update = applyPatch(job, {
      operations: [
        { op: 'add-reducer-exception', predicate },
        { op: 'add-reducer-exception', predicate },
      ],
    });
    expect(readInputFromUpdate(update).exceptions).toHaveLength(1);
  });
});

describe('applyPatch — add-grok-rule', () => {
  it('test_addGrokRule_appendToGrokParsingRules', () => {
    const job = makeTemplateJob({ parsers: [grokParser() as never] });
    const update = applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'OtherRule %{WORD:bar}' }] });
    const grok = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(grok['grokParsingRules']).toEqual(['MyRule %{INT:foo}', 'OtherRule %{WORD:bar}']);
  });

  it('test_addGrokRule_createsGrokParsingRulesIfMissing', () => {
    // Parser exists but has no grokParsingRules field yet — handler should create it.
    const job = makeTemplateJob({
      parsers: [{ type: GrokParserType.grok_parser, name: 'empty_grok' } as never],
    });
    const update = applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'NewRule %{INT:x}' }] });
    const grok = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(grok['grokParsingRules']).toEqual(['NewRule %{INT:x}']);
  });

  it('test_addGrokRule_idempotent', () => {
    const job = makeTemplateJob({ parsers: [grokParser() as never] });
    const update = applyPatch(job, {
      operations: [
        { op: 'add-grok-rule', pattern: 'MyRule %{INT:foo}' },
        { op: 'add-grok-rule', pattern: 'MyRule %{INT:foo}' },
      ],
    });
    const grok = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(grok['grokParsingRules']).toEqual(['MyRule %{INT:foo}']);
  });

  it('test_addGrokRule_namedParser_appendsToCorrectOne', () => {
    const job = makeTemplateJob({ parsers: [grokParser('g1') as never, grokParser('g2') as never] });
    const update = applyPatch(job, {
      operations: [{ op: 'add-grok-rule', pattern: 'NewRule %{WORD:x}', parserName: 'g2' }],
    });
    const parsers = readInputFromUpdate(update).parsers as Record<string, unknown>[];
    expect(parsers[0]?.['grokParsingRules']).toEqual(['MyRule %{INT:foo}']);
    expect(parsers[1]?.['grokParsingRules']).toEqual(['MyRule %{INT:foo}', 'NewRule %{WORD:x}']);
  });

  it('test_addGrokRule_multipleParsersWithoutName_shouldThrow', () => {
    const job = makeTemplateJob({ parsers: [grokParser('g1') as never, grokParser('g2') as never] });
    expect(() => applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'NewRule %{WORD:x}' }] })).toThrow(
      /pass parserName/,
    );
  });

  it('test_addGrokRule_extractAttribute_setsParserField', () => {
    const job = makeTemplateJob({ parsers: [grokParser() as never] });
    const update = applyPatch(job, {
      operations: [{ op: 'add-grok-rule', pattern: 'NewRule %{INT:foo}', extractAttribute: 'message' }],
    });
    const grok = readInputFromUpdate(update).parsers[0] as Record<string, unknown>;
    expect(grok['extractAttribute']).toBe('message');
  });

  it('test_addGrokRule_wrongParserType_shouldThrow', () => {
    const job = makeTemplateJob({ parsers: [jsonProcessor() as never] });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'x', parserName: 'json_log_processor' }] }),
    ).toThrow(/not a grok-parser/);
  });
});

describe('applyPatch — set-input-field / unset-input-field', () => {
  it('test_setInputField_reducerDedupThreshold', () => {
    const job = makeTemplateJob({});
    const update = applyPatch(job, {
      operations: [{ op: 'set-input-field', path: 'reducer.dedupThreshold', value: 8 }],
    });
    const reducer = readInputFromUpdate(update).reducer as unknown as Record<string, unknown>;
    expect(reducer['dedupThreshold']).toBe(8);
  });

  it('test_setInputField_traversesNull_shouldThrow', () => {
    const job = makeTemplateJob({ rawSinkConfig: null as never });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'set-input-field', path: 'rawSinkConfig.foo', value: 1 }] }),
    ).toThrow(/null\/undefined intermediate/);
  });

  it('test_unsetInputField_existing_shouldRemove', () => {
    const job = makeTemplateJob({});
    (job.jobGraph?.vertices[0] as unknown as { templateInputs: { input: Record<string, unknown> } }).templateInputs.input['datasetId'] = 'ds_42';
    const update = applyPatch(job, { operations: [{ op: 'unset-input-field', path: 'datasetId' }] });
    const input = readInputFromUpdate(update) as unknown as Record<string, unknown>;
    expect(input['datasetId']).toBeUndefined();
  });
});

describe('applyPatch — add-parser / remove-parser', () => {
  it('test_addParser_newOne_shouldAppend', () => {
    const job = makeTemplateJob({ parsers: [jsonProcessor() as never] });
    const update = applyPatch(job, {
      operations: [{ op: 'add-parser', parser: grokParser('new_grok') as never }],
    });
    const parsers = readInputFromUpdate(update).parsers;
    expect(parsers.map(p => p.name)).toEqual(['json_log_processor', 'new_grok']);
  });

  it('test_addParser_duplicateName_shouldThrow', () => {
    const job = makeTemplateJob({ parsers: [jsonProcessor() as never] });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-parser', parser: jsonProcessor() as never }] }),
    ).toThrow(/already exists/);
  });

  it('test_removeParser_existing', () => {
    const job = makeTemplateJob({ parsers: [jsonProcessor() as never, grokParser('g1') as never] });
    const update = applyPatch(job, { operations: [{ op: 'remove-parser', name: 'g1' }] });
    expect(readInputFromUpdate(update).parsers.map(p => p.name)).toEqual(['json_log_processor']);
  });

  it('test_removeParser_missing_shouldThrow', () => {
    const job = makeTemplateJob({});
    expect(() => applyPatch(job, { operations: [{ op: 'remove-parser', name: 'nope' }] })).toThrow(/not found/);
  });
});

describe('applyPatch — set-filter / clear-filter', () => {
  it('test_setFilter_atPhase_shouldStoreInSlot', () => {
    const job = makeTemplateJob({});
    const filter = {
      type: LogsFilterType.logs_filter,
      name: 'spam_filter',
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: 'NOT path:/healthz' },
    };
    const update = applyPatch(job, {
      operations: [{ op: 'set-filter', phase: 'pre-parser', filter: filter as never }],
    });
    const filters = readInputFromUpdate(update).filters as unknown as Record<string, unknown>;
    expect(filters['pre-parser']).toEqual(filter);
  });

  it('test_setFilter_overwritesExisting', () => {
    const job = makeTemplateJob({
      filters: { 'pre-parser': { type: 'logs-filter', name: 'old', predicate: { type: 'datadog-query', query: 'a' } } } as never,
    });
    const update = applyPatch(job, {
      operations: [
        {
          op: 'set-filter',
          phase: 'pre-parser',
          filter: { type: 'logs-filter', name: 'new', predicate: { type: 'datadog-query', query: 'b' } } as never,
        },
      ],
    });
    const filters = readInputFromUpdate(update).filters as unknown as Record<string, { name: string }>;
    expect(filters['pre-parser']?.name).toBe('new');
  });

  it('test_setFilter_preservesExistingFilterFields', () => {
    const job = makeTemplateJob({
      filters: {
        'pre-warehouse': {
          type: 'logs-filter',
          name: 'pre_warehouse',
          predicate: { type: 'datadog-query', query: 'old' },
          inverted: false,
          maxLateEventTimestampDelta: 'PT48H',
        },
      } as never,
    });
    const update = applyPatch(job, {
      operations: [
        {
          op: 'set-filter',
          phase: 'pre-warehouse',
          filter: {
            type: 'logs-filter',
            name: 'pre_warehouse',
            predicate: { type: 'datadog-query', query: 'service:checkout' },
          } as never,
        },
      ],
    });
    const filters = readInputFromUpdate(update).filters as unknown as Record<string, Record<string, unknown>>;
    expect(filters['pre-warehouse']).toMatchObject({
      predicate: { type: 'datadog-query', query: 'service:checkout' },
      inverted: false,
      maxLateEventTimestampDelta: 'PT48H',
    });
  });

  it('test_clearFilter_phase_setsPassThroughFilter', () => {
    const job = makeTemplateJob({
      filters: {
        'pre-warehouse': {
          type: 'logs-filter',
          name: 'f',
          predicate: { type: 'datadog-query', query: 'a' },
          maxLateEventTimestampDelta: 'PT48H',
        },
      } as never,
    });
    const update = applyPatch(job, { operations: [{ op: 'clear-filter', phase: 'pre-warehouse' }] });
    const filters = readInputFromUpdate(update).filters as unknown as Record<string, Record<string, unknown>>;
    expect(filters['pre-warehouse']).toMatchObject({
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' },
      maxLateEventTimestampDelta: 'PT48H',
    });
  });
});

describe('applyPatch — add-source / remove-source', () => {
  it('test_addSource_appendsToSources', () => {
    const job = makeTemplateJob({});
    const source = { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' };
    const update = applyPatch(job, { operations: [{ op: 'add-source', source: source as never }] });
    expect(readInputFromUpdate(update).sources).toEqual([source]);
  });

  it('test_addSource_duplicateName_shouldThrow', () => {
    const job = makeTemplateJob({
      sources: [{ type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' } as never],
    });
    expect(() =>
      applyPatch(job, {
        operations: [
          { op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_2' } as never },
        ],
      }),
    ).toThrow(/already exists/);
  });

  it('test_removeSource_existing', () => {
    const job = makeTemplateJob({
      sources: [
        { type: 'datadog-log-agent-source', name: 'dd1', integrationId: 'int' } as never,
        { type: 'datadog-log-agent-source', name: 'dd2', integrationId: 'int' } as never,
      ],
    });
    const update = applyPatch(job, { operations: [{ op: 'remove-source', name: 'dd1' }] });
    expect(readInputFromUpdate(update).sources.map(s => s.name)).toEqual(['dd2']);
  });

  it('test_removeSource_onlySource_shouldThrow', () => {
    const job = makeTemplateJob({
      sources: [{ type: 'datadog-log-agent-source', name: 'dd1', integrationId: 'int' } as never],
    });
    expect(() => applyPatch(job, { operations: [{ op: 'remove-source', name: 'dd1' }] })).toThrow(
      /zero sources/,
    );
  });

  it('test_replaceSource_removeThenAdd_shouldSucceed', () => {
    const job = makeTemplateJob({
      sources: [{ type: 'datadog-log-agent-source', name: 'old_source', integrationId: 'old' } as never],
    });
    const update = applyPatch(job, {
      operations: [
        { op: 'remove-source', name: 'old_source' },
        { op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'new_source', integrationId: 'new' } as never },
      ],
    });
    expect(readInputFromUpdate(update).sources.map(s => s.name)).toEqual(['new_source']);
  });
});

describe('applyPatch — add-sink / remove-sink / set-raw-dataset (template)', () => {
  const vendorSink = (name = 'dd_sink'): Record<string, unknown> => ({ type: 'datadog-log-sink', name, integrationId: 'int_1' });
  const icebergSink = (name = 'processed'): Record<string, unknown> => ({ type: 'logs-iceberg-table-sink', name, datasetId: 'processed_ds' });
  const filter = (): Record<string, unknown> => ({ type: LogsFilterType.logs_filter, name: 'f', predicate: { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' } });

  it('test_addSink_vendor_appendsToSinks', () => {
    const update = applyPatch(makeTemplateJob({}), {
      operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never }],
    });
    const sinks = readInputFromUpdate(update).sinks ?? [];
    expect(sinks).toHaveLength(1);
    expect(sinks[0]?.sink?.name).toBe('dd_sink');
    expect((sinks[0] as { filter?: unknown }).filter).toBeUndefined();
  });

  it('test_addSink_vendor_withFilter_storesFilterOnEntry', () => {
    const update = applyPatch(makeTemplateJob({}), {
      operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never, filter: filter() as never }],
    });
    const sinks = readInputFromUpdate(update).sinks ?? [];
    expect((sinks[0] as { filter?: { predicate?: { query?: string } } }).filter?.predicate?.query).toBe('status:error');
  });

  it('test_addSink_vendor_duplicateName_shouldThrow', () => {
    const job = makeTemplateJob({ sinks: [{ sink: vendorSink() } as never] });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never }] }),
    ).toThrow(/already exists/);
  });

  it('test_addSink_vendor_unsupportedType_shouldThrow', () => {
    expect(() =>
      applyPatch(makeTemplateJob({}), {
        operations: [{ op: 'add-sink', target: 'vendor', sink: { type: 'logs-iceberg-table-sink', name: 's' } as never }],
      }),
    ).toThrow(/not supported/);
  });

  it('test_addSink_processedLogs_setsSlot', () => {
    const update = applyPatch(makeTemplateJob({}), {
      operations: [{ op: 'add-sink', target: 'processed-logs', sink: icebergSink() as never }],
    });
    expect((readInputFromUpdate(update) as { processedLogsSink?: { name?: string } }).processedLogsSink?.name).toBe('processed');
  });

  it('test_addSink_processedLogs_alreadySet_shouldThrow', () => {
    const job = makeTemplateJob({ processedLogsSink: icebergSink() as never });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-sink', target: 'processed-logs', sink: icebergSink('other') as never }] }),
    ).toThrow(/already set/);
  });

  it('test_addSink_processedLogs_wrongType_shouldThrow', () => {
    expect(() =>
      applyPatch(makeTemplateJob({}), {
        operations: [{ op: 'add-sink', target: 'processed-logs', sink: vendorSink() as never }],
      }),
    ).toThrow(/requires a logs-iceberg-table-sink/);
  });

  it('test_addSink_processedLogs_withFilter_shouldThrow', () => {
    // The split union makes this illegal combo unrepresentable in TS; the cast
    // simulates a malformed JSON patch the runtime guard must still reject.
    const illegalOp = { op: 'add-sink', target: 'processed-logs', sink: icebergSink(), filter: filter() } as unknown as JobPatchOp;
    expect(() =>
      applyPatch(makeTemplateJob({}), { operations: [illegalOp] }),
    ).toThrow(/filter is only supported for target "vendor"/);
  });

  it('test_removeSink_vendor_removesByName', () => {
    const job = makeTemplateJob({ sinks: [{ sink: vendorSink('a') } as never, { sink: vendorSink('b') } as never] });
    const update = applyPatch(job, { operations: [{ op: 'remove-sink', target: 'vendor', name: 'a' }] });
    expect((readInputFromUpdate(update).sinks ?? []).map(s => s.sink?.name)).toEqual(['b']);
  });

  it('test_removeSink_vendor_missingName_shouldThrow', () => {
    // `name` is required on the vendor variant; the cast simulates a JSON patch
    // that omits it so the runtime guard is exercised.
    const illegalOp = { op: 'remove-sink', target: 'vendor' } as unknown as JobPatchOp;
    expect(() =>
      applyPatch(makeTemplateJob({}), { operations: [illegalOp] }),
    ).toThrow(/name is required/);
  });

  it('test_removeSink_processedLogs_unsetsSlot', () => {
    const job = makeTemplateJob({ processedLogsSink: icebergSink() as never });
    const update = applyPatch(job, { operations: [{ op: 'remove-sink', target: 'processed-logs' }] });
    expect((readInputFromUpdate(update) as { processedLogsSink?: unknown }).processedLogsSink).toBeUndefined();
  });

  it('test_setRawDataset_setsInputDatasetId', () => {
    const update = applyPatch(makeTemplateJob({}), { operations: [{ op: 'set-raw-dataset', datasetId: 'new_raw_ds' }] });
    expect((readInputFromUpdate(update) as { datasetId?: string }).datasetId).toBe('new_raw_ds');
  });

  it('test_setRawDataset_syncsRawSinkConfigOverride', () => {
    // rawSinkConfig.datasetId overrides input.datasetId for the raw sink, so
    // set-raw-dataset must update it too or the raw sink keeps the old dataset.
    const job = makeTemplateJob({ datasetId: 'old_ds', rawSinkConfig: { datasetId: 'old_ds' } as never });
    const update = applyPatch(job, { operations: [{ op: 'set-raw-dataset', datasetId: 'new_raw_ds' }] });
    const input = readInputFromUpdate(update) as { datasetId?: string; rawSinkConfig?: { datasetId?: string } };
    expect(input.datasetId).toBe('new_raw_ds');
    expect(input.rawSinkConfig?.datasetId).toBe('new_raw_ds');
  });

  it('test_setRawDataset_leavesRawSinkConfigWithoutDatasetUntouched', () => {
    // rawSinkConfig present but with no datasetId override: input.datasetId applies,
    // so there is nothing to sync and no datasetId key is added.
    const job = makeTemplateJob({ datasetId: 'old_ds', rawSinkConfig: { name: 'raw_data_sink_x' } as never });
    const update = applyPatch(job, { operations: [{ op: 'set-raw-dataset', datasetId: 'new_raw_ds' }] });
    const input = readInputFromUpdate(update) as { datasetId?: string; rawSinkConfig?: { datasetId?: string; name?: string } };
    expect(input.datasetId).toBe('new_raw_ds');
    expect(input.rawSinkConfig?.datasetId).toBeUndefined();
    expect(input.rawSinkConfig?.name).toBe('raw_data_sink_x');
  });

  it('test_addSink_invalidTarget_shouldThrow', () => {
    expect(() =>
      applyPatch(makeTemplateJob({}), {
        operations: [{ op: 'add-sink', target: 'processed-log' as never, sink: icebergSink() as never }],
      }),
    ).toThrow(/target must be "vendor" or "processed-logs"/);
  });

  it('test_sinkOps_classifyAsTouchesSink', () => {
    expect(classifyPatch({ operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never }] })).toBe('sink');
    expect(classifyPatch({ operations: [{ op: 'remove-sink', target: 'processed-logs' }] })).toBe('sink');
    expect(classifyPatch({ operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] })).toBe('sink');
    expect(draftVerificationLimitations({ operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] })).toHaveLength(1);
  });
});

describe('applyPatch — input job preservation', () => {
  it('test_applyPatch_resultFromVersionMatches', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'foo' }] });
    expect(update.fromVersion).toBe(7);
  });

  it('test_applyPatch_doesNotMutateInputJob', () => {
    const job = makeTemplateJob({ parsers: [remapperParser() as never] });
    const snapshot = JSON.stringify(job);
    applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'foo' }] });
    expect(JSON.stringify(job)).toBe(snapshot);
  });

  it('test_applyPatch_forcesDraftModeOff', () => {
    const job = makeTemplateJob({});
    (job.jobGraph?.vertices[0] as unknown as { draftMode?: boolean }).draftMode = true;
    const update = applyPatch(job, { operations: [{ op: 'add-group-by', attributePath: 'service' }] });
    const vertex = update.jobGraph.vertices[0] as { draftMode?: boolean };
    expect(vertex.draftMode).toBe(false);
  });
});

describe('applyPatch — unknown op', () => {
  it('test_applyPatch_unknownOp_shouldThrow', () => {
    const job = makeTemplateJob({});
    const badPatch = { operations: [{ op: 'totally-fake' }] } as unknown as JobPatch;
    expect(() => applyPatch(job, badPatch)).toThrow(/unknown op/);
  });
});

describe('draftVerificationLimitations', () => {
  it('test_draftLimitations_transformOnlyPatch_none', () => {
    expect(
      draftVerificationLimitations({ operations: [{ op: 'add-message-attribute', attributePath: 'foo' }] }),
    ).toEqual([]);
  });

  it('test_draftLimitations_addSource_none', () => {
    expect(
      draftVerificationLimitations({
        operations: [{ op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'x', integrationId: 'i' } as never }],
      }),
    ).toEqual([]);
  });

  it('test_draftLimitations_setInputFieldOnSink_reportsLimitation', () => {
    expect(
      draftVerificationLimitations({ operations: [{ op: 'set-input-field', path: 'sinks.0.config', value: {} }] }),
    ).toEqual([expect.stringContaining('external sink delivery is not verified')]);
  });

  it('test_draftLimitations_setInputFieldOnProcessedLogsSink_reportsLimitation', () => {
    expect(
      draftVerificationLimitations({ operations: [{ op: 'set-input-field', path: 'processedLogsSink', value: {} }] }),
    ).toHaveLength(1);
  });

  it('test_draftLimitations_setInputFieldOnRawSinkConfigDatasetId_reportsLimitation', () => {
    // rawSinkConfig overrides the raw-logs iceberg sink (dataset, name,
    // partitioning). Redirecting raw-logs writes is sink-touching even though
    // the field name doesn't contain "sink" with a trailing 's'.
    expect(
      draftVerificationLimitations({ operations: [{ op: 'set-input-field', path: 'rawSinkConfig.datasetId', value: 'other_ds' }] }),
    ).toHaveLength(1);
  });

  it('test_draftLimitations_setInputFieldOnRawSinkConfigRoot_reportsLimitation', () => {
    expect(
      draftVerificationLimitations({ operations: [{ op: 'set-input-field', path: 'rawSinkConfig', value: { datasetId: 'd' } }] }),
    ).toHaveLength(1);
  });

  it('test_draftLimitations_unsetInputFieldOnRawSinkConfig_reportsLimitation', () => {
    expect(
      draftVerificationLimitations({ operations: [{ op: 'unset-input-field', path: 'rawSinkConfig' }] }),
    ).toHaveLength(1);
  });

  it('test_draftLimitations_setInputFieldOnDatasetId_reportsLimitation', () => {
    // set-input-field on datasetId is the escape-hatch equivalent of set-raw-dataset;
    // it must classify as sink-touching so draft routing is correct.
    expect(
      draftVerificationLimitations({ operations: [{ op: 'set-input-field', path: 'datasetId', value: 'new_ds' }] }),
    ).toHaveLength(1);
  });
});

describe('classifyPatch', () => {
  it('test_classify_fieldOnly_transformOnly', () => {
    expect(
      classifyPatch({
        operations: [
          { op: 'add-message-attribute', attributePath: 'foo' },
          { op: 'add-group-by', attributePath: 'bar' },
        ],
      }),
    ).toBe('transform');
  });

  it('test_classify_addSource_touchesSource', () => {
    expect(
      classifyPatch({
        operations: [{ op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'x', integrationId: 'i' } as never }],
      }),
    ).toBe('source');
  });

  it('test_classify_setInputFieldOnSink_touchesSink', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'sinks', value: [] }] }),
    ).toBe('sink');
  });

  it('test_classify_setInputFieldOnRawSinkConfig_touchesSink', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'rawSinkConfig.datasetId', value: 'other' }] }),
    ).toBe('sink');
  });

  it('test_classify_setInputFieldOnDatasetId_touchesSink', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'datasetId', value: 'new_ds' }] }),
    ).toBe('sink');
  });

  it('test_classify_mixedSourceAndSink', () => {
    expect(
      classifyPatch({
        operations: [
          { op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'x', integrationId: 'i' } as never },
          { op: 'set-input-field', path: 'sinks', value: [] },
        ],
      }),
    ).toBe('mixed');
  });

  it('test_classify_setInputFieldOnKnownTransformField_transformOnly', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'reducer.dedupThreshold', value: 8 }] }),
    ).toBe('transform');
  });

  it('test_classify_setInputFieldOnKnownSinkField_touchesSink', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'processedLogsSink.datasetId', value: 'd' }] }),
    ).toBe('sink');
  });

  it('test_classify_setInputFieldOnKnownSourceField_touchesSource', () => {
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'sources[0].name', value: 's' }] }),
    ).toBe('source');
  });

  it('test_classify_setInputFieldOnUnknownField_failsClosedToMixed', () => {
    // An input field in none of the known source/sink/transform sets must not
    // fall through to the least-gated `transform` label; it classifies `mixed`
    // so the change routes to a conservative, source-preserving draft.
    expect(
      classifyPatch({ operations: [{ op: 'set-input-field', path: 'someNewlyAddedField.nested', value: 1 }] }),
    ).toBe('mixed');
  });

  it('test_classify_unsetInputFieldOnUnknownField_failsClosedToMixed', () => {
    // unset-input-field shares the fail-closed path; cover its discriminant too.
    expect(
      classifyPatch({ operations: [{ op: 'unset-input-field', path: 'someNewlyAddedField' }] }),
    ).toBe('mixed');
  });
});

describe('detectBackend', () => {
  it('test_detectBackend_templateOpPresent_returnsTemplate', () => {
    expect(detectBackend(makeTemplateJob({}))).toBe('template');
  });

  it('test_detectBackend_noTemplateOp_returnsJobGraph', () => {
    expect(detectBackend(makeJobGraphJob())).toBe('job-graph');
  });

  it('test_detectBackend_missingVertices_returnsJobGraph', () => {
    expect(detectBackend({})).toBe('job-graph');
  });
});

describe('applyPatch (job-graph backend)', () => {
  it('test_jobGraph_addMessageAttribute_singlePart', () => {
    const job = makeJobGraphJob();
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'newField' }] });
    const remapper = findJobGraphVertex(update, 'log_attributes_remapper');
    expect(remapper['messageReservedAttributes']).toEqual(['message', 'msg', 'newField']);
  });

  it('test_jobGraph_addMessageAttribute_multiPart_appendsToPaths', () => {
    const job = makeJobGraphJob();
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'body.data.message' }] });
    const remapper = findJobGraphVertex(update, 'log_attributes_remapper');
    expect(remapper['messageReservedAttributePaths']).toEqual([['body', 'data', 'message']]);
  });

  it('test_jobGraph_addMessageAttribute_noRemapper_shouldThrow', () => {
    const job = makeJobGraphJob({
      vertices: [{ type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] }],
    });
    expect(() => applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'x' }] })).toThrow(
      /no log-attributes-remapper vertex found/,
    );
  });

  it('test_jobGraph_addGroupBy_appendsToReducerVertex', () => {
    const job = makeJobGraphJob();
    const update = applyPatch(job, { operations: [{ op: 'add-group-by', attributePath: 'msg.operationName' }] });
    const reducer = findJobGraphVertex(update, 'log_reducer');
    expect(reducer['partitionByAttributePaths']).toEqual([['msg', 'operationName']]);
  });

  it('test_jobGraph_addReducerException_appendsRawPredicate', () => {
    // Critical difference from template path: predicate goes raw into
    // logReducerExceptions, not wrapped in TemplateQueryException.
    const job = makeJobGraphJob();
    const predicate = { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' };
    const update = applyPatch(job, {
      operations: [{ op: 'add-reducer-exception', predicate }],
    });
    const reducer = findJobGraphVertex(update, 'log_reducer');
    expect(reducer['logReducerExceptions']).toEqual([predicate]);
  });

  it('test_jobGraph_addReducerException_idempotent', () => {
    const job = makeJobGraphJob();
    const predicate = { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' };
    const update = applyPatch(job, {
      operations: [
        { op: 'add-reducer-exception', predicate },
        { op: 'add-reducer-exception', predicate },
      ],
    });
    const reducer = findJobGraphVertex(update, 'log_reducer');
    expect(reducer['logReducerExceptions']).toEqual([predicate]);
  });

  it('test_jobGraph_addGrokRule_appendsToGrokParserVertex', () => {
    const job = makeJobGraphJob({
      vertices: [
        { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper' },
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: GrokParserType.grok_parser, name: 'grok', grokParsingRules: ['Existing %{INT:n}'] },
      ],
    });
    const update = applyPatch(job, {
      operations: [{ op: 'add-grok-rule', pattern: 'New %{WORD:tok}', parserName: 'grok' }],
    });
    const grok = findJobGraphVertex(update, 'grok');
    expect(grok['grokParsingRules']).toEqual(['Existing %{INT:n}', 'New %{WORD:tok}']);
  });

  it('test_jobGraph_addGrokRule_multipleParsersWithoutName_shouldThrow', () => {
    const job = makeJobGraphJob({
      vertices: [
        { type: GrokParserType.grok_parser, name: 'http_grok' },
        { type: GrokParserType.grok_parser, name: 'app_grok' },
      ],
    });
    expect(() => applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'New %{WORD:tok}' }] })).toThrow(
      /pass parserName/,
    );
  });

  it('test_jobGraph_addGrokRule_noGrokParser_shouldThrow', () => {
    const job = makeJobGraphJob();
    expect(() => applyPatch(job, { operations: [{ op: 'add-grok-rule', pattern: 'X' }] })).toThrow(
      /no grok-parser vertex found/,
    );
  });

  it('test_jobGraph_topologyOp_nonUiShape_shouldThrowUnsupportedShape', () => {
    // Topology ops are supported only for canonical UI log graphs. Arbitrary
    // raw DAG surgery remains rejected because edge intent is ambiguous.
    const job = makeJobGraphJob();
    expect(() => applyPatch(job, {
      operations: [{ op: 'set-filter', phase: 'pre-parser', filter: { type: LogsFilterType.logs_filter, name: 'f' } as never }],
    })).toThrow(/unsupported raw job graph shape/);
  });

  it('test_jobGraph_addSource_uiGraph_addsVertexAndEdge', () => {
    const job = makeUiRawJobGraphJob();
    const update = applyPatch(job, {
      operations: [{ op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' } as never }],
    });
    expect(findJobGraphVertex(update, 'dd_source')['type']).toBe('datadog-log-agent-source');
    expect(update.jobGraph.edges).toContain('dd_source -> pre_parser_filter');
  });

  it('test_jobGraph_removeSource_uiGraph_removesVertexAndEdges', () => {
    const job = makeUiRawJobGraphJob();
    const graph = job.jobGraph as { vertices: Record<string, unknown>[]; edges: string[] };
    graph.vertices.push({ type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' });
    graph.edges.push('dd_source -> pre_parser_filter');
    const update = applyPatch(job, { operations: [{ op: 'remove-source', name: 'src' }] });
    expect(update.jobGraph.vertices.some(v => v.name === 'src')).toBe(false);
    expect(update.jobGraph.edges.some(edge => edge.includes('src'))).toBe(false);
    expect(update.jobGraph.edges).toContain('dd_source -> pre_parser_filter');
  });

  it('test_jobGraph_removeSource_onlySource_shouldThrow', () => {
    const job = makeUiRawJobGraphJob();
    expect(() => applyPatch(job, { operations: [{ op: 'remove-source', name: 'src' }] })).toThrow(/zero sources/);
  });

  it('test_jobGraph_replaceSource_removeThenAdd_shouldSucceed', () => {
    const job = makeUiRawJobGraphJob();
    const update = applyPatch(job, {
      operations: [
        { op: 'remove-source', name: 'src' },
        { op: 'add-source', source: { type: 'datadog-log-agent-source', name: 'dd_source', integrationId: 'int_1' } as never },
      ],
    });
    expect(update.jobGraph.vertices.some(v => v.name === 'src')).toBe(false);
    expect(update.jobGraph.edges).toContain('dd_source -> pre_parser_filter');
  });

  it('test_jobGraph_setFilter_uiGraph_replacesCanonicalFilterVertex', () => {
    const job = makeUiRawJobGraphJob();
    const filter = {
      type: LogsFilterType.logs_filter,
      name: 'custom_name_should_not_be_used',
      predicate: { type: DatadogQueryPredicateType.datadog_query, query: 'service:checkout' },
    };
    const update = applyPatch(job, { operations: [{ op: 'set-filter', phase: 'pre-parser', filter: filter as never }] });
    const preParser = findJobGraphVertex(update, 'pre_parser_filter');
    expect(preParser['name']).toBe('pre_parser_filter');
    expect(preParser['predicate']).toEqual(filter.predicate);
  });

  it('test_jobGraph_setFilter_uiGraph_preservesExistingFilterFields', () => {
    const job = makeUiRawJobGraphJob();
    const graph = job.jobGraph as { vertices: Record<string, unknown>[] };
    const preWarehouse = graph.vertices.find(v => v.name === 'pre_data_warehouse_filter') as Record<string, unknown>;
    preWarehouse['inverted'] = false;
    preWarehouse['maxLateEventTimestampDelta'] = 'PT48H';
    const update = applyPatch(job, {
      operations: [
        {
          op: 'set-filter',
          phase: 'pre-warehouse',
          filter: {
            type: LogsFilterType.logs_filter,
            name: 'custom_name_should_not_be_used',
            predicate: { type: DatadogQueryPredicateType.datadog_query, query: 'service:checkout' },
          } as never,
        },
      ],
    });
    const filter = findJobGraphVertex(update, 'pre_data_warehouse_filter');
    expect(filter['name']).toBe('pre_data_warehouse_filter');
    expect(filter['predicate']).toEqual({ type: DatadogQueryPredicateType.datadog_query, query: 'service:checkout' });
    expect(filter['inverted']).toBe(false);
    expect(filter['maxLateEventTimestampDelta']).toBe('PT48H');
  });

  it('test_jobGraph_clearFilter_uiGraph_setsPassThroughFilter', () => {
    const job = makeUiRawJobGraphJob();
    const update = applyPatch(job, { operations: [{ op: 'clear-filter', phase: 'pre-warehouse' }] });
    const filter = findJobGraphVertex(update, 'pre_data_warehouse_filter');
    expect(filter['predicate']).toEqual({ type: DatadogQueryPredicateType.datadog_query, query: '' });
  });

  it('test_jobGraph_clearFilter_uiGraph_preservesExistingFilterFields', () => {
    const job = makeUiRawJobGraphJob();
    const graph = job.jobGraph as { vertices: Record<string, unknown>[] };
    const preWarehouse = graph.vertices.find(v => v.name === 'pre_data_warehouse_filter') as Record<string, unknown>;
    preWarehouse['maxLateEventTimestampDelta'] = 'PT48H';
    const update = applyPatch(job, { operations: [{ op: 'clear-filter', phase: 'pre-warehouse' }] });
    const filter = findJobGraphVertex(update, 'pre_data_warehouse_filter');
    expect(filter['predicate']).toEqual({ type: DatadogQueryPredicateType.datadog_query, query: '' });
    expect(filter['maxLateEventTimestampDelta']).toBe('PT48H');
  });

  it('test_jobGraph_addGrokParser_uiGraph_insertsBeforePreWarehouse', () => {
    const job = makeUiRawJobGraphJob();
    const update = applyPatch(job, {
      operations: [{ op: 'add-parser', parser: { type: GrokParserType.grok_parser, name: 'grok_1', grokParsingRules: ['Rule %{WORD:x}'] } as never }],
    });
    expect(findJobGraphVertex(update, 'grok_1')['type']).toBe(GrokParserType.grok_parser);
    expect(update.jobGraph.edges).not.toContain('log_attributes_remapper -> pre_data_warehouse_filter');
    expect(update.jobGraph.edges).toContain('log_attributes_remapper -> grok_1');
    expect(update.jobGraph.edges).toContain('grok_1 -> pre_data_warehouse_filter');
  });

  it('test_jobGraph_addRemapper_suffixedJsonProcessorName_insertsAfterJsonProcessor', () => {
    // Live UI graphs name the json processor with a suffix (e.g. json_log_processor_1).
    // The remapper must be wired after it (located by type), not silently before it.
    const job = makeUiRawJobGraphJob({
      vertices: [
        { type: 'logs-iceberg-table-source', name: 'src', datasetId: 'raw_ds' },
        { type: LogsFilterType.logs_filter, name: 'pre_parser_filter' },
        { type: JsonLogProcessorType.json_log_processor, name: 'json_log_processor_1' },
        { type: LogsFilterType.logs_filter, name: 'pre_data_warehouse_filter' },
        { type: LogsFilterType.logs_filter, name: 'pre_exceptions_filter' },
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-sync-sink', name: 'sink' },
      ],
      edges: [
        'src -> pre_parser_filter',
        'pre_parser_filter -> json_log_processor_1',
        'json_log_processor_1 -> pre_data_warehouse_filter',
        'pre_data_warehouse_filter -> pre_exceptions_filter',
        'pre_exceptions_filter -> log_reducer',
        'log_reducer -> sink',
      ],
    });
    const update = applyPatch(job, {
      operations: [{ op: 'add-parser', parser: remapperParser() as never }],
    });
    expect(update.jobGraph.edges).toContain('json_log_processor_1 -> log_attributes_remapper');
    expect(update.jobGraph.edges).toContain('log_attributes_remapper -> pre_data_warehouse_filter');
    expect(update.jobGraph.edges).not.toContain('json_log_processor_1 -> pre_data_warehouse_filter');
    // The remapper must not be wired before the json processor.
    expect(update.jobGraph.edges).not.toContain('pre_parser_filter -> log_attributes_remapper');
  });

  it('test_jobGraph_removeParser_uiGraph_bridgesParserChain', () => {
    const job = makeUiRawJobGraphJob({
      vertices: [
        { type: 'logs-iceberg-table-source', name: 'src', datasetId: 'raw_ds' },
        { type: LogsFilterType.logs_filter, name: 'pre_parser_filter' },
        { type: JsonLogProcessorType.json_log_processor, name: 'json_log_processor' },
        { type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper' },
        { type: GrokParserType.grok_parser, name: 'grok_1', grokParsingRules: ['Rule %{WORD:x}'] },
        { type: LogsFilterType.logs_filter, name: 'pre_data_warehouse_filter' },
        { type: LogsFilterType.logs_filter, name: 'pre_exceptions_filter' },
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-sync-sink', name: 'sink' },
      ],
      edges: [
        'src -> pre_parser_filter',
        'pre_parser_filter -> json_log_processor',
        'json_log_processor -> log_attributes_remapper',
        'log_attributes_remapper -> grok_1',
        'grok_1 -> pre_data_warehouse_filter',
        'pre_data_warehouse_filter -> pre_exceptions_filter',
        'pre_exceptions_filter -> log_reducer',
        'log_reducer -> sink',
      ],
    });
    const update = applyPatch(job, { operations: [{ op: 'remove-parser', name: 'grok_1' }] });
    expect(update.jobGraph.vertices.some(v => v.name === 'grok_1')).toBe(false);
    expect(update.jobGraph.edges).toContain('log_attributes_remapper -> pre_data_warehouse_filter');
    expect(update.jobGraph.edges.some(edge => edge.includes('grok_1'))).toBe(false);
  });

  it('test_jobGraph_preservesFromVersionAndDesiredState', () => {
    const job = makeJobGraphJob();
    const update = applyPatch(job, { operations: [{ op: 'add-message-attribute', attributePath: 'x' }] });
    expect(update.fromVersion).toBe(3);
    expect(update.desiredState).toBe(PathsV1JobsGetParametersQueryState.RUNNING);
  });

  it('test_jobGraph_multipleReducerVertices_shouldThrowAmbiguous', () => {
    const job = makeJobGraphJob({
      vertices: [
        { type: LogAttributesRemapperType.log_attributes_remapper, name: 'r' },
        { type: LogReducerType.log_reducer, name: 'reducer1', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: LogReducerType.log_reducer, name: 'reducer2', delimiters: [' '], enabledMasks: [], masks: [] },
      ],
    });
    expect(() => applyPatch(job, { operations: [{ op: 'add-group-by', attributePath: 'svc' }] })).toThrow(
      /expected exactly one .* but found 2/,
    );
  });
});

describe('applyPatch — sink ops (job-graph backend)', () => {
  const vendorSink = (name = 'dd_sink'): Record<string, unknown> => ({ type: 'datadog-log-sink', name, integrationId: 'int_1' });
  const filter = (): Record<string, unknown> => ({ type: LogsFilterType.logs_filter, name: 'ignored', predicate: { type: DatadogQueryPredicateType.datadog_query, query: 'status:error' } });

  it('test_jobGraph_addSink_noFilter_addsVertexAndReducerEdge', () => {
    const update = applyPatch(makeUiRawJobGraphJob(), {
      operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never }],
    });
    expect(findJobGraphVertex(update, 'dd_sink').type).toBe('datadog-log-sink');
    expect(update.jobGraph.edges).toContain('log_reducer -> dd_sink');
  });

  it('test_jobGraph_addSink_withFilter_insertsGeneratedFilterBetween', () => {
    const update = applyPatch(makeUiRawJobGraphJob(), {
      operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never, filter: filter() as never }],
    });
    const generated = findJobGraphVertex(update, 'dd_sink_filter');
    expect(generated.type).toBe(LogsFilterType.logs_filter);
    expect((generated as { predicate?: { query?: string } }).predicate?.query).toBe('status:error');
    expect(update.jobGraph.edges).toContain('log_reducer -> dd_sink_filter');
    expect(update.jobGraph.edges).toContain('dd_sink_filter -> dd_sink');
    expect(update.jobGraph.edges).not.toContain('log_reducer -> dd_sink');
  });

  it('test_jobGraph_addSink_duplicateSinkName_shouldThrow', () => {
    expect(() =>
      applyPatch(makeUiRawJobGraphJob(), {
        operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink('sink') as never }],
      }),
    ).toThrow(/already exists/);
  });

  it('test_jobGraph_addSink_missingReducer_shouldThrow', () => {
    const job = makeJobGraphJob({
      vertices: [{ type: LogAttributesRemapperType.log_attributes_remapper, name: 'log_attributes_remapper' }],
      edges: [],
    });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'add-sink', target: 'vendor', sink: vendorSink() as never }] }),
    ).toThrow(/missing canonical vertex: log_reducer/);
  });

  it('test_jobGraph_addSink_processedLogsNonIceberg_shouldThrow', () => {
    expect(() =>
      applyPatch(makeUiRawJobGraphJob(), {
        operations: [{ op: 'add-sink', target: 'processed-logs', sink: vendorSink() as never }],
      }),
    ).toThrow(/requires a logs-iceberg-table-sink/);
  });

  it('test_jobGraph_removeSink_vendor_removesVertexAndEdges', () => {
    const update = applyPatch(makeUiRawJobGraphJob(), {
      operations: [
        { op: 'add-sink', target: 'vendor', sink: vendorSink() as never },
        { op: 'remove-sink', target: 'vendor', name: 'dd_sink' },
      ],
    });
    expect(update.jobGraph.vertices.find(v => v.name === 'dd_sink')).toBeUndefined();
    expect(update.jobGraph.edges).not.toContain('log_reducer -> dd_sink');
  });

  it('test_jobGraph_removeSink_vendor_icebergSink_shouldThrow', () => {
    const job = makeUiRawJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_sink', datasetId: 'a' },
      ],
      edges: ['log_reducer -> raw_sink'],
    });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'remove-sink', target: 'vendor', name: 'raw_sink' }] }),
    ).toThrow(/not a vendor sink/);
  });

  it('test_jobGraph_removeSink_processedLogs_removesProcessedSink', () => {
    const job = makeUiRawJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'processed_logs_p', datasetId: 'p' },
      ],
      edges: ['log_reducer -> processed_logs_p'],
    });
    const update = applyPatch(job, { operations: [{ op: 'remove-sink', target: 'processed-logs' }] });
    expect(update.jobGraph.vertices.find(v => v.name === 'processed_logs_p')).toBeUndefined();
    expect(update.jobGraph.edges).not.toContain('log_reducer -> processed_logs_p');
  });

  it('test_jobGraph_removeSink_processedLogs_coexistingRaw_removesOnlyProcessed', () => {
    // Raw and processed iceberg sinks coexist; remove-sink must target the
    // processed-logs sink by name and leave the raw data-lake sink intact.
    const job = makeJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'a' },
        { type: 'logs-iceberg-table-sink', name: 'processed_logs_b', datasetId: 'b' },
      ],
      edges: ['log_reducer -> raw_data_sink', 'log_reducer -> processed_logs_b'],
    });
    const update = applyPatch(job, { operations: [{ op: 'remove-sink', target: 'processed-logs' }] });
    expect(update.jobGraph.vertices.find(v => v.name === 'processed_logs_b')).toBeUndefined();
    expect(update.jobGraph.vertices.find(v => v.name === 'raw_data_sink')).toBeDefined();
    expect(update.jobGraph.edges).not.toContain('log_reducer -> processed_logs_b');
    expect(update.jobGraph.edges).toContain('log_reducer -> raw_data_sink');
  });

  it('test_jobGraph_removeSink_processedLogs_onlyRawSink_shouldThrow', () => {
    // Only a raw data-lake sink exists: remove-sink processed-logs must NOT
    // delete it — it should report that no processed-logs sink was found.
    const job = makeJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'a' },
      ],
      edges: ['log_reducer -> raw_data_sink'],
    });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'remove-sink', target: 'processed-logs' }] }),
    ).toThrow(/found 0 processed-logs sinks/);
  });

  it('test_jobGraph_removeSink_processedLogs_multipleProcessed_shouldThrow', () => {
    // Two sinks share the processed-logs role prefix — the target is ambiguous.
    const job = makeJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'processed_logs_a', datasetId: 'a' },
        { type: 'logs-iceberg-table-sink', name: 'processed_logs_b', datasetId: 'b' },
      ],
      edges: ['log_reducer -> processed_logs_a', 'log_reducer -> processed_logs_b'],
    });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'remove-sink', target: 'processed-logs' }] }),
    ).toThrow(/found 2 processed-logs sinks/);
  });

  it('test_jobGraph_sinkOp_invalidTarget_shouldThrow', () => {
    expect(() =>
      applyPatch(makeUiRawJobGraphJob(), {
        operations: [{ op: 'remove-sink', target: 'processed-log' as never, name: 'sink' }],
      }),
    ).toThrow(/target must be "vendor" or "processed-logs"/);
  });

  it('test_jobGraph_removeSink_alsoRemovesGeneratedFilter', () => {
    const update = applyPatch(makeUiRawJobGraphJob(), {
      operations: [
        { op: 'add-sink', target: 'vendor', sink: vendorSink() as never, filter: filter() as never },
        { op: 'remove-sink', target: 'vendor', name: 'dd_sink' },
      ],
    });
    expect(update.jobGraph.vertices.find(v => v.name === 'dd_sink')).toBeUndefined();
    expect(update.jobGraph.vertices.find(v => v.name === 'dd_sink_filter')).toBeUndefined();
    expect(update.jobGraph.edges.some(e => e.includes('dd_sink_filter'))).toBe(false);
  });

  it('test_jobGraph_removeSink_nonSinkVertex_shouldThrow', () => {
    expect(() =>
      applyPatch(makeUiRawJobGraphJob(), { operations: [{ op: 'remove-sink', target: 'vendor', name: 'log_reducer' }] }),
    ).toThrow(/not a vendor sink/);
  });

  it('test_jobGraph_setRawDataset_rawSink_setsDatasetId', () => {
    const job = makeUiRawJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'old_ds' },
      ],
      edges: ['log_reducer -> raw_data_sink'],
    });
    const update = applyPatch(job, { operations: [{ op: 'set-raw-dataset', datasetId: 'new_ds' }] });
    expect(findJobGraphVertex(update, 'raw_data_sink').datasetId).toBe('new_ds');
  });

  it('test_jobGraph_setRawDataset_coexistingProcessed_setsOnlyRaw', () => {
    // Raw and processed iceberg sinks coexist; set-raw-dataset must target the
    // raw data-lake sink by name and leave the processed-logs sink untouched.
    const job = makeJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'old_ds' },
        { type: 'logs-iceberg-table-sink', name: 'processed_logs_b', datasetId: 'b' },
      ],
      edges: ['log_reducer -> raw_data_sink', 'log_reducer -> processed_logs_b'],
    });
    const update = applyPatch(job, { operations: [{ op: 'set-raw-dataset', datasetId: 'new_ds' }] });
    expect(findJobGraphVertex(update, 'raw_data_sink').datasetId).toBe('new_ds');
    expect(findJobGraphVertex(update, 'processed_logs_b').datasetId).toBe('b');
  });

  it('test_jobGraph_setRawDataset_noRawSink_shouldThrow', () => {
    expect(() =>
      applyPatch(makeUiRawJobGraphJob(), { operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] }),
    ).toThrow(/found 0 raw data-lake sinks/);
  });

  it('test_jobGraph_setRawDataset_multipleRawSinks_shouldThrow', () => {
    // Two sinks share the raw data-lake role prefix — the target is ambiguous.
    const job = makeJobGraphJob({
      vertices: [
        { type: LogReducerType.log_reducer, name: 'log_reducer', delimiters: [' '], enabledMasks: [], masks: [] },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink', datasetId: 'a' },
        { type: 'logs-iceberg-table-sink', name: 'raw_data_sink_2', datasetId: 'b' },
      ],
      edges: ['log_reducer -> raw_data_sink', 'log_reducer -> raw_data_sink_2'],
    });
    expect(() =>
      applyPatch(job, { operations: [{ op: 'set-raw-dataset', datasetId: 'd' }] }),
    ).toThrow(/found 2 raw data-lake sinks/);
  });
});
