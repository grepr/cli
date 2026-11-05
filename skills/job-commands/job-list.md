# grepr job:list

## Command Help
!`grepr job:list --help`

## When to Use
List all Grepr pipelines (jobs) in the organization. Use this to see available async jobs and their status.

## Examples

```bash
# List jobs, leaving out DELETED jobs and batch jobs that ended more than 6 hours ago
grepr job:list

# List every job, with no default filters
grepr job:list --all

# Keep only the fields you need
grepr job:list --fields id,name,state

# List jobs for specific org
grepr job:list --org-name myorg
```

## Output Fields
Each job shows:
- Job ID
- Name
- Status (running, stopped, failed)
- Created/Updated timestamps

The list leaves out each job's graph unless you pass `--include-graph`. Use `grepr job:get <jobId>` to get the full json for a job for inspection or modification.
