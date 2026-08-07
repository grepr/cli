import { describe, expect, it } from 'bun:test';
import {
  findBackfillVendor,
  findBackfillVendorByIntegrationType,
  isBackfillLogSink,
  isBackfillTraceSink,
  isSupportedBackfillIntegrationType
} from '../../../main/typescript/lib/backfill-vendors.js';
import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogLogSinkType,
  DatadogTraceSinkType,
  OtlpLogSinkType,
  OtlpTraceSinkType,
  ReadDatadogType,
  ReadNewRelicType,
  ReadOtlpType,
  ReadSplunkType,
  type SchemaOperation
} from '../../../main/typescript/openapi/openApiTypes.js';

const logs = CreateLogsBackfillJobDataType.logs;
const spans = CreateSpansBackfillJobDataType.spans;

function sink(type: SchemaOperation['type']): SchemaOperation {
  return { type, name: 'sink' } as SchemaOperation;
}

describe('findBackfillVendorByIntegrationType', () => {
  it('test_findBackfillVendorByIntegrationType_selectsTheRowForTheRequestedSignal', () => {
    expect(findBackfillVendorByIntegrationType(ReadDatadogType.datadog, logs))
      .toMatchObject({ dataType: logs, sinkType: DatadogLogSinkType.datadog_log_sink });
    expect(findBackfillVendorByIntegrationType(ReadDatadogType.datadog, spans))
      .toMatchObject({ dataType: spans, sinkType: DatadogTraceSinkType.datadog_trace_sink });
    expect(findBackfillVendorByIntegrationType(ReadOtlpType.otlp, logs))
      .toMatchObject({ dataType: logs, sinkType: OtlpLogSinkType.otlp_log_sink });
    expect(findBackfillVendorByIntegrationType(ReadOtlpType.otlp, spans))
      .toMatchObject({ dataType: spans, sinkType: OtlpTraceSinkType.otlp_trace_sink });
  });

  it('test_findBackfillVendorByIntegrationType_returnsUndefinedForSignalsAVendorLacks', () => {
    expect(findBackfillVendorByIntegrationType(ReadNewRelicType.newrelic, spans)).toBeUndefined();
    expect(findBackfillVendorByIntegrationType(ReadSplunkType.splunk, spans)).toBeUndefined();
    expect(findBackfillVendorByIntegrationType(ReadNewRelicType.newrelic, logs))
      .toMatchObject({ maxBackfillAgeHours: 48 });
  });

  it('test_findBackfillVendorByIntegrationType_capsDatadogForBothSignals', () => {
    expect(findBackfillVendorByIntegrationType(ReadDatadogType.datadog, logs))
      .toMatchObject({ maxBackfillAgeHours: 18 });
    expect(findBackfillVendorByIntegrationType(ReadDatadogType.datadog, spans))
      .toMatchObject({ maxBackfillAgeHours: 18 });
  });

  it('test_findBackfillVendorByIntegrationType_leavesOtlpUncapped', () => {
    expect(findBackfillVendorByIntegrationType(ReadOtlpType.otlp, spans)?.maxBackfillAgeHours)
      .toBeUndefined();
  });
});

describe('findBackfillVendor', () => {
  it('test_findBackfillVendor_matchesOnIntegrationAndSinkTypeTogether', () => {
    expect(findBackfillVendor(ReadDatadogType.datadog, DatadogTraceSinkType.datadog_trace_sink))
      .toMatchObject({ dataType: spans, vendorName: 'Datadog' });
    expect(findBackfillVendor(ReadDatadogType.datadog, OtlpTraceSinkType.otlp_trace_sink))
      .toBeUndefined();
  });
});

describe('isSupportedBackfillIntegrationType', () => {
  it('test_isSupportedBackfillIntegrationType_isSignalSpecific', () => {
    expect(isSupportedBackfillIntegrationType(ReadNewRelicType.newrelic, logs)).toBe(true);
    expect(isSupportedBackfillIntegrationType(ReadNewRelicType.newrelic, spans)).toBe(false);
    expect(isSupportedBackfillIntegrationType(ReadDatadogType.datadog, spans)).toBe(true);
  });
});

describe('sink type guards', () => {
  it('test_isBackfillLogSink_acceptsOnlyLogSinkTypes', () => {
    expect(isBackfillLogSink(sink(DatadogLogSinkType.datadog_log_sink))).toBe(true);
    expect(isBackfillLogSink(sink(DatadogTraceSinkType.datadog_trace_sink))).toBe(false);
  });

  it('test_isBackfillTraceSink_acceptsOnlyTraceSinkTypes', () => {
    expect(isBackfillTraceSink(sink(DatadogTraceSinkType.datadog_trace_sink))).toBe(true);
    expect(isBackfillTraceSink(sink(OtlpTraceSinkType.otlp_trace_sink))).toBe(true);
    expect(isBackfillTraceSink(sink(OtlpLogSinkType.otlp_log_sink))).toBe(false);
  });
});
