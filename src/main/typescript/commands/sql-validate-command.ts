import { Command } from 'commander';
import { ICommand } from '@/lib/command-registry';
import { MergeConfiguration } from '@/types';
import { createApiClient } from '@/lib/api-client-factory.js';

export class SqlValidateCommand implements ICommand {
  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command('sql:validate <sql>')
      .description('Validate a Flink SQL query against the server')
      .action(async (sql: string, _options: Record<string, unknown>, command: Command) => {
        try {
          const merged = { ...command.parent?.opts() } as Record<string, string | boolean | number | string[]>;
          const cliOptions = await mergeConfiguration(merged);
          const apiClient = createApiClient(cliOptions);
          const result = await apiClient.validateSql(sql);
          if (result?.valid) {
            if (!cliOptions.quiet) console.log('SQL is valid.');
          } else {
            console.error(result?.errorMessage ?? 'SQL is invalid.');
            process.exit(1);
          }
        } catch (error) {
          console.error('Error validating SQL:', (error as Error).message);
          process.exit(1);
        }
      });
  }
}
