# Describe-pipeline examples

`describe-pipeline` emits a SUMMARY, not a patch. These examples show the
expected output shape plus common mistakes to avoid. All identifiers are
sanitized.

## Contents

- [✅ Template-backed pipeline](#-template-backed-pipeline)
- [❌ Referencing a resolved template-operation vertex name in an edit](#-referencing-a-resolved-template-operation-vertex-name-in-an-edit)
- [❌ Skipping --resolved](#-skipping---resolved)

## ✅ Template-backed pipeline

Resolved with `grepr job:get job_acme01 --resolved -f raw -o pipeline-acme.json`.
A single `template-operation` vertex expands into the named-stage graph below.

```
# Pipeline: acme_log_reducer (job_acme01 — version 42, RUNNING)

## TL;DR
Standard Datadog basic-logs template. Datadog agent → JSON + remap → branches to
raw-Iceberg AND reducer (2-min window, partitioned by service); reducer output
goes to pattern-Iceberg + back to Datadog. All three phase filters are
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

Why: names the template and the non-default reducer settings, and warns that
the `template_operation__` names are not patch targets.

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
nothing to work on. Use the unresolved job only for the Step 2 template check.
Always fetch with `--resolved` for the description.
