/**
 * Regression guard for ENGT-4510: an `import * as fs from 'fs-extra'` in
 * production code crashed the CLI with `fs.readJson is not a function` under
 * Node's ESM resolver (the published CLI runs on Node), because Node's ESM
 * resolver does not lift CJS `module.exports` methods into the namespace —
 * only the default export and statically-detected named exports.
 *
 * The original guard relied on the test runner reproducing Node's ESM
 * interop. bun's test runner does NOT: it lifts every CJS export into the
 * namespace, so `import * as fs from 'fs-extra'` resolves `fs.readJson` in
 * tests even though it would crash at runtime under Node. A runtime probe can
 * therefore no longer catch the bug.
 *
 * Instead we statically scan production source for the dangerous pattern, so
 * the guard holds regardless of the test runner's interop quirks.
 */
import { describe, it, expect } from 'bun:test';
import fsDefault from 'fs-extra';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PRODUCTION_SRC = path.resolve(import.meta.dir, '../../main/typescript');

// `import * as <name> from 'fs-extra'` (or "fs-extra") — the namespace import
// that resolves at build/test time but crashes under Node's ESM runtime.
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s+['"]fs-extra['"]/;

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(full);
    }
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });
}

describe('fs-extra import semantics', () => {
  it('production code never namespace-imports the CJS fs-extra module', () => {
    const offenders = collectTsFiles(PRODUCTION_SRC).filter(file =>
      NAMESPACE_IMPORT.test(readFileSync(file, 'utf8'))
    );

    expect(
      offenders,
      `fs-extra is a CJS module; "import * as fs from 'fs-extra'" crashes the ` +
        `CLI at runtime under Node's ESM resolver (ENGT-4510). Use the default ` +
        `import "import fs from 'fs-extra'" instead in:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('default import exposes the full fs-extra API', () => {
    expect(typeof fsDefault.readJson).toBe('function');
    expect(typeof fsDefault.writeJson).toBe('function');
  });
});
