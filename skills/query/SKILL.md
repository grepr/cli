---
description: Query logs or spans from Grepr datasets using a direct dataset selector or a source pipeline. Use for searching, sampling, investigating, or analyzing data in the Grepr data lake; supports user intent, exact predicates, bounded time ranges, and saved raw results.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:list), Bash(grepr dataset:list), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:list), Bash(grepr --conf * dataset:list), Bash(jq), Bash(date), grepr:cli, grepr:query-predicate
---

# Query Grepr data

Resolve the org config once and reuse the same `--conf` value on every command.
See `grepr:cli` for config handling.

## 1. Resolve source and signal

Use one source mode:

- `--dataset-id` or `--dataset-name`: explicit mode. Logs are the default;
  pass `--data-type spans` only for spans.
- `--job-id`: pipeline-derived mode. The CLI infers the dataset and signal.
  Pass `--data-type` only when the user explicitly asserted it.

For a bare name, prefer an active matching job from
`grepr job:list --state RUNNING -f raw`; otherwise resolve it with
`grepr dataset:list`.

## 2. Build the predicate

Invoke `grepr:query-predicate` with the user's intent and resolved signal. Use
its `query` and `queryType` unchanged. Omit `--query` when it returns an empty
predicate.

`--message-length-min` and `--message-length-max` apply only to logs.

## 3. Bound and run once

Use absolute ISO-8601 timestamps when the user supplied a range. The CLI's
omitted defaults are bounded: the last 10 minutes and 100 records. Set a
smaller explicit `--limit` when sampling.

For a result the user will read directly, use table output. For any further
analysis, run once and save clean NDJSON:

```bash
grepr query <source> [--data-type spans] [--query "<query>"] \
  [--query-type <type>] [--start <start> --end <end>] --limit <n> \
  -q -f raw -o query-result.ndjson
```

Do not pipe or redirect stderr into the record stream. Inspect the saved file
with `jq` instead of rerunning the query.

Examples:

```bash
# Logs: --data-type is intentionally omitted because logs are the default.
grepr query --dataset-name raw-logs --query "service:checkout AND error" \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z --limit 50

# Job-derived spans: the data type is inferred.
grepr query --job-id 0kmjah9wkg9d0 \
  --query "serviceName:checkout AND hasError:true" --limit 50
```
