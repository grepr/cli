---
description: Safety harness for validating pipeline patches before production. Called by intent skills (tune-reduction, tune-grok, change-exceptions, change-filtering, change-source, change-output) after they produce a patch. Uses template draft mode for template-backed pipelines and CLI-side sync draft rewrites for raw job graphs, streams per-stage NDJSON output, compares against a baseline, and gates production apply on explicit user approval. Not normally invoked directly by users.
allowed-tools: Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr job:apply), Bash(grepr job:get), Bash(grepr query), grepr:describe-pipeline
trigger_keywords:
  - validate pipeline patch
---

# Safety Harness for Pipeline Patches (Draft-Mode Backed)

Infrastructure called by intent skills, not a workflow users invoke
directly. When a user says "tune reduction" or "add a grok rule," they
reach an intent skill (`tune-reduction`, `tune-grok`, `change-exceptions`,
`change-filtering`, `change-source`, `change-output`); that skill emits a
patch against the pipeline's template inputs and hands it to this harness.

## Backends: both supported

The CLI detects the pipeline's backend from the fetched job and the plan
carries the result (`plan.backend: "template" | "job-graph"`). The same
skill workflow works for both, but the harness underneath differs:

- **Template-backed (the canonical shape).** `job:draft` flips
  `draftMode: true` on the template-operation vertex; the server expands
  the template and runs the patched config on the flink-session-cluster.
  Per-stage tagging is server-supplied. This is the lossless path.
- **Direct job graph (legacy / pre-template).** `job:draft` rewrites the
  proposed job client-side and submits it to `/v1/jobs/sync`. For
  transform-only patches, it replaces the source with a
  `logs-iceberg-table-source` replay of the raw data lake, drops every
  production sink, and adds per-stage taps tagged with
  `sink-source=<stage-name>`. For source/output-touching patches, it
  preserves the proposed source vertices, removes production sinks, and
  adds sync/tap outputs. Records arrive interleaved across stages - group
  by the `sink-source` tag, not stream order.

Both produce NDJSON with stage-tagged records, so the metric tables below
work for both.

### What the draft harness gives you

1. **Per-stage outputs.** Records carry which stage they came from
   (template-backed: server-supplied `draftOutputs` tag; job-graph: the
   `sink-source` tag from the tap rewrite). You can verify "did the
   remapper actually pick up my new message attribute?" without guessing
   from the final sink output.
2. **Source-config validation.** Template-backed draft mode runs the
   patched config end-to-end on the flink-session-cluster, including real
   source ingest from any newly-added source vertex. Direct job graphs use
   source-preserving draft for source-touching edits, so canonical
   UI-shaped raw graph source additions are exercised too. Non-UI raw DAGs
   still reject UI-level topology edits with `unsupported raw job graph
   shape`.
3. **Same substrate as production.** Template-backed draft submission
   uses the same `templateInputs.input` shape as `job:apply`, so
   what you tested is exactly what you'll deploy. Job-graph draft sends a
   tap-rewritten test variant — the patched fields you're testing are
   identical to what `job:apply` will write, but the surrounding
   topology (sources/sinks) is replaced for the test only.

What the harness **cannot** validate: external sink delivery. There's no
readback from the destination vendor. Sink/data-lake output patches can be
planned, drafted, and applied, but draft output is graph/upstream
verification only. Surface that limitation explicitly before apply.

## Inputs

The calling intent skill provides:
- `<JOB_ID>` — the live job to edit
- A patch file at a known path (convention: `patch.json`)

If you arrived here without both, the caller's logic is incomplete — bounce
back to the intent skill, don't ask the user for a patch.

### Artifact hygiene

Use a **unique filename per request and operation** — don't reuse
`patch.json`, `plan.json`, or `draft-output.ndjson` across unrelated edits,
and never overwrite a stale plan you might still need. When several edits
are in flight (or a subagent is involved), suffix the names
(`patch-<short-tag>.json`, `plan-<short-tag>.json`). Fully overwrite a fresh
artifact rather than patching an old one in place.

## Step 1: Generate the Plan

```bash
grepr job:plan --job-id <JOB_ID> --patch patch.json -o plan.json
```

`job:plan` fetches the **unresolved** live job (template inputs visible),
applies the patch (template-backed: to `templateInputs.input`; job-graph: to
the resolved graph), and — with `-o` — writes a plan file recording:
- `schemaVersion`, `jobId`, `backend` (`template` | `job-graph`)
- `baseVersion` (for drift detection at apply time)
- `classification` (`transform` / `source` / `sink` / `mixed`) — read this
  in step 1a
- `patch`, `current`, `proposed`, `diff[]` (each diff entry carries
  structured `before`/`after` plus a one-line `summary`)

No production write happens here.

If the patch is malformed (e.g. `add-message-attribute` on a pipeline with
no remapper, a topology op like `set-filter` against a non-UI raw graph, a
wrong field name, or a proposal that would leave the pipeline with zero
sources), `job:plan` fails with a specific error **before** writing anything.
Report it verbatim to the calling intent skill and stop.

### Step 1a: Surface output verification limitations

```bash
jq -r '.classification' plan.json
```

If the classification is `sink` or `mixed`, do not claim draft validated
delivery to the external destination. Continue only as graph/upstream
verification and surface:

> "This patch touches sink/data-lake output config (`<classification>`).
> The sync draft can verify graph/upstream behavior, but it cannot verify
> external sink delivery to the destination vendor."

For `transform` and `source`, continue normally.

### Step 1b: Scan the diff for dangerous removals

The plan has no separate `warnings` field — inspect `diff[]` yourself. Treat
the removal of a critical config field as a **blocking** finding that needs
explicit user confirmation before you continue, in particular:
- `maxLateEventTimestampDelta` disappearing from the pre-warehouse filter
  (set-filter/clear-filter now merge over the existing slot, so this should
  not happen on a query-only edit — if you see it, the patch is wrong).
- Any `- sources[...]`, `- sinks[...]`, or `- edge ...` you didn't intend.

```bash
jq -r '.diff[] | select(.kind=="remove") | .summary' plan.json
```

If a removal is unexpected, stop and surface it before drafting.

## Step 2: Show the User the Diff

```bash
grepr job:plan --job-id <JOB_ID> --patch patch.json --dry-run
```

`--dry-run` prints a colored, human-readable diff and writes nothing — one
block per change, paths like
`parsers[log_attributes_remapper].messageReservedAttributes` or
`reducer.dedupThreshold`, with nested before/after rendered structurally so
collection changes stay readable. Show this to the user before drafting.
(It re-fetches and re-applies the patch; it does not consume the `plan.json`
from step 1.)

If the diff reports `0 change(s)`, the patch is a no-op against the current
pipeline — either the change is already in place (surface as "already
configured; no changes needed") or the patch targets the wrong fields. Stop
and surface this; don't draft or apply a no-op.

## Step 3: Run the Draft

```bash
grepr job:draft plan.json -o draft-output.ndjson
```

Use the `-o` flag — `job:draft` honors it and writes the NDJSON stream to
the file. **Do not** shell-redirect with `> draft-output.ndjson 2>&1`: that
mixes status logs and errors into the record file and corrupts parsing. Keep
command logs (stderr) separate from record output (the `-o` file).

This:
- Reads the plan, which carries `backend: "template" | "job-graph"`.
- **Template-backed**: flips `draftMode: true` on the template-operation
  vertex and submits to `POST /v1/jobs/sync`. The platform expands the
  template with the patched inputs, runs a real ingest on the
  flink-session-cluster, and tags each output record with which
  `draftOutputs` stage it came from.
- **Direct job graph**: builds a tap-instrumented test variant on the
  client side and submits to the same endpoint. Transform-only edits use
  iceberg replay. Source/output-touching edits preserve proposed sources,
  remove production sinks, and add sync/tap outputs. Records arrive
  carrying `sink-source: <stage-name>` tags.

### Job-graph extra flags

`job:draft` accepts these flags for the job-graph transform-only replay
path (template-backed ignores them; source-preserving raw drafts reject
replay flags because they use the proposed source vertices directly):

| Flag | Effect |
|------|--------|
| `--dataset-id <id>` | Override the raw dataset to replay from. Default: auto-detect from the first iceberg source/sink in the original graph. |
| `--start <iso>` / `--end <iso>` | Time window for the replay. |
| `--query <ddquery>` | Datadog-syntax filter applied at the iceberg source. |
| `--limit-records <n>` | Max records pulled. |

If the original pipeline ingests from an agent (Datadog, Splunk, OTLP, etc.)
and has no iceberg source/sink, you'll need `--dataset-id` explicitly —
auto-detection won't find a raw dataset. For source/output-touching raw
drafts, do not pass `--dataset-id`, `--start`, `--end`, or `--query`; only
`--limit-records` is relevant.

### Step 3a: Classify the draft result before trusting it

The draft's exit status alone does not mean the change was verified. Decide
which of these you actually got, and say so explicitly:

| Result | Meaning |
|--------|---------|
| Expected records, tagged per stage | **Validated** for the stages you can see. Proceed to compare metrics. |
| Only `HEARTBEAT` records, then `CANCELLED` | **No replay data** in the window — the draft ran but exercised nothing. Inconclusive, not a pass. Widen the window / pick a dataset with traffic, or note the limitation. |
| Timeout, non-zero exit, or no parseable records | **Inconclusive.** Show the error; do not present as validated. |
| Records present but all `unknown`/untagged | **Inconclusive** for per-stage claims. Investigate before trusting. |

Treat "the command finished" and "the change is verified" as different
states. If you only got plan/diff success without a clean draft, say the
plan is structurally valid but live behavior was not verified.

## Step 4: Capture a Baseline (if useful)

For metric comparisons that need a before/after baseline (empty-message %,
reduction %, group cardinality), run the same draft against the
**unpatched** pipeline once:

```bash
# Create a no-op patch
echo '{"operations": []}' > no-op-patch.json
grepr job:plan --job-id <JOB_ID> --patch no-op-patch.json -o baseline-plan.json
grepr job:draft baseline-plan.json -o baseline-output.ndjson
```

Alternatively, `grepr job:draft --job-id <JOB_ID> -o baseline-output.ndjson`
drafts the live pipeline as-is (no plan file, no edits) — handy for a quick
"where is my data transforming" baseline.

Baselines can be cached if the time window is unchanged. Most patches
don't need a separate baseline — the per-stage tagging in the patched run
shows the change directly.

## Step 5: Compare Metrics

What to measure depends on the patch type:

| Patch op type | Metric (filter the right `draftOutputs` stage) | Improvement signal |
|---------------|------------------------------------------------|--------------------|
| `add-message-attribute` | Empty `message` %, after the remapper stage | Drops substantially (e.g. 44% → 8%) |
| `add-group-by` | Distinct group cardinality, after the reducer | Splits into multiple buckets |
| `add-aggregation-strategy` | Output cardinality + numeric range, after reducer | Aggregations populated; reduction stable |
| `add-reducer-exception` | Exception-tagged volume + reduction % | Exception count up; reduction doesn't crater |
| `set-filter` / `clear-filter` | Records dropped at the filter stage | Matches predicate's hit rate |
| `add-grok-rule` | Target attribute presence after parser | Attribute populated on matching logs |
| `add-source` | Records flowing from the new source | Non-zero volume, expected tags, no source errors |
| `remove-source` | Records from removed source = 0 | Cleanly stopped |

**Always sanity-check beyond the headline metric.** Sample 5–10 records and
inspect by eye. A metric that improved while the output looks worse means
the patch is wrong.

Present the comparison to the user as a small table.

## Step 6: Gate on Explicit Approval, Then Apply

**Do not write to production without an explicit "yes" from the user this
turn.** Memory from previous interactions doesn't carry — re-confirm every
time.

Present:
1. The patch (one line per op).
2. The diff from step 2.
3. The metric comparison from step 5.
4. A short impact statement: "Pipeline will redeploy. New logs after the
   redeploy land will be affected. Existing logs in the warehouse are not
   touched."

Wait for confirmation. Then:

```bash
grepr job:apply plan.json
```

`job:apply` handles:
- **Drift detection** — refuses if the live job has moved past `baseVersion`
  unless `--force`.
- **Transient retries** — retries 408/429/500/502/503/504 (honoring a server
  `Retry-After` header when present), with exponential backoff otherwise. A
  409 is handled specially: it distinguishes real version drift (fatal) from
  a deploy still in flight.

If `job:apply` reports drift, regenerate the plan from step 1 against
the new version and re-do the workflow. Don't `--force` automatically.

### Sequential apply/revert

Before a second apply (e.g. apply then revert), poll the job until it is
back to `RUNNING` — a quick follow-up apply while the job is still
`UPDATING` can 409:

```bash
grepr job:get <JOB_ID> -f raw | jq -r '.state'   # wait for RUNNING
```

### Step 7: Verify post-apply (when claiming live behavior)

Apply succeeding is not the same as the live pipeline behaving as intended.
If you're going to claim post-change behavior, verify against a window
**after** the change landed:

1. Fetch the new version / timestamp: `grepr job:get <JOB_ID> -f raw | jq '{version, updatedAt}'`.
2. Confirm the stored shape matches the plan (the fields you patched are
   present in `proposed`).
3. Query only windows **after** `updatedAt`. A query that straddles the
   apply is stale — rerun it post-change before drawing conclusions. Don't
   treat restart/redeploy logs as proof of resumed normal traffic.

State precisely what you verified: *plan structurally valid* /
*draft produced expected records* / *apply succeeded* /
*post-apply live behavior confirmed* are four different claims. Don't say
"fully validated" when only the plan and diff succeeded.

## When Things Go Sideways

| Situation | Action |
|-----------|--------|
| `job:plan` fails with "unsupported raw job graph shape" | The op is a UI-level topology change (`set-filter`, `add-source`, `add-parser`, etc.) but the direct job graph is not the canonical UI log-pipeline shape. Either use unambiguous field-level ops only, migrate/template the pipeline, or apply the topology change manually via `grepr job:get` + edit + `grepr job:update`. |
| `job:plan` fails with "generic template-input paths are not supported on raw job graphs" | `set-input-field` / `unset-input-field` paths only apply to template inputs. Use a semantic operation or edit the raw graph manually. |
| `job:plan` fails with a field/value error (e.g. wrong field name, empty strategies) | The op payload is malformed. The error names the missing/incorrect field — fix the patch and regenerate. |
| `job:plan` fails on a domain op (e.g. `add-message-attribute` with no remapper) | Pipeline shape doesn't match the op's assumptions. Adjust the patch or use a different op. |
| `job:plan` fails with a zero-source error | The proposal would leave the pipeline with no sources. Every pipeline must keep at least one source — fix the patch. |
| `job:plan --dry-run` shows `0 change(s)` | Patch is a no-op (already configured, or wrong fields). Stop and ask. |
| `job:draft` returns errors | Draft submission failed — likely a malformed template input. Show the error verbatim. |
| Draft output empty or HEARTBEAT-only | No traffic in the window or the source isn't producing — see Step 3a. Inconclusive, not a pass. |
| Test metrics flat / no improvement | Show the user. Don't apply. Iterate on the patch. |
| `job:apply` returns drift | Someone else edited the pipeline. Re-run from step 1; don't `--force`. |
| `job:apply` repeated 409s | Deploy is in flight or stuck. Poll for `RUNNING`; if it never recovers, surface to the user and check pipeline status manually. |

## Files Used / Generated

The filenames below are conventions for this skill, not a directory
mandate — write them wherever fits the user's working directory (don't
clobber an existing file with the same name; suffix or change as needed).

- `patch.json` — input from the previous skill
- `plan.json` — generated by step 1, consumed by step 6
- `draft-output.ndjson` — streamed draft results
- `baseline-output.ndjson` (optional) — baseline for comparison
- `no-op-patch.json`, `baseline-plan.json` (optional) — baseline scaffolding
