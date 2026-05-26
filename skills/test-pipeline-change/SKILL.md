---
description: Safety harness for validating pipeline patches before production. Called by intent skills (tune-reduction, tune-grok, change-exceptions, change-filtering, change-source) after they produce a patch. Uses template draft mode for template-backed pipelines and CLI-side sync draft rewrites for raw job graphs, streams per-stage NDJSON output, compares against a baseline, and gates production apply on explicit user approval. Not normally invoked directly by users.
allowed-tools: Bash(grepr job:edit), Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr job:apply), Bash(grepr job:get), Bash(grepr query), grepr:describe-pipeline
trigger_keywords:
  - validate pipeline patch
---

# Safety Harness for Pipeline Patches (Draft-Mode Backed)

Infrastructure called by intent skills, not a workflow users invoke
directly. When a user says "tune reduction" or "add a grok rule," they
reach an intent skill (`tune-reduction`, `tune-grok`, `change-exceptions`,
`change-filtering`, `change-source`); that skill emits a patch against the
pipeline's template inputs and hands it to this harness.

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

### What's different from a raw sync sink

Sync-sink testing (the old `job:to-test` core-chain path) reads the raw
data lake and runs it through a transform chain. The draft harness is
strictly better:

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

## Step 1: Generate the Plan

```bash
grepr job:edit --job-id <JOB_ID> --patch patch.json -o plan.json
```

Fetches the **unresolved** live job (template inputs visible), applies the
patch to `templateInputs.input`, and writes a plan file recording:
- `baseVersion` (for drift detection at apply time)
- `classification` (`transform-only` / `touches-source` / `touches-sink` /
  `mixed`) — read this in step 1a
- `patch`, `current`, `proposed`, `diff[]`

No production write happens here.

If the patch is malformed (e.g. `add-message-attribute` on a pipeline with
no remapper, or a topology op like `set-filter` against a non-UI raw
graph), `job:edit` fails with a specific error. Report verbatim to the
calling intent skill and stop.

### Step 1a: Surface output verification limitations

```bash
jq -r '.classification' plan.json
```

If the classification is `touches-sink` or `mixed`, do not claim draft
validated delivery to the external destination. Continue only as
graph/upstream verification and surface:

> "This patch touches sink/data-lake output config (`<classification>`).
> The sync draft can verify graph/upstream behavior, but it cannot verify
> external sink delivery."

For `transform-only` and `touches-source`, continue normally.

## Step 2: Show the User the Diff

```bash
grepr job:plan --job-id <JOB_ID> --patch patch.json
```

Prints a colored, human-readable diff to stdout — one line per change,
paths like `parsers[log_attributes_remapper].messageReservedAttributes` or
`reducer.dedupThreshold`. Show this to the user before running the draft.

If the diff says `(no changes)`, the patch is a no-op against the current
pipeline — either the change is already in place or the patch targets the
wrong fields. Stop and surface this.

## Step 3: Run the Draft

```bash
grepr job:draft plan.json > draft-output.ndjson
```

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

## Step 4: Capture a Baseline (if useful)

For metric comparisons that need a before/after baseline (empty-message %,
reduction %, group cardinality), run the same draft against the
**unpatched** pipeline once:

```bash
# Create a no-op patch
echo '{"operations": []}' > no-op-patch.json
grepr job:edit --job-id <JOB_ID> --patch no-op-patch.json -o baseline-plan.json
grepr job:draft baseline-plan.json > baseline-output.ndjson
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
grepr job:apply plan.json
```

`job:apply` handles:
- **Drift detection** — refuses if the live job has moved past `baseVersion`
  unless `--force`.
- **409 retries** — exponential backoff (1s → 2s → 4s) up to 3 tries.
  Distinguishes drift from deploy-in-flight.

If `job:apply` reports drift, regenerate the plan from step 1 against
the new version and re-do the workflow. Don't `--force` automatically.

## When Things Go Sideways

| Situation | Action |
|-----------|--------|
| `job:edit` fails with "unsupported raw job graph shape" | The op is a UI-level topology change (`set-filter`, `add-source`, `add-parser`, etc.) but the direct job graph is not the canonical UI log-pipeline shape. Either use unambiguous field-level ops only, migrate/template the pipeline, or apply the topology change manually via `grepr job:get` + edit + `grepr job:update`. |
| `job:edit` fails with "generic template-input paths are not supported on raw job graphs" | `set-input-field` / `unset-input-field` paths only apply to template inputs. Use a semantic operation or edit the raw graph manually. |
| `job:edit` fails on a domain op (e.g. `add-message-attribute` with no remapper) | Pipeline shape doesn't match the op's assumptions. Adjust the patch or use a different op. |
| `job:plan` shows `(no changes)` | Patch is a no-op. Stop and ask. |
| `job:draft` returns errors | Draft submission failed — likely a malformed template input. Show the error verbatim. |
| Draft output empty | The time window may have no traffic, or the source vertex isn't producing. Investigate before retrying. |
| Test metrics flat / no improvement | Show the user. Don't apply. Iterate on the patch. |
| `job:apply` returns drift | Someone else edited the pipeline. Re-run from step 1; don't `--force`. |
| `job:apply` repeated 409s | Deploy is stuck. Surface to the user; check pipeline status manually. |

## Files Used / Generated

The filenames below are conventions for this skill, not a directory
mandate — write them wherever fits the user's working directory (don't
clobber an existing file with the same name; suffix or change as needed).

- `patch.json` — input from the previous skill
- `plan.json` — generated by step 1, consumed by step 6
- `draft-output.ndjson` — streamed draft results
- `baseline-output.ndjson` (optional) — baseline for comparison
- `no-op-patch.json`, `baseline-plan.json` (optional) — baseline scaffolding
