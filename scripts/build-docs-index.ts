#!/usr/bin/env tsx

/**
 * Build-time script to generate the documentation search index.
 *
 * This script runs during the build (`bun run build`). It vendors the embedding runtime and model
 * (see search-runtime-assets.ts), then splits every documentation file into chunks and embeds
 * them into one index file. Both are bundled with the CLI distribution, making documentation
 * search available offline with zero setup.
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
 * 2. **Model choice**: We use the same embedder (all-MiniLM-L6-v2, see text-embedder.ts) for
 *    both build-time indexing and runtime search. This ensures embeddings are
 *    comparable. Using different models would break semantic similarity.
 *
 * 3. **Chunking configuration**: Documents are split into chunks of at most 254 model tokens
 *    (256 with the [CLS]/[SEP] markers) that repeat up to 32 tokens of the previous chunk.
 *    256 is the input length the model is used at by sentence-transformers; longer inputs
 *    dilute the mean-pooled embedding, and past 512 the model truncates them. Chunks are
 *    counted with the model's own tokenizer, so every chunk fits. Each chunk is embedded
 *    after its page title and section headings (see headingContext in docs-index.ts).
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
 * - Index: build/dist/docs-index/index.json (documents, chunk spans and vectors; see docs-index.ts)
 * - Runtime and model: build/dist/vendor/
 */

import { glob } from 'glob';
import { readFileSync, existsSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChildProcess, execSync, fork } from 'child_process';
import { DocType, IndexedChunk, IndexedDocument, chunkText, headingContext, writeDocsIndex } from '../src/main/typescript/lib/docs-index.js';
import { MiniLmEmbedder } from '../src/main/typescript/lib/text-embedder.js';
import { vendorSearchRuntime } from './search-runtime-assets.js';
import { mdxToMarkdown } from './mdx-to-markdown.js';
import { resolveDocsDir } from './docs-source.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHUNK_TOKENS = 254;
const CHUNK_OVERLAP_TOKENS = 32;

async function buildDocsIndex(): Promise<void> {
  if (process.env.SKIP_DOCS_INDEX === 'true') {
    console.log('⚠ Skipping documentation index build (SKIP_DOCS_INDEX=true)');
    console.log('  The docs:search command will not be available.\n');
    return;
  }

  console.log('Building documentation search index...\n');

  const docsDir = resolveDocsDir();
  const docsPath = path.join(docsDir, 'app');

  const indexPath = path.resolve(__dirname, '../build/dist/docs-index');
  console.log(`Index path: ${indexPath}\n`);

  const vendorDir = await vendorSearchRuntime(path.resolve(__dirname, '..'));

  // The index is generated output. Recreate it so local builds cannot reuse a
  // stale or previously empty index and accidentally publish it.
  rmSync(indexPath, { recursive: true, force: true });

  const documents: IndexedDocument[] = [];
  const addDocument = (uri: string, text: string, docType: DocType) => {
    documents.push({ uri, docType, text });
  };

  const mdxFiles = glob.sync('**/*.mdx', {
    cwd: docsPath,
    // apis/api-spec.mdx only mounts a client-side Redoc viewer; the OpenAPI spec it shows is
    // indexed below as api:// and schema:// documents.
    ignore: ['**/release-notes/**', 'apis/api-spec.mdx']
  });
  console.log(`Found ${mdxFiles.length} documentation files (excluding release-notes and the API spec viewer)\n`);

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

    addDocument(uri, content, 'doc');
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
  if (existsSync(openApiDocsPath)) {
    collectOpenApiDocuments(openApiDocsPath, addDocument);
  } else {
    console.warn('⚠ OpenAPI docs directory not found, skipping API indexing');
  }

  if (documents.length === 0) {
    throw new Error('Documentation index is empty; refusing to complete the CLI build');
  }

  const embedder = new MiniLmEmbedder(vendorDir);
  await embedder.initialize();
  const spans = documents.flatMap(document =>
    chunkText(document.text, text => embedder.countTokens(text), CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS)
      .map(({ start, end }) => ({ document, start, end })));

  const started = Date.now();
  // The heading path is embedded with each chunk but not stored: excerpts stay verbatim slices.
  const vectors = await embedInParallel(
    spans.map(({ document, start, end }) => `${headingContext(document.text, start)}\n${document.text.slice(start, end)}`),
    vendorDir
  );
  const chunks: IndexedChunk[] = spans.map((span, i) => {
    const vector = vectors[i];
    if (!vector) {
      throw new Error(`No embedding returned for chunk ${i}`);
    }
    return { ...span, vector };
  });
  console.log(`\nEmbedded ${chunks.length} chunks in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  await writeDocsIndex(indexPath, { documents, chunks });

  console.log(`\n✓ Documentation index built successfully!`);
  console.log(`  Total documents: ${documents.length}`);
  console.log(`  Index location: ${indexPath}`);
}

function collectOpenApiDocuments(
  openApiDocsPath: string,
  addDocument: (uri: string, text: string, docType: DocType) => void
): void {
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
    addDocument(uri, content, 'api');
    process.stdout.write(' ✓\n');
  }

  let schemaIndexed = 0;
  for (const file of schemaFiles) {
    const fullPath = path.join(openApiDocsPath, file);
    const content = readFileSync(fullPath, 'utf-8');
    const uri = `schema://${file.replace(/\.md$/, '').replace(/^schemas\//, '')}`;

    process.stdout.write(`[${++schemaIndexed}/${schemaFiles.length}] Indexing schema: ${file}...`);
    addDocument(uri, content, 'schema');
    process.stdout.write(' ✓\n');
  }

  console.log(`\n✓ OpenAPI documents collected: ${visibleApiFiles.length} operations, ${schemaFiles.length} schemas`);
}

/**
 * Embeds texts across forked processes. Embedding is single-threaded WebAssembly, so a single
 * process would take minutes for the few thousand chunks in the docs. Each process holds its own
 * runtime and model (a few hundred MB), so the count is capped rather than one per CPU.
 */
const MAX_EMBEDDING_PROCESSES = 8;

async function embedInParallel(texts: string[], vendorDir: string): Promise<Float32Array[]> {
  const processes = Math.max(1, Math.min(os.availableParallelism(), MAX_EMBEDDING_PROCESSES, Math.ceil(texts.length / 100)));
  const shardSize = Math.ceil(texts.length / processes);
  console.log(`\nEmbedding ${texts.length} chunks in ${processes} processes...`);

  const shards = Array.from({ length: processes }, (_, i) => texts.slice(i * shardSize, (i + 1) * shardSize));
  const children: ChildProcess[] = [];
  try {
    return (await Promise.all(shards.map(shard => embedInChildProcess(shard, vendorDir, children)))).flat();
  } catch (error) {
    // Stop the other workers rather than leave them embedding after the build has failed.
    children.forEach(child => child.kill());
    throw error;
  }
}

function embedInChildProcess(texts: string[], vendorDir: string, children: ChildProcess[]): Promise<Float32Array[]> {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'embed-chunks-worker.ts'), [vendorDir], { serialization: 'advanced' });
    children.push(child);
    child.once('message', (vectors: unknown) => {
      if (Array.isArray(vectors) && vectors.every(vector => vector instanceof Float32Array)) {
        resolve(vectors);
      } else {
        reject(new Error('Embedding worker sent something other than vectors'));
      }
    });
    child.once('error', reject);
    // Settles nothing once the vectors have arrived; otherwise the worker died without sending them.
    child.once('exit', code => reject(new Error(`Embedding worker exited with code ${code} before sending vectors`)));
    child.send(texts);
  });
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
