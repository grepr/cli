---
name: docs-commands
description: Search and retrieve Grepr documentation. Use semantic search to find relevant docs, API specs, and schema details.
allowed-tools: Bash(grepr docs:*), Read(docs-*.md)
trigger-keywords: ["search docs", "documentation", "schema", "api docs", "find docs", "learn about grepr"]
---

# Documentation Commands

Use these commands to search and retrieve Grepr documentation.

## Prerequisites

Verify CLI access:
```bash
grepr docs:search "job model"
```

## Quick Reference

| Command | Purpose | Reference |
|---------|---------|-----------|
| `grepr docs:search <query>` | Semantic search over documentation | [docs-search.md](docs-search.md) |
| `grepr docs:get <uri>` | Retrieve full document by URI | [docs-get.md](docs-get.md) |

## General Usage Notes

- `docs:search` uses semantic search (vector similarity) to find relevant documentation
- Results include relevance scores and truncated sections
- Use `docs:get` to retrieve full content after finding a relevant document with `docs:search`
- The documentation index is built at CLI compile-time and bundled with the CLI

## Common Workflows

### Search for documentation
```bash
# General search (searches docs by default)
grepr docs:search "how to create a pipeline"

# Search all content types (docs, api, schema)
grepr docs:search "GrokParser" --type all

# Search only schema definitions
grepr docs:search "GrokParser" --type schema

# Get more results
grepr docs:search "job states" --limit 10

# Pretty format for readability
grepr docs:search "query syntax" --format pretty
```

### Retrieve full document
```bash
# After finding a relevant doc with search
grepr docs:get "doc://apis/job-creation-guide.mdx"
```

### Find API schema
```bash
grepr docs:search "logs-iceberg-table-source" --type schema --format pretty
```

## Document Types

Use the `--type` filter to control which content types are searched:
- `doc` (default): User-facing documentation pages
- `all`: All content types (docs, api, schema)
- `api`: API endpoint documentation
- `schema`: Operation/component schemas (JSON schema for job graph operations)

## Output Formats

- `pretty`: Human-readable with formatting
- `compact`: Condensed view
- `json`: Machine-parseable JSON

## Command Details

For detailed documentation on each command, see the individual reference files listed above.
