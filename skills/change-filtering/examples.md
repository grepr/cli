# Filtering examples

Patches are `{"operations":[...]}`. The `filter` shape is
`{"predicate":{"type":"datadog-query","query":"..."}}`. `logs-filter` keeps
matches, so phrase the predicate as "what to keep" and wrap the drop condition
in `NOT (...)`.

- [✅ Template-backed: set a pre-parser filter](#template-set-filter)
- [✅ Raw graph: set + clear a filter](#raw-set-clear-filter)
- [❌ Tag-vs-@attribute mismatch (silent no-op)](#bad-tag-attribute)
- [❌ set-filter against a non-canonical raw graph](#bad-raw-shape)

`set-filter`/`clear-filter` behave identically on template-backed and canonical
raw-graph pipelines for `pre-parser`, `pre-warehouse`, and `pre-exceptions`. The
difference: `pre-aggregation` is template-only (no raw UI stage), and only
templates accept `set-input-field`.

<a id="template-set-filter"></a>
## ✅ Template-backed: drop health checks pre-parser

```json
{
  "operations": [
    {
      "op": "set-filter",
      "phase": "pre-parser",
      "filter": {
        "predicate": {
          "type": "datadog-query",
          "query": "NOT (path:/healthz OR path:/readyz OR path:/ping)"
        }
      }
    }
  ]
}
```

Why this works: `path` is a raw tag present before parsing, so `pre-parser` is
the cheapest drop point. The keep predicate `NOT (...)` keeps everything except
the three health-check paths. On a template-backed pipeline `pre-aggregation`
would also be valid; on a raw graph it would not.

<a id="raw-set-clear-filter"></a>
## ✅ Raw graph: tighten pre-warehouse, clear pre-exceptions

```json
{
  "operations": [
    {
      "op": "set-filter",
      "phase": "pre-warehouse",
      "filter": {
        "predicate": {
          "type": "datadog-query",
          "query": "NOT (service:checkout-service AND status:debug)"
        }
      }
    },
    { "op": "clear-filter", "phase": "pre-exceptions" }
  ]
}
```

Why this works: canonical UI-shaped raw graphs accept `set-filter`/`clear-filter`
on `pre-parser`, `pre-warehouse`, and `pre-exceptions`. `set-filter` merges, so
any existing `maxLateEventTimestampDelta` on the pre-warehouse slot is preserved.
`clear-filter` blanks the pre-exceptions query but keeps the vertex. In most
templates pre-warehouse is upstream of the reducer too — verify topology with
`describe-pipeline` before telling the user where the drop lands.

<a id="bad-tag-attribute"></a>
## ❌ Tag-vs-@attribute mismatch — silent no-op

```json
{
  "operations": [
    {
      "op": "set-filter",
      "phase": "pre-parser",
      "filter": {
        "predicate": {
          "type": "datadog-query",
          "query": "NOT (@service:checkout-service)"
        }
      }
    }
  ]
}
```

Why this fails: `service` is a top-level tag, so it must be `service:...`, not
`@service:...`. The `@`-prefixed form matches an attribute named `service`,
which does not exist, so the inner clause is false on every log. Negated, the
keep predicate is true for every log → nothing is dropped. The patch applies
cleanly and the draft looks identical to baseline, masking the bug. The reverse
(`@route` written as bare `route`) fails the same way for grok-extracted
attributes. Confirm each field against draft records per Step 2a before
approving.

<a id="bad-raw-shape"></a>
## ❌ set-filter against a non-canonical raw graph

```json
{
  "operations": [
    {
      "op": "set-filter",
      "phase": "pre-aggregation",
      "filter": {
        "predicate": {
          "type": "datadog-query",
          "query": "NOT (@http_status_code:200)"
        }
      }
    }
  ]
}
```

Why this fails: `pre-aggregation` has no canonical UI raw-graph stage, and a
non-UI raw DAG has no recognizable filter slots, so the patch is rejected at plan
time with `unsupported raw job graph shape`. Use a template-backed pipeline for
`pre-aggregation`, or pick the closest real raw stage (`pre-warehouse`) after
inspecting topology with `describe-pipeline`.
