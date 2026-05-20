# Contributing a Skill to the Grepr Claude Plugin

This guide is for engineers and power users who want to add a new skill
to solve a recurring customer pain. The cheapest path is "write one new
skill, reuse all existing primitives." This document tells you how to
stay on that path.

## The mental model

The plugin has four layers — knowing which layer your change belongs to
is 80% of the design work:

| Layer | Examples | Who owns it |
|-------|----------|-------------|
| **CLI primitives** (infra) | `pipeline:edit`, `pipeline:plan`, `pipeline:draft`, `pipeline:apply`, `job:to-test` | Platform team |
| **Patch ops** (substrate) | `add-message-attribute`, `add-source`, `set-filter`, `set-input-field`, … | Platform team |
| **Safety harness** (one skill) | `test-pipeline-change` (draft-mode backed) | Platform team |
| **Intent skills** (many) | `tune-reduction`, `tune-grok`, `change-filtering`, `change-source`, … | **Anyone** |

**The rule:** users invoke intent skills. Intent skills emit patches and
hand them to the harness. The harness ends every flow at
`pipeline:apply`. You should rarely need to touch anything below "Intent
skills."

## Substrate: template inputs

Patches operate on `templateInputs.input` (a
`SchemaLogReducerTemplateInput`) on the pipeline's single
`template-operation` vertex — **not** on the resolved job graph. The
platform expands the template into a job graph at deploy time. This is
also the substrate the platform's draft-mode feature uses, which is why
the harness can verify changes end-to-end on a flink-session-cluster
before production apply.

Practically, this means:
- The template owns topology. You don't wire vertices manually; you put
  parsers in `input.parsers`, filters in phase slots, sources in
  `input.sources`, and the template threads them in the right order.
- The remapper lives **inside** `input.parsers` (as a vertex of type
  `log-attributes-remapper`), not as a top-level field.
- Filters are **phase-slotted**, not array-indexed. There's exactly one
  filter per phase: `pre-parser`, `pre-aggregation`, `pre-exceptions`,
  `pre-warehouse`.
- Exceptions live in `input.exceptions[]` as `TemplateException` entries
  (typed union: `query-exception`, `integration-exception`, etc.). The
  template translates these into reducer/integration exceptions at
  expansion time.

If your skill's pipeline isn't template-backed, the CLI fails fast with
"not template-backed." That's by design — every job will be
template-backed over time.

## Which category is your skill?

### 1. Field-level tuning (cheapest)

You're modifying fields on existing transform vertices (remapper,
reducer, grok parser, filter predicate). All the patch ops you need
already exist: `add-message-attribute`, `add-group-by`, `add-aggregation`,
`add-reducer-exception`, `add-grok-rule`, `set-input-field`,
`unset-input-field`.

Examples in this category: `tune-reduction`, `change-exceptions`.

### 2. Structural changes (cheap, with the dedicated ops)

You're adding/removing parsers, sources, or filter-phase slots. Use the
structural ops: `add-parser`, `remove-parser`, `set-filter`,
`clear-filter`, `add-source`, `remove-source`.

Examples: `change-filtering`, `tune-grok` (case B), `change-source`.

### 3. Workflow (composes the others)

You diagnose a multi-step user problem ("data doesn't look right",
"this new customer needs onboarding polish") and emit patches that may
span multiple field- or structural-level changes. No new patch ops; lots
of diagnostic logic.

Examples (future): `debug-data-shape`, `fix-onboarding`.

### Out of scope: sink changes

The draft harness has no readback verification for sink delivery. There
is no sink op in this surface, and the harness explicitly rejects
patches that modify sinks (via `set-input-field` on a `sinks.*` or
`processedLogsSink.*` path). If a sink-validation mechanism appears
later (e.g., vendor read-side APIs), we'll add the missing piece.

## Decision tree

```
"I want a skill that…"
│
├─ Modifies a field on an existing transform element (remapper, reducer)
│   └─ Category 1. Use existing semantic ops.
│
├─ Adds or removes a parser / filter / source
│   └─ Category 2. Use add-parser / set-filter / add-source.
│
├─ Modifies a sink
│   └─ Out of scope. No verification mechanism yet.
│
└─ Diagnoses a multi-step user problem
    └─ Category 3. Compose existing ops; no new infra.
```

## Skill template

Every intent skill follows the same shape. Copy and adapt:

```markdown
---
description: <one-sentence purpose + when to use it>
allowed-tools: Bash(grepr query), Bash(grepr pipeline:edit), Bash(grepr pipeline:plan), grepr:describe-pipeline, grepr:test-pipeline-change
trigger_keywords:
  - <phrasing the user would use>
  - <another phrasing>
---

# <Skill Title>

<2–3 sentences: when to use it, what it produces. State that it routes
through `grepr:test-pipeline-change`.>

## Step 1: Get Context

Run `grepr:describe-pipeline <JOB_ID>` first. Note the specific fields
your diagnosis needs.

## Step 2: Diagnose

<Concrete checks. Often a `grepr query` against the raw dataset, plus
reading specific config fields from describe-pipeline's output.>

## Step 3: Build the Patch

<Show one or two concrete JSON patch examples. Save to build/patch.json.>

## Step 4: Hand Off to test-pipeline-change

Invoke `grepr:test-pipeline-change` with `<JOB_ID>` and `build/patch.json`.

### What to verify in the test output

| What | Good sign |
|------|-----------|
| <metric> | <expected change> |

## Common Failure Modes

<2–4 likely things to go wrong, and how to recover.>

## Hand-off Boundary

This skill **diagnoses and proposes**. Production writes happen only via
`grepr:test-pipeline-change` after explicit user approval.
```

## Rules every skill must follow

1. **Never call `pipeline:apply` directly.** Always route through
   `grepr:test-pipeline-change`. The harness is the only thing allowed
   to write to prod.
2. **Never ask the user to confirm "apply to prod" yourself.** The
   harness handles confirmation.
3. **Always call `grepr:describe-pipeline` first** unless you're
   absolutely certain the user already gave you a fresh summary in this
   turn. Stale assumptions about pipeline shape cause most patch
   failures.
4. **Save artifacts under `build/`**, not `/tmp/` — repo convention.
5. **Frontmatter rules** (the CI enforces these via `validate.yml`):
   - Opening `---` on line 1
   - Closing `---`
   - A `description:` field
   - **No `name:` field** — that breaks plugin namespacing
6. **Echo errors verbatim.** When `pipeline:edit` or
   `test-pipeline-change` fails, show the actual error to the user.
   Don't paraphrase or "fix" it.

## When you actually do need a new patch op

A new patch op is a platform-team decision. Ask yourself:

- Can this be expressed as a composition of existing ops (specifically
  `set-input-field` / `unset-input-field` for arbitrary
  template-input edits)? If yes — no new op needed.
- Is this change going to recur across multiple skills? If only one
  skill needs it, `set-input-field` is fine; don't proliferate ops.
- Does it modify a sink? Wait for sink verification mechanism.

If the answers say "new op is right":
- Open a discussion with the platform team before writing code.
- The op goes into `tools/cli/src/main/typescript/lib/pipeline-patch.ts`
  in the grepr-server repo (then syncs to grepr/cli on merge).
- Add tests in `tools/cli/src/test/typescript/lib/pipeline-patch.test.ts`.
- Update `validateForDraftHarness` if the op can touch sinks.
- Add to `classifyPatch` if classification needs to differ.

## Where things live

- **This repo (`grepr/cli`)**: hand-authored `skills/*/SKILL.md`,
  `.claude-plugin/*.json`, `README.md`, `CHANGELOG.md`, this file.
- **Synced from `grepr/grepr-server`** (don't edit here): `src/`,
  `templates/`, `scripts/`, `package.json`, `tsconfig*.json`,
  `vitest.config.ts`, `eslint.config.mjs`.

## Testing a new skill

1. **`validate.yml` (CI)** — checks frontmatter shape. Passes if your
   skill has opening/closing `---`, a `description:`, and no `name:`.
2. **Manual dogfood** — load the skill in a Claude Code session pointed
   at a dev pipeline. Walk through the workflow with a realistic input
   and observe whether each step succeeds.
3. **Pair with an existing skill** — cross-reference siblings so users
   can discover related workflows.

## When in doubt

- Look at `tune-reduction` and `tune-grok` as canonical examples.
- Look at this guide's decision tree.
- Open a draft PR with a stub SKILL.md and a one-paragraph description —
  feedback before you've written 200 lines is cheap.
