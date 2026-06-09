# grepr dataset:create

## Command Help
!`grepr dataset:create --help`

## When to Use
Create a new dataset (Iceberg table) for storing logs. Datasets are targets for pipeline sinks and are sources for queries.

## Notes
- Datasets require a storage integration first. Integrations need to be created in the UI at this point.

## Examples

`dataset:create` takes a JSON file as a positional argument; it has no inline `--name` or `--description` flags. Required fields in the JSON: `name` and `integrationId` (the storage integration id). See `schema://DatasetCreate` via `grepr docs:get` for the full shape.

```bash
cat > dataset.json <<'EOF'
{
  "name": "production-logs",
  "integrationId": "<storage-integration-id>",
  "teamIds": []
}
EOF
grepr dataset:create dataset.json
```
