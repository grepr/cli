/**
 * Utility functions for time parsing and manipulation
 */

import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration.js';

// Enable duration plugin for ISO 8601 duration parsing
dayjs.extend(duration);

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