import { Command } from 'commander';
import { ICommand } from '../lib/command-registry.js';
import { DocsSearch } from '../lib/docs-search.js';
import { MergeConfiguration, CommandOptionsRecord } from '../types.js';

/**
 * CLI command for retrieving complete documentation content by URI.
 *
 * This command complements `docs:search` by providing a way to fetch the full
 * content of a document after identifying it through search. The typical workflow:
 *
 * 1. User searches: `grepr docs:search "datadog" -f compact`
 *    → Gets preview with URI: doc://integrations/datadog/page.mdx
 *
 * 2. User retrieves: `grepr docs:get "doc://integrations/datadog/page.mdx"`
 *    → Gets complete markdown content
 *
 * Design decisions:
 *
 * - **No format options**: Documents are already in markdown format, so we output
 *   them as-is. This makes the command simple and perfect for piping to other tools
 *   (e.g., AI assistants, markdown processors).
 *
 * - **Option A retrieval**: Uses direct document lookup via `DocsSearch.getDocument()`
 *   which internally calls `listDocuments()` and `renderAllSections()`. This is more
 *   efficient than query-based retrieval and returns sections in document order
 *   rather than relevance order.
 *
 * - **Clean output**: No headers, colors, or formatting. Just the raw markdown
 *   content. This is intentional for scriptability and AI integration.
 *
 * Example usage:
 *   grepr docs:get "doc://tutorials/first-pipeline/page.mdx"
 *   grepr docs:get "doc://integrations/datadog/page.mdx" | some-ai-tool
 */
export class DocsGetCommand implements ICommand {
  getCommandName(): string {
    return 'docs:get';
  }

  getCommandDescription(): string {
    return 'Retrieve full documentation content by URI (doc://...)';
  }

  addToProgram(program: Command, _mergeConfiguration: MergeConfiguration): void {
    program
      .command(this.getCommandName())
      .description(this.getCommandDescription())
      .argument('<uri>', 'Document URI (e.g., doc://tutorials/first-pipeline/page.mdx)')
      .action(async (uri: string, _options: CommandOptionsRecord) => {
        try {
          await this.execute(uri);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage);
          process.exit(1);
        }
      });
  }

  /**
   * Executes the document retrieval command.
   *
   * This method:
   * 1. Initializes the DocsSearch engine (loads embedding model and opens index)
   * 2. Retrieves the full document content by URI
   * 3. Outputs raw markdown to stdout (no formatting, perfect for piping)
   *
   * Error handling: If the document is not found, DocsSearch.getDocument() throws
   * an error which is caught by the action handler and displayed to the user.
   *
   * @param uri - Document URI in format 'doc://path/to/file.mdx'
   */
  private async execute(uri: string): Promise<void> {
    const search = new DocsSearch();
    await search.initialize();

    const content = await search.getDocument(uri);
    console.log(content);
  }
}
