# grepr integration:list

## Command Help
!`grepr integration:list --help`

## When to Use
List all configured integrations (sources and sinks). Use this to see available Datadog, Splunk, OTLP, and other vendor connections.

## Examples

```bash
# List all integrations
grepr integration:list
```

## Output Fields
- Integration ID (use in pipelines)
- Type (datadog, splunk, otlp, etc.)
- Name
- Configuration
