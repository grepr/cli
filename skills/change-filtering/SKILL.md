---
description: Set, modify, or clear pipeline filters on a Grepr pipeline. Filters drop unwanted logs at a chosen stage (pre-parser, pre-aggregation, pre-exceptions, pre-warehouse). Estimates drop volume before applying. Routes through test-pipeline-change.
allowed-tools: Bash(grepr query), Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), Bash(grepr pipeline:apply), Bash(grepr job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query-logs
trigger_keywords:
  - change filtering
  - add filter
  - drop logs
  - filter out
  - exclude logs
  - remove filter
  - filter too aggressive
---

# Change Pipeline Filtering

Use when:
- A class of logs should never reach the warehouse (debug logs, health
  checks, vendor heartbeats).
- An existing filter at one of the four phases is too aggressive or too
  permissive.
- The user wants to reduce ingest cost by filtering at the pipeline edge.

Filter changes operate on transform-stage data — routes through
`grepr:test-pipeline-change`.

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` and note:
- Which of the four phase slots currently has a filter and what its
  predicate is.
- The raw dataset ID (for drop-volume estimation).

## Step 2: Pick the Phase

Filters are **phase-slotted**, not arbitrary vertices in the graph. The
template owns topology; each phase holds at most one filter. The four
phases:

| Phase | What gets filtered | Use when |
|-------|---------------------|----------|
| `pre-parser` | Everything entering the pipeline | Drop noise at the cheapest point — JSON parsing skipped on dropped logs |
| `pre-aggregation` | Logs about to enter the reducer | Filter after parsing/remapping but before grouping |
| `pre-exceptions` | Logs about to bypass the reducer | Stop a bypassed class from skipping aggregation |
| `pre-warehouse` | Logs about to be archived | Keep them in the reducer's output stream but drop from cold storage |

Most user requests fit `pre-parser` — they want noise gone everywhere.

## Step 3: Estimate Drop Volume

`logs-filter` **keeps** logs matching its predicate. Phrase your predicate
as "what to keep" — use `NOT (...)` when the intent is "drop these."

```bash
# Count what would be DROPPED (matches the negation of the keep predicate)
grepr query --dataset-id <RAW_DS> --query "<the drop condition>" \
  --start <T0> --end <T1> --limit 0 -f raw

# And what would be KEPT
grepr query --dataset-id <RAW_DS> --query "NOT (<the drop condition>)" \
  --start <T0> --end <T1> --limit 0 -f raw
```

Show the user the split before constructing the patch. A filter dropping
>50% of traffic should be a deliberate decision, not an accident.

## Step 4: Build the Patch

### Case A — Add or replace a filter at a phase

`set-filter` overwrites the slot — same op whether you're installing the
first filter or replacing one that's already there:

```json
{
  "operations": [
    {
      "op": "set-filter",
      "phase": "pre-parser",
      "filter": {
        "type": "logs-filter",
        "name": "drop_healthchecks",
        "predicate": {
          "type": "datadog-query",
          "query": "NOT (path:/healthz OR path:/readyz OR path:/ping)"
        }
      }
    }
  ]
}
```

### Case B — Modify just the predicate of an existing filter

Use `set-input-field` to overwrite the predicate without re-stating the
whole filter shell:

```json
{
  "operations": [
    {
      "op": "set-input-field",
      "path": "filters.pre-parser.predicate.query",
      "value": "NOT (path:/healthz OR path:/readyz OR path:/ping OR path:/metrics)"
    }
  ]
}
```

### Case C — Remove a filter entirely

```json
{
  "operations": [
    { "op": "clear-filter", "phase": "pre-warehouse" }
  ]
}
```

## Step 5: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `build/patch.json`.
The draft harness runs the patched pipeline on the flink-session-cluster
and tags output with `draftOutputs` stage info — you can see records
flowing into and out of each filter stage.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| Output volume after the patched filter stage | Matches the "kept" count from step 3, within a few % |
| Sampled output | None of the unwanted shape made it through |
| Sampled output | All of the wanted shape still made it through |
| Reduction % (if filter is upstream of the reducer) | Often improves (less noise = cleaner aggregation) |

## Common Failure Modes

- **Filter drops everything**: predicate is the opposite of what you
  intended. `logs-filter` keeps matches — `query: "service:foo"` keeps
  only `service:foo` logs, it doesn't drop them. Use `NOT (...)` to drop.
- **Filter drops too much**: predicate is overly broad. Re-run step 3 with
  the actual predicate (not a paraphrase) before applying.
- **Phase choice is wrong**: dropping at `pre-warehouse` still pays the
  reducer's CPU cost. Drop at `pre-parser` whenever the logs are unwanted
  everywhere downstream.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
