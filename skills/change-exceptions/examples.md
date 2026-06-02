# Change-exceptions examples

Sanitized patches for adding reducer exceptions. Every patch root
is `{ "operations": [ … ] }`. The only field on `add-reducer-exception` is
`predicate`; there is no `name`.

> Narrowing or removing an existing exception is deferred to ENGT-4722, which adds
> a dedicated `remove-reducer-exception` op that works on both backends. Until then
> the only path is the template-only `set-input-field` rewrite; the full example
> set (narrow/remove on both backends) lands with that ticket.

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
