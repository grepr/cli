# grepr job:create

## Command Help
!`grepr job:create --help`

## Create API object
!`grepr docs:get schema://CreateJob | sed 's/^#/###/'`

## Sync endpoint docs
!`grepr docs:get api://api/Jobs/submitSyncJob | sed 's/^#/###/'`

## Async endpoint docs
!`grepr docs:get api://api/Jobs/submitAsyncJob | sed 's/^#/###/'`

## When to Use
Create a new Grepr job from a JSON configuration file. Remember that any data processing
in Grepr is a job, and they can be synchronous/asynchronous and streaming/batch.

To create a pipeline, follow `grepr:build-pipeline`. A pipeline job graph is one
`template-operation` vertex, and `job:create` starts the pipeline at once. The patterns
below are for ad-hoc jobs, such as queries and test jobs.

## Notes
- Use `grepr:grepr-model` and `grepr:operations-reference` for job model
  and operation details. Do not block on `docs:search`; some environments
  do not have the semantic docs index loaded. As a summary:
  - A SYNCHRONOUS job requires a `SynchronousSink` and returns results immediately.
  - An ASYNCHRONOUS job requires an asynchronous sink and runs in the background.
  - A STREAMING job processes data in real-time as it arrives and continues running indefinitely.
  - A BATCH job processes a finite dataset and completes once done.
- Use SYNCHRONOUS BATCH jobs for quick data lookups or transformations or test settings for jobs.
- A pipeline is an ASYNCHRONOUS STREAMING job built from a template. See `grepr:build-pipeline`.
- Use ASYNCHRONOUS BATCH jobs for large data processing tasks that can run in the background and for
  loading and transforming data between datasets.
- You can review the different types of operations available in Grepr via `grepr docs:get schema://Operation`.
- Edges are of format `<sourceName>:<outputName> -> <targetName>:<inputName>`. Output and input names
  depend on the specific operation types used, but if an operation has only one input or output you
  can omit the names.
- Operation names are unique and must be alphanumeric with underscores.
- Always confirm with a user the JSON you're about to execute before executing to avoid running expensive unintended jobs.
- Avoid rerunning synchronous jobs multiple times since they can be slow and expensive. Instead, output results to a file
  for further analysis.
- Don't be phased by the complexity of testing. Testing is very important to ensure that jobs work as expected before deploying to production.
- Change the job graph step by step using `jq` as needed when creating a job or modifying an existing job. Check the result of your jq commands after each step to make sure it's going as expected. Use a new file for each step to avoid mistakes and be able to retry until success.

### Notes on reading data from the data lake
There are two ways to read data from the data lake:
- Use a `LogsIcebergTableSource` (see `grepr docs:get schema://LogsIcebergTableSource`) operation to read raw log data using Flink
  when you want to follow it up with transformations or if you want to output the results
  to another dataset.
- Use a `GreprRawLogsSource` (see `grepr docs:get schema://GreprRawLogsSource`) operation to read raw log data using a SYNCHRONOUS job.

### Be careful with SYNCHRONOUS STREAMING jobs
If your run a SYNCHRONOUS STREAMING job without sampling, you might overwhelm your client. Use a `LogsEventSampler` operation to minimize the number of logs returned.

### Debugging tips
To debug an ad-hoc job, use a `ValuesSource` operation with known input. Use a `LogTransformAction` operation with a `TagAction` attached to the sink to tag the output from each stage and emit
a copy of the data at each step. This way you can inspect the output at each stage of the job.

To debug a pipeline, draft it. The draft tags the output of each stage. See `grepr:test-pipeline-change`.

## Testing BATCH jobs before deploying to production
1. Testing batch jobs is simpler since they run to completion and its easier to route their outputs to a synchronous sink for immediate inspection.
2. If you're running a batch job, use limits on the sources to restrict the amount of data processed for testing. Alternatievly, use a `LogsValuesSource` operation with sample log messages to test the job.
3. Route the output to a `LogsSyncSink` operation so you can get immediate results.
4. Otherwise, write the output to a test dataset with a `logs-iceberg-table-sink` and query it with `grepr:query`. You do not need to delete the job after the test, because a batch job ends on its own.

## Examples

```bash
# Create job from a JSON file (positional argument, not -f)
grepr job:create pipeline.json
```

The job name lives in the JSON file (`name` field). To change it, edit the file
before submitting — there's no `--name` flag on `job:create`.

## Configuration Format
See existing jobs via `grepr job:get <id>` for example configurations. If the user selected a non-default config, reuse that concrete `--conf <name>` value.

## Example jobs

### Simple Synchronous Batch Job

This job reads logs from the data lake and outputs the results immediately.

```json
{
    "name": "simple_sync_batch_job",
    "execution": "SYNCHRONOUS",
    "processing": "BATCH",
    "jobGraph": {
      "vertices": [
        {
          "type": "grepr-raw-log-source",
          "name": "source_data_lake",
          "datasetId": "<dataset-id>",
          "start": "2025-01-01T00:00:00Z",
          "end": "2025-01-02T00:00:00Z",
          "query": {
            "type": "datadog-query",
            "query": "service:my-service"
          }
        },
        {
          "type": "logs-sync-sink",
          "name": "synchronous_sink"
        }
      ],
      "edges": [
        "source_data_lake -> synchronous_sink"
      ]
    }
}
```

### A job that uses a source with prespecified data

Use `LogsValuesSource` to create a job that processes a small set of log messages defined within the job itself.
Each value is a full log event. Set `type` to `log`, and set `eventTimestamp` and `receivedTimestamp` in epoch milliseconds.

```json
{
  "name": "values_source_job",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      {
        "type": "logs-values-source",
        "name": "values_source",
        "values": [
          {
            "type": "log",
            "id": "1",
            "message": "2024-01-01 12:00:00 INFO User login successful user_id=12345",
            "eventTimestamp": 1704110400000,
            "receivedTimestamp": 1704110401000,
            "severity": 9,
            "attributes": {
              "timestamp": "2024-01-01T12:00:00Z",
              "service": "auth-service"
            },
            "tags": {
              "env": ["prod"],
              "team": ["authentication"]
            }
          },
          {
            "type": "log",
            "id": "2",
            "message": "2024-01-01 12:05:00 ERROR Database connection failed error_code=5001",
            "eventTimestamp": 1704110700000,
            "receivedTimestamp": 1704110701000,
            "severity": 11,
            "attributes": {
              "timestamp": "2024-01-01T12:05:00Z",
              "service": "db-service"
            },
            "tags": {
              "env": ["prod"],
              "team": ["database", "applications"]
            }
          }
        ]
      },
      {
        "type": "grok-parser",
        "name": "grok_parser",
        "grokParsingRules": [
          "rule1 %{TIMESTAMP_ISO8601:log_timestamp} %{LOGLEVEL:log_level} %{GREEDYDATA:log_message} user_id=%{NUMBER:user_id}",
          "rule2 %{TIMESTAMP_ISO8601:log_timestamp} %{LOGLEVEL:log_level} %{GREEDYDATA:log_message} error_code=%{NUMBER:error_code}"
        ],
        "grokHelperRules": []
      },
      {
        "type": "logs-sync-sink",
        "name": "synchronous_sink"
      }
    ],
    "edges": [
      "values_source -> grok_parser",
      "grok_parser -> synchronous_sink"
    ]
  }
}
```
