import {
  GrokParserType,
  JsonLogProcessorType,
  LogAttributesRemapperType,
} from '@/openapi/openApiTypes';

export const RAW_PRE_PARSER_FILTER = 'pre_parser_filter';
export const RAW_PRE_WAREHOUSE_FILTER = 'pre_data_warehouse_filter';
export const RAW_PRE_EXCEPTIONS_FILTER = 'pre_exceptions_filter';
export const RAW_JSON_PROCESSOR = 'json_log_processor';
export const RAW_ATTRIBUTES_REMAPPER = 'log_attributes_remapper';
export const RAW_LOG_REDUCER = 'log_reducer';
export const RAW_JSON_PROCESSOR_TYPE = JsonLogProcessorType.json_log_processor;
export const RAW_ATTRIBUTES_REMAPPER_TYPE = LogAttributesRemapperType.log_attributes_remapper;
export const RAW_GROK_PARSER_TYPE = GrokParserType.grok_parser;

export const RAW_PARSER_TYPES: ReadonlySet<string> = new Set([
  RAW_JSON_PROCESSOR_TYPE,
  RAW_ATTRIBUTES_REMAPPER_TYPE,
  RAW_GROK_PARSER_TYPE,
]);
