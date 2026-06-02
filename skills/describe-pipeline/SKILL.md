---
description: Summarize the structure of a Grepr pipeline (sources, transforms, sinks, datasets, integrations, filters, grok parsers, reducer settings, exceptions, current state) and detect its backend format. Run first as foundational context before any pipeline change; triggers on "describe pipeline", "pipeline summary", "what's in this pipeline", "inspect/explain pipeline structure". Owns the canonical backend-detection and capability matrix other skills link to.
allowed-tools: Bash(grepr job:get), Bash(grepr job:list), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), grepr:job-commands, grepr:grepr-model, grepr:operations-reference
---

# Describe a Grepr Pipeline

Read-only skill: produce a structured summary of a pipeline's job graph so you
and downstream skills (`tune-reduction`, `change-*`, `test-pipeline-change`) can
reason about changes against accurate context. Run this before proposing any
edit — otherwise you risk referencing vertices or fields that don't exist in
this specific pipeline.

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## Step 1: Resolve to a Job ID

`job:get` requires an ID; passing a name returns 404. If the user gave a name,
resolve it first:

```bash
grepr job:list --name <name> -f raw
```

If multiple jobs match, ask the user which ID to use. Then fetch the resolved
definition. Write to a file with `-o`; never pipe this or append `2>&1` (stderr
error text would mix into the JSON and break downstream parsers):

```bash
grepr job:get <JOB_ID> --resolved -f raw -o pipeline-<tag>.json
```

`--resolved` is what makes the rest of this skill work: template-backed
pipelines carry their config as template inputs that expand server-side, and
the resolved form is what actually runs, with all vertex names and edges
visible. Skipping `--resolved` leaves you blind to the real graph.

## Step 2: Detect the Backend

Scan `jobGraph.vertices` to classify the pipeline. Both backends are common in
practice (many UI-managed pipelines tagged `grepr-ui-managed: true` are direct
job graphs, not template-backed), so detect per pipeline rather than assuming.

- **Template-backed**: at least one vertex has `type: "template-operation"`.
- **Direct (raw) job graph**: no `template-operation` vertex; parser / remapper
  / reducer / grok vertices sit bare in the graph.

The backend decides which edit ops are available downstream. For the full
template-vs-raw detection rule and the per-backend capability matrix (existing-
vertex field ops vs UI-topology ops, the canonical-UI-shape constraint, the
`unsupported raw job graph shape` rejection, and the template-only ops), see
[reference.md](reference.md). Surface the backend in the TL;DR so downstream
skills don't re-detect.

Resolved template-backed graphs prefix vertex names with
`template_operation__` (a template-expansion artifact; direct graphs have no
such prefix). Edits never reference these names — they go through
`tune-reduction` / `tune-grok` / `change-*`, which operate on template inputs.
Note this in your output so a reader doesn't try to patch
`template_operation__log_reducer` by name.

## Step 3: Categorize Vertices

Split `jobGraph.vertices` by role using the `type` field:

| Category   | Example `type` values |
|------------|------------------------|
| Sources    | `logs-iceberg-table-source`, `datadog-log-agent-source`, `datadog-log-cloud-source`, `splunk-log-agent-source`, `splunk-log-http-source`, `otlp-log-agent-source`, `grepr-vendor-source` |
| Filters    | `logs-filter` |
| Parsers    | `json-log-processor`, `grok-parser` |
| Remapper   | `log-attributes-remapper` |
| Reducer    | `log-reducer` |
| SQL        | `sql-operation` |
| Branches   | `logs-branch` |
| Transforms | `log-transform`, `pattern-matcher`, `log-rules-application` |
| Sinks      | `logs-iceberg-table-sink`, `datadog-log-sink`, `splunk-log-sink`, `newrelic-log-sink`, `sumologic-log-sink`, `otlp-log-sink`, `logs-sync-sink` |

For a type not listed, fall back to `grepr:operations-reference` to identify its role.

## Step 4: Extract Key Fields per Category

Include only populated fields — keep the output focused.

- **Sources** — name, type, `integrationId`, `datasetId` (iceberg),
  query/predicate, time window / start / end (batch sources).
- **Filters** (`logs-filter`) — name, position in the graph (which edge it sits
  on), predicate type and query string.
- **Parsers** (`grok-parser`) — name, pattern/rule count, target attributes.
- **Remapper** (`log-attributes-remapper`) — `messageReservedAttributes` /
  `messageReservedAttributePaths`, `serviceReservedAttributes` / paths,
  `hostReservedAttributes` / paths, count of `attributeRemappingRules` (+ a
  couple of samples).
- **Reducer** (`log-reducer`) — `dedupThreshold`, `similarityThreshold`,
  `reductionTimeWindow`, `partitionByAttributes` /
  `partitionByAttributePaths` / `partitionByTags`,
  `attributeMergeStrategyEntries` (path + strategy type), `logReducerExceptions`
  (count + a sample predicate or two), `integrationExceptionConfigs`.
- **Sinks** — name, type, `integrationId`, `datasetId` (iceberg), any
  sink-level filter/predicate.
- **Job-level state** — `id`, `name`, `version`, `desiredState`, `state`,
  `execution` / `processing`, `updatedAt`, `editedBy`, `tags`.

### Topology

Render the graph as an indented tree with arrows — far more readable than a flat
edge list when a vertex has multiple downstream children (common in branched
pipelines):
- Root: source vertex (no parent edges).
- `└─>` for the only or last child, `├─>` for non-last siblings, aligned under
  the parent.
- Annotate each leaf/branch endpoint inline in parentheses — `(iceberg — raw)`,
  `(DD passback)` — so the reader sees where data ends up at a glance.
- Drop the `template_operation__` prefix in the tree (noise), but keep it in the
  full per-category listings.
- If two source vertices feed independent chains, render each as a separate tree
  under its own heading.

## Step 5: Output Format

Lead with a TL;DR (2–3 sentences answering "what is this pipeline and what's
notable?"), then drill into detail sections. See
[examples.md](examples.md) for full template-backed and raw-graph outputs.

TL;DR rules:
- 2–3 sentences max; anything longer belongs in the detail sections.
- Lead with `Backend: template-backed` or `Backend: direct job graph` so
  downstream skills route without re-detecting.
- Name the template if recognizable, the source vendor, the non-default reducer
  settings (partition-by, exceptions, custom aggregations), and anything unusual
  (active filters, vendor exceptions, multiple branches, missing components).
- For direct job graphs, flag shape-dependent edit limits (see reference.md):
  canonical UI graphs support UI-topology ops; arbitrary raw DAGs only support
  unambiguous existing-vertex field ops.
- Skip the TL;DR if a previous skill already produced one this turn; just print
  the detail sections.

If the user's question is narrow ("does this have a grok parser?", "what dataset
does it write to?"), answer it directly instead of emitting the full sections.

## What to Skip

- Internal masks / token regexes on the reducer (massive defaults, rarely
  customized — surface only if non-default).
- Auto-generated test-tag vertices from prior test runs.
- Generic edges between unnamed branch outputs.

## Common Follow-ups

- `tune-reduction` — reduction-quality questions.
- `test-pipeline-change` — when the user has an edit in mind.
- `grepr:debug-pipeline` — when the pipeline is misbehaving, not just
  misconfigured.

## Resources

- [reference.md](reference.md) — canonical backend capability matrix: template
  vs raw detection rule, per-backend supported ops, canonical-UI-shape
  constraint, template-only ops.
- [examples.md](examples.md) — ✅ template-backed describe output, ✅ raw
  job-graph describe output, ❌ anti-patterns, each with a short "why".
- `grepr:cli` — `--conf` config resolution.
- `grepr:operations-reference` — full op catalog and exact field names.
- `grepr:test-pipeline-change` — plan→draft→apply harness for proposed edits.
