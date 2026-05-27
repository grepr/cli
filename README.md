# Grepr CLI and Claude Code plugin

The Grepr command-line tool (`@grepr/cli`) and a Claude Code plugin that lets Claude drive it for you.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Pick your install

- **Just the CLI** — [jump to CLI section](#cli)
- **CLI + Claude Code skills** — [jump to Claude Code plugin section](#claude-code-plugin)

---

## CLI

### Requirements

- Node.js 20.0.0 or higher

### Install

```bash
npm install -g @grepr/cli
```

Alternatives:

```bash
# Run without installing
npx @grepr/cli --help

# Or with yarn
yarn global add @grepr/cli
```

### Quick start

```bash
# Save your organization configuration
grepr --org-name your-org-name config:save myconfig --default

# Query your data
grepr --conf myconfig query --dataset-name "production-logs" --query "level:ERROR"

# Create a job from a definition file
grepr --conf myconfig job:create my-job.json
```

### Authentication

The CLI uses OAuth 2.0 with browser-based login. On the first command that requires access, your browser opens to complete the flow. Tokens are cached locally; subsequent commands don't prompt.

### Output formats

- **Table** — human-readable (default)
- **CSV** — for data analysis and spreadsheets
- **JSON** — machine-readable (pretty, raw, or compact)

### Docs

Full command reference and advanced usage: [docs.grepr.ai/cli](https://docs.grepr.ai/cli)

---

## Claude Code plugin

> **Preview**: this plugin is in early access. Expect rough edges and please [file issues](https://github.com/grepr/cli/issues).

Skills for [Claude Code](https://claude.com/claude-code) that let Claude manage your [Grepr](https://grepr.ai) pipelines, datasets, integrations, and queries — no context-switching to docs, no remembering subcommand syntax.

### Requirements

- [Claude Code](https://claude.com/claude-code) — the CLI, IDE extension, or desktop app
- Grepr CLI installed and configured (see [CLI section](#cli) above)

### Install

In Claude Code:

```
/plugin marketplace add grepr/cli
/plugin install grepr@grepr-cli
```

### First steps

Try these prompts in Claude Code after install:

> List my running Grepr pipelines.

> Build a grok rule that parses NGINX access logs from my `web-api` service.

> Debug why pipeline `<id>` isn't producing output.

> Query the last hour of error logs from the `production-logs` dataset.

Claude will pick the right skill, run the CLI, and walk you through the result.

### Skills included

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

### Invocation

Claude Code lists skills by short name (e.g., `/build-grok`) with a `(grepr)` annotation in autocomplete. You can also invoke any skill by its fully-qualified name (e.g., `/grepr:build-grok`) — both forms work. The prefix becomes mandatory only if another installed plugin defines a skill with the same name.

---

## Updating

**CLI:**

```bash
npm update -g @grepr/cli
```

**Plugin:**

```
/plugin marketplace update grepr-cli
/plugin install grepr@grepr-cli
```

---

## Issues and feedback

Bug reports and feature requests go to [github.com/grepr/cli/issues](https://github.com/grepr/cli/issues). For Grepr platform questions, see [docs.grepr.ai](https://docs.grepr.ai) or contact `support@grepr.ai`.

---

## License

Apache-2.0. See [LICENSE](LICENSE).
