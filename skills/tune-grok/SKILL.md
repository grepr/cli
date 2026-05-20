---
description: Diagnose and fix grok parsing on a Grepr pipeline. Adds rules to an existing grok parser or inserts a new grok parser vertex when none exists. Routes through test-pipeline-change before any production update.
allowed-tools: Bash(grepr query), Bash(grepr grok:parse), Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), Bash(grepr pipeline:apply), Bash(grepr job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:build-grok, grepr:query-logs
trigger_keywords:
  - tune grok
  - fix grok
  - logs not parsing
  - grok not matching
  - add grok rule
  - extract attributes from logs
  - structured logging missing
---

# Tune Grok Parsing

Use when log messages aren't being parsed into structured attributes — the
classic symptom is "everything is in `message`, nothing is in
`attributes.X`." This skill identifies the unparsed log shapes, builds grok
patterns that match them, and patches the pipeline.

This is a transform-only change (modifies or adds a grok parser vertex) —
sync-replay testing is sufficient, so it routes through
`grepr:test-pipeline-change`.

## When to Use

- Specific log shape isn't getting parsed (no extracted attributes).
- A vendor-imported pattern was wrong and needs to be overridden.
- New log shape appeared in production after the pipeline was set up.

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` first. Note:
- Whether a `grok-parser` vertex already exists (and its name).
- The raw dataset ID (for sampling).
- What the existing grok rules look like.

## Step 2: Sample the Unparsed Logs

Pull a sample from the raw dataset, filtered to the shape the user says is
broken:

```bash
grepr query --dataset-id <RAW_DS> --query "<user's filter>" \
  --start <T0> --end <T1> --limit 50 -f raw > build/grok-samples.json
```

Look at the `message` field of the returned logs. The pattern you need to
extract should be visible by eye.

## Step 3: Author the Grok Pattern

Use `grepr:build-grok` (existing skill) to iterate on the pattern against
the samples. Don't skip this — patterns that look right by eye often miss
edge cases. The build-grok skill returns a vetted pattern.

Recommended pattern shape:
- Use named captures (`%{NUMBER:duration_ms}`), not anonymous.
- Pin to the start of the message (`^`) if the format is consistent.
- Don't over-extract — only fields the customer actually queries on.

## Step 4: Build the Patch

Two cases:

### Case A — Grok parser already exists

Add the rule to the named parser (or omit `parserName` to target the
first grok-parser found):

```json
{
  "operations": [
    {
      "op": "add-grok-rule",
      "parserName": "<existing-grok-parser-name>",
      "pattern": "%{IPORHOST:client_ip} - %{USER:user} \\[%{HTTPDATE:ts}\\] \"%{WORD:method} %{NOTSPACE:path}\""
    }
  ]
}
```

Save to `build/patch.json`.

### Case B — No grok parser in the pipeline

Append a new grok parser to `input.parsers`. The template owns the
topology — it threads parsers in the order `json-log-processor → remapper
→ grok parsers`, so a new grok parser automatically slots into the right
position. No manual wiring required.

```json
{
  "operations": [
    {
      "op": "add-parser",
      "parser": {
        "type": "grok-parser",
        "name": "http_access_grok",
        "patterns": ["%{IPORHOST:client_ip} - %{USER:user} \\[%{HTTPDATE:ts}\\] \"%{WORD:method} %{NOTSPACE:path}\""]
      }
    }
  ]
}
```

## Step 5: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `build/patch.json`.
That skill:
- Generates the plan (`pipeline:edit`).
- Runs the patched config against recent raw data via `job:to-test
  --core-chain`.
- Compares per-record — does the target attribute (`client_ip`, `method`,
  etc.) now appear on matching logs?
- Asks the user for explicit approval.
- Applies via `pipeline:apply`.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| `attributes.client_ip` (or your target attrs) present | On most matching logs, not just one |
| `attributes.<attr>` values | Look like the right type (not the raw pattern) |
| Non-matching logs unchanged | The grok parser didn't break logs it shouldn't have touched |
| Reduction % | Unchanged or slightly better (more attributes = better grouping potential) |

## Common Failure Modes

- **Pattern matches nothing**: usually a regex escape issue. `\[` not `[`,
  `\(` not `(`. Re-run `grepr:build-grok` against the samples to verify.
- **Pattern matches everything (greedy)**: usually `%{DATA:foo}` consuming
  too much. Use `%{NOTSPACE:foo}` or `%{WORD:foo}` instead.
- **`add-grok-rule` fails with "no grok-parser found in input.parsers"**:
  you're in Case B — use `add-parser` to introduce the grok parser first.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
