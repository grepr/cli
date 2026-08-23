---
description: Mask or redact sensitive substrings (PII, secrets, emails, card numbers, tokens) in logs on a Grepr log-reducer pipeline using the masking operator — a dedicated regex-based masker, not SQL. Replaces each regex match with a decorated label (a match of the regex labeled "email" becomes "[email]") in the log message and at configured attribute paths. Emits a set-masking patch (the masking operator) and routes through test-pipeline-change. Use for "mask/redact PII", "scrub sensitive data", "hide emails/card numbers/tokens", or "stop masking".
allowed-tools: Bash(grepr query), Bash(grepr job:get), Bash(grepr job:plan), Bash(grepr job:draft), Bash(grepr --conf * query), Bash(grepr --conf * job:get), Bash(grepr --conf * job:plan), Bash(grepr --conf * job:draft), Read, Write, AskUserQuestion, grepr:describe-pipeline, grepr:test-pipeline-change, grepr:query
---

# Change Pipeline Masking

The **masking operator** scrubs sensitive substrings from logs by replacing
regex matches with decorated labels: a match of the regex labeled `email` becomes
the literal `[email]`. It masks the log `message` and string values at configured
attribute paths. Prefer this over a SQL `REGEXP_REPLACE` transform — it is
purpose-built for redaction, dynamically reconfigurable, and needs no SQL.

Three facts that shape every decision:

- **It gates the data-lake fan-out on the normal path.** Masking sits directly
  after the post-parsing (pre-warehouse) filter and feeds **both** the raw
  data-lake write and the step after it, so on that path nothing reaches Iceberg,
  the exceptions branch, the reducer, or the forwarding (vendor) sinks unmasked.
  It is **not** an unconditional guarantee — see the two bypasses below.
- **Two bypasses.** An **explicit SQL output edge** keeps its user-selected
  destination: only a `data-warehouse` target is redirected through the masker, so
  a pre-warehouse SQL output routed to `log-reducer` or `sinks` edges straight
  past it. And masking **fails open**: an event whose masking or predicate
  evaluation throws is tagged `grepr.failedOperations` and forwarded unmasked
  rather than dropped. Check both before calling a pipeline compliant, and say so
  explicitly when reporting coverage.
- **Masks are dynamically reconfigurable.** Editing `messageMasks`,
  `attributeMasks`, or `predicate` updates the running pipeline in place (the
  regex databases rebuild) without a job restart, so iterating on patterns is
  cheap.

This skill diagnoses and proposes; production writes happen only through
`grepr:test-pipeline-change` after explicit approval. Template-backed log-reducer
jobs only (the `masking` input does not exist on raw job graphs). Resolve the org
config (`--conf`) once and reuse it on every command — see the `grepr:cli` skill.

## Step 1 — Get context

Run `grepr:describe-pipeline <JOB_ID>` and note whether a `masking_operator`
vertex already exists (its `messageMasks`/`attributeMasks` are the current masks —
you will replace the whole operator, so read them first to avoid dropping masks
the user still wants). Also note the **raw dataset id** — you need it to sample
real logs and to confirm the raw lake stays unmasked.

## Step 2 — Sample the logs

Author masks against the real shape, not guesses. Query the raw dataset over a
bounded recent window — **last ~10 min, `--limit 100`** (query mechanics in
`grepr:query`):

```bash
grepr query --dataset-id <RAW_DS> --start <T0> --end <T1> --limit 100 -q -f raw -o sample.ndjson
```

Read the exact form of the sensitive data: is it in the `message` text, or already
parsed into an attribute (and at which path)? Copy a few real matches so you can
test your regex against them. A pattern that looks right but never matches the
real shape is the signature failure here.

## Step 3 — Author the masks

The operator has two mask fields plus an optional `predicate`. Each mask field is
a **label → mask** relationship; a mask is either a bare regex string (matches are
replaced with the literal `[label]`) or an object that says how to rewrite the
match:

```json
{ "regex": "<regex>", "replacement": "<text>", "preserveThrough": "<delimiter>" }
```

- `replacement` — text substituted for the match, instead of `[label]`.
- `preserveThrough` — keep the match up to and including the **first** occurrence
  of this delimiter, and rewrite only what follows. This is how you redact a
  value while keeping the key that names it: Hyperscan has no lookbehind, so
  match the key *and* the value, then split on the delimiter between them. A mask
  of `{"regex": "[?&][a-zA-Z_]+=[^& ]+", "preserveThrough": "=", "replacement":
  "<redacted>"}` turns `?token=abc123` into `?token=<redacted>`. If the delimiter
  does not occur inside the match, the whole match is replaced — a mismatched
  delimiter over-redacts rather than leaking.

The fields:

- **`messageMasks`** — `{ "<label>": <mask>, ... }` applied to the `message`.
- **`attributeMasks`** — `[ { "path": ["seg", "seg"], "masks": { "<label>": <mask> } }, ... ]`.
  The `path` is a **list of segments** (a segment may itself contain a dot), so
  attribute `user.contact` is `["user", "contact"]`. Only **string** values at the
  exact path are masked; missing or non-string attributes are skipped. Paths must
  be unique.
- **`predicate`** — optional query restricting which logs are masked at all, e.g.
  `{"type": "datadog-query", "query": "service:payments"}`. Omit it to mask every
  log. It gates the whole operator, so every mask shares one predicate; there is
  no per-mask predicate.

Rules that bite:

| Rule | Why it matters |
|------|----------------|
| **Hyperscan syntax only** — no lookbehind, no backreferences (`\1`), no `\b` word-boundary in some builds. | The operator compiles patterns with Hyperscan; unsupported constructs fail at draft/apply, not offline. Keep patterns to character classes, quantifiers, anchors, and alternation. Where a lookbehind is what you *want*, use `preserveThrough` instead. |
| **Prefer `+`/`*` over bounded repeats like `{1,50}`.** | Hyperscan unrolls a bounded repeat into that many copies of the sub-pattern, where `+` compiles to a self-loop. A bounded repeat alone compiles fine even at `{1,80}`, but combined with other unbounded context the unrolled graph can exceed the compile limit — `[?&][a-zA-Z_]{1,50}=[^& ]+` is rejected with "pattern is too large". Validation catches this at apply time. |
| **JSON-escape the regex.** A `\` in the pattern is `\\` in JSON (`\\d+`, `\\S+@\\S+`, `\\.`). | A single backslash is invalid JSON and silently mangles the pattern. |
| **Labels ≤ 64 chars**, become literal `[label]`. | Pick short, meaningful labels — they appear in every masked line and in the reduced output. |
| **Overlap resolution: leftmost match first, then longest, then declaration order.** | Declare the **more specific** pattern first so it wins over a broad one (e.g. a full-card pattern before a bare `\d+`). |
| A too-broad pattern over-masks. | `\\d+` masks every number, including ones you need for reduction/grouping. Scope patterns tightly and confirm against the Step-2 sample. |

Confirm with the user *what* to mask when it is theirs to decide (which fields
count as sensitive, how aggressive to be) — use `AskUserQuestion`. Do not
interrogate when the ask is explicit ("mask emails").

## Step 4 — Build the patch

Use the `set-masking` op — a first-class op that installs the operator as the
template `masking` input. The whole operator goes in the `masking` field. Write it
to `patch-masking-<tag>.json`:

```json
{
  "operations": [
    {
      "op": "set-masking",
      "masking": {
        "type": "masking-operator",
        "name": "masking_operator",
        "messageMasks": {
          "card": "[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}",
          "email": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
          "query_param": {
            "regex": "[?&][a-zA-Z_]+=[^& ]+",
            "preserveThrough": "=",
            "replacement": "<redacted>"
          }
        },
        "attributeMasks": [
          { "path": ["user", "contact"], "masks": { "email": "\\S+@\\S+" } }
        ]
      }
    }
  ]
}
```

Notes:

- `type` (`"masking-operator"`) and `name` are **required** by the template input
  schema; `set-masking` fills both in for you (`name` defaults to
  `masking_operator`) if you omit them, so a bare `messageMasks`/`attributeMasks`
  patch still applies. Set `name` explicitly only if you want a specific vertex name.
- `set-masking` **replaces** the whole masking operator. To add a mask to an
  existing operator, include the existing masks (from Step 1) plus the new one —
  **and carry the existing `predicate` through**. Dropping it widens masking from
  the scope the customer chose to all traffic, and the plan diff will not flag the
  removal.
- To **remove all masking**, use `clear-masking`:
  ```json
  { "operations": [ { "op": "clear-masking" } ] }
  ```
- `messageMasks` and `attributeMasks` both default to empty — set at least one, or
  the operator masks nothing.
- `set-masking`/`clear-masking` are **template-backed only** (rejected on raw job
  graphs). Do not hand-write `set-input-field` on `masking` — `set-masking` is the
  supported path.

See `grepr:operations-reference` for the `masking-operator` shape and the
`set-masking`/`clear-masking` op catalog.

## Step 5 — Hand off to test-pipeline-change

Follow `grepr:test-pipeline-change` for the plan → draft → approve → apply
mechanics. When inspecting the draft, confirm:

| Stage (in `.data.tags["sink-source"]`) | Expect |
|----------------------------------------|--------|
| `Post-parsing Filter -> Masking` (pre-masking) | the **original** value — this is the last stage that sees it. |
| `Masking -> Post-warehouse Filter` and everything after it (`Exceptions -> Reducer`, `Reducer -> <sink>`) | every match rewritten (`[label]`, or the mask's `replacement`); **no raw value survives** here, including in the raw data-lake write. If one does, the regex missed it — fix and re-draft. |
| A mask with `preserveThrough` | the key still readable, only the value rewritten (`?token=<redacted>`, not `[redacted]`). If the whole match vanished, the delimiter is not inside the match — check it. |

## Resources

- `grepr:operations-reference` — the `masking-operator` shape and the
  `set-masking`/`clear-masking` op catalog.
- `grepr:describe-pipeline` — read the current `masking_operator` and the raw
  dataset id.
- `grepr:test-pipeline-change` — plan → draft → approval → apply.
- `grepr:query` — sampling mechanics for authoring and verifying masks.
- `grepr:cli` — org config (`--conf`) resolution.
- For non-redaction row transforms (reshape, enrich, categorize) or windowed
  logs→metrics, use `grepr:build-sql-transform` instead.
