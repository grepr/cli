# Changelog

All notable changes to the Grepr Claude Code plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-05-12

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
