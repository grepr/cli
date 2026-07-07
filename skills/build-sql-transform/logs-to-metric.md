# Case: logs → metric-shaped logs

Use this when the user wants metrics *derived from* their logs — counts, rates,
percentiles, per-key rollups. It's the one outcome with compounding Grepr
specifics, so read this fully before authoring.

The four facts that make this case different from a row transform:

1. **There is no native metric output.** This template supports only `LOG_EVENT`
   (no `METRIC_DATA` type, and every routing target is a log step). Emit
   `LOG_EVENT` rows that *carry* the computed values (in `message`, `tags`, and
   attribute columns) and route them to a log step. They are queryable/forwardable
   logs, not true metric datapoints.
2. **`mainStream: "passthrough"`** — the aggregation is a *tap*. The raw logs keep
   flowing untouched; the metric rows are an additional stream. `drop` here would
   delete your logs.
3. **Aggregation requires a window TVF.** A bare `GROUP BY` on an unbounded stream
   emits a retract stream the LOG_EVENT sink can't take — the draft errors. Wrap
   the source in `TUMBLE`/`HOP`/`SESSION`/`CUMULATE` and group by `window_start,
   window_end, <keys>`.
4. **Rows emit only when a window closes.** A draft shorter than window +
   `watermarkDelay` shows nothing. Keep the window short (1 min), `watermarkDelay`
   low (`PT5S`–`PT30S`), and draft ≥ 90–120s — or report the draft inconclusive.

## Authoring checklist

- **Window**: `TUMBLE` for non-overlapping buckets (most common); `HOP` for a
  sliding rate; `SESSION` for activity bursts. Bucket over `eventtimestamp`.
- **Keys**: the dimensions to group by (e.g. service). Read tags with
  `tags['service'][1]`; write them back as `` … AS `tags.service` ``.
- **Measures**: `COUNT(*)`, `SUM`, `GREPR_PERCENTILES(expr, 0.95, 0.99)[1]` for
  p95, etc. Cast numeric measures to `STRING` if you put them in `message`;
  non-core columns land in `attributes`.
- **Make the rows findable**: set a marker tag (`` 'error_rate' AS `tags.metric`
  ``) so the user can query the rollup afterward.
- **Route**: `sinks` to forward the metric-logs out; `data-warehouse` to keep them
  queryable in the lake. Pick the slot's natural successor.

## Worked example — per-minute error count + p95 latency per service

`pre-warehouse` (needs the parsed `duration_ms` attribute), `passthrough` tap,
1-minute tumbling window.

```json
{
  "operations": [
    {
      "op": "set-sql-transform",
      "phase": "pre-warehouse",
      "sqlOperation": {
        "type": "sql-operation",
        "name": "error_rate_metrics",
        "inputs": { "logs": "LOG_EVENT" },
        "statements": [
          {
            "type": "sql_output",
            "outputName": "service_error_metrics",
            "outputType": "LOG_EVENT",
            "sqlQuery": "SELECT CONCAT('errors=', CAST(COUNT(*) AS STRING)) AS message, MAX(severity) AS severity, tags['service'][1] AS `tags.service`, 'error_rate' AS `tags.metric`, CAST(COUNT(*) AS STRING) AS error_count, CAST(GREPR_PERCENTILES(CAST(VARIANT_VALUE(attributes, '$.duration_ms', 'BIGINT') AS DOUBLE), 0.95, 0.99)[1] AS STRING) AS p95_latency_ms FROM TABLE(TUMBLE(TABLE logs, DESCRIPTOR(eventtimestamp), INTERVAL '1' MINUTE)) WHERE severity >= 17 GROUP BY window_start, window_end, tags['service'][1]"
          }
        ],
        "availableDatasets": [],
        "watermarkDelay": "PT30S",
        "globalStateTtl": "PT5M"
      },
      "outputRouting": { "service_error_metrics": "sinks" },
      "mainStream": "passthrough"
    }
  ]
}
```

Why it works: `passthrough` keeps the raw logs flowing; the aggregated rows are an
additional stream routed to `sinks`. `TUMBLE` bounds the `GROUP BY`.
`GREPR_PERCENTILES(...)[1]` is p95 (first requested percentile).
`error_count`/`p95_latency_ms` aren't core columns, so they land in `attributes`;
`tags.service`/`tags.metric` are written as tags via backtick columns. Draft
longer than the window or you'll see no rows.

## Variant — transform **and** derive a metric in one operation

*"Mask the card numbers **and** give me a per-service count of masked logs per
minute"* is two outputs of **one** `sql-operation`: an in-place stream plus a
windowed rollup. Build the count as a real routed output — never eyeball it from
draft records. Use a `sql_view` to do the shared work once.

```json
{
  "operations": [
    {
      "op": "set-sql-transform",
      "phase": "pre-parser",
      "sqlOperation": {
        "type": "sql-operation",
        "name": "mask_and_count",
        "inputs": { "logs": "LOG_EVENT" },
        "statements": [
          {
            "type": "sql_view",
            "tableName": "masked",
            "sqlQuery": "SELECT REGEXP_REPLACE(message, '[Cc]ard ending [0-9]{4}', 'card ending <redacted>') AS message, id, eventtimestamp, receivedtimestamp, severity, tags, attributes FROM logs"
          },
          {
            "type": "sql_output",
            "outputName": "masked_logs",
            "outputType": "LOG_EVENT",
            "sqlQuery": "SELECT *, 'v1' AS `tags.mask` FROM masked"
          },
          {
            "type": "sql_output",
            "outputName": "mask_counts",
            "outputType": "LOG_EVENT",
            "sqlQuery": "SELECT CONCAT('masked=', CAST(COUNT(*) AS STRING)) AS message, tags['service'][1] AS `tags.service`, 'mask_count' AS `tags.metric`, CAST(COUNT(*) AS STRING) AS masked_count FROM TABLE(TUMBLE(TABLE logs, DESCRIPTOR(eventtimestamp), INTERVAL '1' MINUTE)) WHERE message LIKE '%card ending %' GROUP BY window_start, window_end, tags['service'][1]"
          }
        ],
        "availableDatasets": []
      },
      "outputRouting": {
        "masked_logs": "json-log-processor",
        "mask_counts": "data-warehouse"
      },
      "mainStream": "drop",
      "gate": { "type": "datadog-query", "query": "service:payment" }
    }
  ]
}
```

Why it works: the `masked` view does the masking once. `masked_logs` is the
replacement stream (`mainStream: "drop"` drops the original, so no duplicate),
routed to `json-log-processor` to continue the log path; `mask_counts` is the
windowed rollup, routed to `data-warehouse` so the user can `grepr query` it. The
count windows over `logs` (where the time attribute/watermark lives). Draft ≥
window + watermark (~90s) or you'll see masked logs but no counts yet.

## Verifying the draft

On the post-SQL sink-path stages: metric rows appear *after* a window closes;
counts/percentiles are plausible; the marker tag is set; and — critically — the
raw logs are **still flowing** (passthrough). If you see no rows, the draft was
shorter than the window: widen `--max-duration-seconds` before concluding it's
broken.
