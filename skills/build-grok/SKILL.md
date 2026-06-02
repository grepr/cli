---
description: Learn about grok:parse Grepr CLI command. Create, test, and add Grok patterns to Grepr pipelines to parse log messages into structured data to enable more effective and easier queries on log data.
allowed-tools: Bash(grepr grok:parse), grepr:job-commands, grepr:query-logs, grepr:docs-commands, Read(grok-parse.md)
---

# Building Grok patterns for Grepr
You will be using the Grepr CLI to test Grok patterns and then updating or creating a new job or pipeline with those grok patterns. You will need the `grepr:job-commands` skill to manage jobs/pipelines.

The user will have to give you some sample messages that you'd like to parse, either in the prompt or via a file. If they don't, you can help them query their raw log data from the data lake using the `grepr:query-logs` skill.

Helper patterns are rules that can be reused in multiple places within the main Grok pattern. They help simplify complex patterns by breaking them down into smaller, reusable components. Use them to make your main patterns easier to read and maintain.

# Other skills to use
Read through the Grepr documentation on Grok using `grepr:docs-commands` (docs:search and docs:get commands) to familiarize yourself with how Grepr Grok patterns work, available functions, and how to structure Grok parsers in Grepr job graphs.

Use `grepr:job-commands` for CLI commands needed to build and test Grok patterns and update jobs/pipelines.

Use `grepr:query-logs` to query raw log data from the data lake if needed to get sample messages.

# Notes
- Don't confuse the `log-attributes-remapper` operation with the `GrokParser` or `grok-parser` operation. The former is used to remap existing fields in a Log Event's attributes to tags or other top-level fields, while the latter is used to parse unstructured log messages into attributes, tags, or top-level fields using Grok patterns. Use `grepr docs:get doc://transforms/remapper/page.mdx` to get for more info on the remapper if needed.
- When getting outputs from the grepr cli commands, use `grepr grok:parse -f raw` so you get the full data to verify the parsing results.
- The `grok:parse --samples-file <file>` flag expects one raw message per line (plain text), not NDJSON. Extract first with `jq -r '.message' samples.ndjson > msgs.txt`.
- Remember that Grepr Grok patterns always a require a rule name for both the main pattern and any helper patterns.
- If asking the user any questions as part of the flow, *always* give an option to "help me figure it out" so you can assist them in building the patterns or querying for sample messages, etc.
- Make sure you understand the structure of the job graph you're updating if you're relying on later operations.
- The grok parser already has the ability to map any of the extracted fields to tags, attributes, or top-level fields. You don't need additional operations (like the remapper) to do that. Instead, extract using the correct settings to begin with.
- Show the user the results of parsing so they can validate that the patterns are working as expected before moving forward. If they don't match, ask the user what they expected and adjust the patterns accordingly, then repeat.
- There is no easy way to extract arrays so don't try. Instead extract the entire field as a string.
- When search the docs, it might be easier to use `--type doc` to filter results to just documentation pages. If you want to look up the schema, use `--type schema`.
- Don't be phased by the complexity of testing an updated job before pushing to prod. Testing is very important to ensure that jobs work as expected before deploying to production.
- If it looks like a log message has some structure as key-value pairs, use the `keyvalue` transformer to extract those fields instead of building complex static Grok patterns.
- Develop grok patterns iteratively by testing against sample log lines that either the user provides or logs based on a query for raw data from the data lake.

# Workflow

1. **Understand the log messages**: Review the log messages you want to parse and identify the key fields you want to extract. Validate those with the user.
2. **Figure out what exists**: If the user wants to update an existing pipeline, use the grepr cli job:list and job:get commands to find and retrieve the existing pipeline configuration. Review the existing Grok patterns if any exist, we might want to update those instead of creating new ones.
3. **Build Grok patterns**: Use the grepr grok:parse command to iteratively build and test Grok patterns against the sample log messages. Start with simple patterns and gradually add complexity as needed. You can review the grepr docs using the cli docs:search and docs:get commands to find relevant documentation on Grok patterns and available functions if needed. Generally, Grepr Grok patterns are similar to Datadog Grok patterns, but aren't exactly the same. You can use helper patterns to simplify your main patterns.
4. **Test patterns**: Test the Grok patterns against different log messages to ensure they work as expected and extract the desired fields. Validate messages to test with the user, or ask the user for more sample messages if needed. You can ask them for a query to run on the data lake to get more sample messages if they would like to test more. You test the patterns using the grepr cli grok:parse command. Validate the results with the user. STOP here until the user confirms the patterns and the outputs are correct.
5. **Get more data if possible**: You can ask the user if they want you to query a dataset for similar log messages to help them source more samples or to see if there are any common tags or attributes that can be used for building the predicate for the Grok parsers.
6. **Build or update `GrokParser`**: Once the Grok patterns are finalized, you need to create or update a `GrokParser` operation in the Grepr job graph. Each parser can have multiple rules and helpers, but only one `predicate` field. Ask the user to specify the predicates to match to improve the performance and reduce CPU usage and cost for their pipelines. If no predicate is specified, the GrokParser will apply to all messages, which may not be efficient. Use the grepr cli `docs:search --type schema` to find the GrokParser schema documentation if needed. Update the job graph accordingly.
7. **Integrate into job**: These parsers are chained serially. You don't need to create multiple parsers if they have the same predicate. You might want to separate parsers based on log types or to improve readability. The grok parsers should be placed after the JSON remapper if any and before raw data storage. If parsers exist, add new ones to the same chain.
8. **Test job before rollout**: Make sure you test a job using the `LogsValuesSource` with sample log messages to validate that the Grok parsers work as expected before rolling out to production. You can follow the instructions in the grepr cli job:update documentation to create a temporary job for testing.

# Examples

In all json examples below, comments (// ...) are for explanation only. They are not valid JSON and should not be included in actual job definitions.
For all the below examples, here's the original job we'll modify:

```json
{
  "name": "webapp_log_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      {
        "type": "datadog-log-agent-source",
        "name": "source_datadog_integration",
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
        "type": "datadog-log-sink",
        "name": "sink_datadog_integration",
        "integrationId": "<datadog-integration-id>"
      }
    ],
    "edges": [
      "source_datadog_integration -> pre_parser_filter",
      "pre_parser_filter -> json_log_processor",
      "json_log_processor -> log_attributes_remapper",
      "log_attributes_remapper -> grok_parser_0",
      "grok_parser_0 -> sink_datadog_integration"
    ]
  },
  "tags": {
    "environment": "production"
  }
}
```

## 1. Update existing Grok rule with new pattern and helper
When a new grok rule uses the same filter, you can update an existing GrokParser in a job graph to add the new rule and helper.

New Grok rule to add:
```
UpstreamLogRule %{ipOrHost:client_ip} - %{notSpace:upstream_user} \[%{HTTPDATE}\] "%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}" %{integer:status_code} %{integer:response_bytes} %{notSpace:cache_status} %{number:upstream_response_time}
```

Updated job:
```json
```json
{
  "name": "webapp_log_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      {
        "type": "datadog-log-agent-source",
        "name": "source_datadog_integration",
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
        "grokParsingRules": [
          "AccessLogMetrics %{ipOrHost:client_ip} %{notSpace} %{notSpace} \\[%{HTTPDATE}\\] \"%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}\" %{integer:status_code} %{integer:response_bytes} \"%{regex(\"[^\"]*\"):referrer}\" \"%{regex(\"[^\"]*\"):user_agent}\" %{integer:response_time_ms}",
          // New rule added, note we escaped the double quotes in the pattern
          "UpstreamLogRule %{ipOrHost:client_ip} - %{notSpace:upstream_user} \\[%{HTTPDATE}\\] \"%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}\" %{integer:status_code} %{integer:response_bytes} %{notSpace:cache_status} %{number:upstream_response_time}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "service:web-api"
        },
        "grokHelperRules": []
      },
      {
        "type": "datadog-log-sink",
        "name": "sink_datadog_integration",
        "integrationId": "<datadog-integration-id>"
      }
    ],
    "edges": [
      "source_datadog_integration -> pre_parser_filter",
      "pre_parser_filter -> json_log_processor",
      "json_log_processor -> log_attributes_remapper",
      "log_attributes_remapper -> grok_parser_0",
      "grok_parser_0 -> sink_datadog_integration"
    ]
  },
  "tags": {
    "environment": "production"
  }
}
```

Command to make modification, using args to handle json escaping:
```bash
jq --arg rule 'UpstreamLogRule %{ipOrHost:client_ip} - %{notSpace:upstream_user} \[%{HTTPDATE}\] "%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}" %{integer:status_code} %{integer:response_bytes} %{notSpace:cache_status} %{number:upstream_response_time}' '.jobGraph.vertices |= map(select(.type=="grok-parser" and .name=="grok_parser_0").grokParsingRules += [$rule] // .)' webapp_log_pipeline.json
```

## 2. Create new GrokParser in job graph
When a new grok rule uses a different filter, you can create a new GrokParser in the job graph.

New Grok rule to add:
```ErrorLogRule %{HTTPDATE:timestamp} \[%{word:log_level}\] %{data:message}```

Updated job:
```json
{
  "name": "webapp_log_pipeline",
  "execution": "ASYNCHRONOUS",
  "processing": "STREAMING",
  "desiredState": "RUNNING",
  "jobGraph": {
    "vertices": [
      {
        "type": "datadog-log-agent-source",
        "name": "source_datadog_integration",
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
        "grokParsingRules": [
          "AccessLogMetrics %{ipOrHost:client_ip} %{notSpace} %{notSpace} \\[%{HTTPDATE}\\] \"%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}\" %{integer:status_code} %{integer:response_bytes} \"%{regex(\"[^\"]*\"):referrer}\" \"%{regex(\"[^\"]*\"):user_agent}\" %{integer:response_time_ms}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "service:web-api"
        },
        "grokHelperRules": []
      },
      // New GrokParser added
      {
        "type": "grok-parser",
        "name": "grok_parser_1",
        "grokParsingRules": [
          "ErrorLogRule %{HTTPDATE:timestamp} \\[%{word:log_level}\\] %{data:message}"
        ],
        "predicate": {
          "type": "datadog-query",
          "query": "log_level:error"
        },
        "grokHelperRules": []
      },
      {
        "type": "datadog-log-sink",
        "name": "sink_datadog_integration",
        "integrationId": "<datadog-integration-id>"
      }
    ],
    "edges": [
      "source_datadog_integration -> pre_parser_filter",
      "pre_parser_filter -> json_log_processor",
      "json_log_processor -> log_attributes_remapper",
      "log_attributes_remapper -> grok_parser_0",
      "grok_parser_0 -> grok_parser_1",
      "grok_parser_1 -> sink_datadog_integration"
    ]
  },
  "tags": {
    "environment": "production"
  }
}
```

Command to make modification, using args to handle json escaping:
```bash
jq --arg rule 'ErrorLogRule %{HTTPDATE:timestamp} \[%{word:log_level}\] %{data:message}' \
'.jobGraph.vertices += [{"type":"grok-parser","name":"grok_parser_1","grokParsingRules":[$rule],"predicate":{"type":"datadog-query","query":"log_level:error"},"grokHelperRules":[]}]' webapp_log_pipeline.json
```

# Grepr CLI grok:parse command-line help
!`grepr grok:parse --help`

# Below are the original docs on Grok patterns in Grepr for reference

!`grepr docs:get doc://transforms/grok/page.mdx | sed 's/^#/##/'`

!`grepr docs:get doc://transforms/grok/data-matchers/page.mdx | sed 's/^#/##/'`

!`grepr docs:get doc://transforms/grok/transformers/page.mdx | sed 's/^#/##/'`

!`grepr docs:get schema://GrokParser | sed 's/^#/##/'`
