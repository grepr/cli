---
name: dataset-commands
description: Manage Grepr datasets in the data lake. List, view, create, update, and delete datasets.
allowed-tools: Bash(grepr dataset:*), Read(dataset-*.md)
---

# Dataset Management Commands

Use these commands to manage datasets in the Grepr data lake.

## Prerequisites

Verify CLI access:
```bash
grepr dataset:list
```

If this fails, ask the user to provide `--org-name` or `--conf` options.

## Quick Reference

| Command | Purpose | Reference |
|---------|---------|-----------|
| `grepr dataset:list` | List available datasets | [dataset-list.md](dataset-list.md) |
| `grepr dataset:get <id>` | Get dataset details | [dataset-get.md](dataset-get.md) |
| `grepr dataset:create` | Create a new dataset | [dataset-create.md](dataset-create.md) |
| `grepr dataset:update <id>` | Update existing dataset | [dataset-update.md](dataset-update.md) |
| `grepr dataset:delete <id>` | Delete a dataset | [dataset-delete.md](dataset-delete.md) |

## General Usage Notes

- Use `--format table` for human-readable output
- Use `--format raw` for JSON output that's easier to parse programmatically
- Datasets are Iceberg tables in the data lake (S3)
- Each pipeline writes to one or more datasets
- Query logs from datasets using the `grepr:query-logs` skill

## Common Workflows

### List all datasets
```bash
grepr dataset:list --format table
```

### Find datasets for a specific job
```bash
grepr dataset:list --job-id <job-id>
```

### Get dataset details
```bash
grepr dataset:get <dataset-id> --format raw
```

### Create a new dataset
```bash
grepr dataset:create --name "processed-logs" --description "Logs after parsing and reduction"
```

### Delete a dataset and its files
```bash
grepr dataset:delete <dataset-id> --delete-files
```

## Command Details

For detailed documentation on each command, see the individual reference files listed above.
