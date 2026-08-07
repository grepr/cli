---
description: Diagnose and fix broken grok parsing on a Grepr pipeline when log messages stay unparsed in `message` instead of becoming structured attributes — samples unparsed logs, authors a grok pattern, adds a rule to an existing grok parser or inserts a new grok-parser vertex, and routes through test-pipeline-change. Use for "tune grok", "fix grok", "logs not parsing", "grok not matching", "extract attributes from logs".
allowed-tools: Bash(grepr query), Bash(grepr grok:parse), Bash(grepr job:get), Bash(grepr --conf * query), Bash(grepr --conf * grok:parse), Bash(grepr --conf * job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:build-grok, grepr:query
---

# Tune Grok Parsing

Fix the classic symptom "everything is in `message`, nothing is in `attributes.X`."
Identify the unparsed log shapes, author a grok pattern that matches them, and patch
the pipeline. This is a transform-only change (adds a grok rule or a new grok-parser
vertex), so sync-replay testing is sufficient.

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## When to use

- A specific log shape isn't parsed (no extracted attributes).
- A vendor-imported pattern was wrong and needs overriding.
- A new log shape appeared in production after the pipeline was built.

## Workflow

### 1. Get context

Run `grepr:describe-pipeline <JOB_ID>` first. For backend detection (template vs raw
graph) and which ops each backend supports, see `grepr:describe-pipeline`. Note:

- Whether a `grok-parser` vertex already exists, and its name (drives Case A vs B below).
- How many grok parsers exist (drives whether `parserName` is required).
- The raw dataset ID, for sampling.
- The existing grok rules, remapper reserved attributes, and reducer group-by — needed
  for the collision pre-check in step 3.

### 2. Sample the unparsed logs

Pull a sample from the raw dataset, filtered to the shape the user says is broken:

```bash
grepr query --dataset-id <RAW_DS> --query "<user's filter>" \
  --start <T0> --end <T1> --limit 50 -f raw -o grok-samples-<tag>.ndjson
```

`--start`/`--end` need absolute ISO-8601 UTC (e.g. `2026-05-29T03:00:00Z`); relative
offsets like `now-2h` are rejected, so compute the window first (e.g. with `date -u`).
Inspect the `message` field — the pattern to extract should be visible by eye.

### 3. Author the grok pattern (defer to grepr:build-grok)

Hand the samples to `grepr:build-grok` to iterate the pattern and verify it with
`grok:parse`. That skill owns the full matcher reference and authoring rules (Datadog
camelCase matchers like `%{number:duration_ms}`, named captures, anchoring, not
over-extracting). Don't ship a pattern you haven't run through `grok:parse` — patterns
that look right by eye routinely miss edge cases.

**Collision pre-check (do this before testing).** Sweep your proposed capture names
against the attributes the pipeline's remapper and reducer already claim. A capture that
collides with a reserved attribute produces a mixed-type array at runtime (e.g.
`status: ["info", 404]`) — silent corruption that won't surface unless someone inspects
actual values, not just match rate. Check each capture name against the remapper's
`messageReservedAttributes` / `…Paths` and the `service`/`host`/`status`/`timestamp`/
`traceId` reserved sets, plus the reducer's `partitionByAttributes` /
`partitionByAttributePaths` (all visible in `describe-pipeline` or `job:get --resolved`).
Frequent offenders: `service`, `host`, `status`, `timestamp`, `level`, `severity`,
`trace_id`.

On a collision, rename the capture before going further (prefix with the domain, e.g.
`http_status_code` instead of `status`). When you rename a user-requested field name,
say so before the test step, not in the final summary — one line is enough:

> "I'm renaming `status` → `http_status_code` because the remapper already claims
> `status`; the collision would make a mixed-type array on every log. Reply if you'd
> prefer a different name; otherwise I'll proceed."

### 4. Build the patch

Write a semantic patch (`{"operations":[...]}`) to a fresh request-specific file (e.g.
`patch-<short-tag>.json`) and let `job:plan` wire it into the right backend shape. Do
not hand-build full job JSON or call `job:update`. For the full op catalog and exact
field names, see `grepr:operations-reference`.

| Pipeline state | Op | Notes |
|---|---|---|
| A grok parser already exists | `add-grok-rule` | `parserName` required only if >1 grok parser; rejected if 0 grok parsers |
| No grok parser exists | `add-parser` (a `grok-parser`) | template-backed adds it to `input.parsers`; raw graphs insert the vertex into the parser chain |

`add-grok-rule` takes `pattern` (and optional `extractAttribute`). The new-parser shape
carries its rules in `grokParsingRules` (and optional `grokHelperRules`).

Prefer scoping a new parser with a `predicate` (`{ "type":"datadog-query", "query":
"source:checkout-service" }`) when the pattern only makes sense for one log shape.
Without a predicate the parser runs on every log; a loose pattern can then mis-parse
unrelated shapes. Skip the predicate only for a deliberate pipeline-wide catch-all.

See `examples.md` for copy-paste patches (template + raw graph) and the anti-patterns.

### 5. Hand off to test-pipeline-change

Hand the patch file to `grepr:test-pipeline-change`, which plans, drafts, gates on
approval, and applies. Verify in the draft output:

| What | Good sign |
|---|---|
| `attributes.<your-fields>` present | On most matching logs, not just one |
| values look right-typed | Integer / string, not the raw pattern text |
| No mixed-type arrays | `"status": ["info", 404]` = a collision the pre-check missed — abort, rename, retest |
| Non-matching logs unchanged | The parser didn't disturb logs it shouldn't touch |
| Reduction % | Unchanged or slightly better |

Verify the mixed-type-array case explicitly even though step 3 should make it redundant:
grep the patched draft for `"<your-capture-name>": [` on each captured field; any match
means a collision slipped through.

## Common failure modes

- **Matches nothing**: usually a regex escape issue — `\[` not `[`, `\(` not `(`; inside
  `%{regex("…")}` use a single backslash (`[^\]]`). Multiple spaces need `%{space}`, not a
  literal space. Re-run `grepr:build-grok` against the samples.
- **Matches everything (greedy)**: `%{data:foo}` consuming too much; use `%{notSpace:foo}`
  or `%{word:foo}`.
- **`add-grok-rule` rejected, "no grok-parser found"**: zero grok parsers — you're in the
  no-parser case; use `add-parser` to introduce one first.
- **Capture comes back a mixed-type array**: collides with a remapper-reserved attribute;
  rename the capture and retest.
- **Parses more logs than intended**: a parser with no `predicate` runs pipeline-wide;
  scope it to the source/service/type the pattern is for.

## Hand-off boundary

This skill diagnoses and proposes. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.

## Resources

- `examples.md` — ✅ template-backed and ✅ raw job-graph patches (`add-grok-rule`,
  `add-parser`) plus ❌ anti-patterns, each with a short "why".
- Pattern authoring + matcher reference: `grepr:build-grok`.
- Backend detection and per-backend op support: `grepr:describe-pipeline`.
- Org config (`--conf`) handling: `grepr:cli`.
- Full op catalog and field names: `grepr:operations-reference`.
- Plan / draft / approval-gated apply: `grepr:test-pipeline-change`.
