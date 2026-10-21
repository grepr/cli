---
name: query
description: Searches logs or spans in the Grepr data lake with `grepr query`, keeping each query cheap (tight window, partition and indexed filters, saved NDJSON). Use to find, sample, or investigate raw logs or spans.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:list), Bash(grepr dataset:list), Bash(grepr dataset:table-config), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), Bash(grepr --conf * dataset:list), Bash(grepr --conf * dataset:table-config), Bash(jq), Bash(date), grepr:cli, grepr:query-predicate
metadata:
  grepr-mcp: "true"
---

# Query Grepr data

Needs the `grepr` CLI, logged in, with one `--conf` reused throughout; see `grepr:cli` for setup and
output conventions. Without a shell, logs (not spans) can be searched with the Grepr MCP
`search_logs` tool under the same rules, paging with `continuationToken`; for spans, give the user
the `grepr query ... --data-type spans` command.

If the question starts from the user's observability vendor (a missing log, a `Repeats Nx in the
past` line, a count that dropped), read `grepr:recover-reduced-logs` first.

## Source

- `--dataset-id`/`--dataset-name`: logs by default, `--data-type spans` for spans.
- `--job-id`: the CLI infers dataset and signal from the pipeline. Pass `--data-type` only if the
  user stated it; a mismatch is rejected.
- A bare name: prefer a running job (`grepr job:list --state RUNNING --fields id,name,processing`),
  else a dataset (`grepr dataset:list --fields id,name`).

## Predicate

Build it with `grepr:query-predicate` and use its `query` and `queryType` unchanged. `service:x` and
`host:x` are tags, `@path.to.field:x` is an attribute, `status:error` is severity, and
`"quoted text"` matches the message only, never attribute values.

## Cost

A query scans the data lake and fails past its scan limit (`Hit data scan limit`; narrow the query,
don't rerun it). Raw log tables are partitioned by hour and bucketed by `service` and `host`, so:

- Use the narrowest absolute `--start`/`--end` that answers the question (default: last 10 minutes).
- Add `service:`/`host:` whenever known; on a day-long search this cut 15 s to 5 s.
- Prefer indexed fields. For a log dataset, `grepr dataset:table-config <id> -f compact --fields
  effectiveSpec,promotedTags,promotedAttributes` lists the partition fields and the indexed tags and
  attributes; only entries with `excluded: false` are indexed. Unindexed filters still return the same results, so keep every
  filter the user asked for.
- Free text is the costly part: unscoped over 24 hours it hit the scan limit, scoped to a service and
  an hour it took 4 s. Scope it; if the value is in an attribute, filter the attribute instead.
- Keep `--limit` small for samples; matches stop at the limit.

## Run once, analyze the file

Show `-f table` when the user reads the rows directly. Otherwise save once and analyze with `jq`:

```bash
grepr query <source> [--data-type spans] --query "<query>" [--query-type <queryType>] \
  --start <iso> --end <iso> --limit <n> -q -f raw -o result.ndjson
```

Records carry `id`, `eventTimestamp` (epoch ms), `severity`, `message`, `tags` (array values), and
`attributes`. `--message-length-min/-max` (logs only) add a `char_length(message)` filter. For counts,
top-N, or percentiles, use `grepr:sql-analytics` instead of pulling rows.
