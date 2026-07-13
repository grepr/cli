import { describe, expect, it } from 'bun:test';
import { buildBackfillJob } from '../../../main/typescript/lib/backfill.js';
import { buildBackfillVendorLinks } from '../../../main/typescript/lib/backfill-vendor-links.js';
import {
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
    const job = buildBackfillJob(baseOptions, {
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    const links = buildBackfillVendorLinks(job, [sink]);

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
    const job = buildBackfillJob({
      ...baseOptions,
      sinkIds: sinks.map(sink => sink.id)
    }, {
      datasetId: 'ds_raw',
      teamIds: [],
      sinks
    }, now);

    const links = buildBackfillVendorLinks(job, sinks);

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
    const job = buildBackfillJob({
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
      datasetId: 'ds_raw',
      teamIds: [],
      sinks
    }, now);

    const links = buildBackfillVendorLinks(job, sinks);
    const datadogUrl = new URL(links.find(link => link.vendorType === ReadDatadogType.datadog)?.url ?? '');
    expect(datadogUrl.searchParams.get('query')).toBe(
      'grepr.backfilled.timestamp:("2026-07-07t12:00:00.000z") ' +
      'grepr.backfilled:("true") ' +
      'processor:("grepr" OR "custom") ' +
      'team:("first" OR "second") ' +
      'expr:("a=b") ' +
      'empty:("")'
    );

    const splunkUrl = new URL(links.find(link => link.vendorType === ReadSplunkType.splunk)?.url ?? '');
    expect(splunkUrl.searchParams.get('q')).toBe(
      'search grepr.backfilled.timestamp=2026-07-07T12:00:00.000Z ' +
      'grepr.backfilled=true ' +
      'processor=custom ' +
      'team=second ' +
      'expr=a=b ' +
      'empty='
    );
  });

  it('test_buildBackfillVendorLinks_omitsLinksMissingVendorDestination', () => {
    const sink = splunk('splunk_1', {
      payload: { splunkHost: undefined, webHost: undefined }
    });
    const job = buildBackfillJob({
      ...baseOptions,
      sinkIds: ['splunk_1']
    }, {
      datasetId: 'ds_raw',
      teamIds: [],
      sinks: [sink]
    }, now);

    expect(buildBackfillVendorLinks(job, [sink])).toEqual([]);
  });
});
