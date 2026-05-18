import { EventEmitter } from 'events'
import { EventRecord } from '../types'

/**
 * Event name constants for NDJsonStreamParser
 */
export const STREAM_EVENTS = {
  EVENT_RECORD: 'event_record',
  HEARTBEAT_REQUEST: 'heartbeat_request',
  DATA: 'data',
  FINISHED: 'finished',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  SCANNED_MAX: 'scanned_max',
  UNKNOWN_STATE: 'unknown-state',
  PARSE_ERROR: 'parse_error'
} as const;

/**
 * Parses newline-delimited JSON stream responses
 */
export class NDJsonStreamParser extends EventEmitter {
  private buffer = '';

  processChunk(chunk: Buffer): void {
    this.buffer += chunk.toString();

    const lines = this.buffer.split('\r\n');

    if (!this.buffer.endsWith('\r\n')) {
      // Keep the last bit in buffer as it might be incomplete
      this.buffer = lines.pop() || '';
    } else {
      // Buffer ends with complete lines, clear it
      this.buffer = '';
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.parseJsonLine(trimmed);
      }
    }
  }

  finalize(): void {
    // Process any remaining data in buffer
    if (this.buffer.trim()) {
      this.parseJsonLine(this.buffer.trim());
    }
    this.buffer = '';
  }

  private parseJsonLine(jsonLine: string): void {
    let record: EventRecord;
    try {
      record = JSON.parse(jsonLine);
    } catch (error) {
      this.emit(STREAM_EVENTS.PARSE_ERROR, error, jsonLine);
      return;
    }

    const jobState = record?.jobState;
    const data = record?.data;
    const heartbeatToken = record?.heartbeatToken;

    // Handle different job states
    switch (jobState) {
      case 'HEARTBEAT':
        this.emit(STREAM_EVENTS.HEARTBEAT_REQUEST, heartbeatToken);
        break;
      case 'FINISHED':
        if (data) {
          this.emit(STREAM_EVENTS.DATA, data);
        }
        this.emit(STREAM_EVENTS.FINISHED, data);
        break;
      case 'FAILED':
        this.emit(STREAM_EVENTS.FAILED, data);
        break;
      case 'CANCELLED':
        this.emit(STREAM_EVENTS.CANCELLED, data);
        break;
      case 'TIMED_OUT':
        this.emit(STREAM_EVENTS.TIMED_OUT, data);
        break;
      case 'SCANNED_MAX':
        this.emit(STREAM_EVENTS.SCANNED_MAX, data);
        break;
      case 'RUNNING':
        if (data) {
          this.emit(STREAM_EVENTS.DATA, data);
        }
        break;
      default:
        this.emit(STREAM_EVENTS.UNKNOWN_STATE, data);
    }
  }
}