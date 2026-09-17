import { describe, expect, it } from 'bun:test';
import { captureTranscript, followInvestigation, readTurnsPage } from '../../../main/typescript/lib/investigation-transcript.js';
import { ApiError } from '../../../main/typescript/lib/grepr-api-client.js';
import { InvestigationSummaryStatus as Status } from '../../../main/typescript/openapi/openApiTypes.js';

describe('Investigation transcript traversal', () => {
  it('advances by sequence across gaps and exports only the explicit bound', async () => {
    const cursors: number[] = [];
    const client = {
      getInvestigation: async () => ({ status: Status.COMPLETED }),
      getInvestigationTurns: async (_id: string, cursor: number) => {
        cursors.push(cursor);
        return cursor < 0 ? { turns: [{ seq: 0 }, { seq: 3 }], hasMore: true }
          : { turns: [{ seq: 3 }, { seq: 9 }, { seq: 11 }], hasMore: true };
      }
    };
    const result = await captureTranscript(client, 'run', { maxTurns: 3, timeoutMs: 1000 });
    expect(cursors).toEqual([-1, 3]);
    expect(result.turns.map(turn => turn.seq)).toEqual([0, 3, 9]);
    expect(result.coverage).toMatchObject({ lastSeq: 9, turnCount: 3, limitReached: true, hasMore: true, reason: 'limit' });
  });

  it('retains the cursor on an empty page and rejects nonprogressing pages', async () => {
    expect(await readTurnsPage({ getInvestigationTurns: async () => ({ turns: [], hasMore: false }) }, 'run', 9, 5))
      .toEqual({ investigationId: 'run', turns: [], hasMore: false, nextAfterSeq: 9 });
    await expect(readTurnsPage({ getInvestigationTurns: async () => ({ turns: [{ seq: 9 }], hasMore: true }) }, 'run', 9, 5)).rejects.toThrow('advance');
  });

  it('preserves captured data when a subsequent request hangs past its deadline', async () => {
    const client = {
      getInvestigation: async () => ({ status: Status.RUNNING }),
      getInvestigationTurns: async (_id: string, cursor: number) => cursor < 0
        ? { turns: [{ seq: 2 }], hasMore: true } : new Promise<never>(() => {})
    };
    const result = await captureTranscript(client, 'run', { all: true, timeoutMs: 20 });
    expect(result.turns).toEqual([{ seq: 2 }]);
    expect(result.coverage).toMatchObject({ lastSeq: 2, reason: 'timeout' });
  });

  it('propagates permanent errors instead of claiming an empty transcript', async () => {
    const client = {
      getInvestigation: async () => ({ status: Status.COMPLETED }),
      getInvestigationTurns: async () => { throw new ApiError('Forbidden', 403); }
    };
    await expect(captureTranscript(client, 'run', { timeoutMs: 1000 })).rejects.toThrow('Forbidden');
  });

  it('drains all pages, retries transient failures, and never duplicates evidence', async () => {
    let calls = 0;
    const client = {
      getInvestigation: async () => ({ status: Status.COMPLETED }),
      getInvestigationTurns: async (_id: string, cursor: number) => {
        if (calls++ === 0) throw new ApiError('busy', 503, 0);
        return cursor < 0 ? { turns: [{ seq: 1 }], hasMore: true }
          : { turns: [{ seq: 1 }, { seq: 5 }], hasMore: false };
      }
    };
    const result = await captureTranscript(client, 'run', { all: true, timeoutMs: 1000 });
    expect(result.turns.map(turn => turn.seq)).toEqual([1, 5]);
    expect(result.coverage).toMatchObject({ hasMore: false, limitReached: false, reason: 'caught-up' });
  });

  it.each([
    [Status.STOPPED, undefined, 'paused'],
    [Status.STOPPED, '2026-09-09T00:00:00Z', 'terminal'],
    [Status.FAILED, '2026-09-09T00:00:00Z', 'terminal'],
  ])('follows %s with endedAt %s to %s after draining final turns', async (status, endedAt, reason) => {
    const events = [];
    const cursors: number[] = [];
    const client = {
      getInvestigation: async () => ({ status, endedAt }),
      getInvestigationTurns: async (_id: string, cursor: number) => {
        cursors.push(cursor);
        return cursor < 0 ? { turns: [{ seq: 7 }], hasMore: true } : { turns: [{ seq: 12 }], hasMore: false };
      }
    };
    for await (const event of followInvestigation(client, 'run', { timeoutMs: 1000 })) events.push(event);
    expect(cursors).toEqual([-1, 7]);
    expect(events.filter(event => event.type === 'turn').map(event => event.turn.seq)).toEqual([7, 12]);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason, nextAfterSeq: 12 });
  });

  it('does not treat a queued run with no turns as finished', async () => {
    const events = [];
    const client = {
      getInvestigation: async () => ({ status: Status.QUEUED }),
      getInvestigationTurns: async () => ({ turns: [], hasMore: false })
    };
    for await (const event of followInvestigation(client, 'run', { timeoutMs: 20 })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'timeout', nextAfterSeq: -1 });
  });

  it('interrupts a local follower and emits its last cursor', async () => {
    const controller = new AbortController();
    const events = [];
    const client = {
      getInvestigation: async () => ({ status: Status.RUNNING }),
      getInvestigationTurns: async () => ({ turns: [{ seq: 6 }], hasMore: false })
    };
    for await (const event of followInvestigation(client, 'run', { timeoutMs: 1000, signal: controller.signal })) {
      events.push(event);
      if (event.type === 'turn') controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'interrupted', nextAfterSeq: 6 });
  });
});


describe('Investigation retry regressions', () => {
  const metadata = async () => ({ status: Status.COMPLETED });
  it('rejects a null turn immediately instead of retrying until timeout', async () => {
    let calls = 0;
    const client = { getInvestigation: metadata, getInvestigationTurns: async () => {
      calls++; return { turns: [null] as unknown as { seq: number }[], hasMore: false };
    } };
    await expect(captureTranscript(client, 'run', { timeoutMs: 40 })).rejects.toThrow('Invalid turn');
    expect(calls).toBe(1);
  });
  it('does not retry programming TypeErrors', async () => {
    let calls = 0;
    const client = { getInvestigation: metadata, getInvestigationTurns: async () => {
      calls++; throw new TypeError('bad implementation');
    } };
    await expect(captureTranscript(client, 'run', { timeoutMs: 40 })).rejects.toThrow('bad implementation');
    expect(calls).toBe(1);
  });
  it.each([0, -1000])('floors Retry-After %s at the backoff and retains the failure', async retryAfter => {
    let calls = 0;
    const client = { getInvestigation: metadata, getInvestigationTurns: async () => {
      calls++; throw new ApiError('journal unavailable', 503, retryAfter);
    } };
    const result = await captureTranscript(client, 'run', { timeoutMs: 80 });
    expect(calls).toBe(1);
    expect(result.coverage).toMatchObject({ reason: 'timeout', lastError: { message: 'journal unavailable', status: 503 } });
  });
  it('cuts a long Retry-After sleep at the deadline and includes the network cause in follow', async () => {
    const client = { getInvestigation: metadata, getInvestigationTurns: async () => {
      throw new ApiError('rate limited', 429, 60000);
    } };
    const result = await captureTranscript(client, 'run', { timeoutMs: 30 });
    expect(result.coverage).toMatchObject({ reason: 'timeout', lastError: { status: 429 } });
    const events = [];
    for await (const event of followInvestigation({ getInvestigation: metadata,
      getInvestigationTurns: async () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') }); }
    }, 'run', { timeoutMs: 30 })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: 'end', reason: 'timeout', lastError: { message: 'fetch failed: connect ECONNREFUSED' } });
  });
  it('keeps a complete export without making a second metadata request that can fail', async () => {
    let calls = 0;
    const result = await captureTranscript({ getInvestigation: async () => {
      if (calls++ > 0) throw new ApiError('deleted', 404);
      return { status: Status.COMPLETED };
    }, getInvestigationTurns: async () => ({ turns: [{ seq: 1 }], hasMore: false }) }, 'run', { timeoutMs: 100 });
    expect(result.turns).toEqual([{ seq: 1 }]);
    expect(result.coverage.reason).toBe('caught-up');
    expect(calls).toBe(1);
  });
});
