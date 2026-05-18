# Unify grepr-cli and cli repos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `grepr/grepr-cli` (npm publishing repo for `@grepr/cli`) into `grepr/cli` (Claude Code plugin repo). After cutover, `grepr/cli` hosts both surfaces; `grepr/grepr-cli` is archived.

**Architecture:** Flat unified repo at `grepr/cli`, following the DataDog/pup pattern. CLI source paths (`src/`, `templates/`, `scripts/`, `package.json`, etc.) and plugin paths (`.claude-plugin/`, `skills/`) coexist at the repo root and never collide. A file-ownership allowlist in the sync workflow enforces the boundary: sync only ever deletes-and-recopies the synced paths, never touches hand-authored ones.

**Tech Stack:** GitHub Actions (sync workflow in grepr-server, npm-publish + validate workflows in cli), TypeScript/yarn (the CLI itself), Claude Code plugin manifests (JSON).

**Prerequisite info:**
- ENGT ticket: ENGT-4585 (https://www.notion.so/364e242667728148b598dce9cfaf233c)
- Engineer initials in branch names: `ms-` (Michael Sparre)
- Current published version of `@grepr/cli` on npm — capture via `npm view @grepr/cli version` in Task 0.1 Step 2 below

**Local path assumptions:**
Commands assume repos are cloned at `/Users/michaelsparre/Projects/{cli,grepr-cli,grepr-server}`. If your clones live elsewhere, substitute those paths in every `cd` and `cp` command.

Spec: `/Users/michaelsparre/Projects/cli/docs/superpowers/specs/2026-05-18-unify-cli-repos-design.md`

---

## File Structure

Changes touch three repos. Each repo has clear, separate responsibilities.

### `grepr/cli` (destination repo)

- Create: `cli/.claude-plugin/` (already exists — verify only)
- Create: `cli/skills/` (already exists — verify only)
- Create: `cli/src/`, `cli/templates/`, `cli/scripts/`, `cli/package.json`, `cli/yarn.lock`, `cli/tsconfig*.json`, `cli/eslint.config.mjs`, `cli/vitest.config.ts` (seeded from grepr-cli)
- Create: `cli/.github/workflows/npm-publish.yml` (seeded from grepr-cli)
- Modify: `cli/README.md` (rewrite to cover CLI + plugin install)
- Modify: `cli/CLAUDE.md` (extend to cover CLI dev guidance + plugin authoring)

### `grepr/grepr-server` (CLI source repo)

- Modify: `grepr-server/.github/workflows/grepr-cli-sync.yml` (target switches to `grepr/cli`, wipe-all logic replaced with allowlist-delete, dry-run mode added, safety assertion added)

### `grepr/grepr-cli` (becomes archive)

- No file changes. Final release note added via GitHub UI. Repo flipped to archived (read-only) via GitHub settings.

### External configuration (not in git)

- npm trusted publisher entry for `@grepr/cli` — add `grepr/cli` workflow alongside existing `grepr/grepr-cli` entry
- GitHub App `SYNC_APP_ID` repository scope — add `grepr/cli`

---

## Phase 0: Prerequisites

### Task 0.1: Capture context

- [x] **Step 1: ENGT ticket created**

ENGT-4585 — created 2026-05-18 in Sprint 69. Assigned to Michael. Notion: https://www.notion.so/364e242667728148b598dce9cfaf233c

- [ ] **Step 2: Capture current `@grepr/cli` published version**

Run: `npm view @grepr/cli version`
Record the output. Used in Task 2.1 to confirm the smoke-test skip logic works.

- [ ] **Step 3: Confirm npm trusted publisher admin access**

Verify you (or someone you can coordinate with) can edit trusted publishers for `@grepr/cli` at https://www.npmjs.com/package/@grepr/cli/access. Required before cutover (Task 4.2).

- [ ] **Step 4: Confirm GitHub App admin access**

Verify access to manage the `SYNC_APP_ID` GitHub App's repository scope. Required before cutover (Task 4.1).

If any of steps 3 or 4 are blocked, stop and resolve before proceeding past Phase 3.

---

## Phase 1: Seed `grepr/cli` with current CLI content

### Task 1.1: Create feature branch in cli

**Files:**
- None modified yet

- [ ] **Step 1: Create branch**

```bash
cd /Users/michaelsparre/Projects/cli
git checkout main
git pull origin main
git checkout -b ms-ENGT-4585-unify-with-grepr-cli
```

- [ ] **Step 2: Verify clean working tree**

Run: `git status`
Expected: `On branch ms-ENGT-4585-unify-with-grepr-cli`, `nothing to commit, working tree clean`

If the `docs/` directory from spec/plan writing is present and untracked, decide: keep on this branch (commit it later) or stash it. Recommended: keep — the spec and plan SHOULD be committed in this branch.

### Task 1.2: Copy CLI source files from grepr-cli into cli

**Files:**
- Create in cli: `src/`, `templates/`, `scripts/`, `package.json`, `yarn.lock`, `tsconfig.json`, `tsconfig.test.json`, `eslint.config.mjs`, `vitest.config.ts`

- [ ] **Step 1: Confirm grepr-cli is at the latest synced state**

```bash
cd /Users/michaelsparre/Projects/grepr-cli
git checkout main && git pull origin main
git log -1 --format='%H %s'
```
Expected: top commit is the most recent `Sync from grepr-server@<sha>` commit. Note the SHA.

- [ ] **Step 2: Copy synced paths into cli**

```bash
cd /Users/michaelsparre/Projects/cli
SRC=/Users/michaelsparre/Projects/grepr-cli
cp -r "$SRC/src" .
cp -r "$SRC/templates" .
cp -r "$SRC/scripts" .
cp "$SRC/package.json" .
cp "$SRC/yarn.lock" .
cp "$SRC/tsconfig.json" .
cp "$SRC/tsconfig.test.json" .
cp "$SRC/eslint.config.mjs" .
cp "$SRC/vitest.config.ts" .
```

- [ ] **Step 3: Verify the copy**

Run: `ls cli/`
Expected output includes: `.claude-plugin`, `skills`, `src`, `templates`, `scripts`, `package.json`, `yarn.lock`, `tsconfig.json`, `tsconfig.test.json`, `eslint.config.mjs`, `vitest.config.ts`, `README.md`, `CHANGELOG.md`, `LICENSE`, `.github/`

### Task 1.3: Copy npm-publish workflow into cli

**Files:**
- Create: `cli/.github/workflows/npm-publish.yml`

- [ ] **Step 1: Copy the workflow file**

```bash
cp /Users/michaelsparre/Projects/grepr-cli/.github/workflows/npm-publish.yml \
   /Users/michaelsparre/Projects/cli/.github/workflows/npm-publish.yml
```

- [ ] **Step 2: Verify the copy**

Run: `ls cli/.github/workflows/`
Expected: `npm-publish.yml`, `validate.yml`

- [ ] **Step 3: Confirm workflow contents**

```bash
head -20 /Users/michaelsparre/Projects/cli/.github/workflows/npm-publish.yml
```
Expected: starts with `name: Publish CLI to npm`, triggers on `push: branches: [main], paths: ['src/**', 'package.json', ...]`.

### Task 1.4: Rewrite README.md to cover both surfaces

**Files:**
- Modify: `cli/README.md`

- [ ] **Step 1: Read the current cli README and the current grepr-cli README**

The cli README focuses on plugin install. The grepr-cli README focuses on CLI install. The unified version covers both.

- [ ] **Step 2: Write the unified README**

Replace `/Users/michaelsparre/Projects/cli/README.md` with content that includes these sections, in this order:

1. Title + one-line "Grepr CLI and Claude Code plugin"
2. Quick reference: which install do you want?
   - Just the CLI → `npm install -g @grepr/cli` (link to CLI section)
   - CLI + Claude Code skills → install plugin (link to plugin section)
3. **CLI install** section: lift from existing grepr-cli README (`npm install -g @grepr/cli`, requirements: Node 18+, quick start with `grepr --org-name ... config:save`, etc., link to `https://docs.grepr.ai/cli`)
4. **Claude Code plugin install** section: lift from existing cli README (the `/plugin marketplace add grepr/cli` flow, what the plugin does, skills table)
5. **Authentication / Output formats** subsections (lift from grepr-cli README)
6. **Updating** section (combined: `npm update -g @grepr/cli` for CLI, `/plugin install grepr@grepr-cli` for plugin)
7. **Issues** — point to `github.com/grepr/cli/issues` (single location now)
8. **License** — Apache-2.0

Do NOT carry over any "this repo is automatically synced from grepr-server" verbiage to the top of the README — that's internal-mechanic info and doesn't belong in a user-facing doc.

- [ ] **Step 3: Sanity check links**

```bash
cd /Users/michaelsparre/Projects/cli
grep -nE '\]\([^)]+\)' README.md | grep -v '^#' | head -20
```
Expected: links resolve to known destinations (docs.grepr.ai, github.com/grepr/cli). No leftover references to `grepr/grepr-cli` except possibly an explicit "previously published from grepr/grepr-cli" historical note (optional).

### Task 1.5: Merge CLAUDE.md files

**Files:**
- Modify: `cli/CLAUDE.md`

- [ ] **Step 1: Inspect both CLAUDE.md files**

Current cli CLAUDE.md: focused on plugin authoring.
Current grepr-cli/CLAUDE.md (from grepr-server tools/cli): focused on TypeScript dev rules (avoid `any`, `unknown`, type assertions; run `yarn typecheck`).

- [ ] **Step 2: Write the merged CLAUDE.md**

Replace `/Users/michaelsparre/Projects/cli/CLAUDE.md` with two sections clearly delimited:

```markdown
# grepr/cli

Unified repo for the Grepr CLI (npm: `@grepr/cli`) and the Grepr Claude Code plugin.

## CLI development (`src/`, `templates/`, `scripts/`, `package.json`)

**These files are synced from `grepr-server/tools/cli/` — edit them THERE, not here.**

If you're working on the CLI itself:
1. Edit in `grepr/grepr-server/tools/cli/`
2. Tests run via `cli-check.yml` in grepr-server
3. On a version tag pushed to grepr-server, the sync workflow copies changes here

TypeScript rules (when working on CLI source in grepr-server):
- Avoid `any` and `unknown` types unless absolutely necessary
- Avoid type assertions (`as Type`) unless absolutely necessary
- Run `yarn typecheck` after changes
- Tests: `yarn test`, single file: `yarn test src/test/typescript/lib/foo.test.ts`

## Plugin development (`.claude-plugin/`, `skills/`)

**These files are hand-authored in THIS repo — edit directly.**

If you're working on the plugin:
1. Edit `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, or any `skills/*/SKILL.md` here
2. `validate.yml` enforces shape rules on every PR
3. When bumping plugin version: update BOTH `plugin.json.version` AND `marketplace.json.plugins[0].version` (validate enforces match)
4. CHANGELOG.md tracks plugin changes only (not CLI versions — those follow grepr-server tags)
```

### Task 1.6: Verify local build, test, and validate pass

**Files:**
- No changes — only verification

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/michaelsparre/Projects/cli
yarn install --frozen-lockfile
```
Expected: completes without errors.

- [ ] **Step 2: Run build**

```bash
yarn build
ls -la build/dist/
node build/dist/grepr.js --version
```
Expected: `build/dist/grepr.js` exists; `--version` outputs the current `package.json` version (e.g., `1.3.0-994a118`).

- [ ] **Step 3: Run tests**

```bash
yarn test
```
Expected: all tests pass.

- [ ] **Step 4: Run typecheck**

```bash
yarn typecheck
```
Expected: no errors.

- [ ] **Step 5: Run plugin validate locally**

Replicate the `validate.yml` checks locally:

```bash
cd /Users/michaelsparre/Projects/cli
jq -e '.name | type == "string"' .claude-plugin/plugin.json
jq -e '.version | type == "string"' .claude-plugin/plugin.json
jq -e '.description | type == "string"' .claude-plugin/plugin.json
jq -e '.license == "Apache-2.0"' .claude-plugin/plugin.json
jq -e '.name | type == "string"' .claude-plugin/marketplace.json
jq -e '(.plugins | length) > 0' .claude-plugin/marketplace.json
plugin_name=$(jq -r '.name' .claude-plugin/plugin.json)
marketplace_plugin_name=$(jq -r '.plugins[0].name' .claude-plugin/marketplace.json)
[ "$plugin_name" = "$marketplace_plugin_name" ] && echo "names match"
plugin_version=$(jq -r '.version' .claude-plugin/plugin.json)
marketplace_version=$(jq -r '.plugins[0].version' .claude-plugin/marketplace.json)
[ "$plugin_version" = "$marketplace_version" ] && echo "versions match"
```
Expected: all jq assertions return truthy (`true` printed), name/version match messages printed.

- [ ] **Step 6: Validate skill frontmatter**

```bash
fail=0
for f in skills/*/SKILL.md; do
  head -1 "$f" | grep -q '^---$' || { echo "$f: missing opening ---"; fail=1; }
  closing_line=$(awk '/^---$/{c++; if(c==2){print NR; exit}}' "$f")
  [ -n "$closing_line" ] || { echo "$f: missing closing ---"; fail=1; }
done
[ $fail -eq 0 ] && echo "skills OK"
```
Expected: `skills OK` printed.

If any step 1–6 fails, fix before proceeding.

### Task 1.7: Commit the seed and push

**Files:**
- Stages everything created in Tasks 1.2–1.5

- [ ] **Step 1: Stage files by name (avoid `git add -A`)**

```bash
cd /Users/michaelsparre/Projects/cli
git add src templates scripts package.json yarn.lock tsconfig.json tsconfig.test.json eslint.config.mjs vitest.config.ts
git add .github/workflows/npm-publish.yml
git add README.md CLAUDE.md
git add docs/superpowers/specs/2026-05-18-unify-cli-repos-design.md
git add docs/superpowers/plans/2026-05-18-unify-cli-repos.md
git status
```
Expected: only the expected files staged; nothing under `.claude-plugin/` or `skills/` modified.

- [ ] **Step 2: Commit**

```bash
git commit -m "[ENGT-4585] Seed cli repo with CLI source and publish workflow

Brings @grepr/cli source files and npm-publish workflow into cli/
from grepr-cli, in preparation for cutover. README and CLAUDE.md
rewritten to cover both surfaces. See spec at
docs/superpowers/specs/2026-05-18-unify-cli-repos-design.md."
```

- [ ] **Step 3: Push the branch**

```bash
git push -u origin ms-ENGT-4585-unify-with-grepr-cli
```

- [ ] **Step 4: Open a draft PR**

```bash
gh pr create --draft --title "[ENGT-4585] Unify grepr-cli into cli" \
  --body "Spec: docs/superpowers/specs/2026-05-18-unify-cli-repos-design.md
Plan: docs/superpowers/plans/2026-05-18-unify-cli-repos.md

This PR seeds the cli repo with CLI source and the npm-publish workflow.
It is NOT merged until prerequisites in Phase 4 are complete (GitHub App
scope and npm trusted publisher entry)."
```
Expected: PR URL printed.

- [ ] **Step 5: Verify CI on the PR**

Run: `gh pr checks`
Expected: `validate` workflow passes on the PR. The `npm-publish` workflow should NOT fire (it only triggers on push to main).

---

## Phase 2: Smoke-test npm-publish on the seed branch

**Limitation discovered during execution**: `workflow_dispatch` requires the workflow file to exist on the default branch. Since `npm-publish.yml` doesn't exist on `cli@main` until Phase 5 merge, this dispatch returns HTTP 404. Phase 2 is therefore effectively deferred — the real smoke test happens automatically on the first push to main (the Phase 5 merge) which triggers the workflow via the `push: branches: [main]` paths filter. The version-skip check (`@grepr/cli@1.3.0-994a118` already exists on npm) prevents any actual publish during that first run.

### Task 2.1: Run npm-publish via workflow_dispatch on the seed branch

**SKIPPED during execution** (see limitation above). Documented for completeness; the equivalent validation occurs in Task 5.2 Step 4.

**Files:**
- No changes — only verification

- [ ] **Step 1: Trigger the workflow on the feature branch**

```bash
cd /Users/michaelsparre/Projects/cli
gh workflow run npm-publish.yml --ref ms-ENGT-4585-unify-with-grepr-cli
```
Expected: `✓ Created workflow_dispatch event for npm-publish.yml at ms-ENGT-4585-unify-with-grepr-cli`.

- [ ] **Step 2: Watch the run**

```bash
gh run watch
```
(Pick the most recent npm-publish run if prompted.)

- [ ] **Step 3: Verify the result**

The expected outcome is that the `check-version` job runs, reports `Version <X.Y.Z> already exists on npm, skipping`, and the `publish-cli` job is SKIPPED (not failed). Confirm:

```bash
gh run list --workflow=npm-publish.yml --branch=ms-ENGT-4585-unify-with-grepr-cli --limit=1
```
Expected: status `completed`, conclusion `success`.

If conclusion is `failure`, investigate the logs:
```bash
gh run view --log <RUN_ID>
```
Common cause: trusted publisher not configured for `grepr/cli` yet. If so, the publish step itself never runs (skip should succeed), so a failure here likely indicates a different issue (build, test, missing dependency).

If the test SUCCEEDED in skipping (the expected path), we have not yet validated the actual publish — that happens in Phase 5 after the trusted publisher is added.

---

## Phase 3: Rewrite sync workflow in grepr-server

### Task 3.1: Create feature branch in grepr-server

**Files:**
- None modified yet

- [ ] **Step 1: Create branch**

```bash
cd /Users/michaelsparre/Projects/grepr-server
git checkout main
git pull origin main
git checkout -b ms-ENGT-4585-retarget-cli-sync
```

- [ ] **Step 2: Verify clean working tree**

Run: `git status`
Expected: clean.

### Task 3.2: Rewrite grepr-cli-sync.yml

**Files:**
- Modify: `grepr-server/.github/workflows/grepr-cli-sync.yml`

- [ ] **Step 1: Replace the workflow with the new content**

Overwrite `/Users/michaelsparre/Projects/grepr-server/.github/workflows/grepr-cli-sync.yml` with the following:

```yaml
name: Sync CLI to cli

on:
  push:
    tags: ['[0-9]*.[0-9]*.[0-9]*']
  workflow_dispatch:
    inputs:
      ref:
        description: 'Tag or SHA to sync from (defaults to current branch HEAD)'
        required: false
        type: string
      dry_run:
        description: 'Dry run — log operations without modifying cli repo'
        required: false
        type: boolean
        default: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout grepr-server
      uses: actions/checkout@v6
      with:
        path: grepr-server
        fetch-tags: true
        ref: ${{ inputs.ref || github.ref }}

    - name: Generate Sync Token
      id: generate-token
      uses: actions/create-github-app-token@v2
      with:
        app-id: ${{ secrets.SYNC_APP_ID }}
        private-key: ${{ secrets.SYNC_APP_PRIVATE_KEY }}
        owner: grepr
        repositories: cli

    - name: Checkout cli
      uses: actions/checkout@v6
      with:
        repository: grepr/cli
        path: cli
        token: ${{ steps.generate-token.outputs.token }}

    - name: Determine version
      id: version
      run: |
        # Tag-triggered runs use github.ref_name; workflow_dispatch can take an explicit ref.
        if [ -n "${{ inputs.ref }}" ]; then
          REF="${{ inputs.ref }}"
        else
          REF="${{ github.ref_name }}"
        fi
        # Strip refs/tags/ prefix if present
        VERSION="${REF#refs/tags/}"
        echo "version=$VERSION" >> $GITHUB_OUTPUT
        echo "Sync version: $VERSION"

    - name: Update tools/cli package.json version
      working-directory: grepr-server/tools/cli
      run: |
        VERSION="${{ steps.version.outputs.version }}"
        jq --arg version "$VERSION" '.version = $version' package.json > package.json.tmp
        mv package.json.tmp package.json
        echo "Updated package.json version: $VERSION"

    - name: Sync CLI code (allowlist-managed paths only)
      run: |
        set -euo pipefail

        SYNC_PATHS=(
          "src"
          "templates"
          "scripts"
          "package.json"
          "yarn.lock"
          "tsconfig.json"
          "tsconfig.test.json"
          "eslint.config.mjs"
          "vitest.config.ts"
          ".gitignore"
          ".github/workflows/npm-publish.yml"
        )

        DRY_RUN="${{ inputs.dry_run }}"

        for path in "${SYNC_PATHS[@]}"; do
          src="grepr-server/tools/cli/$path"
          dst="cli/$path"

          # The CLI source in grepr-server stores TypeScript under src/main and src/test,
          # whereas grepr-cli flattens these into src/. Handle src/ specially.
          if [ "$path" = "src" ]; then
            echo "[sync] src/ — copying src/main and src/test into cli/src/"
            if [ "$DRY_RUN" = "true" ]; then
              echo "  (dry-run) would: rm -rf cli/src && mkdir cli/src && cp -r grepr-server/tools/cli/src/main cli/src && cp -r grepr-server/tools/cli/src/test cli/src"
            else
              rm -rf cli/src
              mkdir -p cli/src
              cp -r grepr-server/tools/cli/src/main cli/src/
              cp -r grepr-server/tools/cli/src/test cli/src/
            fi
            continue
          fi

          if [ ! -e "$src" ]; then
            echo "[sync] $path — source does not exist in grepr-server/tools/cli, skipping"
            continue
          fi

          if [ "$DRY_RUN" = "true" ]; then
            echo "[sync] (dry-run) would: rm -rf $dst && cp -r $src $dst"
          else
            echo "[sync] $path"
            rm -rf "$dst"
            mkdir -p "$(dirname "$dst")"
            cp -r "$src" "$dst"
          fi
        done

    - name: Post-copy safety assertions (hand-authored paths still exist)
      if: ${{ inputs.dry_run != true }}
      run: |
        set -euo pipefail
        required_paths=(
          "cli/.claude-plugin/marketplace.json"
          "cli/.claude-plugin/plugin.json"
          "cli/skills"
          "cli/README.md"
          "cli/CHANGELOG.md"
          "cli/LICENSE"
          "cli/.github/workflows/validate.yml"
        )
        for p in "${required_paths[@]}"; do
          if [ ! -e "$p" ]; then
            echo "ERROR: hand-authored path missing after sync: $p"
            exit 1
          fi
        done
        echo "All hand-authored paths intact."

    - name: Commit and push
      if: ${{ inputs.dry_run != true }}
      working-directory: cli
      run: |
        git config user.name "grepr-cli-sync[bot]"
        git config user.email "${{ secrets.SYNC_APP_ID }}+grepr-cli-sync[bot]@users.noreply.github.com"

        git add -A

        if git diff --staged --quiet; then
          echo "No changes to sync"
          exit 0
        fi

        cd ../grepr-server
        git log -1 --format=%B > ../commit_message.txt
        cd ../cli

        VERSION="${{ steps.version.outputs.version }}"
        SHA=$(cd ../grepr-server && git rev-parse HEAD)

        {
          echo "Sync grepr-cli v$VERSION from grepr-server@$SHA"
          echo ""
          cat ../commit_message.txt
        } > ../final_message.txt

        git commit --file ../final_message.txt
        git push

    - name: Dry-run summary
      if: ${{ inputs.dry_run == true }}
      run: |
        echo "## Dry run complete" >> $GITHUB_STEP_SUMMARY
        echo "No commits made to grepr/cli. Review the sync log above to verify expected operations." >> $GITHUB_STEP_SUMMARY
```

Key changes vs. the previous workflow:
1. Target repo: `grepr/grepr-cli` → `grepr/cli`
2. `repositories: grepr-cli` in token generation → `repositories: cli`
3. Wipe-everything (`find . -maxdepth 1 -not -name '.git' -exec rm -rf {} +`) → explicit allowlist
4. Special handling for `src/` (grepr-server splits `src/main` + `src/test`; cli flattens to `src/{main,test}/`)
5. `inputs.dry_run` toggle to preview operations
6. `inputs.ref` toggle to test against a specific tag/SHA without pushing a new tag
7. Post-copy safety assertion verifies hand-authored paths still exist
8. Commit message format unchanged

### Task 3.3: Push the branch and open a PR

**Files:**
- Stages `grepr-cli-sync.yml`

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/michaelsparre/Projects/grepr-server
git add .github/workflows/grepr-cli-sync.yml
git commit -m "[ENGT-4585] Retarget CLI sync to grepr/cli with allowlist semantics

Switches sync target from grepr/grepr-cli to unified grepr/cli.
Replaces wipe-everything with explicit path allowlist so hand-authored
plugin content (skills/, .claude-plugin/, README, CHANGELOG) cannot be
clobbered. Adds dry-run mode and post-copy safety assertion.

Will not take effect until grepr/cli has been seeded (separate PR in
grepr/cli) and the SYNC_APP_ID GitHub App scope is updated to include
grepr/cli."
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin ms-ENGT-4585-retarget-cli-sync
```

- [ ] **Step 3: Open a draft PR**

```bash
gh pr create --draft --title "[ENGT-4585] Retarget CLI sync to grepr/cli" \
  --body "Companion to grepr/cli#<PR_NUMBER_FROM_TASK_1.7>.

Switches the sync target and replaces wipe-everything with an explicit
path allowlist. Must NOT merge until:
1. grepr/cli seed PR is ready (Phase 1 complete)
2. SYNC_APP_ID GitHub App scope updated to include grepr/cli (Task 4.1)

Dry-run mode validated in Task 3.4."
```

Dry-run validation moves to Task 4.4, after both prerequisite configurations (GitHub App scope and npm trusted publisher) are in place.

---

## Phase 4: Operations (manual prerequisites for cutover)

### Task 4.1: Update GitHub App SYNC_APP_ID scope to include grepr/cli

**Files:**
- None — configuration change on github.com

- [ ] **Step 1: Identify the GitHub App**

In grepr-server's repository secrets, `SYNC_APP_ID` is the App ID. Find the corresponding app in the `grepr` organization's GitHub Apps settings (https://github.com/organizations/grepr/settings/apps).

- [ ] **Step 2: Add grepr/cli to the app's repository access**

In the app's repository access settings:
- Existing: `grepr/grepr-cli`
- Add: `grepr/cli`
- Keep both during cutover. Remove `grepr/grepr-cli` later (Phase 6).

- [ ] **Step 3: Verify token issuance**

Trigger the dry-run from Task 3.4 (Step 1). The "Checkout cli" step should now succeed.

### Task 4.2: Register grepr/cli as a trusted publisher on npm

**Files:**
- None — configuration change on npmjs.com

- [ ] **Step 1: Navigate to npm package settings**

Open https://www.npmjs.com/package/@grepr/cli/access and scroll to "Trusted Publishing".

- [ ] **Step 2: Add a new trusted publisher**

Configure:
- Repository owner: `grepr`
- Repository name: `cli`
- Workflow filename: `npm-publish.yml`
- Environment (if any): leave blank unless `grepr/grepr-cli` had one set
- Keep the existing `grepr/grepr-cli` publisher entry — remove it in Phase 6 after a successful cutover publish.

- [ ] **Step 3: Confirm the entry is saved**

Reload the access page; the new entry should appear with status "Active".

### Task 4.3: Confirm npm trusted publisher list

**Files:**
- None — verification only

- [ ] **Step 1: Visually verify both entries**

Open https://www.npmjs.com/package/@grepr/cli/access. Both `grepr/grepr-cli` AND `grepr/cli` must appear under Trusted Publishing. No way to dry-run a trusted publisher exchange without an actual publish — that's validated in Phase 5.

### Task 4.4: Validate the new sync workflow via dry-run

This is the workflow's "test". With the GitHub App scope updated (Task 4.1), the workflow can checkout `grepr/cli`. With dry_run=true, no commit is pushed.

**Files:**
- No changes — only verification

- [ ] **Step 1: Trigger workflow_dispatch on the feature branch with dry_run=true**

```bash
cd /Users/michaelsparre/Projects/grepr-server
gh workflow run grepr-cli-sync.yml \
  --ref ms-ENGT-4585-retarget-cli-sync \
  -f dry_run=true \
  -f ref=$(git rev-parse main)
```

- [ ] **Step 2: View the run log**

```bash
gh run list --workflow=grepr-cli-sync.yml --branch=ms-ENGT-4585-retarget-cli-sync --limit=1
gh run view --log <RUN_ID>
```

Expected: the "Sync CLI code" step prints lines like `[sync] (dry-run) would: rm -rf cli/templates && cp -r grepr-server/tools/cli/templates cli/templates` for each path in SYNC_PATHS. The "Commit and push" step is skipped (due to `if: ${{ inputs.dry_run != true }}`).

If a path is logged that we did NOT intend to sync (or one we DID intend is missing), update SYNC_PATHS in the workflow YAML, push the fix, and re-run.

If "Checkout cli" fails with permission denied, Task 4.1 is incomplete — fix the GitHub App scope and re-run.

---

## Phase 5: Cutover

This is the irreversible (without rollback) section. Execute these in close succession, ideally within an hour. Pause and confirm before each step.

### Task 5.1: Merge sync workflow change to grepr-server main

**Files:**
- Merges `grepr-server` PR from Task 3.3

- [ ] **Step 1: Verify PR readiness**

```bash
cd /Users/michaelsparre/Projects/grepr-server
gh pr checks
```
Expected: all required checks pass.

- [ ] **Step 2: Switch PR out of draft and merge**

```bash
gh pr ready
gh pr merge --squash
```
Or use the GitHub UI per team norms. Use whichever merge style the repo's branch protection requires.

- [ ] **Step 3: Confirm merge**

```bash
git checkout main && git pull
git log -1 --format='%s'
```
Expected: top commit message starts with `[ENGT-4585] Retarget CLI sync`.

### Task 5.2: Merge seed branch to cli main

**Files:**
- Merges `cli` PR from Task 1.7

- [ ] **Step 1: Verify PR readiness**

```bash
cd /Users/michaelsparre/Projects/cli
gh pr checks
```
Expected: `validate` workflow passes.

- [ ] **Step 2: Switch PR out of draft and merge**

```bash
gh pr ready
gh pr merge --squash
```

- [ ] **Step 3: Confirm merge**

```bash
git checkout main && git pull
git log -1 --format='%s'
```

- [ ] **Step 4: Check that the post-merge push to main does NOT trigger a publish**

When this merge commit lands on main, `npm-publish.yml` will trigger (it watches `src/**`, `package.json`, etc., and those just appeared). It will hit the version-skip check and exit cleanly. Verify:

```bash
gh run list --workflow=npm-publish.yml --branch=main --limit=1
```
Expected: status `completed`, conclusion `success`. Inspect logs to confirm `Version <X.Y.Z> already exists on npm, skipping`.

### Task 5.3: Trigger first real sync from grepr-server

**Files:**
- None — workflow run only

- [ ] **Step 1: Run sync via workflow_dispatch with dry_run=false**

```bash
cd /Users/michaelsparre/Projects/grepr-server
gh workflow run grepr-cli-sync.yml -f dry_run=false -f ref=$(git rev-parse main)
```

Note: we're explicitly passing `ref=<main HEAD>` rather than a tag. This causes the version to be set to the SHA-ish string (`<SHA>`), which won't match a semver pattern and won't conflict with any published version. If you prefer to trigger via a tag instead (cleaner version), check the latest semver tag with `git tag --sort=-version:refname | head -1` and pass that as `ref`.

Alternative: push a no-op semver tag bump, e.g. if current is `1.3.X` push `1.3.X+1` (with no code change). This is cleaner but commits to a real publish.

Decision: prefer the workflow_dispatch path. The first sync purpose is to validate the path, not produce a published artifact.

- [ ] **Step 2: Watch the run**

```bash
gh run watch
```

- [ ] **Step 3: Verify the commit lands in grepr/cli**

```bash
cd /Users/michaelsparre/Projects/cli
git checkout main && git pull
git log -1 --format='%s%n%b'
```
Expected: top commit subject `Sync grepr-cli v<VERSION> from grepr-server@<SHA>`. The `<VERSION>` may be the literal main SHA if you didn't sync a tag; that's fine.

### Task 5.4: Verify the sync didn't clobber hand-authored content

**Files:**
- None — verification only

- [ ] **Step 1: Confirm key hand-authored paths still exist and are unchanged**

```bash
cd /Users/michaelsparre/Projects/cli
git diff HEAD~1 -- .claude-plugin/ skills/ README.md CHANGELOG.md CLAUDE.md .github/workflows/validate.yml
```
Expected: empty output (no diff). If non-empty, something is wrong — investigate before proceeding.

- [ ] **Step 2: Confirm synced paths DID change as expected**

```bash
git diff --stat HEAD~1 -- src/ templates/ scripts/ package.json yarn.lock tsconfig*.json eslint.config.mjs vitest.config.ts .github/workflows/npm-publish.yml
```
Expected: only these paths show in the diff. Numbers will depend on what actually changed in grepr-server since the last sync.

### Task 5.5: Verify validate.yml passes on the sync commit

**Files:**
- None — verification only

- [ ] **Step 1: Wait for validate.yml run**

```bash
cd /Users/michaelsparre/Projects/cli
gh run list --workflow=validate.yml --branch=main --limit=1
```
Expected: triggered by the sync commit, status `completed`, conclusion `success`.

If failure: investigate the validation step that broke. Most likely culprits — `.claude-plugin/` got mutated (unexpected!) or skill frontmatter unrelated change.

### Task 5.6: Verify npm-publish behaves correctly

**Files:**
- None — verification only

- [ ] **Step 1: Watch the publish workflow run triggered by sync**

If the sync commit changed `src/`, `package.json`, `tsconfig.json`, `scripts/`, or `templates/`, `npm-publish.yml` will trigger.

```bash
gh run list --workflow=npm-publish.yml --branch=main --limit=1
```

- [ ] **Step 2: If a new version was synced, confirm publish succeeded**

If the sync set `package.json` version to a new value (because you synced from a fresh tag in Task 5.3 alt), expected: `publish-cli` job runs, the npm publish step succeeds, and `https://www.npmjs.com/package/@grepr/cli` shows the new version within a minute.

If the publish step fails with a "trusted publisher" error, the trusted publisher entry from Task 4.2 is missing or misconfigured. Revert: no rollback needed; just fix the npm entry and re-run via `gh workflow run npm-publish.yml --ref main`.

- [ ] **Step 3: If no new version (workflow_dispatch from main SHA), confirm skip**

If you used `ref=<main SHA>` in Task 5.3, the version may already exist or be a SHA-string that npm rejects. The version-skip check should handle either case. Expected: `check-version` reports skip OR publish fails cleanly without claiming a name on npm.

If the SHA-version causes `publish-cli` to attempt a publish that npm rejects with an "invalid version" error, no harm done — the version was never claimed. Just note this in the team channel and proceed.

---

## Phase 6: Wind down grepr-cli

### Task 6.1: Add final release note pointing to the new repo

**Files:**
- None in this repo — GitHub UI / API operation

- [ ] **Step 1: Identify the latest release in grepr-cli**

```bash
gh release list --repo grepr/grepr-cli --limit 1
```

- [ ] **Step 2: Edit the latest release to add a deprecation notice**

```bash
gh release edit <TAG> --repo grepr/grepr-cli \
  --notes "This repository has been merged into [grepr/cli](https://github.com/grepr/cli). New @grepr/cli versions are published from there. Issues, PRs, and discussions: https://github.com/grepr/cli."
```

Alternatively, create a new release with no version bump (`v<current>-archive` or similar) carrying the deprecation message — depends on team preference.

### Task 6.2: Archive grepr-cli on GitHub

**Files:**
- None — GitHub settings operation

- [ ] **Step 1: Update the repository description**

Via the GitHub UI or API:

```bash
gh repo edit grepr/grepr-cli \
  --description "ARCHIVED. Merged into https://github.com/grepr/cli."
```

- [ ] **Step 2: Archive the repo**

```bash
gh api -X PATCH /repos/grepr/grepr-cli -f archived=true
```

Or in the UI: Settings → General → Danger Zone → Archive this repository.

- [ ] **Step 3: Confirm archived**

```bash
gh repo view grepr/grepr-cli --json isArchived
```
Expected: `{"isArchived": true}`.

### Task 6.3: Update external pointers

**Files:**
- Any docs page, internal Slack pin, internal wiki entry referencing `grepr/grepr-cli`

- [ ] **Step 1: Search the public docs repo (grepr-server/docs/) for references**

```bash
cd /Users/michaelsparre/Projects/grepr-server
rg -n 'grepr/grepr-cli|github\.com/grepr/grepr-cli' docs/ || echo "no references"
```

- [ ] **Step 2: For each hit, replace `grepr/grepr-cli` with `grepr/cli`**

Make the changes, commit, and push to a new branch in grepr-server (`ms-ENGT-4585-update-docs-after-unify`). Open a PR.

- [ ] **Step 3: Check internal pinned messages**

Manually scan team Slack channels and internal wiki pages for references. Update as needed. Not automatable.

### Task 6.4: Remove grepr/grepr-cli from npm trusted publishers

**Files:**
- None — npmjs.com configuration

- [ ] **Step 1: Confirm a successful publish from grepr/cli has occurred**

Verify at https://www.npmjs.com/package/@grepr/cli that the most recent version was published from `grepr/cli` (npm shows the source repository for OIDC-published versions).

- [ ] **Step 2: Remove the grepr/grepr-cli trusted publisher entry**

At https://www.npmjs.com/package/@grepr/cli/access, remove the `grepr/grepr-cli` row from Trusted Publishing. Keep only `grepr/cli`.

### Task 6.5: Remove grepr/grepr-cli from the GitHub App scope

**Files:**
- None — github.com configuration

- [ ] **Step 1: Open the SYNC_APP_ID GitHub App's repository access settings**

(Same path as Task 4.1.)

- [ ] **Step 2: Remove `grepr/grepr-cli` from the repository list**

Keep only `grepr/cli`.

---

## Done state

After all phases complete:

- `grepr/cli` hosts CLI source (synced) + Claude Code plugin (hand-authored). `@grepr/cli` is published from here on every grepr-server tag.
- `grepr/grepr-cli` is archived, read-only, with a deprecation pointer.
- `grepr/grepr-server` syncs to `grepr/cli` (allowlist-managed) on every semver tag.
- npm trusted publishers list contains only `grepr/cli`.
- SYNC_APP_ID GitHub App is scoped only to `grepr/cli`.
- Internal docs and external README links point to `grepr/cli`.

---

## Rollback plan (any point before Task 5.1)

Before sync workflow merge in step 5.1, nothing is in production. Just abandon the branches:

```bash
cd /Users/michaelsparre/Projects/grepr-server && git checkout main && git branch -D ms-ENGT-4585-retarget-cli-sync
cd /Users/michaelsparre/Projects/cli && git checkout main && git branch -D ms-ENGT-4585-unify-with-grepr-cli
```

Trusted publisher and GitHub App entries for `grepr/cli` are inert if nothing publishes/syncs from there. Optionally remove them.

## Rollback plan (after 5.1, before 6.2 archive)

If sync workflow merged but cutover misbehaves: revert the grepr-server PR.

```bash
cd /Users/michaelsparre/Projects/grepr-server
gh pr view --json url | jq -r '.url'   # find your PR
git revert <MERGE_SHA>
git push origin main
```

`grepr/cli` will have one sync commit on it, but no further changes until a fresh sync runs. `grepr/grepr-cli` is still live (not yet archived); existing npm-publish workflow there is untouched, so the previous publishing path is intact. Investigate, fix, re-attempt cutover.
