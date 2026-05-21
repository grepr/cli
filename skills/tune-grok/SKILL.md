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
  --start <T0> --end <T1> --limit 50 -f raw > grok-samples.json
```

Look at the `message` field of the returned logs. The pattern you need to
extract should be visible by eye.

## Step 3: Author the Grok Pattern

Use `grepr:build-grok` (existing skill) to iterate on the pattern against
the samples. Don't skip this — patterns that look right by eye often miss
edge cases. The build-grok skill returns a vetted pattern.

Recommended pattern shape:
- Each rule is `<RuleName> <pattern>` (a name token, then the pattern).
  Names are used in diagnostics — pick something descriptive like
  `HttpAccessLog` or `K8sEventLog`.
- Use named captures (`%{NUMBER:duration_ms}`), not anonymous.
- Pin to the start of the message (`^`) if the format is consistent.
- Don't over-extract — only fields the customer actually queries on.

Schema fields the backend reads (write to these exact field names):
- `grokParsingRules: string[]` — your rule strings.
- `grokHelperRules: string[]` — reusable helper definitions (optional).
- `extractAttribute: string` — source attribute the parser reads from
  (optional, per-parser).

## Step 4: Check for Attribute-Name Collisions

Before testing, sweep your proposed capture names against fields the
pipeline's remapper and reducer already claim. A capture that collides
with a reserved attribute produces a **mixed-type array at runtime**
(e.g. `status: ["info", 404]`) — silent data corruption that won't show
up unless someone inspects the actual values, not just the match rate.

Collect the names you need to check against. From the resolved remapper
(visible in `describe-pipeline` or `job:get --resolved`), pull every
entry in:

- `messageReservedAttributes` (and the leaf names in `…Paths`)
- `serviceReservedAttributes` / `Paths`
- `hostReservedAttributes` / `Paths`
- `statusReservedAttributes` / `Paths`
- `timestampReservedAttributes` / `Paths`
- `traceIdReservedAttributes` / `Paths`

And from the resolved reducer:

- `partitionByAttributes`
- The leaf names in `partitionByAttributePaths`

For each grok capture name in your pattern, check whether it collides
with any of the above. The frequent offenders are `service`, `host`,
`status`, `timestamp`, `level`, `severity`, `trace_id`.

If you find a collision, **rename the grok capture before going further**.
Common rename pattern: prefix with the domain (`http_status_code` instead
of `status`, `client_ip_addr` instead of `host`).

### Telling the user about a rename

When you rename a user-requested field name, **say so before the test
step**, not in the final approval summary. One line is enough:

> "I'm renaming `status` → `http_status_code` because the remapper's
> `statusReservedAttributes` already claims `status`. The collision
> would produce a mixed-type array on every log. Reply if you'd prefer
> a different name; otherwise I'll proceed."

If the user doesn't object, continue with the renamed capture. If they
do, use their suggestion.

## Step 5: Build the Patch

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

Save to `patch.json`.

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
        "predicate": { "type": "datadog-query", "query": "source:my_service" },
        "grokParsingRules": ["MyHttpAccessRule %{IPORHOST:client_ip} - %{USER:user} \\[%{HTTPDATE:ts}\\] \"%{WORD:method} %{NOTSPACE:path}\""]
      }
    }
  ]
}
```

### Prefer scoping the parser with a predicate

When the pattern only makes sense for one log shape (e.g. a specific
source, service, or `type`), include a `predicate` on the grok parser
that restricts which logs it tries to match. Without a predicate, the
parser runs on every log in the pipeline — non-matches are cheap but
not free, and a loose pattern can over-match shapes it shouldn't.

The predicate uses the same query-string vocabulary as the rest of the
pipeline (e.g. `source:pipeline-seed-log-generator`, `service:checkout`,
`@source.type:http_access`). Pick the narrowest selector that captures
the log shape the pattern is for.

Skip the predicate only when the grok parser is meant to be
pipeline-wide (e.g. a catch-all that runs on everything).

## Step 6: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `patch.json`.
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
| `attributes.<your-fields>` present | On most matching logs, not just one |
| `attributes.<your-fields>` values | Look like the right type (integer / string), not the raw pattern |
| **No mixed-type arrays** | `"status": ["info", 404]` means a collision the pre-check missed — abort, rename, retest |
| Non-matching logs unchanged | The grok parser didn't break logs it shouldn't have touched |
| Reduction % | Unchanged or slightly better (more attributes = better grouping potential) |

The mixed-type-array check is the one Step 4 is supposed to make redundant
— but it's the failure mode that's silently destructive, so verify
explicitly even if you ran the pre-check. Grep the patched draft output
for `"<your-capture-name>": [` for each captured field; any match means a
collision slipped through.

## Common Failure Modes

- **Pattern matches nothing**: usually a regex escape issue. `\[` not `[`,
  `\(` not `(`. Re-run `grepr:build-grok` against the samples to verify.
- **Pattern matches everything (greedy)**: usually `%{DATA:foo}` consuming
  too much. Use `%{NOTSPACE:foo}` or `%{WORD:foo}` instead.
- **`add-grok-rule` fails with "no grok-parser found in input.parsers"**:
  you're in Case B — use `add-parser` to introduce the grok parser first.
- **Field collides with a remapper-reserved attribute**: capture comes
  back as a mixed-type array (e.g. `"status": ["info", 404]`). Caught by
  the Step 4 pre-check; if it slipped through, rename the grok capture
  (`status` → `http_status_code`) and re-test.
- **Pattern matches more logs than intended**: a grok parser without a
  `predicate` runs on every log in the pipeline. If your pattern is
  loose enough to false-positive on other log shapes, add a `predicate`
  scoped to the source/service/type the pattern is actually for.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
