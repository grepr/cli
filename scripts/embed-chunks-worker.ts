/**
 * Child process forked by build-docs-index.ts: receives a list of texts, embeds them, and sends
 * back their vectors. Embedding runs single-threaded, so the build spreads chunks across processes.
 *
 * Usage (from build-docs-index.ts only): fork(this file, [vendorDir], { serialization: 'advanced' })
 */

import { MiniLmEmbedder } from '../src/main/typescript/lib/text-embedder.js';

const vendorDir = process.argv[2];
if (!vendorDir || !process.send) {
  throw new Error('embed-chunks-worker must be forked by build-docs-index.ts with the vendor directory');
}

process.once('message', async (texts: unknown) => {
  if (!Array.isArray(texts)) {
    throw new Error('embed-chunks-worker expects an array of texts');
  }

  const embedder = new MiniLmEmbedder(vendorDir);
  await embedder.initialize();

  const vectors: Float32Array[] = [];
  for (const text of texts) {
    vectors.push(await embedder.embed(String(text)));
  }

  process.send?.(vectors, () => process.disconnect?.());
});
