import { describe, expect, it } from 'bun:test';
import { buildBackfillRequest } from '../../../main/typescript/lib/backfill.js';
import { buildBackfillVendorLinks } from '../../../main/typescript/lib/backfill-vendor-links.js';
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogLogSinkType,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  ReadSumoType
} from '../../../main/typescript/openapi/openApiTypes.js';
import {
  createDatadogIntegration as datadog,
  createNewRelicIntegration as newRelic,
  createOtlpIntegration as otlp,
  createSplunkIntegration as splunk,
  createSumoIntegration as sumo
} from './test-fixtures.js';

const now = new Date('2026-07-07T12:00:00Z');
const baseOptions = {
  datasetId: 'ds_raw',
  dataType: CreateLogsBackfillJobDataType.logs,
  sinkIds: ['dd_1'],
  start: '2026-07-07T10:00:00Z',
  end: '2026-07-07T11:00:00Z',
  tags: ['incident:INC-123', 'env:prod']
};

describe('buildBackfillVendorLinks', () => {
  it('test_buildBackfillVendorLinks_buildsDatadogLogExplorerLink', () => {
    const sink = datadog('dd_1', {
      name: 'Datadog Prod',
      payload: { site: 'us3.datadoghq.com' }
    });
    const request = buildBackfillRequest(baseOptions, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const links = buildBackfillVendorLinks(request, [sink]);

    expect(links).toHaveLength(1);
    expect(links[0]?.label).toBe('View in Datadog');
    const url = new URL(links[0]?.url ?? '');
    expect(`${url.origin}${url.pathname}`).toBe('https://us3.datadoghq.com/logs');
    expect(url.searchParams.get('from_ts')).toBe(Date.parse(baseOptions.start).toString());
    expect(url.searchParams.get('to_ts')).toBe(Date.parse(baseOptions.end).toString());
    expect(url.searchParams.get('live')).toBe('false');
    expect(url.searchParams.get('query')).toContain('grepr.backfilled:("true")');
    expect(url.searchParams.get('query')).toContain('incident:("inc-123")');
  });

  it('test_buildBackfillVendorLinks_buildsLinksForAllSupportedLogSinks', () => {
    const sinks = [
      datadog('dd_1'),
      splunk('splunk_1'),
      newRelic('nr_1'),
      sumo('sumo_1'),
      otlp('otlp_1')
    ];
    const request = buildBackfillRequest({
      ...baseOptions,
      sinkIds: sinks.map(sink => sink.id)
    }, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks
    }, now);

    const links = buildBackfillVendorLinks(request, sinks);

    expect(links.map(link => link.label)).toEqual([
      'View in Datadog',
      'View in Splunk',
      'View in New Relic',
      'View in Sumo Logic',
      'View in Open Telemetry'
    ]);
    expect(links.find(link => link.vendorType === ReadSplunkType.splunk)?.url)
      .toStartWith('https://splunk.example.com:443/app/search/search?');
    const newRelicUrl = new URL(links.find(link => link.vendorType === ReadNewRelicType.newrelic)?.url ?? '');
    expect(`${newRelicUrl.origin}${newRelicUrl.pathname}`).toBe('https://one.newrelic.com/launcher/logger.log-launcher');
    expect(newRelicUrl.searchParams.get('platform[accountId]')).toBe('1234567');
    const newRelicLauncher = JSON.parse(
      Buffer.from(newRelicUrl.searchParams.get('launcher') ?? '', 'base64').toString('utf8')
    ) as { query: string; timeRange: { begin_time: number; end_time: number } };
    expect(newRelicLauncher.query).toContain('incident:"INC-123"');
    expect(newRelicLauncher.timeRange).toEqual({
      begin_time: Date.parse(baseOptions.start),
      end_time: Date.parse(baseOptions.end)
    });
    expect(links.find(link => link.vendorType === ReadSumoType.sumo)?.url)
      .toStartWith('https://service.sumologic.com/ui/index.html#section/search/@');
    expect(links.find(link => link.vendorType === ReadOtlpType.otlp)?.url)
      .toStartWith('https://logs.example.com:4318/v1/logs/@');
  });

  it('test_buildBackfillVendorLinks_matchesFrontendTagSerialization', () => {
    const sinks = [datadog('dd_1'), splunk('splunk_1')];
    const request = buildBackfillRequest({
      ...baseOptions,
      sinkIds: sinks.map(sink => sink.id),
      tags: [
        'processor:custom',
        'team:first',
        'team:second',
        'expr:a=b',
        'empty:'
      ]
    }, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks
    }, now);

    const links = buildBackfillVendorLinks(request, sinks);
    const datadogUrl = new URL(links.find(link => link.vendorType === ReadDatadogType.datadog)?.url ?? '');
    expect(datadogUrl.searchParams.get('query')).toBe(
      'grepr.backfilled:("true") ' +
      'processor:("grepr" OR "custom") ' +
      'team:("first" OR "second") ' +
      'expr:("a=b") ' +
      'empty:("")'
    );

    const splunkUrl = new URL(links.find(link => link.vendorType === ReadSplunkType.splunk)?.url ?? '');
    expect(splunkUrl.searchParams.get('q')).toBe(
      'search grepr.backfilled=true ' +
      'processor=custom ' +
      'team=second ' +
      'expr=a=b ' +
      'empty='
    );
  });

  it('test_buildBackfillVendorLinks_filtersOnTheTagTheTemplateStamps', () => {
    const sink = datadog('dd_1', { payload: { site: 'datadoghq.com' } });
    const request = buildBackfillRequest({
      ...baseOptions,
      tags: []
    }, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    expect(request.sinks).toEqual([{
      type: DatadogLogSinkType.datadog_log_sink,
      name: 'sink_dd_1',
      integrationId: 'dd_1',
      additionalTags: ['processor:grepr']
    }]);

    const url = new URL(buildBackfillVendorLinks(request, [sink])[0]?.url ?? '');
    expect(url.searchParams.get('query')).toBe(
      'grepr.backfilled:("true") processor:("grepr")'
    );
  });

  it('test_buildBackfillVendorLinks_omitsLinksMissingVendorDestination', () => {
    const sink = splunk('splunk_1', {
      payload: { splunkHost: undefined, webHost: undefined }
    });
    const request = buildBackfillRequest({
      ...baseOptions,
      sinkIds: ['splunk_1']
    }, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    expect(buildBackfillVendorLinks(request, [sink])).toEqual([]);
  });

  it('test_buildBackfillVendorLinks_splunkTimesShouldCoverWholeWindowInEpochSeconds', () => {
    const sink = splunk('splunk_1');
    const request = buildBackfillRequest({
      ...baseOptions,
      sinkIds: ['splunk_1'],
      start: '2026-07-07T10:00:00.999Z',
      end: '2026-07-07T11:00:00.999Z'
    }, {
      dataType: CreateLogsBackfillJobDataType.logs,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const [link] = buildBackfillVendorLinks(request, [sink]);
    const url = new URL(link?.url ?? '');

    // Splunk's latest bound is exclusive, so it rounds up past the fractional
    // tail of the window while earliest rounds down to include the first event.
    expect(url.searchParams.get('earliest')).toBe('1783418400');
    expect(url.searchParams.get('latest')).toBe('1783422001');
  });

  it('test_buildBackfillVendorLinks_buildsDatadogTraceExplorerLink', () => {
    const sink = datadog('dd_1', {
      payload: { site: 'eu1.datadoghq.com' }
    });
    const request = buildBackfillRequest({
      ...baseOptions,
      dataType: CreateSpansBackfillJobDataType.spans,
      tags: ['team:platform']
    }, {
      dataType: CreateSpansBackfillJobDataType.spans,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const links = buildBackfillVendorLinks(request, [sink]);

    expect(links).toHaveLength(1);
    const url = new URL(links[0]?.url ?? '');
    const query = url.searchParams.get('query') ?? '';
    expect(`${url.origin}${url.pathname}`).toBe('https://eu1.datadoghq.com/apm/traces');
    expect(query).toContain('@grepr.backfilled:"true"');
    expect(query).toContain('@team:"platform"');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query,
      sort: 'desc',
      spanType: 'all',
      traceQuery: '',
      view: 'spans',
      live: 'false',
      from_ts: Date.parse(baseOptions.start).toString(),
      to_ts: Date.parse(baseOptions.end).toString(),
      historicalData: 'true',
      paused: 'false'
    });
  });

  it('test_buildBackfillVendorLinks_omitsTheServerGeneratedTimestampFromTheTraceQuery', () => {
    const sink = datadog('dd_1');
    const request = buildBackfillRequest({
      ...baseOptions,
      dataType: CreateSpansBackfillJobDataType.spans
    }, {
      dataType: CreateSpansBackfillJobDataType.spans,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const requestAttributes = (request.sinks[0] as { additionalAttributes: Record<string, string> })
      .additionalAttributes;
    expect(requestAttributes['grepr.backfilled.timestamp']).toBeUndefined();

    const query = new URL(buildBackfillVendorLinks(request, [sink])[0]?.url ?? '')
      .searchParams.get('query') ?? '';
    expect(query).not.toContain('@grepr.backfilled.timestamp:');
    expect(query).toContain('@grepr.backfilled:"true"');
    expect(query).toContain('@processor:"grepr"');
  });

  it('test_buildBackfillVendorLinks_quotesTagValuesContainingSpaces', () => {
    const sink = datadog('dd_1');
    const request = buildBackfillRequest({
      ...baseOptions,
      dataType: CreateSpansBackfillJobDataType.spans,
      tags: ['owner:team "a"\\ops']
    }, {
      dataType: CreateSpansBackfillJobDataType.spans,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const query = new URL(buildBackfillVendorLinks(request, [sink])[0]?.url ?? '')
      .searchParams.get('query') ?? '';
    expect(query).toContain('@owner:"team \\"a\\"\\\\ops"');
  });

  it('test_buildBackfillVendorLinks_returnsNoLinkForOtlpTraceSinks', () => {
    const sink = otlp('otlp_1');
    const request = buildBackfillRequest({
      ...baseOptions,
      dataType: CreateSpansBackfillJobDataType.spans
    }, {
      dataType: CreateSpansBackfillJobDataType.spans,
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    expect(buildBackfillVendorLinks(request, [sink])).toEqual([]);
  });
});
