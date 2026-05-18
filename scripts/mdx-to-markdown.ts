#!/usr/bin/env tsx

/**
 * Converts raw MDX files to clean Markdown suitable for semantic search indexing.
 *
 * Pipeline:
 *   1. Parse frontmatter to extract `description`
 *   2. Bundle MDX with mdx-bundler (resolves @/ imports, compiles JSX)
 *   3. Evaluate the bundle to obtain a React component
 *   4. Render with `renderToStaticMarkup` using stub components
 *   5. Convert HTML → Markdown via rehype-parse → rehype-remark → remark-stringify
 *   6. Prepend frontmatter description as a leading paragraph
 *   7. Strip images (not useful for semantic search)
 *
 * The result is clean, visible-only Markdown text that mirrors what a user
 * would see on the rendered docs site — plus HiddenFAQ content which is
 * intentionally indexed for search.
 */

import { bundleMDX } from 'mdx-bundler';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import path from 'path';
import { readFileSync, existsSync } from 'fs';

import {
  Callout,
  Tabs,
  Cards,
  HiddenFAQ,
  ApiSpecPage,
} from './stub-components.js';

/* ------------------------------------------------------------------ */
/*  Frontmatter extraction                                            */
/* ------------------------------------------------------------------ */

interface Frontmatter {
  description?: string;
}

/**
 * Extracts YAML frontmatter from an MDX string.
 *
 * Returns the frontmatter fields and the source with the frontmatter block removed.
 * Only supports the `description` field since that is the only field used across the docs.
 */
export function extractFrontmatter(source: string): {
  frontmatter: Frontmatter;
  content: string;
} {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, content: source };
  }

  const frontmatter: Frontmatter = {};
  const yamlBlock = match[1]!;

  const descMatch = yamlBlock.match(/description:\s*(.+)/);
  if (descMatch) {
    frontmatter.description = descMatch[1]!.trim().replace(/^['"]|['"]$/g, '');
  }

  const content = source.slice(match[0].length);
  return { frontmatter, content };
}

/* ------------------------------------------------------------------ */
/*  HTML → Markdown                                                   */
/* ------------------------------------------------------------------ */

/**
 * Custom rehype-remark handler that strips `<img>` elements
 * (images are not useful for semantic search embeddings).
 */
function imageHandler(): void {
  // Return nothing — the image is dropped from the output
}

/**
 * Converts an HTML string to clean Markdown.
 *
 * Uses the unified ecosystem: rehype-parse → rehype-remark → remark-stringify.
 * Images are stripped via a custom handler. GFM (tables, strikethrough, etc.)
 * is supported.
 *
 * After conversion, applies post-processing to fix two issues caused by MDX
 * rendering markdown tables inside JSX components (e.g. Tabs.Tab):
 *
 * 1. **Flattened tables**: MDX does not parse markdown syntax inside JSX blocks,
 *    so tables render as literal pipe-delimited text inside `<p>` tags. The
 *    rehype-remark pipeline sees this as a paragraph of text (not a table node),
 *    producing a single-line string with `\|` at the start. `unflattenTables()`
 *    detects these mangled table lines and restores proper GFM table formatting.
 *
 * 2. **Escaped underscores**: `remark-stringify` escapes `_` as `\_` to prevent
 *    markdown emphasis interpretation. Since this output is for semantic search
 *    indexing (not rendering), `unescapeMarkdown()` strips these backslashes.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const file = await unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark, {
      handlers: {
        img: imageHandler,
      },
    })
    .use(remarkGfm)
    .use(remarkStringify)
    .process(html);

  let markdown = String(file);
  markdown = unflattenTables(markdown);
  markdown = unescapeMarkdown(markdown);
  return markdown;
}

/**
 * Restores GFM table formatting from flattened single-line table text.
 *
 * When MDX renders a markdown table inside a JSX component (e.g. `<Tabs.Tab>`),
 * the table syntax is not parsed by MDX — it passes through as literal text
 * inside a `<p>` tag. After rehype-remark conversion, this becomes a single line
 * like:
 *
 *   `\| A | B | |---|---| | 1 | 2 |`
 *
 * This function detects such lines and reconstructs proper multi-line GFM tables.
 * It works by:
 *   1. Removing the leading `\` escape
 *   2. Locating the separator row pattern (`|---|...---|`)
 *   3. Counting columns from the separator to determine pipes-per-row
 *   4. Re-splitting the flat text into rows based on pipe count
 */
export function unflattenTables(markdown: string): string {
  return markdown.replace(
    /^\\?\|[^\n]+\|$/gm,
    (line) => {
      const cleaned = line.startsWith('\\|') ? line.slice(1) : line;

      // Match the separator row: |---|---|...| or | --- | --- |...|
      // Uses a non-greedy pattern that matches exactly the separator pipes,
      // without consuming the leading pipe of the next row.
      const sepMatch = cleaned.match(
        /\|(\s*:?-{3,}:?\s*\|)+/
      );
      if (!sepMatch) {
        return line;
      }

      // Count columns from separator dashes
      const sepRow = sepMatch[0];
      const colCount = (sepRow.match(/---+/g) ?? []).length;
      if (colCount < 2) {
        return line;
      }

      const sepStart = sepMatch.index!;
      const sepEnd = sepStart + sepMatch[0].length;

      const headerPart = cleaned.slice(0, sepStart).trim();
      const bodyPart = cleaned.slice(sepEnd).trim();

      // Each GFM table row has (colCount + 1) pipe characters:
      // | cell1 | cell2 | ... | cellN |
      // That means each row contains exactly (colCount + 1) pipes.
      // Split a flat run of text into rows by counting pipes.
      const splitIntoRows = (text: string): string[] => {
        if (!text) return [];

        const rows: string[] = [];
        let pipeCount = 0;
        let rowStart = 0;

        for (let i = 0; i < text.length; i++) {
          if (text[i] === '|' && !isInsideBackticks(text, i)) {
            pipeCount++;
            if (pipeCount === colCount + 1) {
              rows.push(text.slice(rowStart, i + 1).trim());
              pipeCount = 0;
              rowStart = i + 1;
            }
          }
        }

        // Handle any remaining text (incomplete row)
        const remaining = text.slice(rowStart).trim();
        if (remaining) {
          rows.push(remaining);
        }

        return rows;
      };

      const headerRows = splitIntoRows(headerPart);
      const bodyRows = splitIntoRows(bodyPart);

      // Rebuild separator with consistent formatting
      const sepCells = Array(colCount).fill('---');
      const separator = '| ' + sepCells.join(' | ') + ' |';

      if (headerRows.length === 0) {
        return line;
      }

      return [...headerRows, separator, ...bodyRows].join('\n');
    }
  );
}

/**
 * Checks whether a position in a string is inside a backtick-delimited code span.
 *
 * This prevents pipe characters inside inline code (e.g. `` `a|b` ``) from being
 * counted as table cell delimiters.
 */
function isInsideBackticks(text: string, pos: number): boolean {
  let insideBackticks = false;
  for (let i = 0; i < pos; i++) {
    if (text[i] === '`') {
      insideBackticks = !insideBackticks;
    }
  }
  return insideBackticks;
}

/**
 * Removes unnecessary backslash escapes from markdown intended for search indexing.
 *
 * `remark-stringify` escapes characters like `_` (underscore) to prevent them
 * from being interpreted as markdown emphasis. Since the output text is used for
 * semantic search indexing rather than markdown rendering, these escapes are
 * unnecessary and harm search quality (e.g. searching for `DD_API_KEY` won't
 * match `DD\_API\_KEY`).
 *
 * Only removes escapes that are safe to remove for search indexing purposes:
 * - `\_` → `_` (underscores in identifiers like DD_API_KEY)
 */
export function unescapeMarkdown(markdown: string): string {
  return markdown.replace(/\\_/g, '_');
}

/* ------------------------------------------------------------------ */
/*  MDX → Markdown (main export)                                      */
/* ------------------------------------------------------------------ */

export interface MdxToMarkdownOptions {
  /** Absolute path to the docs/ directory (for resolving @/ imports). */
  docsDir: string;
  /** Absolute path of the MDX file (used for relative import resolution). */
  filePath: string;
}

/**
 * Converts a raw MDX file to clean Markdown suitable for vector indexing.
 *
 * @param source  Raw MDX source string (may include frontmatter, imports, JSX).
 * @param options Paths needed for import resolution.
 * @returns Clean Markdown string, or `null` if the file produces no visible content.
 */
export async function mdxToMarkdown(
  source: string,
  options: MdxToMarkdownOptions
): Promise<string | null> {
  const { docsDir, filePath } = options;
  const { frontmatter, content } = extractFrontmatter(source);

  const fileDir = path.dirname(filePath);

  const { code } = await bundleMDX({
    source: content,
    cwd: fileDir,
    esbuildOptions(opts) {
      opts.platform = 'node';
      opts.target = 'es2022';
      // Use IIFE format so the output can be evaluated with new Function()
      opts.format = 'iife';
      opts.globalName = '__mdxBundle';

      // Resolve the @/ path alias to the docs directory
      opts.alias = {
        '@': docsDir,
      };

      // Mark packages as external that are either provided at evaluation time
      // via globals (nextra, react) or unavailable in the CLI environment
      // (next, next-themes, redoc — used only by client-side components).
      opts.external = [
        'nextra/components', 'nextra',
        'react', 'react/jsx-runtime',
        'next/dynamic', 'next-themes', 'redoc',
      ];

      opts.loader = {
        ...opts.loader,
        '.tsx': 'tsx',
        '.ts': 'tsx',
        '.mdx': 'tsx',
        '.md': 'tsx',
        '.jsx': 'jsx',
        '.js': 'jsx',
        '.json': 'json',
        '.png': 'empty',
        '.jpg': 'empty',
        '.gif': 'empty',
        '.svg': 'empty',
      };

      return opts;
    },
    mdxOptions(mdxOpts) {
      mdxOpts.development = false;
      return mdxOpts;
    },
    globals: {
      'nextra/components': {
        varName: '__nextraComponents',
        type: 'cjs' as const,
      },
    },
  });

  // Evaluate the bundled code to get the MDX component
  const stubComponents = {
    Callout,
    Tabs,
    Cards,
    HiddenFAQ,
    ApiSpecPage,
  };

  // mdx-bundler appends ";return Component;" after the IIFE — strip it
  // so the code is a valid expression/statements block.
  const cleanCode = code.replace(/;return\s+Component\s*;?\s*$/, '');

  // The IIFE bundle expects these globals:
  //   _jsx_runtime       — React JSX runtime (jsx, jsxs, Fragment)
  //   __nextraComponents — our stubs for nextra/components
  //   React              — React itself (esbuild maps external 'react' to this)
  // The IIFE itself assigns to __mdxBundle via
  //   var __mdxBundle = (()=>{...})();
  // so we just need to return __mdxBundle.default after execution.
  const jsxRuntime = await import('react/jsx-runtime');

  const getMDXModule = new Function(
    '_jsx_runtime',
    '__nextraComponents',
    'React',
    `
    ${cleanCode}
    return typeof __mdxBundle !== 'undefined' && __mdxBundle
      ? (__mdxBundle.default || __mdxBundle)
      : undefined;
    `
  );

  let MDXContent: React.ComponentType<Record<string, unknown>>;
  try {
    MDXContent = getMDXModule(jsxRuntime, stubComponents, React);
  } catch {
    // If evaluation fails, return null — the file likely has
    // dynamic content that can't be statically rendered
    return null;
  }

  if (!MDXContent) {
    return null;
  }

  // Render to static HTML using our stub components
  let html: string;
  try {
    html = renderToStaticMarkup(
      React.createElement(MDXContent, { components: stubComponents })
    );
  } catch {
    return null;
  }

  if (!html || html.trim() === '') {
    return null;
  }

  // Convert HTML → clean Markdown
  let markdown = await htmlToMarkdown(html);
  markdown = markdown.trim();

  if (!markdown) {
    return null;
  }

  // Prepend frontmatter description as a leading paragraph
  if (frontmatter.description) {
    markdown = `${frontmatter.description}\n\n${markdown}`;
  }

  return markdown;
}

/* ------------------------------------------------------------------ */
/*  Batch conversion helper                                           */
/* ------------------------------------------------------------------ */

export interface ConvertResult {
  file: string;
  markdown: string | null;
  error?: string;
}

/**
 * Converts a list of MDX files to clean Markdown.
 *
 * @param files    Relative paths of MDX files (relative to docsDir/app/).
 * @param docsDir  Absolute path to the docs/ directory.
 * @returns Array of conversion results.
 */
export async function convertMdxFiles(
  files: string[],
  docsDir: string
): Promise<ConvertResult[]> {
  const appDir = path.join(docsDir, 'app');
  const results: ConvertResult[] = [];

  for (const file of files) {
    const fullPath = path.join(appDir, file);
    if (!existsSync(fullPath)) {
      results.push({ file, markdown: null, error: `File not found: ${fullPath}` });
      continue;
    }

    const source = readFileSync(fullPath, 'utf-8');
    try {
      const markdown = await mdxToMarkdown(source, {
        docsDir,
        filePath: fullPath,
      });
      results.push({ file, markdown });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ file, markdown: null, error: message });
    }
  }

  return results;
}
