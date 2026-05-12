# grepr dataset:delete

## Command Help
!`grepr dataset:delete --help`

## When to Use
Delete a dataset. This is permanent and removes the Iceberg table metadata (but may not delete S3 data).

## Examples

```bash
# Delete dataset
grepr dataset:delete abc123
```

## Warning
- Deletes dataset permanently
- Breaks pipelines that write to this dataset
- S3 data may remain and require separate cleanup
