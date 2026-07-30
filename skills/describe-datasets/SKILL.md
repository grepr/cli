---
description: Discover Grepr datasets in the data lake — list them and inspect one's details. Read-only; use grepr:dataset-commands to create, update, or delete.
allowed-tools: Bash(grepr dataset:list), Bash(grepr dataset:get), Bash(grepr --conf * dataset:list), Bash(grepr --conf * dataset:get), Bash(jq)
---

# Dataset Discovery

Find out which datasets exist and what is in them. This is the read-only half of dataset access:
it can answer "where do this pipeline's logs land?" but cannot change anything.

## Prerequisites

Verify CLI access:
```bash
grepr dataset:list
```

If this fails, ask the user to provide `--org-name` or `--conf` options.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `grepr dataset:list` | List available datasets |
| `grepr dataset:get <id>` | Get one dataset's details, including storage |

## General Usage Notes

- Use `--format table` for human-readable output
- Use `--format raw` for JSON output that's easier to parse programmatically
- Datasets are Iceberg tables in the data lake (S3)
- Each pipeline writes to one or more datasets
- Query logs from datasets using the `grepr:query-logs` skill

## Common Workflows

### Find the dataset a pipeline writes to

```bash
grepr dataset:list --format raw | jq -r '.[] | "\(.id)\t\(.name)"'
```

Then inspect the one you want:

```bash
grepr dataset:get <id> --format raw | jq
```

## Creating or Changing Datasets

Not available here by design. Creating, updating, or deleting a dataset needs the
`grepr:dataset-commands` skill, which the agent's owner must enable explicitly.
