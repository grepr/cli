---
description: Summarize the structure of a Grepr pipeline (sources, transforms, sinks, datasets, integrations, filters, grok parsers, reducer settings, exceptions, current state) and check that it is template-backed. Run first as foundational context before any pipeline change; triggers on "describe pipeline", "pipeline summary", "what's in this pipeline", "inspect/explain pipeline structure". Owns the template check other skills link to.
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

## Step 2: Template Check

The pipeline-edit skills and `job:plan`, `job:draft`, and `job:apply` support
only template-backed pipelines. The resolved graph expands the template, so run
this check on the unresolved job:

```bash
grepr job:get <JOB_ID> -f raw -o pipeline-<tag>-unresolved.json
jq '[.jobGraph.vertices[] | select(.type == "template-operation")] | length' pipeline-<tag>-unresolved.json
```

- `1`: the pipeline is template-backed. Continue. Keep this file. The
  `templateInputs.input` object on that vertex (`sources`, `parsers`,
  `reducer`, `transforms`, `exceptions`, `sinks`, `datasetId`, and more) is the
  config that patches edit.
- Any other result: the pipeline is a raw job graph. Stop. Tell the user that
  these skills and `job:plan`, `job:draft`, and `job:apply` support only
  template-backed pipelines. Do not build a patch. The user can still change a
  raw job graph with `job:update`, and then defines every vertex and edge.

Resolved template-backed graphs prefix vertex names with
`template_operation__` (a template-expansion artifact). Edits never reference
these names. They go through `tune-reduction` / `tune-grok` / `change-*`, which
operate on template inputs. Note this in your output so a reader doesn't try to
patch `template_operation__log_reducer` by name.

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
| Masking    | `masking-operator` |
| Branches   | `logs-branch` |
| Transforms | `log-transform` |
| Sinks      | `logs-iceberg-table-sink`, `datadog-log-sink`, `splunk-log-sink`, `newrelic-log-sink`, `sumologic-log-sink`, `otlp-log-sink`, `logs-sync-sink` |

For a type not listed, fall back to `grepr:operations-reference` to identify its role.

## Step 4: Extract Key Fields per Category

Include only populated fields — keep the output focused.

- **Sources** — name, type, `integrationId`, `datasetId` (iceberg),
  query/predicate, time window / start / end (batch sources).
- **Filters** (`logs-filter`) — name, position in the graph (which edge it sits
  on), predicate type and query string.
- **Parsers** (`grok-parser`) — name, predicate type and query (missing predicate or
  blank query: "none — runs on every log"), input field (`extractAttribute`; missing or
  blank: `message`), pattern/rule count, target attributes.
- **Remapper** (`log-attributes-remapper`) — `messageReservedAttributes` /
  `messageReservedAttributePaths`, `serviceReservedAttributes` / paths,
  `hostReservedAttributes` / paths, count of `attributeRemappingRules` (+ a
  couple of samples).
- **Reducer** (`log-reducer`) — `dedupThreshold`, `similarityThreshold`,
  `reductionTimeWindow`, `partitionByAttributes` /
  `partitionByAttributePaths` / `partitionByTags`,
  `attributeMergeStrategyEntries` (path + strategy type), `logReducerExceptions`
  (count + a sample predicate or two), `integrationExceptionConfigs`.
- **Masking** (`masking-operator`) — the `messageMasks` (label→mask),
  `attributeMasks` (path + label→mask), and the optional `predicate` that limits
  which logs are masked at all (always report it; its absence means every log is
  masked). A mask is a bare regex string or an object with
  `replacement`/`preserveThrough`. It gates the data-lake fan-out on the normal
  path, so everything downstream — the raw lake included — is masked, except for
  explicit SQL output edges routed past it and events whose masking failed (tagged
  `grepr.failedOperations`). Edit via `grepr:change-masking`.
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
[examples.md](examples.md) for a full output.

TL;DR rules:
- 2–3 sentences max; anything longer belongs in the detail sections.
- Name the template if recognizable, the source vendor, the non-default reducer
  settings (partition-by, exceptions, custom aggregations), and anything unusual
  (active filters, vendor exceptions, multiple branches, missing components).
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

- [examples.md](examples.md) has a ✅ template-backed describe output and ❌
  anti-patterns, each with a short "why".
- `grepr:cli` — `--conf` config resolution.
- `grepr:operations-reference` — full op catalog and exact field names.
- `grepr:test-pipeline-change` — plan→draft→apply harness for proposed edits.
