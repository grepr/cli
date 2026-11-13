---
description: Troubleshoot failing or misbehaving Grepr pipelines. Use this when pipelines aren't working as expected or the data results are not what's expected.
allowed-tools: Bash(grepr *), grepr:job-commands, grepr:query, grepr:build-grok, grepr:grepr-model, grepr:test-pipeline-change
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
| Incorrect  values               | Misconfiguration of operations                                      | Draft the pipeline                    |

## Step 1: Check Job Status

```bash
# Get full job details
grepr job:get <job-id> -f compact
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
grepr query --dataset-id <raw-sink-dataset-id> --limit 10 -f compact --start <time> --end <time>
```

Let the user know what the result of your check is.

## Step 3: Draft the Pipeline

`grepr job:draft` runs the pipeline in draft mode. The draft builds no production sinks, and each stage tags the records it emits. Draft the live pipeline as-is:

```bash
grepr job:draft --job-id <job-id> --max-duration-seconds 30 -o draft-<tag>.ndjson
```

If little or no traffic arrives, draft against representative log lines instead. The sample format is in `grepr:test-pipeline-change` step 5.

```bash
grepr job:draft --job-id <job-id> --sample-logs sample-logs-<tag>.json --max-duration-seconds 60 -o draft-<tag>.ndjson
```

Records are wrapped under `.data`, and the stage tag is at `.data.tags["sink-source"][]`. Count the records per stage to see where logs drop or change, then read the records of one stage:

```bash
jq -r 'select(.data?) | (.data.tags["sink-source"] // ["untagged"])[]' draft-<tag>.ndjson | sort | uniq -c
jq -c 'select(.data?) | select((.data.tags["sink-source"] // []) | index("<stage-label>")) | .data' draft-<tag>.ndjson | head
```

`job:draft` works only on template-backed pipelines. See the template check in `grepr:describe-pipeline`.

## Step 4: Test Parsing

If logs appear but fields are missing or wrong:

### Test Grok patterns

```bash
# Get a sample log message from the data
grepr query --dataset-id <dataset> --limit 1 -q -f compact -o parse-sample-<tag>.ndjson
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

The template sets the stage order. You cannot change it:

```
sources → pre-parser slot → parsers → pre-warehouse slot → masking ─┬→ raw-logs dataset
                                                                    └→ pre-exceptions slot → exceptions and reducer → sinks
```

The template also sets the parser order: the first JSON processor, the first attribute remapper, the grok parsers, the GeoIP parsers, and then a second remapper if there is one. Only the order of the grok parsers, and of the GeoIP parsers, follows `input.parsers`. `add-parser` appends to the end of that list. To change the order of the grok parsers, set the full list with `set-input-field` on `parsers`, and keep each parser with its `name`.

### Problem patterns

**Filter after expensive processing:**
- The pipeline parses logs that a later filter drops
- Fix: Move the filter to the `pre-parser` phase (`grepr:change-filtering`)

## Step 6: Validate and Apply Fix

Once you've identified the issue, write the fix as a patch with the matching skill (`grepr:tune-grok`, `grepr:change-filtering`, `grepr:tune-reduction`, or another `change-*` skill). Hand the patch to `grepr:test-pipeline-change`. It drafts the fix against sample or live data, gets explicit user approval, and applies it.

### Verify the fix

```bash
# Check job is running
grepr job:get <job-id>

# Query output after a few minutes
grepr query --dataset-id <output> --limit 10 -f compact
```

## Debugging Checklist

- [ ] Job is in RUNNING state (not FAILED or PENDING)
- [ ] No errorMessage in job status
- [ ] Source integration is receiving data
- [ ] Filters aren't excluding all logs
- [ ] Grok patterns match actual log formats
- [ ] Grok parsers are in the intended order
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
