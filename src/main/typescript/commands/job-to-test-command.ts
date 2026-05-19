/**
 * CLI command for transforming production jobs into test configurations.
 *
 * The job:to-test command takes a production job definition and transforms it
 * for testing purposes. This is a pure transformation - no API calls are made.
 *
 * Key features:
 * - Replace sources with dataset queries or add record limits
 * - Replace sinks with synchronous test sinks or test dataset sinks
 * - Add test tagging to track test data
 * - Show diff of transformations
 * - Output to file or stdout
 *
 * Example usage:
 *   grepr job:to-test prod.json --execution SYNCHRONOUS --output test.json
 *   grepr job:to-test prod.json --dataset-id my_dataset --start 2025-01-01T00:00:00Z \
 *     --end 2025-01-01T01:00:00Z --show-diff
 */

import { Command } from 'commander';
import fs from 'fs-extra';
import { ICommand } from '@/lib/command-registry';
import { parseIntArg } from '@/lib/option-parsers';
import { JobExecution, JobProcessing, MergeConfiguration } from '@/types';
import { SchemaCreateJob } from '@/openapi/openApiTypes';
import { transformJobToTest, showDiff, JobToTestOptions } from '@/lib/job-graph-transformer';

/**
 * Command implementation for job:to-test.
 *
 * This command registers itself with the CLI and handles:
 * - Option parsing and validation
 * - Job file loading
 * - Transformation execution
 * - Output formatting and writing
 */
export class JobToTestCommand implements ICommand {
  /**
   * Registers the job:to-test command with the CLI program.
   *
   * @param program - The commander program to add the command to
   * @param _mergeConfiguration - Configuration merger (unused by this command)
   */
  addToProgram(program: Command, _mergeConfiguration: MergeConfiguration): void {
    program
      .command('job:to-test <input-file>')
      .description('Transform a job configuration for testing')
      // Output options (note: -o, --output is registered as a global flag on the program)
      .option('--no-pretty', 'Disable pretty printing')
      .option('--show-diff', 'Show transformation diff')

      // Execution and processing type overrides
      .option('--execution <type>', 'Execution type (SYNCHRONOUS|ASYNCHRONOUS)')
      .option('--processing <type>', 'Processing type (BATCH|STREAMING)')

      // Source options (mutually exclusive: sample data OR dataset)
      .option('--sample-data-file <file>', 'Sample logs file')
      .option('--dataset-id <id>', 'Dataset ID for source (requires --start and --end)')
      .option('--query <query>', 'Datadog syntax query for dataset source (optional, requires --dataset-id)')
      .option('--start <time>', 'Start time (ISO 8601)')
      .option('--end <time>', 'End time (ISO 8601)')
      .option('--limit-records <n>', 'Limit for batch sources', parseIntArg, 1000)

      // Sink options
      .option('--test-dataset <id>', 'Test dataset ID for async sinks (enables tagging)')

      // Test metadata
      .option('--test-tag <tag>', 'Custom test tag (default: auto-generated)')
      .option('--test-name <name>', 'Custom test job name (default: {original}_test)')
      .action(async (
        inputFile: string,
        options: JobToTestOptions & { pretty?: boolean; showDiff?: boolean; output?: string },
        command: Command
      ) => {
        try {
          // Merge global options (-o, --output, --quiet, etc.) with sub-command options.
          // Same pattern used by ListCommand/CrudCommand for consistent flag handling.
          const merged = { ...command.parent?.opts(), ...options };

          // Step 1: Validate that options are valid and compatible
          this.validateOptions(merged);

          // Step 2: Load the original job definition from file
          const originalJob = await this.loadJobFromFile(inputFile);

          // Step 3: Transform the job to test configuration
          const transformedJob = transformJobToTest(originalJob, merged);

          // Step 4: Show diff if requested (before outputting JSON)
          if (merged.showDiff) {
            showDiff(originalJob, transformedJob);
          }

          // Step 5: Format the output (pretty or compact JSON)
          const output = this.formatOutput(transformedJob, merged.pretty !== false);

          // Step 6: Write to file or stdout
          if (merged.output) {
            await fs.writeFile(merged.output, output);
            console.log(`✓ Test job written to ${merged.output}`);
          } else {
            console.log(output);
          }

        } catch (error) {
          console.error('Error transforming job:', (error as Error).message);
          process.exit(1);
        }
      });
  }

  /**
   * Validates command options for consistency and completeness.
   *
   * Validation rules:
   * - Cannot use both --sample-data-file and --dataset-id (mutually exclusive)
   * - --dataset-id requires --start and --end
   * - --execution must be SYNCHRONOUS or ASYNCHRONOUS
   * - --processing must be BATCH or STREAMING
   *
   * @param options - The command options to validate
   * @throws Error if validation fails
   */
  private validateOptions(options: JobToTestOptions): void {
    if (options.sampleDataFile && options.datasetId) {
      throw new Error('Cannot use both --sample-data-file and --dataset-id');
    }

    if (options.datasetId && (!options.start || !options.end)) {
      throw new Error('--dataset-id requires --start and --end');
    }

    if (options.execution && ![JobExecution.ASYNCHRONOUS, JobExecution.SYNCHRONOUS].includes(options.execution)) {
      throw new Error('--execution must be SYNCHRONOUS or ASYNCHRONOUS');
    }

    if (options.processing && ![JobProcessing.BATCH, JobProcessing.STREAMING].includes(options.processing)) {
      throw new Error('--processing must be BATCH or STREAMING');
    }
  }

  /**
   * Loads and validates a job definition from a JSON file.
   *
   * The file must exist and contain valid JSON with required fields:
   * - name: Job name
   * - execution: Execution type
   * - processing: Processing type
   *
   * @param jobFile - Path to the job definition file
   * @returns The loaded job definition
   * @throws Error if file not found, invalid JSON, or missing required fields
   */
  private async loadJobFromFile(jobFile: string): Promise<SchemaCreateJob> {
    if (!await fs.pathExists(jobFile)) {
      throw new Error(`Job definition file not found: ${jobFile}`);
    }

    let jobDefinition
    try {
      jobDefinition = await fs.readJson(jobFile);
    } catch (error) {
      throw new Error(`Failed to load job definition: ${(error as Error).message}`);
    }

    if (!jobDefinition.name || !jobDefinition.execution || !jobDefinition.processing) {
      throw new Error('Invalid job definition: missing required fields (name, execution, processing)');
    }

    return jobDefinition;
  }

  /**
   * Formats the transformed job as JSON string.
   *
   * @param transformedJob - The job to format
   * @param pretty - Whether to pretty-print (2-space indentation) or compact
   * @returns JSON string representation of the job
   */
  private formatOutput(transformedJob: SchemaCreateJob, pretty: boolean): string {
    if (pretty) {
      return JSON.stringify(transformedJob, null, 2);
    }
    return JSON.stringify(transformedJob);
  }
}
