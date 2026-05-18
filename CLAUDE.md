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
3. When bumping plugin version: update BOTH `plugin.json` version AND `marketplace.json` `plugins[0].version` (validate enforces match)
4. CHANGELOG.md tracks plugin changes only — CLI versions follow grepr-server tags
