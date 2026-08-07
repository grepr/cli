# Grepr span predicates

Spans accept only `datadog-query`. The CLI derives source filters from these
facets:

| Intent | Predicate |
|---|---|
| service | `serviceName:x` |
| operation | `operationName:x` |
| trace signature | `traceSignature:"x"` |
| trace ID | `traceId:x` |
| errors / non-errors | `hasError:true|false` |
| root / non-root spans | `root:true|false` |
| minimum duration | `durationNanos:>=N` |
| maximum duration | `durationNanos:<=N` |

Convert latency to integer nanoseconds: 1 µs = 1,000 ns, 1 ms = 1,000,000 ns,
and 1 s = 1,000,000,000 ns. Ask for a threshold when the user says only
"slow"; do not invent one.

Use `AND` between different facets. Use a parenthesized `OR` only for multiple
values of the same facet, for example
`serviceName:(checkout OR payments) AND hasError:true`.

Only the facets above are supported. Unsupported facets may not constrain the
result. Do not author them. Preserve an exact user-supplied predicate and let
CLI validation report unsupported syntax; never silently rewrite it.

Examples:

- "checkout spans" → `serviceName:checkout`
- "errors in checkout" → `serviceName:checkout AND hasError:true`
- "checkout or payments spans over 250 ms" →
  `serviceName:(checkout OR payments) AND durationNanos:>=250000000`
- "this trace" with ID `0123...` → `traceId:0123...`
