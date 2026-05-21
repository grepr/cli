---
description: Safety harness for validating pipeline patches before production. Called by intent skills (tune-reduction, tune-grok, change-exceptions, change-filtering, change-source) after they produce a patch. Uses the platform's draft-mode pipeline feature — runs the patched template inputs against the flink-session-cluster, streams per-stage NDJSON output (`draftOutputs`), compares against a baseline, and gates production apply on explicit user approval. Not normally invoked directly by users.
allowed-tools: Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), Bash(grepr pipeline:draft), Bash(grepr pipeline:apply), Bash(grepr job:get), Bash(grepr query), grepr:describe-pipeline
trigger_keywords:
  - validate pipeline patch
---

# Safety Harness for Pipeline Patches (Draft-Mode Backed)

Infrastructure called by intent skills, not a workflow users invoke
directly. When a user says "tune reduction" or "add a grok rule," they
reach an intent skill (`tune-reduction`, `tune-grok`, `change-exceptions`,
`change-filtering`, `change-source`); that skill emits a patch against the
pipeline's template inputs and hands it to this harness.

## What's different from a raw sync sink

Sync-sink testing (the old `job:to-test --core-chain` path) reads the raw
data lake and runs it through a transform chain. The draft-mode harness is
strictly better:

1. **Per-stage outputs.** The platform tags records with which stage they
   came from (after parser, after remapper, after reducer). You can verify
   "did the remapper actually pick up my new message attribute?" without
   guessing from the final sink output.
2. **Source-config validation.** Draft mode runs the patched configuration
   end-to-end on the flink-session-cluster, including real source ingest
   from any newly-added source vertex. The sync-sink harness skipped the
   source entirely.
3. **Same substrate as production.** The draft submission uses the same
   `templateInputs.input` shape as `pipeline:apply`, so what you tested is
   exactly what you'll deploy.

What the harness **cannot** validate: sink delivery. There's no readback
from the destination vendor. Patches that touch sinks are rejected via
`validateForDraftHarness`; the harness surfaces an error pointing to that
gap.

## Inputs

The calling intent skill provides:
- `<JOB_ID>` — the live job to edit
- A patch file at a known path (convention: `patch.json`)

If you arrived here without both, the caller's logic is incomplete — bounce
back to the intent skill, don't ask the user for a patch.

## Step 1: Generate the Plan

```bash
grepr pipeline:edit --job-id <JOB_ID> --patch patch.json -o plan.json
```

Fetches the **unresolved** live job (template inputs visible), applies the
patch to `templateInputs.input`, and writes a plan file recording:
- `baseVersion` (for drift detection at apply time)
- `classification` (`transform-only` / `touches-source` / `touches-sink` /
  `mixed`) — read this in step 1a
- `patch`, `current`, `proposed`, `diff[]`

No production write happens here.

If the patch is malformed (e.g. `add-message-attribute` on a pipeline with
no remapper, or non-template-backed pipeline), `pipeline:edit` fails with a
specific error. Report verbatim to the calling intent skill and stop.

### Step 1a: Reject sink-touching patches

```bash
jq -r '.classification' plan.json
```

If the classification is `touches-sink` or `mixed`, **stop**. Don't run
the draft, don't run `pipeline:apply`, don't offer a bypass. Surface:

> "This patch touches a sink vertex (`<classification>`). Use the Grepr
> UI for sink changes. If the patch also has non-sink ops, split them
> out and re-run on that subset."

For `transform-only` and `touches-source`, continue.

## Step 2: Show the User the Diff

```bash
grepr pipeline:plan --job-id <JOB_ID> --patch patch.json
```

Prints a colored, human-readable diff to stdout — one line per change,
paths like `parsers[log_attributes_remapper].messageReservedAttributes` or
`reducer.dedupThreshold`. Show this to the user before running the draft.

If the diff says `(no changes)`, the patch is a no-op against the current
pipeline — either the change is already in place or the patch targets the
wrong fields. Stop and surface this.

## Step 3: Run the Draft

```bash
grepr pipeline:draft plan.json > draft-output.ndjson
```

This:
- Reads the proposed template inputs from the plan.
- Flips `draftMode: true` on the template-operation vertex.
- Submits as a synchronous streaming job to `POST /v1/jobs/sync`.
- Streams NDJSON output to stdout (captured here to a file).

The platform expands the template with the patched inputs, runs a real
ingest on the flink-session-cluster, and tags each output record with
which `draftOutputs` stage it came from. The harness's value is in those
tags — they let you compare behavior at the right point in the pipeline.

## Step 4: Capture a Baseline (if useful)

For metric comparisons that need a before/after baseline (empty-message %,
reduction %, group cardinality), run the same draft against the
**unpatched** pipeline once:

```bash
# Create a no-op patch
echo '{"operations": []}' > no-op-patch.json
grepr pipeline:edit --job-id <JOB_ID> --patch no-op-patch.json -o baseline-plan.json
grepr pipeline:draft baseline-plan.json > baseline-output.ndjson
```

Baselines can be cached if the time window is unchanged. Most patches
don't need a separate baseline — the per-stage tagging in the patched run
shows the change directly.

## Step 5: Compare Metrics

What to measure depends on the patch type:

| Patch op type | Metric (filter the right `draftOutputs` stage) | Improvement signal |
|---------------|------------------------------------------------|--------------------|
| `add-message-attribute` | Empty `message` %, after the remapper stage | Drops substantially (e.g. 44% → 8%) |
| `add-group-by` | Distinct group cardinality, after the reducer | Splits into multiple buckets |
| `add-aggregation` | Output cardinality + numeric range, after reducer | Aggregations populated; reduction stable |
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
grepr pipeline:apply plan.json
```

`pipeline:apply` handles:
- **Drift detection** — refuses if the live job has moved past `baseVersion`
  unless `--force`.
- **409 retries** — exponential backoff (1s → 2s → 4s) up to 3 tries.
  Distinguishes drift from deploy-in-flight.

If `pipeline:apply` reports drift, regenerate the plan from step 1 against
the new version and re-do the workflow. Don't `--force` automatically.

## When Things Go Sideways

| Situation | Action |
|-----------|--------|
| `pipeline:edit` fails with "not template-backed" | This CLI only supports template-backed pipelines. Surface to the user; the pipeline may need migration. |
| `pipeline:edit` fails on a domain op (e.g. `add-message-attribute` with no remapper) | Pipeline shape doesn't match the op's assumptions. Adjust the patch or use a different op. |
| `pipeline:plan` shows `(no changes)` | Patch is a no-op. Stop and ask. |
| `pipeline:draft` returns errors | Draft submission failed — likely a malformed template input. Show the error verbatim. |
| Draft output empty | The time window may have no traffic, or the source vertex isn't producing. Investigate before retrying. |
| Test metrics flat / no improvement | Show the user. Don't apply. Iterate on the patch. |
| `pipeline:apply` returns drift | Someone else edited the pipeline. Re-run from step 1; don't `--force`. |
| `pipeline:apply` repeated 409s | Deploy is stuck. Surface to the user; check pipeline status manually. |

## Files Used / Generated

The filenames below are conventions for this skill, not a directory
mandate — write them wherever fits the user's working directory (don't
clobber an existing file with the same name; suffix or change as needed).

- `patch.json` — input from the previous skill
- `plan.json` — generated by step 1, consumed by step 6
- `draft-output.ndjson` — streamed draft results
- `baseline-output.ndjson` (optional) — baseline for comparison
- `no-op-patch.json`, `baseline-plan.json` (optional) — baseline scaffolding
