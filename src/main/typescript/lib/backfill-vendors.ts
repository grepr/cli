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

interface BackfillVendorDescriptor {
  integrationType: IntegrationReadType['type'];
  sinkType: SchemaOperation['type'];
  vendorName: string;
  maxBackfillAgeHours?: number;
}

const BACKFILL_VENDORS = [
  {
    integrationType: ReadDatadogType.datadog,
    sinkType: DatadogLogSinkType.datadog_log_sink,
    vendorName: 'Datadog',
    maxBackfillAgeHours: 18
  },
  {
    integrationType: ReadSplunkType.splunk,
    sinkType: SplunkLogSinkType.splunk_log_sink,
    vendorName: 'Splunk'
  },
  {
    integrationType: ReadNewRelicType.newrelic,
    sinkType: NewRelicLogSinkType.newrelic_log_sink,
    vendorName: 'New Relic',
    maxBackfillAgeHours: 48
  },
  {
    integrationType: ReadSumoType.sumo,
    sinkType: SumoLogSinkType.sumologic_log_sink,
    vendorName: 'Sumo Logic'
  },
  {
    integrationType: ReadOtlpType.otlp,
    sinkType: OtlpLogSinkType.otlp_log_sink,
    vendorName: 'Open Telemetry'
  }
] satisfies readonly BackfillVendorDescriptor[];

export type BackfillIntegrationType = typeof BACKFILL_VENDORS[number]['integrationType'];
export type BackfillLogSinkType = typeof BACKFILL_VENDORS[number]['sinkType'];
export type BackfillLogSink = Extract<SchemaOperation, { type: BackfillLogSinkType }>;

export function findBackfillVendor(
  integrationType: IntegrationReadType['type'],
  sinkType: SchemaOperation['type']
): BackfillVendorDescriptor | undefined {
  return BACKFILL_VENDORS.find(vendor =>
    vendor.integrationType === integrationType && vendor.sinkType === sinkType
  );
}

export function findBackfillVendorByIntegrationType(
  integrationType: IntegrationReadType['type']
): BackfillVendorDescriptor | undefined {
  return BACKFILL_VENDORS.find(vendor => vendor.integrationType === integrationType);
}

export function isSupportedBackfillIntegrationType(
  type: IntegrationReadType['type']
): type is BackfillIntegrationType {
  return BACKFILL_VENDORS.some(vendor => vendor.integrationType === type);
}

export function isBackfillLogSink(vertex: SchemaOperation): vertex is BackfillLogSink {
  return BACKFILL_VENDORS.some(vendor => vendor.sinkType === vertex.type);
}
