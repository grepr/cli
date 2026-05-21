---
description: Diagnose and fix bad reduction (high passthrough) on a Grepr pipeline. Covers empty messages, exceptions bypassing the reducer, and over-aggregation. Builds a pipeline:edit patch, validates it via test-pipeline-change, and requires explicit user approval before pipeline:apply.
allowed-tools: Bash(grepr query), Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), Bash(grepr pipeline:apply), Bash(grepr job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:change-exceptions, grepr:change-filtering, grepr:change-source, grepr:tune-grok, grepr:query-logs, grepr:grepr-model
trigger_keywords:
  - tune reduction
  - reduction is bad
  - reduction not working
  - passthrough too high
  - too many logs
  - low reduction ratio
  - fix reduction
  - improve reduction
---

# Tune Pipeline Reduction

Reducer passthrough is "high" when too many incoming logs reach the sinks
unaggregated. Three independent causes drive this:

1. **Empty messages** — the reducer dedupes on the `message` field. If
   `message` is empty/missing, every log is its own "pattern" and nothing
   aggregates.
2. **Reducer exceptions** — logs matching `logReducerExceptions` predicates
   skip aggregation by design. If these predicates are too broad, the bypass
   is too aggressive.
3. **Over-aggregation / wrong group-by** — logs that *should* group into
   distinct buckets all collapse into one pattern (e.g. all GraphQL queries
   merging because they share `operationName` but differ by `query` text).

For the specific cases below, this skill diagnoses and patches in-place.
For deeper edits to one dimension, hand off to the dedicated sibling
skill:

- **Exception predicates need surgery** → `grepr:change-exceptions` (broader
  vocabulary for narrowing, adding, or removing exceptions).
- **Unparsed log shapes are why messages are empty** → `grepr:tune-grok`
  (extract attributes first, then come back here).
- **Noise should never reach the reducer in the first place** →
  `grepr:change-filtering` (drop classes of logs at the pipeline edge).

This skill diagnoses which one is hurting the pipeline, builds a
`pipeline:edit` patch, and **never** applies it directly — it always routes
through `test-pipeline-change` so the user sees before/after metrics and
explicitly approves the change.

## Step 1: Get Context

You need:
- The raw dataset ID (from the source vertex)
- The current remapper settings (`messageReservedAttributes` / `Paths`)
- The current reducer settings (`partitionByAttributes` / `Paths`,
  `logReducerExceptions`, `attributeMergeStrategyEntries`)

Two ways to fetch these — pick based on what you need:

- **`grepr:describe-pipeline <JOB_ID>`** when you want the full structural
  view, want to verify topology, or are about to make non-obvious
  decisions and the wider context will inform them.
- **`grepr job:get <JOB_ID> --resolved -f raw`** when you only need a
  couple of fields (e.g. raw dataset ID + reducer config) and the
  describe-pipeline output would be overkill. Faster and quieter.

Either is fine — don't run both.

## Step 2: Quick Diagnosis Table

| Symptom                                              | Most likely cause            | First check                                                                                  |
|------------------------------------------------------|------------------------------|----------------------------------------------------------------------------------------------|
| Many logs have empty `message`                       | Empty messages               | `grepr query --dataset-id <RAW_DS> --message-length-min 0 --message-length-max 0 --limit 100` |
| Sink throughput ≈ source throughput on specific tags | Exceptions too broad         | Check `logReducerExceptions` against actual log volume                                       |
| One pattern matches very different log contents      | Over-aggregation             | Sample reduced logs; look at the aggregated `message` vs. an attribute that should split it  |
| Logs split when they shouldn't (one pattern per log) | Empty messages or wrong group-by | Check both                                                                                  |

If unsure, **run all three checks** — they're cheap.

## Step 3: Check for Empty Messages

The raw dataset stores logs before the reducer sees them. Use the
`--message-length-min/max` predicate on `grepr query`:

```bash
grepr query --dataset-id <RAW_DS> \
  --message-length-min 0 --message-length-max 0 \
  --start <T0> --end <T1> --limit 1000 -f raw
```

Compute the percentage of empty messages in the sample. **A figure above
~10% is significant.**

### Find a Message Attribute Candidate

For each sample empty-message log, look for fields containing a human-readable
message. Common candidates (try in order):

| Candidate path        | Notes                                                       |
|-----------------------|-------------------------------------------------------------|
| `message.data.message` | Common in nested log frames (Datadog, vendor wrappers).    |
| `msg.request.query`   | GraphQL — the query text is the actual content.            |
| `msg.message`         | Catches re-serialized log objects.                          |
| `body`                | OTLP-style.                                                 |
| `body.action`, `body.method` | Action-style logs.                                    |
| `request.path`        | HTTP access logs without a body.                            |
| `event.type`          | Event-driven logs.                                          |

**Avoid as candidates:** trace IDs, span IDs, request IDs, timestamps, pod
names, hostnames. These have unbounded cardinality and produce one pattern
per log.

### Survey for multiple empty-message shapes before patching

Empty-message logs from one source usually come in **multiple shapes**, not
one. Skipping this step is the #1 cause of "the patch reduced empty
messages but didn't eliminate them" — you fixed one shape and missed three
others.

For each distinct empty-message log shape in your sample, identify the
candidate path that would carry the message. The simplest way:

- Bucket the empty-message sample by something stable (service, source,
  the log's `type` or `kind` field, or in test pipelines the `seed_case`
  tag).
- For each bucket, look at one example log and ask "where does the
  human-readable text actually live?"

Build one patch with **all** the candidate paths, not just the first one
you find. The reducer's `messageReservedAttributePaths` accepts multiple
paths and picks the first one present per log, so listing several is safe
and cheap. Approving + applying one larger patch beats two redeploys for
two patches.

If you genuinely see only one shape in a representative sample (say, 100+
records), one path is fine — just be deliberate about that conclusion.

### Build the Patch

Each chosen candidate becomes an `add-message-attribute` operation:

```json
{
  "operations": [
    { "op": "add-message-attribute", "attributePath": "message.data.message" },
    { "op": "add-message-attribute", "attributePath": "msg.request.query" }
  ]
}
```

Save to `patch.json`.

## Step 4: Check for Bypassing Exceptions

From `describe-pipeline`, list every `logReducerExceptions` predicate. Run a
query for each predicate's matching volume:

```bash
grepr query --dataset-id <RAW_DS> --query "<predicate.query>" \
  --start <T0> --end <T1> --limit 0 -f raw
```

(`--limit 0` returns counts when supported; otherwise use a small limit and
inspect.) Calculate what fraction of total volume each exception lets
through.

**Red flag:** any single exception matching > 20% of traffic — that's almost
certainly too broad. Common offenders:

- `status:error` — true error volume is usually < 5%; if it's higher the
  pipeline is probably misclassifying.
- `severity:>=WARNING` — equivalent issue.
- Vendor-imported exceptions (`integrationExceptionConfigs.autoSync: true`)
  with no allow-list.

### Build the Patch

Replace the full exceptions list via `set-input-field` on
`exceptions`. Each entry is a `TemplateException` — for predicate-driven
bypass, use `type: "query-exception"`:

```json
{
  "operations": [
    {
      "op": "set-input-field",
      "path": "exceptions",
      "value": [
        { "type": "query-exception", "predicate": { "type": "datadog-query", "query": "status:error AND service:checkout" } }
      ]
    }
  ]
}
```

For surgical edits — adding to or narrowing one specific entry — prefer
the dedicated `grepr:change-exceptions` skill.

Alternatively, to *add* a new exception without touching existing ones:

```json
{
  "operations": [
    {
      "op": "add-reducer-exception",
      "name": "checkout-errors",
      "predicate": { "type": "datadog-query", "query": "status:error AND service:checkout" }
    }
  ]
}
```

Prefer **narrowing existing predicates** over adding new ones — adding
exceptions almost always hurts reduction further.

## Step 5: Check for Over-Aggregation

Pull a sample of reduced output (the warehouse sink dataset, or via the
warehouse sink iceberg dataset):

```bash
grepr query --dataset-id <REDUCED_DS> --start <T0> --end <T1> --limit 100 -f raw
```

For each aggregated message, ask: do these source logs *belong together*?
Signs of over-aggregation:

- The aggregated count is enormous (thousands of logs in one pattern).
- The `message` field is generic but an attribute differs across sources
  (e.g., HTTP method, error code, GraphQL operation name).

### Pick a Group-By Attribute

Aim for **medium cardinality** (10–10,000 distinct values) — high enough to
split the buckets meaningfully, low enough to still get reduction. Good
candidates:

| Candidate              | Good for                            |
|------------------------|--------------------------------------|
| `request.method`       | HTTP access logs                     |
| `request.status_code`  | HTTP responses                       |
| `error.type`           | Exception logs                       |
| `msg.operationName`    | GraphQL                              |
| `service`              | Multi-service pipelines              |

**Bad candidates (too high cardinality):** trace IDs, span IDs, request IDs,
URLs with path params (use `request.route` if present, not `request.path`).

### Build the Patch

```json
{
  "operations": [
    { "op": "add-group-by", "attributePath": "msg.operationName" }
  ]
}
```

## Step 6: Validate via `test-pipeline-change`

**Never apply directly.** Hand the patch to `test-pipeline-change`:

```
test-pipeline-change with --job-id <JOB_ID> --patch patch.json
```

That skill will:
1. Generate a plan with `pipeline:edit`.
2. Run a core-chain test job via `job:to-test --core-chain`.
3. Report before/after metrics (empty-message %, reduction %, group
   cardinality).
4. Wait for explicit user approval.
5. Call `pipeline:apply` with retry/drift handling.

Report the metrics to the user and ask them to approve.

## What to Watch Out For

- **Multi-cause issues** — empty messages and wrong group-by often coexist.
  Build one patch with all needed ops, test the whole set together (cheaper
  than serial test cycles).
- **Sample bias** — query a few different time windows; reduction can vary
  hourly with traffic mix.
- **Baseline vs patched draft volume mismatch** — `pipeline:draft` samples
  a short window of live streaming traffic, so the baseline and patched
  runs hit different records. Check the total record counts before
  trusting the percentage comparison:
  - If the two runs differ by **>20%** in total record count, the windows
    weren't comparable. Re-run both (longer window if possible) or note
    the limitation explicitly when you present results.
  - A literal **0% empty after patch** when the baseline was 5–15% empty
    is suspicious — verify with a second patched run or a longer window
    before trusting it. Realistic full-coverage fixes leave a tail of
    low-single-digit %, not zero.
- **Don't tune reduction by lowering `dedupThreshold`** — that just lies
  about how many logs you saw. Fix the upstream cause.
- **The reducer dedupes on the post-mask form of `message`** — masks like
  `timestamp`, `uuid`, `ipport`, `number` are already applied. If you see
  numeric IDs in patterns, they probably aren't being masked; check the
  reducer's `enabledMasks` field.

## Hand-off Boundary

This skill **diagnoses and proposes**. It never PUTs. Production writes only
happen via `test-pipeline-change` → `pipeline:apply` with explicit user
approval.
