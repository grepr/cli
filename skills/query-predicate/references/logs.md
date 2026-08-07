# Grepr log predicates

Assume the agent already knows Datadog and New Relic query languages. Apply
only these Grepr-specific rules.

## Field placement

Grepr log events separate message text, tags, and attributes:

- `service` and `host` are normally tags: use `service:x` and `host:x`.
- parsed or source-provided structured fields are attributes: use
  `@http.status_code:500` with Datadog syntax.
- an unqualified term searches `message`.

Use the placement visible in a sample. Do not turn a known attribute into a
tag or guess that names such as `status`, `level`, or `trace_id` have the same
placement across pipelines.

Dataset query and backfill predicates run on the stored pre-reducer events.
Parser/remapper output can be present, but reducer- and vendor-only fields such
as `grepr.repeatCount` or `processor:grepr` are not source filters. Remove those
clauses when adapting a vendor query to the raw dataset.

## Grepr's supported subsets

For `datadog-query`:

- message terms are case-insensitive; tag and attribute values are
  case-sensitive;
- fuzzy search, regex literals, and proximity search are unsupported; use
  exact terms, wildcards, phrases, or boolean alternatives.

For an explicitly requested `newrelic-query`:

- bare `field:value` searches attributes;
- use `tags.field:value` for tags, including `tags.service:x`;
- `*` is a wildcard, but `?` is literal.

Do not switch to New Relic merely because the destination is New Relic. Query
type describes predicate syntax, not the backfill sink.

## Intent choices

- Direct service/host requests: return their tag constraint immediately.
- Named message symptom such as timeout, panic, or connection refused: use
  the term or quoted phrase.
- Generic "errors": prefer a structured field only when its placement and
  value are known; otherwise use the message term `error`.
- Known numeric attributes: use the observed attribute path and comparison or
  range rather than translating the number into text.
