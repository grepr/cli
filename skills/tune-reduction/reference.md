# Empty-message field analysis

Deep reference for Step 3 of [SKILL.md](SKILL.md): choosing which field becomes
`message`, which become group-by keys, and which become aggregations. For exact
op field names, see `grepr:operations-reference`.

## Candidate message fields (try in order)

| Candidate path | Notes |
|---|---|
| `message.data.message` | Nested log frames (Datadog, vendor wrappers). |
| `msg.request.query` | GraphQL — the query text is the actual content. |
| `msg.message` | Re-serialized log objects. |
| `body` | OTLP-style. |
| `body.action`, `body.method` | Action-style logs. |
| `request.path` | HTTP access logs without a body. |
| `event.type` | Event-driven logs. |

**Avoid as message/group-by:** trace IDs, span IDs, request IDs, timestamps,
pod names, hostnames. Unbounded cardinality produces one pattern per log.

Fields often live under `.attributes` (`attributes.path`, `attributes.method`,
`attributes.status_code`), not at the top level. Use the path that actually
exists in the sampled records.

Patch operation paths are relative to the log's `attributes` object. Strip the
top-level `attributes.` wrapper shown by `grepr query` output. Example:
`attributes.additionalProperties.event_detail` in a sampled record becomes
`additionalProperties.event_detail` in `add-message-attribute`.

## Per-shape defaults

For each empty-message shape, infer three things: the **message attribute**
(stable human-readable action), **group-by attributes** (medium-cardinality
dimensions that must stay distinct), and **aggregation attributes** (numeric
measurements summarized with one strategy, never used as group-by keys).

| Shape | Message candidate | Group-by candidates | Aggregation candidates |
|---|---|---|---|
| HTTP access logs | route/base path (`http.route`, `request.route`, `url.path_base`); full path only if params are already masked | method, status_code, route, service | duration/latency/response_time → `avg` (or `min`/`max`) |
| GraphQL | query text or operation name + normalized shape | operationName, operationType, service | resolver/duration → `avg` |
| RPC/gRPC | method/procedure name | service, rpc method, status/code | duration/latency → `avg` |
| Event/action logs | event type or action name | event type, action, result/status, service | counts → `sum`; durations → `avg` |

For HTTP, a raw full URL path with IDs (`/users/123/orders/456`) is too
high-cardinality — prefer an existing route/template. If only a full path
exists, confirm the reducer masks path params into a stable pattern before
using it as message or group-by.

## Empty-string `""` vs truly-absent `message`

`add-message-attribute` adds fallback message paths for the remapper.
**Verified behavior:** when top-level `message` is the empty string `""` and the
candidate lives in `attributes`, the remapper treats `""` as absent, the
fallback fires, and the reducer then gets a non-empty message — so the
fallback-only patch is the right tool for the common `message: ""` case.

Always confirm it in the draft: the patch is valid only if the remapper stage
now emits a non-empty `message`. If it doesn't (the empty value isn't treated as
absent), stop and report that this pipeline needs an overwrite or pre-remapper
transform path rather than a fallback-only patch.

## Aggregation safety

Aggregation strategies are safe only for fields that are numeric in both the
sample and the patched reducer-stage draft. Do not add `min`/`max`/`avg` for
string-valued, missing, or mixed-type duration/byte fields — those can fail or
cancel the draft even when the plan is syntactically valid.
