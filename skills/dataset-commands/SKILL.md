---
description: Manage Grepr datasets in the data lake. List, view, create, update, and delete datasets.
allowed-tools: Bash(grepr dataset:*), Bash(grepr job:get), Bash(jq), Read(dataset-*.md)
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
| `grepr dataset:create <file>` | Create a new dataset from a JSON file | [dataset-create.md](dataset-create.md) |
| `grepr dataset:update <id> <file>` | Update existing dataset from a JSON file | [dataset-update.md](dataset-update.md) |
| `grepr dataset:delete <id>` | Delete a dataset | [dataset-delete.md](dataset-delete.md) |

## General Usage Notes

- Use `--format table` for human-readable output
- Use `--format raw` for JSON output that's easier to parse programmatically
- Datasets are Iceberg tables in the data lake (S3)
- Each pipeline writes to one or more datasets
- Query logs or spans from datasets using the `grepr:query` skill

## Common Workflows

### List all datasets
```bash
grepr dataset:list --format table
```

### Find datasets a job writes to
`dataset:list` doesn't take a `--job-id` filter; inspect the job's vertices instead.
```bash
grepr job:get <job-id> --format raw | jq -r '.jobGraph.vertices[] | select(.datasetId) | .datasetId' | sort -u
```

### Get dataset details
```bash
grepr dataset:get <dataset-id> --format raw
```

### Create a new dataset
Pass a JSON file with `name` and `integrationId` (the storage integration id).
```bash
cat > dataset.json <<'EOF'
{
  "name": "processed-logs",
  "integrationId": "<storage-integration-id>"
}
EOF
grepr dataset:create dataset.json
```

### Delete a dataset
```bash
grepr dataset:delete <dataset-id>
```

## Command Details

For detailed documentation on each command, see the individual reference files listed above.
