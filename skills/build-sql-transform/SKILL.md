---
description: Author a Flink-SQL transform on a Grepr log-reducer pipeline — reshape, enrich, or filter logs row-by-row, derive metric-shaped logs via windowed aggregation, or run arbitrary supported SQL. Emits a set-sql-transform patch into a template transform slot (pre-parser, pre-warehouse, pre-exceptions) and routes through test-pipeline-change. SQL transforms are TEMPLATE-BACKED ONLY. Use for "add a SQL transform", "transform/reshape logs with SQL", "logs to metrics", "aggregate logs with SQL". For masking/redacting sensitive data, use grepr:change-masking (the masking operator) instead of SQL.
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr sql:validate), Bash(grepr docs:search), Bash(grepr docs:get), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:plan), Bash(grepr --conf * job:draft), Bash(grepr --conf * sql:validate), Bash(grepr --conf * docs:search), Bash(grepr --conf * docs:get), Read, Write, AskUserQuestion, grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query-logs, grepr:docs-commands
---

# Build a SQL transform

You already know ANSI/Flink SQL — regex, `CASE`, casts, windowing, the function
catalog. This skill is **not** a SQL tutorial. It teaches the Grepr-specific
mechanics the dialect doesn't tell you, and how to turn a vague request into a
**precise spec** so the SQL you write is deterministic, not guessed.

A `set-sql-transform` patch installs your SQL as a `SqlNode` in a template
transform slot. You author and validate the SQL, then hand the patch to
`grepr:test-pipeline-change` — production writes happen only there, after
explicit approval. Resolve the org config (`--conf`) once and reuse it — see
`grepr:cli`.

**Masking/redaction is not this skill's job.** To scrub sensitive substrings
(PII, secrets, emails, card numbers), use `grepr:change-masking` — the masking
operator is purpose-built for redaction, needs no SQL, and is dynamically
reconfigurable. Reach for SQL only for genuine reshaping/enrichment/aggregation.

## Two hard boundaries

- **Template-backed jobs only — don't pre-classify.** `set-sql-transform` only
  works on template-backed jobs, but you do **not** need to detect the backend
  first (resolved graphs expand the template and mislead the check). Just build
  the patch; `job:plan` rejects a raw graph with *"SQL transform edits are only
  supported for template-backed log-reducer jobs in the CLI. This job is a
  direct job graph."*
- **`LOG_EVENT` only.** On the log-reducer template the SQL reads and writes
  `LOG_EVENT` — `inputs` is `{"logs": "LOG_EVENT"}` and every `sql_output` is
  `LOG_EVENT`. (The Flink dialect defines other stream types, but they are **not
  supported** on this template — see `reference.md`.) Every routing target is a
  log step, so "logs to metrics" means *windowed aggregation emitting `LOG_EVENT`
  rows*, not native metric datapoints — see `logs-to-metric.md`.

## Step 1 — Build the intent spec (interactive)

You cannot write correct SQL from a vague ask. Resolve these five fields before
authoring — **infer what you can from the request and the Step 2 sample; ask the
user (via `AskUserQuestion`) only for what's genuinely theirs to decide.** Don't
interrogate when the answer is obvious.

| Spec field | What it decides | Ask only if unclear |
|------------|-----------------|---------------------|
| **Outcome** — transform-in-place / derive-a-new-stream / both | whole shape | decompose multi-part asks ("normalize *and* count" = two outputs, one op) |
| **Scope** — which logs (service / tag / attribute, or all) | the Step 2 query + optional `gate` | yes, if not stated |
| **Fields/text** — exactly what to read or change | the SQL columns | confirm against the real sample, never guess |
| **Keep or replace originals?** | **`mainStream`** (the #1 failure point) | yes — see below |
| **Where must the effect land?** | phase + routing | yes, if storage/sink timing matters |

First get light context from `grepr:describe-pipeline`: the **raw dataset id**
(for sampling) and whether a `transforms` slot is **already occupied** —
`set-sql-transform` replaces the whole slot chain, so surface and confirm before
overwriting (use `set-transform-chain` to preserve an existing chain).

## Step 2 — Sample the logs

Author against the real shape, not guesses. Query the raw dataset over a bounded
recent window — **last ~10 min, `--limit 100`** (dataset id from Step 1; query
mechanics in `grepr:query-logs`):

- **Scope given** → query with that predicate.
- **Open-ended** → omit `--query` entirely (do **not** pass `--query "*"`).

Read the message formats, which tags exist, and the attribute paths. Note the
*exact* shapes your SQL will target. Use the sample to fill in the "fields/text"
spec field and to confirm the scope with the user.

## Step 3 — The fork model (`mainStream`) — read before authoring

A `SqlNode` **forks** every event: one copy feeds the SQL op (whose outputs are
routed by `outputRouting`); the *other* copy is the untouched original, governed
by the required `mainStream`:

- **`drop`** = **replace.** Original discarded; only the SQL output flows on. Use
  for in-place changes (reshape, enrich, categorize) that must *replace* the logs.
- **`passthrough`** = **tap.** Original continues unchanged; the SQL output is an
  *additional* stream. Use to derive a new stream (logs→metrics, alerts) while
  logs flow on.

Picking wrong is the signature failure: `passthrough` for an in-place reshape
ships the original **and** a changed copy (duplication); `drop` for a metrics
tap **deletes your logs**. An optional `gate` predicate runs the SQL only on
matching events (`drop` + `gate` = "transform the matches, pass the rest"); omit
it to apply to all. **When a `gate` is set, do not mirror its predicate in the SQL** — the node
only receives matching events, so a redundant service check in the SQL is
unnecessary.

## Step 4 — The LOG_EVENT schema and column rules (high-failure)

The input table is named by `inputs` (default `{"logs": "LOG_EVENT"}` → `FROM
logs`). `LOG_EVENT` columns are **fixed**: `id`, `eventtimestamp`,
`receivedtimestamp` (TIMESTAMP_LTZ(3)), `message` (STRING), `severity` (INT, 1-24
OTel; 9=INFO), `tags` (MAP<STRING, ARRAY<STRING>>), `attributes` (VARIANT).

How a `SELECT` column lands (a wrong placement silently no-ops):

1. **Override a fixed field → put the column *before* `*`:** `SELECT
   UPPER(message) AS message, * FROM logs`. After `*`, the original wins.
2. **Add a field → its own column.** A tag is a backtick column (`` 'prod' AS
   `tags.environment` ``); any non-core name lands in `attributes`. New columns
   may follow `*`.
3. **Read** tags with `tags['service'][1]`; attributes with
   `VARIANT_VALUE(attributes, '$.path', 'STRING')`. Write nested attributes with
   `VARIANT_BUILD`.
4. **`REGEXP_REPLACE` replacement text is literal** — `$1` backreferences may be
   emitted verbatim, so prefer fixed replacement strings and confirm in the
   draft. At `pre-parser`, `message` is raw text so string ops hit it directly;
   rewriting a value already parsed *into* `attributes` needs VARIANT rebuilding
   (prefer doing it at `pre-parser`).

The full `LOG_EVENT` column rules, UDF signatures, and the validation→error
table are in `reference.md`. (`LOG_EVENT` is the only supported stream type on
this template — see `reference.md` for what that excludes.)

## Step 5 — Pick the phase

If the user named one, use it. (`pre-aggregation` is **not** accepted.) Otherwise
reason from two bounds and confirm against topology:

| Phase | Reads | Sits |
|-------|-------|------|
| `pre-parser` | raw `message` only (pre-JSON/grok) | earliest; before the raw-storage branch (cheapest) |
| `pre-warehouse` | parsed attributes + grok captures | after parser, before downstream branches |
| `pre-exceptions` | parsed attributes | on the reducer-bypass (matched-exception) path |

- **Earliest possible** = what the SQL reads (needs a parsed attribute → must be
  post-parser; touches only raw `message` → `pre-parser`).
- **Latest acceptable** = where the effect must land (must take effect *before
  storage* → `pre-parser`; only reducer-bypass logs → `pre-exceptions`; general
  reshape → `pre-warehouse`).
- **Value also lands in a parsed attribute** → do it at `pre-parser` on the raw
  text, so the parser emits already-clean attributes (avoids VARIANT rebuilding).

## Step 6 — Build, validate, hand off

Write a `set-sql-transform` patch to `patch-sql-<tag>.json` (op shape in
`reference.md`). Then:

1. **Syntax-check each statement** with `sql:validate` (fast server-side Flink
   *parse* — catches typos/unbalanced quotes in one round-trip; does **not**
   check columns, types, routing, or behavior):
   ```bash
   jq -r '.operations[0].sqlOperation.statements[].sqlQuery' patch-sql-<tag>.json \
     | while IFS= read -r q; do grepr sql:validate "$q"; done
   ```
2. **Check the CLI rules** (`reference.md` validation table) — the ones that
   bite: `mainStream` required; ≥1 `sql_output`; every `outputName` is unique and
   **contains an underscore** (`critical_errors` ✅, `criticalerrors` ❌ — this
   one surfaces only at draft); every output has a route in `outputRouting`; each
   target is one of the five enum values; aggregations need a window TVF.
3. **Route to the slot's natural successor** (read it from describe-pipeline).
   This matters most in `drop` mode: the dropped original no longer carries logs
   forward, so the routed output is the *only* path down. At `pre-warehouse`,
   `data-warehouse` reproduces the full post-warehouse fan-out (lake write + the
   step after) — routing to one narrow step (e.g. `log-reducer` only) silently
   strands logs from the other paths. **Verify the real downstream effect in the
   draft.**
4. **Hand off:** "Hand the patch file to `grepr:test-pipeline-change`, which
   plans, drafts against live traffic, gates on approval, and applies." A ~30s
   draft suffices for row transforms; a **windowed output needs ≥ window +
   watermark** before rows emit — keep the window short (1 min), `watermarkDelay`
   low (≈`PT5S`), and draft ~90–120s.

A clean draft exit is **not** proof the SQL is correct. Read 5–10 sampled records
on the **post-SQL sink-path** stages (the node forks, so upstream stages still
carry pre-transform data — that's expected): confirm the intended change is
present, correctly typed, exactly one copy per event, and landing where you
intend. For a safety/coverage change, a marker tag in the SELECT (`` 'v1' AS
`tags.<marker>` ``) lets you and the user query that the change landed.

## Routing to cases

| Request | Where |
|---------|-------|
| Reshape / enrich / filter / categorize, row-by-row | inline above — it's `SELECT … AS <field>, *` with the right `mainStream` |
| **Mask / redact sensitive data** | **`grepr:change-masking`** (the masking operator) — not SQL |
| **Logs → metric-shaped logs** (windowed aggregation) | **`logs-to-metric.md`** |
| Transform **+** derived metric in one op | `logs-to-metric.md` (two outputs, one `sql-operation`) |
| Anything else in the dialect | `reference.md` |

As new genuinely-hard cases emerge, add a case file rather than growing this one.

## Resources

- `reference.md` — patch-op + SqlOperation schema, data-type schemas, routing
  targets, the validation→error table (verbatim CLI messages), streaming rules,
  Grepr-only UDFs, and the compact gotchas table.
- `logs-to-metric.md` — the windowed-aggregation-to-`LOG_EVENT` case, worked.
- `grepr:test-pipeline-change` — plan → draft → approval → apply.
- `grepr:query-logs` — sampling mechanics. `grepr:describe-pipeline` — topology.
- `grepr:docs-commands` — live SQL function / data-type docs and
  `grepr docs:get schema://SqlOperation`. `grepr:cli` — `--conf` resolution.
