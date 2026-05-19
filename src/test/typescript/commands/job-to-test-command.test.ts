/**
 * Tests for the job:to-test CLI command.
 *
 * These tests verify:
 * - Command registration and option parsing
 * - Option validation
 * - File loading and error handling
 * - Output formatting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { JobToTestCommand } from '@/commands/job-to-test-command.js';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('JobToTestCommand', () => {
  let command: JobToTestCommand;
  let program: Command;
  let tempDir: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    command = new JobToTestCommand();
    program = new Command();
    program.exitOverride();
    // Mirror the global -o/--output flag from grepr.ts so tests exercise
    // the same parent-options merging path that production uses.
    program.option('-o, --output <file>', 'Output results to file instead of stdout');

    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-to-test-'));

    // Spy on console.error and process.exit
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.remove(tempDir);
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('command registration', () => {
    it('test_registration_addToProgram_shouldRegisterCommandWithCorrectOptions', () => {
      // Given: A commander program
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;

      // When: Register command
      command.addToProgram(program, mockMergeConfig);

      // Then: Command should be registered with correct name and options
      const registeredCommand = program.commands.find(cmd => cmd.name() === 'job:to-test');
      expect(registeredCommand).toBeDefined();
      expect(registeredCommand?.description()).toBe('Transform a job configuration for testing');

      // Check key options are registered
      const optionNames = registeredCommand?.options.map(opt => opt.long);
      expect(optionNames).toContain('--execution');
      expect(optionNames).toContain('--processing');
      expect(optionNames).toContain('--dataset-id');
      expect(optionNames).toContain('--test-dataset');
      expect(optionNames).toContain('--show-diff');
      // --output is a global program flag, not a sub-command flag — verified separately below.
      expect(optionNames).not.toContain('--output');
    });
  });

  describe('option validation', () => {
    it('test_validation_mutuallyExclusiveOptions_shouldLogErrorAndExit', async () => {
      // Given: Job file with sample data and dataset options
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'ASYNCHRONOUS',
        processing: 'STREAMING',
        jobGraph: { vertices: [], edges: [] }
      });

      // When: Try to use both --sample-data-file and --dataset-id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile,
          '--sample-data-file', 'sample.json',
          '--dataset-id', 'dataset_123',
          '--start', '2025-01-01T00:00:00Z',
          '--end', '2025-01-01T01:00:00Z'
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('Cannot use both --sample-data-file and --dataset-id')
      );
    });

    it('test_validation_datasetWithoutTimeRange_shouldLogErrorAndExit', async () => {
      // Given: Job file
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'ASYNCHRONOUS',
        processing: 'STREAMING',
        jobGraph: { vertices: [], edges: [] }
      });

      // When: Try to use --dataset-id without --start and --end
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile,
          '--dataset-id', 'dataset_123'
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('--dataset-id requires --start and --end')
      );
    });

    it('test_validation_invalidExecutionType_shouldLogErrorAndExit', async () => {
      // Given: Job file
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'ASYNCHRONOUS',
        processing: 'STREAMING',
        jobGraph: { vertices: [], edges: [] }
      });

      // When: Try to use invalid execution type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile,
          '--execution', 'INVALID'
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('--execution must be SYNCHRONOUS or ASYNCHRONOUS')
      );
    });

    it('test_validation_invalidProcessingType_shouldLogErrorAndExit', async () => {
      // Given: Job file
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'ASYNCHRONOUS',
        processing: 'STREAMING',
        jobGraph: { vertices: [], edges: [] }
      });

      // When: Try to use invalid processing type
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile,
          '--processing', 'INVALID'
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('--processing must be BATCH or STREAMING')
      );
    });
  });

  describe('file operations', () => {
    it('test_fileLoading_validSyncJobFile_shouldLoadSuccessfully', async () => {
      // Given: Valid job file with SYNCHRONOUS execution (no testDataset required)
      const jobFile = path.join(tempDir, 'valid-job.json');
      const job = {
        name: 'test_job',
        execution: 'SYNCHRONOUS',
        processing: 'BATCH',
        jobGraph: {
          vertices: [
            { type: 'datadog-log-agent-source', name: 'source', integrationId: 'int' },
            { type: 'datadog-log-sink', name: 'sink', integrationId: 'int' }
          ],
          edges: ['source -> sink']
        }
      };
      await fs.writeJson(jobFile, job);

      const outputFile = path.join(tempDir, 'output.json');

      // When: Transform job
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      await program.parseAsync([
        'node',
        'test',
        'job:to-test',
        jobFile,
        '--output', outputFile,
        '--test-tag', 'test_123',
        '--dataset-id', 'test_dataset',
        '--start', '2025-01-01T00:00:00Z',
        '--end', '2025-01-01T01:00:00Z'
      ]);

      // Then: Output file should be created
      const outputExists = await fs.pathExists(outputFile);
      expect(outputExists).toBe(true);

      // And: Output should be valid JSON
      const outputJob = await fs.readJson(outputFile);
      expect(outputJob.name).toBe('test_job_test');
      expect(outputJob.tags?.['grepr.test_run_id']).toBe('test_123');
    });

    it('test_fileLoading_missingFile_shouldLogErrorAndExit', async () => {
      // Given: Non-existent job file
      const jobFile = path.join(tempDir, 'nonexistent.json');

      // When: Try to load missing file
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('Job definition file not found')
      );
    });

    it('test_fileLoading_invalidJson_shouldLogErrorAndExit', async () => {
      // Given: Invalid JSON file
      const jobFile = path.join(tempDir, 'invalid.json');
      await fs.writeFile(jobFile, '{ invalid json }');

      // When: Try to load invalid JSON
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('Failed to load job definition')
      );
    });

    it('test_fileLoading_missingRequiredFields_shouldLogErrorAndExit', async () => {
      // Given: Job file missing required fields
      const jobFile = path.join(tempDir, 'incomplete.json');
      await fs.writeJson(jobFile, {
        name: 'test_job'
        // Missing execution and processing
      });

      // When: Try to load incomplete job
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      // Then: Should log error and exit
      await expect(async () => {
        await program.parseAsync([
          'node',
          'test',
          'job:to-test',
          jobFile
        ]);
      }).rejects.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error transforming job:',
        expect.stringContaining('Invalid job definition: missing required fields')
      );
    });
  });

  describe('output formatting', () => {
    it('test_outputFormatting_prettyPrint_shouldFormatWithIndentation', async () => {
      // Given: Job file with SYNCHRONOUS execution
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'SYNCHRONOUS',
        processing: 'BATCH',
        jobGraph: {
          vertices: [
            { type: 'datadog-log-agent-source', name: 'source', integrationId: 'int' },
            { type: 'datadog-log-sink', name: 'sink', integrationId: 'int' }
          ],
          edges: ['source -> sink']
        }
      });

      const outputFile = path.join(tempDir, 'pretty.json');

      // When: Transform with pretty printing (default)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      await program.parseAsync([
        'node',
        'test',
        'job:to-test',
        jobFile,
        '--output', outputFile,
        '--test-tag', 'test_pretty',
        '--dataset-id', 'test_dataset',
        '--start', '2025-01-01T00:00:00Z',
        '--end', '2025-01-01T01:00:00Z'
      ]);

      // Then: Output should be pretty-printed (contains newlines and indentation)
      const outputContent = await fs.readFile(outputFile, 'utf-8');
      expect(outputContent).toContain('\n');
      expect(outputContent).toContain('  '); // Indentation
    });

    it('test_outputFormatting_compactPrint_shouldFormatWithoutIndentation', async () => {
      // Given: Job file with SYNCHRONOUS execution
      const jobFile = path.join(tempDir, 'job.json');
      await fs.writeJson(jobFile, {
        name: 'test_job',
        execution: 'SYNCHRONOUS',
        processing: 'BATCH',
        jobGraph: {
          vertices: [
            { type: 'datadog-log-agent-source', name: 'source', integrationId: 'int' },
            { type: 'datadog-log-sink', name: 'sink', integrationId: 'int' }
          ],
          edges: ['source -> sink']
        }
      });

      const outputFile = path.join(tempDir, 'compact.json');

      // When: Transform with --no-pretty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      await program.parseAsync([
        'node',
        'test',
        'job:to-test',
        jobFile,
        '--output', outputFile,
        '--no-pretty',
        '--test-tag', 'test_compact',
        '--dataset-id', 'test_dataset',
        '--start', '2025-01-01T00:00:00Z',
        '--end', '2025-01-01T01:00:00Z'
      ]);

      // Then: Output should be compact (single line, no extra whitespace)
      const outputContent = await fs.readFile(outputFile, 'utf-8');
      const lines = outputContent.trim().split('\n');
      expect(lines.length).toBe(1);
    });
  });

  describe('integration tests', () => {
    it('test_integration_fullTransformation_shouldProduceCorrectOutput', async () => {
      // Given: Production job file
      const jobFile = path.join(tempDir, 'prod-job.json');
      const productionJob = {
        name: 'production_pipeline',
        execution: 'ASYNCHRONOUS',
        processing: 'STREAMING',
        jobGraph: {
          vertices: [
            {
              type: 'datadog-log-agent-source',
              name: 'datadog_source',
              integrationId: 'integration_123'
            },
            {
              type: 'logs-filter',
              name: 'error_filter',
              predicate: {
                type: 'datadog-query',
                query: 'status:error'
              }
            },
            {
              type: 'datadog-log-sink',
              name: 'datadog_sink',
              integrationId: 'integration_123'
            },
            {
              type: 'logs-iceberg-table-sink',
              name: 'warehouse_sink',
              datasetId: 'warehouse_dataset'
            }
          ],
          edges: [
            'datadog_source -> error_filter',
            'error_filter -> datadog_sink',
            'error_filter -> warehouse_sink'
          ]
        },
        tags: {
          'env': 'production',
          'team': 'platform'
        }
      };
      await fs.writeJson(jobFile, productionJob);

      const outputFile = path.join(tempDir, 'test-job.json');

      // When: Transform to sync batch test
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mockMergeConfig = async (opts: Record<string, unknown>): Promise<any> => opts;
      command.addToProgram(program, mockMergeConfig);

      await program.parseAsync([
        'node',
        'test',
        'job:to-test',
        jobFile,
        '--execution', 'SYNCHRONOUS',
        '--processing', 'BATCH',
        '--dataset-id', 'test_dataset_abc',
        '--query', 'service:my-service',
        '--start', '2025-01-01T00:00:00Z',
        '--end', '2025-01-01T01:00:00Z',
        '--limit-records', '100',
        '--test-name', 'test_pipeline',
        '--test-tag', 'integration_test_123',
        '--output', outputFile
      ]);

      // Then: Output should contain expected structure
      const actualOutput = await fs.readJson(outputFile);

      // Verify job metadata
      expect(actualOutput.name).toBe('test_pipeline');
      expect(actualOutput.execution).toBe('SYNCHRONOUS');
      expect(actualOutput.processing).toBe('BATCH');
      expect(actualOutput.tags?.['env']).toBe('production');
      expect(actualOutput.tags?.['team']).toBe('platform');
      expect(actualOutput.tags?.['grepr.test_run_id']).toBe('integration_test_123');

      // Verify source was replaced with iceberg source
      const vertices = actualOutput.jobGraph?.vertices || [];
      const icebergSource = vertices.find((v: { type: string }) => v.type === 'logs-iceberg-table-source');
      expect(icebergSource).toBeDefined();
      expect(icebergSource.name).toBe('test_dataset_source');
      expect(icebergSource.datasetId).toBe('test_dataset_abc');
      expect(icebergSource.limit).toBe(100);
      expect(icebergSource.query?.query).toBe('service:my-service');

      // Verify filter is preserved
      const filter = vertices.find((v: { name: string }) => v.name === 'error_filter');
      expect(filter).toBeDefined();

      // Verify sink was replaced with sync sink
      const syncSink = vertices.find((v: { type: string }) => v.type === 'logs-sync-sink');
      expect(syncSink).toBeDefined();
      expect(syncSink.name).toBe('test_synchronous_sink');

      // Verify edges include port format
      const edges = actualOutput.jobGraph?.edges || [];
      expect(edges.length).toBeGreaterThan(0);
      edges.forEach((edge: string) => {
        expect(edge).toMatch(/\w+:\w+ -> \w+:\w+/);
      });
    });
  });
});
