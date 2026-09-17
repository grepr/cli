import type { Command } from 'commander';
import type { ICommand } from '../lib/command-registry.js';
import type { MergeConfiguration } from '../types.js';
import { createApiClient } from '../lib/api-client-factory.js';
import { InvestigationSummaryStatus as Status } from '../openapi/openApiTypes.js';
import { captureTranscript, followInvestigation, readTurnsPage, ReadDeadline, type InvestigationEvent } from '../lib/investigation-transcript.js';
import { enumOption, integerOption, timeoutOption, readAction, readCommand, writeReadOutput,
  writeReadStream, type ReadOutputOptions } from '../lib/investigation-output.js';

interface ListOptions extends ReadOutputOptions { agentId: string; page: number; pageSize: number; status?: Status[] }
interface TurnsOptions extends ReadOutputOptions { afterSeq: number; pageSize: number; follow?: boolean; timeout: number }
interface TranscriptOptions extends ReadOutputOptions { all?: boolean; maxTurns?: number; timeout: number }

function setReadExitCode(reason: string): void {
  if (reason === 'timeout') process.exitCode = 2;
  if (reason === 'interrupted') process.exitCode = 130;
}

export class InvestigationCommand implements ICommand {
  addToProgram(program: Command, merge: MergeConfiguration): void {
    this.addList(program, merge);
    const get = readCommand(program, 'investigation:get <id>', 'Read investigation metadata and recorded actions; no journal turns');
    readAction(get, merge, async global => {
      const options = { ...global, ...get.opts<ReadOutputOptions>() };
      await writeReadOutput(await createApiClient(options).getInvestigation(get.args[0] ?? ''), options);
    });
    this.addTurns(program, merge);
    this.addTranscript(program, merge);
  }

  private addList(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:list', 'List one page of an agent’s investigations, newest first', 'table')
      .requiredOption('--agent-id <id>', 'Agent whose investigations to list')
      .option('--status <status>', 'Filter status; repeat to include multiple statuses',
        (value: string, previous: Status[]) => [...previous, enumOption(Object.values(Status), value)], [])
      .option('--page <number>', 'Zero-based page', integerOption(0, 21_474_836), 0)
      .option('--page-size <number>', 'Investigations per page (1–100)', integerOption(1, 100), 25);
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<ListOptions>() };
      if (!options.agentId.trim()) throw new Error('--agent-id must not be blank');
      const result = await createApiClient(options).listInvestigations(options.agentId,
        { page: options.page, pageSize: options.pageSize, statuses: options.status });
      const items = result.investigations?.items ?? [];
      const more = (result.start ?? 0) + items.length < (result.total ?? 0);
      await writeReadOutput(result, options, items.map(item => ({ investigationId: item.investigationId,
        status: item.status, createdAt: item.createdAt, summary: item.summary,
        inputTokens: item.inputTokens, outputTokens: item.outputTokens })),
      `${items.length} returned; total ${result.total ?? 'unknown'}.${more ? ` Next: --page ${options.page + 1}` : ''}`);
    });
  }

  private addTurns(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:turns <id>', 'Read a bounded page of transcript turns using an exclusive sequence cursor')
      .option('--after-seq <number>', 'Only turns after this sequence (-1 starts at the beginning)', integerOption(-1, 2_147_483_647), -1)
      .option('--page-size <number>', 'Turns per request (1–100)', integerOption(1, 100), 50)
      .option('--follow', 'Follow new turns until paused, terminal or timed out; does not control the run')
      .option('--timeout <duration>', 'Read deadline including authentication, e.g. 60s or 5m', timeoutOption, 60_000);
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<TurnsOptions>() };
      if (options.follow && (options.format === 'csv' || options.format === 'table')) {
        throw new Error('--follow supports raw, compact or pretty output');
      }
      const client = createApiClient(options);
      const id = command.args[0] ?? '';
      const controller = new AbortController();
      const interrupt = (): void => controller.abort();
      process.once('SIGINT', interrupt);
      try {
        if (!options.follow) {
          const deadline = new ReadDeadline({ timeoutMs: options.timeout, signal: controller.signal });
          try {
            const page = await deadline.readOnce(signal => readTurnsPage(client, id, options.afterSeq, options.pageSize, signal));
            await writeReadOutput(page, options);
          } catch (error) {
            if (!deadline.reason) throw error;
            setReadExitCode(deadline.reason);
            console.error(`Read ${deadline.reason}`);
          } finally { deadline.close(); }
          return;
        }
        const events = followInvestigation(client, id, { afterSeq: options.afterSeq, pageSize: options.pageSize,
          timeoutMs: options.timeout, signal: controller.signal });
        const withExitCode = async function* (): AsyncGenerator<InvestigationEvent> {
          for await (const event of events) {
            if (event.type === 'end') {
              setReadExitCode(event.reason);
              if (event.lastError) console.error(`Read ${event.reason}: ${event.lastError.message}`);
            }
            yield event;
          }
        };
        await writeReadStream(withExitCode(), options);
      } finally { process.removeListener('SIGINT', interrupt); }
    });
  }

  private addTranscript(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:transcript <id>', 'Export metadata and transcript turns (default 50); use --max-turns or --all to change the bound')
      .option('--max-turns <number>', 'Maximum turns to export (default 50)', integerOption(1, Number.MAX_SAFE_INTEGER))
      .option('--all', 'Drain all available history within the deadline')
      .option('--timeout <duration>', 'Export deadline, e.g. 60s or 5m', timeoutOption, 60_000);
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<TranscriptOptions>() };
      if (options.format === 'table' || options.format === 'csv') throw new Error('Transcript exports support pretty, raw or compact output to preserve coverage');
      if (options.all && options.maxTurns !== undefined) throw new Error('--all and --max-turns are mutually exclusive');
      const controller = new AbortController();
      const interrupt = (): void => controller.abort();
      process.once('SIGINT', interrupt);
      try {
        const result = await captureTranscript(createApiClient(options), command.args[0] ?? '',
          { all: options.all, maxTurns: options.maxTurns, timeoutMs: options.timeout, signal: controller.signal });
        setReadExitCode(result.coverage.reason);
        if (result.coverage.lastError) console.error(`Read ${result.coverage.reason}: ${result.coverage.lastError.message}`);
        await writeReadOutput(result, options);
      } finally { process.removeListener('SIGINT', interrupt); }
    });
  }
}
