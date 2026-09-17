import { readErrorMessage } from './read-error.js';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiError, type GreprApiClient } from './grepr-api-client.js';
import { InvestigationSummaryStatus as Status, type SchemaInvestigationTranscript,
  type SchemaTranscriptTurn } from '../openapi/openApiTypes.js';

type InvestigationReader = Pick<GreprApiClient, 'getInvestigation' | 'getInvestigationTurns'>;
type TurnsReader = Pick<InvestigationReader, 'getInvestigationTurns'>;

export interface TurnsPage {
  investigationId: string;
  turns: SchemaTranscriptTurn[];
  hasMore: boolean;
  nextAfterSeq: number;
}

/** Validate the cursor contract instead of silently treating a malformed response as empty. */
export async function readTurnsPage(client: TurnsReader, investigationId: string, afterSeq: number,
  pageSize: number, signal?: AbortSignal): Promise<TurnsPage> {
  const page = await client.getInvestigationTurns(investigationId, afterSeq, pageSize, signal);
  if (!page || !Array.isArray(page.turns) || typeof page.hasMore !== 'boolean') {
    throw new Error('Invalid turns response: expected turns and hasMore');
  }
  const bySeq = new Map<number, SchemaTranscriptTurn>();
  for (const turn of page.turns) {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn) || turn.seq === undefined || !Number.isInteger(turn.seq) || turn.seq < 0) {
      throw new Error('Invalid turn sequence');
    }
    if (turn.seq > afterSeq) bySeq.set(turn.seq, turn);
  }
  const sequences = [...bySeq.keys()].sort((a, b) => a - b);
  const nextAfterSeq = sequences.at(-1) ?? afterSeq;
  if (page.hasMore && nextAfterSeq === afterSeq) {
    throw new Error('Turns response did not advance the cursor despite hasMore');
  }
  const turns = [...bySeq.entries()].sort(([a], [b]) => a - b).map(([, turn]) => turn);
  return { investigationId, turns, hasMore: page.hasMore, nextAfterSeq };
}

export interface ReadFailure { message: string; status?: number }

interface ReadOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** One deadline includes auth, requests, retries and polling sleeps. */
export class ReadDeadline {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  reason: 'timeout' | 'interrupted' | undefined;
  lastError: ReadFailure | undefined;
  private readonly interrupt = (): void => this.stop('interrupted');

  constructor(private readonly options: ReadOptions) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) {
      throw new Error('Timeout must be a positive duration of at most 2147483647ms');
    }
    this.timer = setTimeout(() => this.stop('timeout'), options.timeoutMs);
    options.signal?.addEventListener('abort', this.interrupt, { once: true });
    if (options.signal?.aborted) this.interrupt();
  }

  private stop(reason: 'timeout' | 'interrupted'): void {
    if (this.reason) return;
    this.reason = reason;
    this.controller.abort();
  }

  close(): void {
    clearTimeout(this.timer);
    this.options.signal?.removeEventListener('abort', this.interrupt);
  }

  async sleep(ms: number): Promise<void> {
    await delay(ms, undefined, { signal: this.controller.signal });
  }

  async read<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.controller.signal.throwIfAborted();
      try {
        const value = await this.readOnce(read);
        this.lastError = undefined;
        return value;
      } catch (error) {
        if (this.reason) throw error;
        const retryable = error instanceof ApiError
          ? error.status === 429 || (error.status !== undefined && error.status >= 500)
          : error instanceof TypeError && error.message === 'fetch failed' && error.cause !== undefined;
        if (!retryable) throw error;
        this.lastError = { message: readErrorMessage(error), ...(error instanceof ApiError ? { status: error.status } : {}) };
        const backoff = Math.min(250 * 2 ** Math.min(attempt, 3), 2000);
        await this.sleep(Math.max(backoff, error instanceof ApiError ? error.retryAfterMs ?? 0 : 0));
      }
    }
  }

  /** Run a single request within the deadline, without retrying failures. */
  async readOnce<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    signal.throwIfAborted();
    let abort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = (): void => reject(new Error(this.reason ?? 'Read aborted'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      return await Promise.race([read(signal), cancelled]);
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
    }
  }
}

interface CaptureOptions extends ReadOptions {
  maxTurns?: number;
  all?: boolean;
}

export interface TranscriptCapture {
  investigation: SchemaInvestigationTranscript | null;
  investigationId: string;
  turns: SchemaTranscriptTurn[];
  coverage: {
    afterSeq: number;
    lastSeq: number;
    turnCount: number;
    hasMore: boolean | null;
    limitReached: boolean;
    reason: 'caught-up' | 'limit' | 'timeout' | 'interrupted';
    startedAt: string;
    capturedAt: string;
    lastError?: ReadFailure;
  };
}

/** Captures available history with an explicit bound; never claims an atomic final snapshot. */
export async function captureTranscript(client: InvestigationReader, investigationId: string,
  options: CaptureOptions): Promise<TranscriptCapture> {
  if (options.all && options.maxTurns !== undefined) throw new Error('--all and --max-turns are mutually exclusive');
  const limit = options.all ? Infinity : options.maxTurns ?? 50;
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit <= 0)) throw new Error('maxTurns must be positive');
  const deadline = new ReadDeadline(options);
  const result: TranscriptCapture = {
    investigationId, investigation: null, turns: [],
    coverage: { afterSeq: -1, lastSeq: -1, turnCount: 0, hasMore: null, limitReached: false,
      reason: 'caught-up', startedAt: new Date().toISOString(), capturedAt: '' }
  };
  try {
    result.investigation = await deadline.read(signal => client.getInvestigation(investigationId, signal));
    do {
      const page = await deadline.read(signal => readTurnsPage(client, investigationId,
        result.coverage.lastSeq, Math.min(100, limit - result.turns.length), signal));
      const kept = page.turns.slice(0, limit - result.turns.length);
      result.turns.push(...kept);
      result.coverage.lastSeq = kept.at(-1)?.seq ?? result.coverage.lastSeq;
      result.coverage.hasMore = page.hasMore || kept.length < page.turns.length;
      if (result.turns.length >= limit && result.coverage.hasMore) {
        result.coverage.limitReached = true;
        result.coverage.reason = 'limit';
        break;
      }
    } while (result.coverage.hasMore);
  } catch (error) {
    if (!deadline.reason) throw error;
    result.coverage.reason = deadline.reason;
    if (deadline.lastError) result.coverage.lastError = deadline.lastError;
  } finally {
    deadline.close();
    result.coverage.turnCount = result.turns.length;
    result.coverage.capturedAt = new Date().toISOString();
  }
  return result;
}

export type InvestigationEvent =
  | { type: 'status'; investigationId: string; investigation: SchemaInvestigationTranscript }
  | { type: 'turn'; investigationId: string; turn: SchemaTranscriptTurn }
  | { type: 'end'; investigationId: string; nextAfterSeq: number; reason: 'paused' | 'terminal' | 'timeout' | 'interrupted'; lastError?: ReadFailure };

function endReason(metadata: SchemaInvestigationTranscript): 'paused' | 'terminal' | undefined {
  if (metadata.status === Status.STOPPED) return metadata.endedAt ? 'terminal' : 'paused';
  if (metadata.status && [Status.COMPLETED, Status.FAILED, Status.CANCELLED, Status.DISCARDED].includes(metadata.status)) {
    return 'terminal';
  }
  return undefined;
}

/** Follow is a local reader. Cancelling iteration or its signal never controls the investigation. */
export async function* followInvestigation(client: InvestigationReader, investigationId: string,
  options: ReadOptions & { afterSeq?: number; pageSize?: number }): AsyncGenerator<InvestigationEvent> {
  const deadline = new ReadDeadline(options);
  let cursor = options.afterSeq ?? -1;
  let lastStatus: string | undefined;
  try {
    for (;;) {
      const metadata = await deadline.read(signal => client.getInvestigation(investigationId, signal));
      const status = JSON.stringify([metadata.status, metadata.endedAt]);
      if (status !== lastStatus) {
        yield { type: 'status', investigationId, investigation: metadata };
        lastStatus = status;
      }
      // Read after status: even a terminal transition gets a final journal drain.
      const page = await deadline.read(signal => readTurnsPage(client, investigationId,
        cursor, options.pageSize ?? 50, signal));
      for (const turn of page.turns) {
        cursor = turn.seq ?? cursor;
        yield { type: 'turn', investigationId, turn };
      }
      if (page.hasMore) continue;
      const reason = endReason(metadata);
      if (reason) {
        yield { type: 'end', investigationId, nextAfterSeq: cursor, reason };
        return;
      }
      await deadline.sleep(2000);
    }
  } catch (error) {
    if (!deadline.reason) throw error;
    yield { type: 'end', investigationId, nextAfterSeq: cursor, reason: deadline.reason, ...(deadline.lastError ? { lastError: deadline.lastError } : {}) };
  } finally {
    deadline.close();
  }
}
