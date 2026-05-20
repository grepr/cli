---
description: Summarize the structure of a Grepr pipeline — sources, transforms, sinks, datasets, integrations, filters, grok parsers, reducer settings, exceptions, and current state. Use as foundational context before making any change to a pipeline.
allowed-tools: Bash(grepr job:get), Bash(grepr job:list), grepr:job-commands, grepr:grepr-model, grepr:operations-reference
trigger_keywords:
  - describe pipeline
  - pipeline summary
  - what's in this pipeline
  - inspect pipeline
  - pipeline structure
  - explain pipeline
---

# Describe a Grepr Pipeline

This is a read-only skill. It produces a structured summary of a pipeline's
job graph so you (and downstream skills like `tune-reduction` or
`test-pipeline-change`) can reason about changes against accurate context.

Always run `describe-pipeline` before proposing edits — otherwise you risk
referencing vertices or fields that don't exist in this specific pipeline.

## When to Use

- Before any `pipeline:edit` patch — confirm which vertices exist and what
  fields are populated.
- When the user says "what does this pipeline do?" or "show me the
  configuration."
- As a building block for other skills (they invoke this first).

## Step 1: Fetch the Resolved Job

```bash
grepr job:get <JOB_ID> --resolved -f raw
```

`--resolved` is critical. A pipeline built from a template (the common case)
ships its config as template inputs that get expanded server-side at runtime.
The resolved form is what's actually running — and what `pipeline:edit`
operates on.

## Step 2: Categorize Vertices

Split `jobGraph.vertices` by role using the `type` field:

| Category    | Example `type` values                                                                                                                          |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| Sources     | `logs-iceberg-table-source`, `datadog-log-agent-source`, `datadog-log-cloud-source`, `splunk-log-source`, `otlp-log-source`, `grepr-vendor-source` |
| Filters     | `logs-filter`                                                                                                                                  |
| Parsers     | `json-log-processor`, `grok-parser`                                                                                                            |
| Remapper    | `log-attributes-remapper`                                                                                                                      |
| Reducer     | `log-reducer`                                                                                                                                  |
| SQL         | `sql-operation`                                                                                                                                |
| Branches    | `logs-branch`                                                                                                                                  |
| Transforms  | `log-transform`, `pattern-matcher`, `log-rules-application`                                                                                    |
| Sinks       | `logs-iceberg-table-sink`, `datadog-log-sink`, `splunk-log-sink`, `newrelic-log-sink`, `sumo-log-sink`, `otlp-log-sink`, `logs-sync-sink`        |

If you see a type not in this list, fall back to `grepr:operations-reference`
to identify its role.

## Step 3: Extract Key Fields per Category

Produce a summary like the template below. Only include fields that are
populated — keep the output focused.

### Sources

For each source vertex, report:
- name, type
- integrationId (if any) — useful for linking to a vendor account
- datasetId (if iceberg) — the raw data lake table
- query/predicate (if any)
- time window / start / end (for batch sources)

### Filters

For each `logs-filter`, report:
- name, position in the graph (which edge it sits on)
- predicate type and query string

### Parsers

For each `grok-parser`, report:
- name
- patterns or rules count
- target attributes (if any)

### Remapper (log-attributes-remapper)

Report:
- `messageReservedAttributes` (flat names) and `messageReservedAttributePaths` (nested)
- `serviceReservedAttributes` / paths
- `hostReservedAttributes` / paths
- count of `attributeRemappingRules` (and a couple of sample rules)

### Reducer (log-reducer)

Report:
- `dedupThreshold`
- `similarityThreshold`
- `reductionTimeWindow`
- `partitionByAttributes` / `partitionByAttributePaths` / `partitionByTags`
- `attributeMergeStrategyEntries` (path + strategy type)
- `logReducerExceptions` (count + a sample predicate or two)
- `integrationExceptionConfigs` (vendor-imported exceptions)

### Sinks

For each sink:
- name, type
- integrationId (if any) — the destination vendor
- datasetId (if iceberg)
- any sink-level filter/predicate

### Job-Level State

- `id`, `name`, `version`
- `desiredState`, `state`
- `execution` / `processing`
- `updatedAt`, `editedBy`
- `tags`

### Edges (Topology)

Print the edges as-is, or convert them into a flow graph showing how data
moves source → … → sink.

## Step 4: Output Format

Use markdown sections per category. Wrap field values in inline code so the
user can grep them. Example shape:

```
# Pipeline: prod_log_reducer (job_abc123 — version 42, RUNNING)

## Sources
- `datadog-log-agent-source` `dd_source` — integration `int_dd_1`

## Transforms
- `log-attributes-remapper` `log_attributes_remapper`
  - messageReservedAttributes: `["message", "msg", "log"]`
  - messageReservedAttributePaths: `[["body", "message"]]`
- `log-reducer` `log_reducer`
  - dedupThreshold: `4`
  - partitionByAttributePaths: `[["msg", "operationName"]]`
  - logReducerExceptions: 2 (`status:error`, `severity:critical`)

## Sinks
- `logs-iceberg-table-sink` `warehouse_sink` — dataset `ds_prod_42`
- `datadog-log-sink` `dd_sink` — integration `int_dd_1`

## Topology
dd_source -> log_attributes_remapper
log_attributes_remapper -> log_reducer
log_reducer -> warehouse_sink
log_reducer -> dd_sink
```

## What to Skip

- Internal masks / token regexes on the reducer (massive defaults, almost
  never customized — surface only if they're non-default).
- Auto-generated test-tag vertices from prior test runs.
- Generic edges between unnamed branch outputs.

## Common Follow-ups

After describing, you'll usually route to:
- `tune-reduction` — if the user is asking about reduction quality
- `test-pipeline-change` — if the user has an edit in mind
- `grepr:debug-pipeline` — if the pipeline is misbehaving (not just
  misconfigured)
