# Change-exceptions examples

Sanitized patches for adding reducer exceptions. Every patch root
is `{ "operations": [ … ] }`. The only field on `add-reducer-exception` is
`predicate`; there is no `name`.

## ✅ Add an exception

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
