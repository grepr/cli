# Spans backfill directives

## Decide whether to apply post-reducer SQL

The default is no SQL. Only for a job-derived spans backfill, inspect the
source job before dry-run:

```bash
grepr job:get <job-id> --resolved -f raw -o source-span-job.json
jq '
  .jobGraph as $graph
  | INDEX($graph.vertices[]; .name) as $vertices
  | [
      $graph.edges[]
      | split(" -> ")
      | map(split(":")[0])
      | select(
          $vertices[.[0]].type == "trace-reducer" and
          $vertices[.[1]].type == "sql-operation"
        )
      | $vertices[.[1]]
    ]
' source-span-job.json
```

This follows graph topology rather than operation names and handles explicit
source and target ports. When exactly one post-reducer SQL operation exists,
read its statements, summarize the observable effect in one concise line, and
ask whether to keep it. If several are returned, summarize each and explain
that `--preserve-sql` cannot preserve multiple operations; offer to exclude
them or replace them with one explicit `--sql-operation`.

- Keep it: add `--preserve-sql`.
- Exclude it: add no SQL flag.
- Replace it: author a custom operation and pass
  `--sql-operation <file>`.

Do not assume that pipeline parity is desired. Surface filtering, dropped
fields, or other lossy behavior explicitly in the one-line summary.

## Author custom SQL only when requested

The CLI accepts a JSON SQL operation with exactly one `COMPLETE_SPAN` input,
at least one `COMPLETE_SPAN` `sql_output`, and no IO or DDL statements.
Prefer `SELECT *` so new and nullable span fields survive. The only supported
extra columns are `resource.attributes`, `instrumentationscope.attributes`,
and `span.attributes` VARIANT values; Grepr merges them into the corresponding
nested attribute maps.

Use this host-normalization pattern when the user wants backfilled spans
grouped under a stable Datadog host while retaining the original host:

```sql
SELECT *,
  VARIANT_BUILD(
    '$["datadog.trace_payload.hostname"]', '<normalized-host>'
  ) AS `resource.attributes`,
  VARIANT_BUILD(
    '$["grepr.host"]',
    COALESCE(
      VARIANT_VALUE(resource.attributes, '$["host.name"]', 'STRING'),
      VARIANT_VALUE(
        resource.attributes,
        '$["datadog.trace_payload.hostname"]',
        'STRING'
      )
    )
  ) AS `span.attributes`
FROM spans
```

Wrap the SQL in a `sql-operation` JSON file with input table `spans` and a
`COMPLETE_SPAN` `sql_output`. For a different transform, retrieve only the
relevant example with `grepr docs:search`; do not invent functions or rebuild
nested span rows from memory.

Backfilled spans carry `processor=grepr`, `grepr.backfilled=true`,
`grepr.backfilled.timestamp=<server-generated submission time>`, and user-supplied
`--tag` values as attributes. Generated vendor links omit the timestamp because the
server assigns it after submission.

Before rerunning a failed spans backfill, verify destination state: span
delivery and dedup are not atomic, so a retry is not guaranteed exactly-once.

## Examples

Job-derived, no SQL:

```bash
grepr backfill --job-id 0kmjah9wkg9d0 \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --query "serviceName:checkout AND hasError:true" \
  --dry-run --output backfill-request.json
```

Job-derived, preserve the source pipeline's post-reducer SQL:

```bash
grepr backfill --job-id 0kmjah9wkg9d0 --preserve-sql \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --dry-run --output backfill-request.json
```

Explicit dataset with custom SQL:

```bash
grepr backfill --dataset-id 0q158fv3kxttq --data-type spans \
  --sink-id 0kmjaa8p7gbpf \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --sql-operation span-host-normalization.json \
  --dry-run --output backfill-request.json
```
