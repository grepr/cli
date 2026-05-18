import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseDurationToMilliseconds, parseSinceOption } from '../../main/typescript/lib/time-utils.js'

describe('parseDurationToMilliseconds', () => {
  it('should parse hours duration (PT5H)', () => {
    const result = parseDurationToMilliseconds('PT5H')
    expect(result).toBe(5 * 60 * 60 * 1000) // 5 hours in milliseconds
  })

  it('should parse days duration (P1D)', () => {
    const result = parseDurationToMilliseconds('P1D')
    expect(result).toBe(24 * 60 * 60 * 1000) // 1 day in milliseconds
  })

  it('should parse minutes duration (PT30M)', () => {
    const result = parseDurationToMilliseconds('PT30M')
    expect(result).toBe(30 * 60 * 1000) // 30 minutes in milliseconds
  })

  it('should parse seconds duration (PT45S)', () => {
    const result = parseDurationToMilliseconds('PT45S')
    expect(result).toBe(45 * 1000) // 45 seconds in milliseconds
  })

  it('should parse complex duration (P2DT3H4M5S)', () => {
    const result = parseDurationToMilliseconds('P2DT3H4M5S')
    const expected =
      2 * 24 * 60 * 60 * 1000 + // 2 days
      3 * 60 * 60 * 1000 +      // 3 hours
      4 * 60 * 1000 +           // 4 minutes
      5 * 1000                  // 5 seconds
    expect(result).toBe(expected)
  })

  it('should parse duration with only days (P7D)', () => {
    const result = parseDurationToMilliseconds('P7D')
    expect(result).toBe(7 * 24 * 60 * 60 * 1000) // 7 days in milliseconds
  })

  it('should parse duration with days and hours (P1DT12H)', () => {
    const result = parseDurationToMilliseconds('P1DT12H')
    const expected =
      1 * 24 * 60 * 60 * 1000 + // 1 day
      12 * 60 * 60 * 1000       // 12 hours
    expect(result).toBe(expected)
  })

  it('should throw error for invalid duration format', () => {
    expect(() => parseDurationToMilliseconds('invalid')).toThrow('Invalid duration format: invalid')
    expect(() => parseDurationToMilliseconds('PT')).toThrow('Duration must be greater than zero: PT')
    expect(() => parseDurationToMilliseconds('P')).toThrow('Duration must be greater than zero: P')
    expect(() => parseDurationToMilliseconds('5H')).toThrow('Invalid duration format: 5H')
  })

  it('should throw error for zero duration', () => {
    expect(() => parseDurationToMilliseconds('PT0S')).toThrow('Duration must be greater than zero: PT0S')
    expect(() => parseDurationToMilliseconds('P0D')).toThrow('Duration must be greater than zero: P0D')
  })
})

describe('parseSinceOption', () => {
  beforeEach(() => {
    // Mock the current time to 2023-10-30T12:00:00.000Z for consistent tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-10-30T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return ISO timestamp as-is', () => {
    const input = '2023-10-30T10:00:00Z'
    const result = parseSinceOption(input)
    expect(result).toBe(input)
  })

  it('should return ISO timestamp with milliseconds as-is', () => {
    const input = '2023-10-30T10:00:00.123Z'
    const result = parseSinceOption(input)
    expect(result).toBe(input)
  })

  it('should convert PT5H duration to timestamp 5 hours ago', () => {
    const result = parseSinceOption('PT5H')
    // 5 hours before 2023-10-30T12:00:00.000Z should be 2023-10-30T07:00:00.000Z
    expect(result).toBe('2023-10-30T07:00:00.000Z')
  })

  it('should convert P1D duration to timestamp 1 day ago', () => {
    const result = parseSinceOption('P1D')
    // 1 day before 2023-10-30T12:00:00.000Z should be 2023-10-29T12:00:00.000Z
    expect(result).toBe('2023-10-29T12:00:00.000Z')
  })

  it('should convert PT30M duration to timestamp 30 minutes ago', () => {
    const result = parseSinceOption('PT30M')
    // 30 minutes before 2023-10-30T12:00:00.000Z should be 2023-10-30T11:30:00.000Z
    expect(result).toBe('2023-10-30T11:30:00.000Z')
  })

  it('should convert complex duration P1DT6H to timestamp 1 day 6 hours ago', () => {
    const result = parseSinceOption('P1DT6H')
    // 1 day 6 hours before 2023-10-30T12:00:00.000Z should be 2023-10-29T06:00:00.000Z
    expect(result).toBe('2023-10-29T06:00:00.000Z')
  })

  it('should parse absolute timestamp strings', () => {
    const result = parseSinceOption('2023-10-25T14:30:00')
    expect(result).toBe('2023-10-25T14:30:00')
  })

  it('should throw error for invalid duration in since option', () => {
    expect(() => parseSinceOption('PT0S')).toThrow('Invalid duration format: PT0S. Use ISO 8601 duration format like PT5H, P1D, PT30M')
    expect(() => parseSinceOption('invalid-duration')).toThrow('Invalid time format: invalid-duration. Use ISO 8601 timestamp or duration like PT5H, P1D')
  })

  it('should throw error for invalid time format', () => {
    expect(() => parseSinceOption('not-a-date')).toThrow('Invalid time format: not-a-date. Use ISO 8601 timestamp or duration like PT5H, P1D')
    expect(() => parseSinceOption('2023-13-45')).toThrow('Invalid time format: 2023-13-45. Use ISO 8601 timestamp or duration like PT5H, P1D')
  })
})