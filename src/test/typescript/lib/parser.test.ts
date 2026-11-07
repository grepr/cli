import { describe, expect, it } from 'bun:test';
import { NDJsonStreamParser, STREAM_EVENTS } from '../../../../src/main/typescript/lib/parser.js';

describe('NDJsonStreamParser', () => {
  it('test_resourcesExhausted_emitsItsOwnEventWithTheRecordData', () => {
    const parser = new NDJsonStreamParser();
    const received: unknown[] = [];
    parser.on(STREAM_EVENTS.RESOURCES_EXHAUSTED, data => received.push(data));
    parser.on(STREAM_EVENTS.UNKNOWN_STATE, () => received.push('unknown state'));
    const data = { message: 'Narrow the time range and try again.' };

    parser.processChunk(Buffer.from(`${JSON.stringify({ jobState: 'RESOURCES_EXHAUSTED', data })}\r\n`));

    expect(received).toEqual([data]);
  });
});
