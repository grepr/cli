# Change-exceptions examples

Sanitized patches for adding and narrowing reducer exceptions. Every patch root
is `{ "operations": [ … ] }`. The only field on `add-reducer-exception` is
`predicate`; there is no `name`.

## ✅ Add an exception (works on both backends)

Errors from `checkout-service` are getting deduped into summaries. Let them
bypass the reducer.

```json
{ "operations": [
  { "op": "add-reducer-exception",
    "predicate": { "type": "datadog-query", "query": "service:checkout-service AND status:error" } }
] }
```

Why this works: `add-reducer-exception` is append-only and predicate-only, so it
adds one scoped bypass without touching existing exceptions. Scoping to a single
service keeps the matched volume small, so reduction barely moves.

## ✅ Add on a raw job graph (add-only)

Same op, same shape, on a canonical raw job graph (direct vertices + string
edges, with a `log_reducer` vertex). Raw graphs support adding exceptions but
nothing more.

```json
{ "operations": [
  { "op": "add-reducer-exception",
    "predicate": { "type": "datadog-query", "query": "@alert_active:true" } }
] }
```

Why this works: on a raw graph the harness appends the predicate to the reducer's
`logReducerExceptions`. `@alert_active` targets a message attribute (the `@`
prefix), not a tag, so it matches only logs that actually carry that attribute.

## ✅ Narrow an over-broad exception (template-backed ONLY)

A pipeline has a too-broad `status:error` exception. Tighten it by rewriting the
full `exceptions` array with `set-input-field`. Start from
`describe-pipeline`'s current array and replace just the offending entry.

```json
{ "operations": [
  { "op": "set-input-field",
    "path": "exceptions",
    "value": [
      { "type": "query-exception", "predicate": { "type": "datadog-query", "query": "status:error AND service:checkout-service" } },
      { "type": "query-exception", "predicate": { "type": "datadog-query", "query": "@alert_active:true" } }
    ] }
] }
```

Why this works: `set-input-field` edits template inputs, so it can replace an
existing entry — the only way to narrow. It is TEMPLATE-ONLY and is rejected at
plan time on raw job graphs (they have no template inputs). Raw graphs are
add-only; if a raw-graph exception is too broad, surface that limitation instead
of patching.

## ❌ Over-broad predicate that craters reduction

```json
{ "operations": [
  { "op": "add-reducer-exception",
    "predicate": { "type": "datadog-query", "query": "service:webapp" } }
] }
```

Why this fails: `service:webapp` (or a bare `*`) lets an entire service — most of
the traffic — bypass the reducer. Reduction collapses because almost nothing
reaches aggregation. Always run the step-2 volume estimate first and scope the
predicate (add `AND status:error` or similar) so it matches a small slice.
