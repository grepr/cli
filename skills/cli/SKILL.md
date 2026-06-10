---
description: Router for the Grepr CLI. Use whenever the user wants to manage Grepr jobs/pipelines, datasets, integrations, or documentation, query log data, or edit a pipeline — it directs to the specialized command and pipeline-editing skills. Start here for any "grepr" command request.
---

# Grepr CLI

The Grepr CLI provides commands for managing jobs, datasets, integrations, and documentation.

## Prerequisites

Check that the Grepr CLI is accessible:
```bash
grepr job:list
```

If this fails due to missing org information, ask the user to provide `--org-name` or `--conf` options.

## Config handling (canonical)

Every other skill defers here for this. Use the default config only when the user did
not name another customer/org. If they did, resolve the matching saved config **once**
(`grepr config:list` / `config:show`) and reuse that concrete `--conf <name>` value on
every Grepr command for the rest of the workflow. Do not put placeholder
`--conf <CONF>` text into commands before a real config name is known.

## General CLI Usage

View all available commands:
```
!`grepr -h`
```

Common flags:
- `--help` - Get help for any command (e.g., `grepr job:create --help`)
- `--format table` - Human-readable table output
- `--format raw` - JSON output for programmatic use
- `--debug` - Verbose output for troubleshooting
- `--quiet` - Reduce noise (where available)

## Command Categories

Choose the appropriate specialized skill based on what you need to do:

### Job/Pipeline Management → `grepr:job-commands`
Manage Grepr jobs and pipelines.
- List, view, create, update, delete jobs/pipelines
- Commands: `job:list`, `job:get`, `job:create`, `job:update`, `job:delete`

### Dataset Management → `grepr:dataset-commands`
Manage data lake datasets.
- List, view, create, update, delete datasets
- Commands: `dataset:list`, `dataset:get`, `dataset:create`, `dataset:update`, `dataset:delete`

### Integration Management → `grepr:integration-commands`
View vendor and storage integrations.
- List and view integrations (Datadog, Splunk, S3, etc.)
- Commands: `integration:list`, `integration:get`

### Documentation Search → `grepr:docs-commands`
Search and retrieve Grepr documentation.
- Semantic search over docs, API specs, schemas
- Commands: `docs:search`, `docs:get`

### Query Logs → `grepr:query-logs`
Query data from datasets with filters and time ranges.
- Execute queries on the data lake
- Command: `query`

### Build Grok Patterns → `grepr:build-grok`
Build and test Grok patterns for log parsing.
- Iterative pattern development workflow
- Command: `grok:parse`

### Inspect a Pipeline → `grepr:describe-pipeline`
Read-only structural summary of a pipeline (sources, transforms, sinks,
filters, reducer settings, topology). Run this before any edit.

### Edit a Pipeline → intent skills + `grepr:test-pipeline-change`
Pipeline edits are plan-first and never write to production without explicit
approval. Pick the intent skill for the change, which builds a patch and
routes it through the `grepr:test-pipeline-change` safety harness:
- `grepr:tune-reduction` — fix high passthrough / bad reduction
- `grepr:tune-grok` — fix grok parsing / extract attributes
- `grepr:change-exceptions` — tune reducer exception bypass
- `grepr:change-filtering` — drop logs at a pipeline phase
- `grepr:change-source` — add / remove / replace a source
- `grepr:change-sink` — change sinks, forwarding destinations, or datasets
- `grepr:build-pipeline` — build a new pipeline from scratch
- `grepr:debug-pipeline` — troubleshoot a misbehaving pipeline

The harness flow uses: `job:plan` (build/preview the plan, `--dry-run` for a
diff-only preview), `job:draft` (validate against live/replayed data, `-o`
to capture NDJSON), `job:apply` (write to production after approval).

## Notes

- When executing multiple steps to answer the user's request, show the user what steps you're taking
- Use the specialized skills above rather than calling this router skill directly
- Avoid using head/tail commands; instead use `--limit` where available (check command help first)
