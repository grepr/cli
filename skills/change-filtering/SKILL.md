---
description: Set, modify, or clear pipeline filters on a Grepr pipeline. Filters drop unwanted logs at a chosen stage (pre-parser, pre-aggregation, pre-exceptions, pre-warehouse). Estimates drop volume before applying. Routes through test-pipeline-change.
allowed-tools: Bash(grepr query), Bash(grepr job:edit), Bash(grepr job:plan), Bash(grepr job:apply), Bash(grepr job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query-logs
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

Filter changes operate on transform-stage data - routes through
`grepr:test-pipeline-change`.

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` and note:
- Which of the four phase slots currently has a filter and what its
  predicate is.
- The raw dataset ID (for drop-volume estimation).

## Step 2: Pick the Phase

Filters are **phase-slotted**, not arbitrary vertices in the graph. The
template/UI pipeline shape owns topology; each phase holds at most one
filter. The four phases describe **where in the pipeline the filter
sits**, not what it "protects" - what gets dropped downstream depends on
the specific template's topology, so verify against `describe-pipeline` before
asserting downstream effects to the user.

| Phase | Position in the pipeline |
|-------|---------------------------|
| `pre-parser` | First, before any parser. Cheapest drop point — JSON parsing skipped on dropped logs. Attributes from parsers/grok are NOT available yet (predicates can only reference fields present on the raw log). |
| `pre-aggregation` | Immediately before the reducer. Parser, remapper, and grok-extracted attributes are available. |
| `pre-exceptions` | On the path of logs about to bypass the reducer (matched the reducer's `logReducerExceptions` predicates). Filters here narrow the exception bypass. |
| `pre-warehouse` | After the parser/remapper chain, before downstream branches. In most templates this is upstream of both the warehouse sink and the reducer — verify topology before claiming "drops from warehouse only." |

Direct raw job graph support is shape-dependent:
- Canonical UI-shaped raw log graphs support `set-filter` and
  `clear-filter` for `pre-parser`, `pre-warehouse`, and
  `pre-exceptions`.
- `pre-aggregation` has no canonical UI raw-graph stage; use a
  template-backed pipeline for that phase or choose the closest real raw
  stage after inspecting topology.
- Non-UI raw DAGs reject UI-level filter topology edits with `unsupported
  raw job graph shape`.

**Picking the phase:**
- If the predicate references a grok-extracted attribute → must be at
  `pre-aggregation`, `pre-warehouse`, or `pre-exceptions` (anywhere
  post-grok). `pre-parser` won't have the attribute yet.
- If the predicate references only raw log fields (e.g. a top-level
  `source` tag or a raw attribute like `message`) → `pre-parser` is the
  cheapest place to drop.
- Most "drop noise everywhere" requests fit `pre-parser` when the
  predicate is composable from raw fields, otherwise `pre-warehouse`.

**When describing the patch to the user, state the *actual* downstream
effect for this pipeline's topology** (e.g. "in this pipeline,
pre-warehouse is upstream of the reducer too, so this drops from both
the warehouse sink and the reducer/exception paths"). Read the topology
from `describe-pipeline`'s output rather than asserting a generic
template behavior.

## Step 2a: Predicate Syntax — Tags vs Attributes

Filter predicates use the same query syntax as `grepr query`: Datadog-
style. The distinction that catches people out:

| Syntax | Matches |
|--------|---------|
| `field:value` | A **tag** named `field` (top-level, vendor-set or remapper-set) |
| `@field:value` | An **attribute** named `field` (deep field, including grok-extracted captures) |

Common tag names: `source`, `service`, `host`, `env`. Reserved attribute
names land back as tags via the remapper, so `service:checkout` works.

Common attribute paths: anything grok-extracted (`@route`,
`@http_status_code`, `@duration_ms`), anything in the structured body
(`@body.message`, `@msg.operationName`).

If you get this wrong, the filter **silently matches nothing** — and
because the filter is keep-style with a `NOT (...)` wrapper, "matches
nothing" means **every log is kept** (filter is a no-op). This is worse
than no filter: the patch ships, the user thinks it's working, and
nothing is actually being dropped.

Sanity-check the syntax in your draft output:
- For each field in your predicate, grep one record from the patched
  draft to confirm the field is present and has the value the predicate
  expects.
- If the predicate uses `@x`, the record should have `x` under
  `attributes` (or wherever attributes land in the draft's output
  format).
- If the predicate uses `x` (no @), the record should have `x` under
  `tags`.

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
whole filter shell. This generic path op is template-input only; for raw
job graphs use `set-filter` with the full filter object.

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

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `patch.json`.
The draft harness runs the patched pipeline on the flink-session-cluster
and tags output with `draftOutputs` stage info — you can see records
flowing into and out of each filter stage.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| Output volume after the patched filter stage | Matches the "kept" count from step 3, within a few % |
| Patched count of records the filter targets | **Zero** in the patched draft; non-zero in baseline. If both are non-zero, the predicate is silently no-op'ing (likely a tag-vs-attribute mix-up — see Step 2a). |
| Sampled output | None of the unwanted shape made it through |
| Sampled output | All of the wanted shape still made it through |
| Reduction % (if filter is upstream of the reducer) | Sharp drop → you removed something the reducer was successfully aggregating. Sharp increase → the dropped pattern was hurting reduction (likely good). Unchanged → neutral effect. Usually slight improvement for repetitive-noise drops (healthchecks, heartbeats). |

When presenting the result to the user, **state the actual downstream
effect using this pipeline's topology** — e.g., "in this pipeline,
pre-warehouse is upstream of the reducer too, so this drops from both
the warehouse sink and the reducer/exception paths." Don't recycle the
generic phase description from Step 2.

## Common Failure Modes

- **Filter drops everything**: predicate is the opposite of what you
  intended. `logs-filter` keeps matches — `query: "service:foo"` keeps
  only `service:foo` logs, it doesn't drop them. Use `NOT (...)` to drop.
- **Filter is silently a no-op (tag vs attribute mix-up)**: predicate
  references `field:value` when the field is actually an attribute (needs
  `@field:value`), or the reverse. Predicate evaluates false on every log;
  with the `NOT (...)` wrapper, every log is kept and no drops happen. The
  patched draft will look identical to the baseline. Sanity-check field
  presence per Step 2a before approving.
- **Filter drops too much**: predicate is overly broad. Re-run step 3 with
  the actual predicate (not a paraphrase) before applying.
- **Phase choice is wrong for the field**: if the predicate references a
  grok-extracted attribute, picking `pre-parser` means the attribute
  isn't available there and the predicate evaluates false on every log
  (silent no-op). Pick a post-grok phase.
- **Phase choice picks the wrong downstream effect**: a "drop from
  warehouse only" intent at `pre-warehouse` may also drop from the
  reducer in templates where `pre-warehouse` is upstream of both
  branches. Verify topology before assuming where the drop lands.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
