# grepr job:get

## Command Help
!`grepr job:get --help`

## When to Use
Retrieve detailed configuration of a specific pipeline (job). Use this to inspect pipeline
structure, operations, and settings.

## Examples

```bash
# Get job by ID
grepr job:get abc123 --quiet
```

## Output Includes
- Complete pipeline graph (source, operations, sink)
- Integration configurations
- Operation parameters
- Job metadata and status
