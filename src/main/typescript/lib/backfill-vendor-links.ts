import {
  DatadogLogSinkType,
  NewRelicLogSinkType,
  OtlpLogSinkType,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType,
  SplunkLogSinkType,
  SumoLogSinkType,
  type SchemaOperation
} from '../openapi/openApiTypes.js';
import type { IntegrationReadType } from '../types.js';
import {
  findBackfillVendor,
  isBackfillLogSink,
  isSupportedBackfillIntegrationType,
  type BackfillIntegrationType,
  type BackfillLogSink
} from './backfill-vendors.js';

export interface BackfillVendorLink {
  integrationId: string;
  integrationName: string;
  vendorType: BackfillIntegrationType;
  label: string;
  url: string;
}

/**
 * The parts of a backfill the vendor links are derived from. Taken directly rather than read out
 * of a job graph, because the server now builds the graph from these parameters.
 */
export interface BackfillVendorLinkInputs {
  start: string;
  end: string;
  sinks: SchemaOperation[];
}

const DATADOG_REGIONAL_SITE_PREFIX_RE = /^(us|eu|ap)\d+\./;

const BACKFILLED_TAG_KEY = 'grepr.backfilled';

/**
 * The logs backfill template stamps grepr.backfilled on every event it replays, upstream of the
 * sink, so the tag is not part of the sink operation sent to the server. Links still need to filter
 * on it, and combined with the time range each URL already carries it identifies the replayed data.
 *
 * The template also stamps grepr.backfilled.timestamp, which is deliberately not used here: its
 * value is the server's normalized rendering of the window end, and reproducing that formatting
 * client-side would silently break the link whenever the two renderings disagree.
 */
function tagsWithBackfilled(tags?: string[]): string[] {
  return [`${BACKFILLED_TAG_KEY}:true`, ...(tags ?? [])];
}

/** The attribute-map equivalent of {@link tagsWithBackfilled}. */
function attributesWithBackfilled(attributes?: Record<string, string>): Record<string, string> {
  return { [BACKFILLED_TAG_KEY]: 'true', ...(attributes ?? {}) };
}

/** CLI-local because the frontend link builders depend on browser-only sink classes. */
export function buildBackfillVendorLinks(
  backfill: BackfillVendorLinkInputs,
  integrations: IntegrationReadType[]
): BackfillVendorLink[] {
  if (!backfill.start || !backfill.end) {
    return [];
  }

  const integrationsById = new Map(integrations.map(integration => [integration.id, integration]));
  return backfill.sinks
    .filter(isBackfillLogSink)
    .map((sink): BackfillVendorLink | null => {
      const integration = integrationsById.get(sink.integrationId);
      if (!integration || !isSupportedBackfillIntegrationType(integration.type)) {
        return null;
      }
      const vendor = findBackfillVendor(integration.type, sink.type);
      if (!vendor) {
        return null;
      }
      const url = buildVendorUrl(integration, sink, backfill.start, backfill.end);
      if (!url) {
        return null;
      }
      return {
        integrationId: integration.id,
        integrationName: integration.name,
        vendorType: integration.type,
        label: `View in ${vendor.vendorName}`,
        url
      };
    })
    .filter((link): link is BackfillVendorLink => link !== null);
}

function buildVendorUrl(
  integration: IntegrationReadType,
  sink: BackfillLogSink,
  start: string,
  end: string
): string | null {
  switch (sink.type) {
    case DatadogLogSinkType.datadog_log_sink:
      return integration.type === ReadDatadogType.datadog
        ? buildDatadogUrl(integration, tagsWithBackfilled(sink.additionalTags), start, end)
        : null;
    case SplunkLogSinkType.splunk_log_sink:
      return integration.type === ReadSplunkType.splunk
        ? buildSplunkUrl(integration, tagsWithBackfilled(sink.additionalTags), start, end)
        : null;
    case NewRelicLogSinkType.newrelic_log_sink:
      return integration.type === ReadNewRelicType.newrelic
        ? buildNewRelicUrl(integration, attributesWithBackfilled(sink.additionalAttributes), start, end)
        : null;
    case SumoLogSinkType.sumologic_log_sink:
      return integration.type === ReadSumoType.sumo
        ? buildSumoUrl(attributesWithBackfilled(sink.additionalAttributes), start, end)
        : null;
    case OtlpLogSinkType.otlp_log_sink:
      return integration.type === ReadOtlpType.otlp
        ? buildOtlpUrl(integration, attributesWithBackfilled(sink.additionalAttributes), start, end)
        : null;
  }
}

function buildDatadogUrl(
  integration: Extract<IntegrationReadType, { type: ReadDatadogType }>,
  tags: string[],
  start: string,
  end: string
): string {
  const params = new URLSearchParams();
  params.set('from_ts', Date.parse(start).toString());
  params.set('to_ts', Date.parse(end).toString());
  params.set('live', 'false');
  params.append('query', tagsToDatadogQuery(tags));
  return `${getDatadogLogsUrl(integration.payload?.site)}?${params.toString()}`;
}

function getDatadogLogsUrl(site?: string): string {
  if (!site) {
    return 'https://app.datadoghq.com/logs';
  }
  if (site.includes('localhost') || site.includes('svc.cluster.local')) {
    return `http://${site}/logs`;
  }
  const baseUrl = DATADOG_REGIONAL_SITE_PREFIX_RE.test(site)
    ? `https://${site}`
    : `https://app.${site}`;
  return `${baseUrl}/logs`;
}

function tagsToDatadogQuery(tags: string[]): string {
  const queryTags: Record<string, string[]> = {};
  tags.forEach(tag => {
    const separatorIndex = tag.indexOf(':');
    const key = tag.slice(0, separatorIndex);
    const values = tag.slice(separatorIndex + 1).split(',');
    values.forEach(value => {
      if (queryTags[key]) {
        queryTags[key].push(value);
      } else {
        queryTags[key] = [value];
      }
    });
  });

  return Object.entries(queryTags)
    .map(([key, values]) => `${key}:(${values.map(value => `"${value.toLowerCase()}"`).join(' OR ')})`)
    .join(' ');
}

function buildSplunkUrl(
  integration: Extract<IntegrationReadType, { type: ReadSplunkType }>,
  tags: string[],
  start: string,
  end: string
): string | null {
  const host = integration.payload?.splunkHost || integration.payload?.webHost;
  if (!host) {
    return null;
  }

  let port = integration.payload?.webPort;
  if (!port) {
    port = integration.payload?.secure ? '443' : '8000';
  }
  const protocol = port === '443' ? 'https' : 'http';
  const params = new URLSearchParams();
  // Splunk time modifiers select earliest <= _time < latest, so the exclusive
  // upper bound rounds up to keep the final fractional second in range.
  params.set('earliest', Math.floor(Date.parse(start) / 1000).toString());
  params.set('latest', Math.ceil(Date.parse(end) / 1000).toString());
  params.set('q', tagsToSplunkQuery(tags));
  return `${protocol}://${host}:${port}/app/search/search?${params.toString()}`;
}

function tagsToSplunkQuery(tags: string[]): string {
  const queryTags: Record<string, string[]> = {};
  tags.forEach(tag => {
    const normalizedTag = tag.replace(':', '=');
    const separatorIndex = normalizedTag.indexOf('=');
    const key = normalizedTag.slice(0, separatorIndex);
    queryTags[key] = normalizedTag.slice(separatorIndex + 1)
      .split(',')
      .map(value => value.trim());
  });

  const splunkQueryTags = Object.entries(queryTags)
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .join(' ');
  return `search ${splunkQueryTags}`;
}

function buildNewRelicUrl(
  integration: Extract<IntegrationReadType, { type: ReadNewRelicType }>,
  attributes: Record<string, string>,
  start: string,
  end: string
): string {
  const params = new URLSearchParams();
  if (integration.payload?.accountId) {
    params.set('platform[accountId]', integration.payload.accountId);
  }
  params.set('launcher', attributesToNewRelicLauncher(attributes, start, end));
  return `https://one.newrelic.com/launcher/logger.log-launcher?${params.toString()}`;
}

function attributesToNewRelicLauncher(
  attributes: Record<string, string>,
  start: string,
  end: string
): string {
  const query = Object.entries(attributes)
    .map(([key, value]) => `${key}:"${value}"`)
    .join(' ');
  const launcherConfig = {
    isEntitled: true,
    query,
    eventTypes: ['Log_Logging'],
    timeRange: {
      begin_time: new Date(start).getTime(),
      end_time: new Date(end).getTime()
    }
  };
  return Buffer.from(JSON.stringify(launcherConfig), 'utf8').toString('base64');
}

function buildSumoUrl(
  attributes: Record<string, string>,
  start: string,
  end: string
): string {
  const startTimestamp = new Date(start).getTime();
  const endTimestamp = new Date(end).getTime();
  return `https://service.sumologic.com/ui/index.html#section/search/@${startTimestamp},${endTimestamp}@${attributesToSumoQuery(attributes)}`;
}

function buildOtlpUrl(
  integration: Extract<IntegrationReadType, { type: ReadOtlpType }>,
  attributes: Record<string, string>,
  start: string,
  end: string
): string | null {
  const baseUrl = integration.payload?.logsEndpoint || integration.payload?.endpoint;
  if (!baseUrl) {
    return null;
  }
  const startTimestamp = new Date(start).getTime();
  const endTimestamp = new Date(end).getTime();
  return `${baseUrl}/@${startTimestamp},${endTimestamp}@${attributesToOtlpQuery(attributes)}`;
}

function attributesToSumoQuery(attributes: Record<string, string>): string {
  const whereClause = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' and ');
  return encodeURIComponent(`_source=?? | where ${whereClause}`);
}

function attributesToOtlpQuery(attributes: Record<string, string>): string {
  return encodeURIComponent(
    Object.entries(attributes)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')
  );
}
