---
description: Creates a manual logs backfill job that replays raw data-lake logs to vendor destinations (Datadog, Splunk, New Relic, Sumo Logic, OTLP). Use when the user wants to backfill, replay, resend, or re-deliver logs — e.g. logs missing from a vendor, recovering from a sink outage, or re-sending an incident time window.
allowed-tools: Bash(grepr backfill), Bash(grepr query), Bash(grepr job:get), Bash(grepr job:list), Bash(grepr dataset:list), Bash(grepr integration:list), Bash(grepr --conf * backfill), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), Bash(grepr --conf * dataset:list), Bash(grepr --conf * integration:list), Bash(jq), Bash(date), grepr:cli
---

# Backfill Logs

Copy this checklist and check off items as you complete them:

```
Backfill progress:
- [ ] 1. Resolve inputs (source, sinks, time range, limit, query)
- [ ] 2. Dry-run and inspect the generated job
- [ ] 3. Preview matching logs (grepr query --limit 50)
- [ ] 4. Submit the backfill
- [ ] 5. Poll the job to a terminal state
- [ ] 6. Report the Grepr job URL, vendor URLs, and tags to the user
```

Resolve the org config once and reuse the same `--conf` value on every command —
see `grepr:cli` for the canonical config handling.

## Step 1: Resolve inputs

Determine the source from what the user provided:

- **Job ID** → pipeline-derived mode: pass `--job-id <id>`. The command infers
  the raw dataset and destination sinks from the pipeline; do not pass dataset
  or sink flags alongside it.
- **Dataset ID** → explicit mode: pass `--dataset-id <id>` plus sinks (below).
- **Bare name** → check `grepr job:list --state RUNNING -f raw` for an active
  job with that name; if one exists, assume the user wants pipeline-derived
  mode with its ID. Otherwise, look for the name in `grepr dataset:list` and
  use explicit mode. If neither matches, ask the user.

Explicit mode requires at least one sink integration ID via
`--sink-id <ids...>` — one flag, space-separated values, no comma
lists. If the user named a destination ("our
Datadog") instead of giving an ID, resolve it with `grepr integration:list`;
if several integrations match, ask rather than guessing. Supported sink types:
Datadog, Splunk, New Relic, Sumo Logic, OTLP.

Time range: `--start` and `--end` are required, strict ISO-8601 with an
explicit timezone (e.g. `2026-07-08T10:00:00Z`). Relative forms like `now-2h`
are rejected — compute concrete timestamps with `date -u`. For older windows,
the command skips Datadog sinks past 18 hours and New Relic sinks past 48
hours, then proceeds with any eligible sinks. It fails if no sinks remain.

Remaining flags:

- `--limit`: omit unless the user asked for one. The default is 10,000
  records. `-1` means unlimited and can be expensive — confirm with the user
  before submitting an unlimited backfill.
- `--query`: optional filter using the same Datadog-like syntax as
  `grepr query` (see `grepr:query-logs`). Omit when the user gave none.
- `--tag <key:value...>`: optional, space-separated values
  after one flag. Added to the emitted logs as vendor-visible
  tags/attributes; values may contain colons.

## Step 2: Dry run

Generate the job without submitting, so mode, timestamps, and sink types are
validated and the resolved job graph is available for the next step:

```bash
grepr backfill <flags> --dry-run --output backfill-job.json
```

## Step 3: Preview matching logs

Confirm the window and query actually match data before creating a job. Read
the resolved parameters from the dry-run output — in pipeline-derived mode
this is where the inferred dataset ID comes from:

```bash
jq '.jobGraph.vertices[] | select(.name == "source") | {datasetId, start, end, query: .query.query, queryType: .query.type}' backfill-job.json
```

Then sample a small number of matching logs:

```bash
grepr query --dataset-id <datasetId> --query "<query>" --query-type "<queryType>" \
  --start <start> --end <end> --limit 50 -q -f raw -o backfill-preview.ndjson
```

If the preview returns no records, stop and report that to the user instead of
submitting — an empty backfill usually means a wrong window, dataset, or query.

## Step 4: Submit

Re-run the same command without `--dry-run` and capture the created job:

```bash
grepr backfill <flags> --output backfill-created.json
jq '{id, greprUrl, vendorLinks}' backfill-created.json
```

After submission, if `greprUrl` is present, immediately send the user a progress update before polling the job:
Backfill job created: <`greprUrl`>. Display the complete URL verbatim

## Step 5: Poll until finished

Backfills run as asynchronous batch jobs. Poll every ~30 seconds:

```bash
grepr job:get <job-id> -f raw | jq -r '.state'
```

Terminal states: `FINISHED`, `FAILED`, `CANCELLED`, `STOPPED`. Anything else
(`PENDING`, `WAITING`, `STARTING`, `RUNNING`, ...) means keep polling. On
`FAILED`, fetch the full job with `grepr job:get <job-id> -f raw` and report
the error to the user.

## Step 6: Report

Report each `vendorLinks[].url` with its label so the user can open
the backfilled logs directly in that destination.

Also tell the user that every backfilled log carries these tags/attributes,
which can be used to find the logs when a vendor link is unavailable or not working:

- `grepr.backfilled:true`
- `grepr.backfilled.timestamp:<submission time>`
- `processor:grepr`
- any `--tag key:value` values the user supplied

Logs already delivered to a destination by a previous run are skipped
automatically, so re-running a backfill does not duplicate logs.

## Examples

Pipeline-derived — backfill an hour of errors from a pipeline:

```bash
grepr backfill --job-id 0kmjah9wkg9d0 \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --query "status:error" --dry-run --output backfill-job.json
```

Explicit — backfill a dataset to two destinations with an incident tag:

```bash
grepr backfill --dataset-name raw-logs \
  --sink-id 0kmjaa8p7gbpf 0p8sgt40y5ank \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --tag incident:inc-123 --dry-run --output backfill-job.json
```
