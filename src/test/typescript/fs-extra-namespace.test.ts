/**
 * Regression guard for ENGT-4510: an `import * as fs from 'fs-extra'` in
 * production code crashed the CLI with `fs.readJson is not a function`
 * under Node's ESM resolver, but the test suite was silently passing
 * because Vite's CJS->ESM pre-bundling exposed every CJS method as a
 * named export.
 *
 * The vitest.config.ts in this package sets `optimizeDeps.disabled` and
 * `test.deps.interopDefault: false`, which makes namespace imports of CJS
 * packages behave the way Node ESM does (default + statically-detected
 * named exports only). This test fails fast if either of those settings
 * regresses, so production code paths using `import * as fs from 'fs-extra'`
 * stay broken in CI just like they would at runtime.
 */
import { describe, it, expect } from 'vitest';
import * as fsNamespace from 'fs-extra';
import fsDefault from 'fs-extra';

describe('fs-extra import semantics', () => {
  it('namespace import does NOT expose CJS-only methods (matches Node ESM)', () => {
    // readJson is a camelCase method only present on the CJS module.exports.
    // Node's ESM resolver does not lift those into the namespace; Vite's
    // pre-bundling would. If this passes, vitest matches Node.
    const ns = fsNamespace as Record<string, unknown>;
    expect(typeof ns.readJson).toBe('undefined');
    expect(typeof ns.writeJson).toBe('undefined');
  });

  it('default import always exposes the full fs-extra API', () => {
    expect(typeof fsDefault.readJson).toBe('function');
    expect(typeof fsDefault.writeJson).toBe('function');
  });
});
