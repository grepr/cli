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

- Before any pipeline patch (`job:plan`) — confirm which vertices exist and
  what fields are populated.
- When the user says "what does this pipeline do?" or "show me the
  configuration."
- As a building block for other skills (they invoke this first).

## Step 1: Resolve to a Job ID

`job:get` requires the job ID, not the pipeline name. If the user gave you a
name (or you're not sure which they gave you), list jobs and find the matching
`id` first — don't call `job:get <name>` and let it 404:

```bash
grepr job:list -f raw 2>&1 | head -200
```

Match the user's input against either the `id` or `name` field, then use the
`id` for the next step.

## Step 2: Fetch the Resolved Job

```bash
grepr job:get <JOB_ID> --resolved -f raw
```

`--resolved` is what makes the rest of this skill possible. Template-backed
pipelines (the common case) carry their config as template inputs that get
expanded server-side; the resolved form is what's actually running, with all
vertex names and edges visible.

**Important callout for the user**: the resolved view's vertex names often
carry a `template_operation__` prefix (or similar) — that's a template
expansion artifact, not something they'd reference in a patch. **Edits go
through `tune-reduction` / `tune-grok` / `change-*` skills, which operate on
template inputs, not resolved vertex names.** Note this clearly in your
output so a reader doesn't try to write a patch referencing
`template_operation__log_reducer` by name.

## Step 2a: Detect the Backend Format

Check whether the pipeline is template-backed or a direct job graph. The
detection is a quick scan over `jobGraph.vertices`:

- **Template-backed**: at least one vertex has `type: "template-operation"`.
  These are the canonical pipelines — edits route through `job:plan` /
  `job:apply` against `templateInputs.input`, and `job:draft` gets
  per-stage tags from the server.
- **Direct job graph**: no `template-operation` vertex; the parser /
  remapper / reducer / grok-parser are bare vertices in the graph. Edits
  still go through the same `job:plan` / `job:apply` CLI commands
  - the CLI mutates the resolved graph directly. Existing-vertex field ops
  (`add-message-attribute`, `add-group-by`, `add-aggregation-strategy`,
  `add-reducer-exception`, `add-grok-rule`) are supported when the target
  vertex is unambiguous. UI-level topology ops (`set-filter`,
  `clear-filter`, `add-source`, `remove-source`, `add-parser`,
  `remove-parser`) are supported only when the graph matches the canonical
  UI log-pipeline shape. Non-UI raw DAGs reject those ops with
  `unsupported raw job graph shape`.

For direct job graphs, `job:draft` has two modes:
- Transform-only edits use iceberg replay and client-side taps tagged with
  `sink-source`.
- Source/output-touching edits preserve the proposed source vertices,
  remove production sinks, and add sync/tap outputs. Output edits verify
  graph/upstream behavior only; external sink delivery is not verified.

Surface the backend in the TL;DR (see below) so downstream skills don't
have to re-detect.

## Step 3: Categorize Vertices

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

## Step 4: Extract Key Fields per Category

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

Render the graph as an **indented tree** with arrows. This reads dramatically
better than the flat `a -> b\nb -> c\n…` edge list when a vertex has multiple
downstream children (the common case for branched pipelines).

Conventions:
- Root: source vertex (no parent edges).
- Use `└─>` for the only or last child of a node, `├─>` for non-last
  siblings, and align children under their parent.
- Annotate each leaf and branch endpoint inline, in parentheses: `(iceberg
  — raw)`, `(DD passback)`, etc. The annotation tells the reader where
  data ends up at a glance.
- Drop the `template_operation__` prefix from vertex names in the tree
  (it's noise that doesn't help understanding) but keep it in the
  full per-category listings above.

If two source vertices feed independent chains, render each as a separate
tree under a clear heading.

## Step 5: Output Format

Lead with a **TL;DR**. Most readers will skim — the first thing they see
should answer "what is this pipeline and what's notable about it?" in 2–3
sentences. Then drill into details.

Output shape:

```
# Pipeline: prod_log_reducer (job_abc123 — version 42, RUNNING)
**Backend**: template-backed

## TL;DR
Standard Datadog basic-logs template. Datadog agent → JSON + remap →
branches to raw-Iceberg AND reducer (2-min window, partitioned by service);
reducer output goes to pattern-Iceberg + back to Datadog. All four phase
filters are empty (pass-through); reducer has 1 exception
(`skipAggregation:true`).

> Note: vertex names below carry the resolved-graph `template_operation__`
> prefix. To make changes, use `tune-reduction` / `tune-grok` / `change-*`
> skills — those operate on template inputs, not the resolved vertex names.

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
dd_source
  └─> log_attributes_remapper
        └─> log_reducer
              ├─> warehouse_sink   (iceberg — raw)
              └─> dd_sink          (DD passback)
```

### TL;DR rules

- 2–3 sentences max — anything longer belongs in the detail sections.
- Lead with **`Backend: template-backed`** or **`Backend: direct job
  graph`** so downstream skills can route without re-detecting.
- Name the **template** if recognizable ("Standard Datadog basic-logs", "Log
  Reducer + Splunk passthrough"), name the **source vendor**, name the
  **non-default** reducer settings (partition-by, exceptions, custom
  aggregations), and name **anything unusual** (active filters, vendor
  exceptions, multiple branches, missing components).
- For direct-job-graph pipelines, also flag any **shape-dependent edit
  limits**: canonical UI log graphs support UI-level topology ops through
  `job:plan`, but arbitrary raw DAGs only support unambiguous existing-
  vertex field ops.
- Don't include the TL;DR if a previous skill already produced one in the
  same turn; just print the detail sections.

### One-liner instead of full description

If the user's question is narrow ("does this pipeline have a grok parser?",
"what dataset does it write to?"), answer the question directly — don't
emit the full sections. Use judgment.

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
