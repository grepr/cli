# grepr job:list

## Command Help
!`grepr job:list --help`

## When to Use
List all Grepr pipelines (jobs) in the organization. Use this to see available async jobs and their status.

## Examples

```bash
# List all jobs
grepr job:list

# List jobs with JSON output
grepr job:list -o json

# List jobs for specific org
grepr job:list --org-name myorg
```

## Output Fields
Each job shows:
- Job ID
- Name
- Status (running, stopped, failed)
- Created/Updated timestamps
- Job graph

Use `grepr job:get <jobId>` to get the full json for a job for inspection or modification.
