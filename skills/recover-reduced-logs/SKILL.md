---
name: recover-reduced-logs
description: Recovers the original logs behind Grepr summaries from the Grepr data lake, for Datadog, New Relic, Splunk, Sumo Logic, or OTLP backends. Use when the vendor lacks a log, ID, or count for a Grepr-processed service, shows a `Repeats Nx in the past` line, or the originals need backfilling.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:list), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), Bash(jq), grepr:cli, grepr:query, grepr:backfill-logs, grepr:describe-pipeline
metadata:
  grepr-mcp: "true"
---

# Logs reduced by Grepr

Needs the `grepr` CLI, logged in; see `grepr:cli`.

## What the vendor gets

Shippers send to a Grepr pipeline, not straight to the vendor. The pipeline stores the logs that
reach its raw sink (after any pre-parser or pre-warehouse filters) in its data lake dataset(s), and
sends the vendor, per time window, a few samples of each repeated pattern plus one summary for the
rest; unmatched logs and configured exceptions go through unchanged. What the vendor lacks, the data
lake usually has; a log missing from both was dropped by a pipeline filter (see
`grepr:describe-pipeline`).

A summary reads `Repeats <N>x in the past <t>s: <pattern>` (variable parts masked) and carries
`grepr.repeatCount`, `grepr.patternId`, `grepr.firstTimestamp`/`grepr.lastTimestamp` (epoch ms), and
`grepr.rawLogsUrl`. Every forwarded log has `grepr.messageType` (`sample`, `summary`, `passthrough`,
`exception`); UI-created pipelines also add `processor=grepr` and `pipeline=<name>` (set at sink
creation, so possibly stale or absent). Sum `grepr.repeatCount` (1 when absent) for true counts.

| Vendor | `grepr.messageType` | `processor`, `pipeline` | `grepr.*` attributes |
|---|---|---|---|
| Datadog | tag, lowercased: `grepr.messagetype` | tags | `@grepr.repeatCount` etc. |
| New Relic | `tags.grepr.messageType` | attributes | attributes (backtick dotted names in NRQL) |
| Splunk | indexed field | indexed fields | indexed fields |
| Sumo Logic | JSON body key | JSON body keys | JSON body keys |
| OTLP | log record attribute | resource attributes | log record attributes |

## Get the originals behind a summary

Goal: the originals the summary stands for, saved with `-o`: the last `repeatCount` records matching
its pattern. Earlier matches went to the vendor as `sample`s; list them separately if at all.

**Check the vendor first** if you can search it (`pup`, a vendor MCP, NRQL, SPL), with one or two
searches: if it has the exact log, you're done; if it shows the summary, its fields say where the
originals are; if it shows neither, go to the data lake with what the user gave you.

**Scope.** `rawLogsUrl` gives `start`/`end` (epoch ms), `tags.<key>=v1,v2`, and either a
`datasetId` or the `jobId`/`jobVersion` that produced the summary. Without a link, find the pipeline
by its `pipeline` marker (`grepr job:list --fields id,name`), else by the source and vendor sink the
service uses (several can match). List its datasets; conditional routing can split logs across
several, and `--job-id` reads only the default one:

```bash
grepr job:get <jobId> [--for-version <v>] --resolved -f compact |
  jq -c '.jobGraph.vertices[] | select(.type=="logs-iceberg-table-sink") | {name, datasetId}'
```

Sinks whose name contains `raw_data` hold originals; `processed_logs` sinks hold Grepr's output.
If the names don't say, a raw sink is one the graph feeds before the reducer.

**Query** each raw dataset with `grepr:query`: the window from
`jq -rn '<start>/1000|floor|todate'` to `jq -rn '(<end>/1000|floor)+1|todate'`, the tag filters only, `--limit` max(1000, 5 × `repeatCount`)
(raise it 10× if exactly that many rows return). Keep the pattern text out of the query: a
whole-word `prefix` misses originals like `prefix123`.

**Narrow** the files to records containing the pattern's longest literal piece, case-insensitively
(skip the `Repeats` prefix, masked parts, `***`, and a trailing `...<TRUNCATED>`):
`jq -c --arg p '<piece>' 'select((.message // "") | ascii_downcase | contains($p | ascii_downcase))'`.
More candidates than `repeatCount` is normal: the pattern's first logs went to the vendor as
`sample`s, and the summarized ones are the last N spanning about `<t>` seconds. Fewer means
originals are missing, typically one lacking a tag key (the URL's tags are the union of the
originals'): drop `host`, then `service`, and query again. A full count doesn't prove completeness,
and the Grepr UI view behind `rawLogsUrl` has the same tag filters.

## Backfill into the vendor

Only when the originals must be in the vendor (a monitor, a dashboard, a link to share), hand off to
`grepr:backfill-logs` (all five vendors) with the same dataset and window. The user picks the
predicate: the tag scope also re-sends neighbouring logs; adding the pattern text sends fewer but can
miss originals. Backfills re-ingest at the customer's cost: preview and get explicit confirmation
first. Backfilled logs carry `grepr.backfilled`.

Without a shell, find logs with the Grepr MCP `search_logs` tool and give the user the
`grepr backfill ...` command.
