// CLI API client using openapi-fetch with the same patterns as the frontend
import createClient from 'openapi-fetch'
import {
  paths,
  ReadDatadogType,
  ReadDataWarehouseType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadS3DataWarehouseType,
  ReadSplunkType,
  ReadSumoType,
  SchemaCreateBackfillJob,
  SchemaCreateJob,
  SchemaDatasetCreate,
  SchemaDatasetRead,
  SchemaDatasetUpdate,
  SchemaItemsCollectionReadDatadog,
  SchemaItemsCollectionReadDataWarehouse,
  SchemaItemsCollectionReadJob,
  SchemaItemsCollectionReadNewRelic,
  SchemaItemsCollectionReadOtlp,
  SchemaItemsCollectionReadS3DataWarehouse,
  SchemaItemsCollectionReadSplunk,
  SchemaItemsCollectionReadSumo,
  SchemaItemsCollectionTemplate,
  SchemaReadDatadog,
  SchemaReadDataWarehouse,
  SchemaReadJob,
  SchemaReadNewRelic,
  SchemaParseQueryResponse,
  SchemaReadOtlp,
  SchemaReadS3DataWarehouse,
  SchemaReadSplunk,
  SchemaReadSumo,
  SchemaTemplate,
  SchemaUpdateJob
} from '@/openapi/openApiTypes'
import { GreprAuth, ClientCredentialsAuth, NoAuth } from './auth.js'
import {
  ApiClientConfig, IntegrationReadType,
  IntegrationTypeAndList,
  JobExecution,
  JobProcessing,
  JobState
} from '../types.js'

/**
 * Returns a copy of headers safe to log: bearer tokens are truncated so debug
 * output pasted into tickets / chat doesn't leak a usable credential.
 */
function redactSensitiveHeaders(headers: Headers): Record<string, string> {
  const result = Object.fromEntries(headers.entries());
  const auth = result.authorization;
  if (auth) {
    result.authorization = auth.replace(/(Bearer\s+\S{8})\S+/, '$1...[REDACTED]');
  }
  return result;
}

/** API error with response status and Retry-After metadata for retry logic. */
export class ApiError extends Error {
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse a `Retry-After` header (delay-seconds or HTTP-date) into milliseconds. */
function retryAfterMsFromResponse(response: Response | undefined): number | undefined {
  const header = response?.headers?.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - Date.now());
}

/**
 * Main API client for the Grepr CLI using openapi-fetch.
 * This follows the same patterns as the frontend API client.
 */
export class GreprApiClient {
  private config: ApiClientConfig;
  private client: ReturnType<typeof createClient<paths>>;
  private auth: ClientCredentialsAuth | GreprAuth | NoAuth;

  constructor(config: ApiClientConfig) {
    this.config = config;

    // Create the fetch client with base configuration
    this.client = createClient<paths>({
      baseUrl: config.apiBaseUrl,
    });

    // Set up authentication
    if (config.authMethod === 'client-credentials') {
      this.auth = new ClientCredentialsAuth(config);
    } else if (config.authMethod === 'none') {
      this.auth = new NoAuth(config);
    } else {
      this.auth = new GreprAuth(config);
    }

    // Add auth middleware
    // noinspection JSUnusedGlobalSymbols
    this.client.use({
      onRequest: async ({ request }) => {
        const headers = await this.auth.getAuthHeaders();
        Object.entries(headers).forEach(([key, value]) => {
          request.headers.set(key, value);
        });
        if (config.debug) {
          console.log('Request:', request.method, request.url);
          console.log('Headers:', redactSensitiveHeaders(request.headers));
        }
      },

      onResponse: async ({ response }) => {
        if (config.debug) {
          console.log('Response:', response.status, response.url);
        }
      }
    });
  }

  /**
   * Get the underlying openapi-fetch client for direct access.
   * This allows for full flexibility while maintaining type safety.
   */
  getClient(): ReturnType<typeof createClient<paths>> {
    return this.client;
  }

  // Job Management Methods
  async listJobs(params?: {
    since?: string;
    execution?: JobExecution;
    processing?: JobProcessing;
    latest?: boolean;
    state?: JobState[];
    name?: string[];
    id?: string[];
  }): Promise<SchemaItemsCollectionReadJob | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/jobs', {
      ...(params && {
        params: {
          query: params,
        }
      })
    });

    if (error) {
      throw new Error(`Failed to list jobs: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getJob(id: string, version?: number, resolved?: boolean): Promise<SchemaReadJob | undefined> {
    const queryparams: { version?: number; resolved?: boolean } = {};
    if (version !== undefined) queryparams.version = version;
    if (resolved !== undefined) queryparams.resolved = resolved;

    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/jobs/{id}', {
      params: {
        path: { id },
        ...(Object.keys(queryparams).length > 0 && { query: queryparams })
      },
    });

    if (error) {
      throw new Error(`Failed to get job ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  /** Fetches the exact template version referenced by a template operation. */
  async getTemplate(id: string, version: number): Promise<SchemaTemplate> {
    const { data, error } = await this.client.GET('/v1/templates/{id}', {
      params: {
        path: { id },
        query: { version }
      }
    });

    if (error) {
      throw new Error(`Failed to get template ${id} version ${version}: ${JSON.stringify(error)}`);
    }

    // The API returns an ItemsCollection even though its generated response type is SchemaTemplate.
    const response: SchemaTemplate | SchemaItemsCollectionTemplate | undefined = data;
    if (response == null || !('items' in response) || !Array.isArray(response.items)) {
      throw new Error(`Template ${id} version ${version} returned an invalid response`);
    }

    const template = response.items[0];
    if (!template) {
      throw new Error(`Template ${id} version ${version} not found`);
    }
    return template;
  }

  async createAsyncJob(job: SchemaCreateJob): Promise<SchemaReadJob | undefined> {
    const { data, error } = await this.client.POST('/v1/jobs/async', {
      body: job,
    });

    if (error) {
      throw new Error(`Failed to create job: ${JSON.stringify(error)}`);
    }

    return data;
  }

  /**
   * Submits a logs backfill from its parameters. The server builds the backfill job graph from
   * its built-in template, so no graph is sent.
   */
  async createBackfillJob(request: SchemaCreateBackfillJob): Promise<SchemaReadJob | undefined> {
    const { data, error } = await this.client.POST('/v1/jobs/backfills', {
      body: request,
    });

    if (error) {
      throw new Error(`Failed to create backfill job: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async updateJob(id: string, job: SchemaUpdateJob, rollbackEnabled = true): Promise<SchemaReadJob | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error, response } = await this.client.PUT('/v1/jobs/{id}', {
      params: {
        path: { id },
        query: { rollbackEnabled },
      },
      body: job,
    });

    if (error) {
      throw new ApiError(
        `Failed to update job ${id}: ${JSON.stringify(error)}`,
        response?.status,
        retryAfterMsFromResponse(response),
      );
    }

    return data;
  }

  async deleteJob(id: string): Promise<void> {
    // noinspection TypeScriptValidateTypes
    const { error } = await this.client.DELETE('/v1/jobs/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to delete job ${id}: ${JSON.stringify(error)}`);
    }
  }

  // Dataset Management Methods
  async listDatasets(): Promise<SchemaDatasetRead[] | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/datasets');

    if (error) {
      throw new Error(`Failed to list datasets: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getDataset(id: string): Promise<SchemaDatasetRead | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/datasets/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get dataset ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async createDataset(dataset: SchemaDatasetCreate): Promise<SchemaDatasetRead | undefined> {
    const { data, error } = await this.client.POST('/v1/datasets', {
      body: dataset,
    });

    if (error) {
      throw new Error(`Failed to create dataset: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async updateDataset(id: string, dataset: SchemaDatasetUpdate): Promise<SchemaDatasetRead | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.PUT('/v1/datasets/{id}', {
      params: {
        path: { id },
      },
      body: dataset,
    });

    if (error) {
      throw new Error(`Failed to update dataset ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async deleteDataset(id: string): Promise<void> {
    const { error } = await this.client.DELETE('/v1/datasets/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to delete dataset ${id}: ${JSON.stringify(error)}`);
    }
  }

  // Integration Management Methods

  // Datadog Integration Methods
  async listDatadogIntegrations(): Promise<SchemaItemsCollectionReadDatadog | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/datadog');

    if (error) {
      throw new Error(`Failed to list Datadog integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getDatadogIntegration(id: string): Promise<SchemaReadDatadog | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/datadog/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get Datadog integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // Data Warehouse Integration Methods
  async listDataWarehouseIntegrations(): Promise<SchemaItemsCollectionReadDataWarehouse | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/data-warehouse');

    if (error) {
      throw new Error(`Failed to list Data Warehouse integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getDataWarehouseIntegration(id: string): Promise<SchemaReadDataWarehouse | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/data-warehouse/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get Data Warehouse integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // S3 Data Warehouse Integration Methods
  async listS3DataWarehouseIntegrations(): Promise<SchemaItemsCollectionReadS3DataWarehouse | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/s3-data-warehouse');

    if (error) {
      throw new Error(`Failed to list S3 Data Warehouse integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getS3DataWarehouseIntegration(id: string): Promise<SchemaReadS3DataWarehouse | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/s3-data-warehouse/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get S3 Data Warehouse integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // New Relic Integration Methods
  async listNewRelicIntegrations(): Promise<SchemaItemsCollectionReadNewRelic | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/newrelic');

    if (error) {
      throw new Error(`Failed to list New Relic integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getNewRelicIntegration(id: string): Promise<SchemaReadNewRelic | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/newrelic/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get New Relic integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // OTLP Integration Methods
  async listOtlpIntegrations(): Promise<SchemaItemsCollectionReadOtlp | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/otlp');

    if (error) {
      throw new Error(`Failed to list OTLP integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getOtlpIntegration(id: string): Promise<SchemaReadOtlp | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/otlp/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get OTLP integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // Splunk Integration Methods
  async listSplunkIntegrations(): Promise<SchemaItemsCollectionReadSplunk | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/splunk');

    if (error) {
      throw new Error(`Failed to list Splunk integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getSplunkIntegration(id: string): Promise<SchemaReadSplunk | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/splunk/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get Splunk integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // Sumo Logic Integration Methods
  async listSumoIntegrations(): Promise<SchemaItemsCollectionReadSumo | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/sumo');

    if (error) {
      throw new Error(`Failed to list Sumo Logic integrations: ${JSON.stringify(error)}`);
    }

    return data;
  }

  async getSumoIntegration(id: string): Promise<SchemaReadSumo | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/sumo/{id}', {
      params: {
        path: { id },
      },
    });

    if (error) {
      throw new Error(`Failed to get Sumo Logic integration ${id}: ${JSON.stringify(error)}`);
    }

    return data;
  }

  // Helper methods for generic integration operations
  async getAllIntegrations(): Promise<IntegrationTypeAndList<IntegrationReadType>[]> {
    return [
      { type: ReadDatadogType.datadog, items: (await this.listDatadogIntegrations())?.items || [] },
      {
        type: ReadDataWarehouseType.data_warehouse,
        items: (await this.listDataWarehouseIntegrations())?.items || []
      },
      {
        type: ReadS3DataWarehouseType.s3_data_warehouse,
        items: (await this.listS3DataWarehouseIntegrations())?.items || []
      },
      { type: ReadNewRelicType.newrelic, items: (await this.listNewRelicIntegrations())?.items || [] },
      { type: ReadOtlpType.otlp, items: (await this.listOtlpIntegrations())?.items || [] },
      { type: ReadSplunkType.splunk, items: (await this.listSplunkIntegrations())?.items || [] },
      { type: ReadSumoType.sumo, items: (await this.listSumoIntegrations())?.items || [] },
    ];
  }

  async getIntegrationById(id: string): Promise<IntegrationReadType | null> {
    const getMethods = [
      { type: ReadDatadogType.datadog, getMethod: this.getDatadogIntegration.bind(this) },
      { type: ReadDataWarehouseType.data_warehouse, getMethod: this.getDataWarehouseIntegration.bind(this) },
      { type: ReadS3DataWarehouseType.s3_data_warehouse, getMethod: this.getS3DataWarehouseIntegration.bind(this) },
      { type: ReadNewRelicType.newrelic, getMethod: this.getNewRelicIntegration.bind(this) },
      { type: ReadOtlpType.otlp, getMethod: this.getOtlpIntegration.bind(this) },
      { type: ReadSplunkType.splunk, getMethod: this.getSplunkIntegration.bind(this) },
      { type: ReadSumoType.sumo, getMethod: this.getSumoIntegration.bind(this) },
    ];

    for (const { type, getMethod } of getMethods) {
      try {
        const integration = await getMethod(id) as IntegrationReadType | undefined;
        if (integration !== undefined) {
          return integration;
        }
      } catch {
        // Continue trying other types
        if (this.config.debug) {
          console.log(`Info: Integration with ID "${id}" not found in type "${type}". Trying next type.`);
        }
      }
    }

    return null;
  }

  // Legacy methods for backward compatibility
  async sendHeartbeat(heartbeatToken: string): Promise<void> {
    const baseUrl = this.auth.config.apiBaseUrl;
    const urlOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await this.auth.getAuthHeaders()),
      },
      body: heartbeatToken,
    }
    const url = `${baseUrl}/v1/jobs/sync/heartbeat`;
    if (this.config.debug) {
      console.log(`Sending heartbeat to ${url} with options:`, urlOpts);
    }

    const response = await fetch(url, urlOpts);

    if (!response.ok) {
      let errorText = '';
      if (response.body) {
         errorText = await response.text();
      }
      throw new Error(`Failed to send heartbeat: HTTP ${response.status}: ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
    }
  }

  async lookupDataset(nameOrId: string): Promise<SchemaDatasetRead | undefined> {
    // If the input looks like a dataset ID, try direct lookup first
    if (/^[a-zA-Z0-9_-]+$/.test(nameOrId) && nameOrId.length > 5) {
      try {
        return await this.getDataset(nameOrId);
      } catch {
        // If direct lookup fails, fall through to name search
      }
    }

    // Search by name
    const datasets = await this.listDatasets();
    if (!datasets) {
      throw new Error('Failed to retrieve datasets list');
    }

    const matchingDataset = datasets.find((dataset) => dataset.name === nameOrId);

    if (!matchingDataset) {
      throw new Error(`Dataset not found: "${nameOrId}". Available datasets: ${datasets.map((d: SchemaDatasetRead) => d.name).join(', ')}`);
    }

    return matchingDataset;
  }

  async validateSql(sql: string): Promise<SchemaParseQueryResponse | undefined> {
    // The endpoint consumes the SQL as a plain-string body. openapi-fetch's
    // default JSON serializer would wrap it in quotes (`"SELECT ..."`), which the
    // Flink parser rejects with a leading-quote error — so send raw text/plain.
    const { data, error } = await this.client.POST('/v1/validation/sql/flink', {
      body: sql,
      bodySerializer: body => body,
      headers: { 'Content-Type': 'text/plain' },
    });
    if (error) throw new Error(`Failed to validate SQL: ${JSON.stringify(error)}`);
    return data;
  }

  // Sync job submission for the existing sync command - using fetch directly due to streaming
  /**
   * POST a job to `/v1/jobs/sync` and stream the NDJSON response.
   *
   * @param signal optional AbortSignal; aborting it (e.g. a draft's
   *   max-duration cap) ends the returned stream cleanly rather than erroring,
   *   so partial output already received is preserved.
   */
  async submitSyncJob(jobDefinition: SchemaCreateJob, signal?: AbortSignal): Promise<NodeJS.ReadableStream> {
    const baseUrl = this.auth.config.apiBaseUrl;
    const response = await fetch(`${baseUrl}/v1/jobs/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await this.auth.getAuthHeaders()),
      },
      body: JSON.stringify(jobDefinition),
      signal,
    });

    if (!response.ok) {
      let errorText = '';
      if (response.body) {
         errorText = await response.text();
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    // Convert Web ReadableStream to Node.js ReadableStream
    const webStream = response.body;
    const { Readable } = await import('stream');

    // Create a Node.js readable stream from the web stream
    const nodeStream = new Readable({
      read(): void {
        // This will be handled by the async conversion
      }
    });

    // Convert the web stream to node stream manually
    const reader = webStream.getReader();

    const pump = async (): Promise<void> => {
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            nodeStream.push(null); // End the stream
            break;
          }
          nodeStream.push(Buffer.from(value as ArrayLike<number>));
        }
      } catch (error) {
        // An intentional abort (the caller hit its max-duration cap) is a clean
        // stop, not a failure: end the stream so already-streamed records are
        // treated as a successful partial draft.
        if (signal?.aborted) {
          nodeStream.push(null);
        } else {
          nodeStream.destroy(error as Error);
        }
      }
    };

    pump();

    return nodeStream;
  }
}
