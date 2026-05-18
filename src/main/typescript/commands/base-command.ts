import { StreamingJobExecutor } from '../lib/streaming-job-executor.js';
import { GreprApiClient } from '../lib/api-client.js';
import { FormattableCommandOptions } from '../types.js';
import { SchemaCreateJob } from '../openapi/openApiTypes.js';

export abstract class BaseCommand<T extends FormattableCommandOptions> {
  private streamingExecutor: StreamingJobExecutor;
  protected apiClient: GreprApiClient | null = null;

  constructor() {
    this.streamingExecutor = new StreamingJobExecutor();
  }

  abstract execute(options: T): Promise<void>;

  protected async processJobStream(jobDefinition: SchemaCreateJob, options: T): Promise<void> {
    await this.streamingExecutor.execute(jobDefinition, options);
  }

  protected initializeComponents(options: T): void {
    // For backward compatibility, create the API client here
    // The streaming executor will create its own client as needed
    this.apiClient = this.streamingExecutor.createApiClient(options);
  }

  protected handleError(error: Error, context = ''): void {
    const errorMsg = context ? `${context}: ${error.message}` : error.message;
    console.error(`[ERROR] ${errorMsg}`);
    process.exit(1);
  }
}