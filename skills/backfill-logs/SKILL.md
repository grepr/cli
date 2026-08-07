---
description: Creates a manual logs or spans backfill job that replays raw data-lake data to vendor destinations. Use when the user wants to backfill, replay, resend, or re-deliver logs or spans — e.g. data missing from a vendor, recovering from a sink outage, or re-sending an incident time window.
allowed-tools: Bash(grepr backfill), Bash(grepr query), Bash(grepr job:get), Bash(grepr job:list), Bash(grepr dataset:list), Bash(grepr integration:list), Bash(grepr docs:search), Bash(grepr --conf * backfill), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), Bash(grepr --conf * dataset:list), Bash(grepr --conf * integration:list), Bash(grepr --conf * docs:search), Bash(grep), Bash(jq), Bash(date), grepr:cli, grepr:query-predicate
---

# Backfill Logs and Spans

Copy this checklist and check off items as you complete them:

```
Backfill progress:
- [ ] 1. Resolve inputs (source, data type, sinks, time range, limit)
- [ ] 2. Build the query predicate
- [ ] 3. Dry-run and inspect the generated request
- [ ] 4. Preview matching data (grepr query --limit 50)
- [ ] 5. Submit the backfill
- [ ] 6. Poll the job to a terminal state
- [ ] 7. Report the Grepr job URL, vendor URLs, and tags/attributes to the user
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

Resolve the data type for predicate building. Use an explicit user-provided
type when present. Otherwise:

- For a job ID, inspect the resolved job:

  ```bash
  grepr job:get <job-id> --resolved -f raw |
    grep -Eo '"type"[[:space:]]*:[[:space:]]*"[^"]*(logs?|spans?|trace)[^"]*(reducer|sink)[^"]*"'
  ```

- For an explicit dataset, find the type used by jobs linked to that raw
  dataset:

  ```bash
  grepr job:list --all --processing STREAMING -f raw |
    grep -E '"datasetId"[[:space:]]*:[[:space:]]*"<dataset-id>"' |
    grep -Eo '"type"[[:space:]]*:[[:space:]]*"[^"]*(logs?|spans?|trace)[^"]*(reducer|sink)[^"]*"'
  ```

A `span` or `trace` match means spans; a `log` match means logs. If there is no
match or both signals match, ask rather than guessing.

Explicit mode requires at least one sink integration ID via
`--sink-id <ids...>` — one flag, space-separated values, no comma
lists. If the user named a destination ("our
Datadog") instead of giving an ID, resolve it with `grepr integration:list`;
if several integrations match, ask rather than guessing. The CLI validates
that each sink supports the resolved data type.

Time range: `--start` and `--end` are required, strict ISO-8601 with an
explicit timezone (e.g. `2026-07-08T10:00:00Z`). Relative forms like `now-2h`
are rejected — compute concrete timestamps with `date -u`. For older windows,
the command skips Datadog sinks past 18 hours and New Relic sinks past 48
hours, then proceeds with any eligible sinks. It fails if no sinks remain.

Remaining flags:

- `--limit`: omit unless the user asked for one. The default is 10,000
  records. For spans, this limit applies independently to each vendor source,
  so a backfill with multiple destinations may read up to the limit once per
  destination. `-1` means unlimited and can be expensive — confirm with the
  user before submitting an unlimited backfill.
- `--tag <key:value...>`: optional, space-separated values
  after one flag. Added to the emitted data as vendor-visible
  tags/attributes; values may contain colons.

## Step 2: Build the query predicate

Invoke `grepr:query-predicate` with the user's intent and resolved data type.
Use its `query` and `queryType` unchanged. Omit `--query` when the predicate is
empty.

Then load exactly one data-type-specific reference and apply its directives:

- [logs](references/logs.md)
- [spans](references/spans.md)

## Step 3: Dry run

Generate the request without submitting, so mode, timestamps, and sink types
are validated and the resolved parameters are available for the next step:

```bash
grepr backfill <flags> --dry-run --output backfill-request.json
```

## Step 4: Preview matching data

Confirm the window and query actually match data before creating a job. Read
the resolved parameters from the dry-run output — in pipeline-derived mode
this is where the inferred dataset ID and data type come from:

```bash
jq 'del(.name, .limit, .tags, .teamIds, .sinks, .sqlOperation, .vendorSinkIntegrationIds)' backfill-request.json
```

Then sample a small number of matching records:

```bash
grepr query --dataset-id <datasetId> [--data-type spans] \
  --query "<query>" --query-type "<queryType>" \
  --start <start> --end <end> --limit 50 -q -f raw \
  -o backfill-preview.ndjson
```

If the preview returns no records, stop and report that to the user instead of
submitting — an empty backfill usually means a wrong window, dataset, or query.

## Step 5: Submit

Re-run the same command without `--dry-run` and capture the created job:

```bash
grepr backfill <flags> --output backfill-created.json
jq '{id, greprUrl, vendorLinks}' backfill-created.json
```

After submission, if `greprUrl` is present, immediately send the user a progress update before polling the job:
Backfill job created: <`greprUrl`>. Display the complete URL verbatim

## Step 6: Poll until finished

Backfills run as asynchronous batch jobs. Poll every ~30 seconds:

```bash
grepr job:get <job-id> -f raw | jq -r '.state'
```

Terminal states: `FINISHED`, `FAILED`, `CANCELLED`, `STOPPED`. Anything else
(`PENDING`, `WAITING`, `STARTING`, `RUNNING`, ...) means keep polling. On
`FAILED`, fetch the full job with `grepr job:get <job-id> -f raw` and report
the error to the user.

## Step 7: Report

Report each `vendorLinks[].url` with its label so the user can open
the backfilled data directly in that destination.

Tell the user that every backfilled `<data-type>` carries the
tags/attributes described in the loaded data-type reference, which can be used
when a vendor link is unavailable or not working. Follow any retry guidance
from that reference before rerunning a backfill.
