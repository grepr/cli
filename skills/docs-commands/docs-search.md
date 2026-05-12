# grepr docs:search

## Command Help
!`grepr docs:search --help`

## When to Use
Search Grepr documentation using semantic search. Use this to find relevant docs when you need information about features, integrations, or configuration. This outputs chunks of relevant documentation with URIs that you can use to get more details.

## Examples

```bash
# Search for datadog integration (searches docs by default)
grepr docs:search "datadog integration"

# Search all content types (docs, api, schema)
grepr docs:search "GrokParser" --type all

# Search only schema definitions
grepr docs:search "GrokParser" --type schema

# Compact output with more results and more data in the preview
grepr docs:search "pipeline" -f compact -l 10 -c 1000

# JSON output for scripting
grepr docs:search "grok patterns" -f json

# No color for piping
grepr docs:search "log reduction" --no-color
```

## Output Formats
- `pretty` (default): Human-readable with colors, full previews
- `compact`: Brief one-line summaries with scores
- `json`: Machine-readable with URIs and sections

## Workflow for more detail if preview insufficient
1. Search to find relevant docs: `grepr docs:search "topic"`
2. Note the URI in results: `doc://path/to/file.mdx`
3. Get full content: `grepr docs:get "doc://path/to/file.mdx"`
