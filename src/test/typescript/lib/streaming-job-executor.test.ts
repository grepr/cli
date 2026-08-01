import { describe, expect, it, vi } from 'bun:test';
import { Writable } from 'stream';
import { StreamingJobExecutor } from '../../../../src/main/typescript/lib/streaming-job-executor.js';

const settle = (): Promise<void> => new Promise<void>(resolve => setImmediate(resolve));

describe('StreamingJobExecutor', () => {
  it('test_streamCompletion_waitsForOutputFileFlushBeforeExit', async () => {
    let flushedOutput = '';
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        setTimeout(() => {
          flushedOutput += chunk.toString();
          callback();
        }, 10);
      }
    });
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const executor = new StreamingJobExecutor();
    executor['outputFileStream'] = outputStream;
    outputStream.write('complete output');

    try {
      const completion = executor['handleJobCompletion']('FINISHED');

      expect(flushedOutput).toBe('');
      expect(processExitSpy).not.toHaveBeenCalled();

      await expect(completion).rejects.toThrow('process.exit called');

      expect(flushedOutput).toBe('complete output');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    } finally {
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  it('test_streamCompletion_waitsForStdoutDrainBeforeExit', async () => {
    const pendingWrites: ((error?: Error | null) => void)[] = [];
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((
      _chunk: Uint8Array | string,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean => {
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      if (done) {
        pendingWrites.push(done);
      }
      return true;
    });
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const executor = new StreamingJobExecutor();

    try {
      const completion = executor['handleJobCompletion']('FINISHED');
      await settle();

      // Piped stdout has not acknowledged the queued writes yet, so exiting here
      // would truncate whatever the consumer has not read.
      expect(pendingWrites.length).toBeGreaterThan(0);
      expect(processExitSpy).not.toHaveBeenCalled();

      pendingWrites.forEach(done => done());

      await expect(completion).rejects.toThrow('process.exit called');
      expect(processExitSpy).toHaveBeenCalledWith(0);
    } finally {
      stdoutWriteSpy.mockRestore();
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
    }
  });

  it('test_outputFileError_shouldFailJobInsteadOfRaisingUnhandledStreamError', async () => {
    // Completion runs to the end here, so exit is recorded rather than thrown.
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const executor = new StreamingJobExecutor();

    try {
      // A directory can never be opened for writing, so the stream fails right
      // after creation - long before the job would normally complete.
      const outputFileStream = executor['createOutputFileStream']('.');
      executor['outputFileStream'] = outputFileStream;

      // The executor's listener is registered first, so it has already recorded
      // the failure and started completing the job by the time this resolves.
      await new Promise<void>(resolve => outputFileStream.once('error', () => resolve()));
      await settle();
      await settle();

      expect(executor['outputFileError']).toBeInstanceOf(Error);
      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(executor['stats'].errorMessages.join('\n')).toContain('Failed to write output file');
      expect(executor['outputFileStream']).toBeNull();
    } finally {
      processExitSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('test_outputFileError_shouldNotRedirectRecordsToStdout', () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const executor = new StreamingJobExecutor();

    try {
      executor['outputFileStream'] = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        }
      });
      executor['outputFileError'] = new Error('EISDIR: illegal operation on a directory');

      executor['writeOutput']('a record that cannot be written');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
