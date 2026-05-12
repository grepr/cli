---
description: Step-by-step guide to build a new Grepr pipeline from scratch. Use this when creating new pipelines or significantly modifying existing ones.
allowed-tools: Bash(grepr *), grepr:job-commands, grepr:dataset-commands, grepr:integration-commands, grepr:job-graph-patterns, grepr:operations-reference, grepr:grepr-model
trigger_keywords:
  - build a pipeline
  - create a pipeline
  - new pipeline
  - set up pipeline
  - make a pipeline
  - design pipeline
---

# Building a Grepr Pipeline

This workflow guides you through creating a Grepr pipeline from requirements to production deployment.

## Workflow Overview

1. **Gather requirements** - Understand data source, processing needs, destinations
2. **Check existing resources** - Datasets, integrations, reference pipelines
3. **Design job graph** - Select operations, define data flow
4. **Test with sample data** - Validate with LogsValuesSource
5. **Test with live data** - Use sync streaming with sampler
6. **Deploy to production** - Create async streaming job
7. **Validate in production** - Query output dataset

## Step 1: Gather Requirements

Ask the user these questions:

### Data Source
- What is the data source? (Datadog, Splunk, OTEL, etc.)
- Is there an existing integration configured?
- What services/hosts should be included?

### Processing Needs
- Does the data need parsing? (Grok patterns for unstructured logs)
- Are there JSON logs that need field extraction?
- Should logs be filtered? (Remove debug, exclude certain services)
- Should logs be reduced/deduplicated? (Cost optimization)

### Destinations
- Where should processed data go?
  - Data lake only (archival, querying)
  - Vendor only (forward to observability platform)
  - Both (archive + forward)

### Special Requirements
- Any specific log formats to parse? → Use `grepr:build-grok`
- Need to route different logs differently? → Use branching pattern
- Multiple sources to consolidate? → Use multi-source pattern

## Step 2: Check Existing Resources

```bash
# List available integrations
grepr integration:list --format table

# List existing datasets (for sink or reference)
grepr dataset:list --format table

# List existing pipelines for reference patterns
grepr job:list --processing STREAMING --format table

# Get an existing pipeline config as reference
grepr job:get <job-id> --format raw
```

**Key information to gather:**
- Integration IDs for sources and sinks
- Dataset IDs for data lake sinks
- Patterns from existing pipelines

## Step 3: Design Job Graph

Use `grepr:job-graph-patterns` to select the appropriate pattern.

### Common Pipeline Structure

```
source → filter → json-processor → remapper → [custom parsing] → reducer → sinks
```

### Selecting Operations

**Source** (use `grepr:operations-reference`):
- `datadog-log-agent-source` for Datadog
- `splunk-log-agent-source` for Splunk
- `otel-log-source` for OpenTelemetry

**Processing chain:**
1. `logs-filter` - Remove unwanted logs early
2. `json-log-processor` - Parse JSON in message field
3. `log-attributes-remapper` - Standardize field locations
4. `grok-parser` - Parse unstructured logs (if needed)
5. `log-reducer` - Deduplicate similar logs (if cost optimization needed)

**Sinks:**
- `logs-iceberg-table-sink` for data lake
- `datadog-log-sink`, `splunk-log-sink`, etc. for vendors

### Building the Job JSON

Create a job definition file:

```json
{
  "name": "my_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      // Add vertices here
    ],
    "edges": [
      // Add edges here
    ]
  },
  "tags": {
    "team": "my-team",
    "environment": "production"
  }
}
```

## Step 4: Test with Sample Data

Before using live data, test with inline samples using `logs-values-source`:

```json
{
  "name": "test_pipeline_samples",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "logs-values-source",
        "values": [
          {
            "message": "Sample log message matching expected format",
            "tags": { "service": ["test-service"] },
            "severity": 9
          }
        ]
      },
      // ... rest of your pipeline transforms ...
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": [
      // ... your edges, ending at logs-sync-sink ...
    ]
  }
}
```

```bash
# Create and run the test job
grepr job:create -f test-pipeline-samples.json
```

**Validate:**
- Are logs being parsed correctly?
- Are fields extracted to the right locations?
- Are filters working as expected?

## Step 5: Test with Live Data

Once sample data works, test with live streaming data (rate-limited):

```json
{
  "name": "test_pipeline_live",
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
        "maxAllowedRate": 5.0,
        "maxBurstLimit": 50,
        "filter": {
          "type": "datadog-query",
          "query": "service:target-service"
        }
      },
      // ... rest of your pipeline transforms ...
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": [
      "source -> sampler",
      // ... rest ending at logs-sync-sink ...
    ]
  }
}
```

```bash
# Run live test (will stream results until cancelled)
grepr job:create -f test-pipeline-live.json
# Press Ctrl+C to stop
```

**Validate with real data:**
- Check a variety of log formats
- Verify edge cases are handled
- Confirm no unexpected errors

## Step 6: Deploy to Production

Convert to production configuration:

1. Change `execution` to `ASYNCHRONOUS`
2. Remove `logs-event-sampler`
3. Replace `logs-sync-sink` with actual sinks
4. Add `desiredState: "RUNNING"`

```json
{
  "name": "production_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      // ... production vertices with real sinks ...
    ],
    "edges": [
      // ... production edges ...
    ]
  },
  "tags": {
    "environment": "production"
  }
}
```

```bash
# Create the production pipeline
grepr job:create -f production-pipeline.json

# Verify it started
grepr job:list --state RUNNING --format table
```

## Step 7: Validate in Production

After a few minutes, verify data is flowing:

```bash
# Check job status
grepr job:get <job-id> --format table

# Query the output dataset
grepr query --dataset-id <output-dataset-id> --limit 10 --format table

# Check for expected fields
grepr query --dataset-id <output-dataset-id> --query "service:target-service" --limit 5 --format raw
```

**Validation checklist:**
- [ ] Job is in RUNNING state
- [ ] Data appearing in output dataset
- [ ] Fields are correctly parsed
- [ ] Reduction working as expected (if enabled)

## Troubleshooting

### Job FAILED
- Contact Grepr support at support@grepr.ai with the job ID.

### No data in output
- Verify filter predicates aren't too restrictive
- Check source integration is receiving data
- Query raw data first to confirm data exists

### Parsing not working
- Use `grepr:build-grok` to test patterns
- Check predicate is matching target logs
- Verify pattern escaping in JSON

## Quick Reference

| Phase | Execution | Processing | Sink |
|-------|-----------|------------|------|
| Sample test | SYNCHRONOUS | BATCH | logs-sync-sink |
| Live test | SYNCHRONOUS | STREAMING | logs-sync-sink + sampler |
| Production | ASYNCHRONOUS | STREAMING | real sinks |
