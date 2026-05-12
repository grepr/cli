---
name: grepr-model
description: Core Grepr concepts - log events, jobs, job graphs, execution modes, processing types. Use this to understand Grepr fundamentals without needing docs:search.
trigger_keywords:
  - what is grepr
  - how does grepr work
  - log event
  - event model
  - job model
  - execution mode
  - processing mode
  - pipeline vs job
  - grepr concepts
---

# Grepr Core Concepts

Grepr is a dynamic observability engine that processes log data through jobs. This skill provides foundational knowledge about Grepr's data and processing models.

## Log Event Model

Grepr processes **log events** - individual units of data with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Globally unique event identifier |
| `eventTimestamp` | ISO-8601 | When the event occurred (from source) |
| `receivedTimestamp` | ISO-8601 | When Grepr received the event |
| `message` | string | The log message text (unstructured) |
| `severity` | integer | OpenTelemetry severity level (1-24) |
| `tags` | map<string, set<string>> | Key-value labels for filtering (host, service, etc.) |
| `attributes` | object | Structured data fields (nested JSON) |

### Severity Levels (OpenTelemetry Convention)
- 1-4: TRACE
- 5-8: DEBUG
- 9-12: INFO
- 13-16: WARN
- 17-20: ERROR
- 21-24: FATAL

### Example Log Event
```json
{
  "id": "0H19GZK97FTKS",
  "eventTimestamp": "2024-08-21T04:21:14.062Z",
  "receivedTimestamp": "2024-08-21T04:21:14.188Z",
  "severity": 9,
  "message": "State backend is set to heap memory",
  "tags": {
    "service": ["payment-processor"],
    "host": ["ip-10-0-1-100.ec2.internal"],
    "environment": ["production"]
  },
  "attributes": {
    "process": {
      "thread": { "name": "thread-0" }
    },
    "http": {
      "method": "GET",
      "status_code": 200
    }
  }
}
```

### Tags vs Attributes
- **Tags**: Flat key-value pairs for fast filtering and routing. Common tags: `host`, `service`, `environment`, `source`
- **Attributes**: Nested structured data for detailed information. Can be deeply nested JSON objects.

## Grepr Job Model

All processing in Grepr happens through **jobs**. A job defines:

1. **Name**: Human-readable identifier
2. **Execution Mode**: How results are delivered
3. **Processing Type**: How data flows through the job
4. **Job Graph**: The data processing DAG (directed acyclic graph)
5. **Desired State**: What state the job should be in
6. **Current State**: What state the job is actually in

### Execution Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `SYNCHRONOUS` | Results stream back to caller immediately via HTTP | Interactive queries, testing pipelines |
| `ASYNCHRONOUS` | Job runs in background, results go to configured sinks | Production pipelines, backfills |

### Processing Types

| Type | Description | Use Case |
|------|-------------|----------|
| `BATCH` | Bounded data, job completes when all data is processed | Queries on historical data, backfills |
| `STREAMING` | Continuous data flow, runs until explicitly stopped | Production pipelines, real-time processing |

### Common Job Type Combinations

| Name | Execution | Processing | Description |
|------|-----------|------------|-------------|
| **Query** | SYNCHRONOUS | BATCH | Query data lake, return results immediately |
| **Pipeline** | ASYNCHRONOUS | STREAMING | Continuous log processing in production |
| **Test Pipeline** | SYNCHRONOUS | STREAMING | Test pipeline with live data (rate-limited) |
| **Backfill** | ASYNCHRONOUS | BATCH | Reprocess historical data to a sink |

## Job Graph Structure

A job graph is a **directed acyclic graph (DAG)** consisting of:
- **Vertices**: Operations (sources, transforms, sinks)
- **Edges**: Data flow connections between vertices

### Vertex Types

| Category | Description | Examples |
|----------|-------------|----------|
| **Sources** | Data input (0 inputs, 1+ outputs) | `datadog-log-agent-source`, `logs-iceberg-table-source` |
| **Transforms** | Data processing (1+ inputs, 1+ outputs) | `grok-parser`, `logs-filter`, `log-reducer` |
| **Sinks** | Data output (1+ inputs, 0 outputs) | `logs-iceberg-table-sink`, `datadog-log-sink` |

### Edge Format

Edges are strings in the format `"source_vertex -> destination_vertex"`:

```json
{
  "edges": [
    "source -> filter",              // Simple edge
    "filter -> parser",              // Chain operations
    "branch -> special_handler",     // Default output from branch
    "branch:else -> default_handler", // Named output (else branch)
    "parser -> sink1",               // Fan-out: one source to multiple destinations
    "parser -> sink2"
  ]
}
```

### Named Outputs
Some operations have multiple named outputs:
- `logs-branch`: `default` (matches predicate) and `else` (doesn't match)
- Use `:output_name` suffix to specify which output to connect

## Job Lifecycle States

| State | Description |
|-------|-------------|
| `PENDING` | Job accepted, waiting to start |
| `STARTING` | Job transitioning to running state |
| `RUNNING` | Job actively processing data |
| `STOPPING` | Job transitioning to stopped state |
| `STOPPED` | Job stopped (can be restarted) |
| `FINISHED` | Job completed successfully (batch jobs only) |
| `FAILED` | Job encountered an error |
| `CANCELLED` | Job was cancelled by user |
| `DELETED` | Job removed from system |

### Desired vs Current State
- **Desired State**: What you want the job to be (set via API/CLI)
- **Current State**: What the job actually is
- Grepr continuously reconciles current state toward desired state

## Autoscaling

- **Streaming jobs**: Automatically scale up/down based on data volume
- **Batch jobs**: Automatically parallelize for optimal throughput
- Scale events may cause brief processing delays (typically <5 minutes)

## Key Terminology

| Term | Definition |
|------|------------|
| **Job** | A complete data processing definition (graph + config) |
| **Pipeline** | Common name for an async streaming job |
| **Query** | Common name for a sync batch job |
| **Operation** | A vertex in the job graph (source, transform, or sink) |
| **Integration** | Configuration for external systems (vendors, storage) |
| **Dataset** | An Iceberg table in the data lake |
