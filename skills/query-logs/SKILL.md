---
description: Query logs from Grepr datasets using filters and time ranges.
allowed-tools: Bash(grepr query), Bash(grepr --conf * query), Bash(jq), grepr:describe-datasets
---

# Prerequisites
You may need the `grepr:describe-datasets` skill to list and find datasets.

You can use the `grepr query` command to query logs from Grepr datasets.

# Skill: Query Logs
- Always use ISO 8601 format for time ranges.
- If you want to search the "message" field, just use words without any special syntax.
- To filter on tags, use `key:val` syntax.
- To filter on attributes, use `@key:val` syntax.
- Use logical operators like AND, OR, NOT to combine filters.
- Use parentheses to group conditions for complex queries.
- Use comparison operators like `>`, `<`, `>=`, `<=` for numeric attributes.
- Use wildcards `*` for partial matches in tag or attribute values.
- Use quotes `""` for phrase matching in the message field.
- Use `--format raw`/`-f raw` with `-q -o <file>.ndjson` for JSON output that will be parsed programmatically. Do not pipe or redirect stderr into the record stream.
- Use `--max-lines` to adjust the maximum number of lines shown for json cells in table format.
- Avoid rerunning queries multiple times since queries can be slow and expensive. Instead, output results to a file for further analysis.
- When displaying results for a user, use `--format table` for human-readable output. Use `--format raw` for JSON output that is easier to parse programmatically.
- `--dataset-name` or `--dataset-id`: The dataset name/id to query. This should be provided by
  the user or set as a default config option. You can retrieve available datasets using the
  CLI's `dataset:list` command. You can see what dataset a pipeline is writing to by getting
  the pipeline config using `job:get <jobId> --no-color | grep raw_data_sink -B 3 -A 6 | grep dataset`.
- `--query`: The query string to filter logs. This uses Datadog-like syntax. Filter on tags using `key:val` syntax,
  and use logical operators like AND, OR, NOT. You can also filter on attributes using `@key:val` syntax.
  Use words to search the log message text.
- `--start` and `--end`: Time range using ISO-8601 format.
- Use `--limit` to restrict the number of log events returned instead of using head or tail commands. Make sure this is always set to avoid long and expensive queries.
- Avoid rerunning queries multiple times since queries can be slow and expensive. Instead, output results to a file for further analysis.
- Prefer `jq` against the saved file for quick summaries. Avoid long inline Python one-liners; if Python is needed, read from the saved file and do not parse mixed stdout/stderr command output.

## Examples

```bash
grepr query --dataset-name my-dataset --query "service:auth AND severity:>=9" --start "2024-08-20T00:00:00Z" --end "2024-08-21T00:00:00Z" --limit 100 --format table

grepr query --dataset-id ds-123456 --query "state change @user.id:jaja" --start "2024-08-20T00:00:00Z" --end "2024-08-21T00:00:00Z" --limit 50 -q -f raw -o sample.ndjson
```
