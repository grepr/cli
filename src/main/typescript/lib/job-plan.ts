/**
 * Plan file format for pipeline edits: a self-contained record of applying a
 * patch to a job at a version. `baseVersion` is the drift anchor — `job:apply`
 * refuses to write if the live job has moved past it (unless `--force`).
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import { SchemaReadJob, SchemaUpdateJob, SchemaOperation, SchemaLogReducerTemplateInput, SchemaTemplateLogSink } from '@/openapi/openApiTypes';
import {
  applyPatch,
  classifyPatch,
  detectBackend,
  findTemplateOperation,
  parsePatch,
  PatchClassification,
  JobBackend,
  JobPatch,
} from './job-patch.js';
import { GreprApiClient } from './grepr-api-client.js';

// parsePlan rejects any plan file whose schemaVersion doesn't match this.
export const PLAN_SCHEMA_VERSION = 2 as const;

export interface JobPlan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  jobId: string;
  /** Which substrate the patch targets; recorded so `job:draft`/`job:apply` needn't re-detect. */
  backend: JobBackend;
  baseVersion: number;
  fetchedAt: string;
  /** What the patch touches; used to pick the validation path. */
  classification: PatchClassification;
  patch: JobPatch;
  current: SchemaReadJob;
  proposed: SchemaUpdateJob;
  diff: JobDiffEntry[];
}

export interface JobDiffEntry {
  kind: 'add' | 'remove' | 'change';
  /** Human-readable path, e.g. "log_attributes_remapper.messageReservedAttributes". */
  path: string;
  before?: unknown;
  after?: unknown;
  /** One-line description for printing. */
  summary: string;
}

/** Fetch the live job, apply the patch, and produce a plan. */
export async function generatePlan(
  apiClient: GreprApiClient,
  jobId: string,
  patch: JobPatch,
): Promise<JobPlan> {
  // Fetch unresolved: template inputs are only visible in the unresolved view,
  // and job-graph pipelines have nothing to resolve, so `false` works for both.
  const current = await apiClient.getJob(jobId, undefined, false);
  if (!current) {
    throw new Error(`Job not found: ${jobId}`);
  }
  const backend = detectBackend(current);
  const proposed = applyPatch(current, patch);
  const diff = computeDiff(current, proposed);
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    jobId,
    backend,
    baseVersion: current.version,
    fetchedAt: new Date().toISOString(),
    classification: classifyPatch(patch),
    patch,
    current,
    proposed,
    diff,
  };
}

/**
 * Compute a diff between current and proposed configs. Template-backed: diffs at
 * template-input granularity (parsers/sources/sinks/transforms/reducer/exceptions/
 * scalars). Job-graph: diffs per resolved vertex (by name) and per edge.
 */
export function computeDiff(current: SchemaReadJob, proposed: SchemaUpdateJob): JobDiffEntry[] {
  if (detectBackend(current) === 'job-graph') {
    return computeJobGraphDiff(current, proposed);
  }
  const curInput = readTemplateInputFromJob(current);
  const propInput = readTemplateInputFromJob(proposed);
  const entries: JobDiffEntry[] = [];
  diffNamedArray('parsers', curInput.parsers ?? [], propInput.parsers ?? [], entries);
  diffNamedArray('sources', curInput.sources ?? [], propInput.sources ?? [], entries);
  diffSinks(curInput, propInput, entries);
  diffTransforms(curInput, propInput, entries);
  diffNestedObject('reducer', curInput.reducer as unknown as Record<string, unknown>, propInput.reducer as unknown as Record<string, unknown>, entries);
  diffExceptions(curInput, propInput, entries);
  diffTopLevelScalars(curInput, propInput, entries);
  return entries;
}

function computeJobGraphDiff(current: SchemaReadJob, proposed: SchemaUpdateJob): JobDiffEntry[] {
  // Fail loudly on an absent jobGraph rather than letting `?? []` render the whole
  // pipeline as added/removed — a misleading preview the user approves against.
  // (Mirrors the template path, where readTemplateInputFromJob throws on bad input.)
  if (!current.jobGraph) throw new Error('Cannot diff: current job has no jobGraph');
  if (!proposed.jobGraph) throw new Error('Cannot diff: proposed job has no jobGraph');
  const curVertices = current.jobGraph.vertices ?? [];
  const propVertices = proposed.jobGraph.vertices ?? [];
  const curEdges = current.jobGraph.edges ?? [];
  const propEdges = proposed.jobGraph.edges ?? [];
  const entries: JobDiffEntry[] = [];
  diffNamedArray('vertices', curVertices, propVertices, entries);
  diffEdges(curEdges, propEdges, entries);
  return entries;
}

function diffEdges(current: string[], proposed: string[], entries: JobDiffEntry[]): void {
  const cur = new Set(current);
  const prop = new Set(proposed);
  for (const edge of proposed) {
    if (!cur.has(edge)) {
      entries.push({
        kind: 'add',
        path: `edges[${edge}]`,
        after: edge,
        summary: `+ edge ${edge}`,
      });
    }
  }
  for (const edge of current) {
    if (!prop.has(edge)) {
      entries.push({
        kind: 'remove',
        path: `edges[${edge}]`,
        before: edge,
        summary: `- edge ${edge}`,
      });
    }
  }
}

function readTemplateInputFromJob(job: { jobGraph?: { vertices?: SchemaOperation[] } }): SchemaLogReducerTemplateInput {
  const templateOp = findTemplateOperation(job);
  const inputs = (templateOp as { templateInputs?: Record<string, unknown> }).templateInputs ?? {};
  const input = (inputs as Record<string, unknown>)['input'] as SchemaLogReducerTemplateInput | undefined;
  if (!input) {
    throw new Error('template-operation vertex has no templateInputs.input');
  }
  return input;
}

function diffNamedArray(
  arrayName: string,
  current: SchemaOperation[],
  proposed: SchemaOperation[],
  entries: JobDiffEntry[],
): void {
  const curByName = new Map(current.map(op => [op.name, op]));
  const propByName = new Map(proposed.map(op => [op.name, op]));
  for (const [name, propOp] of propByName) {
    const curOp = curByName.get(name);
    if (!curOp) {
      entries.push({
        kind: 'add',
        path: `${arrayName}[${name}]`,
        after: propOp,
        summary: `+ ${arrayName}[${name}] (${propOp.type})`,
      });
      continue;
    }
    diffNestedObject(`${arrayName}[${name}]`, curOp as unknown as Record<string, unknown>, propOp as unknown as Record<string, unknown>, entries);
  }
  for (const [name, curOp] of curByName) {
    if (!propByName.has(name)) {
      entries.push({
        kind: 'remove',
        path: `${arrayName}[${name}]`,
        before: curOp,
        summary: `- ${arrayName}[${name}] (${curOp.type})`,
      });
    }
  }
}

function diffSinks(
  curInput: SchemaLogReducerTemplateInput,
  propInput: SchemaLogReducerTemplateInput,
  entries: JobDiffEntry[],
): void {
  // Sinks are wrapped in TemplateLogSink { filter?, sink? }; identify by sink.name.
  const curSinks: SchemaTemplateLogSink[] = curInput.sinks ?? [];
  const propSinks: SchemaTemplateLogSink[] = propInput.sinks ?? [];
  // A sink should always be named; fall back to a per-entry index for any that
  // aren't, so two nameless sinks don't collide on one map key and silently drop
  // from the diff the user reviews before approving an apply.
  const key = (entry: SchemaTemplateLogSink, i: number): string => entry.sink?.name ?? `<unnamed#${i}>`;
  const curByName = new Map(curSinks.map((s, i) => [key(s, i), s]));
  const propByName = new Map(propSinks.map((s, i) => [key(s, i), s]));
  for (const [name, propSink] of propByName) {
    if (!curByName.has(name)) {
      entries.push({ kind: 'add', path: `sinks[${name}]`, after: propSink, summary: `+ sinks[${name}]` });
      continue;
    }
    if (JSON.stringify(propSink) !== JSON.stringify(curByName.get(name))) {
      entries.push({
        kind: 'change',
        path: `sinks[${name}]`,
        before: curByName.get(name),
        after: propSink,
        summary: `~ sinks[${name}] config changed`,
      });
    }
  }
  for (const name of curByName.keys()) {
    if (!propByName.has(name)) {
      entries.push({ kind: 'remove', path: `sinks[${name}]`, before: curByName.get(name), summary: `- sinks[${name}]` });
    }
  }
}

function diffTransforms(
  curInput: SchemaLogReducerTemplateInput,
  propInput: SchemaLogReducerTemplateInput,
  entries: JobDiffEntry[],
): void {
  const curTransforms = (curInput.transforms as unknown as Record<string, unknown>) ?? {};
  const propTransforms = (propInput.transforms as unknown as Record<string, unknown>) ?? {};
  const phases = new Set<string>([...Object.keys(curTransforms), ...Object.keys(propTransforms)]);
  for (const phase of phases) {
    const before = curTransforms[phase];
    const after = propTransforms[phase];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (before === undefined) {
      entries.push({ kind: 'add', path: `transforms.${phase}`, after, summary: `+ transforms.${phase} = ${oneLine(after)}` });
    } else if (after === undefined) {
      entries.push({ kind: 'remove', path: `transforms.${phase}`, before, summary: `- transforms.${phase}` });
    } else {
      entries.push({
        kind: 'change',
        path: `transforms.${phase}`,
        before,
        after,
        summary: `~ transforms.${phase}: ${oneLine(before)} → ${oneLine(after)}`,
      });
    }
  }
}

function diffNestedObject(
  basePath: string,
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  entries: JobDiffEntry[],
): void {
  const fields = new Set<string>([...Object.keys(current), ...Object.keys(proposed)]);
  for (const field of fields) {
    if (field === 'name' || field === 'type') continue;
    const before = current[field];
    const after = proposed[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const path = `${basePath}.${field}`;
    if (before === undefined) {
      entries.push({ kind: 'add', path, after, summary: `+ ${path} = ${oneLine(after)}` });
    } else if (after === undefined) {
      entries.push({ kind: 'remove', path, before, summary: `- ${path} (was ${oneLine(before)})` });
    } else {
      entries.push({ kind: 'change', path, before, after, summary: `~ ${path}: ${oneLine(before)} → ${oneLine(after)}` });
    }
  }
}

function diffExceptions(
  curInput: SchemaLogReducerTemplateInput,
  propInput: SchemaLogReducerTemplateInput,
  entries: JobDiffEntry[],
): void {
  const curEx = curInput.exceptions ?? [];
  const propEx = propInput.exceptions ?? [];
  // Index-based diff; fine since patch ops idiomatically append.
  const max = Math.max(curEx.length, propEx.length);
  for (let i = 0; i < max; i++) {
    const before = curEx[i];
    const after = propEx[i];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    const path = `exceptions[${i}]`;
    if (before === undefined) {
      entries.push({ kind: 'add', path, after, summary: `+ ${path} = ${oneLine(after)}` });
    } else if (after === undefined) {
      entries.push({ kind: 'remove', path, before, summary: `- ${path}` });
    } else {
      entries.push({ kind: 'change', path, before, after, summary: `~ ${path}` });
    }
  }
}

function diffTopLevelScalars(
  curInput: SchemaLogReducerTemplateInput,
  propInput: SchemaLogReducerTemplateInput,
  entries: JobDiffEntry[],
): void {
  const cur = curInput as unknown as Record<string, unknown>;
  const prop = propInput as unknown as Record<string, unknown>;
  const skipFields = new Set(['parsers', 'sources', 'sinks', 'transforms', 'reducer', 'exceptions']);
  const fields = new Set<string>([...Object.keys(cur), ...Object.keys(prop)]);
  for (const field of fields) {
    if (skipFields.has(field)) continue;
    const before = cur[field];
    const after = prop[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (before === undefined) {
      entries.push({ kind: 'add', path: field, after, summary: `+ ${field} = ${oneLine(after)}` });
    } else if (after === undefined) {
      entries.push({ kind: 'remove', path: field, before, summary: `- ${field}` });
    } else {
      entries.push({ kind: 'change', path: field, before, after, summary: `~ ${field}: ${oneLine(before)} → ${oneLine(after)}` });
    }
  }
}

function oneLine(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  if (serialized.length <= 80) return serialized;
  return serialized.slice(0, 77) + '...';
}

/** Max JSON length at which a value renders inline before pretty-printing across lines. */
const INLINE_VALUE_MAX_LEN = 80;

type ChalkLike = Pick<typeof chalk, 'green' | 'red' | 'yellow'>;

/** Render a diff for humans (`job:plan --dry-run`, or the `job:apply` confirmation preamble). */
export function renderDiffHuman(diff: JobDiffEntry[], useColor = true): string {
  if (diff.length === 0) return '(no changes)';
  const c = useColor ? chalk : new Proxy({}, { get: () => (s: string): string => s }) as ChalkLike;
  const lines: string[] = [];
  for (const entry of diff) {
    // Scalar change: the precomputed summary is already clean.
    if (!isStructural(entry.before) && !isStructural(entry.after)) {
      lines.push(colorFor(entry.kind, c)(entry.summary));
      continue;
    }
    // Structural change: path header + indented value diff.
    const marker = markerFor(entry.kind);
    lines.push(colorFor(entry.kind, c)(`${marker} ${entry.path}`));
    if (entry.kind === 'change') {
      lines.push(...renderValueDiff(entry.before, entry.after, '    ', c));
    } else if (entry.kind === 'add') {
      lines.push(...prettyPrintValue(entry.after, '    ', '+', c));
    } else {
      lines.push(...prettyPrintValue(entry.before, '    ', '-', c));
    }
  }
  return lines.join('\n');
}

/**
 * Render a recursive diff between two structured values, emitting `+`/`-`/`~`
 * lines per differing leaf. Arrays walk by index (no LCS) — fine since patch
 * ops idiomatically append rather than insert/reorder.
 */
function renderValueDiff(before: unknown, after: unknown, indent: string, c: ChalkLike): string[] {
  if (deepEqual(before, after)) return [];
  if (before === undefined) return prettyPrintValue(after, indent, '+', c);
  if (after === undefined) return prettyPrintValue(before, indent, '-', c);
  if (Array.isArray(before) && Array.isArray(after)) {
    return diffArrayValues(before, after, indent, c);
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    return diffObjectValues(before, after, indent, c);
  }
  // Type mismatch or scalar-vs-scalar: one line.
  return [c.yellow(`${indent}~ ${formatValueInline(before)} → ${formatValueInline(after)}`)];
}

function diffArrayValues(before: unknown[], after: unknown[], indent: string, c: ChalkLike): string[] {
  const lines: string[] = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    if (deepEqual(b, a)) continue;
    if (b === undefined) {
      lines.push(...prettyPrintValue(a, indent, '+', c, `[${i}]`));
    } else if (a === undefined) {
      lines.push(...prettyPrintValue(b, indent, '-', c, `[${i}]`));
    } else if (isStructural(b) && isStructural(a)) {
      lines.push(c.yellow(`${indent}~ [${i}]:`));
      lines.push(...renderValueDiff(b, a, indent + '  ', c));
    } else {
      lines.push(c.yellow(`${indent}~ [${i}]: ${formatValueInline(b)} → ${formatValueInline(a)}`));
    }
  }
  return lines;
}

function diffObjectValues(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  indent: string,
  c: ChalkLike,
): string[] {
  const lines: string[] = [];
  // Sort keys for deterministic output (insertion order differs across fetch/clone).
  const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of allKeys) {
    const b = before[key];
    const a = after[key];
    if (deepEqual(b, a)) continue;
    if (b === undefined) {
      lines.push(...prettyPrintValue(a, indent, '+', c, key));
    } else if (a === undefined) {
      lines.push(...prettyPrintValue(b, indent, '-', c, key));
    } else if (isStructural(b) && isStructural(a)) {
      lines.push(c.yellow(`${indent}~ ${key}:`));
      lines.push(...renderValueDiff(b, a, indent + '  ', c));
    } else {
      lines.push(c.yellow(`${indent}~ ${key}: ${formatValueInline(b)} → ${formatValueInline(a)}`));
    }
  }
  return lines;
}

/**
 * Render a whole added/removed leaf with a single +/- marker. Inlines values up
 * to {@link INLINE_VALUE_MAX_LEN} chars, else pretty-prints multi-line. Optional
 * `label` prepends a key/index.
 */
function prettyPrintValue(
  value: unknown,
  indent: string,
  marker: '+' | '-',
  c: ChalkLike,
  label?: string,
): string[] {
  const color = marker === '+' ? c.green : c.red;
  const inline = formatValueInline(value);
  const labelPrefix = label !== undefined ? `${label}: ` : '';
  if (inline.length <= INLINE_VALUE_MAX_LEN) {
    return [color(`${indent}${marker} ${labelPrefix}${inline}`)];
  }
  // Multi-line: every body line carries the marker so the +/- column stays scannable.
  const headerSuffix = label !== undefined ? label : '';
  const pretty = JSON.stringify(value, null, 2);
  const bodyLines = pretty.split('\n');
  const out: string[] = [];
  out.push(color(`${indent}${marker} ${headerSuffix}`.trimEnd()));
  for (const line of bodyLines) {
    out.push(color(`${indent}${marker}   ${line}`));
  }
  return out;
}

function formatValueInline(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return String(value);
  return serialized;
}

function isStructural(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function markerFor(kind: JobDiffEntry['kind']): '+' | '-' | '~' {
  return kind === 'add' ? '+' : kind === 'remove' ? '-' : '~';
}

function colorFor(kind: JobDiffEntry['kind'], c: ChalkLike): (s: string) => string {
  return kind === 'add' ? c.green : kind === 'remove' ? c.red : c.yellow;
}

export async function loadPlanFromFile(path: string): Promise<JobPlan> {
  if (!(await fs.pathExists(path))) {
    throw new Error(`Plan file not found: ${path}`);
  }
  const raw = await fs.readJson(path);
  return parsePlan(raw);
}

export function parsePlan(raw: unknown): JobPlan {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Plan file must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['schemaVersion'] !== PLAN_SCHEMA_VERSION) {
    throw new Error(`Unsupported plan schemaVersion: ${String(obj['schemaVersion'])} (expected ${PLAN_SCHEMA_VERSION})`);
  }
  if (typeof obj['jobId'] !== 'string' || typeof obj['baseVersion'] !== 'number') {
    throw new Error('Plan file missing required fields (jobId, baseVersion)');
  }
  if (obj['backend'] !== 'template' && obj['backend'] !== 'job-graph') {
    throw new Error(`Plan file "backend" must be "template" or "job-graph" (got ${JSON.stringify(obj['backend'])})`);
  }
  // Patch/diff checked structurally; current/proposed shape-checked below.
  const patch = parsePatch(obj['patch']);
  // Recompute classification rather than trusting it: a stale or hand-edited
  // plan could carry one that disagrees with its patch, and classification
  // drives the draft validation path.
  if (obj['classification'] !== classifyPatch(patch)) {
    throw new Error('Plan "classification" disagrees with its patch — regenerate the plan.');
  }
  if (!Array.isArray(obj['diff'])) {
    throw new Error('Plan file "diff" must be an array');
  }
  // `proposed` is PUT straight to production by job:apply and its jobGraph is read
  // by job:draft, so a missing/null one must fail loudly here rather than as an
  // opaque TypeError or a malformed API payload. `current` backs drift/diff reads.
  if (!isPlainObject(obj['current'])) {
    throw new Error('Plan file "current" must be an object — regenerate the plan.');
  }
  const proposed = obj['proposed'];
  if (!isPlainObject(proposed) || !isPlainObject(proposed['jobGraph'])) {
    throw new Error('Plan file "proposed" must be an object with a "jobGraph" object — regenerate the plan.');
  }
  return obj as unknown as JobPlan;
}
