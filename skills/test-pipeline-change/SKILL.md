---
description: Safety harness that validates a pipeline patch before any production write — plans, shows a diff, drafts against live traffic, compares metrics, and gates apply on explicit user approval. Called by the intent skills (tune-reduction, tune-grok, change-exceptions, change-filtering, change-source, change-sink) after they emit a patch file; owns plan→draft→apply, draft-result interpretation, and drift/apply handling. Not normally invoked directly by users.
allowed-tools: Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr job:apply), Bash(grepr job:get), Bash(grepr query), Bash(grepr --conf * job:plan), Bash(grepr --conf * job:draft), Bash(grepr --conf * job:apply), Bash(grepr --conf * job:get), Bash(grepr --conf * query), Bash(jq), grepr:describe-pipeline, grepr:operations-reference
---

# Pipeline-change safety harness

Infrastructure called by intent skills, not a workflow users invoke directly.
An intent skill (`tune-reduction`, `tune-grok`, `change-exceptions`,
`change-filtering`, `change-source`, `change-sink`) emits a `JobPatch` file
and a `<JOB_ID>`, then hands them here. This skill plans the patch, drafts it
against live traffic, compares metrics, and gates production apply on explicit
approval — it owns the canonical plan→draft→apply workflow; other skills link
here rather than restate it.

Resolve the org config once and reuse it on every command — see the `grepr:cli`
skill. For backend detection and which ops each backend supports, see
`grepr:describe-pipeline`. For the full op catalog and exact field names, see
`grepr:operations-reference`.

## Inputs

The calling intent skill provides `<JOB_ID>` (the live job to edit) and a patch
file (prefer `patch-<short-tag>.json`). If you arrived without both, the
caller's logic is incomplete — bounce back to the intent skill; do not ask the
user for a patch. Use a unique filename per request/op so edits never clobber
each other — see "Files used/generated" in reference.md.

## Draft mechanics per backend

The plan carries `backend: "template" | "job-graph"`; both run the same workflow
but draft differently:

- **Template-backed** — `job:draft` flips `draftMode: true` on the
  template-operation vertex and submits to `POST /v1/jobs/sync`. The server
  expands the template with the patched inputs and runs a real ingest, tagging
  each record with the `draftOutputs` stage it came from. Same
  `templateInputs.input` shape as `job:apply`, so what you test is what deploys.
- **Raw job graph** — `job:draft` uses source-preserving live draft for all
  classifications: it keeps the proposed source vertices, removes production
  sinks, and adds sync/tap outputs. Records arrive interleaved — group by stage
  tag, not stream order. Raw records are wrapped under `.data`; tap tags live at
  `.data.tags["sink-source"][]`. Untagged `.data` records are expected, not a
  failure. Non-UI raw DAGs reject UI-level topology edits with `unsupported raw
  job graph shape`.

The patched fields you test are identical to what `job:apply` writes; only the
surrounding test topology differs on raw graphs. Parse the actual record shape
before trusting any metric table — the tag location differs by backend. The
draft cannot validate external sink delivery (no vendor readback); see step 2.

## Workflow

### 1. Generate the plan

```bash
grepr job:plan --job-id <JOB_ID> --patch patch-<tag>.json -o plan-<tag>.json
```

Fetches the unresolved live job, applies the patch, and writes a plan recording
`backend`, `baseVersion` (drift detection), `classification`, and
`patch`/`current`/`proposed`/`diff[]`. No production write happens here. If the
patch is malformed (wrong/missing op fields, a topology op against a non-UI raw
graph, a proposal leaving zero sources), `job:plan` fails before writing —
report the op-specific error verbatim to the caller and stop. See the
troubleshooting table in reference.md for specific failure messages.

### 2. Surface the sink/mixed limitation

```bash
jq -r '.classification' plan-<tag>.json
```

For `sink` or `mixed`, the draft cannot verify external delivery — there is no
readback from the destination vendor. Continue only as graph/upstream
verification and tell the user so explicitly:

> "This patch touches sink/data-lake output config (`<classification>`). The
> draft can verify graph/upstream behavior but cannot verify external delivery
> to the destination vendor."

For `transform` and `source`, continue normally.

### 3. Scan the diff for dangerous removals

The plan has no `warnings` field — inspect `diff[]` yourself.

```bash
jq -r '.diff[] | select(.kind=="remove") | .summary' plan-<tag>.json
```

Treat removal of a critical field as blocking until the user confirms — in
particular `maxLateEventTimestampDelta` disappearing from the pre-warehouse
filter (set-filter/clear-filter merge over the existing slot, so a query-only
edit should never drop it — if it does, the patch is wrong), or any
`- sources[...]` / `- sinks[...]` / `- edge ...` you did not intend. If a
removal is unexpected, stop and surface it before drafting.

### 4. Show the dry-run diff

```bash
grepr job:plan --job-id <JOB_ID> --patch patch-<tag>.json --dry-run
```

Prints a colored human-readable diff and writes nothing; show it to the user
before drafting. If it reports `0 change(s)`, the patch is a no-op — either the
change is already in place (surface as "already configured; no changes needed")
or it targets the wrong fields. Stop and surface this; never draft or apply a
no-op.

### 5. Run the draft

```bash
grepr job:draft plan-<tag>.json --max-duration-seconds 30 -o draft-<tag>.ndjson
```

Always use `-o` and always pass `--max-duration-seconds` to keep the draft
bounded. Never shell-redirect with `> draft.ndjson 2>&1` — that mixes status
logs into the record file and corrupts parsing; keep stderr separate from the
`-o` output. For sampling flags and per-backend tag-check commands, see
reference.md.

### 6. Classify the draft result

A clean exit does not mean the change was verified. Decide which result you
actually got and say so — see the draft-result classification table in
reference.md (validated / heartbeat-only / inconclusive / all-untagged). Treat
"the command finished" and "the change is verified" as different states. If you
only got plan/diff success without a clean draft, say the plan is structurally
valid but live behavior was not verified. For heartbeat-only output, follow the
bounded retry budget in reference.md (confirm traffic, at most one longer rerun,
then report inconclusive) — do not loop over windows.

### 7. Compare metrics

Optionally baseline against the unpatched pipeline first:

```bash
grepr job:draft --job-id <JOB_ID> --max-duration-seconds 30 -o baseline-<tag>.ndjson
```

Most patches do not need a baseline — the per-stage tagging in the patched run
usually shows the change directly, and the no-plan baseline path can return
heartbeat-only if no traffic arrives. Pick the metric and improvement signal for
the patch op type from the per-op metrics table in reference.md. Always
sanity-check beyond the headline number: sample 5–10 records and read them by
eye, because a metric that improved while the output looks worse means the patch
is wrong. Present the comparison as a small table.

### 8. Gate on explicit approval

Do not write to production without an explicit "yes" from the user **this
turn** — approval from a previous interaction does not carry; re-confirm every
time. Present the patch (one line per op), the dry-run diff from step 4, the
metric comparison from step 7, and the impact statement:

> "Pipeline will redeploy. New logs after the redeploy lands are affected.
> Existing logs in the warehouse are not touched."

### 9. Apply

```bash
grepr job:apply plan-<tag>.json
```

`job:apply` refuses if the live job moved past `baseVersion` (drift) unless
`--force`, and retries transient 408/429/5xx with backoff (a 409 distinguishes
real drift, which is fatal, from a deploy still in flight). On drift, regenerate
the plan from step 1 against the new version and re-run — do not `--force`
automatically. Before a second apply (e.g. apply then revert), poll until the
job is back to `RUNNING`, since a follow-up apply while still `UPDATING` can
409:

```bash
grepr job:get <JOB_ID> -f raw | jq -r '.state'   # wait for RUNNING
```

### 10. Verify post-apply (when claiming live behavior)

Apply succeeding is not the same as the pipeline behaving as intended. Before
claiming post-change behavior: fetch the new version
(`grepr job:get <JOB_ID> -f raw | jq '{version, updatedAt}'`), confirm the
patched fields are present in `proposed`, and query only windows **after**
`updatedAt` (a straddling query is stale; restart logs are not proof of resumed
traffic). State precisely what you verified — *plan structurally valid* /
*draft produced expected records* / *apply succeeded* / *post-apply behavior
confirmed* are four different claims. Never say "fully validated" when only the
plan and diff succeeded.

## Resources

- `reference.md` — draft-result classification, per-op metrics, job-graph draft
  flags + tag-check commands, troubleshooting table, parsing-hygiene rules,
  retry-budget detail, and file-naming conventions.
- `examples.md` — end-to-end runs on a template-backed job and a raw job-graph
  job, plus a ❌ anti-pattern run.
- `grepr:cli` — org config resolution (`--conf`).
- `grepr:describe-pipeline` — backend detection and per-backend op capability.
- `grepr:operations-reference` — full op catalog and exact field names.
