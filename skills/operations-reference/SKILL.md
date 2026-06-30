---
description: Canonical reference for Grepr pipeline operations — the JobPatch op catalog (exact op names and required fields) plus the available sources, transforms, and sinks. Use whenever you need to know what operations or fields are valid for a job graph or a job:plan patch.
---

# Grepr Operations Reference

This skill provides a reference for all available operations that can be used in Grepr job graphs.

## Pipeline Edit Contract

Pipeline edits emitted by Claude/CLI skills use the `JobPatch` JSON
contract — a list of typed operations on disk:

```json
{ "operations": [ { "op": "<operation-name>" } ] }
```

The root key is `operations` (not `ops`). `job:plan` consumes this patch
shape and writes a plan file (`--dry-run` previews the diff). `job:draft`
and `job:apply` consume the generated plan file. Backend support:

- Template-backed pipelines mutate `templateInputs.input`; the semantic
  edit surface is the canonical path.
- Direct job graphs mutate the resolved graph. Existing-vertex field ops
  are allowed when the target is unambiguous.
- UI-level topology ops on direct job graphs are allowed only for canonical
  UI-shaped log graphs. Non-UI raw DAGs reject with `unsupported raw job
  graph shape`.

Operations (exact field names matter — field mistakes fail during
`job:plan` with op-specific errors):

| Op | Required fields | Purpose |
|----|-----------------|---------|
| `add-message-attribute` | `attributePath` | Add a remapper message reserved attribute/path. |
| `add-group-by` | `attributePath` | Add a reducer partition/group-by attribute/path. Append-only (no `remove-group-by`). |
| `add-aggregation-strategy` | `attributePath`, `strategies` | Add a reducer aggregation strategy. `strategies` is an array of `sum`/`min`/`max`/`avg` — not a scalar, not `"average"`. **One strategy per attribute path**: pass a single-element array (e.g. `["avg"]`). Passing `["min","max","avg"]` expands to three entries sharing the same path, which the backend rejects at draft/apply with `Duplicate attribute paths in merge strategies are not allowed`. Append-only. |
| `add-reducer-exception` | `predicate` | Add a reducer exception (matching logs bypass aggregation). Only `predicate` is required — there is no `name` field. |
| `add-grok-rule` | `pattern` (not `rule`); optional `parserName`, `extractAttribute` | Append a rule to a grok parser. `parserName` is required only when more than one grok parser exists; rejected if zero exist. |
| `set-filter` / `clear-filter` | `phase` (not `stage`); `set` also needs `filter` | Set or clear a phase-slotted filter. **Raw job graph:** replaces the canonical filter vertex; `clear-filter` keeps the vertex but blanks the predicate query. **Template-backed:** writes a transform-chain gate (`condition-node` → `passthrough-node`/`drop-node`) into the phase's `transforms` slot; `set` preserves any existing non-filter chain (e.g. a SQL node) as the pass side, `clear` unwraps a simple root gate and errors on a branching chain. `filter.predicate` is a generic `EventPredicate` (not necessarily `datadog-query`); `maxLateEventTimestampDelta`/`inverted` are honored. **Predicate validation diverges by backend:** the template path requires `filter.predicate` and rejects a predicate-omitted `set-filter`; the raw path does not validate the predicate. Always supply `filter.predicate` (omit only `inverted`/`maxLateEventTimestampDelta` to inherit them). |
| `set-transform-chain` / `clear-transform-chain` | `phase`; `set` also needs `root` | **Template-backed only** (rejected on raw job graphs). Replace (`set`) or remove (`clear`) a phase's entire `transforms` chain. `root` is a hand-authored chain node (`condition-node`/`sql-node`/`passthrough-node`/`drop-node`). Use when you need to preserve or merge a complex chain that the semantic filter/SQL ops would overwrite. |
| `set-sql-transform` | `phase`, `sqlOperation`, `outputRouting`, `mainStream`; optional `gate` | **Template-backed only** (rejected on raw job graphs with a template-only message). Replace a phase's `transforms` chain with one generated `sql-node` chain. `mainStream: "drop"` drops originals after SQL input; `"passthrough"` keeps originals flowing. With `gate`, non-matching events pass through unchanged. See the `sql-operation` shape below. |
| `add-parser` / `remove-parser` | `parser` / `name` (not `parserName`) | Add or remove a parser. New parsers append before `pre_data_warehouse_filter`. |
| `add-source` / `remove-source` | `source` / `name` (not `sourceName`) | Add or remove source vertices. A proposal leaving zero sources is rejected. |
| `add-sink` / `remove-sink` | `target` (`vendor`\|`processed-logs`), `sink` / `name?` | Add or remove a sink. `vendor` adds a vendor log sink (optionally with a gating `filter`); `processed-logs` sets the single reduced-logs iceberg sink. |
| `set-raw-dataset` | `datasetId` | Point the raw-logs dataset at a different dataset ID. |
| `set-input-field` / `unset-input-field` | `path`, `value` / `path` | Template-input escape hatch only (dot-notation, object keys not array indices); rejected on raw job graphs. |

Every `phase`-bearing op above (`set-filter`, `clear-filter`,
`set-transform-chain`, `clear-transform-chain`, `set-sql-transform`) accepts
`pre-parser`, `pre-warehouse`, or `pre-exceptions`.

A plan's `classification` field summarizes what the patch touches:
`transform`, `source`, `sink`, or `mixed`. Harness skills use it to decide
the validation path.

Draft behavior:

- Template-backed drafts use server draft mode and per-stage `draftOutputs`.
- Raw job-graph drafts use source-preserving live draft for all
  classifications. Data records are wrapped under `.data`; tap tags are
  nested at `.data.tags["sink-source"][]`. Some untagged `.data` records
  from direct sync outputs are expected. Bounded by `--sample-rate`
  (default `10/sec/source`), `--sample-burst` (default `1000/source`), and
  `--max-duration-seconds` (default `30s`); always pass
  `--max-duration-seconds 30` explicitly.
- Sink/data-lake output edits are graph/upstream verification only; external
  sink delivery is not verified by sync draft.

## Sources (Data Input)

Sources have no inputs and produce log events as output.

### Vendor Agent Sources (Streaming)

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `datadog-log-agent-source` | Receive logs from Datadog agents | `integrationId` |
| `splunk-log-agent-source` | Receive logs from Splunk forwarders | `integrationId` |
| `newrelic-log-agent-source` | Receive logs from New Relic agents | `integrationId` |
| `sumologic-log-agent-source` | Receive logs from Sumo Logic collectors | `integrationId` |
| `otlp-log-agent-source` | Receive logs via OpenTelemetry protocol | `integrationId` |

### Data Lake Sources (Batch)

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `logs-iceberg-table-source` | Query Iceberg table via Flink (supports transforms) | `datasetId`, `start`, `end`, `query`, `limit` |
| `grepr-raw-log-source` | Query via Athena (faster, direct to sync-sink only) | `datasetId`, `start`, `end`, `query`, `limit` |

### Test Sources

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `logs-values-source` | Inject inline sample log events | `values` (array of log events) |

## Transforms (Data Processing)

Transforms process log events and produce modified events.

### Filtering & Routing

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `logs-filter` | Filter events by predicate (drop non-matching) | `predicate` |
| `logs-branch` | Route events to different paths | `predicate` (outputs: default, else) |
| `logs-event-sampler` | Rate limit events | `maxAllowedRate`, `maxBurstLimit`, `filter` |

### Parsing & Extraction

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `grok-parser` | Parse unstructured logs with Grok patterns | `grokParsingRules`, `grokHelperRules`, `predicate` |
| `json-log-processor` | Parse JSON in message field | `maxNestedDepthForFields` |
| `keyvalue-processor` | Extract key=value pairs from message | `fieldSeparator`, `valueSeparator` |

### Field Manipulation

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `log-attributes-remapper` | Remap attributes to tags or top-level fields | (auto-configured) |
| `sql-operation` | Transform with a sequence of SQL statements | `name`, `statements` (see below), `inputs?`, `availableDatasets?`, `globalStateTtl?`, `watermarkDelay?` |

#### `sql-operation` shape

A `sql-operation` runs an ordered list of `statements`.
The common statement types are:

- `sql_view` — `tableName`, `sqlQuery`, `materialized?`. Creates an intermediate
  (optionally materialized) table later statements can query.
- `sql_output` — `outputName`, `outputType`, `sqlQuery`. Produces a named output
  stream. There must be at least one, and `outputName`s must be unique.

`inputs` maps input table names to event types and `sql_output.outputType` sets
the output stream's type; for log-reducer pipelines that is `LOG_EVENT`, as in
the example below.

For template-backed jobs, install a `sql-operation` with `set-sql-transform`
(do **not** write a legacy `sqlOperations` template input). Its `outputRouting`
maps each `sql_output.outputName` to a downstream step: `json-log-processor`,
`grok-parser`, `data-warehouse`, `log-reducer`, or `sinks`. Every `sql_output`
must have exactly one route. `mainStream` controls the original event stream:
use `"drop"` for replacement/redaction transforms, and `"passthrough"` for
side-output SQL. Example:

```json
{
  "op": "set-sql-transform",
  "phase": "pre-warehouse",
  "sqlOperation": {
    "type": "sql-operation",
    "name": "normalize_errors",
    "inputs": { "logs": "LOG_EVENT" },
    "statements": [
      { "type": "sql_view", "tableName": "errors", "sqlQuery": "SELECT * FROM logs WHERE severity >= 13", "materialized": false },
      { "type": "sql_output", "outputName": "critical_errors", "outputType": "LOG_EVENT", "sqlQuery": "SELECT * FROM errors WHERE message LIKE '%CRITICAL%'" }
    ],
    "availableDatasets": []
  },
  "outputRouting": { "critical_errors": "sinks" },
  "mainStream": "passthrough",
  "gate": { "type": "datadog-query", "query": "service:api" }
}
```

### Aggregation & Reduction

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `log-reducer` | Deduplicate and aggregate similar logs | `similarityThreshold`, `partitionByTags`, `reductionTimeWindow` |

## Sinks (Data Output)

Sinks consume log events and send them to destinations.

### Data Lake Sinks

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `logs-iceberg-table-sink` | Write to Iceberg table in data lake | `datasetId` |

### Vendor Sinks

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `datadog-log-sink` | Forward logs to Datadog | `integrationId`, `additionalTags` |
| `splunk-log-sink` | Forward logs to Splunk | `integrationId` |
| `newrelic-log-sink` | Forward logs to New Relic | `integrationId` |
| `sumologic-log-sink` | Forward logs to Sumo Logic | `integrationId` |

### Sync Sinks

| Operation | Description | Key Properties |
|-----------|-------------|----------------|
| `logs-sync-sink` | Stream results back to caller (sync jobs only) | (none) |

## Operation Details

### grok-parser

Parses unstructured log messages using Grok patterns.

```json
{
  "type": "grok-parser",
  "name": "my_parser",
  "grokParsingRules": [
    "rule_name %{pattern:field_name} %{pattern:another_field}"
  ],
  "grokHelperRules": [
    "helper_name %{pattern}"
  ],
  "predicate": {
    "type": "datadog-query",
    "query": "service:my-service"
  }
}
```

**Notes:**
- Each rule must have a name followed by the pattern
- Use `predicate` to only parse matching logs (improves performance)
- Can extract to `attributes`, `tags`, or top-level fields

### logs-filter

Filters events, keeping only those matching the predicate.

```json
{
  "type": "logs-filter",
  "name": "remove_debug",
  "predicate": {
    "type": "datadog-query",
    "query": "-status:debug"
  }
}
```

### logs-branch

Routes events to different paths based on predicate.

```json
{
  "type": "logs-branch",
  "name": "branch_by_source",
  "predicate": {
    "type": "datadog-query",
    "query": "source:nginx"
  }
}
```

**Edges:**
- `branch_by_source -> nginx_handler` (matches predicate)
- `branch_by_source:else -> default_handler` (doesn't match)

### logs-event-sampler

Rate limits events to prevent overwhelming downstream systems.

```json
{
  "type": "logs-event-sampler",
  "name": "rate_limiter",
  "maxAllowedRate": 10.0,
  "maxBurstLimit": 100,
  "filter": {
    "type": "datadog-query",
    "query": "service:my-service"
  }
}
```

**Required for:** Synchronous streaming jobs

### log-reducer

Deduplicates and aggregates similar log messages.

```json
{
  "type": "log-reducer",
  "name": "reducer",
  "similarityThreshold": 80.0,
  "partitionByTags": ["service", "host"],
  "partitionByAttributes": ["http.method"],
  "reductionTimeWindow": "PT120S",
  "dedupThreshold": 5,
  "samplingConfig": {
    "type": "window-based-logarithmic-sampling",
    "logarithmBase": 2
  }
}
```

### logs-iceberg-table-source

Queries data from the Grepr data lake.

```json
{
  "type": "logs-iceberg-table-source",
  "name": "source",
  "datasetId": "abc123",
  "start": "2024-01-01T00:00:00Z",
  "end": "2024-01-02T00:00:00Z",
  "query": {
    "type": "datadog-query",
    "query": "service:api status:error"
  },
  "limit": 1000,
  "sortOrder": "DESC"
}
```

### logs-values-source

Injects sample log events for testing.

```json
{
  "type": "logs-values-source",
  "name": "test_data",
  "values": [
    {
      "message": "Test log message",
      "tags": { "service": ["test"] },
      "severity": 9,
      "attributes": { "user": { "id": "123" } }
    }
  ]
}
```

## Predicate Types

Most filtering operations use predicates to match events.

### datadog-query

Uses Datadog-like query syntax:

```json
{
  "type": "datadog-query",
  "query": "service:api AND status:error"
}
```

**Syntax:**
- `tag:value` - Match tag
- `@attribute:value` - Match attribute
- `word` - Search in message
- `AND`, `OR`, `NOT` - Logical operators
- `-tag:value` - Exclude (NOT)
- `*` - Wildcard

## Finding Schema Details

```bash
grepr docs:search --type schema "<operation-name>"
grepr docs:get "schema://<OperationName>"
```

Example:

```bash
grepr docs:search --type schema "grok-parser"
grepr docs:get "schema://GrokParser"
