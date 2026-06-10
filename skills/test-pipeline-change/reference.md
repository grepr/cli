# Reference — pipeline-change safety harness

Deep reference for the harness in SKILL.md. Each table is the canonical version;
intent skills link here rather than restate it.

## Contents

- [Draft-result classification](#draft-result-classification)
- [Per-op metrics](#per-op-metrics)
- [Job-graph draft flags](#job-graph-draft-flags)
- [Per-backend tag-check commands](#per-backend-tag-check-commands)
- [Parsing hygiene](#parsing-hygiene)
- [Retry budget for heartbeat-only drafts](#retry-budget-for-heartbeat-only-drafts)
- [When things go sideways](#when-things-go-sideways)
- [Files used / generated](#files-used--generated)

## Draft-result classification

The draft's exit status alone does not mean the change was verified. Decide
which result you actually got (SKILL.md step 6) and say so explicitly.

| Result | Meaning |
|--------|---------|
| Expected records, tagged per stage | **Validated** for the stages you can see. Proceed to compare metrics. |
| Only `HEARTBEAT` records, then `CANCELLED` | **Heartbeat-only / no data observed** — the draft ran but exercised nothing. Inconclusive, not a pass. Usually means little traffic arrived in the window; follow the retry budget below. |
| Timeout, non-zero exit, or no parseable records | **Inconclusive.** Show the error; do not present as validated. |
| Records present but all `unknown`/untagged | **Inconclusive** for per-stage claims. A partial untagged population is expected on source-preserving raw drafts, but all-untagged output cannot prove a specific stage behaved correctly. |

Treat "the command finished" and "the change is verified" as different states.
If you only got plan/diff success without a clean draft, the plan is
structurally valid but live behavior is unverified.

## Per-op metrics

Pick the metric for the patch op type and filter the right stage/tap tag —
template-backed: server-supplied `draftOutputs`; raw graph:
`.data.tags["sink-source"][]`.

| Patch op | Metric (after the named stage) | Improvement signal |
|----------|--------------------------------|--------------------|
| `add-message-attribute` | Empty `message` %, after the remapper | Drops substantially (e.g. 44% → 8%) |
| `add-group-by` | Distinct group cardinality, after the reducer | Splits into multiple buckets |
| `add-aggregation-strategy` | Output cardinality + numeric range, after reducer | Aggregations populated; reduction stable |
| `add-reducer-exception` | Exception-tagged volume + reduction % | Exception count up; reduction does not crater |
| `set-filter` / `clear-filter` | Records dropped at the filter stage | Matches the predicate's hit rate |
| `add-grok-rule` | Target attribute presence after the parser | Attribute populated on matching logs |
| `add-source` | Records flowing from the new source | Non-zero volume, expected tags, no source errors |
| `remove-source` | Records from the removed source = 0 | Cleanly stopped |

Always sanity-check beyond the headline metric: sample 5–10 records and inspect
by eye. A metric that improved while the output looks worse means the patch is
wrong.

## Job-graph draft flags

| Flag | Effect |
|------|--------|
| `--sample-rate <n>` | Max sampled records/sec per source. Default: `10`. |
| `--sample-burst <n>` | Max sampled burst per source. Default: `1000`. |
| `--max-duration-seconds <n>` | Wall-clock cap before the CLI aborts the sync stream cleanly. Default: `30`. |

Always pass `--max-duration-seconds` explicitly to keep drafts bounded; tune
`--sample-rate` / `--sample-burst` to control how much live traffic is sampled.

## Per-backend tag-check commands

Raw job-graph: records are wrapped under `.data`, tap tags nested at
`.data.tags["sink-source"][]`.

```bash
jq -r 'select(.data?) | (.data.tags["sink-source"] // ["untagged"])[]' draft-<tag>.ndjson | sort | uniq -c
jq -c 'select(.data?) | .data' draft-<tag>.ndjson | head
```

Template-backed: inspect the server-supplied `draftOutputs` shape before
choosing a grouping expression.

## Parsing hygiene

- Use `-o <file>` for `job:draft`; never parse stdout from a draft command.
- Do not append `2>&1` to commands whose JSON/NDJSON output will be parsed — it
  mixes status/error text with records and corrupts the file.
- For `grepr query` samples that will be parsed, use `-q -f raw -o
  sample-<tag>.ndjson` where available. Prefer `jq` over long inline Python; if
  Python is needed, read from the saved file, not mixed command output.
- Query and draft commands can be slow. Run one bounded sample, inspect the
  saved artifact, and reuse it for analysis.

## Retry budget for heartbeat-only drafts

Heartbeat-only output means the draft did not exercise data. Do not loop over
many windows or query variants.

1. Confirm data is actually flowing against the raw dataset for a recent window:
   `grepr query -q -f raw -o raw-check-<tag>.ndjson --start <iso> --end <iso> --limit <n>`.
2. Run **at most one** retry with a longer window: rerun the draft with
   `--max-duration-seconds 90` to catch a live push.
3. If the retry is still heartbeat-only, stop and report the draft as
   inconclusive. Do not apply, and do not present the plan as behaviorally
   validated.

## When things go sideways

| Situation | Action |
|-----------|--------|
| `job:plan` fails: `unsupported raw job graph shape` | The op is a UI-level topology change (`set-filter`, `add-source`, `add-parser`, etc.) but the direct job graph is not the canonical UI log-pipeline shape. Surface the limitation and stop; do not fall back to manual `job:update` unless the user explicitly starts a separate manual-update workflow. |
| `job:plan` fails: `generic template-input paths are not supported on raw job graphs` | `set-input-field` / `unset-input-field` paths only apply to template inputs. Use a semantic op or edit the raw graph manually. |
| `job:plan` fails with a field/value error **or** a JS crash (`Cannot read properties of undefined`) | The op payload has a wrong or missing field name; the CLI does not always surface a helpful message. Load `grepr:operations-reference` for exact field names, fix the patch, regenerate. |
| `job:plan` fails on a domain op (e.g. `add-message-attribute` with no remapper) | Pipeline shape does not match the op's assumptions. Adjust the patch or use a different op. |
| `job:plan` fails with a zero-source error | The proposal would leave the pipeline with no sources. Every pipeline must keep at least one — fix the patch. |
| `job:plan --dry-run` shows `0 change(s)` | No-op (already configured, or wrong fields). Stop and surface; do not draft or apply. |
| `job:draft` returns errors | Draft submission failed — likely a malformed template input. Show the error verbatim. |
| Draft output empty or HEARTBEAT-only | No traffic reached the tapped graph, or the no-plan `--job-id` baseline did not exercise data. Inconclusive, not a pass — follow the retry budget. |
| Test metrics flat / no improvement | Show the user. Do not apply. Iterate on the patch. |
| `job:apply` returns drift | Someone else edited the pipeline. Re-run from step 1; do not `--force`. |
| `job:apply` repeated 409s | Deploy is in flight or stuck. Poll for `RUNNING`; if it never recovers, surface to the user and check pipeline status manually. |

## Files used / generated

Filenames are conventions for this skill, not a directory mandate — write them
wherever fits the user's working directory, and don't clobber an existing file
with the same name (suffix or change the tag as needed). Use a unique
`<tag>` per request/op so unrelated edits never overwrite each other.

- `patch-<tag>.json` — input from the calling intent skill
- `plan-<tag>.json` — generated by step 1, consumed by step 9 (apply)
- `draft-<tag>.ndjson` — streamed draft results from step 5
- `baseline-<tag>.ndjson` (optional) — unpatched baseline for step 7
