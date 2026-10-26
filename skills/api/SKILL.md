---
name: api
description: Make authenticated requests directly to the Grepr API with `grepr api` when no dedicated grepr command covers an endpoint, instead of curl or reading token files — find the endpoint and its schemas in the API reference with `docs:search -t api` / `docs:get`, then send the request.
allowed-tools: Bash(grepr docs:search *), Bash(grepr docs:get *), Bash(jq *)
---

# Grepr API

Resolve configuration through `grepr:cli` and reuse the selected `--conf`.

**Prefer a dedicated command.** `job:*`, `dataset:*`, `integration:*`, `query`,
`backfill`, `investigation:*` and the pipeline-editing skills validate input, page,
and format output for you. Use `grepr api` only for what they do not cover.

**Never curl the API or read `~/.grepr/auth/*.json`.** `grepr api` uses the same
login, refreshes expired tokens, and keeps the token out of the transcript.

## Find the endpoint, then call it

1. `grepr docs:search -t api "<what you want to do>"` searches the API reference
   and returns operation URIs such as `api://api/Datasets/createDataset`. It is a
   semantic search, so describe the action ("create dataset", "list jobs"); add
   `-l 10` when the right operation isn't in the top five.
2. `grepr docs:get <uri>` prints the operation: method and path, parameters, the
   request body schema name and the response schema names. Read a schema with
   `grepr docs:get schema://<Name>` (or find one with `docs:search -t schema`).
3. `grepr api <endpoint>` sends the request with your current credentials. The
   endpoint is the path under the API root: `v1/jobs`, `/v1/jobs` and
   `/api/v1/jobs` are the same endpoint, and a query string is allowed.

```bash
grepr api 'v1/jobs?latest=true&state=RUNNING'
grepr api v1/agent-suggestions -F page=1 -F pageSize=20
grepr api -X POST v1/datasets --input dataset.json --yes
```

- `-f key=value` sends a string, `-F key=value` sends numbers, `true`/`false`
  and `null` as JSON literals, digits exactly as typed. They become query
  parameters for GET/HEAD/DELETE and JSON body fields otherwise.
- In a body, a key with one value is a scalar and a repeated key is an array.
  Write `key[]=value` for an array even with one value: `-f teamIds[]=t1`
  sends `["t1"]`, `-f teamIds=t1` sends `"t1"`.
- Without `-X` the method is GET (fields become query parameters), or POST when
  `--input` is given. Pass `-X POST`/`PUT`/`PATCH` to send fields as a JSON body.
- `--input file.json` (or `-` for stdin) sends a raw body; `-H 'Name: value'`
  adds a header; `-i` prints the status line and headers to stderr.

## Reading results

A 2xx body goes to stdout (unchanged when piped) or to `-o`. Keep only what you need:

```bash
grepr api 'v1/jobs?latest=true' | jq '.items[] | {id, name, state}'
grepr -o jobs.json api 'v1/jobs?latest=true'   # large result: save, then jq the file
```

List endpoints accept filters (see the operation's parameters); narrow with them before
reading more pages. On `hasMore: true` the CLI prints a hint and stops — it never
auto-paginates. Request the next page with `page`/`pageSize`, or the cursor the
endpoint documents (e.g. `afterSeq`).

## Changing resources

- **PUT replaces the whole resource.** Fields you leave out are cleared, not
  kept. GET the resource, then build the body from it, copying every field the
  update schema (`docs:get schema://<Name>`) accepts, and change only what you mean to. Read
  and update schemas differ, so don't send the GET output back unchanged:
  ```bash
  grepr -o dataset.json api v1/datasets/<id>
  jq '{name: "checkout-logs", tables, teamIds}' dataset.json > update.json
  grepr api -X PUT v1/datasets/<id> --input update.json --yes
  ```
  `teamIds` is the complete set of teams: leave it out and the dataset's team
  assignments are cleared.
- Change pipelines with the pipeline-editing skills (`job:plan` / `job:draft` /
  `job:apply`), not a raw `PUT v1/jobs/{id}`: they validate the graph and handle
  the required `fromVersion` check.
- Anything other than GET/HEAD asks for confirmation on a terminal. In
  non-interactive use (scripts, agents) it is refused unless you pass `--yes` —
  pass it only once the user has approved that change.
- This skill pre-approves no `grepr api` call: each one asks for the user's
  permission, reads included.

## Errors

Non-2xx prints the body and `HTTP <status>` to stderr, writes nothing to stdout or
`-o`, and exits 1. Read the body before doing anything else; do not resend the same
request unchanged.

- **400**: the body usually names the invalid field. Fix it against the operation's schema.
- **401**: the login expired or is missing. Re-run once with `--no-auth-cache`.
- **403**: not permitted for this user. Report it; do not look for another route
  to the same change.
- **404**: usually a wrong id. An endpoint added after this CLI was built is still
  callable but missing from `docs:search`.

## Limits

- Only the public Grepr API is reachable. Internal endpoints, full URLs,
  `.`/`..` segments and their encoded forms are refused.
- Authentication is automatic; auth headers cannot be set with `-H`.
- `grepr api` never checks a path against the API reference; it sends any public
  path and the server decides whether it exists.
