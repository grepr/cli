import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isCompleteDocsDir(candidate: string): boolean {
  return (
    existsSync(path.join(candidate, 'app')) &&
    existsSync(path.join(candidate, 'components')) &&
    existsSync(path.join(candidate, 'public/openapi.json'))
  );
}

/**
 * Resolves documentation build inputs in both supported repository layouts:
 * - grepr-server: docs/ is a sibling of cli/
 * - grepr/cli: docs-index-source/ is populated by grepr-cli-sync
 *
 * @param scriptsDir Directory containing the CLI build scripts.
 */
export function resolveDocsDir(scriptsDir: string = __dirname): string {
  const explicitDocsDir = process.env.GREPR_DOCS_DIR;
  if (explicitDocsDir) {
    const resolved = path.resolve(explicitDocsDir);
    if (isCompleteDocsDir(resolved)) {
      return resolved;
    }
    throw new Error(`GREPR_DOCS_DIR is incomplete: ${resolved}`);
  }

  const candidates = [
    path.resolve(scriptsDir, '../../docs'),
    path.resolve(scriptsDir, '../docs-index-source')
  ];

  const docsDir = candidates.find(isCompleteDocsDir);

  if (!docsDir) {
    throw new Error(
      `Documentation source not found. Checked: ${candidates.join(', ')}`
    );
  }

  return docsDir;
}
