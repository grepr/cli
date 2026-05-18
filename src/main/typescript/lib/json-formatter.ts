import chalk from 'chalk';

export interface JsonFormatterOptions {
  format: 'table' | 'csv' | 'pretty' | 'raw' | 'compact';
  showTimestamps?: boolean;
  colorize?: boolean;
  sortBy?: string;
  timezone?: string;
  maxDepth?: number; // Maximum flattening depth (default: 1, meaning minimal nesting)
  maxLines?: number; // Maximum lines per table cell (default: 4, for table only)
}

export interface ProcessStats {
  recordsProcessed: number;
  heartbeatsSent: number;
  errors: number;
  errorMessages: string[];
  startTime: number | null;
  endTime: number | null;
  duration?: string;
}

/**
 * Generic formatter for any JSON objects (jobs, integrations, datasets, etc.)
 * Replaces the LogEvent-specific OutputFormatter
 */
export class JsonFormatter {
  public options: JsonFormatterOptions;
  private tableData: Record<string, unknown>[] = [];
  private tableHeaders: string[] = [];
  private csvHeaders: string[] = [];
  private csvHeadersPrinted = false;

  constructor(options: JsonFormatterOptions) {
    this.options = options;
    this.reset();
  }

  /**
   * Reset formatter state
   */
  reset(): void {
    this.tableData = [];
    this.tableHeaders = [];
    this.csvHeaders = [];
    this.csvHeadersPrinted = false;
  }

  /**
   * Format a single object based on selected format
   */
  formatObject(data: Record<string, unknown>): string {
    switch (this.options.format) {
      case 'table':
        return this.addToTable(data);
      case 'csv':
        return this.addToCsv(data);
      case 'pretty':
        return this.formatPrettyJson(data);
      case 'raw':
        return JSON.stringify(data);
      case 'compact':
        return JSON.stringify(data, null, 0);
      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Format an array of objects
   */
  formatObjects(data: Record<string, unknown>[]): string {
    if (!data || data.length === 0) {
      return 'No data to display';
    }

    this.reset();

    switch (this.options.format) {
      case 'table':
        // Accumulate all data then render
        data.forEach(obj => this.addToTable(obj));
        return this.renderTable();

      case 'csv': {
        // First pass: collect all headers from all objects
        data.forEach(obj => {
          const flattenedRow = this.flattenObject(obj);
          const newKeys = Object.keys(flattenedRow);
          if (this.csvHeaders.length === 0) {
            this.csvHeaders = [...newKeys];
          } else {
            const missingKeys = newKeys.filter(key => !this.csvHeaders.includes(key));
            this.csvHeaders.push(...missingKeys);
          }
        });

        // Second pass: generate CSV rows with consistent headers
        const csvRows: string[] = [];
        data.forEach(obj => {
          const csvRow = this.addToCsv(obj);
          if (csvRow) {
            csvRows.push(csvRow);
          }
        });
        return csvRows.join('\n');
      }

      case 'pretty':
        return data.map(obj => this.formatPrettyJson(obj)).join('\n\n');

      case 'raw':
        return data.map(obj => JSON.stringify(obj)).join('\n');

      case 'compact':
        return data.map(obj => JSON.stringify(obj, null, 0)).join('\n');

      default:
        return JSON.stringify(data, null, 2);
    }
  }

  /**
   * Add data to table and return empty string (table will be rendered at the end)
   */
  private addToTable(data: Record<string, unknown>): string {
    // Limit lines per cell based on options when adding to table.
    const flattenedRow = this.flattenObject(data, '', 0, this.options.maxLines ?? 4);
    this.tableData.push(flattenedRow);

    // Update headers with any new keys
    const newKeys = Object.keys(flattenedRow);
    if (this.tableHeaders.length === 0) {
      this.tableHeaders = [...newKeys];
    } else {
      const missingKeys = newKeys.filter(key => !this.tableHeaders.includes(key));
      this.tableHeaders.push(...missingKeys);
    }

    return ''; // Don't output anything yet, table will be rendered at the end
  }

  /**
   * Add data to CSV and return CSV row string (with headers on first call)
   */
  private addToCsv(data: Record<string, unknown>): string {
    const flattenedRow = this.flattenObject(data);

    // Update headers with any new keys
    const newKeys = Object.keys(flattenedRow);
    if (this.csvHeaders.length === 0) {
      this.csvHeaders = [...newKeys];
    } else {
      const missingKeys = newKeys.filter(key => !this.csvHeaders.includes(key));
      this.csvHeaders.push(...missingKeys);
    }

    let output = '';

    // Print headers on first row
    if (!this.csvHeadersPrinted) {
      const orderedHeaders = this.orderHeaders(this.csvHeaders);
      output += this.formatCsvRow(orderedHeaders) + '\n';
      this.csvHeadersPrinted = true;
    }

    // Format and return the data row
    const orderedHeaders = this.orderHeaders(this.csvHeaders);
    const rowValues = orderedHeaders.map(header => flattenedRow[header] || '');
    output += this.formatCsvRow(rowValues);

    return output;
  }

  /**
   * Flatten nested object into dot notation
   */
  private flattenObject(obj: Record<string, unknown>, prefix = '', depth = 0, maxLines = -1): Record<string, unknown> {
    const maxDepth = this.options.maxDepth ?? 1;
    const flattened: Record<string, unknown> = {};

    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        flattened[fullKey] = '';
      } else if (typeof value === 'object' && !Array.isArray(value) && depth < maxDepth - 1) {
        // Recursively flatten nested objects only if we haven't reached max depth
        Object.assign(flattened, this.flattenObject(value as Record<string, unknown>, fullKey, depth + 1, maxLines));
      } else {
        // At max depth or not an object - format as cell value
        flattened[fullKey] = this.formatCellValue(value, fullKey, maxLines);
      }
    });

    return flattened;
  }

  /**
   * Format cell value - keep JSON as formatted JSON, primitives as strings
   * Special handling for timestamp columns to show readable local time
   */
  private formatCellValue(value: unknown, columnName = '', maxLines = -1): string {
    if (value === null || value === undefined) {
      return '';
    }

    let result: string;
    if (Array.isArray(value)) {
      result = JSON.stringify(value, null, 2);
    } else if (typeof value === 'object') {
      result = JSON.stringify(value, null, 2);
    } else if (this.options.showTimestamps && this.isTimestampColumn(columnName)) {
      result = this.formatTimestamp(value);
    } else {
      result = String(value);
    }

    // Apply maxLines truncation
    if (maxLines > 0) {
      const lines = result.split('\n');
      if (lines.length > maxLines) {
        return lines.slice(0, maxLines).join('\n') + '\n...';
      }
    }

    return result;
  }

  /**
   * Check if a column name indicates it contains timestamps
   */
  private isTimestampColumn(columnName: string): boolean {
    const timestampColumns = [
      'timestamp', 'eventTimestamp', 'receivedTimestamp',
      'createdAt', 'updatedAt', 'created_at', 'updated_at',
      'time', 'date', 'startTime', 'endTime'
    ];

    const lowerColumnName = columnName.toLowerCase();
    // Use exact matches or specific patterns to avoid false positives like "timeout"
    return timestampColumns.some(tsCol =>
      lowerColumnName === tsCol.toLowerCase() ||
      lowerColumnName === `${tsCol.toLowerCase()}stamp` ||
      (lowerColumnName.endsWith('at') && lowerColumnName.length > 2) ||
      (lowerColumnName.endsWith('time') && !lowerColumnName.includes('timeout'))
    );
  }

  /**
   * Format timestamp value to readable time string with timezone support
   */
  private formatTimestamp(value: unknown): string {
    try {
      const timestampMillis = this.parseTimestamp(value);

      if (timestampMillis === null || isNaN(timestampMillis)) {
        return String(value); // Return original if parsing fails
      }

      const date = new Date(timestampMillis);

      // Use specified timezone or default to system locale
      if (this.options.timezone && this.options.timezone !== 'system') {
        return date.toLocaleString('en-US', {
          timeZone: this.options.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        });
      } else {
        // Use system locale and timezone
        return date.toLocaleString();
      }
    } catch {
      return String(value); // Return original if formatting fails
    }
  }

  /**
   * Parse a timestamp value for sorting (returns milliseconds since epoch or null)
   */
  private parseTimestamp(value: unknown): number | null {
    if (!value) return null;

    try {
      const strValue = String(value);

      if (/^\d+$/.test(strValue)) {
        // Unix timestamp
        const timestamp = parseInt(strValue);
        // Handle both seconds (10 digits) and milliseconds (13 digits)
        return strValue.length === 10 ? timestamp * 1000 : timestamp;
      } else {
        // ISO string or other date format
        const date = new Date(strValue);
        return isNaN(date.getTime()) ? null : date.getTime();
      }
    } catch {
      return null;
    }
  }

  /**
   * Order headers according to common column preferences
   */
  private orderHeaders(headers: string[]): string[] {
    if (!headers || headers.length === 0) {
      return headers;
    }

    const orderedHeaders: string[] = [];

    // Define the desired order for common columns (works for jobs, integrations, log events)
    const fixedOrder = [
      'id', 'name', 'type', 'state', 'status', 'version',
      'createdAt', 'updatedAt', 'eventTimestamp', 'receivedTimestamp',
      'severity', 'tags', 'organizationId', 'execution', 'processing'
    ];

    // Add fixed order columns if they exist (case-insensitive)
    fixedOrder.forEach(column => {
      const found = headers.find(header => header.toLowerCase() === column.toLowerCase());
      if (found) {
        orderedHeaders.push(found);
      }
    });

    // Find all nested/attribute columns and sort them alphabetically
    const nestedColumns = headers
      .filter(header => header.includes('.'))
      .filter(header => !orderedHeaders.includes(header))
      .sort((a, b) => a.localeCompare(b));

    orderedHeaders.push(...nestedColumns);

    // Add description/message columns if they exist
    const descriptionColumns = headers.filter(header => {
      const lower = header.toLowerCase();
      return (lower.includes('description') || lower.includes('message')) && !orderedHeaders.includes(header);
    }).sort((a, b) => a.localeCompare(b));
    orderedHeaders.push(...descriptionColumns);

    // Add any remaining columns that weren't covered above, sorted alphabetically
    const remainingColumns = headers
      .filter(header => !orderedHeaders.includes(header))
      .sort((a, b) => a.localeCompare(b));
    orderedHeaders.push(...remainingColumns);

    return orderedHeaders;
  }

  /**
   * Render the accumulated table data
   */
  renderTable(): string {
    if (!this.tableData.length) {
      return 'No data to display';
    }

    // Sort the table data before rendering
    const sortedData = this.sortData(this.tableData);

    // Order the headers according to the specified column order
    const orderedHeaders = this.orderHeaders(this.tableHeaders);

    return this.formatTable(orderedHeaders, sortedData);
  }

  /**
   * Sort data based on the sortBy option
   */
  private sortData(data: Record<string, unknown>[]): Record<string, unknown>[] {
    if (!this.options.sortBy || data.length <= 1) {
      return data;
    }

    const [sortColumn, sortOrder = 'asc'] = this.options.sortBy.split(':');
    const isAscending = sortOrder.toLowerCase() === 'asc';

    // Find the actual column name (case-insensitive)
    const actualColumn = this.findActualColumnName(sortColumn || '');
    if (!actualColumn) {
      console.warn(`Warning: Sort column '${sortColumn}' not found in data`);
      return data;
    }

    return [...data].sort((a, b) => {
      const valueA = a[actualColumn];
      const valueB = b[actualColumn];

      // Handle null/undefined values
      if (valueA == null && valueB == null) return 0;
      if (valueA == null) return isAscending ? -1 : 1;
      if (valueB == null) return isAscending ? 1 : -1;

      // Try to parse as timestamps first for timestamp columns
      if (this.isTimestampColumn(actualColumn)) {
        const timestampA = this.parseTimestamp(valueA);
        const timestampB = this.parseTimestamp(valueB);

        if (timestampA !== null && timestampB !== null) {
          const result = timestampA - timestampB;
          return isAscending ? result : -result;
        }
      }

      // Try numeric comparison first
      const numA = parseFloat(String(valueA));
      const numB = parseFloat(String(valueB));

      if (!isNaN(numA) && !isNaN(numB)) {
        const result = numA - numB;
        return isAscending ? result : -result;
      }

      // Fall back to string comparison
      const strA = String(valueA).toLowerCase();
      const strB = String(valueB).toLowerCase();
      const result = strA.localeCompare(strB);
      return isAscending ? result : -result;
    });
  }

  /**
   * Find the actual column name in the data (case-insensitive search)
   */
  private findActualColumnName(searchColumn: string): string | null {
    if (!this.tableHeaders) return null;

    const lowerSearchColumn = searchColumn.toLowerCase();

    // Exact match first
    const exactMatch = this.tableHeaders.find(header => header === searchColumn);
    if (exactMatch) return exactMatch;

    // Case-insensitive match
    const caseInsensitiveMatch = this.tableHeaders.find(header =>
      header.toLowerCase() === lowerSearchColumn
    );
    if (caseInsensitiveMatch) return caseInsensitiveMatch;

    // Partial match for common variations
    const partialMatch = this.tableHeaders.find(header =>
      header.toLowerCase().includes(lowerSearchColumn) ||
      lowerSearchColumn.includes(header.toLowerCase())
    );

    return partialMatch || null;
  }

  /**
   * Format a CSV row with proper escaping
   */
  private formatCsvRow(values: (string | unknown)[]): string {
    return values.map(value => this.escapeCsvValue(String(value || ''))).join(',');
  }

  /**
   * Escape a CSV value according to RFC 4180
   */
  private escapeCsvValue(value: string): string {
    const stringValue = String(value);

    // If the value contains comma, newline, double quote, or literal \n, wrap in quotes
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r') || stringValue.includes('"') || stringValue.includes('\\n')) {
      // Escape existing double quotes by doubling them
      const escaped = stringValue.replace(/"/g, '""');
      return `"${escaped}"`;
    }

    return stringValue;
  }

  /**
   * Format data as a table
   */
  private formatTable(headers: string[], rows: Record<string, unknown>[]): string {
    if (!headers.length || !rows.length) {
      return 'No data to display';
    }

    // Calculate column widths
    const columnWidths: number[] = headers.map(header => {
      const maxContentWidth = Math.max(
        header.length,
        ...rows.map(row => {
          const cellValue = String(row[header] || '');
          // For multi-line content, use the longest line length
          const lines = cellValue.split('\n');
          return Math.max(...lines.map(line => line.length));
        })
      );
      return Math.min(maxContentWidth, 80); // Max width of 80 chars per column
    });

    // Format header row
    const headerRow = '| ' + headers.map((header, i) =>
      this.wrapAndPad(header, columnWidths[i])
    ).join(' | ') + ' |';

    // Format data rows with proper wrapping
    const formattedRows: string[] = [];

    for (const row of rows) {
      const cellLines: string[][] = headers.map((header, i) => {
        const cellValue = String(row[header] || '');
        const colWidth = columnWidths[i];
        if (colWidth === undefined) {
          return [''];
        }
        return this.wrapText(cellValue, colWidth);
      });

      // Find the maximum number of lines needed for this row
      const maxLines = Math.max(...cellLines.map(lines => lines.length));

      // Create each line of the row
      for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
        const rowLine = '| ' + headers.map((_, i) => {
          const lines = cellLines[i];
          const lineContent = (lines && lineIndex < lines.length) ? lines[lineIndex] : '';
          const colWidth = columnWidths[i];
          if (colWidth === undefined) {
            return '';
          }
          return (lineContent || '').padEnd(colWidth);
        }).join(' | ') + ' |';

        formattedRows.push(rowLine);
      }
    }

    // Create separator line
    const separator = '+-' + columnWidths.map(width => '-'.repeat(width)).join('-+-') + '-+';

    // Combine all parts
    const tableLines = [
      separator,
      headerRow,
      separator,
      ...formattedRows,
      separator
    ];

    return tableLines.join('\n');
  }

  /**
   * Wrap text to fit column width and pad with spaces
   */
  private wrapAndPad(str: string, width?: number): string {
    if (width === undefined) {
      return str;
    }

    if (str.length > width) {
      return str.substring(0, width - 3) + '...';
    }
    return str.padEnd(width);
  }

  /**
   * Wrap text to multiple lines based on column width
   */
  private wrapText(text: string, width: number): string[] {
    if (!text || width <= 0) {
      return [''];
    }

    // Handle text that's already multi-line (like pretty-printed JSON)
    const existingLines = text.split('\n');
    const wrappedLines: string[] = [];

    for (const line of existingLines) {
      if (line.length <= width) {
        wrappedLines.push(line);
      } else {
        // Break long lines at word boundaries when possible
        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
          if (word.length > width) {
            // If a single word is longer than width, break it
            if (currentLine) {
              wrappedLines.push(currentLine.trim());
              currentLine = '';
            }
            // Break the long word into chunks
            for (let i = 0; i < word.length; i += width) {
              wrappedLines.push(word.substring(i, i + width));
            }
          } else if ((currentLine + ' ' + word).length <= width) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) {
              wrappedLines.push(currentLine.trim());
            }
            currentLine = word;
          }
        }

        if (currentLine) {
          wrappedLines.push(currentLine.trim());
        }
      }
    }

    return wrappedLines.length > 0 ? wrappedLines : [''];
  }

  /**
   * Format JSON with pretty printing and syntax highlighting
   */
  formatPrettyJson(data: Record<string, unknown>): string {
    if (!this.options.colorize) {
      return JSON.stringify(data, null, 2);
    }

    const json = JSON.stringify(data, null, 2);

    // Simple syntax highlighting
    return json
      .replace(/"([^"]+)":/g, chalk.blue('"$1"') + ':')  // Keys
      .replace(/: "([^"]+)"/g, ': ' + chalk.green('"$1"'))  // String values
      .replace(/: (\d+\.?\d*)/g, ': ' + chalk.yellow('$1'))  // Numbers
      .replace(/: (true|false)/g, ': ' + chalk.magenta('$1'))  // Booleans
      .replace(/: null/g, ': ' + chalk.gray('null'));  // Null values
  }

  /**
   * Format log data based on selected format (alias for formatObject for backwards compatibility)
   */
  formatLogData(data: Record<string, unknown>): string {
    return this.formatObject(data);
  }

  /**
   * Format job state message
   */
  formatJobState(state: string): string {
    if (!this.options.showTimestamps) {
      return '';
    }

    const timestamp = this.options.showTimestamps ?
      `${new Date().toISOString()} ` : '';

    let stateColor: (text: string) => string;
    let message: string;

    switch (state) {
      case 'HEARTBEAT':
        stateColor = chalk.yellow;
        message = 'Heartbeat received from server';
        break;
      case 'RUNNING':
        stateColor = chalk.green;
        message = 'Job is running, processing data...';
        break;
      case 'FINISHED':
        stateColor = chalk.green.bold;
        message = 'Job completed successfully';
        break;
      case 'FAILED':
        stateColor = chalk.red.bold;
        message = 'Job failed';
        break;
      case 'CANCELLED':
        stateColor = chalk.yellow.bold;
        message = 'Job was cancelled';
        break;
      case 'TIMED_OUT':
        stateColor = chalk.red;
        message = 'Job timed out';
        break;
      case 'SCANNED_MAX':
        stateColor = chalk.yellow;
        message = 'Job reached maximum scan limit';
        break;
      default:
        stateColor = chalk.gray;
        message = `Unknown job state: ${state}`;
    }

    return this.options.colorize ?
      `${timestamp}${stateColor(`[${state}]`)} ${message}` :
      `${timestamp}[${state}] ${message}`;
  }

  /**
   * Format heartbeat status
   */
  formatHeartbeatStatus(action: string, details = ''): string {
    if (!this.options.colorize) {
      return `[HEARTBEAT] ${action} ${details}`.trim();
    }

    const timestamp = this.options.showTimestamps ?
      `${chalk.gray(new Date().toISOString())} ` : '';

    switch (action) {
      case 'SENT':
        return `${timestamp}${chalk.cyan('[♥]')} Heartbeat sent ${details}`;
      case 'FAILED':
        return `${timestamp}${chalk.red('[✗]')} Heartbeat failed ${details}`;
      case 'RETRY':
        return `${timestamp}${chalk.yellow('[↻]')} Retrying heartbeat ${details}`;
      default:
        return `${timestamp}${chalk.blue('[♥]')} ${action} ${details}`;
    }
  }

  /**
   * Format connection status
   */
  formatConnectionStatus(status: string, details = ''): string {
    if (!this.options.colorize) {
      return `[CONNECTION] ${status} ${details}`.trim();
    }

    const timestamp = this.options.showTimestamps ?
      `${chalk.gray(new Date().toISOString())} ` : '';

    switch (status) {
      case 'CONNECTING':
        return `${timestamp}${chalk.blue('[⚡]')} Connecting to Grepr API ${details}`;
      case 'CONNECTED':
        return `${timestamp}${chalk.green('[✓]')} Connected successfully ${details}`;
      case 'DISCONNECTED':
        return `${timestamp}${chalk.yellow('[⚡]')} Disconnected ${details}`;
      case 'ERROR':
        return `${timestamp}${chalk.red('[✗]')} Connection error ${details}`;
      default:
        return `${timestamp}${chalk.blue('[⚡]')} ${status} ${details}`;
    }
  }

  /**
   * Format error messages
   */
  formatError(error: Error, context = ''): string {
    const timestamp = this.options.showTimestamps ?
      `[${new Date().toISOString()}] ` : '';

    const prefix = this.options.colorize ?
      chalk.red.bold('[ERROR]') : '[ERROR]';

    const contextStr = context ? ` (${context})` : '';

    return `${timestamp}${prefix}${contextStr} ${error.message || error}`;
  }

  /**
   * Format summary statistics
   */
  formatSummary(stats: ProcessStats): string {
    const lines = [];

    if (this.options.colorize) {
      lines.push(chalk.bold.underline('\nSummary:'));
      lines.push(`${chalk.cyan('Records processed:')} ${stats.recordsProcessed || 0}`);
      lines.push(`${chalk.cyan('Duration:')} ${stats.duration || 'Unknown'}`);
      if (stats.heartbeatsSent > 0) {
        lines.push(`${chalk.cyan('Heartbeats sent:')} ${stats.heartbeatsSent}`);
      }
      if (stats.errors > 0) {
        lines.push(`${chalk.red('Errors:')} ${stats.errors}`);
      }
    } else {
      lines.push('\nSummary:');
      lines.push(`Records processed: ${stats.recordsProcessed || 0}`);
      lines.push(`Duration: ${stats.duration || 'Unknown'}`);
      if (stats.heartbeatsSent > 0) {
        lines.push(`Heartbeats sent: ${stats.heartbeatsSent}`);
      }
      if (stats.errors > 0) {
        lines.push(`Errors: ${stats.errors}`);
      }
    }

    return lines.join('\n');
  }

}