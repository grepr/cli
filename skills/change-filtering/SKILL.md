---
description: Set, modify, or clear pipeline filters on a Grepr pipeline to drop unwanted logs (debug, health checks, vendor heartbeats) at a chosen phase — pre-parser, pre-exceptions, or pre-warehouse. Estimates drop volume first and routes through test-pipeline-change. Use for "add a filter", "drop these logs", "filter is too aggressive", or "stop filtering".
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:plan), Bash(grepr --conf * job:draft), Read, Write, grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query-logs
---

# Change Pipeline Filtering

Filters drop unwanted logs at one of three phase slots. A `logs-filter` is
**keep-style**: it keeps logs matching its predicate, so phrase the predicate as
"what to keep" and wrap the drop condition in `NOT (...)`. This skill diagnoses
and proposes; production writes happen only through the test harness.

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## Step 1 — Get context

Run `grepr:describe-pipeline <JOB_ID>` and note which of the three phase slots
already holds a filter, its predicate, and the raw dataset ID (needed for
drop-volume estimation). For backend detection and which ops each backend
supports, see `grepr:describe-pipeline`.

## Step 2 — Pick the phase

Filters are phase-slotted, not arbitrary vertices: each phase holds at most one
filter, and topology decides what gets dropped downstream. There are three phase
slots. The phase names describe *where the filter sits*, not what it "protects" —
verify the actual downstream effect against `describe-pipeline` before telling
the user where logs land.

| Phase | Position | Attributes available |
|-------|----------|----------------------|
| `pre-parser` | Before any parser. Cheapest drop point (JSON parse skipped on dropped logs). | Raw log fields only — parser/grok captures NOT yet present. |
| `pre-exceptions` | On the path of logs bypassing the reducer (matched `logReducerExceptions`). Narrows the bypass. | Post-parser attributes. |
| `pre-warehouse` | After the parser/remapper chain, before downstream branches. Often upstream of *both* warehouse sink and reducer. | Post-parser attributes. |

There is no `pre-aggregation` slot in the transforms model — filter immediately
before the reducer via `pre-warehouse` (usually upstream of the reducer) or
narrow the reducer bypass with `pre-exceptions`.

Pick by what the predicate references:

| Predicate references | Phase |
|----------------------|-------|
| Only raw log fields (a top-level tag, raw `message`) | `pre-parser` — cheapest drop |
| A grok-extracted or parsed attribute (`@route`, `@http_status_code`) | Any post-parser phase. `pre-parser` won't have it yet → silent no-op. |
| "Drop noise everywhere" composable from raw fields | `pre-parser`, else `pre-warehouse` |

`set-filter`/`clear-filter` accept `pre-parser`, `pre-warehouse`, and
`pre-exceptions` on both template-backed and canonical UI-shaped raw graphs.
Non-UI raw DAGs reject these edits with `unsupported raw job graph shape`.

## Step 2a — Predicate syntax: tags vs attributes (high-failure)

Predicates use Datadog-style query syntax (same as `grepr query`). The
distinction that silently breaks filters:

| Syntax | Matches |
|--------|---------|
| `field:value` | A **tag** named `field` (top-level; vendor-set or remapper-set) |
| `@field:value` | An **attribute** named `field` (deep field, including grok captures) |

Common tags: `source`, `service`, `host`, `env` (reserved attributes land back
as tags via the remapper, so `service:checkout` works). Common attributes:
grok captures (`@route`, `@http_status_code`, `@duration_ms`) and structured
body fields (`@body.message`, `@msg.operationName`).

Get this wrong and the predicate evaluates false on every log. Because the
filter is keep-style with a `NOT (...)` wrapper, "matches nothing to keep"
inverts to **every log kept** — a silent no-op. The patch ships, looks applied,
and drops nothing. This is the most common filtering failure, so sanity-check
each field against draft records: a `@x` predicate needs `x` under `attributes`;
a bare `x` predicate needs `x` under `tags`.

## Step 3 — Estimate drop volume

Sample both sides over the same window and limit, then report the split:

```bash
# What would be DROPPED (the drop condition itself)
grepr query --dataset-id <RAW_DS> --query "<drop condition>" \
  --start <T0> --end <T1> --limit 1000 -q -f raw -o dropped-<tag>.ndjson

# What would be KEPT (its negation — what the filter predicate keeps)
grepr query --dataset-id <RAW_DS> --query "NOT (<drop condition>)" \
  --start <T0> --end <T1> --limit 1000 -q -f raw -o kept-<tag>.ndjson
```

`grepr query` has no exact-count mode here — report a sample estimate. Treat a
filter dropping >50% of the sample as a deliberate decision and confirm with the
user. See `grepr:query-logs` for query mechanics.

## Step 4 — Build the patch

`set-filter` **merges** into the slot: fields you supply win, fields you omit
(e.g. `maxLateEventTimestampDelta`, `inverted`) carry over from the existing
filter. The same op installs the first filter or replaces one already there. The
`filter` shape is `{"predicate":{"type":"datadog-query","query":"..."}}`.
Internally the phase slot is a transform chain node — a keep-style filter
compiles to a condition node (match → keep, else → drop; arms swap when
`inverted`). Use `clear-filter` to remove a phase's filter, reverting that phase
to pass-through (no filtering).

See examples.md for copy-paste patches: a ✅ template-backed `set-filter`, a ✅
raw-graph `set-filter`/`clear-filter`, and the ❌ tag-vs-`@attribute` no-op.

For modifying only the predicate of an existing template filter without
restating the slot, `set-input-field` (`path` like `transforms.preParser.predicate`)
works — but it is TEMPLATE-ONLY and rejected on raw graphs; use `set-filter` there. For
the full op catalog and exact field names, see `grepr:operations-reference`.

## Step 5 — Hand off to test-pipeline-change

Write the patch to a file and hand it off: "Hand the patch file to
`grepr:test-pipeline-change`, which plans, drafts, gates on approval, and
applies." Verify in the draft output:

| What | Good sign |
|------|-----------|
| Output volume after the filter stage | Roughly matches the step-3 "kept" sample (estimate, not exact). |
| Records the filter targets | Zero in the patched draft, non-zero in baseline. Both non-zero → silent no-op, likely a tag-vs-attribute mix-up (Step 2a). |
| Sampled output | No unwanted shape passes; all wanted shape still passes. |
| Reduction % (if filter is upstream of the reducer) | Sharp increase → the dropped pattern was hurting reduction (good). Sharp drop → you removed something the reducer aggregated well. Unchanged → neutral. |

When reporting to the user, state the *actual* downstream effect for this
pipeline's topology (e.g. "here pre-warehouse is upstream of the reducer too, so
this drops from both the warehouse sink and the reducer/exception paths") rather
than reciting the generic phase description.

## Resources

- `examples.md` — ✅ template `set-filter`, ✅ raw-graph `set-filter`/`clear-filter`, ❌ tag-vs-`@attribute` no-op and unsupported raw-graph shape.
- `grepr:describe-pipeline` — backend detection and per-backend op support.
- `grepr:test-pipeline-change` — plan → draft → approval → apply.
- `grepr:operations-reference` — full op catalog and exact field names.
- `grepr:cli` — org config (`--conf`) resolution.
- `grepr:query-logs` — query syntax and mechanics for drop-volume sampling.
