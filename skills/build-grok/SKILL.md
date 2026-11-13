---
description: Learn about grok:parse Grepr CLI command. Create, test, and add Grok patterns to Grepr pipelines to parse log messages into structured data to enable more effective and easier queries on log data.
allowed-tools: Bash(grepr grok:parse), Bash(jq), grepr:job-commands, grepr:query, grepr:docs-commands, grepr:tune-grok, grepr:test-pipeline-change, Read(grok-parse.md)
---

# Building Grok patterns for Grepr
You will be using the Grepr CLI to test Grok patterns and then updating or creating a new job or pipeline with those grok patterns. You will need the `grepr:job-commands` skill to manage jobs/pipelines.

The user will have to give you some sample messages that you'd like to parse, either in the prompt or via a file. If they don't, you can help them query their raw log data from the data lake using the `grepr:query` skill.

Helper patterns are rules that can be reused in multiple places within the main Grok pattern. They help simplify complex patterns by breaking them down into smaller, reusable components. Use them to make your main patterns easier to read and maintain.

# Other skills to use
Read through the Grepr documentation on Grok using `grepr:docs-commands` (docs:search and docs:get commands) to familiarize yourself with how Grepr Grok patterns work, available functions, and how to structure Grok parsers in Grepr job graphs.

Use `grepr:job-commands` for CLI commands needed to build and test Grok patterns and update jobs/pipelines.

Use `grepr:query` to query raw log data from the data lake if needed to get sample messages.

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
6. **Build or update `GrokParser`**: Once the Grok patterns are finalized, add them to the pipeline with a patch. Each parser can have multiple rules and helpers, but only one `predicate` field. Ask the user to specify the predicates to match to improve the performance and reduce CPU usage and cost for their pipelines. If no predicate is specified, the GrokParser will apply to all messages, which may not be efficient. Use `add-grok-rule` to append a rule to an existing grok parser with the same predicate. Use `add-parser` with a `grok-parser` to add a parser with a different predicate. `grepr:tune-grok` has the decision table and copy-paste patches. Use the grepr cli `docs:search --type schema` to find the GrokParser schema documentation if needed.
7. **Integrate into job**: These parsers are chained serially. You don't need to create multiple parsers if they have the same predicate. You might want to separate parsers based on log types or to improve readability. `add-parser` appends a new parser to the end of `input.parsers`.
8. **Test before rollout**: Hand the patch to `grepr:test-pipeline-change`. It drafts the change before any production write. To test against the sample messages, draft with `--sample-logs`.

# Example

Write the patch with `jq --arg` so jq handles the JSON escaping of the rule. This patch appends a rule to the existing parser `grok_parser_0`:

```bash
jq -n --arg rule 'UpstreamLogRule %{ipOrHost:client_ip} - %{notSpace:upstream_user} \[%{HTTPDATE}\] "%{word:http_method} %{notSpace:request_path} %{notSpace:http_version}" %{integer:status_code} %{integer:response_bytes} %{notSpace:cache_status} %{number:upstream_response_time}' \
  '{operations: [{op: "add-grok-rule", parserName: "grok_parser_0", pattern: $rule}]}' > patch-grok-<tag>.json
```

For a rule that needs a different predicate, use `add-parser`. `grepr:tune-grok` has both patch shapes.

# Grepr CLI grok:parse command-line help
!`grepr grok:parse --help`

# Below are the original docs on Grok patterns in Grepr for reference

!`grepr docs:get doc://transforms/grok/page.mdx | sed 's/^#/##/'`

!`grepr docs:get doc://transforms/grok/datadog-matchers/page.mdx | sed 's/^#/##/'`

!`grepr docs:get doc://transforms/grok/logstash-matchers/page.mdx | sed 's/^#/##/'`

!`grepr docs:get doc://transforms/grok/transformers/page.mdx | sed 's/^#/##/'`

!`grepr docs:get schema://GrokParser | sed 's/^#/##/'`
