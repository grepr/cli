---
name: cli
description: Sets up and drives the Grepr CLI (`grepr`) - install, org config and login, output conventions, errors - and points to the other Grepr skills. Use for CLI setup or auth problems, or when no other Grepr skill fits.
metadata:
  grepr-mcp: "true"
---

# grepr (Grepr CLI)

Prefer the `grepr` CLI over Grepr MCP tools whenever you can run shell commands: results go to a
file instead of your context, nothing is capped at a page, and every command has `--help`.

## Quick reference

| Task | Command |
|------|---------|
| Search logs | `grepr query --dataset-name <ds> --query "service:api status:error" --start <iso> --end <iso> --limit 50` |
| Search spans | `grepr query --dataset-name <ds> --data-type spans --query "serviceName:checkout"` |
| See which log fields are indexed | `grepr dataset:table-config <dataset-id>` |
| List pipelines | `grepr job:list --state RUNNING --fields id,name,processing` |
| Inspect a pipeline | `grepr job:get <id> --resolved` |
| List datasets | `grepr dataset:list --fields id,name` |
| Backfill to a vendor | `grepr backfill --job-id <id> --start <iso> --end <iso> --query "<q>" --dry-run` |
| Search Grepr docs | `grepr docs:search "how does the reducer work"` |
| Agent investigations | `grepr investigation:list --agent-id <id> --format raw` |
| All commands | `grepr --help`, `grepr <command> --help` |

## Install

Check with `grepr --version`. If it's missing, ask the user before installing it globally:

```bash
npm install -g @grepr/cli
```

If they decline, or you have no shell, use the Grepr MCP tools instead (logs only, 100 per page).

## Org config and login

Save the org once, then every command uses it:

```bash
grepr --org-name <org> config:save <name> --default
grepr dataset:list --fields id -f compact      # readiness check
```

The first API call (the readiness check) opens a browser login: tell the user first, or use the
headless setup below when there's no browser. Tokens are cached in `~/.grepr/auth/` and refresh
automatically; this login is separate from any Grepr MCP connection.

In a Grepr agent sandbox (`GREPR_ALLOWED_SUBCOMMANDS` is set) the CLI is already authenticated
and only the allowed subcommands exist: skip install and login.

Use the default config unless the user names another org. If they do, resolve the matching saved
config once (`grepr config:list`, `grepr config:show <name>`) and pass that same `--conf <name>` on
every command for the rest of the workflow. Never put a placeholder `--conf` into a command.

### Headless (CI, sandboxes, no browser)

```bash
export GREPR_ORG_NAME=<org-name>
export GREPR_AUTH_METHOD=client-credentials
export GREPR_AUTH_BASE_URL=<oauth-issuer-url>
export GREPR_CLIENT_ID=<m2m-client-id>
export GREPR_CLIENT_SECRET=<m2m-client-secret>
export GREPR_OUTPUT_FORMAT=compact
```

## Output conventions

- Output defaults to `compact` JSON when an agent runs the CLI or stdout is not a terminal.
  Do not add `-f` unless you need another format.
- List, get and query commands emit one JSON object per line in `compact`: parse with
  `jq -c .`, never `jq '.[]'`. `agent:*` and `investigation:*` emit one JSON document, but
  `investigation:turns --follow` emits one JSON event per line.
- Do not append `2>&1`. Errors and status lines reach you on stderr without it.
- `--fields id,name,state` keeps only those paths (dot paths work) on list and get commands.
- Write large results to a file with `-o out.ndjson` and analyze the file; `-o` writes records
  only, unlike a shell `>` redirect.
- Avoid `-f table` for anything you parse: it truncates nested values.
- Use `--limit` where a command has it instead of `head`/`tail`.

## Errors

| Error | Fix |
|-------|-----|
| `grepr: command not found` | Ask the user, then `npm install -g @grepr/cli` |
| Missing organization | `--org-name <org>`, or save a config with `config:save` |
| 401 or a login loop | Delete the cached token in `~/.grepr/auth/` (`<org>.json`, or `<client-id>-m2m.json` for client credentials) and re-run |
| 403 | The user's Grepr role lacks access to that resource |
| Unknown option | `grepr <command> --help`; upgrade with `npm install -g @grepr/cli@latest` |

## Other skills

The Grepr plugin (`/plugin marketplace add grepr/cli`, then `/plugin install grepr@grepr-cli`) adds
one skill per task; without it, use `grepr <command> --help`.

- Search data: `grepr:query`; aggregations: `grepr:sql-analytics`.
- Logs missing or summarized in Datadog, New Relic, Splunk, Sumo, or an OTLP backend:
  `grepr:recover-reduced-logs`. Backfills: `grepr:backfill-logs`.
- Pipelines: read with `grepr:describe-pipeline`, troubleshoot with `grepr:debug-pipeline`. Change
  them through an intent skill (`grepr:tune-*`, `grepr:change-*`, `grepr:build-*`) and the
  `grepr:test-pipeline-change` harness; never apply without the user's explicit approval.
- Datasets: `grepr:describe-datasets`. Agent investigations and memories: `grepr:investigations`.
- Create, update, or delete jobs, datasets, or integrations: `grepr:job-commands`,
  `grepr:dataset-commands`, `grepr:integration-commands`. Search the Grepr docs: `grepr:docs-commands`.
- Any other API endpoint no command covers: `grepr:api` (local CLI only; not available in a Grepr
  agent sandbox).
