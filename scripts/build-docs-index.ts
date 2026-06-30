#!/usr/bin/env tsx

/**
 * Build-time script to generate the documentation search index.
 *
 * This script runs during the build (`bun run build`) and creates a Vectra vector database index
 * of all documentation files. The index is bundled with the CLI distribution,
 * making documentation search available offline with zero setup.
 *
 * Architecture decisions:
 *
 * 1. **Build-time vs Runtime**: We generate the index at build time rather than
 *    on first run because:
 *    - Faster first-run experience (no indexing wait)
 *    - Index is immutable and versioned with CLI release
 *    - Smaller npm package (no need to bundle raw docs)
 *    - Guaranteed consistency (index always matches CLI version)
 *
 * 2. **Model choice**: We use the same model (Xenova/all-MiniLM-L6-v2) for both
 *    build-time indexing and runtime search. This ensures embeddings are
 *    comparable. Using different models would break semantic similarity.
 *
 * 3. **Chunking configuration**: Documents are split into 512-token chunks with
 *    50-token overlap. This balances:
 *    - Search granularity (smaller chunks = more precise results)
 *    - Context preservation (overlap prevents information loss at boundaries)
 *    - Model limits (512 tokens fits within model's max input)
 *
 * 4. **Excluded content**: Release notes are excluded because they:
 *    - Change frequently and bloat the index
 *    - Are time-sensitive and less relevant for semantic search
 *    - Can be found more efficiently through structured navigation
 *
 * Environment variables:
 * - SKIP_DOCS_INDEX=true: Skip index generation for faster dev builds
 *
 * Output:
 * - Index directory: build/dist/docs-index/
 * - Index contents: Vectra database files (vectors, metadata, etc.)
 */

import { LocalDocumentIndex } from 'vectra';
import { glob } from 'glob';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { TransformersEmbeddings } from '../src/main/typescript/lib/transformers-embeddings.js';
import { mdxToMarkdown } from './mdx-to-markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildDocsIndex(): Promise<void> {
  if (process.env.SKIP_DOCS_INDEX === 'true') {
    console.log('⚠ Skipping documentation index build (SKIP_DOCS_INDEX=true)');
    console.log('  The docs:search command will not be available.\n');
    return;
  }

  console.log('Building documentation search index...\n');

  const embeddings = new TransformersEmbeddings('Xenova/all-MiniLM-L6-v2', 512);
  await embeddings.initialize();

  const indexPath = path.resolve(__dirname, '../build/dist/docs-index');
  console.log(`Index path: ${indexPath}\n`);

  const docs = new LocalDocumentIndex({
    folderPath: indexPath,
    embeddings,
    chunkingConfig: {
      chunkSize: 512,
      chunkOverlap: 50,
      keepSeparators: true
    }
  });

  if (await docs.isIndexCreated()) {
    console.log('Documentation index already exists. Skipping build.');
    return;
  }

  console.log('Creating new index...');
  await docs.createIndex({ version: 1 });

  const docsDir = path.resolve(__dirname, '../../../docs');
  const docsPath = path.join(docsDir, 'app');
  if (!existsSync(docsPath)) {
    console.warn(`⚠ Documentation directory not found: ${docsPath}`);
    console.warn('  Skipping documentation indexing.\n');
    return;
  }

  const mdxFiles = glob.sync('**/*.mdx', {
    cwd: docsPath,
    ignore: '**/release-notes/**'
  });
  console.log(`Found ${mdxFiles.length} documentation files (excluding release-notes)\n`);

  let indexed = 0;
  let skipped = 0;
  for (const file of mdxFiles) {
    const fullPath = path.join(docsPath, file);
    const rawSource = readFileSync(fullPath, 'utf-8');
    const uri = `doc://${file}`;

    process.stdout.write(`[${++indexed}/${mdxFiles.length}] Indexing: ${file}...`);

    let content: string;
    try {
      const markdown = await mdxToMarkdown(rawSource, { docsDir, filePath: fullPath });
      if (!markdown) {
        process.stdout.write(' ⏭ (empty after rendering)\n');
        skipped++;
        continue;
      }
      content = markdown;
    } catch (err) {
      // Fall back to raw source if MDX conversion fails
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(` ⚠ MDX conversion failed (${msg}), using raw source...`);
      content = rawSource;
    }

    await docs.upsertDocument(uri, content, 'md', { docType: 'doc' });
    process.stdout.write(' ✓\n');
  }

  console.log(`✓ Documentation files indexed: ${indexed - skipped} (${skipped} skipped)\n`);

  console.log('Converting OpenAPI spec to markdown...\n');
  try {
    execSync('tsx scripts/convert-openapi-to-markdown.ts', {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('Failed to convert OpenAPI spec');
    throw error;
  }

  const openApiDocsPath = path.resolve(__dirname, '../build/dist/openapi-docs');
  if (!existsSync(openApiDocsPath)) {
    console.warn('⚠ OpenAPI docs directory not found, skipping API indexing');
    console.log(`\n✓ Documentation index built successfully!`);
    console.log(`  Indexed ${indexed - skipped} documents`);
    console.log(`  Index location: ${indexPath}`);
    return;
  }

  const apiFiles = glob.sync('api/**/*.md', {
    cwd: openApiDocsPath
  });

  // Filter out hidden API operations (operationId ending in -hidden)
  const visibleApiFiles = apiFiles.filter(file => {
    const basename = path.basename(file, '.md');
    return !basename.endsWith('-hidden');
  });

  const schemaFiles = glob.sync('schemas/**/*.md', {
    cwd: openApiDocsPath
  });

  console.log(`\nIndexing OpenAPI documentation...`);
  console.log(`  API operations: ${visibleApiFiles.length} (${apiFiles.length - visibleApiFiles.length} hidden filtered out)`);
  console.log(`  Schemas: ${schemaFiles.length}\n`);

  let apiIndexed = 0;
  for (const file of visibleApiFiles) {
    const fullPath = path.join(openApiDocsPath, file);
    const content = readFileSync(fullPath, 'utf-8');
    const uri = `api://${file.replace(/\.md$/, '')}`;

    process.stdout.write(`[${++apiIndexed}/${visibleApiFiles.length}] Indexing API: ${file}...`);
    await docs.upsertDocument(uri, content, 'md', { docType: 'api' });
    process.stdout.write(' ✓\n');
  }

  let schemaIndexed = 0;
  for (const file of schemaFiles) {
    const fullPath = path.join(openApiDocsPath, file);
    const content = readFileSync(fullPath, 'utf-8');
    const uri = `schema://${file.replace(/\.md$/, '').replace(/^schemas\//, '')}`;

    process.stdout.write(`[${++schemaIndexed}/${schemaFiles.length}] Indexing schema: ${file}...`);
    await docs.upsertDocument(uri, content, 'md', { docType: 'schema' });
    process.stdout.write(' ✓\n');
  }

  console.log(`\n✓ Documentation index built successfully!`);
  console.log(`  Documentation files: ${indexed - skipped}`);
  console.log(`  API operations: ${visibleApiFiles.length}`);
  console.log(`  Schemas: ${schemaFiles.length}`);
  console.log(`  Total documents: ${(indexed - skipped) + visibleApiFiles.length + schemaFiles.length}`);
  console.log(`  Index location: ${indexPath}`);
}

buildDocsIndex().catch((error) => {
  console.error('\n✗ Error building documentation index:');
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof Error && error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
});
