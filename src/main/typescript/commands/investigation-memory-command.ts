import type { Command } from 'commander';
import type { ICommand } from '../lib/command-registry.js';
import type { MergeConfiguration } from '../types.js';
import { createApiClient } from '../lib/api-client-factory.js';
import { enumOption, integerOption, readAction, readCommand, writeReadOutput,
  type ReadOutputOptions } from '../lib/investigation-output.js';
import { parseIsoTimestamp } from '../lib/time-utils.js';
import type { SchemaMemoryDetail, SchemaMemorySearchRequest } from '../openapi/openApiTypes.js';

/**
 * The type generator names a shared enum after the first property that references it and
 * merges enums holding the same value set, so a generated enum's name moves whenever an
 * unrelated schema grows those same values. Bind to the request schema's own fields and
 * spell the values out here: `satisfies` fails the build if the server removes or renames one,
 * though not if it adds one.
 */
type Mode = NonNullable<SchemaMemorySearchRequest['mode']>;
type Significance = NonNullable<SchemaMemorySearchRequest['significances']>[number];
type Verbosity = NonNullable<SchemaMemorySearchRequest['verbosity']>;

const MODES = ['SEMANTIC', 'TEXT', 'TIMELINE'] as const satisfies readonly `${Mode}`[];
const SIGNIFICANCES = ['INCIDENT', 'OBSERVATION', 'INCONCLUSIVE', 'BENIGN'] as const satisfies readonly `${Significance}`[];
const VERBOSITIES = ['COMPACT', 'FULL'] as const satisfies readonly `${Verbosity}`[];

interface MemoryOptions extends ReadOutputOptions {
  mode: Mode;
  query?: string;
  agentId?: string;
  entityTag?: string[];
  significance?: Significance[];
  recordedAfter?: string;
  limit?: number;
  verbosity?: Verbosity;
  includeVocabulary?: boolean;
}

/**
 * How many investigations are linked to the memory, then each one the detail carries with when it
 * was linked, oldest first. The detail lists only the most recent links, so the rest are counted.
 */
function linkedInvestigations(detail: SchemaMemoryDetail): string {
  const total = detail.linkCount ?? 0;
  const links = detail.recurrences ?? [];
  const unlisted = total - links.length;
  return [`${total} investigations linked to this memory as recurrences${links.length > 0 ? ':' : '.'}`,
    ...(unlisted > 0 ? [`${unlisted} earlier links not listed.`] : []),
    ...links.map(link => `${link.investigationId ?? ''} linked ${link.linkedAt ?? ''}`)].join('\n');
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
  if (options.mode === 'TIMELINE') {
    if (Object.keys(entityTags).length === 0) throw new Error('timeline requires --entity-tag');
    if (options.query !== undefined) throw new Error('timeline uses entity tags, not --query');
  } else if (!options.query?.trim()) throw new Error('text and semantic search require --query');
  if (options.agentId !== undefined && !options.agentId.trim()) throw new Error('--agent-id must not be blank');
  if (options.mode === 'SEMANTIC' && !options.agentId) {
    throw new Error('semantic search requires --agent-id for a direct CLI caller');
  }
  return { mode: options.mode, query: options.query, agentId: options.agentId,
    entityTags, limit: options.limit,
    verbosity: options.verbosity, includeVocabulary: options.includeVocabulary,
    significances: options.significance ?? [],
    recordedAfter: options.recordedAfter ? parseIsoTimestamp(options.recordedAfter, '--recorded-after').toISOString() : undefined };
}

export class InvestigationMemoryCommand implements ICommand {
  addToProgram(program: Command, merge: MergeConfiguration): void {
    this.addSearch(program, merge);
    this.addGet(program, merge);
  }

  private addGet(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:memory:get <memoryId>',
      'Read one recorded memory in full by its id, with the investigations linked to it as recurrences');
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<ReadOutputOptions>() };
      const detail = await createApiClient(options).getInvestigationMemory(command.args[0] ?? '');
      await writeReadOutput(detail, options, detail.memory ? [detail.memory] : [], linkedInvestigations(detail));
    });
  }

  private addSearch(program: Command, merge: MergeConfiguration): void {
    const command = readCommand(program, 'investigation:memory:search', 'Search recorded investigation memories, not full transcripts')
      .requiredOption('--mode <mode>', 'Search mode: text, semantic or timeline', value => enumOption(MODES, value))
      .option('--query <text>', 'Symptom or full-text query (required for text/semantic)')
      .option('--agent-id <id>', 'Restrict to an agent (required for semantic)')
      .option('--entity-tag <key=value>', 'Filter by entity tag; repeat for multiple tags', (value: string, previous: string[]) => [...previous, value], [])
      .option('--significance <significance>', 'Return only this significance (INCIDENT, OBSERVATION, INCONCLUSIVE or BENIGN); repeat to keep several, omit for all',
        (value: string, previous: `${Significance}`[]) => [...previous, enumOption(SIGNIFICANCES, value)], [])
      .option('--recorded-after <timestamp>', 'Only memories recorded on/after an RFC3339 timestamp')
      .option('--limit <number>', 'Maximum memories (1–50; omit for the server default; results are not exhaustive)', integerOption(1, 50))
      .option('--verbosity <verbosity>', 'compact omits the narrative fields; full returns them; omit for the server default', value => enumOption(VERBOSITIES, value))
      .option('--include-vocabulary', 'Also return the organization\'s entity tag vocabulary');
    readAction(command, merge, async global => {
      const options = { ...global, ...command.opts<MemoryOptions>() };
      const request = requestFor(options);
      const result = await createApiClient(options).searchInvestigationMemory(request);
      await writeReadOutput(result, options, result.results ?? [],
        [result.preamble, result.note, result.semanticSearchUnavailable ? 'Semantic search unavailable.' : undefined,
          result.hasMore ? 'More memories may match than --limit returned; raise it or narrow the filters.' : undefined]
          .filter(Boolean).join('\n'));
    });
  }
}
