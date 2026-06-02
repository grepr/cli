# grepr/cli

Unified repo for the Grepr CLI (npm: `@grepr/cli`) and the Grepr Claude Code plugin.

## CLI development (`src/`, `templates/`, `scripts/`, `package.json`)

**These files are mirrored from a private internal repo — PRs against them will be overwritten on the next sync.** Grepr engineers: edit upstream; everything else is just the published artifact.

TypeScript rules (when working on CLI source):
- Avoid `any` and `unknown` types unless absolutely necessary
- Avoid type assertions (`as Type`) unless absolutely necessary
- Run `yarn typecheck` after changes
- Tests: `yarn test`, single file: `yarn test src/test/typescript/lib/foo.test.ts`

## Plugin development (`.claude-plugin/`, `.codex-plugin/`, `.agents/`, `skills/`)

**These files are hand-authored in THIS repo — edit directly.**

If you're working on the plugin:
1. Edit `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, or any `skills/*/SKILL.md` here
2. `validate.yml` enforces shape rules on every PR
3. When bumping plugin version: update the Claude plugin manifest, Claude marketplace `plugins[0].version`, and Codex plugin manifest
4. CHANGELOG.md tracks plugin changes only — CLI versions follow upstream release tags
