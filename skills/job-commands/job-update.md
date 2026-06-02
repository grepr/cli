# grepr job:update

## Command Help
!`grepr job:update --help`

## Update API object
!`grepr docs:get schema://UpdateJob | sed 's/^#/###/'`

## Update endpoint documentation
!`grepr docs:get api://api/Jobs/updateJob | sed 's/^#/###/'`

## When to Use
Update an existing pipeline's configuration. Use this to modify operations, change integrations, or adjust settings.

For patchable pipeline edits, prefer the `job:plan` / `job:draft` /
`job:apply` safety workflow used by the pipeline tuning skills. Treat
`job:update` as a manual full-graph update path only when the user
explicitly starts that workflow.

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
- Before you execute an update, you should test the updated job in isolation to make sure it'll do what's expected. See below.
- Don't be phased by the complexity of testing. Testing is very important to ensure that jobs work as expected before deploying to production.
- Change the job graph step by step using `jq` as needed when creating a job or modifying an existing job. Check the result of your jq commands after each step to make sure it's going as expected. Use a new file for each step to avoid mistakes and be able to retry until success.

## Testing Updated Job Configuration for Async Streaming Jobs
1. Assuming you have an updated job configuration, you will need to create a temporary job to test it.
2. Create a new file with a copy of the updated job configuration, but change the `name` field to something unique (e.g. append `_test` to the name).
3. You will need two datasets for testing that will act as our sinks. You might need to create these datasets using [dataset:create](dataset-create.md) if they don't already exist:
    - A raw data sink dataset to capture the raw log data after parsing/enrichment (usually `test_dataset_raw`).
    - A processed data sink dataset to capture the final output after all transformations. (usually `test_dataset_processed`).
4. Update the job configuration to use these test datasets as sinks. You can find the sink operations in the `jobGraph`. Replace the vendor sinks (newrelic, datadog, etc.) with the processed data sink dataset, and replace the real raw data sink with the test raw data sink dataset. Also add a `LogTransformAction` operation before each sink with a `TagAction` to tag the data before it goes into either sinks so you can search for those tags when querying the datasets.
5. Validate the JSON for the new job with the user to ensure it looks correct and it won't impact production data.
6. Create the temporary job using [job:create](job-create.md) with the modified configuration.
7. It'll take a few minutes for the pipeline to start and for data to start flowing through. You can monitor the job status using `grepr job:get <temp_job_id> --quiet` and checking the status field.
8. Once the job is running, you can query the test datasets using [query](query.md) to validate that the data is being processed as expected.
9. After validation, delete the temporary job using [job:delete](job-delete.md). Ask the user if they want to keep the test datasets for reuse later or delete them as well.
10. If everything looks good, you can proceed to update the original job with the updated configuration after confirming with the user.
11. Remember to monitor the updated job after deployment to ensure it's functioning correctly. Query the relevant datasets to validate data flow and correctness.
