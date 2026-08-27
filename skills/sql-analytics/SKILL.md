---
description: Answer a question about data already stored in a Grepr dataset by running one ad-hoc analytical SQL query over it - arbitrary GROUP BY, COUNT DISTINCT, percentiles, cardinality over time, top-N by any tag or attribute. Submits a read-only batch Flink job and streams the result rows back to the terminal; nothing is written and no pipeline is changed. Use for "group by", "count distinct", "cardinality over time", "top N services", "how many X per Y", "ad-hoc SQL over the data lake", "analytics query". Not for reducing log volume (that is grepr:tune-reduction) and not for changing what a live pipeline emits (that is grepr:build-sql-transform).
allowed-tools: Bash(grepr query), Bash(grepr job:create), Bash(grepr sql:validate), Bash(grepr dataset:list), Bash(grepr dataset:get), Bash(grepr job:list), Bash(grepr job:get), Bash(grepr docs:get), Bash(grepr --conf * query), Bash(grepr --conf * job:create), Bash(grepr --conf * sql:validate), Bash(grepr --conf * dataset:list), Bash(grepr --conf * dataset:get), Bash(grepr --conf * job:list), Bash(grepr --conf * job:get), Bash(grepr --conf * docs:get), Bash(jq), Bash(date), Read, Write, grepr:cli, grepr:query, grepr:query-predicate, grepr:describe-pipeline, grepr:describe-datasets
---

# Analytical SQL over a dataset

`grepr query` returns rows. This skill answers questions *about* rows already
in the lake: how many distinct users per hour, which services produce the most
events, the p99 of a parsed duration, how a cardinality moves across a window.

There is no `grepr sql` command. You submit a job graph that reads a dataset,
aggregates it in Flink SQL, and streams the result back to the terminal:

```
<signal>-iceberg-table-source -> sql-operation -> <type>-sync-sink
```

The job is **read-only**: no dataset write, no vendor sink, no pipeline change.

## Not this skill

Two neighbours are easy to confuse, because both are things people call
"aggregating logs":

- **Reducing log volume** on a pipeline is `grepr:tune-reduction`. That is the
  reducer collapsing repeated lines into patterns for every customer log, and it
  is the product's normal behaviour, not a query.
- **Changing what a live pipeline emits** with SQL is
  `grepr:build-sql-transform`. That writes to production.

This skill only reads what is already stored and hands back the answer.

## 1. Pick the source and sink

The source, the `inputs` type, and the sink must agree. `inputs` maps a table
name to a type, and that name is what your SQL selects `FROM`; the sink must
match what the final statement emits.

| Signal | Source | `inputs` | SQL reads |
|--------|--------|----------|-----------|
| logs | `logs-iceberg-table-source` | `{"logs": "LOG_EVENT"}` | `FROM logs` |
| spans | `traces-iceberg-table-source` | `{"spans": "COMPLETE_SPAN"}` | `FROM spans` |

Metrics are not covered.

`VARIANT` output plus `variant-sync-sink` is the right pair for almost every
question, whatever the signal. A GROUP BY produces arbitrary columns, and
`VARIANT` is the only output type that accepts an arbitrary shape. Choose
`LOG_EVENT` with `logs-sync-sink`, or `COMPLETE_SPAN` with `spans-sync-sink`,
only when the result rows really are events or spans.

Every source takes `datasetId`, `query`, `start`, `end`, `limit`, `sortOrder`.
Resolve `--conf` once and reuse it (see the `grepr:cli` skill). Get the dataset
id from `grepr dataset:list`, or from a pipeline's raw dataset via
`grepr:describe-pipeline`.

## 2. Ask for the scope and the fields

A logs dataset holds **heterogeneous schemas**. Many services, teams, and log
formats share one table, and no two of them carry the same attribute paths.
Nothing in a result says which of them you aggregated, so an unscoped query
blends them into one confident number.

Do not derive the query from the data. Get it from the user:

- **Scope.** Which service, team, or environment the question is about. Without
  one, the answer silently spans everything in the dataset.
- **The exact attribute path** to group or count on, for example
  `$.message.workspace.id`. A path that is slightly wrong does not error:
  `VARIANT_VALUE` returns `NULL`, and the count comes back as 0 or quietly low.

Ask whenever either is missing. A scoping predicate is not required for the
query to run, so treat it as the user's decision rather than something to infer.

Sampling **confirms** a path the user gave you. It does not discover one. A
bounded sample of a heterogeneous table is not representative, so a field's
absence from a sample proves nothing about the dataset:

```bash
grepr query --dataset-id <id> --query "service:checkout" \
  --start <iso> --end <iso> --limit 200 -q -f raw -o sample.ndjson
```

`grepr query` samples through **Athena by default**, not the Flink engine the
job will use. Athena bills per byte scanned, so keep the sample small and
bounded. To sample on the same engine the job runs on, set
`GREPR_QUERY_ENGINE=flink`; there is no flag for it, only the environment
variable.

## 3. Write the statements

`statements` is an ordered list. Each has a `type`:

- `sql_view` + `tableName` stages an intermediate result that later statements
  select from. Use it the way you would a CTE.
- `sql_output` + `outputName` + `outputType` produces the stream that leaves the
  operation. `outputName` must be unique and **contain an underscore**.

Reading data, whatever the signal:

- a tag: `tags['service'][1]` (tags are arrays)
- an attribute: `VARIANT_VALUE(attributes, '$.a.b', 'STRING')`. The return type
  must be an exact Flink type keyword: `'INT'`, not `'INTEGER'`. A wrong type
  returns `NULL` with no error.

`LOG_EVENT` input columns are **lowercase**: `id`, `eventtimestamp`,
`receivedtimestamp`, `message`, `severity`, `tags`, `attributes`.

`COMPLETE_SPAN` column names differ from the span JSON you get back from
`grepr query`, so read the schema rather than the sample: `servicename`,
`instrumentationscope` (the JSON calls it `scope`), and lowercase
`tracesignature`, `duration`, `haserror`, `percentilebucket`, `crit_path_ns`,
`crit_path_pct`. Nested span fields keep camelCase: `span.operationName`,
`span.spanKind`, `span.durationNanos`. Read attributes from `span.attributes`
or `resource.attributes`; there is no `tags` map on a span.

The full row schemas are in
`grepr docs:get doc://transforms/sql-transform/data-types/page.mdx`.

### The VARIANT output contract

A `VARIANT` output must select **exactly three columns, in this order, with
these camelCase names in backticks**. This is the highest-failure rule here, and
getting it wrong surfaces only as
`Failed to convert table <name> to VARIANT stream`:

```sql
SELECT
  MAX(receivedtimestamp) AS `receivedTimestamp`,
  MAX(eventtimestamp)    AS `eventTimestamp`,
  PARSE_JSON(JSON_OBJECT(
    'bucket'         VALUE DATE_FORMAT(eventtimestamp, 'yyyy-MM-dd HH:00'),
    'distinct_users' VALUE COUNT(DISTINCT VARIANT_VALUE(attributes, '$.user.id', 'STRING')),
    'events'         VALUE COUNT(*)
  )) AS `data`
FROM logs
GROUP BY DATE_FORMAT(eventtimestamp, 'yyyy-MM-dd HH:00')
```

Every result field goes inside the `JSON_OBJECT`; its keys become the returned
JSON. When a view has already aggregated the timestamps away, carry them
through the view (`MAX(eventtimestamp) AS ets`) and select them in the output.

**Do not mix `COUNT(DISTINCT ...)` with an ARRAY-returning UDF** such as
`GREPR_PERCENTILES` in one `GROUP BY`. The distinct forces a two-pass aggregate
and the second pass cannot `MIN` an `ARRAY`, so the job fails at plan time with
`Min aggregate function does not support type: 'ARRAY'`. Split them into two
statements, or two jobs.

### A spans example

Same job shape, different source, `inputs`, and table name. Per-service latency
and error rate over a window:

```sql
SELECT
  MAX(receivedtimestamp) AS `receivedTimestamp`,
  MAX(eventtimestamp)    AS `eventTimestamp`,
  PARSE_JSON(JSON_OBJECT(
    'service' VALUE servicename,
    'spans'   VALUE COUNT(*),
    'errors'  VALUE SUM(CASE WHEN haserror THEN 1 ELSE 0 END),
    'p50'     VALUE GREPR_PERCENTILES(CAST(duration AS DOUBLE), 0.5, 0.99)[1],
    'p99'     VALUE GREPR_PERCENTILES(CAST(duration AS DOUBLE), 0.5, 0.99)[2]
  )) AS `data`
FROM spans
GROUP BY servicename
```

Ask for every percentile you need in one `GREPR_PERCENTILES` call and index the
result array; it returns them in the order requested.

Syntax-check each statement before submitting. `sql:validate` parses only; it
checks no columns, types, or output shape:

```bash
grepr sql:validate "$(cat statement.sql)"
```

## 4. Assemble and run

```json
{
  "name": "hourly_cardinality",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      { "name": "source", "type": "logs-iceberg-table-source",
        "datasetId": "<dataset-id>",
        "query": { "type": "datadog-query", "query": "service:checkout" },
        "start": "2026-07-08T10:00:00Z", "end": "2026-07-08T16:00:00Z",
        "limit": -1, "sortOrder": "UNSORTED" },
      { "name": "agg", "type": "sql-operation",
        "inputs": { "logs": "LOG_EVENT" },
        "statements": [
          { "type": "sql_output", "outputName": "q_out",
            "outputType": "VARIANT", "sqlQuery": "<the SELECT>" }
        ] },
      { "name": "sink", "type": "variant-sync-sink" }
    ],
    "edges": ["source -> agg:logs", "agg:q_out -> sink"]
  }
}
```

```bash
grepr job:create job.json -f raw > result.ndjson
```

Each result row is `{"type":"variant_event","data":{...},...}`; your fields are
under `data`.

Three shapes that are easy to get wrong:

- `statements[].type` is `sql_view`, `sql_output`, or `sql_io`. Not `OUTPUT`.
- Edges name the port: `source -> agg:logs` matches the `inputs` key,
  `agg:q_out -> sink` matches `outputName`. A bare `agg -> sink` fails with
  `Output q_out not found in vertex agg`.
- `processing: BATCH` makes a plain `GROUP BY` legal. `STREAMING` would require
  a window TVF.

## 5. Bound the scan

**Set `limit: -1` on every analytical query.** The source `limit` caps how many
rows reach your SQL, not how many rows come back, and the field is optional:
**leave it out and the API fills in `2500`**. A source vertex with no explicit
`limit` feeds 2500 rows into the aggregate and hands back a complete-looking
result with no error and no warning. That is the most common cause of a wrong
analytical answer.

**A limit does not make the query cheaper.** The plan scans, filters, and only
then truncates, so the limit cuts the stream feeding your SQL rather than the
read behind it. On one measured window the same query scanned roughly two
million rows whether the limit was 2500 or -1, while the answers differed by
35x. Cost comes from the time window and partition pruning (section 6), so
narrow those instead.

There is no ceiling by default, so `-1` is always available. If a deployment
sets one, exceeding it is an explicit error naming the number (`limit in a sync
query source cannot be more than <n>. Found <m>`), never a silent truncation.

Use a positive limit only when you deliberately want a bounded sample instead
of an exact answer. Then check that you got what you asked for, because
truncation is silent, and the check only works when the SQL counts every row
the source read:

- put all filtering in the **source predicate**, not in a SQL `WHERE`, so the
  scan and the aggregate see the same rows, and
- emit an unfiltered `COUNT(*)` as its own output field.

Sum that field across the returned rows. Equal to the limit means the scan was
cut short. A `WHERE` inside the SQL, or an output of only distinct counts,
makes the sum smaller than the rows scanned, so a truncated result passes the
check and reads as complete.

## 6. Make the scan cheap

`eventTimestamp` is always a partition field and always prunes. The other
partition fields come from the dataset's table config: the default is `service`
and `host`, but a dataset can partition on promoted `tag_<key>` columns instead.
The CLI cannot yet show which, so treat `service` and `host` as likely rather
than certain. Filtering on `service` prunes nothing on a dataset that no longer
partitions by it, while the tag it does partition by would prune a lot.

A predicate on any other tag, and on any attribute, filters but does not prune.
`attributes` is a single JSON column, so an attribute predicate decodes each
row's whole attribute payload. Prefer a tag over an attribute where both carry
the same value, and always bound the window.

## What does not work

- **`availableDatasets` is not implemented.** Setting it fails the job with
  `Dataset table registration not supported yet`. One source vertex per job, so
  there is no cross-dataset join today. To combine two datasets, run two jobs
  and join the NDJSON locally.
- **One source vertex per SQL operation** unless you are deliberately unioning
  compatible streams into separate `inputs` keys.
