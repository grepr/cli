import { Command, InvalidArgumentError } from 'commander';
import { ICommand } from '../lib/command-registry.js';
import { DocsSearch, SearchResult } from '../lib/docs-search.js';
import chalk from 'chalk';
import { MergeConfiguration, CommandOptionsRecord } from '../types.js';
import { isMachineReadable, resolveDefaultFormat } from '../lib/output-format.js';

/**
 * Command-line options for the docs:search command.
 */
export interface DocsSearchOptions {
  /** Maximum number of results to return */
  limit?: string;
  /** Minimum relevance score (0.0-1.0) */
  threshold?: string;
  /** Output format: pretty (colored, formatted), json (machine-readable), or compact (brief) */
  format?: 'pretty' | 'json' | 'compact';
  /** Whether colored output is enabled */
  color?: boolean;
  /** Whether to suppress progress messages */
  quiet?: boolean;
  /** Number of tokens of context to show per section (default: 300, ~1200 characters) */
  context?: string;
  /** Filter results by document type: doc (default, user docs), all, api (API operations), schema (data schemas) */
  type?: 'all' | 'doc' | 'api' | 'schema';
}

/**
 * Translates Commander's generic CommandOptionsRecord into the typed
 * DocsSearchOptions shape. Each field is extracted and runtime-validated against
 * its declared type so unions narrow naturally instead of via `as` assertion.
 * Unknown values fall through as undefined so consumers fall back to defaults.
 */
function parseDocsSearchOptions(opts: CommandOptionsRecord): DocsSearchOptions {
  const format = opts.format;
  const type = opts.type;
  return {
    limit: typeof opts.limit === 'string' ? opts.limit : undefined,
    threshold: typeof opts.threshold === 'string' ? opts.threshold : undefined,
    format: format === 'pretty' || format === 'json' || format === 'compact' ? format : undefined,
    color: typeof opts.color === 'boolean' ? opts.color : undefined,
    quiet: typeof opts.quiet === 'boolean' ? opts.quiet : undefined,
    context: typeof opts.context === 'string' ? opts.context : undefined,
    type: type === 'all' || type === 'doc' || type === 'api' || type === 'schema' ? type : undefined,
  };
}

/**
 * CLI command for searching Grepr documentation using semantic search.
 *
 * This command provides natural language search over the bundled documentation
 * index. Users can search with queries like "how to create a pipeline" or
 * "datadog integration" and get relevant documentation sections.
 *
 * Output formats:
 * - pretty: Human-readable with colors, headings, and previews (default)
 * - compact: Brief one-line summaries with scores
 * - json: Machine-readable JSON for scripting
 *
 * Example usage:
 *   grepr docs:search "how to create a pipeline"
 *   grepr docs:search "datadog" -l 10 --threshold 0.5
 *   grepr docs:search "integrations" -f json
 */
/**
 * docs:search renders prose, so it keeps its own format vocabulary rather than
 * the record-oriented one in output-format.ts. Its `compact` is a short prose
 * preview, not the single-line JSON that `compact` means elsewhere; `json` is
 * this command's machine-readable rendering. `raw` is accepted as an alias for
 * `json` because that is the machine-readable name every other command uses.
 */
const DOCS_FORMATS = ['pretty', 'json', 'compact'] as const;
type DocsFormat = (typeof DOCS_FORMATS)[number];

export function parseDocsFormat(value: string): DocsFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'raw') {
    return 'json';
  }
  if ((DOCS_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as DocsFormat;
  }

  throw new InvalidArgumentError(
    `must be one of ${DOCS_FORMATS.join(', ')} (or raw, an alias for json)`
  );
}

/**
 * Pick the default rendering from GREPR_OUTPUT_FORMAT. The env var selects a
 * CLASS of output rather than a literal format name, because this command's
 * names do not line up with the record-oriented ones: any machine-readable
 * setting resolves to this command's JSON rendering, and any human setting to
 * its prose. An explicit `-f` still names a docs format directly and wins.
 */
export function resolveDocsDefaultFormat(): DocsFormat {
  // 'table' as the fallback stands for "no env var set", which means prose.
  return isMachineReadable(resolveDefaultFormat('table')) ? 'json' : 'pretty';
}

export class DocsSearchCommand implements ICommand {
  getCommandName(): string {
    return 'docs:search';
  }

  getCommandDescription(): string {
    return 'Search Grepr documentation using semantic search';
  }

  addToProgram(program: Command, _mergeConfiguration: MergeConfiguration): void {
    program
      .command(this.getCommandName())
      .description(this.getCommandDescription())
      .argument('<query>', 'Search query')
      .option('-l, --limit <n>', 'Number of results to return', '5')
      .option('--threshold <score>', 'Minimum relevance score (0.0-1.0)', '0.0')
      .option('-f, --format <type>', 'Output format (pretty, json, compact)', parseDocsFormat, resolveDocsDefaultFormat())
      .option('-c, --context <tokens>', 'Tokens of context per section (default: 300)', '300')
      .option('-t, --type <filter>', 'Filter by type: doc (default), all, api, schema', 'doc')
      .option('--no-color', 'Disable colored output')
      .action(async (query: string, options: CommandOptionsRecord, command: Command) => {
        try {
          // Merge global options (--quiet, --debug, --timezone, etc.) so they
          // reach the subcommand, matching the pattern used by every other
          // ICommand implementation in this CLI.
          const globalOptions = command.parent?.opts() || {};
          const merged = { ...globalOptions, ...options };
          await this.execute(query, parseDocsSearchOptions(merged));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage);
          process.exit(1);
        }
      });
  }

  /**
   * Executes the search command.
   *
   * @param query - Natural language search query
   * @param options - Command options from CLI parsing
   */
  private async execute(query: string, options: DocsSearchOptions): Promise<void> {
    const limit = parseInt(options.limit || '5');
    const threshold = parseFloat(options.threshold || '0.0');
    const format = options.format || 'pretty';
    const contextTokens = parseInt(options.context || '300');

    const search = new DocsSearch();
    await search.initialize();

    if (!options.quiet) {
      console.error(chalk.dim(`Searching documentation for: "${query}"\n`));
    }

    const results = await search.search(query, {
      limit,
      threshold,
      type: options.type,
      contextTokens
    });

    if (results.length === 0) {
      // An empty result is still a result in JSON mode; a prose line there
      // would be the one non-JSON thing on an otherwise parseable stdout.
      if (format === 'json') {
        this.outputJson(results);
      } else {
        console.log(chalk.yellow('No results found.'));
      }
      return;
    }

    if (format === 'json') {
      this.outputJson(results);
    } else if (format === 'compact') {
      this.outputCompact(results, options.color !== false);
    } else {
      this.outputPretty(results, options.color !== false);
    }
  }

  /**
   * Outputs search results in JSON format.
   *
   * Useful for scripting and programmatic processing of search results.
   *
   * @param results - Search results to format
   */
  private outputJson(results: SearchResult[]): void {
    const output = results.map(r => ({
      score: r.score,
      uri: r.uri,
      sections: r.sections
    }));
    console.log(JSON.stringify(output, null, 2));
  }

  /**
   * Outputs search results in compact format.
   *
   * Shows one result per two lines: URI with score, then brief preview.
   * The preview shows the most relevant section text (not necessarily from the start).
   * Multiple sections are separated by ' [...] ' to indicate non-contiguous excerpts.
   * Useful for quick scanning of many results.
   *
   * @param results - Search results to format
   * @param useColor - Whether to use colored output (default: true)
   */
  private outputCompact(results: SearchResult[], useColor = true): void {
    results.forEach((result, i) => {
      const preview = result.sections
        .map(s => s.text)
        .join(' [...] ')
        .replace(/\n/g, ' ');

      const scoreLine = `${i + 1}. [${result.score.toFixed(3)}] ${result.uri}`;
      console.log(useColor ? chalk.cyan(scoreLine) : scoreLine);
      console.log(`   ${preview}`);
    });
  }

  /**
   * Outputs search results in pretty format with colors and formatting.
   *
   * This is the default format optimized for human readability:
   * - Colored headings and metadata (if color enabled)
   * - Displays relevant sections from the document (not necessarily from the start)
   * - Sections are ordered by relevance to the search query
   * - Multiple sections are separated by '--- [Section N] ---' to indicate non-contiguous excerpts
   * - Markdown headings (lines starting with #) are bolded (if color enabled)
   * - Results are well-spaced for easy reading
   *
   * @param results - Search results to format
   * @param useColor - Whether to use colored output (default: true)
   */
  private outputPretty(results: SearchResult[], useColor = true): void {
    results.forEach((result, i) => {
      const title = `\n${i + 1}. ${result.uri}`;
      console.log(useColor ? chalk.bold.cyan(title) : title);

      const relevance = `   Relevance: ${result.score.toFixed(3)}`;
      console.log(useColor ? chalk.dim(relevance) : relevance);
      console.log();

      result.sections.forEach((section, sectionIdx) => {
        if (sectionIdx > 0) {
          const separator = `   --- [Section ${sectionIdx + 1}] ---`;
          console.log(useColor ? chalk.dim(separator) : separator);
          console.log();
        }

        const lines = section.text.split('\n');
        lines.forEach(line => {
          if (line.trim().startsWith('#')) {
            console.log(useColor ? chalk.bold(`   ${line}`) : `   ${line}`);
          } else {
            console.log(`   ${line}`);
          }
        });
      });
    });

    const summary = `\nShowing ${results.length} result${results.length !== 1 ? 's' : ''}`;
    console.log(useColor ? chalk.dim(summary) : summary);
  }

}
