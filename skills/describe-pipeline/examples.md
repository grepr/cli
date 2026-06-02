# Describe-pipeline examples

`describe-pipeline` emits a SUMMARY, not a patch. These examples show the
expected output shape for each backend plus a common mistake to avoid. All
identifiers are sanitized.

## Contents

- [✅ Template-backed pipeline](#-template-backed-pipeline)
- [✅ Raw job-graph pipeline](#-raw-job-graph-pipeline)
- [❌ Referencing a resolved template-operation vertex name in an edit](#-referencing-a-resolved-template-operation-vertex-name-in-an-edit)
- [❌ Skipping --resolved](#-skipping---resolved)

## ✅ Template-backed pipeline

Resolved with `grepr job:get job_acme01 --resolved -f raw -o pipeline-acme.json`.
A single `template-operation` vertex expands into the named-stage graph below.

```
# Pipeline: acme_log_reducer (job_acme01 — version 42, RUNNING)
**Backend**: template-backed

## TL;DR
Standard Datadog basic-logs template. Datadog agent → JSON + remap → branches to
raw-Iceberg AND reducer (2-min window, partitioned by service); reducer output
goes to pattern-Iceberg + back to Datadog. All four phase filters are
pass-through; reducer has 1 exception (`status:error`).

> Note: vertex names below carry the resolved-graph `template_operation__`
> prefix. To make changes, use `tune-reduction` / `tune-grok` / `change-*` —
> those operate on template inputs, not the resolved vertex names.

## Sources
- `datadog-log-agent-source` `dd_source` — integration `int_datadog`

## Transforms
- `log-attributes-remapper` `log_attributes_remapper`
  - messageReservedAttributes: `["message", "msg"]`
- `log-reducer` `log_reducer`
  - reductionTimeWindow: `120s`
  - partitionByAttributes: `["service"]`
  - logReducerExceptions: 1 (`status:error`)

## Sinks
- `logs-iceberg-table-sink` `warehouse_sink` — dataset `ds_raw_logs`
- `datadog-log-sink` `dd_sink` — integration `int_datadog`

## Topology
dd_source
  └─> log_attributes_remapper
        └─> log_reducer
              ├─> warehouse_sink   (iceberg — raw)
              └─> dd_sink          (DD passback)
```

Why: leads with `Backend: template-backed` so downstream skills route without
re-detecting, names the template and the non-default reducer settings, and warns
that the `template_operation__` names are not patch targets.

## ✅ Raw job-graph pipeline

Resolved the same way. No `template-operation` vertex; the stages are bare and
match the canonical UI shape (`pre_parser_filter` → parsers →
`pre_data_warehouse_filter` → `pre_exceptions_filter` → `log_reducer`), so
UI-topology ops are available.

```
# Pipeline: acme_webapp_logs (job_acme07 — version 9, RUNNING)
**Backend**: direct job graph

## TL;DR
UI-managed Splunk pipeline (`grepr-ui-managed: true`), canonical UI shape.
Splunk HTTP source → grok parse → reducer (5-min window, partitioned by
`@checkout-service`) → Splunk passback. `pre_parser_filter` drops debug;
other phase filters pass-through. Canonical shape, so UI-topology ops
(set-filter, add-source, add-parser) are supported.

## Sources
- `splunk-log-http-source` `splunk_source` — integration `int_splunk`

## Filters
- `logs-filter` `pre_parser_filter` (on source → parser edge)
  - predicate: `datadog-query` `-status:debug`

## Parsers
- `grok-parser` `webapp_grok` — 3 rules, extracts `@latency_ms`

## Transforms
- `log-reducer` `log_reducer`
  - reductionTimeWindow: `300s`
  - partitionByAttributePaths: `[["@checkout-service"]]`

## Sinks
- `splunk-log-sink` `splunk_sink` — integration `int_splunk`

## Topology
splunk_source
  └─> pre_parser_filter        (drops -status:debug)
        └─> webapp_grok
              └─> log_reducer
                    └─> splunk_sink   (Splunk passback)
```

Why: flags `direct job graph` and that the canonical UI shape permits
UI-topology ops — downstream skills know `add-parser` / `set-filter` are
on the table here, unlike an arbitrary raw DAG.

## ❌ Referencing a resolved template-operation vertex name in an edit

After describing the template-backed pipeline above, a follow-up tries to patch
the reducer by its resolved vertex name:

```json
{
  "operations": [
    { "op": "set-input-field", "path": "template_operation__log_reducer.reductionTimeWindow", "value": "300s" }
  ]
}
```

Why this fails: `template_operation__log_reducer` is an expansion artifact, not
an addressable input. Template inputs live under `templateInputs.input`, so the
path here resolves to nothing and `job:plan` rejects it. Edits route through
`tune-reduction` / `change-*`, which target template inputs — the describe
output's note exists precisely to prevent this.

## ❌ Skipping --resolved

```bash
grepr job:get job_acme01 -f raw -o pipeline-acme.json
```

Why this fails: without `--resolved`, a template-backed pipeline returns only
the single `template-operation` vertex with `edges: []` — no expanded stages, no
real vertex names. Categorization (Step 3) and the topology tree (Step 4) have
nothing to work on, and you cannot detect the canonical UI shape. Always fetch
with `--resolved`.
