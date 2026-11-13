---
description: Build a new Grepr log pipeline from requirements. Writes the inputs of the built-in log-reducer template, drafts them against sample logs with no side effects, and creates the pipeline after the user approves. Use when the user wants a new log pipeline. To change an existing pipeline, use an intent skill (grepr:tune-*, grepr:change-*, grepr:build-grok, grepr:build-sql-transform).
allowed-tools: Bash(grepr *), Bash(jq *), grepr:cli, grepr:api, grepr:job-commands, grepr:dataset-commands, grepr:integration-commands, grepr:query, grepr:operations-reference, grepr:grepr-model, grepr:test-pipeline-change
---

# Build a log pipeline

A log pipeline is an `ASYNCHRONOUS` `STREAMING` job whose graph is one
`template-operation` vertex. The vertex names the built-in
`log-reducer-job-graph-template` and holds the pipeline settings in
`templateInputs.input`. The server expands the template into the full graph.
The template gives guardrails, and the CLI edit workflow and the intent skills
work only on template-backed pipelines. Do not write the expanded graph
yourself.

Resolve the org config once and reuse it on every command. See `grepr:cli`.

```
Build progress:
- [ ] 1. Gather requirements
- [ ] 2. Look up the template, integrations, and dataset
- [ ] 3. Write the pipeline file
- [ ] 4. Draft the pipeline file against sample logs
- [ ] 5. Create the pipeline after the user approves
- [ ] 6. Check the running pipeline
```

## 1. Gather requirements

Ask the user for what you cannot look up:

- The agent or protocol that sends the logs, such as Datadog, Splunk, or OTLP.
- Whether logs go to a raw-logs dataset in the data lake, to vendor sinks, or
  to both.
- A pipeline name of lowercase letters, digits, and underscores that is unique
  in the org.
- Sample logs, as example lines from the user or as a dataset that already
  stores logs from this source.

The first version holds the source, the default parsers and reducer, and the
outputs. Add grok parsing, filters, exceptions, masking, and SQL transforms
after creation with the intent skills. Each intent skill drafts its change
before it applies it. If those changes must be live before any log reaches a
vendor, create the pipeline without `sinks`, make the changes, and then add the
vendor sink with `grepr:change-sink`.

## 2. Look up the template, integrations, and dataset

```bash
grepr api v1/templates |
  jq -c '.items[] | select(.name == "log-reducer-job-graph-template" and .builtIn) | {id, version}'
grepr integration:list --fields id,name,type
grepr dataset:list --fields id,name
```

`grepr api` is not available in a Grepr agent sandbox. There, copy the
template from a log pipeline that exists:

```bash
grepr job:list --processing STREAMING --include-graph |
  jq -c '.jobGraph.vertices[]? | select(.type == "template-operation" and .templateInputs.input.reducer.type == "log-reducer") | {templateId, templateVersion}' |
  sort -u
```

If the raw-logs dataset does not exist, create it with `grepr:dataset-commands`.

The template requires the reducer's `masks`, `enabledMasks`, and `delimiters`.
Copy them from a log pipeline that exists. Use jq, so the mask regexes keep
their escaping:

```bash
grepr job:list --processing STREAMING --include-graph |
  jq -sc 'first(.[] | .jobGraph.vertices[]? | select(.type == "template-operation") | .templateInputs.input.reducer | select(.type == "log-reducer") | {masks, enabledMasks, delimiters})' \
  > reducer-defaults-<tag>.json
```

If the file is empty, the org has no log pipeline to copy from. Ask the user
to create the first log pipeline in the Grepr UI, and make later changes to it
with the intent skills.

## 3. Write the pipeline file

Write `pipeline-<tag>.json`:

```json
{
  "name": "<pipeline_name>",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "jobGraph": {
    "vertices": [
      {
        "type": "template-operation",
        "name": "template_operation",
        "templateId": "<template-id>",
        "templateVersion": <template-version>,
        "templateInputs": {
          "input": {
            "sources": [
              { "type": "datadog-log-agent-source", "name": "source_datadog", "integrationId": "<source-integration-id>" }
            ],
            "parsers": [
              { "type": "json-log-processor", "name": "json_log_processor" },
              { "type": "log-attributes-remapper", "name": "log_attributes_remapper" }
            ],
            "reducer": { "type": "log-reducer", "name": "log_reducer" },
            "exceptions": [],
            "datasetId": "<raw-dataset-id>",
            "sinks": [
              { "sink": { "type": "datadog-log-sink", "name": "sink_datadog", "integrationId": "<vendor-integration-id>" } }
            ]
          }
        }
      }
    ],
    "edges": []
  },
  "tags": { "grepr-ui-managed": "true" }
}
```

| Input | Required | Holds |
|-------|----------|-------|
| `sources` | Yes | Source operations, each with its `integrationId`. |
| `parsers` | Yes | The parser chain. The JSON processor and the attribute remapper with their defaults are the standard start. |
| `reducer` | Yes | The `log-reducer` settings. Needs `name`, `masks`, `enabledMasks`, and `delimiters`. Leave the other fields out to get the defaults. |
| `exceptions` | Yes | Logs that skip aggregation. Start with `[]`. |
| `datasetId` | One output | The dataset that stores the raw logs. |
| `sinks` | One output | Vendor sinks. Each entry is `{ "sink": <sink operation>, "filter": <optional logs-filter> }`. |
| `processedLogsSink` | One output | A `logs-iceberg-table-sink` that stores the reduced logs. |

Give each source, parser, and sink a `name` of lowercase letters, digits, and
underscores that is unique in the pipeline. The intent skills find entries by
this name. The `grepr-ui-managed` tag lets the Grepr UI manage the pipeline
like one it created, for example to clone it. Set at least one output. Source
and sink operation fields are in `grepr:operations-reference`. All input fields are in
`grepr docs:get schema://LogReducerTemplateInput`. Do not set `draftMode` or
`draftSource` in this file.

Add the reducer fields from step 2:

```bash
jq --slurpfile d reducer-defaults-<tag>.json \
  '.jobGraph.vertices[0].templateInputs.input.reducer += $d[0]' \
  pipeline-<tag>.json > pipeline-<tag>.tmp && mv pipeline-<tag>.tmp pipeline-<tag>.json
```

## 4. Draft against sample logs

`job:create` starts a pipeline when it creates it, so test the inputs first. A
draft runs the same template in draft mode as a synchronous job. It writes to
no dataset, sends nothing to a vendor, and rejects template inputs that are not
valid. It does not check the sink integrations, so a sink integration with a
bad credential can still make `job:create` fail.

Put the samples in `samples-<tag>.ndjson`, one JSON object per line. Take them
from a dataset that stores logs from this source:

```bash
grepr query --dataset-id <dataset-id> --query "<scope>" \
  --start <iso> --end <iso> --limit 200 -q -f raw -o samples-<tag>.ndjson
```

A dataset stores logs after a pipeline parsed them, so these samples already
carry the parsed attributes. They test the reducer and the sinks, but not the
parsers. To test the parsers, write samples from the user's raw example lines.
Give each line a `message`, and optionally `tags` (`{"service": ["checkout"]}`),
`severity` (1-24, 9 is INFO), and `attributes`.

Build the draft job from the pipeline file, then run it. The jq fills the
event fields that the server requires, so do not write them yourself:

```bash
jq --slurpfile samples samples-<tag>.ndjson '
  (now * 1000 | floor) as $now
  | .name += "_draft" | .execution = "SYNCHRONOUS" | .processing = "BATCH"
  | .jobGraph.vertices[0].draftMode = true
  | .jobGraph.vertices[0].templateInputs.input.draftSource = {
      type: "logs-values-source", name: "draft_source",
      values: [$samples | to_entries[] | .key as $i | .value | {
        type: "log", id: (.id // "sample_\($i)"),
        eventTimestamp: (.eventTimestamp // $now),
        receivedTimestamp: (.receivedTimestamp // .eventTimestamp // $now),
        severity: (.severity // 9), message: (.message // ""),
        tags: (.tags // {}), attributes: (.attributes // {})}]}
' pipeline-<tag>.json > draft-<tag>.json
grepr job:create draft-<tag>.json -f raw -o draft-<tag>.ndjson
```

The draft runs as a batch job and stops after the last sample. Each output
record is a log event with the stage that emitted it in `tags["sink-source"]`.
Count the records per stage:

```bash
jq -r '(.tags["sink-source"] // ["untagged"])[]' draft-<tag>.ndjson | sort | uniq -c
```

Check that each sink stage gets records. For samples written from raw lines,
also check that the parsers extract the expected attributes. If the draft fails, its error names the input that the
template rejects. Fix the pipeline file, build the draft file again, and run it
again.

## 5. Create the pipeline

Show the user the pipeline file and the draft result. Create the pipeline only
after the user approves. It starts at once and sends logs to every sink.

```bash
grepr job:create pipeline-<tag>.json
grepr job:get <job-id> --fields id,name,state
```

Poll `job:get` until the state is `RUNNING`. On `FAILED`, use
`grepr:debug-pipeline`.

## 6. Check the running pipeline

After logs arrive at the source, draft the live pipeline and query the raw-logs
dataset:

```bash
grepr job:draft --job-id <job-id> --max-duration-seconds 60 -o live-<tag>.ndjson
grepr query --dataset-id <raw-dataset-id> --start <iso> --end <iso> --limit 20 -q -f raw -o stored-<tag>.ndjson
```

Read the live draft as `grepr:test-pipeline-change` describes. The query
confirms that raw logs reach the dataset.

Make every later change with an intent skill (`grepr:tune-*`,
`grepr:change-*`, `grepr:build-grok`, `grepr:build-sql-transform`). Each one
hands its patch to `grepr:test-pipeline-change`, which plans, drafts, and
applies it after the user approves. Do not send the `--resolved` graph back
with `job:update`.

## Troubleshooting

- If the job is `FAILED`, use `grepr:debug-pipeline`. If that does not explain
  it, contact Grepr support at support@grepr.ai with the job ID.
- If no logs reach the dataset, check that the source integration receives logs
  and that no filter drops them.
- If parsing does not work, use `grepr:tune-grok`.
