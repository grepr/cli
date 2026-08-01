import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { JsonFormatter, JsonFormatterOptions } from '../../../../src/main/typescript/lib/json-formatter.js';
import { LogEventData } from '../../../../src/main/typescript/types.js';

describe('JsonFormatter', () => {
  let formatter: JsonFormatter;
  let defaultOptions: JsonFormatterOptions;

  beforeEach(() => {
    defaultOptions = {
      format: 'table',
      showTimestamps: false,
      colorize: false,
      timezone: 'UTC'
    };
    formatter = new JsonFormatter(defaultOptions);
  });

  describe('Object Flattening', () => {
    it('should flatten simple objects', () => {
      const obj = { id: '123', name: 'test', status: 'active' };
      const result = formatter['flattenObject'](obj);

      expect(result).toEqual({
        id: '123',
        name: 'test',
        status: 'active'
      });
    });

    it('should flatten nested objects to maxDepth=1 by default', () => {
      const obj = {
        id: '123',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
            credentials: {
              username: 'user',
              password: 'pass'
            }
          },
          cache: {
            enabled: true
          }
        }
      };

      const result = formatter['flattenObject'](obj);

      // With maxDepth=1, config should be formatted as JSON string with maxLines=4 truncation
      const expectedConfigJson = JSON.stringify({
        database: {
          host: 'localhost',
          port: 5432,
          credentials: {
            username: 'user',
            password: 'pass'
          }
        },
        cache: {
          enabled: true
        }
      }, null, 2);

      expect(result).toEqual({
        id: '123',
        config: expectedConfigJson
      });
    });

    it('should respect custom maxDepth setting', () => {
      const customFormatter = new JsonFormatter({ ...defaultOptions, maxDepth: 3 });
      const obj = {
        id: '123',
        config: {
          database: {
            host: 'localhost',
            port: 5432
          }
        }
      };

      const result = customFormatter['flattenObject'](obj);

      expect(result).toEqual({
        id: '123',
        'config.database.host': 'localhost',
        'config.database.port': '5432'
      });
    });

    it('should handle LogEvent attributes correctly', () => {
      const logEvent: LogEventData = {
        id: 'log123',
        eventTimestamp: '2024-01-01T00:00:00Z',
        severity: '2',
        attributes: {
          attr1: 'value1',
          attr2: 'value2',
          nested: {
            deep: 'value'
          }
        }
      };

      const result = formatter['flattenObject'](logEvent);

      // With maxDepth=1, attributes should be formatted as JSON string with maxLines=4 truncation
      const expectedAttributesJson = JSON.stringify({
        attr1: 'value1',
        attr2: 'value2',
        nested: {
          deep: 'value'
        }
      }, null, 2);

      expect(result).toEqual({
        id: 'log123',
        eventTimestamp: '2024-01-01T00:00:00Z',
        severity: '2',
        attributes: expectedAttributesJson
      });
    });

    it('should handle null and undefined values', () => {
      const obj = {
        id: '123',
        nullValue: null,
        undefinedValue: undefined,
        emptyString: ''
      };

      const result = formatter['flattenObject'](obj);

      expect(result).toEqual({
        id: '123',
        nullValue: '',
        undefinedValue: '',
        emptyString: ''
      });
    });

    it('should handle arrays as JSON strings', () => {
      const obj = {
        id: '123',
        tags: ['tag1', 'tag2'],
        nested: {
          items: [1, 2, 3]
        }
      };

      const result = formatter['flattenObject'](obj);

      const expectedNestedJson = JSON.stringify({ items: [1, 2, 3] }, null, 2);

      expect(result).toEqual({
        id: '123',
        tags: JSON.stringify(['tag1', 'tag2'], null, 2),
        nested: expectedNestedJson
      });
    });
  });

  describe('Column Ordering', () => {
    it('should order headers correctly for job objects', () => {
      const headers = [
        'description', 'organizationId', 'id', 'execution', 'state',
        'customField', 'name', 'createdAt', 'version'
      ];

      const result = formatter['orderHeaders'](headers);

      expect(result.slice(0, 7)).toEqual([
        'id', 'name', 'state', 'version', 'createdAt',
        'organizationId', 'execution'
      ]);
      expect(result).toContain('customField');
      expect(result).toContain('description');
    });

    it('should order headers correctly for integration objects', () => {
      const headers = [
        'apiKey', 'organizationId', 'id', 'type', 'name',
        'updatedAt', 'createdAt', 'site'
      ];

      const result = formatter['orderHeaders'](headers);

      expect(result.slice(0, 6)).toEqual([
        'id', 'name', 'type', 'createdAt', 'updatedAt', 'organizationId'
      ]);
    });

    it('should order headers correctly for LogEvent objects', () => {
      const headers = [
        'message', 'attributes.attr1', 'severity', 'id',
        'eventTimestamp', 'tags', 'receivedTimestamp'
      ];

      const result = formatter['orderHeaders'](headers);

      expect(result.slice(0, 5)).toEqual([
        'id', 'eventTimestamp', 'receivedTimestamp', 'severity', 'tags'
      ]);
      expect(result).toContain('attributes.attr1');
      expect(result[result.length - 1]).toBe('message'); // message should be last
    });

    it('should handle case-insensitive matching', () => {
      const headers = ['ID', 'Name', 'STATE', 'customField'];

      const result = formatter['orderHeaders'](headers);

      expect(result.slice(0, 3)).toEqual(['ID', 'Name', 'STATE']);
    });

    it('should sort nested columns alphabetically', () => {
      const headers = [
        'id', 'attributes.zebra', 'attributes.alpha', 'config.beta', 'config.gamma'
      ];

      const result = formatter['orderHeaders'](headers);

      expect(result).toEqual([
        'id', 'attributes.alpha', 'attributes.zebra', 'config.beta', 'config.gamma'
      ]);
    });
  });

  describe('Formatting Options', () => {
    it('should format as table correctly', () => {
      const data = [
        { id: '1', name: 'item1', status: 'active' },
        { id: '2', name: 'item2', status: 'inactive' }
      ];

      const result = formatter.formatObjects(data);

      expect(result).toContain('| id');
      expect(result).toContain('| name');
      expect(result).toContain('| status');
      expect(result).toContain('| 1');
      expect(result).toContain('| item1');
      expect(result).toContain('| active');
    });

    it('should format as CSV correctly', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });
      const data = [
        { id: '1', name: 'item1', status: 'active' },
        { id: '2', name: 'item2', status: 'inactive' }
      ];

      const result = csvFormatter.formatObjects(data);

      expect(result).toContain('id,name,status');
      expect(result).toContain('1,item1,active');
      expect(result).toContain('2,item2,inactive');
    });

    it('should keep streaming CSV rows aligned with the emitted header', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        const first = csvFormatter.formatLogData({ id: '1', message: 'first' });
        const second = csvFormatter.formatLogData({ id: '2', severity: 'warning', message: 'second' });

        expect(`${first}\n${second}`).toBe(
          'id,message\n' +
          '1,first\n' +
          '2,second'
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('should warn once and report every field streaming CSV had to drop', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        csvFormatter.formatLogData({ id: '1', message: 'first' });
        csvFormatter.formatLogData({ id: '2', severity: 'warning', message: 'second' });
        csvFormatter.formatLogData({ id: '3', service: 'api', message: 'third' });

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain('[WARN]');
        expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain('severity');
        expect(csvFormatter.getDroppedCsvFields()).toEqual(['severity', 'service']);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('should list dropped CSV fields in the summary', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        csvFormatter.formatLogData({ id: '1', message: 'first' });
        csvFormatter.formatLogData({ id: '2', severity: 'warning', message: 'second' });
      } finally {
        consoleErrorSpy.mockRestore();
      }

      const summary = csvFormatter.formatSummary({
        recordsProcessed: 2,
        heartbeatsSent: 0,
        errors: 0,
        errorMessages: [],
        startTime: 0,
        endTime: 1000
      });

      expect(summary).toContain('Dropped CSV fields: severity');
    });

    it('should not warn about dropped fields when batch formatting CSV', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        csvFormatter.formatObjects([
          { id: '1', message: 'first' },
          { id: '2', severity: 'warning', message: 'second' }
        ]);

        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(csvFormatter.getDroppedCsvFields()).toEqual([]);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('should retain later columns when batch formatting CSV', () => {
      const csvFormatter = new JsonFormatter({ ...defaultOptions, format: 'csv' });

      const result = csvFormatter.formatObjects([
        { id: '1', message: 'first' },
        { id: '2', severity: 'warning', message: 'second' }
      ]);

      expect(result).toBe(
        'id,severity,message\n' +
        '1,,first\n' +
        '2,warning,second'
      );
    });

    it('should format as pretty JSON correctly', () => {
      const prettyFormatter = new JsonFormatter({ ...defaultOptions, format: 'pretty' });
      const data = { id: '1', name: 'item1', nested: { value: 'test' } };

      const result = prettyFormatter.formatObject(data);

      expect(result).toContain('"id": "1"');
      expect(result).toContain('"name": "item1"');
      expect(result).toContain('"nested"');
      expect(result).toContain('"value": "test"');
    });

    it('should handle empty data arrays', () => {
      const result = formatter.formatObjects([]);
      expect(result).toBe('No data to display');
    });

    it('should handle single object formatting', () => {
      const obj = { id: '123', name: 'test' };
      const result = formatter.formatObject(obj);

      // For table format on single object, it should return empty string (accumulated for later rendering)
      expect(typeof result).toBe('string');
    });
  });

  describe('Timestamp Formatting', () => {
    it('should identify timestamp columns correctly', () => {
      const timestampColumns = [
        'eventTimestamp', 'receivedTimestamp', 'createdAt', 'updatedAt',
        'timestamp', 'time', 'startTime', 'endTime'
      ];

      timestampColumns.forEach(column => {
        expect(formatter['isTimestampColumn'](column)).toBe(true);
      });
    });

    it('should not identify non-timestamp columns as timestamps', () => {
      const nonTimestampColumns = [
        'timeout', 'id', 'name', 'status', 'description', 'timeless'
      ];

      nonTimestampColumns.forEach(column => {
        expect(formatter['isTimestampColumn'](column)).toBe(false);
      });
    });

    it('should format unix timestamps correctly', () => {
      const unixTimestamp = 1640995200; // 2022-01-01T00:00:00Z
      const result = formatter['formatTimestamp'](unixTimestamp);

      expect(result).toContain('2022');
      expect(result).toContain('01');
    });

    it('should format ISO timestamps correctly', () => {
      const isoTimestamp = '2022-01-01T00:00:00Z';
      const result = formatter['formatTimestamp'](isoTimestamp);

      expect(result).toContain('2022');
      expect(result).toContain('01');
    });

    it('should handle invalid timestamps gracefully', () => {
      const invalidTimestamp = 'not-a-timestamp';
      const result = formatter['formatTimestamp'](invalidTimestamp);

      expect(result).toBe('not-a-timestamp');
    });
  });

  describe('LogEvent-specific Methods', () => {
    it('should format LogEvent data using formatLogData', () => {
      const logEvent: LogEventData = {
        id: 'log123',
        eventTimestamp: '2024-01-01T00:00:00Z',
        severity: '2',
        message: 'Test message'
      };

      const result = formatter.formatLogData(logEvent);
      expect(typeof result).toBe('string');
    });

    it('should format job states correctly', () => {
      const statesFormatter = new JsonFormatter({ ...defaultOptions, showTimestamps: true, colorize: false });

      expect(statesFormatter.formatJobState('RUNNING')).toContain('[RUNNING]');
      expect(statesFormatter.formatJobState('RUNNING')).toContain('Job is running');
      expect(statesFormatter.formatJobState('FINISHED')).toContain('[FINISHED]');
      expect(statesFormatter.formatJobState('FAILED')).toContain('[FAILED]');
    });

    it('should format heartbeat status correctly', () => {
      const heartbeatFormatter = new JsonFormatter({ ...defaultOptions, colorize: false });

      expect(heartbeatFormatter.formatHeartbeatStatus('SENT')).toContain('[HEARTBEAT] SENT');
      expect(heartbeatFormatter.formatHeartbeatStatus('FAILED', 'connection lost')).toContain('FAILED connection lost');
    });

    it('should omit timestamp prefix but keep the state message when showTimestamps is false', () => {
      // --no-timestamps hides the leading ISO timestamp; the [STATE] label and
      // human message MUST still render so users see what's happening.
      const result = formatter.formatJobState('RUNNING');
      expect(result).toBe('[RUNNING] Job is running, processing data...');
    });
  });

  describe('Sorting', () => {
    it.each(['table', 'csv', 'pretty', 'raw', 'compact'] as const)(
      'should sort multi-object %s output by specified column',
      format => {
        const sortFormatter = new JsonFormatter({ ...defaultOptions, format, sortBy: 'name:asc' });
        const data = [
          { id: '1', name: 'zebra' },
          { id: '2', name: 'alpha' },
          { id: '3', name: 'beta' }
        ];

        const result = sortFormatter.formatObjects(data);

        expect(result.indexOf('alpha')).toBeLessThan(result.indexOf('beta'));
        expect(result.indexOf('beta')).toBeLessThan(result.indexOf('zebra'));
      }
    );

    it.each(['table', 'csv', 'pretty', 'raw', 'compact'] as const)(
      'should sort multi-object %s output by flattened column',
      format => {
        const sortFormatter = new JsonFormatter({ ...defaultOptions, format, maxDepth: 2, sortBy: 'metadata.priority:asc' });
        const data = [
          { id: '1', name: 'slow', metadata: { priority: 3 } },
          { id: '2', name: 'fast', metadata: { priority: 1 } },
          { id: '3', name: 'medium', metadata: { priority: 2 } }
        ];

        const result = sortFormatter.formatObjects(data);

        expect(result.indexOf('fast')).toBeLessThan(result.indexOf('medium'));
        expect(result.indexOf('medium')).toBeLessThan(result.indexOf('slow'));
      }
    );

    it('should sort data by specified column', () => {
      const sortFormatter = new JsonFormatter({ ...defaultOptions, sortBy: 'name:asc' });
      const data = [
        { id: '1', name: 'zebra' },
        { id: '2', name: 'alpha' },
        { id: '3', name: 'beta' }
      ];

      // Add data to formatter and sort
      data.forEach(item => sortFormatter['addToTable'](item));
      const sorted = sortFormatter['sortData'](sortFormatter['tableData']);

      expect(sorted[0]?.name).toBe('alpha');
      expect(sorted[1]?.name).toBe('beta');
      expect(sorted[2]?.name).toBe('zebra');
    });

    it('should sort data in descending order when specified', () => {
      const sortFormatter = new JsonFormatter({ ...defaultOptions, sortBy: 'name:desc' });
      const data = [
        { id: '1', name: 'alpha' },
        { id: '2', name: 'zebra' },
        { id: '3', name: 'beta' }
      ];

      data.forEach(item => sortFormatter['addToTable'](item));
      const sorted = sortFormatter['sortData'](sortFormatter['tableData']);

      expect(sorted[0]?.name).toBe('zebra');
      expect(sorted[1]?.name).toBe('beta');
      expect(sorted[2]?.name).toBe('alpha');
    });

    it('should handle timestamp sorting correctly', () => {
      const sortFormatter = new JsonFormatter({ ...defaultOptions, sortBy: 'createdAt:asc' });
      const data = [
        { id: '1', createdAt: '2024-01-03T00:00:00Z' },
        { id: '2', createdAt: '2024-01-01T00:00:00Z' },
        { id: '3', createdAt: '2024-01-02T00:00:00Z' }
      ];

      data.forEach(item => sortFormatter['addToTable'](item));
      const sorted = sortFormatter['sortData'](sortFormatter['tableData']);

      expect(sorted[0]?.id).toBe('2'); // 2024-01-01
      expect(sorted[1]?.id).toBe('3'); // 2024-01-02
      expect(sorted[2]?.id).toBe('1'); // 2024-01-03
    });
  });

  describe('CSV Escaping', () => {
    it('should escape CSV values with commas', () => {
      const value = 'hello, world';
      const result = formatter['escapeCsvValue'](value);
      expect(result).toBe('"hello, world"');
    });

    it('should escape CSV values with quotes', () => {
      const value = 'hello "world"';
      const result = formatter['escapeCsvValue'](value);
      expect(result).toBe('"hello ""world"""');
    });

    it('should escape CSV values with newlines', () => {
      const value = 'hello\\nworld';
      const result = formatter['escapeCsvValue'](value);
      expect(result).toBe('"hello\\nworld"');
    });

    it('should not escape simple values', () => {
      const value = 'hello world';
      const result = formatter['escapeCsvValue'](value);
      expect(result).toBe('hello world');
    });
  });
});
