---
description: Add, narrow, or remove reducer exceptions on a Grepr pipeline. Exceptions let specific log shapes bypass aggregation (e.g. errors, alerts, important traces). This skill helps tune which logs get the bypass without crippling reduction. Routes through test-pipeline-change.
allowed-tools: Bash(grepr query), Bash(grepr job:edit), Bash(grepr job:plan), Bash(grepr job:apply), Bash(grepr job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query-logs
trigger_keywords:
  - change exceptions
  - add reducer exception
  - narrow reducer exception
  - bypass reduction for
  - exception too broad
  - exception missing
  - logs being aggregated that shouldn't be
---

# Change Reducer Exceptions

Use when:
- An exception is too broad and lets too much traffic skip aggregation
  (reduction tanks).
- An exception is missing and important logs (errors, alerts, specific
  trace IDs) are being aggregated when they shouldn't be.
- A vendor-imported exception set is wrong for the customer's traffic mix.

Transform-only change — routes through `grepr:test-pipeline-change`.

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` and note:
- The reducer vertex name (usually `log_reducer`).
- The current `logReducerExceptions` predicates.
- Any `integrationExceptionConfigs` (vendor-imported sets, often with
  `autoSync: true`).
- The raw dataset ID.

## Step 2: Diagnose Which Direction to Move

### Direction A — Exception too broad

Symptom: reduction % is low because too many logs are bypassing the reducer.

For each exception predicate, count matching volume in the raw dataset:

```bash
grepr query --dataset-id <RAW_DS> --query "<predicate.query>" \
  --start <T0> --end <T1> --limit 0 -f raw
```

A single exception matching >20% of traffic is almost certainly too broad.

Common offenders and the narrowing pattern:
- `status:error` (matches everything labeled "error" even when severity is
  actually INFO) → narrow to `status:error AND service:<critical-service>`
- `severity:>=WARNING` (often half of all logs) → narrow to specific
  alerting services
- `*:* AND vendor:datadog` (broad capture) → narrow to a real intent

### Direction B — Exception missing

Symptom: a class of logs is being aggregated and shouldn't be. The user
will say "errors are getting deduped" or "alert-relevant logs are
disappearing into summaries."

Identify the predicate that captures the missing class. Examples:
- Specific service errors: `service:checkout AND status:error`
- Alerts by tag: `alert_active:true`
- Sampling rule outputs: `_sample_reason:*`

Sanity-check the predicate's volume before adding — if it matches >5% of
traffic you'll hurt reduction.

## Step 3: Build the Patch

Exceptions live in `templateInputs.input.exceptions[]` as
`TemplateException` entries. For predicate-driven exceptions (the most
common case), the type is `query-exception` with a `predicate` field. The
template translates these into reducer exceptions at expansion time.

### To narrow an existing predicate

Use `set-input-field` to rewrite the full `exceptions` array. Start from
`describe-pipeline`'s output and replace just the offending entry:

```json
{
  "operations": [
    {
      "op": "set-input-field",
      "path": "exceptions",
      "value": [
        { "type": "query-exception", "predicate": { "type": "datadog-query", "query": "status:error AND service:checkout" } },
        { "type": "query-exception", "predicate": { "type": "datadog-query", "query": "severity:critical" } }
      ]
    }
  ]
}
```

### To add a new exception

Use `add-reducer-exception` — idempotent, doesn't disturb existing entries:

```json
{
  "operations": [
    {
      "op": "add-reducer-exception",
      "name": "checkout-errors",
      "predicate": { "type": "datadog-query", "query": "service:checkout AND status:error" }
    }
  ]
}
```

The skill builds the `TemplateQueryException` wrapper automatically — you
only pass the predicate.

### To remove all exceptions and start fresh

```json
{
  "operations": [
    { "op": "unset-input-field", "path": "exceptions" }
  ]
}
```

(Rarely the right move — `unset-input-field` removes the key; you may want
`set-input-field` with `value: []` instead. Confirm with the user first.)

## Step 4: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `patch.json`.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| Total log count through reducer | Roughly same |
| Reduction % | Higher (narrowing) or only mildly lower (adding) |
| Exception-tagged output count | Matches the predicate's hit rate from step 2 |
| Sample inspection | Logs that should bypass are bypassing; logs that shouldn't, aren't |

If reduction tanks after the patch, the predicate is still too broad —
iterate.

## Common Failure Modes

- **Adding an exception kills reduction**: predicate matches more traffic
  than expected. Re-run the volume count from step 2.
- **Narrowing didn't help**: the broad predicate isn't the main one
  hurting reduction; something else is (empty messages, over-aggregation).
  Route to `grepr:tune-reduction` for full diagnosis.
- **Vendor-imported exceptions still firing**: vendor-imported exceptions
  live as `integration-exception`-typed entries inside
  `input.exceptions[]` (the template translates them into reducer
  `integrationExceptionConfigs` at expansion time). To disable, identify
  the integration-exception entry in `input.exceptions` and either remove
  it from the array via `set-input-field path: exceptions` with a filtered
  array, or modify its `autoSync` / `ids` fields.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
