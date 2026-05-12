# Grepr CLI for Claude Code

> **Preview**: this plugin is in early access. Expect rough edges and please [file issues](https://github.com/grepr/cli/issues).

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

Skills for [Claude Code](https://claude.com/claude-code) that let Claude manage your [Grepr](https://grepr.ai) pipelines, datasets, integrations, and queries through the [Grepr CLI](https://docs.grepr.ai/cli) — no context-switching to docs, no remembering subcommand syntax.

Once installed, Claude can:

- Build, debug, and update log-reduction pipelines from a natural-language description.
- Iteratively author and test Grok parsing rules against real log samples.
- Run queries against your data lake and shape the results inline.
- Manage datasets and integrations without leaving your editor.

## Requirements

- **[Claude Code](https://claude.com/claude-code)** — the CLI, IDE extension, or desktop app.
- **[Grepr CLI](https://docs.grepr.ai/cli)** — `npm install -g @grepr/cli` (Node.js 20+).
- A configured Grepr org. See the [CLI configuration guide](https://docs.grepr.ai/cli#cli-configuration).

## Install

1. Install the Grepr CLI and save a configuration:

   ```bash
   npm install -g @grepr/cli
   grepr --org-name <your-org> config:save default --default
   ```

2. In Claude Code, add the marketplace and install the plugin:

   ```
   /plugin marketplace add grepr/cli
   /plugin install grepr@grepr-cli
   ```

That's it. The first time a skill runs a `grepr` command, you'll be prompted to sign in via your browser. Tokens cache locally; subsequent commands don't prompt.

## First steps

Try one of these in Claude Code after install:

> List my running Grepr pipelines.

> Build a grok rule that parses NGINX access logs from my `web-api` service.

> Debug why pipeline `<id>` isn't producing output.

> Query the last hour of error logs from the `production-logs` dataset.

Claude will pick the right skill, run the CLI, and walk you through the result.

## Skills included

| Category | Skill | What it does |
|---|---|---|
| Router | `cli` | Dispatches to the right specialized skill based on intent |
| Commands | `job-commands` | List, view, create, update, delete jobs/pipelines |
| Commands | `dataset-commands` | Manage data lake datasets |
| Commands | `integration-commands` | View vendor and storage integrations |
| Commands | `docs-commands` | Semantic search over Grepr documentation |
| Queries | `query-logs` | Query data from datasets with filters and time ranges |
| Workflows | `build-pipeline` | End-to-end pipeline build, from requirements to production |
| Workflows | `build-grok` | Iterative grok pattern authoring and testing |
| Workflows | `debug-pipeline` | Troubleshoot pipelines that aren't producing expected output |
| Knowledge | `grepr-model` | Core Grepr concepts (events, jobs, graphs) — no docs lookup needed |
| Knowledge | `job-graph-patterns` | Common job graph patterns with examples |
| Knowledge | `operations-reference` | Reference for available Grepr sources, transforms, and sinks |

## Invocation

Claude Code lists skills by short name (e.g., `/build-grok`) with a `(grepr)` annotation in autocomplete. You can also invoke any skill by its fully-qualified name (e.g., `/grepr:build-grok`) — both forms work. The prefix becomes mandatory only if another installed plugin defines a skill with the same name.

## Updating

```
/plugin marketplace update grepr-cli
/plugin install grepr@grepr-cli
```

## Issues and feedback

Bug reports, feature requests, and feedback go to [github.com/grepr/cli/issues](https://github.com/grepr/cli/issues). For Grepr platform questions unrelated to this plugin, see [docs.grepr.ai](https://docs.grepr.ai) or contact `support@grepr.ai`.

## License

Apache-2.0. See [LICENSE](LICENSE).
