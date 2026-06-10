---
description: List and view Grepr integrations. Integrations connect Grepr to external systems for data ingestion or export.
allowed-tools: Bash(grepr integration:*), Bash(jq), Read(integration-*.md)
trigger-keywords: list integrations, view integration, datadog integration, splunk integration, s3 integration
---

# Integration Management Commands

Use these commands to view integrations configured in Grepr.

## Prerequisites

Verify CLI access:
```bash
grepr integration:list
```

If this fails, ask the user to provide `--org-name` or `--conf` options.

## Quick Reference

| Command | Purpose | Reference |
|---------|---------|-----------|
| `grepr integration:list` | List all integrations | [integration-list.md](integration-list.md) |
| `grepr integration:get <id>` | Get integration details | [integration-get.md](integration-get.md) |

## General Usage Notes

- Use `--format table` for human-readable output
- Use `--format raw` for JSON output that's easier to parse programmatically
- Integrations include both vendor integrations (Datadog, Splunk, etc.) and storage integrations (S3, etc.)
- Creating/updating integrations is done through the Grepr UI or API, not the CLI

## Integration Types

### Vendor Integrations
- **Datadog**: For sending/receiving logs to/from Datadog
- **Splunk**: For sending/receiving logs to/from Splunk
- **New Relic**: For sending logs to New Relic
- **OTEL**: For receiving logs via OpenTelemetry protocol
- **Sumo Logic**: For sending/receiving logs to/from Sumo Logic

### Storage Integrations
- **S3**: For data lake storage (Iceberg tables)

## Common Workflows

### List all integrations
```bash
grepr integration:list --format table
```

### Get integration details
```bash
grepr integration:get <integration-id> --format raw
```

### Find integration ID for a vendor
```bash
grepr integration:list --format raw | jq '.[] | select(.type=="datadog")'
```

## Command Details

For detailed documentation on each command, see the individual reference files listed above.
