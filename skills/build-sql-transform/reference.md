# SQL transform reference

Canonical detail for authoring `set-sql-transform` patches — the Grepr-specific
behavior the Flink docs gloss over. For the standard function catalog and dialect
syntax (which you already know, or can look up), use the live docs:
`grepr docs:get doc://transforms/sql-transform/sql-functions/page.mdx` and the
`data-types` / `sql-transform-examples` pages.

## The patch op: `set-sql-transform`

```json
{
  "op": "set-sql-transform",
  "phase": "pre-warehouse",
  "sqlOperation": { "type": "sql-operation", "name": "...", "inputs": {...}, "statements": [...] },
  "outputRouting": { "<outputName>": "<target-step>" },
  "mainStream": "drop",
  "gate": { "type": "datadog-query", "query": "service:api" }
}
```

- `phase` (required): `pre-parser` | `pre-warehouse` | `pre-exceptions` → slot
  keys `preParser` | `preWarehouse` | `preExceptions`. Any other (e.g.
  `pre-aggregation`) → *"phase '<phase>' is not accepted. Accepted phases are
  pre-parser, pre-warehouse, and pre-exceptions."*
- `sqlOperation` (required): the schema below.
- `outputRouting` (required): maps each `sql_output.outputName` to one target
  step. **Replaces the whole slot chain.**
- `mainStream` (required): `"drop"` (replace) | `"passthrough"` (tap). Fork model
  in SKILL.md Step 3.
- `gate` (optional `EventPredicate`): gates only the SQL node; the else branch
  always passes through. So: no gate + `passthrough` = tap all; no gate + `drop`
  = replace all; gate + `passthrough` = `IF gate THEN SQL+tap ELSE tap`; gate +
  `drop` = `IF gate THEN SQL→drop ELSE passthrough`. Omitted gate defaults to
  match-all (`{datadog-query, query:"*"}`).

`set-transform-chain` (write a raw `ChainNode` root verbatim) and
`clear-transform-chain` (empty a slot) also exist; use `set-sql-transform` for
almost all SQL work, and `set-transform-chain` when you must preserve/merge an
existing hand-authored chain in the slot.

## SqlOperation schema

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | Always `"sql-operation"`. |
| `name` | — | Identifier for the operation. |
| `inputs` | — | Map of table name → data type. The table name is what you write `FROM`. On this template it is always `{"logs": "LOG_EVENT"}` (the only supported type). |
| `statements` | yes | Non-empty, ordered list of `sql_view` / `sql_output`. |
| `availableDatasets` | — | **Leave `[]`.** Dataset-table registration throws `UnsupportedOperationException` at execution today — it is not usable. |
| `watermarkDelay` | — | Lateness window for time ops. Default `PT5S`, **max `PT10M`** (sub-second precision is dropped — set whole seconds). |
| `globalStateTtl` | — | Idle-state retention for aggregations/joins. Default `PT2M`. |

### Statements

**`sql_view`** — a named intermediate table later statements can reference.
- `tableName` (regex `^[a-zA-Z_][a-zA-Z0-9_]*$`, unique across views)
- `sqlQuery`
- `materialized` (default false) — force an execution boundary so a view read
  by multiple statements is computed once. *(The docs page calls this
  `shouldMaterialize`; the actual field is `materialized`.)*

**`sql_output`** — produces a routable output stream.
- `outputName` (regex `^(?=.*_)[a-zA-Z_][a-zA-Z0-9_]*$` — **must contain an
  underscore**; unique across outputs)
- `outputType` — always `LOG_EVENT` on this template.
- `sqlQuery`

There must be **at least one `sql_output`**. (`sql_io` / INSERT exists but has no
useful author-facing target; DDL is blocked server-side for security.)

## The LOG_EVENT schema

`LOG_EVENT` is the only stream type supported on the log-reducer template — both
the input table and every output. The Flink dialect also defines `VARIANT`,
`COMPLETE_SPAN`, and `METRIC_DATA`, but **this template does not support them**:
don't set them as an `inputs` value or `outputType`. In particular there is no
native metric output — derive metric-shaped `LOG_EVENT` rows instead
(`logs-to-metric.md`).

Fixed columns: `id` STRING, `eventtimestamp` TIMESTAMP_LTZ(3),
`receivedtimestamp` TIMESTAMP_LTZ(3), `message` STRING, `severity` INT (1-24
OTel; 9=INFO), `tags` MAP<STRING, ARRAY<STRING>>, `attributes` VARIANT.

- **Read attributes:** `VARIANT_VALUE(attributes, '$.process.thread', 'STRING')`
  for string scalars; `VARIANT_VALUE(attributes, '$.status_code', 'INT')` for
  integers. `returnType` must be an exact Flink type keyword — `'INT'` not
  `'INTEGER'`; a wrong type returns `NULL` silently (no error at `sql:validate`
  or draft). `VARIANT_VALUE_CONTAINS(attributes, 'needle', true)` to search.
- **Read tags:** `tags['service'][1]` (tags are arrays).
- **Write a fixed field:** select a column named exactly `message`, `severity`,
  etc. — and place it **before `*`** (`SELECT UPPER(message) AS message, * FROM
  logs`); after `*`, the original wins.
- **Write a tag:** backtick columns — `` 'prod' AS `tags.environment` ``,
  `` ARRAY_APPEND(tags['service'], 'billing') AS `tags.service` ``. Null/empty tag
  values are dropped; reusing a tag name overwrites.
- **Write an attribute:** any selected column whose name is *not* one of the
  seven fixed names is written into `attributes` under that name. Use
  `VARIANT_BUILD` for nested objects.
- **String replacement:** `REGEXP_REPLACE(message, '<pattern>', '<replacement>')`
  — replacement is **literal**; `$1` backreferences may be emitted verbatim, so
  prefer fixed text. At `pre-parser`, `message` is raw text so string ops apply
  directly; changing a value held *inside* `attributes` needs VARIANT rebuilding.
- **Defaults on construction:** omitted `id` → random UUID; timestamps → now;
  `message` → ""; `severity` → 9; `tags` → empty; `attributes` → empty.

## Output routing targets

`outputRouting` values must be exactly one of:

| Target | Sends the output to |
|--------|---------------------|
| `json-log-processor` | The JSON-parsing step. |
| `grok-parser` | The grok-parsing step. |
| `data-warehouse` | The processed-logs data-lake write **plus** the step immediately after it — i.e. the full normal post-warehouse fan-out. |
| `log-reducer` | The reducer/aggregation step only. |
| `sinks` | The pipeline's vendor/output sinks. |

Pick the slot's natural successor for *this* pipeline (read topology from
`grepr:describe-pipeline`). In `drop` mode the routed output is the only path
down, so routing to a single narrow step strands logs from the others — at
`pre-warehouse`, `data-warehouse` is usually the right in-place target. Confirm
where output lands by reading draft records (counts alone don't prove routing).

## Validation → error messages

The CLI validates before `job:plan`; mirror these to fail fast. Verbatim:

| Rule | Error |
|------|-------|
| `sqlOperation.type` wrong | `sqlOperation must be an object with type "sql-operation"` |
| `statements` empty/missing | `sqlOperation.statements must be a non-empty array` |
| No `sql_output` | `sqlOperation.statements must include at least one sql_output statement` |
| Bad/missing `mainStream` | `mainStream must be one of: drop, passthrough` |
| Output name empty | `every sql_output statement must have a non-empty outputName` |
| Duplicate output name | `duplicate sql_output outputName "<name>"; output names must be unique` |
| `outputRouting` not object | `outputRouting must be an object` |
| Routing key has no output | `outputRouting key "<key>" does not match any sql_output outputName` |
| Bad target value | `outputRouting["<key>"] = <value> is not a valid target step. Valid targets: json-log-processor, grok-parser, data-warehouse, log-reducer, sinks.` |
| Output not routed | `sql_output "<name>" has no route in outputRouting` |
| Bad gate | `gate must be an EventPredicate object with a "type"` |

Server-side (template compiler / Flink) additionally enforces: the `outputName`
underscore regex, unique view names, `watermarkDelay` ≤ 10 min, no DDL, and Flink
SQL syntax/type checks. **These surface only during `job:draft`, not in the CLI's
parse check or `sql:validate`.**

## Streaming rules

SQL runs continuously over an unbounded stream, not a batch:

- **Aggregations require a window.** `GROUP BY` without a windowing TVF accrues
  unbounded state and emits a retract stream the LOG_EVENT sink can't consume —
  the draft errors. Use `TUMBLE`/`HOP`/`SESSION`/`CUMULATE` over `eventtimestamp`
  (or `proctime()`) and group by `window_start, window_end, …`. See
  `logs-to-metric.md`.
- **`watermarkDelay`** = how long to wait for late events before closing a window
  (default `PT5S`). Larger = more late events captured, more latency.
- **`globalStateTtl`** (default `PT2M`) caps idle keyed state; raise it if keys
  recur on a longer cycle.
- **Filter early** (put `WHERE` before expensive `REGEXP_*`), avoid `SELECT *`
  when reshaping, and `materialize` a view reused by multiple statements.
- **Streaming JOINs** carry state — keep them bounded and rely on the TTL.

## Gotchas (the non-obvious failure modes)

| Mistake | What happens | Fix |
|---------|--------------|-----|
| `outputName` with no underscore (`redactedlogs`) | passes the CLI parse check, **fails at draft** | add an underscore (`redacted_logs`) |
| Unbounded `GROUP BY` (no window TVF) | retract stream the sink can't take → draft errors | wrap in `TUMBLE`/`HOP`, group by `window_start, window_end, …` |
| `passthrough` for an in-place change | original **and** changed copy both ship — duplication + leak, doubled volume | use `drop` |
| `drop` for a metrics/derive tap | deletes all your logs | use `passthrough` |
| `drop` + route to one narrow step (`log-reducer`) | logs reach only that step, stranded from lake/sinks | route to `data-warehouse` (full fan-out) at `pre-warehouse` |
| Override column placed *after* `*` | the original value wins; your change silently no-ops | put the override column **before** `*` |
| `VARIANT_VALUE` with wrong `returnType` (e.g. `'INTEGER'` or `'STRING'` on an int attribute) | returns `NULL` silently — no error at `sql:validate` or draft | use exact Flink type: `'INT'` for integers, `'STRING'` for strings |
| `$1` backreference in `REGEXP_REPLACE` replacement | emitted verbatim (literal text) | use a fixed replacement string |

None of the first five *error* at parse/plan time — they parse and draft cleanly
but do the wrong thing. Catch them by reading sampled draft records.

## Grepr-specific SQL functions

Standard Flink string/regex/numeric/date/JSON/conditional/aggregate functions are
available (you know these; full list in the `sql-functions` docs). The registered
Grepr UDFs are the non-obvious ones:

- `VARIANT_VALUE(variant, path, returnType[, onEmpty, emptyDefault, onError, errorDefault])`
  — typed scalar extract from a VARIANT at a JSON path.
- `VARIANT_VALUE_CONTAINS(variant, search, caseInsensitive[, paths])` — substring
  search across VARIANT string leaves.
- `VARIANT_BUILD('$.a.b', v1, '$.c', v2, …)` — build a nested VARIANT from
  literal path/value pairs (**paths must be literals**).
- `VARIANT_TO_JSON`, `VARIANT_GET`, `VARIANT_TRY_CAST`, `VARIANT_IS_EMPTY`, and
  the `VARIANT_SOME_*` family (`_EQ/_GT/_GE/_LT/_LE/_BETWEEN`) for quantified
  numeric/range tests.
- `GREPR_PERCENTILES(numeric, p1, p2, …)` → `ARRAY<DOUBLE>` (exact under ~1000
  values, KLL sketch above, ±1%). Ideal for latency percentiles; `[1]` is the
  first requested percentile.
- `ORDERED_ARRAY_AGG(value, 'ASC'|'DESC', sortKey, …)` → ordered `ARRAY`.
- `GREPR_ARRAY_CONTAINS_SUBSTR` / `_IGNORE_CASE` / `_STARTS_WITH` / `_ENDS_WITH`
  / `_REGEX_MATCH`; `MD5`/`SHA1`/`SHA256`; `TYPEOF`; `EPOCH_MILLIS`.

All are registered as system functions (no namespace qualifier). Confirm a
signature with `grepr docs:get doc://transforms/sql-transform/sql-functions/page.mdx`.
