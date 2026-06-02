# Examples — pipeline-change safety harness

End-to-end runs the harness drives after an intent skill hands it a patch.
Identifiers are sanitized (`acme`, `webapp`, `int_datadog`, `ds_raw_logs`).

## Contents

- [✅ Template-backed job (add-message-attribute)](#-template-backed-job-add-message-attribute)
- [✅ Raw job-graph job (add-group-by)](#-raw-job-graph-job-add-group-by)
- [❌ Anti-patterns](#-anti-patterns)

## ✅ Template-backed job (add-message-attribute)

`tune-reduction` diagnosed mostly-empty `message` (44%) and emitted this patch
to remap a message attribute on the remapper.

`patch-msgattr.json`:

```json
{
  "operations": [
    { "op": "add-message-attribute", "attributePath": "log.message" }
  ]
}
```

Run:

```bash
grepr --conf acme job:plan --job-id job_webapp_reducer --patch patch-msgattr.json -o plan-msgattr.json
jq -r '.classification' plan-msgattr.json                     # -> transform
jq -r '.diff[] | select(.kind=="remove") | .summary' plan-msgattr.json   # -> (empty, no removals)
grepr --conf acme job:plan --job-id job_webapp_reducer --patch patch-msgattr.json --dry-run
grepr --conf acme job:draft plan-msgattr.json --max-duration-seconds 30 -o draft-msgattr.ndjson
# template-backed: records tagged by the draftOutputs stage
jq -r '.draftOutputs // "untagged"' draft-msgattr.ndjson | sort | uniq -c
```

Empty-`message` rate after the remapper stage dropped 44% → 8%, output sampled
clean. Presented the diff + metric table, got an explicit "yes", then:

```bash
grepr --conf acme job:apply plan-msgattr.json
grepr --conf acme job:get job_webapp_reducer -f raw | jq '{version, updatedAt}'
```

Why this works: `classification` is `transform` (draft fully verifies it), the
diff has no unexpected removals, the dry-run was non-empty, the metric improved
with a clean sample, and apply happened only after explicit approval.

## ✅ Raw job-graph job (add-group-by)

`tune-reduction` found a single over-aggregated bucket on a raw (non-template)
pipeline and emitted an append-only group-by.

`patch-groupby.json`:

```json
{
  "operations": [
    { "op": "add-group-by", "attributePath": "service.name" }
  ]
}
```

Run:

```bash
grepr --conf acme job:plan --job-id job_checkout_raw --patch patch-groupby.json -o plan-groupby.json
jq -r '.backend, .classification' plan-groupby.json           # -> job-graph  transform
grepr --conf acme job:plan --job-id job_checkout_raw --patch patch-groupby.json --dry-run
grepr --conf acme job:draft plan-groupby.json --max-duration-seconds 30 -o draft-groupby.ndjson
# raw graph: records wrapped under .data, tap tags under .data.tags["sink-source"][]
jq -r 'select(.data?) | (.data.tags["sink-source"] // ["untagged"])[]' draft-groupby.ndjson | sort | uniq -c
jq -c 'select(.data?) | .data' draft-groupby.ndjson | head
```

Reducer-stage records now split across multiple `service.name` buckets instead
of one. Some `.data` records came back untagged (expected on a source-preserving
raw draft); the reducer-tagged subset showed the split, so it is conclusive for
that stage. Approved, then `grepr --conf acme job:apply plan-groupby.json`.

Why this works: on raw graphs you must read through `.data` and group by the
`sink-source` tag, not stream order; untagged records are expected and not
treated as a failure; the cardinality claim rests only on the reducer-tagged
subset.

## ❌ Anti-patterns

### Shell-redirecting the draft

```bash
# WRONG
grepr --conf acme job:draft plan-msgattr.json --max-duration-seconds 30 > out.ndjson 2>&1
```

Why this fails: `2>&1` folds status logs and errors into the record file, so
`jq` chokes on non-JSON lines and the metric counts are garbage. Use
`-o draft-<tag>.ndjson` and keep stderr separate.

### Presenting a heartbeat-only draft as validated

The draft returned only `HEARTBEAT` records then `CANCELLED`, but the change was
reported as "validated, reduction improved."

Why this fails: heartbeat-only means no data was exercised — the result is
inconclusive, not a pass. Confirm traffic is flowing, retry **once** with
`--max-duration-seconds 90`, and if still heartbeat-only report inconclusive.
Never derive a metric from zero observed records.

### Applying without explicit approval

```bash
# WRONG: draft looked good, so apply immediately in the same step
grepr --conf acme job:draft plan-groupby.json --max-duration-seconds 30 -o draft-groupby.ndjson
grepr --conf acme job:apply plan-groupby.json
```

Why this fails: `job:apply` is a production write that redeploys the pipeline.
It requires an explicit "yes" from the user **this turn** — prior approval does
not carry. Present the patch, diff, metric table, and impact statement, then
wait for confirmation before applying.
