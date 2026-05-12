# grepr docs:get

## Command Help
!`grepr docs:get --help`

## When to Use
Retrieve full documentation content by URI. Use this after finding a document with `docs:search` to get the complete text.

## Examples

```bash
# Get full document by URI
grepr docs:get "doc://integrations/datadog/page.mdx"

# Pipe to AI or other tools
grepr docs:get "doc://tutorials/first-pipeline/page.mdx" | claude

# Save to file
grepr docs:get "doc://integrations/datadog/page.mdx" > datadog-docs.md
```

## Output
- Raw markdown content
- No formatting or colors (perfect for piping)
- Complete document with all sections in order

## Typical Workflow
```bash
# Step 1: Find what you need
grepr docs:search "datadog" -f compact
# Output: 1. [0.850] integrations/datadog/page.mdx

# Step 2: Get full content
grepr docs:get "doc://integrations/datadog/page.mdx"
```
