---
description: Translate user intent into one Grepr log or span query predicate and query type without executing it. Use when a Grepr query, backfill, or pipeline workflow needs to turn direct filters, observed symptoms, error reports, incident context, or debugging intent into values for --query and --query-type.
allowed-tools: Read(references/*.md)
---

# Build a Grepr query predicate

Return the narrowest predicate justified by the user's words and available
evidence. Do not make the user translate their request into query syntax.

## Contract

Accept:

- user intent and any observed fields or sample records;
- `dataType` (`logs` when omitted);
- an optional exact predicate or explicit query type.

Return:

```text
query: <predicate>
queryType: <datadog-query|newrelic-query>
assumptions: <only meaningful assumptions; omit when empty>
clarification: <only when required; omit otherwise>
```

Never execute the query. For an obvious direct constraint, return the contract
immediately without explaining the language. For example, "service checkout"
on logs becomes `service:checkout`.

## Build the predicate

1. If the user supplied an exact predicate, preserve it. Preserve an explicit
   supported query type; otherwise use `datadog-query`.
2. Load exactly one reference: [logs](references/logs.md) or
   [spans](references/spans.md). Reject `newrelic-query` for spans.
3. Extract concrete scope first: service, host, operation, trace ID,
   environment, request ID, named error, or quoted message.
4. Add symptoms useful for finding evidence. Ignore conversational framing
   such as "during an incident", "help me debug", or "I am seeing"; it is not
   data.
5. Use fields proven by the request, a sample, or known Grepr fields. Never
   invent an attribute path or status convention.

If no filtering intent remains, return an empty `query`; do not manufacture
an error or service constraint from debugging context alone.

For incident-style requests:

- "errors in checkout" on logs → `service:checkout AND error`
- the same intent on spans → `serviceName:checkout AND hasError:true`
- "timeouts in checkout and payments" on logs →
  `(service:checkout OR service:payments) AND timeout`
- if a sample proves that an error is represented by `attributes.level`, use
  `@level:error` instead of a message guess.

## Clarify only material ambiguity

Do not ask follow-ups for direct filters or ordinary symptom words. Ask only
when different answers would materially change the result and no safe
predicate can express the request—for example, "slow spans" without a latency
threshold. Do not ask about datasets, sinks, time ranges, limits, or execution;
the caller owns those.
