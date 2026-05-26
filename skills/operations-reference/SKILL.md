---
description: Reference for available Grepr operations - sources, transforms, and sinks. Use this when you need to know what operations are available for job graphs.
trigger_keywords:
  - available operations
  - what sources
  - what sinks
  - what transforms
  - operation types
  - grepr operations
  - pipeline operations
---

# Grepr Operations Reference

This skill provides a reference for all available operations that can be used in Grepr job graphs.

## Pipeline Edit Contract

Job edits emitted by Claude/CLI skills use the `JobEditOperation`
JSON contract, currently represented on disk as:

```json
{ "operations": [ { "op": "<operation-name>" } ] }
```

`job:edit`, `job:plan`, `job:draft`, and `job:apply` consume that patch
shape. Backend support:

- Template-backed pipelines mutate `templateInputs.input`; the semantic
  edit surface is the canonical path.
- Direct job graphs mutate the resolved graph. Existing-vertex field ops
  are allowed when the target is unambiguous.
- UI-level topology ops on direct job graphs are allowed only for canonical
  UI-shaped log graphs. Non-UI raw DAGs reject with `unsupported raw job
  graph shape`.

Common operations:

| Op | Purpose |
|----|---------|
| `add-message-attribute` | Add a remapper message reserved attribute/path. |
| `add-group-by` | Add a reducer partition/group-by attribute/path. |
| `add-aggregation` | Add reducer aggregation strategy entries. |
| `add-reducer-exception` | Add a reducer query exception. |
| `add-grok-rule` | Append a rule to an existing grok parser. |
| `set-filter` / `clear-filter` | Set or clear a phase-slotted filter. |
| `add-parser` / `remove-parser` | Add or remove a parser in the parser chain. |
| `add-source` / `remove-source` | Add or remove source vertices. |
| `set-input-field` / `unset-input-field` | Template-input escape hatch only; not supported on raw job graphs. |

Draft behavior:

- Template-backed drafts use server draft mode and per-stage `draftOutputs`.
- Raw transform-only drafts use iceberg replay and `sink-source` stage tags.
- Raw source/output-touching drafts preserve proposed sources, remove
  production sinks, and add sync/tap outputs.
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
| `otel-log-source` | Receive logs via OpenTelemetry protocol | `integrationId` |

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
| `sql-transform` | Transform with SQL queries | `sqlQuery` |

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

For complete schema documentation, use:

```bash
grepr docs:search --type schema "<operation-name>"
grepr docs:get "schema://<OperationName>"
```

Example:
```bash
grepr docs:search --type schema "grok-parser"
grepr docs:get "schema://GrokParser"
```
