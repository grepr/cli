# Logs backfill directives

Backfilled logs carry:

- `grepr.backfilled:true`
- `grepr.backfilled.timestamp:<server-generated submission time>`
- `processor:grepr`
- any user-supplied `--tag key:value` values

Use those fields when a generated destination link is unavailable.

Logs already delivered to the same destination are skipped automatically on
later backfills.

## Examples

Pipeline-derived — backfill an hour of checkout errors:

```bash
grepr backfill --job-id 0kmjah9wkg9d0 \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --query "service:checkout AND error" \
  --dry-run --output backfill-request.json
```

Explicit — backfill a logs dataset to two destinations:

```bash
grepr backfill --dataset-name raw-logs \
  --sink-id 0kmjaa8p7gbpf 0p8sgt40y5ank \
  --start 2026-07-08T10:00:00Z --end 2026-07-08T11:00:00Z \
  --tag incident:inc-123 \
  --dry-run --output backfill-request.json
```
