---
description: Add or narrow reducer exceptions on a Grepr pipeline when errors/alerts/important traces are wrongly aggregated or a too-broad exception craters reduction — diagnoses volume, builds the patch, routes through test-pipeline-change.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr --conf * query), Bash(grepr --conf * job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query
---

# Change Reducer Exceptions

Reducer exceptions let specific log shapes bypass aggregation (errors, alerts,
important trace IDs) so they reach the warehouse un-reduced. Tuning them is a
balance: too narrow and important logs get deduped into summaries; too broad and
most traffic skips the reducer, so reduction craters.

This is a transform-only change. Resolve the org config once and reuse it on
every command — see the `grepr:cli` skill.

## Step 1: Get context

Run `grepr:describe-pipeline <job-id>` and note the reducer vertex name (usually
`log_reducer`), its current exception predicates, any vendor-imported exception
sets (`autoSync: true`), and the raw dataset id.

## Step 2: Diagnose direction

| Symptom | Direction | Fix |
|---|---|---|
| Reduction % is low; too much traffic bypasses the reducer | Too broad | Narrow an existing predicate |
| Errors/alerts/specific traces are being deduped into summaries | Missing | Add a new exception |
| Vendor-imported set is wrong for this traffic mix | Wrong set | Narrow/remove that entry |

### Estimate predicate volume first

Every exception is a Datadog-query predicate
`{"type":"datadog-query","query":"…"}`. Before adding or narrowing, sample how
much traffic it matches in the raw dataset:

```bash
grepr query --dataset-id <raw-ds> --query "<predicate query>" \
  --start <t0> --end <t1> --limit 1000 -q -f raw -o sample-<tag>.ndjson
```

`grepr query` has no exact count mode here. Compare a bounded sample of total
traffic against the predicate-matched sample from the same window and report an
estimate. Guidance:
- An exception matching >20% of the sample is almost certainly too broad —
  reduction will suffer.
- When adding, if the predicate matches >5% of traffic, expect a measurable
  reduction drop; confirm that is intended.

Datadog query syntax: `tag:value`, `@attribute:value`, bare `word` (message
text), `AND`/`OR`/`NOT`, `-tag:value` (exclude), `*` wildcard. A common miss is
using a bare tag where the field is actually a message attribute (`@status`) or
vice versa — the predicate then matches nothing or everything.

## Step 3: Build the patch

The op is `add-reducer-exception`; its only field is `predicate`. There is no
`name` field. It is append-only.

```json
{ "operations": [
  { "op": "add-reducer-exception",
    "predicate": { "type": "datadog-query", "query": "service:checkout AND status:error" } }
] }
```

### Add

Use `add-reducer-exception` to let a missing log class bypass aggregation. It
does not disturb existing entries.

### Narrow an over-broad exception

Narrowing means rewriting the offending entry to match less traffic. Use
`set-input-field` on the `exceptions` array. Start from the current
`templateInputs.input.exceptions` array in the unresolved job that
`describe-pipeline` saves in its template check. Replace just the bad entry, and
pass the full array back.

See `examples.md` for an add patch and a bad-predicate patch.

For the full op catalog and exact field names, see `grepr:operations-reference`.

## Step 4: Validate and apply

Hand the patch file to `grepr:test-pipeline-change`, which plans, drafts, gates
on approval, and applies. Check the draft output:

| What | Good sign |
|---|---|
| Total log count through reducer | Roughly unchanged |
| Reduction % | Higher after narrowing; only mildly lower after adding |
| Exception-tagged output count | Matches the predicate's step-2 hit rate |
| Sample inspection | Logs that should bypass do; logs that shouldn't, don't |

If reduction tanks after the patch, the predicate is still too broad — re-run the
step-2 estimate and tighten.

## Failure modes

- **Adding an exception kills reduction**: the predicate matches far more than
  expected. Re-run the step-2 sample estimate and add an `AND` to scope it.
- **Narrowing didn't help**: the broad exception isn't the main reduction
  problem (empty messages or over-aggregation may be) — route to
  `grepr:tune-reduction` for full diagnosis.

## Resources

- `examples.md` has ✅ add and ❌ over-broad predicate examples, each with a why.
- `grepr:cli` — org config resolution.
- `grepr:describe-pipeline` has the pipeline summary and the template check.
- `grepr:operations-reference` — full op catalog and field schemas.
- `grepr:test-pipeline-change` — plan/draft/gate/apply harness.
- `grepr:tune-reduction` — when exceptions aren't the real reduction problem.
