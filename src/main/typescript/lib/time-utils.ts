/**
 * Utility functions for time parsing and manipulation
 */

import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';

// Enable duration plugin for ISO 8601 duration parsing
dayjs.extend(duration);

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/;

function parseStrictIsoTimestamp(value: string): Date | undefined {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match || !match[8]) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || !isValidIsoTimestampParts(match)) {
    return undefined;
  }
  return date;
}

function isValidIsoTimestampParts(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  return timestamp.getUTCFullYear() === year &&
    timestamp.getUTCMonth() === month - 1 &&
    timestamp.getUTCDate() === day &&
    timestamp.getUTCHours() === hour &&
    timestamp.getUTCMinutes() === minute &&
    timestamp.getUTCSeconds() === second &&
    timestamp.getUTCMilliseconds() === millisecond;
}

/**
 * Parse ISO 8601 duration format to milliseconds using dayjs
 * Supports full ISO 8601 duration formats:
 * - PT[n]H[n]M[n]S (e.g., PT5H30M, PT1H, PT30M, PT45S)
 * - P[n]D (e.g., P7D, P1D)
 * - P[n]W (e.g., P2W for 2 weeks)
 * - P[n]DT[n]H[n]M[n]S (e.g., P1DT2H30M)
 * - P[n]Y[n]M[n]D (e.g., P1Y6M15D)
 * - And all combinations thereof
 *
 * @param duration - ISO 8601 duration string
 * @returns Duration in milliseconds
 * @throws Error if duration format is invalid or zero
 */
export function parseDurationToMilliseconds(duration: string): number {
  // First check for basic format validation
  if (!duration.match(/^P/)) {
    throw new Error(`Invalid duration format: ${duration}. Expected ISO 8601 format like PT5H30M, P7D, P2W, P1DT2H30M, P1Y6M, etc.`);
  }

  try {
    // Use dayjs to parse the ISO 8601 duration
    const parsed = dayjs.duration(duration);

    // Convert to milliseconds
    const totalMilliseconds = parsed.asMilliseconds();

    // Check for zero or invalid durations first
    if (totalMilliseconds === 0) {
      // Check if this is a parseable but zero duration (like PT0S, P0D)
      if (duration.match(/^P(T0[HMS]|0[DWMY]|T?$|$)/)) {
        throw new Error(`Duration must be greater than zero: ${duration}`);
      }
      // If it's zero but doesn't match known zero patterns, it's invalid format
      throw new Error(`Invalid duration format: ${duration}. Expected ISO 8601 format like PT5H30M, P7D, P2W, P1DT2H30M, P1Y6M, etc.`);
    }

    if (!isFinite(totalMilliseconds) || totalMilliseconds < 0) {
      throw new Error(`Invalid duration: ${duration}`);
    }

    return totalMilliseconds;
  } catch (error) {
    // If it's already our custom error, re-throw it
    if (error instanceof Error && error.message.includes('Duration must be greater than zero')) {
      throw error;
    }
    // Otherwise, it's an invalid format
    throw new Error(`Invalid duration format: ${duration}. Expected ISO 8601 format like PT5H30M, P7D, P2W, P1DT2H30M, P1Y6M, etc.`);
  }
}

/**
 * Parse a time string that can be either an ISO 8601 timestamp or duration
 * If it's a duration, convert it to a timestamp relative to now
 *
 * @param since - Time string (ISO timestamp or duration like "PT5H")
 * @returns ISO 8601 timestamp string
 * @throws Error if format is invalid
 */
export function parseSinceOption(since: string): string {
  // Check if it's already an ISO 8601 timestamp
  if (since.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
    return since;
  }

  // Check if it's an ISO 8601 duration (starts with P)
  if (since.match(/^P/)) {
    try {
      const now = new Date();
      const milliseconds = parseDurationToMilliseconds(since);
      const sinceTime = new Date(now.getTime() - milliseconds);
      return sinceTime.toISOString();
    } catch {
      throw new Error(`Invalid duration format: ${since}. Use ISO 8601 duration format like PT5H, P1D, PT30M, P1Y6M, P2W`);
    }
  }

  // If it doesn't match either format, treat as absolute timestamp
  const parsed = Date.parse(since);
  if (isNaN(parsed)) {
    throw new Error(`Invalid time format: ${since}. Use ISO 8601 timestamp or duration like PT5H, P1D, P1Y6M, P2W`);
  }

  return new Date(parsed).toISOString();
}

export interface TimestampRangeOptions {
  start?: string;
  end?: string;
}

export interface RequiredTimestampRange {
  start: string;
  end: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Parse a required timestamp using strict ISO 8601 syntax with an explicit
 * timezone and includes the flag name in validation errors.
 */
export function parseIsoTimestamp(value: string, flagName: string): Date {
  const date = parseStrictIsoTimestamp(value);
  if (!date) {
    throw new Error(`${flagName} must be a valid ISO 8601 timestamp`);
  }
  return date;
}

/**
 * Require both endpoints of a backfill/query time range and return the parsed
 * dates after enforcing start <= end.
 */
export function requireTimestampRange(options: TimestampRangeOptions): RequiredTimestampRange {
  if (!options.start || !options.end) {
    throw new Error('--start and --end are required');
  }

  const startDate = parseIsoTimestamp(options.start, '--start');
  const endDate = parseIsoTimestamp(options.end, '--end');
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error('--start must be before or equal to --end');
  }

  return {
    start: options.start,
    end: options.end,
    startDate,
    endDate
  };
}

/**
 * Validate whichever endpoints are present on an optional time range without
 * requiring callers that only support one bound to synthesize the other.
 */
export function validateOptionalTimestampRange(options: TimestampRangeOptions): void {
  const startDate = options.start ? parseIsoTimestamp(options.start, '--start') : undefined;
  const endDate = options.end ? parseIsoTimestamp(options.end, '--end') : undefined;
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new Error('--start must be before or equal to --end');
  }
}
