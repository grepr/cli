# Changelog

All notable changes to the Grepr agent plugins will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-10

### Added

- Added Codex plugin metadata and Agents marketplace metadata so Grepr skills can be distributed to Codex users.
- Eight new pipeline-editing workflow skills:
  - `describe-pipeline`, `test-pipeline-change` - inspect pipeline structure and validate patches through plan, diff, draft, metrics, and apply gates.
  - `tune-reduction`, `tune-grok` - diagnose poor reduction or parsing gaps and guide reducer/grok fixes.
  - `change-exceptions`, `change-filtering` - adjust reducer exceptions and pipeline filters.
  - `change-source`, `change-sink` - add, remove, replace, or repoint pipeline inputs and outputs.
- Examples and reference docs for the new pipeline-editing workflows.

### Fixed

- Quick-reference and workflow examples in `job-commands`, `dataset-commands`, `debug-pipeline`, and `build-pipeline` skills documented `grepr job:create -f <file>` / `grepr dataset:create --name "..."` etc. These flags don't exist on the CLI — `-f`/`--format` controls output format and `--name`/`--description` aren't options on the create commands at all. The actual syntax takes a JSON file as a positional argument (e.g. `grepr job:create pipeline.json`). Updated all skill examples to match.
- `dataset-commands/SKILL.md` referenced a `dataset:list --job-id <id>` filter that doesn't exist. Replaced with the supported workaround (inspect `job:get`'s vertices for `datasetId`).
- `dataset-commands/dataset-create.md` documented an inline `--name "..."` example that the CLI rejects. Replaced with a JSON-file example matching the actual `DatasetCreate` schema.

## [0.1.0] - 2026-05-12

### Added

- Initial marketplace and plugin manifests (`grepr-cli` marketplace, `grepr` plugin).
- Twelve skills covering the Grepr CLI surface:
  - `cli` — router that dispatches to the right specialized skill based on intent.
  - `job-commands`, `dataset-commands`, `integration-commands`, `docs-commands` — direct CLI command wrappers.
  - `query-logs` — query data lake datasets with filters and time ranges.
  - `build-pipeline`, `build-grok`, `debug-pipeline` — multi-step workflow guides.
  - `grepr-model`, `job-graph-patterns`, `operations-reference` — embedded Grepr knowledge so Claude doesn't have to re-derive concepts from documentation each session.
- Apache-2.0 license.
- README walking through CLI install, plugin install, and first commands.

### Requirements

- Requires the [Grepr CLI](https://docs.grepr.ai/cli) (`npm install -g @grepr/cli`) configured against a Grepr org.
