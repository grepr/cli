/**
 * Test preload that fills the gaps between Vitest's `vi` API (which the test
 * suite was written against) and the `vi` compatibility layer bun:test ships.
 *
 * bun:test natively exposes `vi.fn`, `vi.spyOn`, `vi.mock`, `vi.clearAllMocks`,
 * `vi.useFakeTimers`, and `vi.useRealTimers`, but it does NOT expose
 * `vi.mocked`, `vi.setSystemTime`, or the async timer advancers. The sync
 * equivalents live on bun's `jest` object, so we bridge them onto `vi` here.
 *
 * Wired in via `bunfig.toml` (`[test] preload`).
 */
import { vi, jest } from 'bun:test'

interface ViExtensions {
  mocked?: <T>(value: T) => T
  setSystemTime?: (time?: number | Date) => void
  advanceTimersByTimeAsync?: (ms: number) => Promise<void>
  runAllTimersAsync?: () => Promise<void>
}

const viExt = vi as unknown as ViExtensions
const jestApi = jest as unknown as {
  setSystemTime: (time?: number | Date) => void
  advanceTimersByTime: (ms: number) => void
  advanceTimersToNextTimer: () => void
  getTimerCount: () => number
}

// Guard against a pathological self-rescheduling timer never letting the
// drain loop terminate.
const MAX_TIMER_DRAIN_ITERATIONS = 100_000

/**
 * Flush the microtask queue so promises awaited between timer callbacks
 * (e.g. a retry loop that `await`s a request before scheduling its next
 * backoff timer) settle and schedule their follow-up timers before we look
 * for more work.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

if (typeof viExt.mocked !== 'function') {
  // Vitest's `vi.mocked` is an identity function at runtime; it only adds types.
  viExt.mocked = <T>(value: T): T => value
}

if (typeof viExt.setSystemTime !== 'function') {
  viExt.setSystemTime = (time?: number | Date): void => {
    jestApi.setSystemTime(time)
  }
}

if (typeof viExt.advanceTimersByTimeAsync !== 'function') {
  // bun only ships the synchronous advancer. Flush microtasks BEFORE
  // advancing so any awaited chain that schedules a timer (e.g. a retry that
  // `await`s the failing request before calling `delay()`) registers that
  // timer at the correct base time, then flush again afterwards so the fired
  // timers' continuations settle.
  viExt.advanceTimersByTimeAsync = async (ms: number): Promise<void> => {
    await flushMicrotasks()
    jestApi.advanceTimersByTime(ms)
    await flushMicrotasks()
  }
}

if (typeof viExt.runAllTimersAsync !== 'function') {
  // Replicate Vitest's behaviour: fire the next timer, let any awaited
  // continuations schedule their follow-up timers, then repeat until the
  // timer queue is empty. A plain synchronous `runAllTimers()` cannot see
  // timers that are only scheduled after an intervening `await`.
  viExt.runAllTimersAsync = async (): Promise<void> => {
    await flushMicrotasks()
    let iterations = 0
    while (jestApi.getTimerCount() > 0) {
      jestApi.advanceTimersToNextTimer()
      await flushMicrotasks()
      if (++iterations >= MAX_TIMER_DRAIN_ITERATIONS) {
        throw new Error('runAllTimersAsync: timer queue did not drain')
      }
    }
  }
}
