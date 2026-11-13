---
description: Job graph patterns for ad-hoc Grepr jobs (a synchronous data-lake query, a test job over inline sample logs) and the template-backed shape of a pipeline job. Use when you write a job JSON for grepr job:create by hand. To create a pipeline, use grepr:build-pipeline.
---

# Job Graph Patterns

Use these patterns when you write an ad-hoc job, such as a query or a test job,
for `grepr job:create`. Ad-hoc jobs use a graph of vertices and edges that you
write. A pipeline does not.

## Pipeline jobs

A pipeline is an `ASYNCHRONOUS` `STREAMING` job whose graph is one
`template-operation` vertex with no edges. The vertex names a built-in template
and holds the pipeline settings in `templateInputs.input`. The server expands
the template into the full graph. `job:plan`, `job:draft`, `job:apply`, and the
intent skills support only template-backed pipelines. A raw job graph is an
advanced path through `job:create` and `job:update`, where the user defines
every vertex and edge.

```json
{
  "name": "my_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "jobGraph": {
    "vertices": [
      {
        "type": "template-operation",
        "name": "template_operation",
        "templateId": "<log-reducer-template-id>",
        "templateInputs": { "input": "<the template inputs from grepr:build-pipeline>" }
      }
    ],
    "edges": []
  }
}
```

- To create a pipeline, use `grepr:build-pipeline`. It fills the inputs and
  drafts them before `job:create` starts the pipeline.
- To change a pipeline, use an intent skill and `grepr:test-pipeline-change`.
- To read the expanded graph, use `grepr job:get <id> --resolved`. Read sinks
  and datasets there, but never send that graph back as the job graph.

## Pattern 1: Data Lake Query (Synchronous Batch)

Query historical data from the data lake and return results immediately.

**Use case:** Interactive queries, data exploration, debugging

```json
{
  "name": "data_lake_query",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "grepr-raw-log-source",
        "datasetId": "<your-dataset-id>",
        "start": "2024-01-01T00:00:00Z",
        "end": "2024-01-02T00:00:00Z",
        "query": {
          "type": "datadog-query",
          "query": "service:api status:error"
        },
        "limit": 1000,
        "sortOrder": "DESC"
      },
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": ["source -> sink"]
  }
}
```

**Notes:**
- To search or sample logs, prefer `grepr query` (see `grepr:query`) over hand-writing this job
- `grepr-raw-log-source` runs the query on Athena and streams results straight to `logs-sync-sink`
- Use `logs-iceberg-table-source` only when the job has transforms between source and sink.
- Always set a `limit` to avoid expensive queries
- `sortOrder`: `DESC` (newest first), `ASC` (oldest first), `UNSORTED` (fastest)

For GROUP BY, COUNT DISTINCT, or percentiles over a dataset, use
`grepr:sql-analytics`. It builds a batch job with a `sql-operation` vertex.

## Pattern 2: Test Job with Sample Data (LogsValuesSource)

Test operations, such as a grok parser, on inline sample logs.

**Use case:** Testing grok patterns or other operations outside a pipeline. To
test a pipeline change, draft it with `grepr:test-pipeline-change`.

Each value is a full log event. Set `type` to `log`, give each event a unique
`id`, and set `eventTimestamp` and `receivedTimestamp` in epoch milliseconds.

```json
{
  "name": "test_with_samples",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "logs-values-source",
        "values": [
          {
            "type": "log",
            "id": "sample_0",
            "eventTimestamp": 1724214074000,
            "receivedTimestamp": 1724214074000,
            "message": "192.168.1.1 - - [21/Aug/2024:04:21:14 +0000] \"GET /api/health HTTP/1.1\" 200 45",
            "severity": 9,
            "tags": { "service": ["nginx"] }
          },
          {
            "type": "log",
            "id": "sample_1",
            "eventTimestamp": 1724214074000,
            "receivedTimestamp": 1724214074000,
            "message": "ERROR: Connection refused to database",
            "tags": { "service": ["api"] },
            "severity": 17
          }
        ]
      },
      {
        "name": "parser",
        "type": "grok-parser",
        "grokParsingRules": [
          "nginx_log %{ipOrHost:client_ip} %{notSpace} %{notSpace} \\[%{HTTPDATE}\\] \"%{word:method} %{notSpace:path} %{notSpace}\" %{integer:status} %{integer:bytes}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "service:nginx"
        }
      },
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": [
      "source -> parser",
      "parser -> sink"
    ]
  }
}
```

## Best Practices

1. **Use predicates on parsers.** Only parse logs that match the pattern.
2. **Set limits on queries.** Avoid expensive unbounded queries.
3. **Test with LogsValuesSource first.** Check operations on known input before you read live data.
4. **Prefer BATCH for ad-hoc jobs.** A SYNCHRONOUS STREAMING job runs until you stop it. If you need one, add a `logs-event-sampler` so it does not flood the client.
5. **Chain parsers serially.** Multiple grok-parsers with same predicate can be in one parser, different predicates require separate vertices.
