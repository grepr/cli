import type { Command } from 'commander';
import type { ICommand } from '../lib/command-registry.js';
import type { MergeConfiguration } from '../types.js';
import { createApiClient } from '../lib/api-client-factory.js';
import { readAction, readCommand, writeReadOutput, type ReadOutputOptions } from '../lib/investigation-output.js';

export class AgentCommand implements ICommand {
  addToProgram(program: Command, merge: MergeConfiguration): void {
    const list = readCommand(program, 'agent:list', 'List agent IDs and names in the organization', 'table')
      .option('--details', 'Include current configuration, recent health and subscription counts');
    readAction(list, merge, async global => {
      const options = { ...global, ...list.opts<ReadOutputOptions & { details?: boolean }>() };
      const client = createApiClient(options);
      if (options.details) {
        const agents = await client.listAgents();
        await writeReadOutput(agents, options, agents.map(entry => ({ id: entry.agent?.id,
          name: entry.agent?.name, recentHealth: entry.recentHealth, subscriptionCounts: entry.subscriptionCounts })));
      } else {
        const agents = await client.listAgentRoster();
        await writeReadOutput(agents, options, agents);
      }
    });
    const get = readCommand(program, 'agent:get <agent-id>', 'Get current agent configuration and aggregate investigation metrics');
    readAction(get, merge, async global => {
      const options = { ...global, ...get.opts<ReadOutputOptions>() };
      await writeReadOutput(await createApiClient(options).getAgent(get.args[0] ?? ''), options);
    });
  }
}
