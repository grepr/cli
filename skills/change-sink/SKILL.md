---
description: Add, remove, or replace a sink, or repoint the raw-logs dataset on a Grepr pipeline — covers vendor log sinks (Datadog, Splunk, New Relic, Sumo, OTLP), the processed-logs data-lake sink, and the raw dataset. Use whenever the user wants to change where a pipeline sends logs — forward reduced logs to a new destination, stop forwarding to one, gate a vendor sink to a subset, or point raw/reduced storage at a different dataset. Routes through test-pipeline-change.
allowed-tools: Bash(grepr job:get), Bash(grepr integration:list), Bash(grepr integration:get), Bash(grepr dataset:list), Bash(grepr dataset:get), Bash(grepr --conf * job:get), Bash(grepr --conf * integration:list), Bash(grepr --conf * integration:get), Bash(grepr --conf * dataset:list), Bash(grepr --conf * dataset:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:integration-commands, grepr:dataset-commands
---

# Change Pipeline Output

Change where a pipeline's logs go: add or remove a vendor sink, gate a vendor
sink to a subset, replace the processed-logs data-lake sink, or repoint the
raw-logs dataset. Build one `{ "operations": [...] }` patch, then hand it to
the harness — never write to production directly from here.

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## Three output targets

| Target | What it is | How to address it |
|--------|------------|-------------------|
| Vendor sink | Forwards reduced logs to a vendor. Many allowed; each has a unique `name` and `integrationId`. Accepts an optional gating `filter`. | `add-sink`/`remove-sink` with `target: "vendor"` |
| Processed-logs sink | The single data-lake (iceberg) table holding **reduced** logs. No filter allowed. | `add-sink`/`remove-sink` with `target: "processed-logs"` |
| Raw dataset | The data-lake table holding **raw** logs (pre-reduction). | `set-raw-dataset` with `datasetId` |

The processed-logs sink (reduced output) and the raw dataset (raw store) are
different tables — don't conflate them.

## Step 1: Get context

Run `grepr:describe-pipeline <JOB_ID>` and note the current sinks (names,
types, integrationIds), the processed-logs dataset, and the raw dataset.
For backend detection and which ops each backend supports, see
`grepr:describe-pipeline`.

Resolve the IDs the patch will need:

```bash
grepr integration:list      # vendor integration IDs (for a new vendor sink)
grepr dataset:list          # data-lake dataset IDs (for a dataset repoint)
```

## Step 2: Build the patch

Pick the shape that matches the change. Copy-paste-ready patches live in
`examples.md`; below is the operation map.

| Goal | Op | Key fields |
|------|----|-----------|
| Add a vendor sink | `add-sink` | `target: "vendor"`, `sink` (vendor type), optional `filter` |
| Gate a vendor sink | `add-sink` | as above, with `filter` carrying a `datadog-query` predicate |
| Remove a vendor sink | `remove-sink` | `target: "vendor"`, `name` |
| Replace processed-logs sink | `remove-sink` then `add-sink` | `target: "processed-logs"`; the add takes a `logs-iceberg-table-sink`, NO filter |
| Repoint raw dataset | `set-raw-dataset` | `datasetId` |

- Vendor sink types: `datadog-log-sink`, `splunk-log-sink`,
  `newrelic-log-sink`, `sumologic-log-sink`, `otlp-log-sink`. Each `name` must
  be unique among existing sinks, or `add-sink` rejects with "already exists".
- The processed-logs slot is singular: `add-sink` rejects if one is already
  set, so `remove-sink` first, then add. A gating `filter` is rejected here —
  only vendor sinks allow one.
- Repointing a dataset changes only where new logs are written; existing logs
  in the old dataset stay put. Confirm the target dataset with the user first.

For the full op catalog and exact field names, see `grepr:operations-reference`.

## Step 3: Hand off to test-pipeline-change

Hand the patch file to `grepr:test-pipeline-change`, which plans, drafts,
gates on approval, and applies.

These patches classify as `sink` (or `mixed` when combined with other
changes). Draft therefore verifies the **graph and upstream only** — that
records reach the sink stage with the expected shape and that a gating filter
passes the intended subset. Draft does **not** verify external vendor delivery
or that writes landed in a repointed dataset; there is no readback from the
destination. State this plainly before applying, and confirm real delivery
post-apply via the vendor UI or `grepr query` against the new dataset. The
gating mechanics (how draft compares per-stage volume and gates apply) belong
to `grepr:test-pipeline-change`.

## Common failure modes

- **`add-sink` rejects "already exists"**: a vendor sink with that `name`
  exists, or the processed-logs slot is set. Pick a new name, or `remove-sink`
  first.
- **Wrong sink type string**: a non-vendor type under `target: "vendor"` (or a
  non-iceberg type under `processed-logs`) fails at plan time. Check the type
  via `grepr:operations-reference`.
- **Gating filter on `processed-logs`**: unsupported — the iceberg slot has no
  filter. Use `target: "vendor"` if you need gating.
- **Delivery looks broken but draft was clean**: draft never tested delivery.
  Check the integration (`grepr integration:get <id>`) and the destination
  after apply.

## Resources

- `examples.md` — ✅ template-backed and ✅ raw job-graph patches for adding,
  gating, removing, and repointing sinks, plus ❌ rejected anti-patterns.
- `grepr:describe-pipeline` — backend detection and per-backend capability.
- `grepr:test-pipeline-change` — plan→draft→apply, gating, drift.
- `grepr:operations-reference` — full op catalog and field schemas.
- `grepr:cli` — `--conf` org config resolution.
- `grepr:integration-commands` / `grepr:dataset-commands` — resolve vendor
  integration IDs and dataset IDs.
