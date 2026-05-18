import fs from 'fs-extra';
import { GreprApiClient } from './api-client.js';
import { createApiClient } from './api-client-factory.js';
import { HeartbeatManager } from './heartbeat.js';
import { JsonFormatter, JsonFormatterOptions } from './json-formatter.js';
import { NDJsonStreamParser } from './parser.js';
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
  private outputFileStream: fs.WriteStream | null = null;
  private stats: ProcessStats;

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
      format: (options.format as 'table' | 'csv' | 'pretty' | 'raw' | 'compact') || 'table',
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
      this.outputFileStream = fs.createWriteStream(outputFile);
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
        if (this.outputFileStream) {
          this.outputFileStream.write(formattedData + '\n');
        } else {
          console.log(formattedData);
        }
      }
    });

    this.streamParser.on(STREAM_EVENTS.FINISHED, () => {
      this.handleJobCompletion('FINISHED');
    });

    this.streamParser.on(STREAM_EVENTS.FAILED, (data) => {
      this.stats.errors++;
      const errorMsg = `Job failed: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.handleJobCompletion('FAILED');
    });

    this.streamParser.on(STREAM_EVENTS.CANCELLED, (data) => {
      this.stats.errors++;
      const errorMsg = `Job was cancelled: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.handleJobCompletion('CANCELLED');
    });

    this.streamParser.on(STREAM_EVENTS.TIMED_OUT, (data) => {
      this.stats.errors++;
      const errorMsg = `Job timed out: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.handleJobCompletion('TIMED_OUT');
    });

    this.streamParser.on(STREAM_EVENTS.SCANNED_MAX, (data) => {
      this.stats.errors++;
      const errorMsg = `Hit data scan limit: ${data?.message || 'No additional information'}`;
      this.stats.errorMessages.push(errorMsg);
      this.handleJobCompletion('SCANNED_MAX');
    });

    this.streamParser.on(STREAM_EVENTS.PARSE_ERROR, (error: Error, jsonLine?: string) => {
      this.stats.errors++;
      const errorMsg = `JSON parsing error: ${error.message}`;
      this.stats.errorMessages.push(errorMsg);
      this.stats.errorMessages.push(`Problematic line: ${jsonLine}`);
    });
  }

  private handleJobCompletion(finalState: string): void {
    this.stats.endTime = Date.now();

    if (this.heartbeatManager) {
      this.heartbeatManager.stop();
      this.heartbeatManager = null;
    } else {
      // Already stopped everything.
      return;
    }

    const duration = this.stats.endTime - (this.stats.startTime || 0);
    this.stats.duration = this.formatDuration(duration);

    if (this.formatter) {
      console.log(this.formatter.formatJobState(finalState));
    } else {
      console.log(`Job completed with state: ${finalState}`);
    }

    this.printFinalState();

    if (finalState !== 'FINISHED') {
      process.exit(1);
    } else {
      process.exit(0);
    }
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
    const shutdown = (signal: string): void => {
      if (this.formatter) {
        console.log(`\n${this.formatter.formatConnectionStatus('DISCONNECTED', `Received ${signal}, shutting down...`)}`);
      } else {
        console.log(`\nReceived ${signal}, shutting down...`);
      }

      if (this.heartbeatManager) {
        this.heartbeatManager.stop();
      }

      // Close output file stream if it's open
      if (this.outputFileStream) {
        this.outputFileStream.end();
        this.outputFileStream = null;
      }

      this.printFinalState();

      process.exit(130); // 128 + SIGINT
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  private printFinalState(): void {
    // Render partial table data if available
    if (this.formatter && this.formatter.options.format === 'table') {
      const tableOutput = this.formatter.renderTable();
      if (this.outputFileStream) {
        this.outputFileStream.write(tableOutput + '\n');
      } else {
        console.log(tableOutput);
      }
    }

    // Close output file stream if it was used
    if (this.outputFileStream) {
      this.outputFileStream.end();
      this.outputFileStream = null;
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

    // Summary always goes to console, not to file
    if (this.formatter) {
      console.log(this.formatter.formatSummary(this.stats));
    }
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

    if (!options.quiet) {
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

    if (!options.quiet) {
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
      this.handleJobCompletion('STREAM_ENDED');
    });

    responseStream.on('error', (error: Error) => {
      this.handleError(error, 'Stream error');
    });

    // Handle process interruption
    this.setupGracefulShutdown();
  }
}