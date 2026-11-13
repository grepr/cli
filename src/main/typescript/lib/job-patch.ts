/** Structured patch format for template-backed grepr pipelines: a list of ops applied to `templateInputs.input` locally before any production write. */
import {
  SchemaReadJob,
  SchemaUpdateJob,
  SchemaOperation,
  SchemaAttributesMergeStrategyEntry,
  SchemaEventPredicate,
  SchemaLogReducerTemplateInput,
  SchemaLogsFilter,
  SchemaLogsIcebergTableSink,
  SchemaTemplateLogSink,
  SchemaLogReducer,
  SchemaLogAttributesRemapper,
  SchemaGrokParser,
  SchemaTemplateQueryException,
  SchemaChainNode,
  SchemaConditionNode,
  SchemaDropNode,
  SchemaPassthroughNode,
  SchemaSqlNode,
  SchemaSqlOperation,
  SchemaMaskingOperator,
  SchemaTransforms,
  ConditionNodeKind,
  MaskingOperatorType,
  DropNodeKind,
  PassthroughNodeKind,
  SqlNodeKind,
  SqlNodeOutputRouting,
  SqlOperationType,
  SqlOutputStatementType,
  LogAttributesRemapperType,
  GrokParserType,
  DatadogQueryPredicateType,
  DatadogLogSinkType,
  SplunkLogSinkType,
  NewRelicLogSinkType,
  SumoLogSinkType,
  OtlpLogSinkType,
  LogsIcebergTableSinkType,
  TemplateOperationType,
  TemplateQueryExceptionType,
  SumAttributesMergeStrategyType,
  MinAttributesMergeStrategyType,
  MaxAttributesMergeStrategyType,
  AverageAttributesMergeStrategyType,
  PathsV1JobsGetParametersQueryState,
} from '@/openapi/openApiTypes';

export type AggregationStrategy =
  | `${SumAttributesMergeStrategyType}`
  | `${MinAttributesMergeStrategyType}`
  | `${MaxAttributesMergeStrategyType}`
  | `${AverageAttributesMergeStrategyType}`;

/** The processing phases that map to a template `transforms` chain slot. */
export type TemplateTransformPhase = 'pre-parser' | 'pre-warehouse' | 'pre-exceptions';

/** The accepted-phases suffix shared by every template transform-phase error. */
const ACCEPTED_TRANSFORM_PHASES_MESSAGE =
  'Accepted phases are pre-parser, pre-warehouse, and pre-exceptions.';

/** The downstream pipeline steps a `sql_output` may route to (the generated {@link SqlNodeOutputRouting} values). */
const SQL_OUTPUT_ROUTING_TARGETS: ReadonlySet<string> = new Set(Object.values(SqlNodeOutputRouting));

export type SqlTransformMainStream = 'drop' | 'passthrough';

const SQL_TRANSFORM_MAIN_STREAMS: ReadonlySet<string> = new Set<SqlTransformMainStream>(['drop', 'passthrough']);

/** Where a sink lives in the pipeline. */
export type SinkTarget = 'vendor' | 'processed-logs';

/** Vendor log sink types the UI supports as `add-sink target: 'vendor'`. */
const VENDOR_LOG_SINK_TYPES: ReadonlySet<string> = new Set([
  DatadogLogSinkType.datadog_log_sink,
  SplunkLogSinkType.splunk_log_sink,
  NewRelicLogSinkType.newrelic_log_sink,
  SumoLogSinkType.sumologic_log_sink,
  OtlpLogSinkType.otlp_log_sink,
]);

const LOGS_ICEBERG_TABLE_SINK_TYPE: string = LogsIcebergTableSinkType.logs_iceberg_table_sink;

/** All supported patch operations, applied in list order. */
export type JobPatchOp =
  | {
      op: 'add-message-attribute';
      /** Dot-notation path; multi-part stored as `messageReservedAttributePaths`, single-part as `messageReservedAttributes`. */
      attributePath: string;
    }
  | {
      op: 'add-group-by';
      /** Dot-notation path. Stored under `input.reducer.partitionByAttributePaths` (multi-part) or `input.reducer.partitionByAttributes` (single-part). */
      attributePath: string;
    }
  | {
      op: 'add-aggregation-strategy';
      /** Dot-notation path to aggregate. Stored under `input.reducer.attributeMergeStrategyEntries`. */
      attributePath: string;
      strategies: AggregationStrategy[];
    }
  | {
      op: 'add-reducer-exception';
      /**
       * Predicate logs must match to bypass aggregation. Wrapped in a
       * `TemplateQueryException` appended to `input.exceptions`.
       */
      predicate: SchemaEventPredicate;
    }
  | {
      op: 'add-grok-rule';
      /** Grok rule string; appended to the targeted parser's `grokParsingRules`. */
      pattern: string;
      /** Name of an existing grok-parser. If omitted, exactly one grok-parser must exist. */
      parserName?: string;
      /** Source attribute the parser reads from. Per-parser (not per-rule); overwrites any existing `extractAttribute`. */
      extractAttribute?: string;
    }
  // Escape hatches for template-input fields the semantic ops don't cover.
  // `path` is dot-notation from the `input` root over object keys only
  // (`sinks.0` is a key, not an index). Its first segment must be
  // a template input field, matched exactly, or parsePatch rejects the op; under
  // `transforms`, so must the slot.
  // Bracket notation is unsupported: a bracketed first segment fails that check,
  // and below it splitPath only splits on `.`, so `x[0]` is one literal key.
  | {
      op: 'set-input-field';
      /** Sets the field; intermediates must already exist (throws otherwise). */
      path: string;
      value: unknown;
    }
  | {
      op: 'unset-input-field';
      /** Deletes the field; no-ops if the path doesn't resolve. */
      path: string;
    }
  | {
      op: 'add-parser';
      /**
       * Operation with `name` and `type` (typically `json-log-processor`,
       * `grok-parser`, or `log-attributes-remapper`). Appended to `input.parsers`.
       */
      parser: SchemaOperation;
    }
  | {
      op: 'remove-parser';
      /** Removes the parser with this `name` from `input.parsers`. */
      name: string;
    }
  | {
      op: 'set-filter';
      phase: TemplateTransformPhase;
      /** Filter for this phase (one per phase), written as a transform-chain gate. */
      filter: SchemaLogsFilter;
    }
  | {
      op: 'clear-filter';
      phase: TemplateTransformPhase;
    }
  // Transform-chain ops. Each targets a `transforms` slot by
  // camel-case-equivalent phase and replaces or removes that whole chain.
  | {
      op: 'set-transform-chain';
      phase: TemplateTransformPhase;
      /** Replacement chain root for the slot; written verbatim. */
      root: SchemaChainNode;
    }
  | {
      op: 'clear-transform-chain';
      phase: TemplateTransformPhase;
    }
  | {
      op: 'set-sql-transform';
      phase: TemplateTransformPhase;
      /** The `sql-operation` to embed in a generated `SqlNode` chain. */
      sqlOperation: SchemaSqlOperation;
      /** Maps each `sql_output.outputName` to the downstream step that consumes it. */
      outputRouting: Record<string, SqlNodeOutputRouting>;
      /** What to do with the original/main stream after sending it to SQL. */
      mainStream: SqlTransformMainStream;
      /**
       * Optional predicate gating which events run the SQL node. Non-matching
       * events pass through unchanged.
       */
      gate?: SchemaEventPredicate;
    }
  // Masking ops. The masking operator is the template `input.masking`
  // field; these set/clear it as a first-class op so callers never hand-write the
  // escape-hatch path.
  | {
      op: 'set-masking';
      /** The masking operator to install as `input.masking`; replaces any existing one. */
      masking: SchemaMaskingOperator;
    }
  | {
      op: 'clear-masking';
    }
  | {
      op: 'add-source';
      /** Source operation appended to `input.sources`. */
      source: SchemaOperation;
    }
  | {
      op: 'remove-source';
      /** Removes the source with this `name` from `input.sources`. */
      name: string;
    }
  // add-sink/remove-sink are split by `target` so illegal target/field combos
  // (a filter on processed-logs, a vendor removal without a name) are
  // unrepresentable. Runtime guards still validate JSON-sourced patches, where
  // these constraints aren't type-checked (see parsePatch).
  | {
      op: 'add-sink';
      /** Adds a vendor log sink. */
      target: 'vendor';
      /** A vendor log sink operation. */
      sink: SchemaOperation;
      /**
       * Filter gating which logs reach this sink, stored on the `TemplateLogSink`.
       */
      filter?: SchemaLogsFilter;
    }
  | {
      op: 'add-sink';
      /** Sets the single reduced-logs iceberg sink. */
      target: 'processed-logs';
      /** A `logs-iceberg-table-sink` operation. */
      sink: SchemaOperation;
    }
  | {
      op: 'remove-sink';
      target: 'vendor';
      /** Name of the vendor sink to remove. */
      name: string;
    }
  | {
      op: 'remove-sink';
      /** Removes the singular `processed-logs` slot; no name needed. */
      target: 'processed-logs';
    }
  | {
      op: 'set-raw-dataset';
      /** New raw-logs dataset ID, written to `input.datasetId`. */
      datasetId: string;
    }
  // Per-entry removals: the inverse of the append-only `add-*` reducer/remapper
  // ops. Each drops one entry by value and errors if it isn't present (unlike the
  // idempotent adds), so a stale patch fails loudly rather than silently no-oping.
  | {
      op: 'remove-message-attribute';
      /** Dot-notation path to drop from the remapper's `messageReservedAttributes` (single-part) or `messageReservedAttributePaths` (multi-part). */
      attributePath: string;
    }
  | {
      op: 'remove-group-by';
      /** Dot-notation path to drop from the reducer's `partitionByAttributes` (single-part) or `partitionByAttributePaths` (multi-part). */
      attributePath: string;
    }
  | {
      op: 'remove-aggregation-strategy';
      /** Dot-notation path whose merge-strategy entries are dropped from `attributeMergeStrategyEntries`. */
      attributePath: string;
      /** Limits removal to these strategies; omit to drop every strategy entry for the path. */
      strategies?: AggregationStrategy[];
    }
  | {
      op: 'remove-reducer-exception';
      /** Predicate identifying the exception to drop from `input.exceptions` (matched by serialized equality). */
      predicate: SchemaEventPredicate;
    }
  | {
      op: 'remove-grok-rule';
      /** Grok rule string to drop from the targeted parser's `grokParsingRules`. */
      pattern: string;
      /** Name of an existing grok-parser. If omitted, exactly one grok-parser must exist. */
      parserName?: string;
    }
  // In-place updates: replace an entry's config (located by the new operation's
  // own `name`) at its current position. This is the single-op alternative to
  // `remove` + `add`. A missing target errors.
  | {
      op: 'update-source';
      /** Replacement source; the existing source with the same `name` is replaced in place. */
      source: SchemaOperation;
    }
  | {
      op: 'update-parser';
      /** Replacement parser; the existing parser with the same `name` is replaced in place. */
      parser: SchemaOperation;
    }
  // update-sink mirrors add-sink's target split so the vendor-only `filter`
  // field stays unrepresentable on the singular processed-logs slot.
  | {
      op: 'update-sink';
      /** Replaces a vendor sink's config in place, located by `sink.name`. */
      target: 'vendor';
      sink: SchemaOperation;
      /**
       * When provided, replaces the existing entry filter. Omit to preserve
       * current gating.
       */
      filter?: SchemaLogsFilter;
    }
  | {
      op: 'update-sink';
      /** Replaces the singular reduced-logs iceberg sink's config in place. */
      target: 'processed-logs';
      sink: SchemaOperation;
    }
  // In-place updates of individual reducer/remapper list entries: locate the
  // existing entry by value and replace it at its position (errors if absent),
  // matching the locate-by-key-then-replace contract of the other update ops
  // rather than the append behavior of remove + add.
  | {
      op: 'update-message-attribute';
      /** Existing message-attribute path to replace. */
      from: string;
      /** Replacement path. Must share `from`'s arity (both single- or both multi-part); cross-list moves need remove + add. */
      to: string;
    }
  | {
      op: 'update-group-by';
      /** Existing group-by path to replace. */
      from: string;
      /** Replacement path. Must share `from`'s arity (both single- or both multi-part); cross-list moves need remove + add. */
      to: string;
    }
  | {
      op: 'update-aggregation-strategy';
      /** Dot-notation path whose merge-strategy set is replaced. Errors if the path has no existing entries. */
      attributePath: string;
      /** New strategy set for the path; replaces all existing entries for it, anchored at the first one's position. */
      strategies: AggregationStrategy[];
    }
  | {
      op: 'update-reducer-exception';
      /** Predicate identifying the existing exception (matched by serialized equality). */
      from: SchemaEventPredicate;
      /** Replacement predicate, written at the matched exception's position. */
      to: SchemaEventPredicate;
    };

export interface JobPatch {
  operations: JobPatchOp[];
}

/**
 * What kind of pipeline elements a patch touches, picking the validation path.
 * `transform`/`source` are draft-validatable; `sink` (and `mixed`) are not.
 */
export type PatchClassification = 'transform' | 'source' | 'sink' | 'mixed';

/** Kinds a required field can be checked for at parse time. `present` accepts any defined value (used for `set-input-field`'s `value`, which may legitimately be null/false/0). */
type RequiredFieldType = 'string' | 'object' | 'array' | 'present';

/**
 * Required fields per op, keyed by op name. Typed as `Record<JobPatchOp['op'], …>`
 * so a new op added to the union fails to compile until its entry is added here —
 * keeping this table exhaustive alongside the apply-time dispatch.
 */
const REQUIRED_OP_FIELDS: Record<JobPatchOp['op'], readonly (readonly [string, RequiredFieldType])[]> = {
  'add-message-attribute': [['attributePath', 'string']],
  'add-group-by': [['attributePath', 'string']],
  'add-aggregation-strategy': [['attributePath', 'string'], ['strategies', 'array']],
  'add-reducer-exception': [['predicate', 'object']],
  'add-grok-rule': [['pattern', 'string']],
  'set-input-field': [['path', 'string'], ['value', 'present']],
  'unset-input-field': [['path', 'string']],
  'add-parser': [['parser', 'object']],
  'remove-parser': [['name', 'string']],
  'set-filter': [['phase', 'string'], ['filter', 'object']],
  'clear-filter': [['phase', 'string']],
  'set-transform-chain': [['phase', 'string'], ['root', 'object']],
  'clear-transform-chain': [['phase', 'string']],
  'set-sql-transform': [['phase', 'string'], ['sqlOperation', 'object'], ['outputRouting', 'object'], ['mainStream', 'string']],
  'set-masking': [['masking', 'object']],
  'clear-masking': [],
  'add-source': [['source', 'object']],
  'remove-source': [['name', 'string']],
  // Target-conditional fields (vendor removal's `name`, sink shape) stay with the apply-time guards.
  'add-sink': [['target', 'string'], ['sink', 'object']],
  'remove-sink': [['target', 'string']],
  'set-raw-dataset': [['datasetId', 'string']],
  'remove-message-attribute': [['attributePath', 'string']],
  'remove-group-by': [['attributePath', 'string']],
  // `strategies` is optional (omit to drop all entries for the path), so it stays off the required list.
  'remove-aggregation-strategy': [['attributePath', 'string']],
  'remove-reducer-exception': [['predicate', 'object']],
  'remove-grok-rule': [['pattern', 'string']],
  'update-source': [['source', 'object']],
  'update-parser': [['parser', 'object']],
  // Target-conditional fields (the vendor variant's `filter`) stay with the apply-time guards.
  'update-sink': [['target', 'string'], ['sink', 'object']],
  'update-message-attribute': [['from', 'string'], ['to', 'string']],
  'update-group-by': [['from', 'string'], ['to', 'string']],
  'update-aggregation-strategy': [['attributePath', 'string'], ['strategies', 'array']],
  'update-reducer-exception': [['from', 'object'], ['to', 'object']],
};

function fieldMatches(value: unknown, type: RequiredFieldType): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'present': return value !== undefined;
  }
}

function describeFieldType(type: RequiredFieldType): string {
  switch (type) {
    case 'present': return 'a defined value';
    case 'array': return 'an array';
    case 'object': return 'an object';
    case 'string': return 'a string';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isKnownPatchOpName(opName: string): opName is JobPatchOp['op'] {
  return Object.prototype.hasOwnProperty.call(REQUIRED_OP_FIELDS, opName);
}

function isTemplateInputField(field: string): field is keyof SchemaLogReducerTemplateInput {
  return Object.prototype.hasOwnProperty.call(INPUT_FIELD_TOUCHES, field);
}

function assertValidPatchOperation(op: unknown, index: number): asserts op is JobPatchOp {
  if (!isRecord(op) || typeof op['op'] !== 'string') {
    throw new Error(`Operation ${index} must be an object with a string "op" field`);
  }
  const opName = op['op'];
  if (!isKnownPatchOpName(opName)) {
    throw new Error(`Operation ${index}: unknown op "${opName}"`);
  }
  for (const [field, type] of REQUIRED_OP_FIELDS[opName]) {
    if (!fieldMatches(op[field], type)) {
      throw new Error(`Operation ${index} (${opName}): "${field}" is required and must be ${describeFieldType(type)}`);
    }
  }
}

/**
 * Validate the patch file shape, including each op's name and required fields and
 * that a `set/unset-input-field` path names a template input field (and, under
 * `transforms`, a slot), so a typo'd or
 * under-specified op (e.g. `add-group-by` with no `attributePath`) fails cleanly at
 * the file boundary rather than deep inside `applyPatch` with a confusing internal
 * error. `applyPatch` still does the deeper semantic/target-conditional validation.
 */
export function parsePatch(raw: unknown): JobPatch {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Patch file must be a JSON object with an "operations" array');
  }
  const operations = (raw as { operations?: unknown }).operations;
  if (!Array.isArray(operations)) {
    throw new Error(
      'Patch file must have an "operations" array. ' +
        'Example: { "operations": [{ "op": "add-group-by", "attributePath": "service" }] }',
    );
  }
  const parsedOperations: JobPatchOp[] = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    assertValidPatchOperation(op, i);
    if (op.op === 'set-input-field' || op.op === 'unset-input-field') {
      templateInputField(op, i);
    }
    parsedOperations.push(op);
  }
  return { operations: parsedOperations };
}

/**
 * Apply a patch to a fetched job, producing the `SchemaUpdateJob` payload for
 * `job:apply`. Pure (clones input). Throws if the job is not template-backed or
 * an op targets a missing field.
 */
export function applyPatch(job: SchemaReadJob, patch: JobPatch): SchemaUpdateJob {
  const cloned = structuredClone(job);
  const templateOp = findTemplateOperation(cloned);
  const input = readTemplateInput(templateOp);
  for (let i = 0; i < patch.operations.length; i++) {
    applyOperation(input, patch.operations[i] as JobPatchOp, i);
  }
  if (patch.operations.some(touchesSourceConfig)) {
    assertProposedTemplateHasSource(input);
  }
  writeTemplateInput(templateOp, input);
  // Apply path always submits draftMode: false (the draft path sets it later).
  templateOp.draftMode = false;
  return {
    desiredState: cloned.desiredState as PathsV1JobsGetParametersQueryState,
    fromVersion: cloned.version,
    jobGraph: cloned.jobGraph,
    teamIds: cloned.teamIds,
  };
}

function applyOperation(input: SchemaLogReducerTemplateInput, op: JobPatchOp, index: number): void {
  switch (op.op) {
    case 'add-message-attribute':
      return applyMessageAttributeToRemapper(requireRemapper(input, 'add-message-attribute', index, ADD_PARSER_REMAPPER_HINT), op.attributePath, index);
    case 'add-group-by':
      return applyGroupByToReducer(input.reducer, op.attributePath, index);
    case 'add-aggregation-strategy':
      return applyAggregationToReducer(input.reducer, op.attributePath, op.strategies, index);
    case 'add-reducer-exception':
      return applyAddReducerException(input, op.predicate);
    case 'add-grok-rule':
      return applyAddGrokRule(input, op.pattern, op.parserName, op.extractAttribute, index);
    case 'set-input-field':
      return applySetInputField(input, op.path, op.value, index);
    case 'unset-input-field':
      return applyUnsetInputField(input, op.path, index);
    case 'add-parser':
      return applyAddParser(input, op.parser, index);
    case 'remove-parser':
      return applyRemoveParser(input, op.name, index);
    case 'set-filter':
      return applySetFilter(input, op.phase, op.filter, index);
    case 'clear-filter':
      return applyClearFilter(input, op.phase, index);
    case 'set-transform-chain':
      return applySetTransformChain(input, op.phase, op.root, index);
    case 'clear-transform-chain':
      return applyClearTransformChain(input, op.phase, index);
    case 'set-sql-transform':
      return applySetSqlTransform(input, op.phase, op.sqlOperation, op.outputRouting, op.mainStream, op.gate, index);
    case 'set-masking':
      return applySetMasking(input, op.masking);
    case 'clear-masking':
      return applyClearMasking(input);
    case 'add-source':
      return applyAddSource(input, op.source, index);
    case 'remove-source':
      return applyRemoveSource(input, op.name, index);
    case 'add-sink':
      // `filter`/`name` live only on one target variant of the split union;
      // read via `in` so a JSON patch's stray field still reaches the guard.
      return applyAddSink(input, op.target, op.sink, 'filter' in op ? op.filter : undefined, index);
    case 'remove-sink':
      return applyRemoveSink(input, op.target, 'name' in op ? op.name : undefined, index);
    case 'set-raw-dataset':
      return applySetRawDataset(input, op.datasetId);
    case 'remove-message-attribute':
      return removeMessageAttributeFromRemapper(requireRemapper(input, 'remove-message-attribute', index), op.attributePath, index);
    case 'remove-group-by':
      return removeGroupByFromReducer(input.reducer, op.attributePath, index);
    case 'remove-aggregation-strategy':
      return removeAggregationFromReducer(input.reducer, op.attributePath, op.strategies, index);
    case 'remove-reducer-exception':
      return applyRemoveReducerException(input, op.predicate, index);
    case 'remove-grok-rule':
      return applyRemoveGrokRule(input, op.pattern, op.parserName, index);
    case 'update-source':
      return applyUpdateSource(input, op.source, index);
    case 'update-parser':
      return applyUpdateParser(input, op.parser, index);
    case 'update-sink':
      // See add-sink: read the vendor-only `filter` via `in` so a JSON patch's stray field still reaches the guard.
      return applyUpdateSink(input, op.target, op.sink, 'filter' in op ? op.filter : undefined, index);
    case 'update-message-attribute':
      return updateMessageAttributeOnRemapper(requireRemapper(input, 'update-message-attribute', index), op.from, op.to, index);
    case 'update-group-by':
      return updateGroupByOnReducer(input.reducer, op.from, op.to, index);
    case 'update-aggregation-strategy':
      return updateAggregationOnReducer(input.reducer, op.attributePath, op.strategies, index);
    case 'update-reducer-exception':
      return applyUpdateReducerException(input, op.from, op.to, index);
    default:
      return throwUnknownOp(op, index);
  }
}

/** Exhaustiveness guard: `op` is `never` when every JobPatchOp case is handled. */
function throwUnknownOp(op: never, index: number): never {
  const unknownOp = op as { op?: string };
  throw new Error(`Operation ${index}: unknown op "${unknownOp.op ?? '(missing)'}"`);
}

function applyMessageAttributeToRemapper(
  remapper: SchemaLogAttributesRemapper,
  attributePath: string,
  index: number,
): void {
  const parts = splitPath(attributePath, index);
  if (parts.length === 1) {
    const list = remapper.messageReservedAttributes ?? [];
    addUniqueString(list, parts[0] as string);
    remapper.messageReservedAttributes = list;
  } else {
    const list = remapper.messageReservedAttributePaths ?? [];
    addUniqueStringArray(list, parts);
    remapper.messageReservedAttributePaths = list;
  }
}

function applyGroupByToReducer(reducer: SchemaLogReducer, attributePath: string, index: number): void {
  const parts = splitPath(attributePath, index);
  if (parts.length === 1) {
    const list = reducer.partitionByAttributes ?? [];
    addUniqueString(list, parts[0] as string);
    reducer.partitionByAttributes = list;
  } else {
    const list = reducer.partitionByAttributePaths ?? [];
    addUniqueStringArray(list, parts);
    reducer.partitionByAttributePaths = list;
  }
}

function applyAggregationToReducer(
  reducer: SchemaLogReducer,
  attributePath: string,
  strategies: AggregationStrategy[],
  index: number,
): void {
  if (strategies.length === 0) {
    throw new Error(`Operation ${index} (add-aggregation-strategy): strategies array must not be empty`);
  }
  const parts = splitPath(attributePath, index);
  const existing = reducer.attributeMergeStrategyEntries ?? [];
  for (const strategy of strategies) {
    if (existing.some(e => arraysEqual(e.attributePath, parts) && e.strategy?.type === strategyTypeFor(strategy))) {
      continue;
    }
    existing.push({
      attributePath: parts,
      strategy: { type: strategyTypeFor(strategy) },
    } as SchemaAttributesMergeStrategyEntry);
  }
  reducer.attributeMergeStrategyEntries = existing;
}

function applyGrokRuleToParser(parser: SchemaGrokParser, pattern: string, extractAttribute: string | undefined): void {
  const rules = parser.grokParsingRules ?? [];
  if (!rules.includes(pattern)) rules.push(pattern);
  parser.grokParsingRules = rules;
  if (extractAttribute !== undefined) {
    parser.extractAttribute = extractAttribute;
  }
}

/** Consistent "entry not found" error shared by the per-entry remove-* and update-* ops. */
function entryNotFoundError(index: number, opLabel: string, what: string): Error {
  return new Error(`Operation ${index} (${opLabel}): ${what} not found.`);
}

// remove-* counterparts of the add-* reducer/remapper/grok writers: mutate the same
// field and throw if the entry is absent.

function removeMessageAttributeFromRemapper(remapper: SchemaLogAttributesRemapper, attributePath: string, index: number): void {
  const parts = splitPath(attributePath, index);
  const removed = parts.length === 1
    ? removeString(remapper.messageReservedAttributes, parts[0] as string)
    : removeStringArray(remapper.messageReservedAttributePaths, parts);
  if (!removed) throw entryNotFoundError(index, 'remove-message-attribute', `message attribute "${attributePath}"`);
}

function removeGroupByFromReducer(reducer: SchemaLogReducer, attributePath: string, index: number): void {
  const parts = splitPath(attributePath, index);
  const removed = parts.length === 1
    ? removeString(reducer.partitionByAttributes, parts[0] as string)
    : removeStringArray(reducer.partitionByAttributePaths, parts);
  if (!removed) throw entryNotFoundError(index, 'remove-group-by', `group-by "${attributePath}"`);
}

function removeAggregationFromReducer(
  reducer: SchemaLogReducer,
  attributePath: string,
  strategies: AggregationStrategy[] | undefined,
  index: number,
): void {
  if (strategies !== undefined && (!Array.isArray(strategies) || strategies.length === 0)) {
    throw new Error(
      `Operation ${index} (remove-aggregation-strategy): strategies must be a non-empty array; ` +
        `omit it to drop every entry for the path.`,
    );
  }
  const parts = splitPath(attributePath, index);
  const types = strategies?.map(strategyTypeFor);
  const entries = reducer.attributeMergeStrategyEntries ?? [];
  const kept = entries.filter(entry => {
    if (!arraysEqual(entry.attributePath, parts)) return true;
    if (types === undefined) return false; // no strategies given: drop every entry for the path
    const type = entry.strategy?.type;
    return type === undefined || !types.includes(type); // else drop only the listed strategies
  });
  if (kept.length === entries.length) {
    const what = strategies === undefined
      ? `aggregation strategy for "${attributePath}"`
      : `aggregation strategy [${strategies.join(', ')}] for "${attributePath}"`;
    throw entryNotFoundError(index, 'remove-aggregation-strategy', what);
  }
  reducer.attributeMergeStrategyEntries = kept;
}

function removeGrokRuleFromParser(parser: SchemaGrokParser, pattern: string, index: number): void {
  if (!removeString(parser.grokParsingRules, pattern)) {
    throw entryNotFoundError(index, 'remove-grok-rule', `grok rule "${pattern}"`);
  }
}

// In-place updates of the dual single/multi-part path lists shared by message
// attributes (remapper) and group-by (reducer): replace `from` with `to` at its
// existing position. Both must share arity since the two lists are separate.
function updateDualListPath(
  single: string[] | undefined,
  multi: string[][] | undefined,
  from: string,
  to: string,
  opLabel: string,
  noun: string,
  index: number,
): void {
  const fromParts = splitPath(from, index);
  const toParts = splitPath(to, index);
  if ((fromParts.length === 1) !== (toParts.length === 1)) {
    throw new Error(
      `Operation ${index} (${opLabel}): cannot change "${from}" to "${to}" in place — ` +
        `single-part and multi-part paths are stored in different lists; remove + add instead.`,
    );
  }
  if (from !== to) {
    const toExists = toParts.length === 1
      ? (single ?? []).includes(toParts[0] as string)
      : (multi ?? []).some(existing => arraysEqual(existing, toParts));
    if (toExists) {
      throw new Error(
        `Operation ${index} (${opLabel}): ${noun} "${to}" already exists; remove "${from}" instead.`,
      );
    }
  }
  const replaced = fromParts.length === 1
    ? replaceString(single, fromParts[0] as string, toParts[0] as string)
    : replaceStringArray(multi, fromParts, toParts);
  if (!replaced) throw entryNotFoundError(index, opLabel, `${noun} "${from}"`);
}

function updateMessageAttributeOnRemapper(remapper: SchemaLogAttributesRemapper, from: string, to: string, index: number): void {
  updateDualListPath(remapper.messageReservedAttributes, remapper.messageReservedAttributePaths, from, to, 'update-message-attribute', 'message attribute', index);
}

function updateGroupByOnReducer(reducer: SchemaLogReducer, from: string, to: string, index: number): void {
  updateDualListPath(reducer.partitionByAttributes, reducer.partitionByAttributePaths, from, to, 'update-group-by', 'group-by', index);
}

/** Replace the merge-strategy set for `attributePath` in place, anchored at its first existing entry's position. Errors if the path has no entries. */
function updateAggregationOnReducer(reducer: SchemaLogReducer, attributePath: string, strategies: AggregationStrategy[], index: number): void {
  if (strategies.length === 0) {
    throw new Error(`Operation ${index} (update-aggregation-strategy): strategies array must not be empty`);
  }
  const parts = splitPath(attributePath, index);
  const entries = reducer.attributeMergeStrategyEntries ?? [];
  const at = entries.findIndex(e => arraysEqual(e.attributePath, parts));
  if (at === -1) {
    throw entryNotFoundError(index, 'update-aggregation-strategy', `aggregation strategy for "${attributePath}"`);
  }
  const replacement = [...new Set(strategies.map(strategyTypeFor))].map(
    type => ({ attributePath: parts, strategy: { type } } as SchemaAttributesMergeStrategyEntry),
  );
  const kept = entries.filter(e => !arraysEqual(e.attributePath, parts));
  kept.splice(at, 0, ...replacement); // `at` is the path's first index; all earlier entries are non-path, so it survives the filter.
  reducer.attributeMergeStrategyEntries = kept;
}

/**
 * Locate `from` among the serialized existing predicates for update-reducer-exception
 * (entries that aren't predicates serialize to `undefined` and never match). Returns the
 * index to replace; throws if `from` is absent or `to` would duplicate a different entry.
 */
function reducerExceptionUpdateIndex(
  serialized: (string | undefined)[],
  from: SchemaEventPredicate,
  to: SchemaEventPredicate,
  index: number,
): number {
  const at = serialized.indexOf(JSON.stringify(from));
  if (at === -1) {
    throw entryNotFoundError(index, 'update-reducer-exception', 'matching reducer exception');
  }
  const dup = serialized.indexOf(JSON.stringify(to));
  if (dup !== -1 && dup !== at) {
    throw new Error(
      `Operation ${index} (update-reducer-exception): an exception matching "to" already exists; remove the "from" exception instead.`,
    );
  }
  return at;
}

function assertOperationIdentity(
  operation: SchemaOperation,
  opLabel: string,
  index: number,
  fieldName: string,
): void {
  if (!operation || typeof operation !== 'object') {
    throw new Error(`Operation ${index} (${opLabel}): ${fieldName} must be an object`);
  }
  if (typeof operation.name !== 'string' || operation.name.length === 0) {
    throw new Error(`Operation ${index} (${opLabel}): ${fieldName}.name must be a non-empty string`);
  }
  if (typeof operation.type !== 'string' || operation.type.length === 0) {
    throw new Error(`Operation ${index} (${opLabel}): ${fieldName}.type must be a non-empty string`);
  }
}

function assertProposedTemplateHasSource(input: SchemaLogReducerTemplateInput): void {
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error('Proposed job graph has zero sources; a log pipeline must keep at least one source.');
  }
}

function applyAddReducerException(input: SchemaLogReducerTemplateInput, predicate: SchemaEventPredicate): void {
  // Wrapped in a TemplateQueryException; matching logs bypass aggregation.
  const serialized = JSON.stringify(predicate);
  const isDuplicate = input.exceptions.some(
    e => e.type === TemplateQueryExceptionType.query_exception &&
      JSON.stringify((e as SchemaTemplateQueryException).predicate) === serialized,
  );
  if (isDuplicate) return; // idempotent
  const exception: SchemaTemplateQueryException = {
    type: TemplateQueryExceptionType.query_exception,
    predicate,
  };
  input.exceptions.push(exception);
}

function applyAddGrokRule(
  input: SchemaLogReducerTemplateInput,
  pattern: string,
  parserName: string | undefined,
  extractAttribute: string | undefined,
  index: number,
): void {
  const grok = findTemplateGrokParser(input.parsers, parserName, 'add-grok-rule', index);
  applyGrokRuleToParser(grok, pattern, extractAttribute);
}

/** Resolve the target grok-parser in `input.parsers` by name (or the sole grok-parser); shared by add/remove-grok-rule. Throws if absent, ambiguous, or not a grok-parser. */
function findTemplateGrokParser(
  parsers: SchemaOperation[],
  parserName: string | undefined,
  opLabel: string,
  index: number,
): SchemaGrokParser {
  const groks = parsers.filter(p => p.type === GrokParserType.grok_parser);
  if (!parserName && groks.length > 1) {
    throw new Error(
      `Operation ${index} (${opLabel}): found ${groks.length} grok parsers in input.parsers; ` +
        `pass parserName to choose the target parser.`,
    );
  }
  const grok = parserName ? parsers.find(p => p.name === parserName) : groks[0];
  if (!grok) {
    const hint = opLabel === 'add-grok-rule' ? ' If you need to introduce one, use add-parser first.' : '';
    throw new Error(
      `Operation ${index} (${opLabel}): ${parserName ? `parser "${parserName}" not found` : 'no grok-parser found in input.parsers'}.${hint}`,
    );
  }
  if (grok.type !== GrokParserType.grok_parser) {
    throw new Error(`Operation ${index} (${opLabel}): parser "${grok.name}" is not a grok-parser`);
  }
  return grok as SchemaGrokParser;
}

/**
 * The escape-hatch path is relative to the template `input` root, but the job-graph shape
 * exposes the same fields under `templateInputs.input.*`, so callers (especially LLMs) often
 * prepend a redundant `input.`. No top-level template-input field is named `input`, so a single
 * leading `input.` is always redundant and safe to drop; both `masking` and `input.masking` then
 * resolve identically.
 */
function stripInputRoot(path: string): string {
  return path.startsWith('input.') ? path.slice('input.'.length) : path;
}

/**
 * Installs a masking operator as `input.masking`, replacing any existing one. Defaults the
 * required `type` and `name` fields when omitted — the template input schema requires both, so an
 * operator authored without a `name` would be rejected at plan/apply time.
 */
function applySetMasking(input: SchemaLogReducerTemplateInput, masking: SchemaMaskingOperator): void {
  input.masking = {
    ...masking,
    type: MaskingOperatorType.masking_operator,
    name: masking.name || 'masking_operator',
  };
}

/** Removes the masking operator (`input.masking`); no-op if none is set. */
function applyClearMasking(input: SchemaLogReducerTemplateInput): void {
  delete input.masking;
}

function applySetInputField(input: SchemaLogReducerTemplateInput, rawPath: string, value: unknown, index: number): void {
  const path = stripInputRoot(rawPath);
  const parts = splitPath(path, index);
  let cursor = input as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    const next = cursor[key];
    if (next === undefined || next === null) {
      throw new Error(
        `Operation ${index} (set-input-field): path "${path}" traverses into a null/undefined intermediate (at "${key}")`,
      );
    }
    if (typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(
        `Operation ${index} (set-input-field): path "${path}" traverses into a non-object intermediate (at "${key}")`,
      );
    }
    cursor = next as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

function applyUnsetInputField(input: SchemaLogReducerTemplateInput, rawPath: string, index: number): void {
  const parts = splitPath(stripInputRoot(rawPath), index);
  let cursor = input as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cursor[parts[i] as string];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) return;
    cursor = next as Record<string, unknown>;
  }
  Reflect.deleteProperty(cursor, parts[parts.length - 1] as string);
}

function applyAddParser(input: SchemaLogReducerTemplateInput, parser: SchemaOperation, index: number): void {
  assertOperationIdentity(parser, 'add-parser', index, 'parser');
  if (input.parsers.some(p => p.name === parser.name)) {
    throw new Error(`Operation ${index} (add-parser): parser "${parser.name}" already exists`);
  }
  input.parsers.push(parser);
}

function applyRemoveParser(input: SchemaLogReducerTemplateInput, name: string, index: number): void {
  const idx = input.parsers.findIndex(p => p.name === name);
  if (idx === -1) {
    throw new Error(`Operation ${index} (remove-parser): parser "${name}" not found in input.parsers`);
  }
  input.parsers.splice(idx, 1);
}

/** A root filter gate located by {@link findSimpleRootFilterGate}: the branch kept on match and whether the filter is inverted. */
interface FilterGateMatch {
  /** The chain the gate routes kept events into (the gate's non-drop branch). */
  passSide: SchemaChainNode;
  /** True when the drop is on the `thenAction` side (an inverted keep filter). */
  inverted: boolean;
  /** The gate's existing root `lateDataDuration`, if any. */
  lateDataDuration?: string;
}

/**
 * Map a filter phase to its template `transforms` slot key. Only the three
 * transform-backed phases are accepted; any other phase fails with the shared
 * accepted-phases error.
 */
function phaseToTransformSlot(phase: TemplateTransformPhase, index: number, opLabel: string): keyof SchemaTransforms {
  switch (phase) {
    case 'pre-parser':
      return 'preParser';
    case 'pre-warehouse':
      return 'preWarehouse';
    case 'pre-exceptions':
      return 'preExceptions';
    default:
      throw new Error(
        `Operation ${index} (${opLabel}): phase "${phase}" is not accepted. ${ACCEPTED_TRANSFORM_PHASES_MESSAGE}`,
      );
  }
}

function makePassthroughNode(): SchemaPassthroughNode {
  return { kind: PassthroughNodeKind.passthrough_node };
}

function makeDropNode(): SchemaDropNode {
  return { kind: DropNodeKind.drop_node };
}

function makeMainStreamNode(mainStream: SqlTransformMainStream): SchemaDropNode | SchemaPassthroughNode {
  return mainStream === 'drop' ? makeDropNode() : makePassthroughNode();
}

function nodeKind(node: SchemaChainNode): string | undefined {
  return (node as { kind?: string } | null | undefined)?.kind;
}

export function isDropNode(node: SchemaChainNode): boolean {
  return nodeKind(node) === DropNodeKind.drop_node;
}

export function isPassthroughNode(node: SchemaChainNode): boolean {
  return nodeKind(node) === PassthroughNodeKind.passthrough_node;
}

export function isSqlNode(node: SchemaChainNode): boolean {
  return nodeKind(node) === SqlNodeKind.sql_node;
}

export function isConditionNode(node: SchemaChainNode): boolean {
  return nodeKind(node) === ConditionNodeKind.condition_node;
}

/**
 * Build a CLI-managed filter gate routing kept events into `passSide` and
 * dropping the rest. A normal keep filter passes `thenAction`; an inverted
 * filter swaps the branches. `maxLateEventTimestampDelta` becomes the gate's
 * root `lateDataDuration`, matching the previous `set-filter` behavior.
 */
function makeFilterGate(filter: SchemaLogsFilter, passSide: SchemaChainNode): SchemaConditionNode {
  const drop = makeDropNode();
  const gate: SchemaConditionNode = {
    kind: ConditionNodeKind.condition_node,
    predicate: filter.predicate,
    thenAction: filter.inverted ? drop : passSide,
    elseAction: filter.inverted ? passSide : drop,
  };
  if (filter.maxLateEventTimestampDelta !== undefined) {
    gate.lateDataDuration = filter.maxLateEventTimestampDelta;
  }
  return gate;
}

/**
 * Detect whether `root` is an unambiguous CLI-managed filter gate: a
 * `ConditionNode` with exactly one terminal `DropNode` branch. Returns the pass
 * side and inversion, or `undefined` when `root` is not a condition or has
 * meaningful (non-drop) work on both branches — a chain the CLI must not guess
 * at.
 */
function findSimpleRootFilterGate(root: SchemaChainNode): FilterGateMatch | undefined {
  if (!isConditionNode(root)) return undefined;
  const cond = root as SchemaConditionNode;
  const thenIsDrop = isDropNode(cond.thenAction);
  const elseIsDrop = isDropNode(cond.elseAction);
  // Exactly one branch must be a drop; both-drop or neither-drop is ambiguous.
  if (thenIsDrop === elseIsDrop) return undefined;
  return {
    passSide: elseIsDrop ? cond.thenAction : cond.elseAction,
    inverted: !elseIsDrop,
    lateDataDuration: cond.lateDataDuration,
  };
}

/**
 * Install or update a filter gate at the phase's transform slot:
 * - empty slot: `IF filter THEN PASSTHROUGH ELSE DROP`
 * - existing simple gate: rebuild with the new predicate, keeping the pass side
 *   and inheriting `inverted`/`lateDataDuration` when the patch omits them, so a
 *   predicate-only edit does not flip keep and drop
 * - any other existing chain (e.g. a SqlNode): `IF filter THEN <chain> ELSE DROP`
 */
function applySetFilter(
  input: SchemaLogReducerTemplateInput,
  phase: TemplateTransformPhase,
  filter: SchemaLogsFilter,
  index: number,
): void {
  if (!filter || typeof filter !== 'object') {
    throw new Error(`Operation ${index} (set-filter): filter must be an object`);
  }
  if (!isEventPredicate(filter.predicate)) {
    throw new Error(`Operation ${index} (set-filter): filter.predicate must be an EventPredicate object with a "type"`);
  }
  const slot = phaseToTransformSlot(phase, index, 'set-filter');
  const transforms: SchemaTransforms = input.transforms ?? {};
  const existing = transforms[slot];
  const match = existing === undefined ? undefined : findSimpleRootFilterGate(existing);
  const passSide = existing === undefined ? makePassthroughNode() : match?.passSide ?? existing;
  const gateFilter: SchemaLogsFilter = match
    ? {
        ...filter,
        inverted: filter.inverted ?? match.inverted,
        maxLateEventTimestampDelta: filter.maxLateEventTimestampDelta ?? match.lateDataDuration,
      }
    : filter;
  transforms[slot] = makeFilterGate(gateFilter, passSide);
  input.transforms = transforms;
}

/**
 * Remove a root filter gate from the phase's transform slot, replacing the slot
 * with the gate's pass side. No-ops on an empty slot. Fails clearly when the
 * slot holds a chain that is not an unambiguous filter gate, rather than
 * guessing which branch is the filter.
 */
function applyClearFilter(input: SchemaLogReducerTemplateInput, phase: TemplateTransformPhase, index: number): void {
  const slot = phaseToTransformSlot(phase, index, 'clear-filter');
  const transforms = input.transforms;
  const existing = transforms?.[slot];
  if (existing === undefined) return;
  const match = findSimpleRootFilterGate(existing);
  if (!match) {
    const detail = isConditionNode(existing)
      ? 'contains a branching transform chain, not a simple filter gate'
      : `contains a ${nodeKind(existing) ?? 'non-condition'} at its root, not a filter gate`;
    throw new Error(
      `Operation ${index} (clear-filter): template transform slot "${slot}" ${detail}. ` +
        `Use set-transform-chain to edit it explicitly.`,
    );
  }
  (transforms as SchemaTransforms)[slot] = match.passSide;
  input.transforms = transforms as SchemaTransforms;
}

/** True when `value` looks like an `EventPredicate` (an object carrying a string `type` discriminator). */
function isEventPredicate(value: unknown): value is SchemaEventPredicate {
  return isRecord(value) && typeof value['type'] === 'string';
}

/**
 * Replace the phase's transform slot with a hand-authored chain root. The CLI
 * does not introspect or validate the tree beyond requiring an object; the
 * template compiler remains the final authority.
 */
function applySetTransformChain(
  input: SchemaLogReducerTemplateInput,
  phase: TemplateTransformPhase,
  root: SchemaChainNode,
  index: number,
): void {
  if (!isRecord(root)) {
    throw new Error(`Operation ${index} (set-transform-chain): root must be a chain-node object`);
  }
  const slot = phaseToTransformSlot(phase, index, 'set-transform-chain');
  const transforms: SchemaTransforms = input.transforms ?? {};
  transforms[slot] = root;
  input.transforms = transforms;
}

/** Remove a phase's entire transform slot (distinct from `clear-filter`, which removes only a filter gate). */
function applyClearTransformChain(
  input: SchemaLogReducerTemplateInput,
  phase: TemplateTransformPhase,
  index: number,
): void {
  const slot = phaseToTransformSlot(phase, index, 'clear-transform-chain');
  if (input.transforms) {
    Reflect.deleteProperty(input.transforms, slot);
  }
}

/**
 * Replace the phase's transform slot with a generated `SqlNode` chain. Any
 * existing chain is replaced — callers needing to preserve or merge a chain
 * must use `set-transform-chain`.
 */
function applySetSqlTransform(
  input: SchemaLogReducerTemplateInput,
  phase: TemplateTransformPhase,
  sqlOperation: SchemaSqlOperation,
  outputRouting: Record<string, SqlNodeOutputRouting>,
  mainStream: SqlTransformMainStream,
  gate: SchemaEventPredicate | undefined,
  index: number,
): void {
  const slot = phaseToTransformSlot(phase, index, 'set-sql-transform');
  validateSqlTransform(sqlOperation, outputRouting, mainStream, gate, index);
  const sqlChain: SchemaSqlNode = {
    kind: SqlNodeKind.sql_node,
    sqlOperation,
    outputRouting,
    next: makeMainStreamNode(mainStream),
  };
  // An ungated drop (`mainStream: 'drop'`, no gate) still needs a condition node
  // wrapper with a match-all (`*`) predicate. The `elseAction` passthrough is
  // unreachable under `*`, but it is load-bearing, NOT dead code: it is the SQL
  // node's connected main output edge. A bare `sql-node` whose `next` is a drop
  // compiles to a disconnected `chainOut` in the Flink graph (see ENGT-4852 fix);
  // the passthrough else-branch is what keeps that main output connected. Do not
  // "simplify" it away — `test_setSqlTransform_noGate_dropMainStream_buildsMatchAllConditionNode`
  // pins this shape.
  const effectiveGate: SchemaEventPredicate = gate ?? { type: DatadogQueryPredicateType.datadog_query, query: '*' };
  const root: SchemaChainNode = mainStream === 'passthrough' && gate === undefined
    ? sqlChain
    : {
        kind: ConditionNodeKind.condition_node,
        predicate: effectiveGate,
        thenAction: sqlChain,
        elseAction: makePassthroughNode(),
      };
  const transforms: SchemaTransforms = input.transforms ?? {};
  transforms[slot] = root;
  input.transforms = transforms;
}

/**
 * Validate a `set-sql-transform` op before mutating the input, so malformed
 * SQL fails with a readable CLI error ahead of `job:draft`.
 */
function validateSqlTransform(
  sqlOperation: SchemaSqlOperation,
  outputRouting: Record<string, SqlNodeOutputRouting>,
  mainStream: SqlTransformMainStream,
  gate: SchemaEventPredicate | undefined,
  index: number,
): void {
  const fail = (detail: string): never => {
    throw new Error(`Operation ${index} (set-sql-transform): ${detail}`);
  };
  if (!isRecord(sqlOperation) || sqlOperation['type'] !== SqlOperationType.sql_operation) {
    fail(`sqlOperation must be an object with type "${SqlOperationType.sql_operation}"`);
  }
  const statements = (sqlOperation as { statements?: unknown }).statements;
  if (!Array.isArray(statements) || statements.length === 0) {
    fail('sqlOperation.statements must be a non-empty array');
  }
  const outputNames = (statements as { type?: unknown; outputName?: unknown }[])
    .filter(s => s.type === SqlOutputStatementType.sql_output)
    .map(s => s.outputName);
  if (outputNames.length === 0) {
    fail('sqlOperation.statements must include at least one sql_output statement');
  }
  const seen = new Set<unknown>();
  for (const name of outputNames) {
    if (typeof name !== 'string' || name.length === 0) {
      fail('every sql_output statement must have a non-empty outputName');
    }
    if (seen.has(name)) {
      fail(`duplicate sql_output outputName "${name as string}"; output names must be unique`);
    }
    seen.add(name);
  }
  if (!isRecord(outputRouting)) {
    fail('outputRouting must be an object');
  }
  if (typeof mainStream !== 'string' || !SQL_TRANSFORM_MAIN_STREAMS.has(mainStream)) {
    fail(`mainStream must be one of: ${[...SQL_TRANSFORM_MAIN_STREAMS].join(', ')}`);
  }
  for (const [key, target] of Object.entries(outputRouting)) {
    if (!seen.has(key)) {
      fail(`outputRouting key "${key}" does not match any sql_output outputName`);
    }
    if (typeof target !== 'string' || !SQL_OUTPUT_ROUTING_TARGETS.has(target)) {
      fail(
        `outputRouting["${key}"] = ${JSON.stringify(target)} is not a valid target step. ` +
          `Valid targets: ${[...SQL_OUTPUT_ROUTING_TARGETS].join(', ')}.`,
      );
    }
  }
  for (const name of seen) {
    if (!Object.prototype.hasOwnProperty.call(outputRouting, name as string)) {
      fail(`sql_output "${name as string}" has no route in outputRouting`);
    }
  }
  if (gate !== undefined && !isEventPredicate(gate)) {
    fail('gate must be an EventPredicate object with a "type"');
  }
}

function applyAddSource(input: SchemaLogReducerTemplateInput, source: SchemaOperation, index: number): void {
  assertOperationIdentity(source, 'add-source', index, 'source');
  if (input.sources.some(s => s.name === source.name)) {
    throw new Error(`Operation ${index} (add-source): source "${source.name}" already exists`);
  }
  input.sources.push(source);
}

function applyRemoveSource(input: SchemaLogReducerTemplateInput, name: string, index: number): void {
  const idx = input.sources.findIndex(s => s.name === name);
  if (idx === -1) {
    throw new Error(`Operation ${index} (remove-source): source "${name}" not found in input.sources`);
  }
  input.sources.splice(idx, 1);
}

// --- Template per-entry removals. ---

/** Remove the `TemplateQueryException` whose predicate matches (mirror of applyAddReducerException). */
function applyRemoveReducerException(input: SchemaLogReducerTemplateInput, predicate: SchemaEventPredicate, index: number): void {
  const serialized = JSON.stringify(predicate);
  const exceptions = input.exceptions ?? [];
  const kept = exceptions.filter(
    e => !(e.type === TemplateQueryExceptionType.query_exception &&
      JSON.stringify((e as SchemaTemplateQueryException).predicate) === serialized),
  );
  if (kept.length === exceptions.length) {
    throw entryNotFoundError(index, 'remove-reducer-exception', 'matching reducer exception');
  }
  input.exceptions = kept;
}

function applyRemoveGrokRule(input: SchemaLogReducerTemplateInput, pattern: string, parserName: string | undefined, index: number): void {
  const grok = findTemplateGrokParser(input.parsers, parserName, 'remove-grok-rule', index);
  removeGrokRuleFromParser(grok, pattern, index);
}

// --- Template in-place vertex updates: replace the matching list entry by name. ---

function applyUpdateSource(input: SchemaLogReducerTemplateInput, source: SchemaOperation, index: number): void {
  assertOperationIdentity(source, 'update-source', index, 'source');
  const idx = input.sources.findIndex(s => s.name === source.name);
  if (idx === -1) {
    throw new Error(`Operation ${index} (update-source): source "${source.name}" not found in input.sources.`);
  }
  input.sources[idx] = source;
}

function applyUpdateParser(input: SchemaLogReducerTemplateInput, parser: SchemaOperation, index: number): void {
  assertOperationIdentity(parser, 'update-parser', index, 'parser');
  const idx = input.parsers.findIndex(p => p.name === parser.name);
  if (idx === -1) {
    throw new Error(`Operation ${index} (update-parser): parser "${parser.name}" not found in input.parsers.`);
  }
  input.parsers[idx] = parser;
}

function applyUpdateSink(
  input: SchemaLogReducerTemplateInput,
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
): void {
  assertOperationIdentity(sink, 'update-sink', index, 'sink');
  assertSinkTargetShape(target, sink, filter, index, 'update-sink');
  if (target === 'vendor') {
    const sinks = input.sinks ?? [];
    const existingEntry = sinks.find(entry => entry.sink?.name === sink.name);
    if (!existingEntry) {
      throw new Error(`Operation ${index} (update-sink): sink "${sink.name}" not found in input.sinks.`);
    }
    if (filter !== undefined && existingEntry.filter === undefined) {
      throw new Error(
        `Operation ${index} (update-sink): sink "${sink.name}" has no gating filter to update; ` +
          `use remove-sink + add-sink to introduce a gate.`,
      );
    }
    const replacementEntry: SchemaTemplateLogSink = { sink };
    if (filter !== undefined) {
      replacementEntry.filter = filter;
    } else if (existingEntry.filter !== undefined) {
      replacementEntry.filter = existingEntry.filter;
    }
    input.sinks = sinks.map(entry => (entry === existingEntry ? replacementEntry : entry));
    return;
  }
  // processed-logs: a singular slot, so the replacement is taken as-is — its name is
  // not matched against the existing sink (unlike the by-name vendor path above).
  if (input.processedLogsSink === undefined || input.processedLogsSink === null) {
    throw new Error(`Operation ${index} (update-sink): no processedLogsSink set to update.`);
  }
  // Validated as a logs-iceberg-table-sink by assertSinkTargetShape.
  input.processedLogsSink = sink as SchemaLogsIcebergTableSink;
}

// --- Template in-place updates of reducer-list entries. ---

/** Replace the matching `TemplateQueryException`'s predicate in place (mirror of applyAddReducerException). */
function applyUpdateReducerException(input: SchemaLogReducerTemplateInput, from: SchemaEventPredicate, to: SchemaEventPredicate, index: number): void {
  const exceptions = input.exceptions ?? [];
  const serialized = exceptions.map(
    e => e.type === TemplateQueryExceptionType.query_exception
      ? JSON.stringify((e as SchemaTemplateQueryException).predicate)
      : undefined,
  );
  const idx = reducerExceptionUpdateIndex(serialized, from, to, index);
  exceptions[idx] = { type: TemplateQueryExceptionType.query_exception, predicate: to };
  input.exceptions = exceptions;
}


/** Reject a `target` not in {@link SinkTarget}; a typo like `"processed-log"` would otherwise fall through to the processed-logs branch. */
function assertValidSinkTarget(target: string, opLabel: string, index: number): asserts target is SinkTarget {
  if (target !== 'vendor' && target !== 'processed-logs') {
    throw new Error(
      `Operation ${index} (${opLabel}): target must be "vendor" or "processed-logs", got ${JSON.stringify(target)}.`,
    );
  }
}

/** Validate the sink type matches the target and `filter` is vendor-only; shared by add-sink and update-sink. */
function assertSinkTargetShape(
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
  opLabel: string,
): void {
  assertValidSinkTarget(target, opLabel, index);
  if (target === 'vendor') {
    if (!VENDOR_LOG_SINK_TYPES.has(sink.type as string)) {
      throw new Error(
        `Operation ${index} (${opLabel}): vendor sink type "${sink.type}" is not supported. ` +
          `Supported: ${[...VENDOR_LOG_SINK_TYPES].join(', ')}.`,
      );
    }
    return;
  }
  // processed-logs
  if (sink.type !== LOGS_ICEBERG_TABLE_SINK_TYPE) {
    throw new Error(
      `Operation ${index} (${opLabel}): target "processed-logs" requires a ${LOGS_ICEBERG_TABLE_SINK_TYPE} sink, got "${sink.type}".`,
    );
  }
  if (filter !== undefined) {
    throw new Error(
      `Operation ${index} (${opLabel}): filter is only supported for target "vendor"; ` +
        `the processed-logs sink has no per-sink filter.`,
    );
  }
}

function applyAddSink(
  input: SchemaLogReducerTemplateInput,
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
): void {
  assertOperationIdentity(sink, 'add-sink', index, 'sink');
  assertSinkTargetShape(target, sink, filter, index, 'add-sink');
  if (target === 'vendor') {
    const sinks = input.sinks ?? [];
    if (sinks.some(entry => entry.sink?.name === sink.name)) {
      throw new Error(`Operation ${index} (add-sink): sink "${sink.name}" already exists in input.sinks`);
    }
    sinks.push(filter !== undefined ? { sink, filter } : { sink });
    input.sinks = sinks;
    return;
  }
  // processed-logs: singular slot, don't silently replace.
  if (input.processedLogsSink !== undefined && input.processedLogsSink !== null) {
    throw new Error(
      `Operation ${index} (add-sink): processedLogsSink is already set. ` +
        `Remove it first with remove-sink (target: processed-logs) before adding a new one.`,
    );
  }
  // Validated as a logs-iceberg-table-sink by assertSinkTargetShape.
  input.processedLogsSink = sink as SchemaLogsIcebergTableSink;
}

function applyRemoveSink(
  input: SchemaLogReducerTemplateInput,
  target: SinkTarget,
  name: string | undefined,
  index: number,
): void {
  assertValidSinkTarget(target, 'remove-sink', index);
  if (target === 'vendor') {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Operation ${index} (remove-sink): name is required for target "vendor"`);
    }
    const sinks = input.sinks ?? [];
    const idx = sinks.findIndex(entry => entry.sink?.name === name);
    if (idx === -1) {
      throw new Error(`Operation ${index} (remove-sink): sink "${name}" not found in input.sinks`);
    }
    sinks.splice(idx, 1);
    input.sinks = sinks;
    return;
  }
  // processed-logs
  if (input.processedLogsSink === undefined || input.processedLogsSink === null) {
    throw new Error(`Operation ${index} (remove-sink): no processedLogsSink set to remove`);
  }
  delete input.processedLogsSink;
}

function applySetRawDataset(input: SchemaLogReducerTemplateInput, datasetId: string): void {
  input.datasetId = datasetId;
}

/** Returns limitation strings for the user-facing draft preamble; non-empty when the patch touches sinks (external delivery is not verified). */
export function draftVerificationLimitations(patch: JobPatch): string[] {
  return patch.operations.some(touchesSinkConfig)
    ? ['Sink/data-lake output edits are submitted for graph/upstream verification only; external sink delivery is not verified.']
    : [];
}

/** Classify a patch by what it touches; recorded on the plan so consumers needn't recompute. */
export function classifyPatch(patch: JobPatch): PatchClassification {
  let source = false;
  let sink = false;
  patch.operations.forEach((op, index) => {
    if (touchesSourceConfig(op, index)) source = true;
    if (touchesSinkConfig(op, index)) sink = true;
  });
  if (source && sink) return 'mixed';
  if (source) return 'source';
  if (sink) return 'sink';
  return 'transform';
}

/**
 * What a write to each top-level `templateInputs.input` field touches. Keyed by
 * `keyof SchemaLogReducerTemplateInput` so the compiler forces every schema
 * field to be classified — a new field is a build error here. Its keys are also
 * the only fields `set/unset-input-field` accept. `datasetId` is the raw-logs
 * dataset (semantic equivalent of set-raw-dataset).
 */
const INPUT_FIELD_TOUCHES: Record<keyof SchemaLogReducerTemplateInput, 'source' | 'sink' | 'transform'> = {
  sources: 'source',
  draftSource: 'source',
  sinks: 'sink',
  agentSignalSink: 'sink',
  processedLogsSink: 'sink',
  processedLogsSinkFilter: 'sink',
  rawSinkConfig: 'sink',
  datasetId: 'sink',
  conditionalDatasets: 'sink',
  reducer: 'transform',
  parsers: 'transform',
  transforms: 'transform',
  exceptions: 'transform',
  sampler: 'transform',
  masking: 'transform',
};

const TEMPLATE_INPUT_FIELDS = Object.keys(INPUT_FIELD_TOUCHES).sort();

/**
 * The template's `transforms` slots, keyed by `keyof SchemaTransforms` so the compiler forces
 * every slot to be listed. They're the only keys `set/unset-input-field` accept under
 * `transforms`; the filter phase names (`pre-parser`, ...) aren't slots.
 */
const TRANSFORM_SLOTS: Record<keyof SchemaTransforms, true> = {
  preParser: true,
  preWarehouse: true,
  preExceptions: true,
};

const TRANSFORM_SLOT_NAMES = Object.keys(TRANSFORM_SLOTS).sort();

const INPUT_FIELD_ERROR_HINT =
  'Edit filters with set-filter / clear-filter and transform chains with set-transform-chain. ' +
  'If the field is newer than this CLI, upgrade it: npm install -g @grepr/cli@latest.';

type InputFieldOp = Extract<JobPatchOp, { op: 'set-input-field' | 'unset-input-field' }>;

/**
 * The top-level template input field a generic `set/unset-input-field` path edits: its first
 * segment, matched exactly against the schema's own fields. Under `transforms`, the slot (the
 * path's second segment, or each key of a whole `transforms` value) must be a real slot too.
 * Anything else throws. The server stores an unknown key and the template never reads it, so
 * the edit would plan and draft cleanly while changing nothing.
 */
function templateInputField(op: InputFieldOp, index: number): keyof SchemaLogReducerTemplateInput {
  const [top = '', slot] = stripInputRoot(op.path).split('.');
  if (!isTemplateInputField(top)) {
    throw new Error(
      `Operation ${index} (${op.op}): "${top}" is not a template input field, so the template would ignore this edit. ` +
        `Template input fields: ${TEMPLATE_INPUT_FIELDS.join(', ')}. ${INPUT_FIELD_ERROR_HINT}`,
    );
  }
  if (top === 'transforms') {
    const wholeValue = op.op === 'set-input-field' && isRecord(op.value) ? Object.keys(op.value) : [];
    for (const key of slot === undefined ? wholeValue : [slot]) {
      if (!Object.prototype.hasOwnProperty.call(TRANSFORM_SLOTS, key)) {
        throw new Error(
          `Operation ${index} (${op.op}): "transforms.${key}" is not a transform slot, so the template would ignore this edit. ` +
            `Transform slots: ${TRANSFORM_SLOT_NAMES.join(', ')}. ${INPUT_FIELD_ERROR_HINT}`,
        );
      }
    }
  }
  return top;
}

function touchesSourceConfig(op: JobPatchOp, index: number): boolean {
  switch (op.op) {
    case 'add-source':
    case 'remove-source':
    case 'update-source':
      return true;
    case 'set-input-field':
    case 'unset-input-field':
      return INPUT_FIELD_TOUCHES[templateInputField(op, index)] === 'source';
    default:
      return false;
  }
}

function touchesSinkConfig(op: JobPatchOp, index: number): boolean {
  switch (op.op) {
    case 'add-sink':
    case 'remove-sink':
    case 'update-sink':
    case 'set-raw-dataset':
      return true;
    case 'set-input-field':
    case 'unset-input-field':
      return INPUT_FIELD_TOUCHES[templateInputField(op, index)] === 'sink';
    default:
      return false;
  }
}

/**
 * Find the single `template-operation` vertex of a template-backed job. This is
 * the guard that rejects a raw job graph pipeline (0 matches); it also rejects
 * more than 1 match. Accepts `SchemaReadJob` or `SchemaUpdateJob` without casts.
 */
export function findTemplateOperation(job: { jobGraph?: { vertices?: SchemaOperation[] } }): SchemaOperation & { draftMode?: boolean; templateInputs?: Record<string, unknown> } {
  const vertices = job.jobGraph?.vertices;
  if (!Array.isArray(vertices)) {
    throw new Error('Job has no jobGraph');
  }
  const matches = vertices.filter(v => v.type === TemplateOperationType.template_operation);
  if (matches.length === 0) {
    throw new Error(
      'This pipeline uses a raw job graph (no template-operation vertex). ' +
        'job:plan, job:draft and job:apply support only template-backed pipelines. ' +
        'To change a raw job graph, edit it and run job:update.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Pipeline has ${matches.length} template-operation vertices; expected exactly 1. ` +
        `Use grepr job:get --resolved -f raw to inspect.`,
    );
  }
  return matches[0] as SchemaOperation & { draftMode?: boolean; templateInputs?: Record<string, unknown> };
}

export function readTemplateInput(templateOp: { templateInputs?: Record<string, unknown> }): SchemaLogReducerTemplateInput {
  const inputs = templateOp.templateInputs;
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('template-operation vertex has no templateInputs');
  }
  const input = (inputs as Record<string, unknown>)['input'];
  if (!input || typeof input !== 'object') {
    throw new Error('template-operation vertex has no templateInputs.input');
  }
  return input as SchemaLogReducerTemplateInput;
}

function writeTemplateInput(
  templateOp: { templateInputs?: Record<string, unknown> },
  input: SchemaLogReducerTemplateInput,
): void {
  if (!templateOp.templateInputs) templateOp.templateInputs = {};
  // templateInputs values are typed `unknown`, so the structured input assigns directly — no cast needed.
  templateOp.templateInputs['input'] = input;
}

const ADD_PARSER_REMAPPER_HINT =
  `Template-backed pipelines normally include a remapper by default; if yours doesn't, add one via add-parser first.`;

function requireRemapper(
  input: SchemaLogReducerTemplateInput,
  opLabel: string,
  index: number,
  hint?: string,
): SchemaLogAttributesRemapper {
  const remapper = input.parsers.find(p => p.type === LogAttributesRemapperType.log_attributes_remapper);
  if (!remapper) {
    const message = `Operation ${index} (${opLabel}): no log-attributes-remapper in input.parsers.`;
    throw new Error(hint === undefined ? message : `${message} ${hint}`);
  }
  return remapper as SchemaLogAttributesRemapper;
}

function splitPath(path: string, index: number): string[] {
  if (path.length === 0) {
    throw new Error(`Operation ${index}: path must not be empty`);
  }
  return path.split('.');
}

function strategyTypeFor(strategy: AggregationStrategy): string {
  switch (strategy) {
    case 'sum': return SumAttributesMergeStrategyType.sum;
    case 'min': return MinAttributesMergeStrategyType.min;
    case 'max': return MaxAttributesMergeStrategyType.max;
    case 'avg': return AverageAttributesMergeStrategyType.avg;
  }
  // Reachable only from an untyped JSON patch; the switch is exhaustive for the union.
  throw new Error(`Unknown aggregation strategy ${JSON.stringify(strategy)}; expected one of: sum, min, max, avg.`);
}

function addUniqueString(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function addUniqueStringArray(list: string[][], value: string[]): void {
  if (!list.some(existing => arraysEqual(existing, value))) {
    list.push(value);
  }
}

/** Remove the first occurrence of `value`; returns whether anything was removed. */
function removeString(list: string[] | undefined, value: string): boolean {
  if (!list) return false;
  const idx = list.indexOf(value);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

/** Remove the first array equal to `value`; returns whether anything was removed. */
function removeStringArray(list: string[][] | undefined, value: string[]): boolean {
  if (!list) return false;
  const idx = list.findIndex(existing => arraysEqual(existing, value));
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

/** Replace the first occurrence of `oldV` with `newV` in place; returns whether `oldV` was found. */
function replaceString(list: string[] | undefined, oldV: string, newV: string): boolean {
  if (!list) return false;
  const idx = list.indexOf(oldV);
  if (idx === -1) return false;
  list[idx] = newV;
  return true;
}

/** Replace the first array equal to `oldV` with `newV` in place; returns whether `oldV` was found. */
function replaceStringArray(list: string[][] | undefined, oldV: string[], newV: string[]): boolean {
  if (!list) return false;
  const idx = list.findIndex(existing => arraysEqual(existing, oldV));
  if (idx === -1) return false;
  list[idx] = newV;
  return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
