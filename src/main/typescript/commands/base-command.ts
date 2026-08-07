import { StreamingJobExecutor } from '../lib/streaming-job-executor.js';
import { FormattableCommandOptions } from '../types.js';
import { SchemaCreateJob } from '../openapi/openApiTypes.js';

export abstract class BaseCommand<T extends FormattableCommandOptions> {
  private streamingExecutor: StreamingJobExecutor;

  constructor() {
    this.streamingExecutor = new StreamingJobExecutor();
  }

  abstract execute(options: T): Promise<void>;

  protected async processJobStream(jobDefinition: SchemaCreateJob, options: T): Promise<void> {
    await this.streamingExecutor.execute(jobDefinition, options);
  }

  protected handleError(error: unknown, context = ''): never {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] ${context ? `${context}: ${message}` : message}`);
    process.exit(1);
  }
}
