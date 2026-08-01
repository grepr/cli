import fs from 'fs-extra';
import { Writable } from 'stream';
import { GreprApiClient } from './api-client.js';
import { createApiClient } from './api-client-factory.js';
import { HeartbeatManager } from './heartbeat.js';
import { JsonFormatter, JsonFormatterOptions } from './json-formatter.js';
import { NDJsonStreamParser } from './parser.js';
import { isMachineReadable, OutputFormat } from './output-format.js';
import { FormattableCommandOptions, ProcessStats, HEARTBEAT_EVENTS, STREAM_EVENTS, LogEventData } from '../types.js';
import { SchemaCreateJob } from '../openapi/openApiTypes.js';

/**
 * Utility class for executing streaming jobs
 * Can be used by both BaseCommand and JobCrudCommand for synchronous job execution
 */
export class StreamingJobExecutor {
  private formatter: JsonFormatter | null = null;
  private apiClient: GreprApiClient | null = null;
  private heartbeatManager: HeartbeatManager | null = null;
  private streamParser: NDJsonStreamParser | null = null;
  private outputFileStream: Writable | null = null;
  private outputFileError: Error | null = null;
  private completionStarted = false;
  private stats: ProcessStats;
  // Whether to emit job-state chatter ([CONNECTING], [CONNECTED], [RUNNING], [FINISHED]).
  // Toggled off by --no-job-state and automatically suppressed for machine-readable formats
  // so callers piping to jq/CSV don't get non-record lines mixed into stdout.
  private showJobState = true;

  constructor() {
    this.stats = {
      recordsProcessed: 0,
      heartbeatsSent: 0,
      errors: 0,
      errorMessages: [],
      startTime: null,
      endTime: null
    };
  }

  /**
   * Execute a streaming job
   */
  async execute(jobDefinition: SchemaCreateJob, options: FormattableCommandOptions): Promise<void> {
    try {
      this.initializeComponents(options);

      await this.processJobStream(jobDefinition, options);

    } catch (error) {
      this.handleError(error as Error, 'Streaming job execution error');
      process.exit(1);
    }
  }

  private setupFormatter(options: FormattableCommandOptions): void {
    const formatterOptions: JsonFormatterOptions = {
      format: (options.format as OutputFormat) || 'table',
      showTimestamps: options.timestamps !== false,
      colorize: options.color !== false && process.stdout.isTTY && !options.output,
      sortBy: options.sort || 'eventTimestamp:asc',
      maxDepth: options.maxDepth ?? 1,
      maxLines: options.maxLines ?? 4
    };

    // Only add timezone if it's defined
    if (options.timezone) {
      formatterOptions.timezone = options.timezone;
    }

    this.formatter = new JsonFormatter(formatterOptions);
  }

  private setupEventHandlers(options: FormattableCommandOptions, outputFile?: string): void {
    if (!this.heartbeatManager || !this.streamParser || !this.formatter) {
      throw new Error('Components not initialized');
    }

    // Initialize output file stream if specified
    if (outputFile) {
      this.outputFileStream = this.createOutputFileStream(outputFile);
    }

    // Heartbeat events
    this.heartbeatManager.on(HEARTBEAT_EVENTS.REQUEST, (token: string) => {
      if (options.debug && !options.quiet) {
        if (this.formatter) {
          console.log(this.formatter.formatHeartbeatStatus('RECEIVED', `token: ${token.substring(0, 8)}...`));
        }
      }
    });

    this.heartbeatManager.on(HEARTBEAT_EVENTS.SENT, (token: string) => {
      this.stats.heartbeatsSent++;
      if (options.debug && !options.quiet) {
        if (this.formatter) {
          console.log(this.formatter.formatHeartbeatStatus('SENT', `token: ${token.substring(0, 8)}...`));
        }
      }
    });

    this.heartbeatManager.on(HEARTBEAT_EVENTS.ERROR, (error: Error, token?: string) => {
      this.stats.errors++;
      const errorMsg = `Heartbeat on token ${token} failed: ${error.message}`;
      this.stats.errorMessages.push(errorMsg);
    });

    this.heartbeatManager.on(HEARTBEAT_EVENTS.RETRY, (attempt: number, maxRetries: number, error: Error) => {
      if (!options.quiet) {
        if (this.formatter) {
          console.log(this.formatter.formatHeartbeatStatus('RETRY', `${attempt}/${maxRetries}: ${error.message}`));
        }
      }
    });

    // Stream parser events
    this.streamParser.on(STREAM_EVENTS.HEARTBEAT_REQUEST, async (heartbeatToken: string) => {
      if (heartbeatToken && this.heartbeatManager) {
        await this.heartbeatManager.handleHeartbeatRequest(heartbeatToken);
      }
    });

    this.streamParser.on(STREAM_EVENTS.DATA, (data: LogEventData) => {
      this.stats.recordsProcessed++;

      if (this.formatter && this.formatter.options.format === 'table') {
        // For table format, just accumulate data (will be written at the end)
        this.formatter.formatLogData(data); // This adds to internal table data
      } else {
        // For other formats, output immediately
        if (!this.formatter) {
          throw new Error('Formatter not initialized');
        }
        const formattedData = this.formatter.formatLogData(data);
        this.writeOutput(formattedData);
      }
    });

    this.streamParser.on(STREAM_EVENTS.FINISHED, () => {
      this.completeJob('FINISHED');
    });

    this.streamParser.on(STREAM_EVENTS.FAILED, (data) => {
      this.stats.errors++;
      const errorMsg = `Job failed: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.completeJob('FAILED');
    });

    this.streamParser.on(STREAM_EVENTS.CANCELLED, (data) => {
      this.stats.errors++;
      const errorMsg = `Job was cancelled: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.completeJob('CANCELLED');
    });

    this.streamParser.on(STREAM_EVENTS.TIMED_OUT, (data) => {
      this.stats.errors++;
      const errorMsg = `Job timed out: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.completeJob('TIMED_OUT');
    });

    this.streamParser.on(STREAM_EVENTS.SCANNED_MAX, (data) => {
      this.stats.errors++;
      const errorMsg = `Hit data scan limit: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.completeJob('SCANNED_MAX');
    });

    this.streamParser.on(STREAM_EVENTS.PARSE_ERROR, (error: Error, jsonLine?: string) => {
      this.stats.errors++;
      const errorMsg = `JSON parsing error: ${error.message}`;
      this.stats.errorMessages.push(errorMsg);
      this.stats.errorMessages.push(`Problematic line: ${jsonLine}`);
    });
  }

  private completeJob(finalState: string): void {
    // Stream events don't await completion, so a failure here is reported and
    // turned into a non-zero exit code instead of an unhandled rejection.
    void this.handleJobCompletion(finalState).catch((error: unknown) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)), 'Failed to complete streaming job');
      process.exitCode = 1;
    });
  }

  private async handleJobCompletion(finalState: string): Promise<void> {
    if (this.completionStarted) {
      return;
    }
    this.completionStarted = true;
    this.stats.endTime = Date.now();

    if (this.heartbeatManager) {
      this.heartbeatManager.stop();
      this.heartbeatManager = null;
    }

    const duration = this.stats.endTime - (this.stats.startTime || 0);
    this.stats.duration = this.formatDuration(duration);

    if (this.showJobState) {
      if (this.formatter) {
        console.log(this.formatter.formatJobState(finalState));
      } else {
        console.log(`Job completed with state: ${finalState}`);
      }
    }

    await this.printFinalState();

    const succeeded = finalState === 'FINISHED' && !this.outputFileError;
    await this.exitAfterFlush(succeeded ? 0 : 1);
  }

  private handleError(error: Error, context = ''): void {
    this.stats.errors++;

    const errorMsg = context ? `${context}: ${error.message}` : error.message;
    this.stats.errorMessages.push(errorMsg);

    if (this.formatter) {
      console.error(this.formatter.formatError(error, context));
    } else {
      console.error(`[ERROR] ${context}: ${error.message}`);
    }

    if (this.heartbeatManager) {
      this.heartbeatManager.stop();
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string): Promise<void> => {
      if (this.formatter) {
        console.log(`\n${this.formatter.formatConnectionStatus('DISCONNECTED', `Received ${signal}, shutting down...`)}`);
      } else {
        console.log(`\nReceived ${signal}, shutting down...`);
      }

      if (this.heartbeatManager) {
        this.heartbeatManager.stop();
      }

      // A signal during completion must not re-run the final report; the
      // completion path is already flushing and about to exit on its own.
      if (!this.completionStarted) {
        this.completionStarted = true;
        await this.printFinalState();
      }

      await this.exitAfterFlush(130); // 128 + SIGINT
    };

    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
  }

  private async printFinalState(): Promise<void> {
    // Render partial table data if available
    if (this.formatter && this.formatter.options.format === 'table') {
      this.writeOutput(this.formatter.renderTable());
    }

    try {
      await this.closeOutputFileStream();
    } catch (error) {
      this.outputFileError = error instanceof Error ? error : new Error(String(error));
      this.handleError(this.outputFileError, 'Failed to write output file');
    }

    // Print error messages if any occurred (always to console, not to file)
    if (this.stats.errorMessages.length > 0) {
      console.log('\nErrors encountered:');
      this.stats.errorMessages.forEach(errorMsg => {
        console.error(`  ${errorMsg}`);
      });
    }

    this.stats.endTime = Date.now();
    const duration = this.stats.endTime - (this.stats.startTime || 0);
    this.stats.duration = this.formatDuration(duration);

    // Summary contains non-JSON lines ("Records processed: 3", "Duration: 4s") that
    // would corrupt machine-readable output piped to jq/CSV parsers. Route to stderr
    // in those modes so it stays visible to humans but doesn't pollute stdout.
    if (this.formatter) {
      const summary = this.formatter.formatSummary(this.stats);
      if (this.showJobState) {
        console.log(summary);
      } else {
        console.error(summary);
      }
    }
  }

  /**
   * Exit only after queued stdout/stderr writes have reached their destination.
   * process.stdout is asynchronous when piped, so exiting straight after a write
   * truncates whatever the consumer has not read yet.
   */
  private async exitAfterFlush(code: number): Promise<void> {
    await Promise.all([this.flushStream(process.stdout), this.flushStream(process.stderr)]);
    process.exit(code);
  }

  private async flushStream(stream: NodeJS.WriteStream): Promise<void> {
    if (stream.writableEnded || stream.destroyed) {
      return;
    }

    // Write callbacks run in order, so an empty trailing write calls back only
    // once everything queued ahead of it has been flushed.
    await new Promise<void>(resolve => {
      const done = (): void => {
        stream.off('error', done);
        resolve();
      };

      stream.once('error', done);
      stream.write('', () => done());
    });
  }

  private createOutputFileStream(outputFile: string): Writable {
    const outputFileStream = fs.createWriteStream(outputFile);

    // The stream can fail any time after creation (EISDIR for a directory, ENOENT
    // for a missing parent, ENOSPC mid-run), so it needs an error listener for its
    // whole life rather than only while closing.
    outputFileStream.once('error', (error: Error) => {
      this.outputFileError = error;
      this.handleError(error, `Failed to write output file ${outputFile}`);
      this.completeJob('OUTPUT_FILE_ERROR');
    });

    return outputFileStream;
  }

  private writeOutput(text: string): void {
    // A failed output file is not silently redirected to stdout: the error is
    // already recorded and the job is completing with a non-zero exit code.
    if (this.outputFileError) {
      return;
    }

    if (this.outputFileStream) {
      this.outputFileStream.write(text + '\n');
    } else {
      console.log(text);
    }
  }

  private async closeOutputFileStream(): Promise<void> {
    const outputFileStream = this.outputFileStream;
    this.outputFileStream = null;
    if (!outputFileStream) {
      return;
    }

    // An errored stream is already destroyed, so end() would never call back.
    if (this.outputFileError) {
      outputFileStream.destroy();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        reject(error);
      };

      outputFileStream.once('error', onError);
      outputFileStream.end(() => {
        outputFileStream.off('error', onError);
        resolve();
      });
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  public createApiClient(options: FormattableCommandOptions): GreprApiClient {
    return createApiClient(options);
  }

  private initializeComponents(options: FormattableCommandOptions): void {
    this.setupFormatter(options);
    this.stats.startTime = Date.now();
    this.completionStarted = false;
    this.outputFileError = null;

    // Machine-readable formats (compact, raw, csv) suppress job-state chatter by default
    // so callers piping to jq/CSV-parsers don't see interleaved status lines. Explicit
    // --no-job-state always wins. Human-readable formats (table, pretty) keep chatter on.
    this.showJobState = options.jobState !== false && !isMachineReadable(options.format);

    if (!options.quiet && this.showJobState) {
      if (this.formatter) {
        console.log(this.formatter.formatConnectionStatus('CONNECTING', `(${options.orgName})`));
      }
    }

    this.apiClient = this.createApiClient(options);
    this.heartbeatManager = new HeartbeatManager(this.apiClient);
    this.streamParser = new NDJsonStreamParser();
  }

  private async processJobStream(jobDefinition: SchemaCreateJob, options: FormattableCommandOptions): Promise<void> {
    // Setup event handlers
    this.setupEventHandlers(options, options.output);

    if (!options.quiet && this.showJobState) {
      if (this.formatter) {
        console.log(this.formatter.formatConnectionStatus('CONNECTED'));
        console.log(this.formatter.formatJobState('RUNNING'));
      }
    }

    // Submit job and handle stream
    if (!this.apiClient) {
      throw new Error('API client not initialized');
    }
    if (!this.heartbeatManager) {
      throw new Error('Heartbeat manager not initialized');
    }
    if (!this.streamParser) {
      throw new Error('Stream parser not initialized');
    }

    const responseStream = await this.apiClient.submitSyncJob(jobDefinition);

    this.heartbeatManager.start();

    // Process the response stream
    responseStream.on('data', (chunk: Buffer) => {
      if (this.streamParser) {
        this.streamParser.processChunk(chunk);
      }
    });

    responseStream.on('end', () => {
      if (this.streamParser) {
        this.streamParser.finalize();
      }
      this.completeJob('STREAM_ENDED');
    });

    responseStream.on('error', (error: Error) => {
      this.handleError(error, 'Stream error');
    });

    // Handle process interruption
    this.setupGracefulShutdown();
  }
}
