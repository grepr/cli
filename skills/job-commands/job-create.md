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
Create a new Grepr pipeline (job) from a JSON configuration file. Remember that any data processing
in Grepr is a job, and they can be synchronous/asynchronous and streaming/batch.

## Notes
- Review the Job documentation (`grepr docs:search "grepr job model"`) if needed. As a summary:
  - A SYNCHRONOUS job requires a `SynchronousSink` and returns results immediately.
  - An ASYNCHRONOUS job requires an asynchronous sink and runs in the background.
  - A STREAMING job processes data in real-time as it arrives and continues running indefinitely.
  - A BATCH job processes a finite dataset and completes once done.
- Use SYNCHRONOUS BATCH jobs for quick data lookups or transformations or test settings for jobs.
- Use ASYNCHRONOUS STREAMING jobs for continuous data processing pipelines.
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
If you want to debug a job configuration, we recommend using a `ValuesSource` operation with your pipeline configuration. Use a `LogTransformAction` operation with a `TagAction` attached to the sink to tag the output from each stage and emit
a copy of the data at each step. This way you can inspect the output at each stage of your pipeline.

### Testing ASYNCHRONOUS STREAMING jobs before deploying to production

## Testing Updated Job Configuration for Async Streaming Jobs
1. Assuming you have a job configuration, you will need to create a temporary job to test it.
2. Create a new file with a copy of the job configuration, but change the `name` field to something unique (e.g. append `_test` to the name).
3. You will need two datasets for testing that will act as our sinks. You might need to create these datasets using [dataset:create](dataset-create.md) if they don't already exist:
  - A raw data sink dataset to capture the raw log data after parsing/enrichment (usually `test_dataset_raw`).
  - A processed data sink dataset to capture the final output after all transformations. (usually `test_dataset_processed`).
4. Update the job configuration to use these test datasets as sinks. You can find the sink operations in the `jobGraph`. Replace the vendor sinks (newrelic, datadog, etc.) with the processed data sink dataset, and replace the real raw data sink with the test raw data sink dataset. Also add a `LogTransformAction` operation before each sink with a `TagAction` to tag the data before it goes into either sinks so you can search for those tags when querying the datasets.
5. Validate the JSON for the new job with the user to ensure it looks correct and it won't impact production data.
6. Create the temporary job using [job:create](job-create.md) with the modified configuration.
7. It'll take a few minutes for the pipeline to start and for data to start flowing through. You can monitor the job status using `grepr job:get <temp_job_id> --quiet` and checking the status field.
8. Once the job is running, you can query the test datasets using [query](query.md) to validate that the data is being processed as expected.
9. After validation, delete the temporary job using [job:delete](job-delete.md). Ask the user if they want to keep the test datasets for reuse later or delete them as well.
10. If everything looks good, you can proceed to update the original job with the updated configuration after confirming with the user.
11. Remember to monitor the updated job after deployment to ensure it's functioning correctly. Query the relevant datasets to validate data flow and correctness.
12. Note that you can also use a `LogsValuesSource` operation with sample log messages to test the job instead of reading from real data. This could be simpler for testing specific transformations and would be less resource-intensive. See if you can go this route with the user.

## Testing BATCH jobs before deploying to production
1. Testing batch jobs is simpler since they run to completion and its easier to route their outputs to a synchronous sink for immediate inspection.
2. If you're running a batch job, use limits on the sources to restrict the amount of data processed for testing. Alternatievly, use a `LogsValuesSource` operation with sample log messages to test the job.
3. Route the output to a `LogsSyncSink` operation so you can get immediate results.
4. Otherwise, follow similar steps as above for ASYNCHRONOUS STREAMING jobs to create test datasets and route outputs there for inspection. No need to delete the job after testing since batch jobs complete on their own.

## Examples

```bash
# Create job from file
grepr job:create -f pipeline.json

# Create job with custom name
grepr job:create -f pipeline.json --name "Production Log Pipeline"
```

## Configuration Format
See existing jobs via `grepr job:get <id>` for example configurations.

## Example jobs

In the examples below, // indicates a comment and is not part of the actual JSON.

### Complete log reduction pipeline

This pipeline demonstrates a full reduction flow over NGINX access logs from a `web-api` service, fanning out to a data lake dataset, a pattern lookup dataset, and the original Datadog destination.

```json
{
  "name": "webapp_log_reduction_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      {
        "type": "datadog-log-agent-source",
        "name": "source_datadog_integration",
        // List integrations and their IDs using `grepr integration:list`
        "integrationId": "<datadog-integration-id>"
      },
      {
        "type": "logs-filter",
        "name": "pre_parser_filter",
        "predicate": {
          "type": "datadog-query",
          "query": ""
        }
      },
      {
        "type": "json-log-processor",
        "name": "json_log_processor"
      },
      {
        "type": "log-attributes-remapper",
        "name": "log_attributes_remapper"
      },
      {
        "type": "grok-parser",
        "name": "grok_parser_0",
        // Applies this rule only to logs from the "web-api" service
        "grokParsingRules": [
          "AccessLogMetrics %{ipOrHost:client_ip} %{notSpace} %{notSpace} \\[%{HTTPDATE}\\] \"%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}\" %{integer:status_code} %{integer:response_bytes} \"%{regex(\"[^\"]*\"):referrer}\" \"%{regex(\"[^\"]*\"):user_agent}\" %{integer:response_time_ms}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "service:web-api"
        },
        "grokHelperRules": []
      },
      {
        "type": "grok-parser",
        "name": "grok_parser_1",
        // Applies to upstream-proxy log lines emitted by the CDN tier
        "grokParsingRules": [
          "UpstreamLogRule %{ipOrHost:client_ip} - %{notSpace:upstream_user} \\[%{HTTPDATE}\\] \"%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}\" %{integer:status_code} %{integer:response_bytes} %{notSpace:cache_status} %{number:upstream_response_time}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "service:cdn-edge"
        },
        "grokHelperRules": []
      },
      {
        "type": "logs-filter",
        "name": "pre_data_warehouse_filter",
        "predicate": {
          "type": "datadog-query",
          "query": ""
        },
        // Data later than 48H is dropped
        "maxLateEventTimestampDelta": "PT48H"
      },
      {
        "type": "logs-iceberg-table-sink",
        "name": "raw_data_sink",
        "datasetId": "<raw-dataset-id>"
      },
      {
        "type": "logs-filter",
        "name": "pre_exceptions_filter",
        "predicate": {
          "type": "datadog-query",
          "query": ""
        }
      },
      {
        "type": "log-reducer",
        "name": "log_reducer",
        // Logs matching these queries will be excluded from reduction
        "logReducerExceptions": [
          {
            "type": "datadog-query",
            "query": "status_code:>=400 OR cache_status:MISS"
          }
        ],
        // Don't aggregate logs with different values for these tags together
        "partitionByTags": [
          "service",
          "org_name",
          "integration_id"
        ],
        // Don't aggregate logs with different values for these attributes together
        "partitionByAttributes": [
          "greprMeta",
          "request_path",
          "http_method",
          "status_code"
        ],
        // If attribute paths have "." use this to partition by them
        "partitionByAttributePaths": [["request.path"]],
        // How similar messages need to be to be grouped together
        "similarityThreshold": 70,
        "reductionTimeWindow": "PT2M",
        "dedupThreshold": 4
      },
      {
        "type": "pattern-lookup-iceberg-table-sink",
        "name": "pattern_data_sink",
        "datasetId": "<pattern-dataset-id>"
      },
      {
        "type": "logs-filter",
        "name": "sink_datadog_integration_filter",
        "predicate": {
          "type": "datadog-query",
          "query": ""
        },
        "inverted": false
      },
      {
        "type": "event-dedup-iceberg-table-sink",
        "name": "event_data_sink_datadog",
        "datasetId": "<event-dataset-id>",
        "vendorSinkId": "<datadog-integration-id>"
      },
      {
        "type": "datadog-log-sink",
        "name": "sink_datadog_integration",
        "integrationId": "<datadog-integration-id>",
        "additionalTags": [
          "processor:grepr",
          "pipeline:webapp_log_reduction_pipeline"
        ],
        "browserLogGroupByAttributes": [
          "network.client.ip",
          "http.useragent"
        ]
      }
    ],
    "edges": [
      "source_datadog_integration -> pre_parser_filter",
      "pre_parser_filter -> json_log_processor",
      "json_log_processor -> log_attributes_remapper",
      "log_attributes_remapper -> grok_parser_0",
      "grok_parser_0 -> grok_parser_1",
      "grok_parser_1 -> pre_data_warehouse_filter",
      "pre_data_warehouse_filter -> raw_data_sink",
      "pre_data_warehouse_filter -> pre_exceptions_filter",
      "pre_exceptions_filter -> log_reducer",
      "log_reducer -> pattern_data_sink",
      "log_reducer -> sink_datadog_integration_filter",
      "sink_datadog_integration_filter -> event_data_sink_datadog",
      "sink_datadog_integration_filter -> sink_datadog_integration"
    ]
  },
  "tags": {
    "environment": "production"
  }
}
```

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
          "type": "logs-iceberg-table-source",
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
        "logs": [
          {
            "id": "1",
            "message": "2024-01-01 12:00:00 INFO User login successful user_id=12345",
            "eventTimestamp": "2024-01-01T12:00:00Z",
            "receivedTimestamp": "2024-01-01T12:00:01Z",
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
            "id": "2",
            "message": "2024-01-01 12:05:00 ERROR Database connection failed error_code=5001",
            "eventTimestamp": "2024-01-01T12:05:00Z",
            "receivedTimestamp": "2024-01-01T12:05:01Z",
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
