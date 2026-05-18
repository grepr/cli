# Unify grepr-cli and cli repos

Status: Draft
Author: Michael Sparre
Date: 2026-05-18

## Goal

Collapse three repos into two by merging `grepr/grepr-cli` (the npm publishing repo for `@grepr/cli`) into `grepr/cli` (the Claude Code plugin repo). After cutover:

- **`grepr/grepr-server`** — unchanged. Continues to own CLI source under `tools/cli/`. Tags trigger a sync.
- **`grepr/cli`** — the public surface. Hosts both the published `@grepr/cli` source AND the Claude Code plugin. Marketplace install `/plugin marketplace add grepr/cli` continues to work. `@grepr/cli` is published from here.
- **`grepr/grepr-cli`** — archived (read-only) after cutover. Existing release tags preserved.

Layout follows the pattern used by DataDog/pup: CLI source and plugin content coexist flat at the repo root. Claude Code plugin paths (`.claude-plugin/`, `skills/`) don't collide with TypeScript source paths (`src/`, `templates/`).

## File ownership

Every path in the unified `grepr/cli` is owned by exactly one side. The boundary is enforced by the sync workflow's allowlist (see Sync workflow rewrite).

| Path | Owner | Source |
| --- | --- | --- |
| `.claude-plugin/marketplace.json` | hand-authored | edited in `grepr/cli` directly |
| `.claude-plugin/plugin.json` | hand-authored | edited in `grepr/cli` directly |
| `skills/**` | hand-authored | edited in `grepr/cli` directly |
| `README.md` | hand-authored | covers CLI install AND plugin install |
| `CHANGELOG.md` | hand-authored | plugin changelog only |
| `CLAUDE.md` | hand-authored | repo-level guidance |
| `LICENSE` | hand-authored | Apache-2.0; identical in both sides, doesn't matter functionally |
| `.github/workflows/validate.yml` (and any other plugin-only CI) | hand-authored | existing manifest/skill validation |
| `src/**` | synced | from `grepr-server/tools/cli/src/{main,test}` |
| `templates/**` | synced | from `grepr-server/tools/cli/templates` |
| `scripts/**` | synced | CLI's own scripts dir under `grepr-server/tools/cli/scripts` |
| `package.json` | synced | version injected from grepr-server tag |
| `yarn.lock` | synced | as-is |
| `tsconfig.json`, `tsconfig.test.json` | synced | as-is |
| `eslint.config.mjs` | synced | as-is |
| `vitest.config.ts` | synced | as-is |
| `.gitignore` | synced if present in grepr-server | otherwise hand-authored |
| `.github/workflows/npm-publish.yml` | synced | from `grepr-server/tools/cli/.github/workflows/` |

Hand-authored content is never touched by the sync. Synced paths are deleted and recopied on every sync.

## Sync workflow rewrite

`grepr-server/.github/workflows/grepr-cli-sync.yml` is rewritten:

- Trigger unchanged: push of semver tags matching `[0-9]*.[0-9]*.[0-9]*`
- Target repo changes from `grepr/grepr-cli` to `grepr/cli`
- `SYNC_APP_ID` GitHub App needs its repository scope updated to include `grepr/cli` (or replaced)
- Wipe-then-copy logic is replaced with an explicit allowlist:

```yaml
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
for path in "${SYNC_PATHS[@]}"; do
  rm -rf "cli/$path"
  if [ -e "grepr-server/tools/cli/$path" ]; then
    mkdir -p "cli/$(dirname $path)"
    cp -r "grepr-server/tools/cli/$path" "cli/$path"
  fi
done
```

- Version injection (`jq --arg version "$VERSION" '.version = $version' package.json`) runs on `grepr-server/tools/cli/package.json` BEFORE the copy step, identical to current behavior
- After copy, a safety assertion: `for f in .claude-plugin/plugin.json .claude-plugin/marketplace.json README.md skills; do test -e "cli/$f" || exit 1; done`. If any hand-authored path was inadvertently destroyed, the workflow fails before pushing.
- Commit message format unchanged: `Sync grepr-cli v<version> from grepr-server@<sha>`

## Versioning

Two independent version axes:

**CLI version** — lives in `package.json`. Written by the sync workflow from the grepr-server tag. The push to `grepr/cli` main triggers `npm-publish.yml` which sees the new version and publishes `@grepr/cli@X.Y.Z`. No human edits this version.

**Plugin version** — lives in `.claude-plugin/plugin.json`. Bumped manually in a PR to `grepr/cli` when skills change. Claude Code's marketplace reads this at install time; no npm publish involved.

The two never need to match. A CLI release does not bump the plugin version. A plugin release does not affect the CLI.

**Cross-cutting changes** (a CLI change that needs a skill update, e.g., a new command flag): land the CLI change first via the normal grepr-server PR → tag → sync flow; follow up with a PR to `grepr/cli` that updates the affected skill and bumps `plugin.json` version. Atomicity across both is not possible by design; mitigate by writing skills loosely enough to handle minor CLI drift and reserving breaking changes for major bumps.

## NPM publish workflow

`npm-publish.yml` ports from `grepr/grepr-cli/.github/workflows/` to `grepr/cli/.github/workflows/` with no path changes:

- Triggers: push to main on `src/**`, `package.json`, `tsconfig.json`, `scripts/**`, `templates/**`
- Version skip check via `npm view @grepr/cli@$VERSION` unchanged
- Build, test, publish, GitHub Release creation all unchanged
- Release body text — "automatically synced from grepr-server" — remains accurate

Because `npm-publish.yml` is itself in the sync allowlist, future changes to this workflow are authored in `grepr-server/tools/cli/.github/workflows/npm-publish.yml`.

## Plugin CI

`validate.yml` (existing workflow in `cli/.github/workflows/`) is hand-authored and unchanged. It validates:

- `plugin.json` and `marketplace.json` shapes (required fields are strings, license is Apache-2.0, at least one plugin entry)
- Plugin name AND version match between `plugin.json` and `marketplace.json` (plugins[0])
- All `skills/*/SKILL.md` files have well-formed frontmatter with `description:` and without `name:`

Triggered on every push to main AND every PR (no path filter). Sync never touches this file.

**Useful side effect**: because validate runs on every push to main, it executes on every sync commit too. If a sync ever did clobber `.claude-plugin/` or `skills/`, validate would fail loudly on main — a second line of defense behind the in-sync-workflow assertion.

**Implication for plugin version bumps**: because validate enforces that `plugin.json` version equals `marketplace.json` `plugins[0].version`, any plugin version bump PR must update both files. This is unchanged from current behavior; called out here because the versioning section discusses bumping `plugin.json` but the actual edit is two-file.

## Cutover plan

Ordered for minimal risk and easy rollback. Each step is reversible.

1. **Prep `grepr/cli` layout on a feature branch.** Add the synced paths manually (copy current `grepr/grepr-cli` contents into the unified layout). Verify `yarn install && yarn build && yarn test` succeed from the cli repo root. Verify Claude Code can install the plugin from the branch's marketplace.json. Do not merge yet.
2. **Smoke-test npm publish path.** From the feature branch, invoke `npm-publish.yml` via `workflow_dispatch`. Confirm the version-skip check correctly recognizes that `@grepr/cli@<current>` is already published and exits cleanly. Optionally publish a prerelease under a dist-tag like `next` for end-to-end validation (decided at plan time).
3. **Update sync workflow on a feature branch in grepr-server.** Switch target repo to `cli`, replace wipe-everything with allowlist-delete. Add a dry-run mode (env-gated) that echoes the rm/cp operations without executing them. Verify the dry-run output matches expectations.
4. **Update `SYNC_APP_ID` GitHub App's repository scope** to include `grepr/cli`. (Operations step, owned by whoever administers the app.)
5. **Cutover (close-succession merges).**
   - 5a. Merge the sync workflow change to `grepr-server` main.
   - 5b. Merge the layout feature branch to `cli` main.
   - 5c. Trigger a sync from grepr-server (`workflow_dispatch` or push a no-op tag) → produces the first real "Sync from grepr-server" commit in unified `cli`.
   - 5d. Verify `npm-publish.yml` runs on `cli` main and publishes (or skips if version unchanged).
6. **Archive `grepr/grepr-cli`.** Set to read-only via GitHub settings. Existing release tags preserved.
7. **Update external pointers.** Any docs page, internal Slack reference, or README link pointing to `grepr/grepr-cli` is updated to `grepr/cli`. The npm package name `@grepr/cli` is unchanged so install instructions don't move.

**Rollback at any point before step 6.** Revert the sync workflow change in grepr-server; `grepr/cli` remains usable in its hybrid state (CLI source from the manual seed copy in step 1, not from active sync). `grepr/grepr-cli` is still alive since step 6 hasn't run. Re-attempt cutover is cheap.

## Risks and open questions

1. **Interleaved commit history.** Sync commits and plugin PRs land in the same repo. `git log src/` and `git log skills/` stay clean since the paths don't overlap, so this is acceptable.
2. **No atomic CLI+skill releases.** A CLI change that needs a corresponding skill update ships in two PRs across two repos. Mitigation discussed under Versioning.
3. **`SYNC_APP_ID` GitHub App permissions.** The existing app token is scoped to `grepr/grepr-cli`. Step 4 of cutover updates the scope; if the app is locked to one repo by policy, a new app may be needed.
4. **npm Trusted Publishing.** `npm-publish.yml` uses OIDC trusted publishing (`--provenance`, `id-token: write`, no `NPM_TOKEN`). The current trusted publisher on npm is `grepr/grepr-cli/.github/workflows/npm-publish.yml`. After cutover, publishing happens from `grepr/cli` — a corresponding trusted publisher entry MUST be added on npm for `@grepr/cli` before the first sync-triggered publish. The previous entry stays until a successful publish from grepr/cli has been observed, then can be removed. Owner of the npm package must perform this configuration.
5. **GitHub Releases location change.** Existing `@grepr/cli` releases live on `grepr/grepr-cli`. Post-cutover releases land on `grepr/cli/releases`. Users watching release notifications need to switch their watch. Communicate via release notes on the final `grepr-cli` release.
6. **README authorship.** The hand-authored `README.md` in `grepr/cli` post-cutover must cover both the CLI install path (`npm install -g @grepr/cli`) and the plugin install path (`/plugin marketplace add grepr/cli`). Currently each repo has its own README focused on its own surface; merging requires a deliberate rewrite (part of step 1).
