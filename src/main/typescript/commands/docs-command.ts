import { Command } from 'commander';
import { ICommand } from '../lib/command-registry.js';
import { DocsSearch, SearchResult } from '../lib/docs-search.js';
import chalk from 'chalk';
import { MergeConfiguration, CommandOptionsRecord } from '../types.js';

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
      .option('-f, --format <type>', 'Output format (pretty, json, compact)', 'pretty')
      .option('-c, --context <tokens>', 'Tokens of context per section (default: 300)', '300')
      .option('-t, --type <filter>', 'Filter by type: doc (default), all, api, schema', 'doc')
      .option('--no-color', 'Disable colored output')
      .action(async (query: string, options: CommandOptionsRecord) => {
        try {
          await this.execute(query, options as DocsSearchOptions);
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
      type: options.type as 'all' | 'doc' | 'api' | 'schema' | undefined,
      contextTokens
    });

    if (results.length === 0) {
      console.log(chalk.yellow('No results found.'));
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
