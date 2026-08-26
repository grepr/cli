// CLI API client using openapi-fetch with the same patterns as the frontend
import createClient from 'openapi-fetch'
import {
  paths,
  ReadDatadogType,
  ReadDataWarehouseType,
  ReadFeatureFlags,
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
  SchemaItemsCollectionReadTrinoQueryEngine,
  SchemaItemsCollectionTemplate,
  SchemaReadDatadog,
  SchemaReadDataWarehouse,
  SchemaReadJob,
  SchemaReadNewRelic,
  SchemaParseQueryResponse,
  SchemaReadOtlp,
  SchemaRead,
  SchemaReadS3DataWarehouse,
  SchemaReadSplunk,
  SchemaReadSumo,
  SchemaReadTrinoQueryEngine,
  SchemaTemplate,
  SchemaUpdateJob
} from '@/openapi/openApiTypes'
import { GreprAuth, ClientCredentialsAuth, NoAuth } from './auth.js'
import {
  ApiClientConfig, IntegrationReadType,
  IntegrationTypeAndList,
  JobExecution,
  JobProcessing,
  JobState,
  type QueryEngine,
  type ResolvedQueryEngine
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

  // Organization Methods
  /** Fetches the organization for the authenticated user, including its feature flags. */
  async getOrganization(): Promise<SchemaRead | undefined> {
    const { data, error } = await this.client.GET('/v1/organization');

    if (error) {
      throw new Error(`Failed to get organization: ${JSON.stringify(error)}`);
    }

    return data;
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

  async createBackfillJob(
    request: SchemaCreateBackfillJob
  ): Promise<SchemaReadJob | undefined> {
    const { data, error, response } = await this.client.POST('/v1/jobs/backfills', {
      body: request,
    });

    if (!response?.ok) {
      const detail = error === undefined || error === null || error === ''
        ? ''
        : `: ${JSON.stringify(error)}`;
      throw new ApiError(
        `Failed to create backfill job (HTTP ${response?.status ?? 'no response'})${detail}`,
        response?.status,
        retryAfterMsFromResponse(response)
      );
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

  // Trino Query Engine Integration Methods
  async listTrinoQueryEngineIntegrations(): Promise<SchemaItemsCollectionReadTrinoQueryEngine | undefined> {
    // noinspection TypeScriptValidateTypes
    const { data, error } = await this.client.GET('/v1/integrations/trino-query-engine');

    if (error) {
      throw new Error(`Failed to list Trino query engine integrations: ${JSON.stringify(error)}`);
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

/**
 * Minimal client surface {@link resolveQueryEngine} needs, narrowed from
 * {@link GreprApiClient} so tests can stub it directly instead of standing up
 * a full client.
 */
export interface QueryEngineResolutionApiClient {
  getOrganization(): Promise<SchemaRead | undefined>;
  listTrinoQueryEngineIntegrations(): Promise<SchemaItemsCollectionReadTrinoQueryEngine | undefined>;
}

/**
 * Resolves the query engine to run a query against, before any job graph is
 * built. `buildQueryJobDefinition` stays pure over the result — it does no
 * discovery itself.
 *
 * An explicit `queryEngine` always wins, bypassing both the feature flag and
 * integration discovery: `athena`/`flink` resolve with no network call,
 * `trino` requires exactly one `TrinoQueryEngine` integration to exist.
 *
 * When unset, the engine is discovered: the `TRINO_QUERY_ENGINE` feature flag
 * must be on and the org must have exactly one Trino integration, otherwise
 * today's default (Athena) is kept unchanged. A failed lookup or more than
 * one Trino integration is always an error, never a silent fall-through to
 * Athena — a customer's query must not silently run against an engine they
 * did not choose.
 */
export async function resolveQueryEngine(
  explicit: QueryEngine | undefined,
  apiClient: QueryEngineResolutionApiClient
): Promise<ResolvedQueryEngine> {
  if (explicit === 'athena' || explicit === 'flink') {
    return { kind: explicit };
  }
  if (explicit === 'trino') {
    return { kind: 'trino', queryEngineIntegrationId: await resolveExplicitTrinoIntegrationId(apiClient) };
  }

  const organization = await apiClient.getOrganization();
  if (organization === undefined) {
    throw new Error(
      'Failed to resolve query engine: GET /v1/organization returned no data, so the '
      + 'TRINO_QUERY_ENGINE feature flag could not be checked.'
    );
  }
  const trinoFlagOn = organization.featureFlags?.includes(ReadFeatureFlags.TRINO_QUERY_ENGINE) ?? false;
  if (!trinoFlagOn) {
    return { kind: 'athena' };
  }

  const integrations = await listTrinoIntegrationsOrThrow(apiClient);
  if (integrations.length === 0) {
    return { kind: 'athena' };
  }
  return { kind: 'trino', queryEngineIntegrationId: requireSingleTrinoIntegration(integrations).id };
}

/**
 * Lists Trino integrations, failing closed when the response itself is
 * absent (a 2xx with no body) rather than treating that as an empty list —
 * an empty `items` array is a genuine "no integrations" answer, but a
 * missing response body means the answer is unknown.
 */
async function listTrinoIntegrationsOrThrow(
  apiClient: QueryEngineResolutionApiClient
): Promise<SchemaReadTrinoQueryEngine[]> {
  const collection = await apiClient.listTrinoQueryEngineIntegrations();
  if (collection === undefined) {
    throw new Error(
      'Failed to resolve query engine: GET /v1/integrations/trino-query-engine returned no data.'
    );
  }
  return collection.items ?? [];
}

async function resolveExplicitTrinoIntegrationId(apiClient: QueryEngineResolutionApiClient): Promise<string> {
  const integrations = await listTrinoIntegrationsOrThrow(apiClient);
  if (integrations.length === 0) {
    throw new Error(
      'No Trino query engine integration is configured for this organization. Create one, or set '
      + 'GREPR_QUERY_ENGINE=athena (or unset it) to use the default engine.'
    );
  }
  return requireSingleTrinoIntegration(integrations).id;
}

/**
 * Fails closed on ambiguity: more than one Trino integration is an error, never
 * an arbitrary pick — selecting `trino` cannot disambiguate which integration
 * to use, so the only real remedies are fixing the data or picking a
 * different engine. Callers only reach here after establishing `integrations`
 * is non-empty; the `!integration` branch is an extra safety net, not a case
 * expected to occur.
 */
function requireSingleTrinoIntegration(integrations: SchemaReadTrinoQueryEngine[]): SchemaReadTrinoQueryEngine {
  const [integration, ...rest] = integrations;
  if (!integration || rest.length > 0) {
    throw new Error(
      `This organization has ${integrations.length} Trino query engine integrations; the CLI will `
      + 'not guess which one to use. Remove the extra integrations, or set GREPR_QUERY_ENGINE=athena '
      + 'to select Athena explicitly.'
    );
  }
  return integration;
}
