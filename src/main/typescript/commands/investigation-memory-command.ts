import type { Command } from 'commander';
import type { ICommand } from '../lib/command-registry.js';
import type { MergeConfiguration } from '../types.js';
import { createApiClient } from '../lib/api-client-factory.js';
import { enumOption, integerOption, readAction, readCommand, writeReadOutput,
  type ReadOutputOptions } from '../lib/investigation-output.js';
import { parseIsoTimestamp } from '../lib/time-utils.js';
import { MemorySearchRequestMode as Mode, MemorySearchRequestSignificance as Significance,
  type SchemaMemorySearchRequest } from '../openapi/openApiTypes.js';

interface MemoryOptions extends ReadOutputOptions {
  mode: Mode;
  query?: string;
  agentId?: string;
  entityTag?: string[];
  significance?: Significance;
  recordedAfter?: string;
  limit: number;
}

function requestFor(options: MemoryOptions): SchemaMemorySearchRequest {
  const entityTags: Record<string, string> = {};
  for (const tag of options.entityTag ?? []) {
    const separator = tag.indexOf('=');
    const key = tag.slice(0, separator).trim();
    const value = tag.slice(separator + 1).trim();
    if (separator <= 0 || !key || !value) throw new Error('--entity-tag must be key=value');
    if (Object.hasOwn(entityTags, key)) throw new Error(`Duplicate entity tag: ${key}`);
    Object.defineProperty(entityTags, key, { value, enumerable: true });
  }
  if (options.mode === Mode.TIMELINE) {
    if (Object.keys(entityTags).length === 0) throw new Error('timeline requires --entity-tag');
    if (options.query !== undefined) throw new Error('timeline uses entity tags, not --query');
  } else if (!options.query?.trim()) throw new Error('text and semantic search require --query');
  if (options.agentId !== undefined && !options.agentId.trim()) throw new Error('--agent-id must not be blank');
  if (options.mode === Mode.SEMANTIC) {
    if (!options.agentId) throw new Error('semantic search requires --agent-id for a direct CLI caller');
    if (Object.keys(entityTags).some(key => !key.startsWith('entity:'))) {
      throw new Error('semantic search accepts only entity:-prefixed tags');
    }
  }
  if (options.significance === Significance.BENIGN && options.mode !== Mode.TIMELINE) {
    throw new Error('BENIGN is supported only in timeline mode');
  }
  return { mode: options.mode, query: options.query, agentId: options.agentId,
    entityTags, significance: options.significance, limit: options.limit,
    recordedAfter: options.recordedAfter ? parseIsoTimestamp(options.recordedAfter, '--recorded-after').toISOString() : undefined };
}

export class InvestigationMemoryCommand implements ICommand {
  addToProgram(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:memory:search', 'Search recorded investigation memories, not full transcripts')
      .requiredOption('--mode <mode>', 'Search mode: text, semantic or timeline', value => enumOption(Object.values(Mode), value))
      .option('--query <text>', 'Symptom or full-text query (required for text/semantic)')
      .option('--agent-id <id>', 'Restrict to an agent (required for semantic)')
      .option('--entity-tag <key=value>', 'Filter by entity tag; repeat for multiple tags', (value: string, previous: string[]) => [...previous, value], [])
      .option('--significance <significance>', 'INCIDENT, OBSERVATION, INCONCLUSIVE or BENIGN (timeline only)', value => enumOption(Object.values(Significance), value))
      .option('--recorded-after <timestamp>', 'Only memories recorded on/after an RFC3339 timestamp')
      .option('--limit <number>', 'Maximum memories (1–50; results are not exhaustive)', integerOption(1, 50), 10);
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<MemoryOptions>() };
      const request = requestFor(options);
      const result = await createApiClient(options).searchInvestigationMemory(request);
      await writeReadOutput(result, options, result.results ?? [],
        [result.preamble, result.note, result.semanticSearchUnavailable ? 'Semantic search unavailable.' : undefined].filter(Boolean).join('\n'));
    });
  }
}
