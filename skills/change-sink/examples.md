# change-sink examples

Sanitized, schema-valid `{ "operations": [...] }` patches. Identifiers are
fake (`acme`, `webapp`, `int_datadog`, `ds_raw_logs`, …) — swap in the real
integration/dataset IDs resolved in Step 1.

Each `add-sink`/`remove-sink` op carries a `target`. Vendor sinks need a
unique `name` and `integrationId` and may carry an optional gating `filter`;
the processed-logs slot is singular, takes a `logs-iceberg-table-sink`, and
allows NO filter. These op shapes are identical on template-backed and raw
job-graph pipelines — the patch is the same; only the underlying job shape the
harness rewrites differs.

## Contents

- ✅ Add a vendor sink (template-backed)
- ✅ Gate a vendor sink to a subset (template-backed)
- ✅ Replace the processed-logs sink (raw job-graph)
- ✅ Remove a vendor sink + repoint the raw dataset (raw job-graph, mixed)
- ❌ `add-sink` onto an existing sink name
- ❌ Gating filter on a processed-logs sink

## ✅ Add a vendor sink (template-backed)

Forward reduced logs to a new New Relic destination.

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "vendor",
      "sink": { "type": "newrelic-log-sink", "name": "nr_passback", "integrationId": "int_newrelic" }
    }
  ]
}
```

Why: a vendor `add-sink` with a unique `name` and a valid `integrationId` is
the canonical "forward to a new destination" change. Draft confirms records
reach the sink stage; vendor acceptance is verified post-apply.

## ✅ Gate a vendor sink to a subset (template-backed)

Send only error logs to a Splunk sink, leaving other sinks untouched.

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "vendor",
      "sink": { "type": "splunk-log-sink", "name": "splunk_errors", "integrationId": "int_splunk" },
      "filter": { "type": "logs-filter", "name": "splunk_errors_filter", "predicate": { "type": "datadog-query", "query": "status:error" } }
    }
  ]
}
```

Why: only vendor sinks accept a gating `filter`. The `datadog-query` predicate
selects the subset that reaches this sink; draft shows only matching logs at
that stage and zero non-matching.

## ✅ Replace the processed-logs sink (raw job-graph)

Repoint the reduced-logs data-lake table at a new dataset. The slot is
singular, so remove then add.

```json
{
  "operations": [
    { "op": "remove-sink", "target": "processed-logs" },
    {
      "op": "add-sink",
      "target": "processed-logs",
      "sink": { "type": "logs-iceberg-table-sink", "name": "processed_logs", "datasetId": "ds_reduced_logs" }
    }
  ]
}
```

Why: `remove-sink` on `processed-logs` needs no `name` (one slot). The add
uses the iceberg sink type with no filter. Draft verifies the graph; that
writes land in `ds_reduced_logs` is confirmed post-apply with `grepr query`.

## ✅ Remove a vendor sink + repoint the raw dataset (raw job-graph, mixed)

Stop forwarding to Datadog and point raw storage at a new dataset in one
patch. Combining a sink change with a dataset repoint classifies as `mixed`.

```json
{
  "operations": [
    { "op": "remove-sink", "target": "vendor", "name": "dd_passback" },
    { "op": "set-raw-dataset", "datasetId": "ds_raw_logs" }
  ]
}
```

Why: a vendor `remove-sink` requires the `name` to identify which sink to
drop. `set-raw-dataset` only changes where new raw logs are written — existing
logs stay in the old dataset.

## ❌ `add-sink` onto an existing sink name

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "vendor",
      "sink": { "type": "datadog-log-sink", "name": "dd_passback", "integrationId": "int_datadog" }
    }
  ]
}
```

Why this fails: a sink named `dd_passback` already exists, so `add-sink`
rejects with "already exists" at plan time. Pick a new unique `name`, or
`remove-sink` the old one first.

## ❌ Gating filter on a processed-logs sink

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "processed-logs",
      "sink": { "type": "logs-iceberg-table-sink", "name": "processed_logs", "datasetId": "ds_reduced_logs" },
      "filter": { "type": "logs-filter", "name": "pl_filter", "predicate": { "type": "datadog-query", "query": "status:error" } }
    }
  ]
}
```

Why this fails: only vendor sinks allow a gating `filter`; the processed-logs
iceberg slot has none, so this is rejected. Drop the `filter`, or gate a
`target: "vendor"` sink instead.
