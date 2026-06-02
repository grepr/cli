---
description: Add, remove, or replace an input source on a Grepr pipeline — new Datadog/Splunk/OTLP integration, iceberg replay, fixing a wrong integrationId/query, or retiring a source. Use whenever a source is being changed, swapped, added, or a source is not ingesting or missing logs.
allowed-tools: Bash(grepr integration:list), Bash(grepr integration:get), Bash(grepr job:get), Bash(grepr --conf * integration:list), Bash(grepr --conf * integration:get), Bash(grepr --conf * job:get), grepr:describe-pipeline, grepr:test-pipeline-change, grepr:integration-commands
---

# Change Pipeline Source

Add, remove, or replace a source on a Grepr pipeline, then validate the proposed
source config in a draft run before any production apply. A source feeds raw log
events into the pipeline; every pipeline must keep at least one.

Resolve the org config once and reuse it on every command — see the `grepr:cli` skill.

## Step 1 — Get context

Run `grepr:describe-pipeline <JOB_ID>` and record the existing sources (name, type,
`integrationId`, query/predicate, time window) and the backend shape. For backend
detection and which ops each backend supports, see `grepr:describe-pipeline`.

Source ops apply to template-backed pipelines and to canonical UI-shaped raw job
graphs. A non-canonical raw DAG rejects source topology edits with `unsupported raw
job graph shape`, so confirm the shape before building a patch.

When adding a source, list the integrations so the new vertex can reference a real
`integrationId`:

```bash
grepr integration:list
```

Reusing the same source `type` + `integrationId` as an existing source is a duplicate
no-op — only do it when the user is deliberately replacing that source.

## Step 2 — Pick the case

| Intent | Ops | Note |
|--------|-----|------|
| Add a new source alongside the existing ones | `add-source` | appends; no source is removed |
| Replace a source with new config | `remove-source` + `add-source` | pair them in one patch so a source always remains |
| Retire a source | `remove-source` | rejected if it would leave zero sources |

A patch leaving zero sources is rejected at plan time, because a pipeline with no
input has nothing to process. To swap the only source, use the replace case so the
`add-source` lands in the same patch.

## Step 3 — Build the patch

The patch root is `{ "operations": [ ... ] }`. The two source ops and their exact
fields:

| op | required field | shape |
|----|----------------|-------|
| `add-source` | `source` (object) | agent or iceberg source, see below |
| `remove-source` | `name` (string) | name of an existing source vertex |

Source shapes (the canonical UI shape — required for raw-graph edits):
- Agent: `{ "type": "datadog-log-agent-source", "name": "...", "integrationId": "..." }`
- Iceberg replay: `{ "type": "logs-iceberg-table-source", "name": "...", "datasetId": "...", "query": {...}, "start": "...", "end": "...", "limit": 1000 }`

A wrong `type` string is rejected at plan time. For the full source-type catalog
(Splunk, New Relic, Sumo, OTLP agents) and exact field names, see
`grepr:operations-reference`. See `examples.md` for ready-to-copy ✅/❌ patches.

## Step 4 — Validate and apply

Hand the patch file to `grepr:test-pipeline-change`, which plans, drafts, gates on
approval, and applies. The plan classifies as `source`, which the draft harness runs:
the proposed source vertices stay live in the draft so their record stream proves
ingest works before production.

What to confirm in the draft output:

| Check | Good sign |
|-------|-----------|
| Records from the new source vertex | Non-zero volume in the draft window |
| Source-error tags (`_grepr.source.error`) | Absent |
| Reserved attributes populated | `service`, `host`, `message` look right |
| Volume sane | Matches the integration's documented rate, not production-scale |

If the new source emits nothing in the draft window, stop before applying — the
credentials, integration auth, or query filter is the likely cause.

## Failure modes

- No records from the new source — usually credentials/auth. Check
  `grepr integration:get <id>` for the integration's status; the draft sometimes
  carries an explicit source-error tag pointing at the cause.
- Records arrive with wrong tags/attributes — the source's reserved-attribute mapping
  does not match the vendor payload. Follow up with a remapper or `change-exceptions`
  patch.
- Source-side rate limit — vendor APIs throttle aggressive pulls. Re-run after a short
  delay before concluding the source is broken.
- Replaced source still ingesting — confirm `remove-source` landed by checking the
  plan diff before apply.

## Resources

- `examples.md` — ✅ template-backed add/replace patches, ✅ raw-graph add-source, and
  ❌ rejected patches (zero-source removal, non-canonical raw graph), each with a why.
- `grepr:describe-pipeline` — backend detection and per-backend op support.
- `grepr:operations-reference` — full source-type catalog and exact field names.
- `grepr:integration-commands` — list/inspect integrations for `integrationId`.
- `grepr:test-pipeline-change` — plans, drafts, gates, and applies the patch.
- `grepr:cli` — resolve and reuse the org `--conf` config.
