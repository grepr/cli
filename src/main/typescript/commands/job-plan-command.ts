/**
 * Build a plan for a patch.
 *
 * Writes plan JSON by default; `--dry-run` prints only the human diff.
 */
import { Command } from 'commander';
import fs from 'fs-extra';
import { ICommand } from '@/lib/command-registry';
import { MergeConfiguration, JobPlanCommandOptions } from '@/types';
import { createApiClient } from '@/lib/api-client-factory.js';
import { parsePatch } from '@/lib/job-patch.js';
import { generatePlan, renderDiffHuman } from '@/lib/job-plan.js';

export class JobPlanCommand implements ICommand {
  addToProgram(program: Command, mergeConfiguration: MergeConfiguration): void {
    program
      .command('job:plan')
      .description('Build a plan describing pipeline changes (no production write)')
      .requiredOption('--job-id <id>', 'ID of the job to evaluate')
      .requiredOption('--patch <file>', 'Patch file (JSON) describing the changes')
      .option('--dry-run', 'Print a human-readable diff and write nothing')
      .option('--no-color', 'Disable colored output (with --dry-run)')
      .action(async (options: JobPlanCommandOptions, command: Command) => {
        try {
          const merged = { ...command.parent?.opts(), ...options } as Record<string, string | boolean | number | string[]>;
          const cliOptions = await mergeConfiguration(merged);
          const jobId = options.jobId as string;
          const patchFile = options.patch as string;

          const patchRaw = await fs.readJson(patchFile);
          const patch = parsePatch(patchRaw);

          const apiClient = createApiClient(cliOptions);
          const plan = await generatePlan(apiClient, jobId, patch);

          if (options.dryRun) {
            const useColor = options.color !== false;
            console.log(renderDiffHuman(plan.diff, useColor));
            if (!cliOptions.quiet) {
              console.log(`\n(${plan.diff.length} change(s) against version ${plan.baseVersion})`);
            }
            return;
          }

          const json = JSON.stringify(plan, null, 2);
          const outputPath = cliOptions.output;
          if (outputPath) {
            await fs.writeFile(outputPath, json);
            if (!cliOptions.quiet) {
              console.log(`Plan written to ${outputPath} (${plan.diff.length} change(s))`);
            }
          } else {
            console.log(json);
          }
        } catch (error) {
          console.error('Error generating pipeline plan:', (error as Error).message);
          process.exit(1);
        }
      });
  }
}
