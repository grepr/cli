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

Two facts that shape every decision:

- **It runs after the post-warehouse (pre-exceptions) stage.** Raw logs written
  to the data lake keep their **original, unmasked** content; masking applies only
  to what flows onward — the exceptions branch, the reducer, and forwarding
  (vendor) sinks. So masking protects data leaving Grepr, not the raw dataset. The
  operator **cannot** mask the raw lake (it runs after the lake write); if a user
  needs that, surface it as a separate requirement the masking operator does not
  cover rather than assuming this scrubs the lake.
- **Masks are dynamically reconfigurable.** Editing `messageMasks`/`attributeMasks`
  updates the running pipeline in place (the regex databases rebuild) without a
  job restart, so iterating on patterns is cheap.

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

The operator has two fields. Each is a **label → regex** relationship; the label
becomes the literal `[label]` in masked output.

- **`messageMasks`** — `{ "<label>": "<regex>", ... }` applied to the `message`.
- **`attributeMasks`** — `[ { "path": ["seg", "seg"], "masks": { "<label>": "<regex>" } }, ... ]`.
  The `path` is a **list of segments** (a segment may itself contain a dot), so
  attribute `user.contact` is `["user", "contact"]`. Only **string** values at the
  exact path are masked; missing or non-string attributes are skipped. Paths must
  be unique.

Rules that bite:

| Rule | Why it matters |
|------|----------------|
| **Hyperscan syntax only** — no lookbehind, no backreferences (`\1`), no `\b` word-boundary in some builds. | The operator compiles patterns with Hyperscan; unsupported constructs fail at draft/apply, not offline. Keep patterns to character classes, quantifiers, anchors, and alternation. |
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
          "email": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"
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
  existing operator, include the existing masks (from Step 1) plus the new one.
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
| `Masking -> Exceptions`, `Exceptions -> Reducer`, `Reducer -> <sink>` (post-masking) | every match replaced by `[label]` (e.g. `[email]`); **no raw value survives** here. If one does, the regex missed it — fix and re-draft. |
| The raw data-lake write (pre-masking) | keeps the **original** value — expected, masking runs after the lake write. |

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
