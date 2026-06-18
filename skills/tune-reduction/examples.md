# Tune-reduction patch examples

Sanitized patches for the three reduction causes. Each is a copy-paste-valid
`{ "operations": [...] }` file using only whitelisted ops, fields, and strategy
values (`sum`|`min`|`max`|`avg`). Hand the file to `grepr:test-pipeline-change`.

> Narrowing an over-broad exception is deferred to ENGT-4722 (dedicated
> `remove-reducer-exception` op, both backends). Today's only path is the
> template-only `set-input-field` rewrite — see `grepr:change-exceptions`. The
> comprehensive example set lands with that ticket.

- [✅ Empty messages + over-aggregation (works on both backends)](#empty)
- [✅ Raw job-graph patch](#raw)
- [❌ Bad: multiple strategies on one path](#bad-strategies)
- [❌ Bad: over-broad exception that craters reduction](#bad-exception)

The `add-message-attribute`, `add-group-by`, and `add-aggregation-strategy` ops
behave identically on template-backed and raw job-graphs, so the same patch
applies to both — shown once below.

## ✅ Empty messages + over-aggregation {#empty}

The `acme` `webapp` source emits HTTP access logs with `message: ""`; the real
text lives under `attributes`. Add fallback message paths, split buckets that
were over-aggregating into one pattern, and summarize latency.

```json
{
  "operations": [
    { "op": "add-message-attribute", "attributePath": "http.route" },
    { "op": "add-message-attribute", "attributePath": "msg.request.query" },
    { "op": "add-group-by", "attributePath": "request.method" },
    { "op": "add-group-by", "attributePath": "request.status_code" },
    { "op": "add-aggregation-strategy", "attributePath": "request.duration_ms", "strategies": ["avg"] }
  ]
}
```

Why it works: the remapper now fills the empty `message` from the first present
fallback path, so the reducer gets a non-empty pattern to dedupe on. The two
group-bys keep `GET`/`POST` and `200`/`500` in distinct buckets instead of
collapsing into one over-aggregated pattern, and `avg` summarizes latency with
a single strategy per path.

## ✅ Raw job-graph patch {#raw}

The same semantic ops work on a canonical UI-shaped raw graph — no
`set-input-field` needed. Fix empty `checkout-service` messages and add a
group-by on the GraphQL operation name that was over-aggregating.

```json
{
  "operations": [
    { "op": "add-message-attribute", "attributePath": "msg.message" },
    { "op": "add-group-by", "attributePath": "msg.operationName" }
  ]
}
```

Why it works: `add-message-attribute` writes the remapper's
`messageReservedAttributePaths` and `add-group-by` appends to the reducer's
`partitionByAttributes` on a raw graph directly. `msg.operationName` is
medium-cardinality, so it splits the merged GraphQL pattern without crippling
the reduction ratio.

## ❌ Bad: multiple strategies on one path {#bad-strategies}

```json
{
  "operations": [
    { "op": "add-aggregation-strategy", "attributePath": "attributes.request.duration_ms", "strategies": ["min", "max", "avg"] }
  ]
}
```

Why it fails: a multi-element `strategies` array expands to three merge entries
on one path, and the backend rejects it (`Duplicate attribute paths in merge
strategies are not allowed`) at draft/apply — after you've built the plan. One
strategy per path; pick the most useful (usually `avg` for latency, `sum` for
counts/bytes).

## ❌ Bad: over-broad exception that craters reduction {#bad-exception}

```json
{
  "operations": [
    { "op": "add-reducer-exception", "predicate": { "type": "datadog-query", "query": "*" } }
  ]
}
```

Why it fails: `add-reducer-exception` takes `predicate` only (no `name` field),
and a `*` predicate matches every log, so every record bypasses the reducer and
reduction drops to zero. Exceptions are a passthrough mechanism — adding broad
ones is the opposite of tuning reduction. Prefer narrowing existing predicates.
