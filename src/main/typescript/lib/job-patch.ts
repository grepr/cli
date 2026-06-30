/** Structured patch format for grepr pipelines: a list of ops applied locally before any production write (see {@link JobBackend} for the two substrates). */
import {
  SchemaReadJob,
  SchemaUpdateJob,
  SchemaOperation,
  SchemaGreprJobGraph,
  SchemaAttributesMergeStrategyEntry,
  SchemaEventPredicate,
  SchemaLogReducerTemplateInput,
  SchemaLogReducerFilters,
  SchemaTransforms,
  SchemaChainNode,
  SchemaConditionNode,
  SchemaLogsFilter,
  SchemaLogsIcebergTableSink,
  SchemaTemplateLogSink,
  SchemaLogReducer,
  SchemaLogAttributesRemapper,
  SchemaGrokParser,
  SchemaTemplateQueryException,
  LogAttributesRemapperType,
  LogReducerType,
  GrokParserType,
  LogsFilterType,
  ConditionNodeKind,
  DropNodeKind,
  PassthroughNodeKind,
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
import { parseEdge } from './job-graph-utils.js';
import {
  RAW_ATTRIBUTES_REMAPPER,
  RAW_ATTRIBUTES_REMAPPER_TYPE,
  RAW_JSON_PROCESSOR,
  RAW_JSON_PROCESSOR_TYPE,
  RAW_LOG_REDUCER,
  RAW_PARSER_TYPES,
  RAW_PRE_EXCEPTIONS_FILTER,
  RAW_PRE_PARSER_FILTER,
  RAW_PRE_WAREHOUSE_FILTER,
} from './job-graph-log-pipeline-constants.js';

export type AggregationStrategy =
  | `${SumAttributesMergeStrategyType}`
  | `${MinAttributesMergeStrategyType}`
  | `${MaxAttributesMergeStrategyType}`
  | `${AverageAttributesMergeStrategyType}`;
export type FilterPhase = keyof SchemaLogReducerFilters;

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

// Raw data-lake and processed-logs sinks share the logs-iceberg-table-sink type
// and are distinguished only by these vertex-name prefixes — a naming convention
// this CLI must match, not invent.
const RAW_DATA_LAKE_SINK_NAME_PREFIX = 'raw_data_sink';
const PROCESSED_LOGS_SINK_NAME_PREFIX = 'processed_logs_';

/**
 * Which substrate a patch is applied to. `template`: one `template-operation`
 * vertex, ops mutate `templateInputs.input`. `job-graph`: ops mutate resolved
 * vertices directly; topology ops require a canonical UI log graph.
 */
export type JobBackend = 'template' | 'job-graph';

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
       * Predicate logs must match to bypass aggregation. Template: wrapped in a
       * `TemplateQueryException` appended to `input.exceptions`. Job-graph:
       * appended raw to the reducer vertex's `logReducerExceptions`.
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
  // (`sinks.0` is a key, not an index); template-only. Bracket notation
  // (`sinks[0]`) is unsupported: splitPath only splits on `.`, so it becomes a
  // single literal key and silently fails to resolve.
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
       * `grok-parser`, or `log-attributes-remapper`). Template: appended to
       * `input.parsers`. Job-graph: inserted positionally into the parser chain.
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
      phase: FilterPhase;
      /** Filter for this phase (one per phase). Template: merged into the existing phase filter; job-graph: replaces the filter vertex. */
      filter: SchemaLogsFilter;
    }
  | {
      op: 'clear-filter';
      phase: FilterPhase;
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
       * Filter gating which logs reach this sink. Template: stored on the
       * `TemplateLogSink`. Raw job-graph: inserted as a single-use `logs-filter`
       * vertex (`<sink.name>_filter`) between the reducer and the sink.
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
      /** New raw-logs dataset ID. Template: `input.datasetId` (and `rawSinkConfig.datasetId` when that override is set). Raw job-graph: `datasetId` on the raw data-lake `logs-iceberg-table-sink` (matched by name prefix). */
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
      /** Predicate identifying the exception to drop (matched by serialized equality). Template: removed from `input.exceptions`; job-graph: removed from the reducer's `logReducerExceptions`. */
      predicate: SchemaEventPredicate;
    }
  | {
      op: 'remove-grok-rule';
      /** Grok rule string to drop from the targeted parser's `grokParsingRules`. */
      pattern: string;
      /** Name of an existing grok-parser. If omitted, exactly one grok-parser must exist. */
      parserName?: string;
    }
  // In-place vertex updates: replace a vertex's config (located by the new
  // operation's own `name`) while preserving its edges/position — the single-op,
  // wiring-preserving alternative to `remove` + `add`. A missing target errors.
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
       * When provided, replaces an existing template entry filter or generated
       * `<sink.name>_filter` vertex. Omit to preserve current gating.
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
 * Validate the patch file shape, including each op's name and required fields, so
 * a typo'd or under-specified op (e.g. `add-group-by` with no `attributePath`)
 * fails cleanly at the file boundary rather than deep inside `applyPatch` with a
 * confusing internal error. `applyPatch` still does the deeper
 * semantic/target-conditional validation.
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
    parsedOperations.push(op);
  }
  return { operations: parsedOperations };
}

/** Detect whether a job is template-backed (a `template-operation` vertex) or job-graph. */
export function detectBackend(job: { jobGraph?: { vertices?: SchemaOperation[] } }): JobBackend {
  const vertices = job.jobGraph?.vertices;
  if (!Array.isArray(vertices)) return 'job-graph';
  return vertices.some(v => v.type === TemplateOperationType.template_operation) ? 'template' : 'job-graph';
}

/**
 * Apply a patch to a fetched job, producing the `SchemaUpdateJob` payload for
 * `job:apply`. Pure (clones input); dispatches on backend. Throws if an op
 * targets a missing field/vertex or a topology op hits a non-UI raw graph.
 */
export function applyPatch(job: SchemaReadJob, patch: JobPatch): SchemaUpdateJob {
  const backend = detectBackend(job);
  return backend === 'template' ? applyPatchToTemplate(job, patch) : applyPatchToJobGraph(job, patch);
}

function applyPatchToTemplate(job: SchemaReadJob, patch: JobPatch): SchemaUpdateJob {
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

/**
 * Apply a patch to a job-graph (non-template) pipeline. Clones the job and
 * mutates the resolved graph on the clone (the input is left untouched). Field
 * names match the template inputs except `add-reducer-exception`, which appends
 * a raw `EventPredicate` to the reducer vertex's `logReducerExceptions`. Topology
 * ops require the canonical UI log-pipeline chain.
 */
function applyPatchToJobGraph(job: SchemaReadJob, patch: JobPatch): SchemaUpdateJob {
  const cloned = structuredClone(job);
  const jobGraph = cloned.jobGraph;
  const vertices = jobGraph?.vertices;
  if (!jobGraph || !Array.isArray(vertices) || vertices.length === 0) {
    throw new Error('Job has no jobGraph.vertices to patch');
  }
  if (!Array.isArray(jobGraph.edges)) {
    (jobGraph as unknown as { edges: string[] }).edges = [];
  }
  for (let i = 0; i < patch.operations.length; i++) {
    applyJobGraphOperation(jobGraph, patch.operations[i] as JobPatchOp, i);
  }
  if (patch.operations.some(touchesSourceConfig)) {
    assertProposedJobGraphHasSource(jobGraph);
  }
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
      return applyAddMessageAttribute(input, op.attributePath, index);
    case 'add-group-by':
      return applyAddGroupBy(input, op.attributePath, index);
    case 'add-aggregation-strategy':
      return applyAddAggregation(input, op.attributePath, op.strategies, index);
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
      return applyRemoveMessageAttribute(input, op.attributePath, index);
    case 'remove-group-by':
      return applyRemoveGroupBy(input, op.attributePath, index);
    case 'remove-aggregation-strategy':
      return applyRemoveAggregation(input, op.attributePath, op.strategies, index);
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
      return applyUpdateMessageAttribute(input, op.from, op.to, index);
    case 'update-group-by':
      return applyUpdateGroupBy(input, op.from, op.to, index);
    case 'update-aggregation-strategy':
      return applyUpdateAggregation(input, op.attributePath, op.strategies, index);
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

function applyJobGraphOperation(jobGraph: SchemaGreprJobGraph, op: JobPatchOp, index: number): void {
  const vertices = jobGraph.vertices;
  switch (op.op) {
    case 'add-message-attribute':
      return jobGraphAddMessageAttribute(vertices, op.attributePath, index);
    case 'add-group-by':
      return jobGraphAddGroupBy(vertices, op.attributePath, index);
    case 'add-aggregation-strategy':
      return jobGraphAddAggregation(vertices, op.attributePath, op.strategies, index);
    case 'add-reducer-exception':
      return jobGraphAddReducerException(vertices, op.predicate, index);
    case 'add-grok-rule':
      return jobGraphAddGrokRule(vertices, op.pattern, op.parserName, op.extractAttribute, index);
    case 'add-parser':
      return jobGraphAddParser(jobGraph, op.parser, index);
    case 'remove-parser':
      return jobGraphRemoveParser(jobGraph, op.name, index);
    case 'set-filter':
      return jobGraphSetFilter(jobGraph, op.phase, op.filter, index);
    case 'clear-filter':
      return jobGraphClearFilter(jobGraph, op.phase, index);
    case 'add-source':
      return jobGraphAddSource(jobGraph, op.source, index);
    case 'remove-source':
      return jobGraphRemoveSource(jobGraph, op.name, index);
    case 'add-sink':
      // See the template dispatch: read the target-specific field via `in`.
      return jobGraphAddSink(jobGraph, op.target, op.sink, 'filter' in op ? op.filter : undefined, index);
    case 'remove-sink':
      return jobGraphRemoveSink(jobGraph, op.target, 'name' in op ? op.name : undefined, index);
    case 'set-raw-dataset':
      return jobGraphSetRawDataset(jobGraph, op.datasetId, index);
    case 'remove-message-attribute':
      return jobGraphRemoveMessageAttribute(vertices, op.attributePath, index);
    case 'remove-group-by':
      return jobGraphRemoveGroupBy(vertices, op.attributePath, index);
    case 'remove-aggregation-strategy':
      return jobGraphRemoveAggregation(vertices, op.attributePath, op.strategies, index);
    case 'remove-reducer-exception':
      return jobGraphRemoveReducerException(vertices, op.predicate, index);
    case 'remove-grok-rule':
      return jobGraphRemoveGrokRule(vertices, op.pattern, op.parserName, index);
    case 'update-source':
      return jobGraphUpdateSource(jobGraph, op.source, index);
    case 'update-parser':
      return jobGraphUpdateParser(jobGraph, op.parser, index);
    case 'update-sink':
      // See add-sink: read the vendor-only `filter` via `in`.
      return jobGraphUpdateSink(jobGraph, op.target, op.sink, 'filter' in op ? op.filter : undefined, index);
    case 'update-message-attribute':
      return jobGraphUpdateMessageAttribute(vertices, op.from, op.to, index);
    case 'update-group-by':
      return jobGraphUpdateGroupBy(vertices, op.from, op.to, index);
    case 'update-aggregation-strategy':
      return jobGraphUpdateAggregation(vertices, op.attributePath, op.strategies, index);
    case 'update-reducer-exception':
      return jobGraphUpdateReducerException(vertices, op.from, op.to, index);
    case 'set-input-field':
    case 'unset-input-field':
      throw new Error(
        `Operation ${index} (${op.op}): generic template-input paths are not supported on raw job graphs. ` +
          `Use a semantic operation, or apply this change directly via ` +
          `'grepr job:get' + manual edit + 'grepr job:update'.`,
      );
    default:
      return throwUnknownOp(op, index);
  }
}

function findUniqueVertexByType(
  vertices: SchemaOperation[],
  type: string,
  opLabel: string,
  index: number,
): SchemaOperation {
  const matches = vertices.filter(v => v.type === type);
  if (matches.length === 0) {
    throw new Error(
      `Operation ${index} (${opLabel}): no ${type} vertex found in jobGraph.vertices. ` +
        `Non-template pipelines must already include this vertex; this CLI doesn't add new vertices to job-graph pipelines.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Operation ${index} (${opLabel}): expected exactly one ${type} vertex but found ${matches.length}. ` +
        `Ambiguous target; resolve by hand via 'grepr job:get' + 'grepr job:update'.`,
    );
  }
  return matches[0] as SchemaOperation;
}

function jobGraphAddMessageAttribute(vertices: SchemaOperation[], attributePath: string, index: number): void {
  const remapper = findUniqueVertexByType(
    vertices,
    LogAttributesRemapperType.log_attributes_remapper,
    'add-message-attribute',
    index,
  );
  applyMessageAttributeToRemapper(remapper as SchemaLogAttributesRemapper, attributePath, index);
}

function jobGraphAddGroupBy(vertices: SchemaOperation[], attributePath: string, index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'add-group-by', index);
  applyGroupByToReducer(reducer as SchemaLogReducer, attributePath, index);
}

function jobGraphAddAggregation(
  vertices: SchemaOperation[],
  attributePath: string,
  strategies: AggregationStrategy[],
  index: number,
): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'add-aggregation-strategy', index);
  applyAggregationToReducer(reducer as SchemaLogReducer, attributePath, strategies, index);
}

/** Append a predicate to the reducer's `logReducerExceptions` (stored raw, unlike the template path's `TemplateQueryException` wrapper). */
function jobGraphAddReducerException(
  vertices: SchemaOperation[],
  predicate: SchemaEventPredicate,
  index: number,
): void {
  const reducer = findUniqueVertexByType(
    vertices,
    LogReducerType.log_reducer,
    'add-reducer-exception',
    index,
  ) as SchemaLogReducer;
  const existing = reducer.logReducerExceptions ?? [];
  const serialized = JSON.stringify(predicate);
  if (existing.some(p => JSON.stringify(p) === serialized)) {
    reducer.logReducerExceptions = existing;
    return; // idempotent
  }
  existing.push(predicate);
  reducer.logReducerExceptions = existing;
}

function jobGraphAddGrokRule(
  vertices: SchemaOperation[],
  pattern: string,
  parserName: string | undefined,
  extractAttribute: string | undefined,
  index: number,
): void {
  const grok = findJobGraphGrokParser(vertices, parserName, 'add-grok-rule', index);
  applyGrokRuleToParser(grok, pattern, extractAttribute);
}

/** Resolve the target grok-parser vertex by name (or the sole grok-parser); shared by add/remove-grok-rule. Throws if absent or ambiguous. */
function findJobGraphGrokParser(
  vertices: SchemaOperation[],
  parserName: string | undefined,
  opLabel: string,
  index: number,
): SchemaGrokParser {
  const groks = vertices.filter(v => v.type === GrokParserType.grok_parser);
  const grok = selectGrokParser(groks, parserName, 'jobGraph.vertices', opLabel, index);
  if (!grok) {
    const hint = opLabel === 'add-grok-rule' ? " Add a grok-parser vertex via 'grepr job:update' before using add-grok-rule on this pipeline." : '';
    throw new Error(
      `Operation ${index} (${opLabel}): ${parserName ? `grok-parser "${parserName}" not found` : 'no grok-parser vertex found in jobGraph.vertices'}.${hint}`,
    );
  }
  return grok as SchemaGrokParser;
}

function selectGrokParser(
  groks: SchemaOperation[],
  parserName: string | undefined,
  location: string,
  opLabel: string,
  index: number,
): SchemaOperation | undefined {
  if (parserName) {
    return groks.find(parser => parser.name === parserName);
  }
  if (groks.length > 1) {
    throw new Error(
      `Operation ${index} (${opLabel}): found ${groks.length} grok parsers in ${location}; ` +
        `pass parserName to choose the target parser.`,
    );
  }
  return groks[0];
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
// vertex field, shared verbatim by both backends, throw if the entry is absent.

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

const DEFAULT_EDGE_OUTPUT = 'output';
const DEFAULT_EDGE_INPUT = 'input';

function jobGraphAddSource(jobGraph: SchemaGreprJobGraph, source: SchemaOperation, index: number): void {
  assertRawUiLogGraph(jobGraph, 'add-source', index, [RAW_PRE_PARSER_FILTER]);
  assertOperationIdentity(source, 'add-source', index, 'source');
  if (findVertexIndexByName(jobGraph, source.name) !== -1) {
    throw new Error(`Operation ${index} (add-source): source "${source.name}" already exists`);
  }
  jobGraph.vertices.push(source);
  addEdgeIfMissing(jobGraph, source.name, DEFAULT_EDGE_OUTPUT, RAW_PRE_PARSER_FILTER, DEFAULT_EDGE_INPUT);
}

function jobGraphRemoveSource(jobGraph: SchemaGreprJobGraph, name: string, index: number): void {
  assertRawUiLogGraph(jobGraph, 'remove-source', index, [RAW_PRE_PARSER_FILTER]);
  const idx = findVertexIndexByName(jobGraph, name);
  if (idx === -1) {
    throw new Error(`Operation ${index} (remove-source): source "${name}" not found in jobGraph.vertices`);
  }
  if (!isCanonicalRawSource(jobGraph, name)) {
    throw unsupportedRawShapeError(
      index,
      'remove-source',
      `vertex "${name}" is not a canonical UI source feeding ${RAW_PRE_PARSER_FILTER}`,
    );
  }
  jobGraph.vertices.splice(idx, 1);
  removeEdgesTouching(jobGraph, name);
}

function jobGraphAddSink(
  jobGraph: SchemaGreprJobGraph,
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
): void {
  assertOperationIdentity(sink, 'add-sink', index, 'sink');
  assertSinkTargetShape(target, sink, filter, index, 'add-sink');
  // Anchors on a unique log_reducer (assertRawUiLogGraph rejects missing/duplicate).
  assertRawUiLogGraph(jobGraph, 'add-sink', index, [RAW_LOG_REDUCER]);
  if (findVertexIndexByName(jobGraph, sink.name) !== -1) {
    throw new Error(`Operation ${index} (add-sink): sink "${sink.name}" already exists`);
  }
  // processed-logs is a singular slot — mirror the template-backend guard.
  // Only reject a reducer-fed iceberg sink (direct or 1-hop through a filter);
  // a raw data-lake sink fed by pre_data_warehouse_filter is a separate slot.
  if (target === 'processed-logs' && hasReducerFedIcebergSink(jobGraph)) {
    throw new Error(
      `Operation ${index} (add-sink): a logs-iceberg-table-sink already exists. ` +
        `Remove it first with remove-sink (target: processed-logs) before adding a new one.`,
    );
  }

  if (filter !== undefined) {
    if (typeof filter !== 'object') {
      throw new Error(`Operation ${index} (add-sink): filter must be an object`);
    }
    const filterName = `${sink.name}_filter`;
    if (findVertexIndexByName(jobGraph, filterName) !== -1) {
      throw new Error(`Operation ${index} (add-sink): generated filter vertex "${filterName}" already exists`);
    }
    const filterVertex = {
      ...(filter as unknown as Record<string, unknown>),
      name: filterName,
      type: LogsFilterType.logs_filter,
    } as unknown as SchemaOperation;
    jobGraph.vertices.push(filterVertex, sink);
    addEdgeIfMissing(jobGraph, RAW_LOG_REDUCER, DEFAULT_EDGE_OUTPUT, filterName, DEFAULT_EDGE_INPUT);
    addEdgeIfMissing(jobGraph, filterName, DEFAULT_EDGE_OUTPUT, sink.name, DEFAULT_EDGE_INPUT);
    return;
  }

  jobGraph.vertices.push(sink);
  addEdgeIfMissing(jobGraph, RAW_LOG_REDUCER, DEFAULT_EDGE_OUTPUT, sink.name, DEFAULT_EDGE_INPUT);
}

function jobGraphRemoveSink(
  jobGraph: SchemaGreprJobGraph,
  target: SinkTarget,
  name: string | undefined,
  index: number,
): void {
  assertValidSinkTarget(target, 'remove-sink', index);
  const sinkName = resolveRawSinkToRemove(jobGraph, target, name, index);
  // If the sink is fed by its generated single-use filter, drop that too.
  const generatedFilterName = `${sinkName}_filter`;
  const fedByGeneratedFilter = parsedEdges(jobGraph).some(
    edge => edge.targetVertex === sinkName && edge.sourceVertex === generatedFilterName,
  );
  removeVertexByName(jobGraph, sinkName);
  removeEdgesTouching(jobGraph, sinkName);
  if (fedByGeneratedFilter && findVertexByName(jobGraph, generatedFilterName)) {
    removeVertexByName(jobGraph, generatedFilterName);
    removeEdgesTouching(jobGraph, generatedFilterName);
  }
}

/**
 * Resolve which raw-graph sink a `remove-sink` op targets. `vendor` requires a
 * `name` matching a vendor sink type; `processed-logs` ignores `name` and
 * removes the unique `logs-iceberg-table-sink` (rejecting 0 or multiple).
 */
function resolveRawSinkToRemove(
  jobGraph: SchemaGreprJobGraph,
  target: SinkTarget,
  name: string | undefined,
  index: number,
): string {
  if (target === 'vendor') {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`Operation ${index} (remove-sink): name is required for target "vendor"`);
    }
    const vertex = findVertexByName(jobGraph, name);
    if (!vertex) {
      throw new Error(`Operation ${index} (remove-sink): sink "${name}" not found in jobGraph.vertices`);
    }
    if (!VENDOR_LOG_SINK_TYPES.has(vertex.type as string)) {
      throw new Error(`Operation ${index} (remove-sink): vertex "${name}" is not a vendor sink (type "${vertex.type}")`);
    }
    return name;
  }
  return findIcebergSinkByRole(jobGraph, PROCESSED_LOGS_SINK_NAME_PREFIX, 'processed-logs', 'remove-sink', 'remove the sink', index).name;
}

/**
 * The single `logs-iceberg-table-sink` vertex playing the given role, identified
 * by its name prefix. Selecting by type alone is ambiguous — raw and processed
 * sinks share the type — so a count-based pick can target the wrong dataset sink.
 * Errors on 0 or >1 matches for the role.
 */
function findIcebergSinkByRole(
  jobGraph: SchemaGreprJobGraph,
  namePrefix: string,
  role: string,
  opLabel: string,
  action: string,
  index: number,
): SchemaLogsIcebergTableSink {
  const matches = jobGraph.vertices.filter(
    v => v.type === LOGS_ICEBERG_TABLE_SINK_TYPE && v.name.startsWith(namePrefix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Operation ${index} (${opLabel}): found ${matches.length} ${role} sinks (logs-iceberg-table-sink named "${namePrefix}*"); ` +
        `expected exactly one to ${action}. Use 'grepr job:get' + 'grepr job:update' to ${action} explicitly.`,
    );
  }
  return matches[0] as SchemaLogsIcebergTableSink;
}

function jobGraphSetRawDataset(jobGraph: SchemaGreprJobGraph, datasetId: string, index: number): void {
  const sink = findIcebergSinkByRole(jobGraph, RAW_DATA_LAKE_SINK_NAME_PREFIX, 'raw data-lake', 'set-raw-dataset', 'set the dataset', index);
  sink.datasetId = datasetId;
}

function jobGraphSetFilter(
  jobGraph: SchemaGreprJobGraph,
  phase: FilterPhase,
  filter: SchemaLogsFilter,
  index: number,
): void {
  if (!filter || typeof filter !== 'object') {
    throw new Error(`Operation ${index} (set-filter): filter must be an object`);
  }
  const rawName = rawFilterNameForPhase(phase, index, 'set-filter');
  assertRawUiLogGraph(jobGraph, 'set-filter', index, [rawName]);
  replaceRawFilterVertex(jobGraph, rawName, filter as unknown as Record<string, unknown>, 'set-filter', index);
}

function jobGraphClearFilter(jobGraph: SchemaGreprJobGraph, phase: FilterPhase, index: number): void {
  const rawName = rawFilterNameForPhase(phase, index, 'clear-filter');
  assertRawUiLogGraph(jobGraph, 'clear-filter', index, [rawName]);
  replaceRawFilterVertex(
    jobGraph,
    rawName,
    { predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' } },
    'clear-filter',
    index,
  );
}

function replaceRawFilterVertex(
  jobGraph: SchemaGreprJobGraph,
  rawName: string,
  patch: Record<string, unknown>,
  opLabel: string,
  index: number,
): void {
  const existing = findVertexByName(jobGraph, rawName);
  if (!existing) {
    throw unsupportedRawShapeError(index, opLabel, `vertex "${rawName}" not found`);
  }
  replaceVertexByName(
    jobGraph,
    rawName,
    {
      ...(existing as unknown as Record<string, unknown>),
      ...patch,
      type: LogsFilterType.logs_filter,
      name: rawName,
    } as unknown as SchemaOperation,
    opLabel,
    index,
  );
}

function jobGraphAddParser(jobGraph: SchemaGreprJobGraph, parser: SchemaOperation, index: number): void {
  assertRawUiLogGraph(jobGraph, 'add-parser', index, [RAW_PRE_PARSER_FILTER, RAW_PRE_WAREHOUSE_FILTER]);
  assertOperationIdentity(parser, 'add-parser', index, 'parser');
  if (!RAW_PARSER_TYPES.has(parser.type as string)) {
    throw new Error(
      `Operation ${index} (add-parser): parser type "${parser.type}" is not supported for raw UI graph insertion`,
    );
  }
  if (findVertexIndexByName(jobGraph, parser.name) !== -1) {
    throw new Error(`Operation ${index} (add-parser): parser "${parser.name}" already exists`);
  }

  if (parser.type === RAW_JSON_PROCESSOR_TYPE) {
    if (parser.name !== RAW_JSON_PROCESSOR) {
      throw unsupportedRawShapeError(index, 'add-parser', `json processor must be named "${RAW_JSON_PROCESSOR}"`);
    }
    if (findVertexByName(jobGraph, RAW_JSON_PROCESSOR) || findVertexByType(jobGraph, RAW_JSON_PROCESSOR_TYPE)) {
      throw new Error(`Operation ${index} (add-parser): json-log-processor already exists in the raw graph`);
    }
    const successor = orderedParserNames(jobGraph, 'add-parser', index)[0] ?? RAW_PRE_WAREHOUSE_FILTER;
    return insertRawVertexBetween(jobGraph, parser, RAW_PRE_PARSER_FILTER, successor, 'add-parser', index);
  }

  if (parser.type === RAW_ATTRIBUTES_REMAPPER_TYPE) {
    if (parser.name !== RAW_ATTRIBUTES_REMAPPER) {
      throw unsupportedRawShapeError(index, 'add-parser', `attributes remapper must be named "${RAW_ATTRIBUTES_REMAPPER}"`);
    }
    if (findVertexByName(jobGraph, RAW_ATTRIBUTES_REMAPPER) || findVertexByType(jobGraph, RAW_ATTRIBUTES_REMAPPER_TYPE)) {
      throw new Error(`Operation ${index} (add-parser): log-attributes-remapper already exists in the raw graph`);
    }
    // Locate the json processor by type, not name: live UI graphs use suffixed
    // names (e.g. json_log_processor_1), and a name-only lookup would silently
    // fall back to RAW_PRE_PARSER_FILTER and wire the remapper before it.
    const jsonProcessor = findVertexByType(jobGraph, RAW_JSON_PROCESSOR_TYPE);
    const predecessor = jsonProcessor ? jsonProcessor.name : RAW_PRE_PARSER_FILTER;
    const successor = singleMainSuccessor(jobGraph, predecessor, 'add-parser', index);
    return insertRawVertexBetween(jobGraph, parser, predecessor, successor, 'add-parser', index);
  }

  const existingParserNames = orderedParserNames(jobGraph, 'add-parser', index);
  const predecessor = existingParserNames[existingParserNames.length - 1] ?? RAW_PRE_PARSER_FILTER;
  insertRawVertexBetween(jobGraph, parser, predecessor, RAW_PRE_WAREHOUSE_FILTER, 'add-parser', index);
}

function jobGraphRemoveParser(jobGraph: SchemaGreprJobGraph, name: string, index: number): void {
  assertRawUiLogGraph(jobGraph, 'remove-parser', index, [RAW_PRE_PARSER_FILTER, RAW_PRE_WAREHOUSE_FILTER]);
  const parser = findVertexByName(jobGraph, name);
  if (!parser) {
    throw new Error(`Operation ${index} (remove-parser): parser "${name}" not found in jobGraph.vertices`);
  }
  if (!RAW_PARSER_TYPES.has(parser.type as string)) {
    throw new Error(`Operation ${index} (remove-parser): vertex "${name}" is not a supported parser type`);
  }

  const incoming = parsedEdges(jobGraph).filter(edge => edge.targetVertex === name);
  const outgoing = parsedEdges(jobGraph).filter(edge => edge.sourceVertex === name);
  if (incoming.length !== 1 || outgoing.length !== 1) {
    throw unsupportedRawShapeError(
      index,
      'remove-parser',
      `parser "${name}" must have exactly one incoming and one outgoing edge`,
    );
  }

  removeVertexByName(jobGraph, name);
  removeEdgesTouching(jobGraph, name);
  const from = incoming[0] as ParsedGraphEdge;
  const to = outgoing[0] as ParsedGraphEdge;
  addEdgeIfMissing(jobGraph, from.sourceVertex, from.sourcePort, to.targetVertex, to.targetPort);
}

// --- Job-graph per-entry removals: anchor on the unique reducer/remapper/grok
// vertex (the add-path guards), then delegate to the shared remover. ---

function jobGraphRemoveMessageAttribute(vertices: SchemaOperation[], attributePath: string, index: number): void {
  const remapper = findUniqueVertexByType(vertices, LogAttributesRemapperType.log_attributes_remapper, 'remove-message-attribute', index);
  removeMessageAttributeFromRemapper(remapper as SchemaLogAttributesRemapper, attributePath, index);
}

function jobGraphRemoveGroupBy(vertices: SchemaOperation[], attributePath: string, index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'remove-group-by', index);
  removeGroupByFromReducer(reducer as SchemaLogReducer, attributePath, index);
}

function jobGraphRemoveAggregation(
  vertices: SchemaOperation[],
  attributePath: string,
  strategies: AggregationStrategy[] | undefined,
  index: number,
): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'remove-aggregation-strategy', index);
  removeAggregationFromReducer(reducer as SchemaLogReducer, attributePath, strategies, index);
}

/** Remove a raw `EventPredicate` from the reducer's `logReducerExceptions` (mirror of jobGraphAddReducerException). */
function jobGraphRemoveReducerException(vertices: SchemaOperation[], predicate: SchemaEventPredicate, index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'remove-reducer-exception', index) as SchemaLogReducer;
  const serialized = JSON.stringify(predicate);
  const existing = reducer.logReducerExceptions ?? [];
  const kept = existing.filter(p => JSON.stringify(p) !== serialized);
  if (kept.length === existing.length) {
    throw entryNotFoundError(index, 'remove-reducer-exception', 'matching reducer exception');
  }
  reducer.logReducerExceptions = kept;
}

function jobGraphRemoveGrokRule(vertices: SchemaOperation[], pattern: string, parserName: string | undefined, index: number): void {
  const grok = findJobGraphGrokParser(vertices, parserName, 'remove-grok-rule', index);
  removeGrokRuleFromParser(grok, pattern, index);
}

// --- Job-graph in-place vertex updates: replace the named vertex's config via
// replaceVertexByName, leaving edges/position untouched. ---

function jobGraphUpdateSource(jobGraph: SchemaGreprJobGraph, source: SchemaOperation, index: number): void {
  assertOperationIdentity(source, 'update-source', index, 'source');
  assertRawUiLogGraph(jobGraph, 'update-source', index, [RAW_PRE_PARSER_FILTER]);
  if (findVertexIndexByName(jobGraph, source.name) === -1) {
    throw new Error(`Operation ${index} (update-source): source "${source.name}" not found in jobGraph.vertices.`);
  }
  if (!isCanonicalRawSource(jobGraph, source.name)) {
    throw unsupportedRawShapeError(index, 'update-source', `vertex "${source.name}" is not a canonical UI source feeding ${RAW_PRE_PARSER_FILTER}`);
  }
  replaceVertexByName(jobGraph, source.name, source, 'update-source', index);
}

function jobGraphUpdateParser(jobGraph: SchemaGreprJobGraph, parser: SchemaOperation, index: number): void {
  assertOperationIdentity(parser, 'update-parser', index, 'parser');
  assertRawUiLogGraph(jobGraph, 'update-parser', index, [RAW_PRE_PARSER_FILTER, RAW_PRE_WAREHOUSE_FILTER]);
  const existing = findVertexByName(jobGraph, parser.name);
  if (!existing) {
    throw new Error(`Operation ${index} (update-parser): parser "${parser.name}" not found in jobGraph.vertices.`);
  }
  if (!RAW_PARSER_TYPES.has(existing.type as string)) {
    throw new Error(`Operation ${index} (update-parser): vertex "${parser.name}" is not a supported parser type.`);
  }
  if (!RAW_PARSER_TYPES.has(parser.type as string)) {
    throw new Error(`Operation ${index} (update-parser): replacement parser type "${parser.type}" is not supported for raw UI graph parsers.`);
  }
  replaceVertexByName(jobGraph, parser.name, parser, 'update-parser', index);
}

function jobGraphUpdateSink(
  jobGraph: SchemaGreprJobGraph,
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
): void {
  assertOperationIdentity(sink, 'update-sink', index, 'sink');
  assertSinkTargetShape(target, sink, filter, index, 'update-sink');
  if (target === 'processed-logs') {
    const existing = findIcebergSinkByRole(jobGraph, PROCESSED_LOGS_SINK_NAME_PREFIX, 'processed-logs', 'update-sink', 'update the sink', index);
    replaceVertexByName(jobGraph, existing.name, { ...sink, name: existing.name }, 'update-sink', index);
    return;
  }
  // vendor: anchor on the unique reducer (as add-sink does), then replace the named vendor sink.
  assertRawUiLogGraph(jobGraph, 'update-sink', index, [RAW_LOG_REDUCER]);
  const existing = findVertexByName(jobGraph, sink.name);
  if (!existing) {
    throw new Error(`Operation ${index} (update-sink): sink "${sink.name}" not found in jobGraph.vertices.`);
  }
  if (!VENDOR_LOG_SINK_TYPES.has(existing.type as string)) {
    throw new Error(`Operation ${index} (update-sink): vertex "${sink.name}" is not a vendor sink (type "${existing.type}").`);
  }
  replaceVertexByName(jobGraph, sink.name, sink, 'update-sink', index);
  if (filter !== undefined) {
    const filterName = `${sink.name}_filter`;
    if (!findVertexByName(jobGraph, filterName)) {
      throw new Error(
        `Operation ${index} (update-sink): sink "${sink.name}" has no generated gating filter "${filterName}" to update; ` +
          `use remove-sink + add-sink to introduce a gate.`,
      );
    }
    replaceRawFilterVertex(jobGraph, filterName, filter as unknown as Record<string, unknown>, 'update-sink', index);
  }
}

// --- Job-graph in-place updates of reducer-list entries: anchor on the unique
// reducer/remapper (as the add/remove paths do), then delegate to the shared updater. ---

function jobGraphUpdateMessageAttribute(vertices: SchemaOperation[], from: string, to: string, index: number): void {
  const remapper = findUniqueVertexByType(vertices, LogAttributesRemapperType.log_attributes_remapper, 'update-message-attribute', index);
  updateMessageAttributeOnRemapper(remapper as SchemaLogAttributesRemapper, from, to, index);
}

function jobGraphUpdateGroupBy(vertices: SchemaOperation[], from: string, to: string, index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'update-group-by', index);
  updateGroupByOnReducer(reducer as SchemaLogReducer, from, to, index);
}

function jobGraphUpdateAggregation(vertices: SchemaOperation[], attributePath: string, strategies: AggregationStrategy[], index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'update-aggregation-strategy', index);
  updateAggregationOnReducer(reducer as SchemaLogReducer, attributePath, strategies, index);
}

/** Replace the matching raw predicate in the reducer's `logReducerExceptions` in place (mirror of jobGraphAddReducerException). */
function jobGraphUpdateReducerException(vertices: SchemaOperation[], from: SchemaEventPredicate, to: SchemaEventPredicate, index: number): void {
  const reducer = findUniqueVertexByType(vertices, LogReducerType.log_reducer, 'update-reducer-exception', index) as SchemaLogReducer;
  const existing = reducer.logReducerExceptions ?? [];
  const idx = reducerExceptionUpdateIndex(existing.map(p => JSON.stringify(p)), from, to, index);
  existing[idx] = to;
  reducer.logReducerExceptions = existing;
}

function rawFilterNameForPhase(phase: FilterPhase, index: number, opLabel: string): string {
  switch (phase) {
    case 'pre-parser':
      return RAW_PRE_PARSER_FILTER;
    case 'pre-warehouse':
      return RAW_PRE_WAREHOUSE_FILTER;
    case 'pre-exceptions':
      return RAW_PRE_EXCEPTIONS_FILTER;
    case 'pre-aggregation':
      throw new Error(
        `Operation ${index} (${opLabel}): phase "pre-aggregation" has no canonical UI raw-graph stage. ` +
          `Use "pre-warehouse" or "pre-exceptions" for raw UI log graphs.`,
      );
  }
}

function assertRawUiLogGraph(
  jobGraph: SchemaGreprJobGraph,
  opLabel: string,
  index: number,
  requiredNames: string[],
): void {
  const seen = new Set<string>();
  for (const vertex of jobGraph.vertices) {
    if (typeof vertex.name !== 'string' || vertex.name.length === 0) {
      throw unsupportedRawShapeError(index, opLabel, 'every vertex must have a non-empty name');
    }
    if (seen.has(vertex.name)) {
      throw unsupportedRawShapeError(index, opLabel, `duplicate vertex name "${vertex.name}"`);
    }
    seen.add(vertex.name);
  }
  const missing = requiredNames.filter(name => !seen.has(name));
  if (missing.length > 0) {
    throw unsupportedRawShapeError(index, opLabel, `missing canonical vertex: ${missing.join(', ')}`);
  }
}

function unsupportedRawShapeError(index: number, opLabel: string, detail: string): Error {
  return new Error(
    `Operation ${index} (${opLabel}): unsupported raw job graph shape. ` +
      `UI-level topology edits require a canonical UI log pipeline graph; ${detail}.`,
  );
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

function findVertexByName(jobGraph: SchemaGreprJobGraph, name: string): SchemaOperation | undefined {
  return jobGraph.vertices.find(vertex => vertex.name === name);
}

function findVertexByType(jobGraph: SchemaGreprJobGraph, type: string): SchemaOperation | undefined {
  return jobGraph.vertices.find(vertex => vertex.type === type);
}

function findVertexIndexByName(jobGraph: SchemaGreprJobGraph, name: string): number {
  return jobGraph.vertices.findIndex(vertex => vertex.name === name);
}

function replaceVertexByName(
  jobGraph: SchemaGreprJobGraph,
  name: string,
  replacement: SchemaOperation,
  opLabel: string,
  index: number,
): void {
  const idx = findVertexIndexByName(jobGraph, name);
  if (idx === -1) {
    throw unsupportedRawShapeError(index, opLabel, `vertex "${name}" not found`);
  }
  jobGraph.vertices[idx] = replacement;
}

function removeVertexByName(jobGraph: SchemaGreprJobGraph, name: string): void {
  const idx = findVertexIndexByName(jobGraph, name);
  if (idx !== -1) {
    jobGraph.vertices.splice(idx, 1);
  }
}

interface ParsedGraphEdge {
  edge: string;
  index: number;
  sourceVertex: string;
  targetVertex: string;
  sourcePort: string;
  targetPort: string;
}

function graphEdges(jobGraph: SchemaGreprJobGraph): string[] {
  const graph = jobGraph as unknown as { edges?: string[] };
  if (!Array.isArray(graph.edges)) {
    graph.edges = []; // Lazily initializes edges to [] if absent — normalizes the schema type omission.
  }
  return graph.edges;
}

function parsedEdges(jobGraph: SchemaGreprJobGraph): ParsedGraphEdge[] {
  return graphEdges(jobGraph).map((edge, index) => ({ edge, index, ...parseEdge(edge) }));
}

/** True if any `logs-iceberg-table-sink` is reachable from `RAW_LOG_REDUCER` within two hops. */
function hasReducerFedIcebergSink(jobGraph: SchemaGreprJobGraph): boolean {
  const edges = parsedEdges(jobGraph);
  const reducerNeighbors = new Set(
    edges.filter(e => e.sourceVertex === RAW_LOG_REDUCER).map(e => e.targetVertex),
  );
  return jobGraph.vertices.some(
    v =>
      v.type === LOGS_ICEBERG_TABLE_SINK_TYPE &&
      (reducerNeighbors.has(v.name) ||
        edges.some(e => reducerNeighbors.has(e.sourceVertex) && e.targetVertex === v.name)),
  );
}

function formatEdge(sourceVertex: string, sourcePort: string, targetVertex: string, targetPort: string): string {
  const source = sourcePort === DEFAULT_EDGE_OUTPUT ? sourceVertex : `${sourceVertex}:${sourcePort}`;
  const target = targetPort === DEFAULT_EDGE_INPUT ? targetVertex : `${targetVertex}:${targetPort}`;
  return `${source} -> ${target}`;
}

function addEdgeIfMissing(
  jobGraph: SchemaGreprJobGraph,
  sourceVertex: string,
  sourcePort: string,
  targetVertex: string,
  targetPort: string,
): void {
  const candidate = formatEdge(sourceVertex, sourcePort, targetVertex, targetPort);
  const exists = parsedEdges(jobGraph).some(edge =>
    edge.sourceVertex === sourceVertex &&
    edge.sourcePort === sourcePort &&
    edge.targetVertex === targetVertex &&
    edge.targetPort === targetPort,
  );
  if (!exists) {
    graphEdges(jobGraph).push(candidate);
  }
}

function removeEdgesTouching(jobGraph: SchemaGreprJobGraph, name: string): void {
  const keep = graphEdges(jobGraph).filter(edge => {
    const parsed = parseEdge(edge);
    return parsed.sourceVertex !== name && parsed.targetVertex !== name;
  });
  (jobGraph as unknown as { edges: string[] }).edges = keep;
}

function removeEdgeAt(jobGraph: SchemaGreprJobGraph, index: number): void {
  graphEdges(jobGraph).splice(index, 1);
}

function insertRawVertexBetween(
  jobGraph: SchemaGreprJobGraph,
  vertex: SchemaOperation,
  predecessor: string,
  successor: string,
  opLabel: string,
  index: number,
): void {
  const directEdges = parsedEdges(jobGraph).filter(edge =>
    edge.sourceVertex === predecessor && edge.targetVertex === successor,
  );
  if (directEdges.length !== 1) {
    throw unsupportedRawShapeError(
      index,
      opLabel,
      `expected exactly one parser-chain edge ${predecessor} -> ${successor}`,
    );
  }
  const directEdge = directEdges[0] as ParsedGraphEdge;
  jobGraph.vertices.push(vertex);
  removeEdgeAt(jobGraph, directEdge.index);
  addEdgeIfMissing(jobGraph, predecessor, directEdge.sourcePort, vertex.name, DEFAULT_EDGE_INPUT);
  addEdgeIfMissing(jobGraph, vertex.name, DEFAULT_EDGE_OUTPUT, successor, directEdge.targetPort);
}

function orderedParserNames(jobGraph: SchemaGreprJobGraph, opLabel: string, index: number): string[] {
  const names: string[] = [];
  let current = RAW_PRE_PARSER_FILTER;
  const seen = new Set<string>([current]);

  while (current !== RAW_PRE_WAREHOUSE_FILTER) {
    const outgoing = parsedEdges(jobGraph).filter(edge => edge.sourceVertex === current);
    if (outgoing.length !== 1) {
      throw unsupportedRawShapeError(
        index,
        opLabel,
        `parser chain vertex "${current}" must have exactly one outgoing main-chain edge`,
      );
    }
    const next = (outgoing[0] as ParsedGraphEdge).targetVertex;
    if (next === RAW_PRE_WAREHOUSE_FILTER) {
      return names;
    }
    const nextVertex = findVertexByName(jobGraph, next);
    if (!nextVertex || !RAW_PARSER_TYPES.has(nextVertex.type as string)) {
      throw unsupportedRawShapeError(
        index,
        opLabel,
        `vertex "${next}" between ${RAW_PRE_PARSER_FILTER} and ${RAW_PRE_WAREHOUSE_FILTER} is not a supported parser`,
      );
    }
    if (seen.has(next)) {
      throw unsupportedRawShapeError(index, opLabel, `cycle detected at parser vertex "${next}"`);
    }
    names.push(next);
    seen.add(next);
    current = next;
  }
  return names;
}

function singleMainSuccessor(jobGraph: SchemaGreprJobGraph, name: string, opLabel: string, index: number): string {
  const outgoing = parsedEdges(jobGraph).filter(edge => edge.sourceVertex === name);
  if (outgoing.length !== 1) {
    throw unsupportedRawShapeError(index, opLabel, `vertex "${name}" must have exactly one outgoing main-chain edge`);
  }
  return (outgoing[0] as ParsedGraphEdge).targetVertex;
}

function isCanonicalRawSource(jobGraph: SchemaGreprJobGraph, name: string): boolean {
  const edges = parsedEdges(jobGraph);
  const hasIncoming = edges.some(edge => edge.targetVertex === name);
  const feedsPreParser = edges.some(edge =>
    edge.sourceVertex === name && edge.targetVertex === RAW_PRE_PARSER_FILTER,
  );
  return !hasIncoming && feedsPreParser;
}

function assertProposedTemplateHasSource(input: SchemaLogReducerTemplateInput): void {
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error('Proposed job graph has zero sources; a log pipeline must keep at least one source.');
  }
}

function assertProposedJobGraphHasSource(jobGraph: SchemaGreprJobGraph): void {
  if (!jobGraph.vertices.some(vertex => typeof vertex.name === 'string' && isCanonicalRawSource(jobGraph, vertex.name))) {
    throw new Error('Proposed job graph has zero sources; a log pipeline must keep at least one source.');
  }
}

function applyAddMessageAttribute(input: SchemaLogReducerTemplateInput, attributePath: string, index: number): void {
  const remapper = findRemapper(input);
  if (!remapper) {
    throw new Error(
      `Operation ${index} (add-message-attribute): no log-attributes-remapper in input.parsers. ` +
      `Template-backed pipelines normally include a remapper by default; if yours doesn't, add one via add-parser first.`,
    );
  }
  applyMessageAttributeToRemapper(remapper as SchemaLogAttributesRemapper, attributePath, index);
}

function applyAddGroupBy(input: SchemaLogReducerTemplateInput, attributePath: string, index: number): void {
  applyGroupByToReducer(input.reducer, attributePath, index);
}

function applyAddAggregation(
  input: SchemaLogReducerTemplateInput,
  attributePath: string,
  strategies: AggregationStrategy[],
  index: number,
): void {
  applyAggregationToReducer(input.reducer, attributePath, strategies, index);
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
  const grok = parserName
    ? parsers.find(p => p.name === parserName)
    : selectGrokParser(parsers.filter(p => p.type === GrokParserType.grok_parser), undefined, 'input.parsers', opLabel, index);
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

function applySetInputField(input: SchemaLogReducerTemplateInput, path: string, value: unknown, index: number): void {
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

function applyUnsetInputField(input: SchemaLogReducerTemplateInput, path: string, index: number): void {
  const parts = splitPath(path, index);
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

/**
 * Maps a `FilterPhase` (the op's hyphenated wire value, a key of the legacy
 * `LogReducerFilters`) to the corresponding `Transforms` slot. `pre-aggregation`
 * has no transforms slot and maps to `null`.
 */
const PHASE_TO_TRANSFORM_KEY: Record<FilterPhase, keyof SchemaTransforms | null> = {
  'pre-parser': 'preParser',
  'pre-warehouse': 'preWarehouse',
  'pre-exceptions': 'preExceptions',
  'pre-aggregation': null,
};

/**
 * Resolves the `Transforms` slot for a phase, throwing for `pre-aggregation`
 * (which has no chain slot in the transforms model).
 *
 * @param phase the filter phase from the op
 * @param index the operation index, for error messages
 * @param opLabel the op name, for error messages
 * @returns the matching `keyof SchemaTransforms`
 * @throws Error when the phase has no transforms slot
 */
function transformKeyForPhase(phase: FilterPhase, index: number, opLabel: string): keyof SchemaTransforms {
  const key = PHASE_TO_TRANSFORM_KEY[phase];
  if (!key) {
    throw new Error(
      `Operation ${index} (${opLabel}): phase "${phase}" has no transforms slot. ` +
        `Use "pre-parser", "pre-warehouse", or "pre-exceptions".`,
    );
  }
  return key;
}

/** True when the existing slot value is a keep-style filter (then keep / else drop), i.e. not inverted. */
function isInvertedConditionNode(node: SchemaConditionNode): boolean {
  return (
    node.thenAction?.kind === DropNodeKind.drop_node &&
    node.elseAction?.kind === PassthroughNodeKind.passthrough_node
  );
}

/**
 * Compiles a keep-style {@link SchemaLogsFilter} into the equivalent single
 * {@link SchemaConditionNode} chain: matching logs flow through, non-matching
 * are dropped (arms swap when the filter is `inverted`). Carries over the two
 * documented merge fields (`inverted`, `maxLateEventTimestampDelta`) from an
 * existing condition node when the incoming filter omits them, preserving
 * `set-filter`'s merge contract.
 *
 * @param filter the incoming logs-filter (predicate + optional inverted/lateness)
 * @param existing the current condition node in the slot, if any, for field carry-over
 * @returns a condition node that compiles to the same logs-filter vertex
 */
function filterToConditionNode(
  filter: SchemaLogsFilter,
  existing?: SchemaConditionNode,
): SchemaConditionNode {
  const keep: SchemaChainNode = { kind: PassthroughNodeKind.passthrough_node };
  const drop: SchemaChainNode = { kind: DropNodeKind.drop_node };
  const inverted =
    filter.inverted ?? (existing ? isInvertedConditionNode(existing) : false);
  const lateDataDuration = filter.maxLateEventTimestampDelta ?? existing?.lateDataDuration;
  return {
    kind: ConditionNodeKind.condition_node,
    predicate: filter.predicate ?? existing?.predicate ?? { type: DatadogQueryPredicateType.datadog_query, query: '' },
    thenAction: inverted ? drop : keep,
    elseAction: inverted ? keep : drop,
    ...(lateDataDuration ? { lateDataDuration } : {}),
  };
}

function applySetFilter(
  input: SchemaLogReducerTemplateInput,
  phase: FilterPhase,
  filter: SchemaLogsFilter,
  index: number,
): void {
  if (!filter || typeof filter !== 'object') {
    throw new Error(`Operation ${index} (set-filter): filter must be an object`);
  }
  const key = transformKeyForPhase(phase, index, 'set-filter');
  const existing = input.transforms?.[key];
  const node = filterToConditionNode(
    filter,
    existing?.kind === ConditionNodeKind.condition_node ? (existing as SchemaConditionNode) : undefined,
  );
  input.transforms = { ...(input.transforms ?? {}), [key]: node };
}

function applyClearFilter(input: SchemaLogReducerTemplateInput, phase: FilterPhase, index: number): void {
  const key = transformKeyForPhase(phase, index, 'clear-filter');
  if (!input.transforms?.[key]) return;
  const { [key]: _removed, ...rest } = input.transforms;
  input.transforms = rest;
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

// --- Template per-entry removals: resolve the same reducer/remapper/grok the add
// path writes, then delegate to the shared remover. ---

function applyRemoveMessageAttribute(input: SchemaLogReducerTemplateInput, attributePath: string, index: number): void {
  const remapper = findRemapper(input);
  if (!remapper) {
    throw new Error(`Operation ${index} (remove-message-attribute): no log-attributes-remapper in input.parsers.`);
  }
  removeMessageAttributeFromRemapper(remapper as SchemaLogAttributesRemapper, attributePath, index);
}

function applyRemoveGroupBy(input: SchemaLogReducerTemplateInput, attributePath: string, index: number): void {
  removeGroupByFromReducer(input.reducer, attributePath, index);
}

function applyRemoveAggregation(
  input: SchemaLogReducerTemplateInput,
  attributePath: string,
  strategies: AggregationStrategy[] | undefined,
  index: number,
): void {
  removeAggregationFromReducer(input.reducer, attributePath, strategies, index);
}

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

// --- Template in-place updates of reducer-list entries: resolve the same
// reducer/remapper the add/remove paths use, then delegate to the shared updater. ---

function applyUpdateMessageAttribute(input: SchemaLogReducerTemplateInput, from: string, to: string, index: number): void {
  const remapper = findRemapper(input);
  if (!remapper) {
    throw new Error(`Operation ${index} (update-message-attribute): no log-attributes-remapper in input.parsers.`);
  }
  updateMessageAttributeOnRemapper(remapper as SchemaLogAttributesRemapper, from, to, index);
}

function applyUpdateGroupBy(input: SchemaLogReducerTemplateInput, from: string, to: string, index: number): void {
  updateGroupByOnReducer(input.reducer, from, to, index);
}

function applyUpdateAggregation(input: SchemaLogReducerTemplateInput, attributePath: string, strategies: AggregationStrategy[], index: number): void {
  updateAggregationOnReducer(input.reducer, attributePath, strategies, index);
}

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

/** Validate the sink type matches the target and `filter` is vendor-only; shared by add-sink and update-sink on both backends. */
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
  // rawSinkConfig.datasetId is an override that takes precedence over input.datasetId
  // for the raw sink, so when it is set, update it too or the raw sink keeps writing
  // to the old dataset.
  const rawSinkConfig = input.rawSinkConfig;
  if (rawSinkConfig?.datasetId != null) {
    rawSinkConfig.datasetId = datasetId;
  }
}

/** Returns limitation strings for the user-facing draft preamble; non-empty when the patch touches sinks (external delivery is not verified). */
export function draftVerificationLimitations(patch: JobPatch): string[] {
  return patch.operations.some(op => touchesSinkConfig(op))
    ? ['Sink/data-lake output edits are submitted for graph/upstream verification only; external sink delivery is not verified.']
    : [];
}

/** Classify a patch by what it touches; recorded on the plan so consumers needn't recompute. */
export function classifyPatch(patch: JobPatch): PatchClassification {
  let source = false;
  let sink = false;
  for (const op of patch.operations) {
    if (touchesSourceConfig(op)) source = true;
    if (touchesSinkConfig(op)) sink = true;
  }
  if (source && sink) return 'mixed';
  if (source) return 'source';
  if (sink) return 'sink';
  return 'transform';
}

/**
 * What a write to each top-level `templateInputs.input` field touches. Keyed by
 * `keyof SchemaLogReducerTemplateInput` so the compiler forces every schema
 * field to be classified — a new field is a build error here, not a silent
 * `unknown`. `datasetId` is the raw-logs dataset (semantic equivalent of
 * set-raw-dataset).
 */
const INPUT_FIELD_TOUCHES: Record<keyof SchemaLogReducerTemplateInput, 'source' | 'sink' | 'transform'> = {
  sources: 'source',
  sinks: 'sink',
  processedLogsSink: 'sink',
  rawSinkConfig: 'sink',
  datasetId: 'sink',
  conditionalDatasets: 'sink',
  reducer: 'transform',
  parsers: 'transform',
  transforms: 'transform',
  exceptions: 'transform',
  sampler: 'transform',
};

/**
 * Classify a generic `set/unset-input-field` path by its top-level field.
 * Fails closed: an unrecognized field returns `unknown`, which callers treat as
 * touching both source and sink so the change routes to a conservative
 * (source-preserving, non-replay) draft rather than being misclassified
 * `transform` and previewed on a chain that never exercises it.
 */
function classifyInputPath(path: string): 'source' | 'sink' | 'transform' | 'unknown' {
  const top = (path.split('.')[0] ?? '').split('[')[0] ?? '';
  return (top in INPUT_FIELD_TOUCHES) ? INPUT_FIELD_TOUCHES[top as keyof SchemaLogReducerTemplateInput] : 'unknown';
}

function touchesSourceConfig(op: JobPatchOp): boolean {
  switch (op.op) {
    case 'add-source':
    case 'remove-source':
    case 'update-source':
      return true;
    case 'set-input-field':
    case 'unset-input-field': {
      const cls = classifyInputPath(op.path);
      return cls === 'source' || cls === 'unknown';
    }
    default:
      return false;
  }
}

function touchesSinkConfig(op: JobPatchOp): boolean {
  switch (op.op) {
    case 'add-sink':
    case 'remove-sink':
    case 'update-sink':
    case 'set-raw-dataset':
      return true;
    case 'set-input-field':
    case 'unset-input-field': {
      const cls = classifyInputPath(op.path);
      return cls === 'sink' || cls === 'unknown';
    }
    default:
      return false;
  }
}

/**
 * Find the single `template-operation` vertex (exactly one per template-backed
 * job); throws on 0 (non-template) or >1 (unsupported). Accepts `SchemaReadJob`
 * or `SchemaUpdateJob` without casts.
 */
export function findTemplateOperation(job: { jobGraph?: { vertices?: SchemaOperation[] } }): SchemaOperation & { draftMode?: boolean; templateInputs?: Record<string, unknown> } {
  const vertices = job.jobGraph?.vertices;
  if (!Array.isArray(vertices)) {
    throw new Error('Job has no jobGraph');
  }
  const matches = vertices.filter(v => v.type === TemplateOperationType.template_operation);
  if (matches.length === 0) {
    throw new Error(
      `Pipeline is not template-backed (no template-operation vertex). ` +
        `This helper only applies to template-backed pipelines.`,
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

function readTemplateInput(templateOp: { templateInputs?: Record<string, unknown> }): SchemaLogReducerTemplateInput {
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

function findRemapper(input: SchemaLogReducerTemplateInput): SchemaOperation | undefined {
  return input.parsers.find(p => p.type === LogAttributesRemapperType.log_attributes_remapper);
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
