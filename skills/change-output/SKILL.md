---
description: Add, remove, or replace a sink, or repoint the raw-logs dataset on a Grepr pipeline. Covers vendor log sinks (Datadog, Splunk, New Relic, Sumo, OTLP), the processed-logs data-lake sink, and the raw dataset. Use when the user wants to change where a pipeline sends logs — forward reduced logs to a new destination, stop forwarding to one, or point raw/reduced storage at a different dataset. Routes through test-pipeline-change.
allowed-tools: Bash(grepr query), Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr job:apply), Bash(grepr job:get), Bash(grepr integration:list), Bash(grepr integration:get), Bash(grepr dataset:list), Bash(grepr dataset:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:integration-commands, grepr:dataset-commands
trigger_keywords:
  - change output
  - add sink
  - remove sink
  - change destination
  - forward logs
  - stop forwarding
  - change dataset
  - set dataset
---

# Change Pipeline Output

Use when the user wants to change where a pipeline's logs go:
- Forward reduced logs to a new vendor (add a Datadog/Splunk/New Relic/Sumo/OTLP sink).
- Stop forwarding to a vendor (remove a sink).
- Gate a vendor sink so only some logs reach it.
- Point the processed-logs (reduced) data-lake table at a different dataset.
- Repoint the raw-logs dataset.

## What draft can and can't verify

Output changes classify as `sink`. The draft harness verifies the
**graph/upstream** — that records reach the sink stage with the right shape —
but **not external delivery**: there's no readback from the destination
vendor, and a dataset repoint isn't confirmed by reading the new table. Say
this plainly before applying. Verify actual delivery in the destination
(the vendor UI, or `grepr query` against the new dataset) **after** apply.

## Three output targets

| Target | What it is | Op `target` |
|--------|------------|-------------|
| Vendor sink | Forwards reduced logs to a vendor. Many allowed; each has a name and `integrationId`. | `vendor` |
| Processed-logs sink | The single data-lake (iceberg) table holding **reduced** logs. | `processed-logs` |
| Raw dataset | The data-lake table holding **raw** logs (pre-reduction). | (`set-raw-dataset`) |

Don't confuse the processed-logs sink (reduced output) with the raw dataset
(raw store) — they're different tables.

## Step 1: Get context

Run `grepr:describe-pipeline <JOB_ID>` and note the current sinks (names,
types, integrationIds), the processed-logs dataset, and the raw dataset.

For a new vendor sink, get the integration ID; for a dataset repoint, get
the target dataset ID:

```bash
grepr integration:list      # vendor integration IDs
grepr dataset:list          # data-lake dataset IDs
```

## Step 2: Build the patch

### Add a vendor sink

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "vendor",
      "sink": { "type": "datadog-log-sink", "name": "dd_passback", "integrationId": "<integration-id>" }
    }
  ]
}
```

Vendor sink types: `datadog-log-sink`, `splunk-log-sink`,
`newrelic-log-sink`, `sumologic-log-sink`, `otlp-log-sink`. The `name` must
be unique among existing sinks.

To gate which logs reach the sink, add a `filter` (vendor target only):

```json
{
  "operations": [
    {
      "op": "add-sink",
      "target": "vendor",
      "sink": { "type": "datadog-log-sink", "name": "errors_only", "integrationId": "<integration-id>" },
      "filter": { "type": "logs-filter", "name": "errors_only_filter", "predicate": { "type": "datadog-query", "query": "status:error" } }
    }
  ]
}
```

### Remove a sink

```json
{
  "operations": [
    { "op": "remove-sink", "target": "vendor", "name": "dd_passback" }
  ]
}
```

`name` is required for `vendor`. For `processed-logs` it's the singular slot,
so `name` is ignored.

### Replace the processed-logs (reduced) data-lake sink

It's a singular slot — `add-sink` rejects if one is already set, so remove
first, then add:

```json
{
  "operations": [
    { "op": "remove-sink", "target": "processed-logs" },
    {
      "op": "add-sink",
      "target": "processed-logs",
      "sink": { "type": "logs-iceberg-table-sink", "name": "processed_logs", "datasetId": "<dataset-id>" }
    }
  ]
}
```

`processed-logs` takes no `filter`.

### Repoint the raw-logs dataset

```json
{
  "operations": [
    { "op": "set-raw-dataset", "datasetId": "<dataset-id>" }
  ]
}
```

Repointing a dataset changes only where new logs are written — existing logs
in the old dataset stay where they are. Don't mutate dataset IDs casually;
confirm the target dataset with the user first.

## Step 3: Hand off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `patch.json`. The
plan's classification will be `sink`, so the harness continues as
graph/upstream verification only and surfaces the delivery limitation.

What the draft shows:

| What | Good sign |
|------|-----------|
| Records reach the sink/output stage | Non-zero volume with the expected shape |
| A gating filter passes the intended subset | Only matching logs at that sink's stage (zero non-matching) |
| Unrelated sinks/stages unchanged | No collateral diff |

What it does **not** show: that the vendor accepted the logs, or that writes
landed in the new dataset. Confirm those post-apply.

## Common failure modes

- **`add-sink` rejects "already exists"**: a vendor sink with that `name`
  already exists, or the processed-logs slot is set. Pick a new name, or
  `remove-sink` first.
- **Wrong sink type string**: a non-vendor type for `target: vendor` (or a
  non-iceberg type for `processed-logs`) is rejected at plan time. Confirm
  the type via `grepr docs:search --type schema "<vendor> sink"`.
- **Gating filter on `processed-logs`**: not supported — the iceberg slot has
  no filter. Use `target: vendor` if you need gating.
- **Delivery looks broken but draft was clean**: draft never tested delivery.
  Check the integration's status (`grepr integration:get <id>`) and the
  destination after apply.

## Hand-off boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
