# grepr dataset:create

## Command Help
!`grepr dataset:create --help`

## When to Use
Create a new dataset (Iceberg table) for storing processed logs. Datasets are targets for pipeline sinks and are sources for queries.

## Notes
- Datasets require a storage integration first. Integrations need to be created in the UI at this point.

## Examples

```bash
# Create with inline name
grepr dataset:create --name "Production Logs Dataset"
```
