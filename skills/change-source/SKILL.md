---
description: Add, remove, or replace a source on a Grepr pipeline. Sources are validatable via the draft harness — the platform runs a real ingest against the flink-session-cluster, so credentials, integration setup, and source-specific filtering can be verified before production apply.
allowed-tools: Bash(grepr query), Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), Bash(grepr pipeline:draft), Bash(grepr pipeline:apply), Bash(grepr job:get), Bash(grepr integration:list), Bash(grepr integration:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:integration-commands
trigger_keywords:
  - change source
  - add source
  - new source
  - swap source
  - remove source
  - source not ingesting
  - source missing logs
---

# Change Pipeline Source

Use when:
- A new data source needs to be added (new Datadog integration, new
  Splunk endpoint, new OTLP collector, etc.).
- An existing source's config is wrong (credentials, query filter,
  integration ID).
- A source should be retired and removed from the pipeline.

Source changes are validatable via the draft harness. The platform's
draft-mode run actually starts the source on the flink-session-cluster
and ingests a small live sample, so you can verify credentials,
authentication, and record shape before touching production.

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` and note:
- Existing sources (name, type, integrationId, query/predicate, time window).
- Whether the user wants to replace an existing source or add a new one
  alongside.

For adding a new source, also check available integrations:

```bash
grepr integration:list
```

The source vertex needs an `integrationId` matching one of these.

## Step 2: Decide the Patch Shape

Three cases:

| Intent | Ops |
|--------|-----|
| Add a new source alongside existing | `add-source` |
| Replace an existing source with new config | `remove-source` + `add-source` |
| Just retire an existing source | `remove-source` |

## Step 3: Build the Patch

### Case A — Add a new source

```json
{
  "operations": [
    {
      "op": "add-source",
      "source": {
        "type": "datadog-log-agent-source",
        "name": "dd_prod_logs",
        "integrationId": "<integration-id-from-step-1>"
      }
    }
  ]
}
```

Use the integration's documented source type. Common types:
- `datadog-log-agent-source`, `datadog-log-cloud-source`
- `splunk-log-agent-source`, `splunk-log-http-source`
- `otlp-log-agent-source`
- `newrelic-log-agent-source`
- `sumo-log-source`
- `logs-iceberg-table-source` (for replay from an iceberg dataset)

### Case B — Replace an existing source

```json
{
  "operations": [
    { "op": "remove-source", "name": "old_dd_source" },
    {
      "op": "add-source",
      "source": {
        "type": "datadog-log-agent-source",
        "name": "dd_prod_logs",
        "integrationId": "int_new_123"
      }
    }
  ]
}
```

`remove-source` cleans up the entry; `add-source` appends the new one.

### Case C — Retire a source

```json
{
  "operations": [{ "op": "remove-source", "name": "deprecated_source" }]
}
```

## Step 4: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `patch.json`.

The plan's classification will be `touches-source`, which the draft
harness allows (unlike sink changes, source ingest is testable
end-to-end). The harness:

- Runs the patched template inputs through draft mode on the
  flink-session-cluster.
- Streams NDJSON output tagged with which `draftOutputs` stage each
  record came from.
- For added sources, the record stream from the new source proves
  ingest works.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| Records flowing from the new source vertex | Non-zero volume within the draft window |
| Source-error tags / `_grepr.source.error` | Absent |
| Expected reserved attributes present | `service`, `host`, `message` populated correctly |
| Volume is reasonable | Matches the integration's documented rate; not pulling production-scale traffic during draft |

If the new source doesn't emit anything during the draft window, **stop
before applying** — credentials, integration auth, or query filter is
likely wrong.

## Common Failure Modes

- **No records from the new source**: usually credentials/auth. Check
  `grepr integration:get <id>` for the integration's status. The draft
  output will sometimes carry an explicit error tag pointing at the cause.
- **Records arrive but with wrong tags/attributes**: the source-specific
  remapping or reserved-attribute config isn't matching the vendor's
  payload shape. May need a follow-up `change-exceptions` or remapper
  patch.
- **Source-side rate limit**: vendor APIs often rate-limit; if the draft
  pulls aggressively the vendor may throttle. Re-run after a short delay
  before concluding the source is broken.
- **Replaced source isn't superseded cleanly**: the old source might
  still be ingesting during the production apply transition. Confirm
  `remove-source` succeeded by checking the plan diff.

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
