---
description: Router for Grepr CLI commands. Directs to specialized command skills based on the task.
trigger_keywords:
  - grepr cli
  - grepr commands
  - manage grepr jobs
  - manage grepr datasets
  - grepr integrations
  - grepr documentation
  - edit grepr pipelines
  - query grepr data or logs
---

# Grepr CLI

The Grepr CLI provides commands for managing jobs, datasets, integrations, and documentation.

## Prerequisites

Check that the Grepr CLI is accessible:
```bash
grepr job:list
```

If this fails due to missing org information, ask the user to provide `--org-name` or `--conf` options.

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

## Notes

- When executing multiple steps to answer the user's request, show the user what steps you're taking
- Use the specialized skills above rather than calling this router skill directly
- Avoid using head/tail commands; instead use `--limit` where available (check command help first)
