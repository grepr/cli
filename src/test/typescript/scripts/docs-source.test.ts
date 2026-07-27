import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { resolveDocsDir } from '../../../../scripts/docs-source.js';

const originalDocsDir = process.env.GREPR_DOCS_DIR;
const testRoot = path.resolve('build', `docs-source-test-${Date.now()}`);

afterEach(() => {
  if (originalDocsDir === undefined) {
    delete process.env.GREPR_DOCS_DIR;
  } else {
    process.env.GREPR_DOCS_DIR = originalDocsDir;
  }
  rmSync(testRoot, { recursive: true, force: true });
});

function createDocsSource(root: string): void {
  mkdirSync(path.join(root, 'app'), { recursive: true });
  mkdirSync(path.join(root, 'components'), { recursive: true });
  mkdirSync(path.join(root, 'public'), { recursive: true });
  writeFileSync(path.join(root, 'public/openapi.json'), '{}');
}

describe('resolveDocsDir', () => {
  it('resolves the monorepo documentation source', () => {
    delete process.env.GREPR_DOCS_DIR;
    const repositoryRoot = path.join(testRoot, 'grepr-server');
    const scriptsDir = path.join(repositoryRoot, 'cli/scripts');
    const docsDir = path.join(repositoryRoot, 'docs');
    createDocsSource(docsDir);

    expect(resolveDocsDir(scriptsDir)).toBe(docsDir);
  });

  it('resolves the synced public repository documentation source', () => {
    delete process.env.GREPR_DOCS_DIR;
    const repositoryRoot = path.join(testRoot, 'cli');
    const scriptsDir = path.join(repositoryRoot, 'scripts');
    const docsDir = path.join(repositoryRoot, 'docs-index-source');
    createDocsSource(docsDir);

    expect(resolveDocsDir(scriptsDir)).toBe(docsDir);
  });

  it('accepts a complete explicit documentation source', () => {
    createDocsSource(testRoot);
    process.env.GREPR_DOCS_DIR = testRoot;

    expect(resolveDocsDir()).toBe(testRoot);
  });

  it('rejects an incomplete explicit documentation source', () => {
    process.env.GREPR_DOCS_DIR = testRoot;

    expect(() => resolveDocsDir()).toThrow('GREPR_DOCS_DIR is incomplete');
  });
});
