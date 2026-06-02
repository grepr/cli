# Change-source examples

Copy-paste patches for the source ops. All identifiers are sanitized. Each patch is a
valid `{ "operations": [...] }` file using only the whitelisted `add-source` /
`remove-source` ops and their exact fields.

## Contents
- ✅ Template-backed: add a Datadog agent source
- ✅ Template-backed: replace a source's integrationId
- ✅ Template-backed: add an iceberg replay source
- ✅ Raw job-graph: add a source (canonical UI shape)
- ❌ Bad: remove the only source (zero-source rejection)
- ❌ Bad: add a source on a non-canonical raw graph

---

## ✅ Template-backed — add a Datadog agent source

```json
{
  "operations": [
    {
      "op": "add-source",
      "source": {
        "type": "datadog-log-agent-source",
        "name": "webapp_dd_logs",
        "integrationId": "int_datadog"
      }
    }
  ]
}
```

Why this works: `add-source` appends alongside the existing sources, so the pipeline
keeps a valid input set. The draft replays the new vertex live, proving `int_datadog`
ingests before apply.

## ✅ Template-backed — replace a source's integrationId

```json
{
  "operations": [
    { "op": "remove-source", "name": "webapp_dd_logs" },
    {
      "op": "add-source",
      "source": {
        "type": "datadog-log-agent-source",
        "name": "webapp_dd_logs",
        "integrationId": "int_datadog_new"
      }
    }
  ]
}
```

Why this works: pairing `remove-source` with `add-source` in one patch swaps the config
without ever leaving zero sources, so it clears the zero-source gate. The new
`integrationId` is exercised in the same draft run.

## ✅ Template-backed — add an iceberg replay source

```json
{
  "operations": [
    {
      "op": "add-source",
      "source": {
        "type": "logs-iceberg-table-source",
        "name": "checkout_replay",
        "datasetId": "ds_raw_logs",
        "query": { "type": "datadog-query", "query": "service:checkout-service" },
        "start": "2026-05-01T00:00:00Z",
        "end": "2026-05-02T00:00:00Z",
        "limit": 1000
      }
    }
  ]
}
```

Why this works: an iceberg source replays bounded history from a dataset. The
`start`/`end` window and `limit` keep the draft pull small while confirming the
`datasetId` and `query` resolve to real records.

## ✅ Raw job-graph — add a source (canonical UI shape)

```json
{
  "operations": [
    {
      "op": "add-source",
      "source": {
        "type": "datadog-log-agent-source",
        "name": "acme_dd_logs",
        "integrationId": "int_datadog"
      }
    }
  ]
}
```

Why this works: on a canonical UI-shaped raw graph the source object must use the same
full UI shape as the template case. The harness wires the new source into the canonical
chain (source → `pre_parser_filter` → parsers → ... → `log_reducer` → sinks) and runs a
source-preserving draft, so the added source's tapped records prove ingest.

## ❌ Bad — remove the only source

```json
{
  "operations": [
    { "op": "remove-source", "name": "acme_dd_logs" }
  ]
}
```

Why this fails: if `acme_dd_logs` is the pipeline's only source, this leaves zero
sources and is rejected at plan time — a pipeline with no input has nothing to process.
To retire-and-replace, pair it with an `add-source` (see the replace example above).

## ❌ Bad — add a source on a non-canonical raw graph

```json
{
  "operations": [
    {
      "op": "add-source",
      "source": {
        "type": "otlp-log-agent-source",
        "name": "extra_otlp",
        "integrationId": "int_otlp"
      }
    }
  ]
}
```

Why this fails: the op and fields are valid, but the target raw job graph does not match
the canonical UI log-pipeline shape, so the harness cannot place the source vertex and
rejects the edit with `unsupported raw job graph shape`. Confirm the backend shape with
`grepr:describe-pipeline` before patching a raw graph.
