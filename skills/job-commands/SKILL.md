---
description: Manage Grepr jobs and pipelines. List, view, create, update, and delete jobs/pipelines.
allowed-tools: Bash(grepr job:*), Read(job-list.md), Read(job-get.md), Read(job-create.md), Read(job-update.md), Read(job-delete.md)
trigger-keywords: ["list pipelines", "create pipeline", "update job", "delete job", "view job configuration", "manage grepr jobs"]
---

# Job Management Commands

Use these commands to manage Grepr jobs and pipelines.

## Prerequisites

Verify CLI access:
```bash
grepr job:list
```

If this fails, ask the user to provide `--org-name` or `--conf` options.

## Quick Reference

| Command | Purpose | Reference |
|---------|---------|-----------|
| `grepr job:list` | List jobs with optional filters | [job-list.md](job-list.md) |
| `grepr job:get <id>` | Get job configuration | [job-get.md](job-get.md) |
| `grepr job:create -f <file>` | Create a new job | [job-create.md](job-create.md) |
| `grepr job:update <id> -f <file>` | Update existing job | [job-update.md](job-update.md) |
| `grepr job:delete <id>` | Delete a job | [job-delete.md](job-delete.md) |

## General Usage Notes

- Use `--format table` for human-readable output
- Use `--format raw` for JSON output that's easier to parse programmatically
- Use `--debug` for verbose troubleshooting output
- Use `--quiet` to reduce noise where available

## Common Workflows

### List running pipelines
```bash
grepr job:list --state RUNNING --format table
```

### Get pipeline configuration
```bash
grepr job:get <job-id> --format raw
```

### Create a new pipeline
```bash
grepr job:create -f pipeline-config.json
```

### Update a pipeline
```bash
grepr job:update <job-id> -f updated-config.json
```

### Delete a pipeline
```bash
grepr job:delete <job-id>
```

## Command Details

For detailed documentation on each command, see the individual reference files listed above.
