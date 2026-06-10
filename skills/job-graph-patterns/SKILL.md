---
description: Common job graph patterns and examples for building Grepr pipelines. Use this when you need to create or modify job configurations.
---

# Job Graph Patterns

This skill provides common patterns for building Grepr job graphs. Use these as templates when creating new jobs or modifying existing ones.

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
        "type": "logs-iceberg-table-source",
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
- Use `logs-iceberg-table-source` for Flink-based queries (supports transforms)
- Use `grepr-raw-log-source` for Athena-based queries (faster, but only outputs to `logs-sync-sink`)
- Always set a `limit` to avoid expensive queries
- `sortOrder`: `DESC` (newest first), `ASC` (oldest first), `UNSORTED` (fastest)

## Pattern 2: Production Pipeline (Asynchronous Streaming)

Continuous log processing with parsing, enrichment, and reduction.

**Use case:** Production log processing, cost optimization

```json
{
  "name": "production_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "datadog-log-agent-source",
        "integrationId": "<datadog-integration-id>"
      },
      {
        "name": "filter",
        "type": "logs-filter",
        "predicate": {
          "type": "datadog-query",
          "query": "-status:debug"
        }
      },
      {
        "name": "json_processor",
        "type": "json-log-processor",
        "maxNestedDepthForFields": 3
      },
      {
        "name": "remapper",
        "type": "log-attributes-remapper"
      },
      {
        "name": "reducer",
        "type": "log-reducer",
        "similarityThreshold": 80.0,
        "partitionByTags": ["service"],
        "reductionTimeWindow": "PT120S"
      },
      {
        "name": "data_lake",
        "type": "logs-iceberg-table-sink",
        "datasetId": "<processed-logs-dataset-id>"
      },
      {
        "name": "vendor",
        "type": "datadog-log-sink",
        "integrationId": "<datadog-integration-id>"
      }
    ],
    "edges": [
      "source -> filter",
      "filter -> json_processor",
      "json_processor -> remapper",
      "remapper -> reducer",
      "reducer -> data_lake",
      "reducer -> vendor"
    ]
  }
}
```

**Common pipeline structure:**
```
source → filter → json-processor → remapper → [custom parsing] → reducer → sinks
```

## Pattern 3: Test Pipeline (Synchronous Streaming)

Test a streaming pipeline with rate-limited live data.

**Use case:** Testing pipeline changes before production deployment

```json
{
  "name": "test_pipeline",
  "execution": "SYNCHRONOUS",
  "processing": "STREAMING",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "datadog-log-agent-source",
        "integrationId": "<integration-id>"
      },
      {
        "name": "sampler",
        "type": "logs-event-sampler",
        "maxAllowedRate": 10.0,
        "maxBurstLimit": 100,
        "filter": {
          "type": "datadog-query",
          "query": "service:my-service"
        }
      },
      {
        "name": "transform",
        "type": "json-log-processor"
      },
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": [
      "source -> sampler",
      "sampler -> transform",
      "transform -> sink"
    ]
  }
}
```

**Important:** Always include `logs-event-sampler` in sync streaming jobs to:
- Limit data rate to avoid overwhelming the client
- Filter to relevant logs for focused testing

## Pattern 4: Branching Pipeline

Route logs to different processing paths based on conditions.

**Use case:** Different parsing for different log types, routing to different destinations

```json
{
  "name": "branching_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "datadog-log-agent-source",
        "integrationId": "<integration-id>"
      },
      {
        "name": "branch_nginx",
        "type": "logs-branch",
        "predicate": {
          "type": "datadog-query",
          "query": "source:nginx"
        }
      },
      {
        "name": "nginx_parser",
        "type": "grok-parser",
        "grokParsingRules": [
          "nginx_access %{ipOrHost:client_ip} - - \\[%{HTTPDATE}\\] \"%{word:method} %{notSpace:path} %{notSpace}\" %{integer:status}"
        ]
      },
      {
        "name": "default_processor",
        "type": "json-log-processor"
      },
      {
        "name": "sink",
        "type": "logs-iceberg-table-sink",
        "datasetId": "<dataset-id>"
      }
    ],
    "edges": [
      "source -> branch_nginx",
      "branch_nginx -> nginx_parser",
      "branch_nginx:else -> default_processor",
      "nginx_parser -> sink",
      "default_processor -> sink"
    ]
  }
}
```

**Edge naming:**
- `branch -> handler` - Default output (matches predicate)
- `branch:else -> handler` - Else output (doesn't match predicate)

## Pattern 5: Multi-Source Pipeline

Process logs from multiple sources through a shared pipeline.

**Use case:** Consolidating logs from different vendors

```json
{
  "name": "multi_source_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "jobGraph": {
    "vertices": [
      {
        "name": "datadog_source",
        "type": "datadog-log-agent-source",
        "integrationId": "<datadog-integration>"
      },
      {
        "name": "splunk_source",
        "type": "splunk-log-agent-source",
        "integrationId": "<splunk-integration>"
      },
      {
        "name": "processor",
        "type": "json-log-processor"
      },
      {
        "name": "sink",
        "type": "logs-iceberg-table-sink",
        "datasetId": "<consolidated-dataset>"
      }
    ],
    "edges": [
      "datadog_source -> processor",
      "splunk_source -> processor",
      "processor -> sink"
    ]
  }
}
```

## Pattern 6: Test Job with Sample Data (LogsValuesSource)

Test job transformations with inline sample data.

**Use case:** Testing grok patterns, validating job configuration before deployment

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
            "message": "192.168.1.1 - - [21/Aug/2024:04:21:14 +0000] \"GET /api/health HTTP/1.1\" 200 45",
            "tags": { "service": ["nginx"] }
          },
          {
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

## Pattern 7: Multi-Destination Pipeline

Send processed logs to multiple destinations.

**Use case:** Archive to data lake while forwarding to vendor

```json
{
  "jobGraph": {
    "vertices": [
      { "name": "source", "type": "datadog-log-agent-source", "integrationId": "..." },
      { "name": "processor", "type": "json-log-processor" },
      { "name": "reducer", "type": "log-reducer", "similarityThreshold": 80.0 },
      { "name": "archive", "type": "logs-iceberg-table-sink", "datasetId": "..." },
      { "name": "forward", "type": "datadog-log-sink", "integrationId": "..." }
    ],
    "edges": [
      "source -> processor",
      "processor -> reducer",
      "reducer -> archive",
      "reducer -> forward"
    ]
  }
}
```

## Best Practices

1. **Always filter early** - Remove unwanted logs before expensive processing
2. **Use predicates on parsers** - Only parse logs that match the pattern
3. **Include sampler in sync streaming** - Prevent overwhelming the client
4. **Set limits on queries** - Avoid expensive unbounded queries
5. **Test with LogsValuesSource first** - Validate configuration before live data
6. **Chain parsers serially** - Multiple grok-parsers with same predicate can be in one parser, different predicates require separate vertices.
