# grepr job:delete

## Command Help
!`grepr job:delete --help`

## When to Use
Delete a pipeline (job) and stop all processing. This is permanent and cannot be undone.

## Examples

```bash
# Delete job by ID
grepr job:delete abc123
```

## Warning
- Deletes the pipeline permanently
- Stops all log processing immediately
- Does not delete historical data in datasets
