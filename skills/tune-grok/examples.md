# Tune-grok patch examples

Sanitized, schema-valid `{"operations":[...]}` patches. Each uses only whitelisted ops
and fields. Hand the chosen patch file to `grepr:test-pipeline-change`.

- [✅ Add a rule to an existing grok parser (template-backed)](#1)
- [✅ Insert a new grok-parser vertex (raw job graph)](#2)
- [❌ Over-matching pattern with no predicate](#3)
- [❌ `add-grok-rule` on a pipeline with zero grok parsers](#4)

---

## 1. ✅ Add a rule to an existing grok parser (template-backed) {#1}

The pipeline already has one `grok-parser`. With exactly one, `parserName` is optional;
include it when there is more than one grok parser (it is rejected if there are zero).

```json
{
  "operations": [
    {
      "op": "add-grok-rule",
      "parserName": "webapp_grok",
      "pattern": "%{ipOrHost:client_ip_addr} - %{notSpace:auth_user} \\[%{notSpace:req_ts}\\] \"%{word:http_method} %{notSpace:req_path}\" %{integer:http_status_code} %{integer:resp_bytes}"
    }
  ]
}
```

Why: an access-log line stuck in `message` now yields typed captures. Names are
domain-prefixed (`client_ip_addr`, `http_status_code`) to dodge remapper/reducer reserved
attributes. `add-grok-rule` behaves identically on template-backed and raw graphs — only
the new-parser case differs by backend (see example 2).

---

## 2. ✅ Insert a new grok-parser vertex (raw job graph) {#2}

The pipeline has zero grok parsers, so add one with `add-parser`. On a raw job graph this
inserts a `grok-parser` vertex into the canonical UI parser chain; `job:plan` wires the
edges. (If the pipeline were template-backed, the same patch adds the parser to
`input.parsers` instead — you write the identical operation either way.) A predicate
scopes the parser to one log shape.

```json
{
  "operations": [
    {
      "op": "add-parser",
      "parser": {
        "type": "grok-parser",
        "name": "checkout_access_grok",
        "predicate": { "type": "datadog-query", "query": "source:checkout-service" },
        "grokParsingRules": [
          "CheckoutAccess %{ipOrHost:client_ip_addr} - %{notSpace:auth_user} \"%{word:http_method} %{notSpace:req_path}\" %{integer:http_status_code}"
        ]
      }
    }
  ]
}
```

Why: with no grok-parser vertex present, `add-grok-rule` has nothing to attach to and is
rejected with "no grok-parser found"; `add-parser` creates the vertex first. The
predicate keeps the parser from running on unrelated shapes. Note a raw graph requires the
canonical UI shape — an existing parser chain to splice into; a malformed graph with no
parser vertices yields "no grok-parser vertex found".

---

## 3. ❌ Over-matching pattern with no predicate {#3}

```json
{
  "operations": [
    {
      "op": "add-parser",
      "parser": {
        "type": "grok-parser",
        "name": "loose_grok",
        "grokParsingRules": ["LooseRule %{data:first_field} %{data:rest}"]
      }
    }
  ]
}
```

Why it fails: no `predicate`, so the parser runs on every log in the pipeline, and
`%{data:…}` matches almost anything. It "succeeds" on unrelated shapes (JSON lines, stack
traces) and writes garbage `first_field`/`rest` attributes onto logs it was never meant to
touch. Scope it with a `predicate` and replace `%{data}` with `%{notSpace}`/`%{word}`.

---

## 4. ❌ `add-grok-rule` on a pipeline with zero grok parsers {#4}

```json
{
  "operations": [
    {
      "op": "add-grok-rule",
      "pattern": "%{ipOrHost:client_ip_addr} %{word:http_method} %{notSpace:req_path}"
    }
  ]
}
```

Why it fails: there is no grok-parser vertex to receive the rule, so `job:plan` rejects it
with "no grok-parser found". This is the no-parser case — use `add-parser` (example 2) to
introduce the grok-parser first, then add further rules with `add-grok-rule`.
