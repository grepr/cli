---
description: Diagnose and fix bad reduction (high passthrough, low reduction ratio, too many logs reaching sinks) on a Grepr pipeline. Use when reduction is bad, not working, or passthrough is too high. Covers the three causes — empty messages, over-broad reducer exceptions, and over-aggregation — builds a job-patch, and validates it via test-pipeline-change before any apply.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr --conf * query), Bash(grepr --conf * job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:change-exceptions, grepr:change-filtering, grepr:tune-grok, grepr:operations-reference
---

# Tune Pipeline Reduction

Reducer passthrough is "high" when too many incoming logs reach the sinks
unaggregated. Three independent causes drive this:

1. **Empty messages** — the reducer dedupes on the `message` field. If
   `message` is empty/missing, every log is its own pattern and nothing
   aggregates.
2. **Reducer exceptions** — logs matching `logReducerExceptions` predicates
   skip aggregation by design. Too-broad predicates bypass too much.
3. **Over-aggregation / wrong group-by** — logs that *should* split into
   distinct buckets collapse into one pattern (e.g. all GraphQL queries
   merging on `operationName` while differing by `query` text).

This skill diagnoses which cause is hurting the pipeline and builds a patch.
Resolve the org config once and reuse it on every command — see the `grepr:cli`
skill.

## Step 1: Get context

Fetch the raw dataset ID (source vertex), the remapper message paths, and the
reducer config (`partitionByAttributes`/`Paths`, `logReducerExceptions`,
`attributeMergeStrategyEntries`). Run `grepr:describe-pipeline <JOB_ID>` for the
full structural view, or `grepr job:get <JOB_ID> --resolved -f raw` when you
only need a couple of fields. For backend detection (template-backed vs raw
job-graph) and which ops each backend supports, see `grepr:describe-pipeline`.

`grepr query --start/--end` require **absolute ISO-8601 UTC** (e.g.
`2026-05-29T03:00:00Z`); relative offsets like `now-2h` are rejected. Compute
the window first with `date -u`.

## Step 2: Diagnose

| Symptom | Likely cause | First check |
|---|---|---|
| Many logs have empty `message` | Empty messages | `grepr query --dataset-id <RAW_DS> --message-length-min 0 --message-length-max 0 --limit 100` |
| Sink throughput ≈ source throughput on specific tags | Exceptions too broad | sample `logReducerExceptions` predicate volume |
| One pattern matches very different contents | Over-aggregation | sample reduced output; compare aggregated `message` vs a splitting attribute |
| One pattern per log | Empty messages or wrong group-by | check both |

If unsure, run all three checks — they are cheap. Empty messages and wrong
group-by often coexist; build one patch with all needed ops and test the set
together rather than serial cycles.

## Step 3: Empty messages

Sample the raw dataset (logs before the reducer); null messages count as
length zero:

```bash
grepr query --dataset-id <RAW_DS> --message-length-min 0 --message-length-max 0 \
  --start <T0> --end <T1> --limit 1000 -q -f raw -o empty-sample.ndjson
```

A figure above ~10% is significant. If both the total and empty queries return
~`limit` rows, treat it as "empty dominates" and widen the window for an exact
ratio.

Empty-message logs usually arrive in **multiple shapes**. Bucket the sample by
something stable (service, the log's `type`/`kind`, or `seed_case` in test
pipelines), and for each bucket find where the human-readable text lives. The
#1 cause of "patch reduced empties but didn't eliminate them" is fixing one
shape and missing the others. For candidate-field selection (which path becomes
`message`, group-by, aggregation) and the empty-`""`-vs-absent behavior, see
[reference.md](reference.md).

When creating `attributePath` values for `add-message-attribute`,
`add-group-by`, and `add-aggregation-strategy`, use paths relative to the log's
`attributes` object. The CLI output wraps log attributes under a top-level
`attributes` key, but the patch path omits that wrapper. For example, if a
sample row shows `attributes.additionalProperties.event_detail`, use
`additionalProperties.event_detail`.

Build ONE patch covering all shapes:
- Each message candidate → `add-message-attribute` (`attributePath`).
  `messageReservedAttributePaths` accepts many paths and picks the first present.
- Medium-cardinality splitters → `add-group-by` (`attributePath`).
- Numeric measurements → `add-aggregation-strategy` (`attributePath`,
  single-element `strategies`: `sum`|`min`|`max`|`avg`). One strategy per path.

For an empty-message fix, keep the first patch minimal unless you observed a
separate over-aggregation problem. Do not add a group-by just because a field is
present in the sample. Low-cardinality fields such as `status`/`result` are
useful group-bys only when they preserve meaning for the chosen message
candidate (for example HTTP route + method + status), not as a default add-on.

See [examples.md](examples.md) for full patches. For exact field schemas, see
`grepr:operations-reference`.

## Step 4: Over-broad exceptions

List every `logReducerExceptions` predicate from describe-pipeline. Sample each
predicate's matching volume against total traffic (same window/limit); `grepr
query` has no exact-count mode, so report a sample estimate:

```bash
grepr query --dataset-id <RAW_DS> --query "<predicate.query>" \
  --start <T0> --end <T1> --limit 1000 -q -f raw -o exception-sample.ndjson
```

**Red flag:** any single exception matching >20% of traffic is almost certainly
too broad. Common offenders: `status:error` (true error volume is usually <5%),
`severity:>=WARNING`, and auto-synced vendor exceptions with no allow-list.

Narrowing an existing exception is **template-only** (`set-input-field` on
`exceptions`). On raw graphs that path is rejected — hand off to
`grepr:change-exceptions`, which owns the broader narrow/add/remove vocabulary.
Adding a new exception (`add-reducer-exception`, `predicate` only) almost always
hurts reduction further, so prefer narrowing.

## Step 5: Over-aggregation

Sample reduced output only when a reduced/warehouse dataset is visible from
describe-pipeline. Do not invent `<REDUCED_DS>` from the raw dataset — if no
reduced sink is identifiable, validate from the draft's reducer-stage tap
instead.

```bash
grepr query --dataset-id <REDUCED_DS> --start <T0> --end <T1> --limit 100 -q -f raw -o reduced-sample.ndjson
```

Over-aggregation shows as an enormous aggregated count, or a generic `message`
where an attribute (HTTP method, error code, operation name) differs across the
merged sources. Fix it by adding a **medium-cardinality** (10–10,000 distinct)
group-by — high enough to split buckets, low enough to keep reduction. Avoid
trace/span/request IDs and path-param URLs (use `request.route`, not
`request.path`). Build with `add-group-by`; see [examples.md](examples.md).

## Step 6: Validate and apply

Write the patch to a fresh `patch-<short-tag>.json` (`{ "operations": [...] }`),
then hand the patch file to `grepr:test-pipeline-change`, which plans, drafts,
gates on approval, and applies. Report the before/after metrics (empty-message
%, reduction %, group cardinality) to the user and ask them to approve. This
skill never PUTs directly.

When interpreting draft results:
- `job:draft` samples a short live-streaming window, so baseline and patched
  runs hit different records. If total record counts differ by **>20%**, the
  windows weren't comparable — re-run or note the limitation.
- A literal **0% empty after patch** (baseline was 5–15%) is suspicious; real
  full-coverage fixes leave a low-single-digit tail. Verify with a second run.

## What to watch out for

- **Don't lower `dedupThreshold`** to fake reduction — fix the upstream cause.
- The reducer dedupes on the **post-mask** `message` (`timestamp`, `uuid`,
  `ipport`, `number` masks pre-applied). Numeric IDs in patterns usually mean a
  mask is off — check the reducer's `enabledMasks`.
- Aggregation strategies are safe only for fields that are actually numeric in
  the sample; string/missing/mixed-type fields can fail the draft.
- Query a few time windows — reduction varies hourly with traffic mix.
- Unparsed shapes causing empty messages → `grepr:tune-grok` first. Noise that
  should never reach the reducer → `grepr:change-filtering`.

## Resources

- [examples.md](examples.md) — ✅ template-backed + ✅ raw-graph patches,
  ❌ anti-patterns, each with a short "why".
- [reference.md](reference.md) — empty-message candidate-field analysis tables
  and the empty-`""`-vs-absent remapper behavior.
- `grepr:describe-pipeline` — backend detection + capability matrix.
- `grepr:test-pipeline-change` — plan → draft → gate → apply.
- `grepr:operations-reference` — full op catalog and exact field names.
- `grepr:change-exceptions`, `grepr:change-filtering`, `grepr:tune-grok` —
  dedicated edits to one dimension.
