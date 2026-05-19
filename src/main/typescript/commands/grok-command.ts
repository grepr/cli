import { Command } from 'commander';
import { ICommand } from '../lib/command-registry.js';
import { GreprApiClient } from '../lib/api-client.js';
import { createApiClient, ApiClientFactoryOptions } from '../lib/api-client-factory.js';
import { JsonFormatter, JsonFormatterOptions } from '../lib/json-formatter.js';
import { OutputFormat } from '../lib/output-format.js';
import { parseIntArg } from '../lib/option-parsers.js';
import { SchemaGrokParseResponse, SchemaGrokParseBatchRequest, GrokParserType } from '../openapi/openApiTypes.js';
import { MergeConfiguration, CommandOptionsRecord } from '../types.js';
import fs from 'fs-extra';

export interface GrokParseCommandOptions extends ApiClientFactoryOptions {
  quiet?: boolean;
  timezone?: string;
  output?: string;
  format?: OutputFormat;
  color?: boolean;
  timestamps?: boolean;
  pattern?: string;
  sample?: string;
  samplesFile?: string;
  extractAttribute?: string;
  helperRules?: string[];
  maxDepth?: number;
  maxLines?: number;
}

/**
 * Grok parse command implementation for testing Grok patterns against log samples
 */
export class GrokParseCommand implements ICommand {
  private formatter: JsonFormatter | null = null;
  private apiClient: GreprApiClient | null = null;

  /**
   * Get the command name
   */
  getCommandName(): string {
    return 'grok:parse';
  }

  /**
   * Get the command description
   */
  getCommandDescription(): string {
    return 'Test Grok patterns against log samples';
  }

  /**
   * Add this command to the program
   */
  addToProgram(
    program: Command,
    mergeConfiguration: MergeConfiguration
  ): void {
    program
      .command(this.getCommandName())
      .description(this.getCommandDescription())
      .option('-p, --pattern <pattern>', 'Grok parsing rule to test')
      .option('-s, --sample <sample>', 'Log sample to parse')
      .option('--samples-file <file>', 'File containing log samples (one per line)')
      .option('--extract-attribute <attribute>', 'Optional attribute to extract')
      .option('--helper-rules <rules...>', 'Additional grok helper rules')
      .option('-f, --format <format>', 'Output format (table, csv, pretty, raw, compact)', 'raw')
      .option('--no-color', 'Disable colored output')
      .option('--no-timestamps', 'Hide timestamps')
      .option('--max-depth <number>', 'Maximum object nesting depth for table columns', parseIntArg, 1)
      .option('--max-lines <number>', 'Maximum lines per table cell', parseIntArg, 4)
      .action(async (options: CommandOptionsRecord, command: Command) => {
        try {
          const globalOptions = command.parent?.opts() || {};
          const mergedGlobalOptions = await mergeConfiguration(globalOptions);
          const mergedOptions: GrokParseCommandOptions = {
            ...mergedGlobalOptions,
            ...options
          };

          await this.execute(mergedOptions);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`Error executing ${this.getCommandName()}:`, errorMessage);
          process.exit(1);
        }
      });
  }

  /**
   * Execute the grok parse operation
   */
  async execute(options: GrokParseCommandOptions): Promise<void> {
    try {
      this.apiClient = this.createApiClient(options);

      // Prepare the request payload
      const request = await this.buildGrokParseBatchRequest(options);

      // Call the batch API
      const result = await this.apiClient.getClient().POST('/v1/grok/parse/batch', {
        body: request
      });

      if (result.error) {
        throw new Error(`Grok parse failed: ${JSON.stringify(result.error)}`);
      }

      // Format and output the results
      if (result.data && result.data.results && result.data.results.length > 0) {
        if (options.format === 'raw' && options.quiet) {
          console.log(JSON.stringify(result.data, null, 2));
        } else {
          for (let i = 0; i < result.data.results.length; i++) {
            const singleResult = result.data.results[i];
            if (singleResult) {
              if (result.data.results.length > 1 && !options.quiet) {
                console.log(`\n=== Sample ${i + 1} ===`);
              }

              await this.formatAndOutput(singleResult, options);

              if (!options.quiet) {
                this.showParsingSummary(singleResult, options);
              }
            }
          }

          if (result.data.results.length > 1 && !options.quiet) {
            this.showBatchSummary(result.data.results, options);
          }
        }
      } else {
        if (!options.quiet) {
          console.log('No data returned from grok parsing API.');
        }
      }

    } catch (error) {
      console.error('Error parsing with Grok:', (error as Error).message);
      process.exit(1);
    }
  }

  /**
   * Build the grok parse batch request from options
   */
  private async buildGrokParseBatchRequest(options: GrokParseCommandOptions): Promise<SchemaGrokParseBatchRequest> {
    // Get the log samples
    let logSamples: string[];
    if (options.sample) {
      logSamples = [options.sample];
    } else if (options.samplesFile) {
      if (!await fs.pathExists(options.samplesFile)) {
        throw new Error(`Samples file not found: ${options.samplesFile}`);
      }
      const samplesContent = await fs.readFile(options.samplesFile, 'utf-8');
      const samples = samplesContent.trim().split('\n').filter(line => line.trim());
      if (samples.length === 0) {
        throw new Error('Samples file is empty or contains no valid samples');
      }
      logSamples = samples;
    } else {
      throw new Error('Either --sample or --samples-file must be specified');
    }

    if (!options.pattern) {
      throw new Error('--pattern is required');
    }

    // Build the grok parser configuration
    const grokParser: SchemaGrokParseBatchRequest['grokParser'] = {
      name: 'cli_test_parser',
      grokParsingRules: [options.pattern],
      type: GrokParserType.grok_parser
    };

    // Add optional fields if provided
    if (options.extractAttribute) {
      grokParser.extractAttribute = options.extractAttribute;
    }

    if (options.helperRules && options.helperRules.length > 0) {
      grokParser.grokHelperRules = options.helperRules;
    }

    return {
      grokParser,
      logSamples
    };
  }

  /**
   * Create API client using shared factory
   */
  private createApiClient(options: GrokParseCommandOptions): GreprApiClient {
    return createApiClient(options);
  }

  /**
   * Setup formatter for output
   */
  private setupFormatter(options: GrokParseCommandOptions): void {
    const formatterOptions: JsonFormatterOptions = {
      format: (options.format as OutputFormat) || 'raw',
      showTimestamps: options.timestamps !== false,
      colorize: options.color !== false && process.stdout.isTTY && !options.output,
      sortBy: 'rule:asc',
      maxDepth: options.maxDepth ?? 1,
      maxLines: options.maxLines ?? 4
    };

    // Only add timezone if it's defined
    if (options.timezone) {
      formatterOptions.timezone = options.timezone;
    }

    this.formatter = new JsonFormatter(formatterOptions);
  }

  /**
   * Format and output data
   */
  private async formatAndOutput(
    data: SchemaGrokParseResponse | null,
    options: GrokParseCommandOptions
  ): Promise<void> {
    if (!data) {
      if (!options.quiet) {
        console.log('No results from grok parsing.');
      }
      return;
    }

    // Setup formatter
    this.setupFormatter(options);

    // Convert API response to displayable format
    const displayData = this.formatGrokResults(data);

    // Handle output
    if (options.output) {
      // Write to file
      if (!this.formatter) {
        throw new Error('Formatter not initialized');
      }
      const formattedData = this.formatter.formatObjects([displayData]);
      await fs.writeFile(options.output, formattedData);

      if (!options.quiet) {
        console.log(`✓ Output written to ${options.output}`);
      }
    } else {
      // Write to stdout
      if (options.format === 'raw') {
        console.log(JSON.stringify(displayData, null, 2));
      } else {
        if (!this.formatter) {
          throw new Error('Formatter not initialized');
        }
        console.log(this.formatter.formatObjects([displayData]));
      }
    }
  }

  /**
   * Convert grok API response to display format
   */
  private formatGrokResults(apiData: SchemaGrokParseResponse): Record<string, unknown> {
    return {
      match: apiData.match || false,
      matchingRuleName: apiData.matchingRuleName || null,
      attributes: apiData.attributes || {},
      tags: apiData.tags || {},
      topLevelFields: apiData.topLevelFields || {}
    };
  }

  /**
   * Show parsing summary
   */
  private showParsingSummary(data: SchemaGrokParseResponse, options: GrokParseCommandOptions): void {
    if (!options.quiet) {
      const hasMatch = !!data.match;
      const attributeCount = data.attributes ? Object.keys(data.attributes).length : 0;
      const tagCount = data.tags ? Object.keys(data.tags).length : 0;
      const topLevelFieldCount = data.topLevelFields ? Object.keys(data.topLevelFields).length : 0;

      console.log(`\nGrok Parse Summary:
- Match successful: ${hasMatch ? 'Yes' : 'No'}
- Matching rule: ${data.matchingRuleName || 'None'}
- Attributes extracted: ${attributeCount}
- Tags extracted: ${tagCount}
- Top level fields: ${topLevelFieldCount}`);
    }
  }

  /**
   * Show batch parsing summary
   */
  private showBatchSummary(results: SchemaGrokParseResponse[], options: GrokParseCommandOptions): void {
    if (!options.quiet) {
      const totalSamples = results.length;
      const successfulMatches = results.filter(r => r.match).length;
      const failedMatches = totalSamples - successfulMatches;

      console.log(`\n=== Batch Summary ===
- Total samples processed: ${totalSamples}
- Successful matches: ${successfulMatches}
- Failed matches: ${failedMatches}
- Success rate: ${totalSamples > 0 ? Math.round((successfulMatches / totalSamples) * 100) : 0}%`);
    }
  }
}