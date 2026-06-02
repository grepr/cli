# Backend capability matrix (canonical)

This is the single source of truth for how Grepr pipeline backends are detected
and which edit operations each backend supports. Other skills link here instead
of restating it. (Cross-reference line: "For backend detection and which ops
each backend supports, see `grepr:describe-pipeline`.")

## Contents

- [Detection rule](#detection-rule)
- [Backend job shapes](#backend-job-shapes)
- [Capability matrix](#capability-matrix)
- [The canonical-UI-shape constraint](#the-canonical-ui-shape-constraint)
- [Template-only operations](#template-only-operations)
- [Draft behavior by backend](#draft-behavior-by-backend)

## Detection rule

Scan `jobGraph.vertices` once:

- **Template-backed** — at least one vertex has `type: "template-operation"`.
  Its config lives under `templateInputs.input` and expands server-side; the
  resolved graph is what runs. Edits route through `job:plan` / `job:apply`
  against the template inputs.
- **Direct (raw) job graph** — no `template-operation` vertex; the parser,
  remapper, reducer, and grok vertices sit bare in the graph. Edits still go
  through the same `job:plan` / `job:apply` CLI commands, which mutate the
  resolved graph directly.

Resolved template-backed graphs prefix vertex names with
`template_operation__` (an expansion artifact). Direct graphs have no such
prefix. Edits never reference a `template_operation__…` name — they target
template inputs via the intent skills.

## Backend job shapes

**Template-backed** — `jobGraph.vertices` is exactly one vertex and `edges: []`:

```json
{
  "type": "template-operation",
  "name": "…",
  "templateId": "log-reducer",
  "templateVersion": 1,
  "templateInputs": {
    "input": {
      "sources": [], "parsers": [], "reducer": {},
      "filters": {}, "exceptions": [], "sinks": [], "datasetId": "…"
    }
  }
}
```

**Raw job graph (canonical UI shape)** — direct vertices plus string edges
(`"src -> pre_parser_filter"`). The UI chain is:

```
source → pre_parser_filter (logs-filter) → parsers (json-log-processor,
log-attributes-remapper, optional grok-parser) → pre_data_warehouse_filter →
pre_exceptions_filter → log_reducer → sinks
```

## Capability matrix

| Operation | Template-backed | Raw, canonical UI shape | Raw, arbitrary DAG |
|---|---|---|---|
| `add-message-attribute` | ✅ | ✅ (if vertex unambiguous) | ✅ (if vertex unambiguous) |
| `add-group-by` | ✅ | ✅ (if vertex unambiguous) | ✅ (if vertex unambiguous) |
| `add-aggregation-strategy` | ✅ | ✅ (if vertex unambiguous) | ✅ (if vertex unambiguous) |
| `add-reducer-exception` | ✅ | ✅ (if vertex unambiguous) | ✅ (if vertex unambiguous) |
| `add-grok-rule` | ✅ | ✅ (if vertex unambiguous) | ✅ (if vertex unambiguous) |
| `set-filter` | ✅ | ✅ | ❌ `unsupported raw job graph shape` |
| `clear-filter` | ✅ | ✅ | ❌ `unsupported raw job graph shape` |
| `add-source` / `remove-source` | ✅ | ✅ | ❌ `unsupported raw job graph shape` |
| `add-parser` / `remove-parser` | ✅ | ✅ | ❌ `unsupported raw job graph shape` |
| `add-sink` / `remove-sink` / `set-raw-dataset` | ✅ | ✅ | ❌ `unsupported raw job graph shape` |
| `set-input-field` / `unset-input-field` | ✅ | ❌ template-only | ❌ template-only |
| `set-filter` phase `pre-aggregation` | ✅ | ❌ template-only stage | ❌ template-only stage |

Two op families:

- **Existing-vertex field ops** (`add-message-attribute`, `add-group-by`,
  `add-aggregation-strategy`, `add-reducer-exception`, `add-grok-rule`) edit a
  field on a vertex that already exists. They work on any backend as long as the
  target vertex is unambiguous — i.e. exactly one reducer / grok parser /
  remapper to apply to.
- **UI-topology ops** (`set-filter`, `clear-filter`, `add-source`,
  `remove-source`, `add-parser`, `remove-parser`, `add-sink`, `remove-sink`,
  `set-raw-dataset`) add, remove, or rewire vertices. They depend on the graph
  matching the canonical UI shape.

## The canonical-UI-shape constraint

UI-topology ops on a raw job graph are supported only when the graph matches the
canonical UI log-pipeline shape (source → `pre_parser_filter` → parsers →
`pre_data_warehouse_filter` → `pre_exceptions_filter` → `log_reducer` → sinks).
The CLI needs that named-stage layout to know where to splice changes.

A raw DAG that does not match — a custom branching graph, a SQL-operation
pipeline, an unexpected stage ordering — rejects every UI-topology op with
`unsupported raw job graph shape`. Existing-vertex field ops still work on such
a graph as long as the target vertex is unambiguous. Flag this limit in the
TL;DR for any direct job graph so downstream skills know which ops are off the
table before they build a patch.

## Template-only operations

These never apply to a raw job graph, regardless of shape:

- `set-input-field` and `unset-input-field` — they address template inputs by
  dot-notation path (`sinks.0` is an object key, not an array index) and are
  rejected on raw graphs, which have no template inputs to address.
- `set-filter` at the `pre-aggregation` phase — the `pre-aggregation` slot is a
  template construct; raw graphs have no equivalent stage. (The other phases —
  `pre-parser`, `pre-exceptions`, `pre-warehouse` — map to named filter vertices
  in a canonical UI graph.)

## Draft behavior by backend

- **Template-backed** — `job:draft` gets per-stage tags from the server.
- **Direct job graph** — `job:draft` uses a source-preserving live draft for all
  classifications: it preserves proposed source vertices, removes production
  sinks, and adds sync/tap outputs. Data records are wrapped under `.data`; tap
  tags nest at `.data.tags["sink-source"][]`. Some untagged `.data` records from
  direct sync outputs are expected. Bound the run with
  `--max-duration-seconds 30`. Output edits verify graph/upstream behavior only;
  external sink delivery is not verified.

For how a patch is planned, drafted, gated, and applied, hand the patch file to
`grepr:test-pipeline-change`, which plans, drafts, gates on approval, and
applies.
