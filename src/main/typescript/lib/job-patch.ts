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
  SchemaLogsFilter,
  SchemaLogsIcebergTableSink,
  SchemaLogReducer,
  SchemaLogAttributesRemapper,
  SchemaGrokParser,
  SchemaTemplateQueryException,
  LogAttributesRemapperType,
  LogReducerType,
  GrokParserType,
  LogsFilterType,
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
      return applyClearFilter(input, op.phase);
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
  const groks = vertices.filter(v => v.type === GrokParserType.grok_parser);
  const grok = selectGrokParser(groks, parserName, 'jobGraph.vertices', index);
  if (!grok) {
    throw new Error(
      `Operation ${index} (add-grok-rule): ${parserName ? `grok-parser "${parserName}" not found` : 'no grok-parser vertex found in jobGraph.vertices'}. ` +
        `Add a grok-parser vertex via 'grepr job:update' before using add-grok-rule on this pipeline.`,
    );
  }
  applyGrokRuleToParser(grok as SchemaGrokParser, pattern, extractAttribute);
}

function selectGrokParser(
  groks: SchemaOperation[],
  parserName: string | undefined,
  location: string,
  index: number,
): SchemaOperation | undefined {
  if (parserName) {
    return groks.find(parser => parser.name === parserName);
  }
  if (groks.length > 1) {
    throw new Error(
      `Operation ${index} (add-grok-rule): found ${groks.length} grok parsers in ${location}; ` +
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
  assertSinkTargetShape(target, sink, filter, index);
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
  const parsers = input.parsers;
  const grok = parserName
    ? parsers.find(p => p.name === parserName)
    : selectGrokParser(
        parsers.filter(p => p.type === GrokParserType.grok_parser),
        undefined,
        'input.parsers',
        index,
      );
  if (!grok) {
    throw new Error(
      `Operation ${index} (add-grok-rule): ${parserName ? `parser "${parserName}" not found` : 'no grok-parser found in input.parsers'}. ` +
        `If you need to introduce one, use add-parser first.`,
    );
  }
  if (grok.type !== GrokParserType.grok_parser) {
    throw new Error(`Operation ${index} (add-grok-rule): parser "${grok.name}" is not a grok-parser`);
  }
  applyGrokRuleToParser(grok as SchemaGrokParser, pattern, extractAttribute);
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

function applySetFilter(
  input: SchemaLogReducerTemplateInput,
  phase: FilterPhase,
  filter: SchemaLogsFilter,
  index: number,
): void {
  if (!filter || typeof filter !== 'object') {
    throw new Error(`Operation ${index} (set-filter): filter must be an object`);
  }
  const filters: SchemaLogReducerFilters = input.filters ?? {};
  filters[phase] = { ...(filters[phase] ?? {}), ...filter };
  input.filters = filters;
}

function applyClearFilter(input: SchemaLogReducerTemplateInput, phase: FilterPhase): void {
  const filters: SchemaLogReducerFilters = input.filters ?? {};
  const existing = filters[phase];
  if (!existing || typeof existing !== 'object') return;
  filters[phase] = { ...existing, predicate: { type: DatadogQueryPredicateType.datadog_query, query: '' } };
  input.filters = filters;
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


/** Reject a `target` not in {@link SinkTarget}; a typo like `"processed-log"` would otherwise fall through to the processed-logs branch. */
function assertValidSinkTarget(target: string, opLabel: string, index: number): asserts target is SinkTarget {
  if (target !== 'vendor' && target !== 'processed-logs') {
    throw new Error(
      `Operation ${index} (${opLabel}): target must be "vendor" or "processed-logs", got ${JSON.stringify(target)}.`,
    );
  }
}

/** Validate the sink type matches the target and `filter` is vendor-only; shared by both backends. */
function assertSinkTargetShape(
  target: SinkTarget,
  sink: SchemaOperation,
  filter: SchemaLogsFilter | undefined,
  index: number,
): void {
  assertValidSinkTarget(target, 'add-sink', index);
  if (target === 'vendor') {
    if (!VENDOR_LOG_SINK_TYPES.has(sink.type as string)) {
      throw new Error(
        `Operation ${index} (add-sink): vendor sink type "${sink.type}" is not supported. ` +
          `Supported: ${[...VENDOR_LOG_SINK_TYPES].join(', ')}.`,
      );
    }
    return;
  }
  // processed-logs
  if (sink.type !== LOGS_ICEBERG_TABLE_SINK_TYPE) {
    throw new Error(
      `Operation ${index} (add-sink): target "processed-logs" requires a ${LOGS_ICEBERG_TABLE_SINK_TYPE} sink, got "${sink.type}".`,
    );
  }
  if (filter !== undefined) {
    throw new Error(
      `Operation ${index} (add-sink): filter is only supported for target "vendor"; ` +
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
  assertSinkTargetShape(target, sink, filter, index);
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
  filters: 'transform',
  exceptions: 'transform',
  sampler: 'transform',
  sqlOperations: 'transform',
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
}

function addUniqueString(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

function addUniqueStringArray(list: string[][], value: string[]): void {
  if (!list.some(existing => arraysEqual(existing, value))) {
    list.push(value);
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
