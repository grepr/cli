# grepr job:update

## Command Help
!`grepr job:update --help`

## Update API object
!`grepr docs:get schema://UpdateJob | sed 's/^#/###/'`

## Update endpoint documentation
!`grepr docs:get api://api/Jobs/updateJob | sed 's/^#/###/'`

## When to Use
Replace an existing job's configuration with a full new version.

To change a pipeline, use an intent skill and `grepr:test-pipeline-change`
(`job:plan` / `job:draft` / `job:apply`). That workflow drafts exactly what it
applies. Use `job:update` only when the user explicitly asks for a manual full
update.

## Examples

```bash
# Update job from file
grepr job:update abc123 updated-pipeline.json
```

## Notes
- Job will be restarted with new configuration
- Updated configuration must be complete (full job graph)
- Use the selected config consistently. If the user did not choose a
  non-default config, omit `--conf`; if they did, reuse that concrete
  `--conf <name>` value on every command.
- Get current config first with `grepr job:get <id> --quiet` and output to a file to modify incrementally. You'll need the version for the `fromVersion` parameter.
- The JSON for a job update contains:
  - `fromVersion`: The job version to update from
  - `desiredState`: RUNNING or STOPPED
  - `jobGraph`: The Grepr Job Graph with `vertices` and `edges`. Use
    `grepr:operations-reference`, local OpenAPI types, or known `docs:get`
    URIs for operation details. Do not block on `docs:search`; some
    environments do not have the semantic docs index loaded.
- A pipeline's `jobGraph` is the single `template-operation` vertex that
  `job:get` returns without `--resolved`. Edit only its `templateInputs.input`.
  Never send the `--resolved` graph. It replaces the template-operation vertex
  with the expanded operations, which turns the pipeline into a raw job graph
  that `job:plan`, `job:draft`, `job:apply`, and the intent skills reject.
- For a raw job graph, `job:update` is the way to change it. The user defines
  every vertex and edge.
- Change the job graph step by step using `jq` as needed when creating a job or modifying an existing job. Check the result of your jq commands after each step to make sure it's going as expected. Use a new file for each step to avoid mistakes and be able to retry until success.
- Show the user the full update file and get explicit approval before you run it.
