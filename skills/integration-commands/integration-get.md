# grepr integration:get

## Command Help
!`grepr integration:get --help`

## When to Use
Get detailed configuration of a specific integration. Use this to inspect connection settings and credentials.

## Examples

```bash
# Get integration by ID
grepr integration:get abc123
```

## Output Includes
- Integration type and name
- Endpoint URLs
- API key configuration (masked)
- Region/site settings
