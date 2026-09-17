import { Command, InvalidArgumentError, Option } from 'commander';
import { open, writeFile } from 'node:fs/promises';
import type { CliOptions, CommandOptionsRecord, MergeConfiguration } from '../types.js';
import { JsonFormatter } from './json-formatter.js';
import { readErrorMessage } from './read-error.js';
import { logHumanFooter, type OutputFormat } from './output-format.js';

export interface ReadOutputOptions {
  format: OutputFormat;
  output?: string;
  quiet?: boolean;
}

export function readCommand(program: Command, name: string, description: string,
  format: OutputFormat = 'pretty'): Command {
  return program.command(name).description(description)
    .addOption(new Option('-f, --format <format>', 'Output format; pretty/raw/compact preserve the full JSON response')
      .choices(['table', 'pretty', 'raw', 'compact', 'csv']).default(format));
}

export function readAction(command: Command, merge: MergeConfiguration,
  action: (options: CliOptions) => Promise<void>): void {
  command.action(async () => {
    let options: CliOptions | undefined;
    try {
      const globalOptions = command.parent?.opts<CommandOptionsRecord>() ?? {};
      options = await merge(globalOptions);
      await action(options);
    } catch (error) {
      console.error(`Error executing ${command.name()}: ${readErrorMessage(error)}`);
      if (options?.debug && error instanceof Error) console.error(error.stack);
      process.exitCode = 1;
    }
  });
}

export function integerOption(min: number, max: number): (value: string) => number {
  return value => {
    if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
      throw new InvalidArgumentError(`Expected an integer between ${min} and ${max}`);
    }
    return Number(value);
  };
}

export function timeoutOption(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value);
  const multiplier = match?.[2] === 'ms' ? 1 : match?.[2] === 's' ? 1000 : match?.[2] === 'm' ? 60_000 : 3_600_000;
  const ms = match ? Number(match[1]) * multiplier : NaN;
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > 2_147_483_647) {
    throw new InvalidArgumentError('Expected a positive timeout such as 60s or 5m (maximum 2147483647ms)');
  }
  return ms;
}

export function enumOption<T extends string>(values: readonly T[], value: string): T {
  const found = values.find(candidate => candidate === value.toUpperCase());
  if (found === undefined) throw new InvalidArgumentError(`Expected one of ${values.join(', ')}`);
  return found;
}

/** Human summaries may be small; machine output always retains the original envelope. */
export async function writeReadOutput(value: object, options: ReadOutputOptions,
  rows?: Record<string, unknown>[], footer?: string): Promise<void> {
  let text: string;
  if (options.format === 'raw' || options.format === 'compact') text = JSON.stringify(value);
  else if (options.format === 'pretty') text = JSON.stringify(value, null, 2);
  else {
    const formatter = new JsonFormatter({ format: options.format, colorize: false, maxDepth: 1, maxLines: 4 });
    text = rows?.length === 0 ? (options.format === 'csv' ? '' : 'No results.')
      : formatter.formatObjects(rows ?? [{ ...value }]);
  }
  if (options.output) await writeFile(options.output, `${text}\n`);
  else console.log(text);
  // These read commands preserve a single JSON value even in pretty format.
  if (footer && !options.quiet) logHumanFooter(options.format === 'pretty' ? 'raw' : options.format, footer);
}

/** Sequential writes honor stdout/file backpressure and keep each stream event intact. */
export async function writeReadStream(values: AsyncIterable<object>, options: ReadOutputOptions): Promise<void> {
  const file = options.output ? await open(options.output, 'w') : undefined;
  try {
    for await (const value of values) {
      const text = JSON.stringify(value, null, options.format === 'pretty' ? 2 : undefined) + '\n';
      if (file) await file.writeFile(text);
      else {
        try {
          await new Promise<void>((resolve, reject) => {
            const onError = (error: Error): void => reject(error);
            process.stdout.once('error', onError);
            try {
              process.stdout.write(text, error => {
                // Failed writes emit 'error' after this callback; let that listener reject.
                if (!error) {
                  process.stdout.removeListener('error', onError);
                  resolve();
                }
              });
            } catch (error) {
              process.stdout.removeListener('error', onError);
              reject(error);
            }
          });
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'EPIPE') return;
          throw error;
        }
      }
    }
  } finally {
    await file?.close();
  }
}
