---
description: Troubleshoot failing or misbehaving Grepr pipelines. Use this when pipelines aren't working as expected or the data results are not what's expected.
allowed-tools: Bash(grepr *), grepr:job-commands, grepr:query-logs, grepr:build-grok, grepr:grepr-model
---

# Debugging Grepr Pipelines

This workflow helps troubleshoot pipelines that aren't working as expected.

## Config handling

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## Quick Diagnosis

### Common Symptoms and Likely Causes

| Symptom                         | Likely Cause                                                        | First Check                           |
|---------------------------------|---------------------------------------------------------------------|---------------------------------------|
| Job stuck in PENDING            | Takes 5-19 minutes for a job to start. After, needs support to help | `grepr job:get <id>` for error message |
| Job in FAILED state             | Issue with infrastructure. Contact support@grepr.ai                 |                                       |
| No data in output dataset       | Filter too restrictive, data not coming in from source.             | Check job metrics                     |
| Data present but fields missing | Parsing not matching                                                | Test grok patterns                    |
| Partial data appearing          | Predicate excluding logs                                            | Check filter/branch predicates        |
| High latency/delay              | Backpressure or scaling                                             | Check job metrics                     |
| Incorrect  values               | Misconfiguration of operations                                      | Run test job                          |

## Step 1: Check Job Status

```bash
# Get full job details
grepr job:get <job-id> --format raw
```

**Key fields to check:**

```json
{
  "currentState": "RUNNING",     // Is it actually running?
  "desiredState": "RUNNING",     // Does it want to be running?
  "version": 5                   // Current version number
}
```

### State Interpretation

| Current State | Desired State | Meaning                            |
|---------------|---------------|------------------------------------|
| RUNNING       | RUNNING       | Healthy                            |
| PENDING       | RUNNING       | Starting up or stuck               |
| FAILED        | RUNNING       | Error occurred, check errorMessage |
| STOPPED       | RUNNING       | Reconciliation in progress         |
| RUNNING       | STOPPED       | Shutting down                      |

Let the user know the job status and any error messages.

## Step 2: Check if there's output in the raw data sink

Read the pipeline json and determine if there's an output dataset configured as a raw data sink. This is usually a dataset that captures logs before parsing/enrichment or at the various stages of the pipeline. Pull out the dataset and use the query command to see if any logs are arriving there. Look at data from the last 5 minutes.

```bash
grepr query --dataset-id <raw-sink-dataset-id> --limit 10 --format table --start <time> --end <time>
```

Let the user know what the result of your check is.

## Step 3: Create a Test Job

The Grepr CLI can help you create a test job that has all the transformations, but with sinks replaced with a simple logs-sync-sink. This allows you to see exactly what data is being output at the end of the pipeline as well as at each intermediate step in the graph. Use the command `grepr job:to-test` to create a test job from your existing job. 

For patchable pipeline edits, prefer the `job:plan` / `job:draft` /
`job:apply` safety workflow used by `test-pipeline-change`. Use the
manual `job:to-test` / `job:update` path only when the user explicitly asks
for full-graph manual debugging.

If there's data passing through the pipeline, the simplest test job to run would be one where we run a batch job querying data from the original source and passing through the same operations but outputting to a logs-sync-sink.

```bash
grepr job:get <job-id> --resolved -f raw -o current-<tag>.json
grepr job:to-test current-<tag>.json -o test-job-<tag>.json --execution SYNCHRONOUS --processing BATCH --dataset-id <raw-dataset-id> --query '<source-query if needed>' --start '<start-time>' --end '<end-time>' --limit-records 100
```

Alternatively, you can create a test job that uses a logs-values-source with sample log messages if you can get some representative log lines.

```bash
grepr job:get <job-id> --resolved -f raw -o current-<tag>.json
grepr job:to-test current-<tag>.json -o test-job-<tag>.json --execution SYNCHRONOUS --processing BATCH --sample-data-file sample-logs-<tag>.json
```

The output from each vertex will be also go through a tagging action that tags the data with the original edge information using the `grepr.edge` tag key. For example, if the edge is from vertices `grok-parser` to `reducer`, the tag value will be `grok_parser_output_reducer_input`.

You can then use the `grepr:job-commands` skill to create and run the test job and look at the outputs from each edge.

## Step 4: Test Parsing

If logs appear but fields are missing or wrong:

### Test Grok patterns

```bash
# Get a sample log message from the data
grepr query --dataset-id <dataset> --limit 1 -q --format raw -o parse-sample-<tag>.ndjson
jq -r '.message // .data.message // empty' parse-sample-<tag>.ndjson

# Test the grok pattern
grepr grok:parse \
  --pattern '<your-grok-pattern>' \
  --sample '<log-message>'
```

Use `grepr:build-grok` for iterative pattern development.

### Common parsing issues

| Issue                    | Cause                      | Fix                                    |
|--------------------------|----------------------------|----------------------------------------|
| Pattern doesn't match    | Wrong syntax or escaping   | Test with grok:parse                   |
| Fields in wrong location | Incorrect field path       | Use `tags.field` or `attributes.field` |
| Partial extraction       | Pattern too specific       | Make pattern more flexible             |
| JSON not parsed          | json-log-processor missing | Add json-log-processor before grok     |

## Step 5: Check Operation Order

Pipeline operations execute in edge order. Common ordering issues:

### Correct order

```
source → filter → json-processor → remapper → grok-parser → reducer → sink
```

### Problem patterns

**Grok before JSON processor:**
- Message still contains raw JSON, pattern won't match
- Fix: Add `json-log-processor` before `grok-parser`

**Filter after expensive processing:**
- Wasting resources processing logs that get filtered
- Fix: Move `logs-filter` earlier in the chain

**Remapper before JSON processor:**
- Attributes not yet extracted
- Fix: Run `json-log-processor` first

## Step 6: Create Isolated Test Job

Extract the problematic part of the pipeline and test it:

```json
{
  "name": "debug_isolated_test",
  "execution": "SYNCHRONOUS",
  "processing": "BATCH",
  "jobGraph": {
    "vertices": [
      {
        "name": "source",
        "type": "logs-values-source",
        "values": [
          {
            "message": "<paste actual log message here>",
            "tags": { "service": ["test"] }
          }
        ]
      },
      {
        "name": "problematic_operation",
        "type": "<the operation you're debugging>",
        // ... operation config ...
      },
      {
        "name": "sink",
        "type": "logs-sync-sink"
      }
    ],
    "edges": ["source -> problematic_operation", "problematic_operation -> sink"]
  }
}
```

This isolates the problem and shows exactly what the operation produces.

## Step 7: Validate and Apply Fix

Once you've identified the issue:

### 1. Test the fix with sample data

```bash
grepr job:create fixed-test-<tag>.json
```

### 2. Test with live data (sync streaming)

```bash
grepr job:create fixed-test-live-<tag>.json
```

### 3. Update production pipeline

```bash
grepr job:update <job-id> fixed-production-<tag>.json
```

Use this manual full-graph update only after explicit user approval and
only for a workflow that cannot be expressed as a patch through
`job:plan` / `job:draft` / `job:apply`.

### 4. Verify the fix

```bash
# Check job is running
grepr job:get <job-id>

# Query output after a few minutes
grepr query --dataset-id <output> --limit 10 --format table
```

## Debugging Checklist

- [ ] Job is in RUNNING state (not FAILED or PENDING)
- [ ] No errorMessage in job status
- [ ] Source integration is receiving data
- [ ] Filters aren't excluding all logs
- [ ] Grok patterns match actual log formats
- [ ] Operations are in correct order
- [ ] Edges connect all vertices properly
- [ ] Dataset IDs and integration IDs are valid

## Common Fixes

### Fix 1: Filter predicate too restrictive

```json
// Before (matches nothing)
{ "query": "service:exact-name AND environment:prod" }

// After (more flexible)
{ "query": "service:exact-name" }
```

### Fix 2: Missing JSON processor

```json
// Add before grok-parser
{
  "type": "json-log-processor",
  "name": "json_processor",
  "maxNestedDepthForFields": 3
}
```

### Fix 3: Wrong escaping in grok pattern

```json
// Brackets need double escaping in JSON
"grokParsingRules": [
  "rule \\[%{word:field}\\] %{data:message}"
]
```

### Fix 4: Missing edge in job graph

```json
// Verify all vertices are connected
"edges": [
  "source -> filter",
  "filter -> processor",  // Don't forget this!
  "processor -> sink"
]
```
