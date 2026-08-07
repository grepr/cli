import {
  CreateLogsBackfillJobDataType,
  CreateSpansBackfillJobDataType,
  DatadogLogSinkType,
  DatadogTraceSinkType,
  NewRelicLogSinkType,
  OtlpLogSinkType,
  OtlpTraceSinkType,
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
import type { SignalDataType } from './signal-source.js';

interface BackfillVendorDescriptor {
  dataType: SignalDataType;
  integrationType: IntegrationReadType['type'];
  sinkType: SchemaOperation['type'];
  vendorName: string;
  maxBackfillAgeHours?: number;
}

const BACKFILL_VENDORS = [
  {
    dataType: CreateLogsBackfillJobDataType.logs,
    integrationType: ReadDatadogType.datadog,
    sinkType: DatadogLogSinkType.datadog_log_sink,
    vendorName: 'Datadog',
    maxBackfillAgeHours: 18
  },
  {
    dataType: CreateLogsBackfillJobDataType.logs,
    integrationType: ReadSplunkType.splunk,
    sinkType: SplunkLogSinkType.splunk_log_sink,
    vendorName: 'Splunk'
  },
  {
    dataType: CreateLogsBackfillJobDataType.logs,
    integrationType: ReadNewRelicType.newrelic,
    sinkType: NewRelicLogSinkType.newrelic_log_sink,
    vendorName: 'New Relic',
    maxBackfillAgeHours: 48
  },
  {
    dataType: CreateLogsBackfillJobDataType.logs,
    integrationType: ReadSumoType.sumo,
    sinkType: SumoLogSinkType.sumologic_log_sink,
    vendorName: 'Sumo Logic'
  },
  {
    dataType: CreateLogsBackfillJobDataType.logs,
    integrationType: ReadOtlpType.otlp,
    sinkType: OtlpLogSinkType.otlp_log_sink,
    vendorName: 'Open Telemetry'
  },
  {
    dataType: CreateSpansBackfillJobDataType.spans,
    integrationType: ReadDatadogType.datadog,
    sinkType: DatadogTraceSinkType.datadog_trace_sink,
    vendorName: 'Datadog',
    // Match the frontend's 18-hour Datadog spans limit.
    maxBackfillAgeHours: 18
  },
  {
    dataType: CreateSpansBackfillJobDataType.spans,
    integrationType: ReadOtlpType.otlp,
    sinkType: OtlpTraceSinkType.otlp_trace_sink,
    vendorName: 'Open Telemetry'
  }
] satisfies readonly BackfillVendorDescriptor[];

export type BackfillVendor = typeof BACKFILL_VENDORS[number];
type VendorFor<D extends SignalDataType> = Extract<BackfillVendor, { dataType: D }>;

export type BackfillIntegrationType = BackfillVendor['integrationType'];
export type BackfillLogSinkType = VendorFor<CreateLogsBackfillJobDataType.logs>['sinkType'];
export type BackfillTraceSinkType = VendorFor<CreateSpansBackfillJobDataType.spans>['sinkType'];
export type BackfillLogSink = Extract<SchemaOperation, { type: BackfillLogSinkType }>;
export type BackfillTraceSink = Extract<SchemaOperation, { type: BackfillTraceSinkType }>;

export function findBackfillVendor(
  integrationType: IntegrationReadType['type'],
  sinkType: SchemaOperation['type']
): BackfillVendor | undefined {
  return BACKFILL_VENDORS.find(vendor =>
    vendor.integrationType === integrationType && vendor.sinkType === sinkType
  );
}

export function findBackfillVendorByIntegrationType(
  integrationType: IntegrationReadType['type'],
  dataType: SignalDataType
): BackfillVendor | undefined {
  return BACKFILL_VENDORS.find(vendor =>
    vendor.dataType === dataType && vendor.integrationType === integrationType
  );
}

export function isSupportedBackfillIntegrationType(
  type: IntegrationReadType['type'],
  dataType: SignalDataType
): type is BackfillIntegrationType {
  return BACKFILL_VENDORS.some(vendor =>
    vendor.dataType === dataType && vendor.integrationType === type
  );
}

function isSinkTypeFor(dataType: SignalDataType, sinkType: SchemaOperation['type']): boolean {
  return BACKFILL_VENDORS.some(vendor =>
    vendor.dataType === dataType && vendor.sinkType === sinkType
  );
}

export function isBackfillLogSink(vertex: SchemaOperation): vertex is BackfillLogSink {
  return isSinkTypeFor(CreateLogsBackfillJobDataType.logs, vertex.type);
}

export function isBackfillTraceSink(vertex: SchemaOperation): vertex is BackfillTraceSink {
  return isSinkTypeFor(CreateSpansBackfillJobDataType.spans, vertex.type);
}
