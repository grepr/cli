/**
 * Assembles build/dist/vendor: the files docs:search loads at runtime to embed queries.
 *
 * onnxruntime-web and @huggingface/tokenizers are devDependencies, not dependencies: npm would
 * install all of onnxruntime-web (~140 MB of WebAssembly variants for browsers and GPUs) when
 * inference on Node needs three files. Copying just those keeps the published CLI small and its
 * install free of native addons.
 *
 * The model is downloaded from a pinned Hugging Face revision, checked against known hashes and
 * shipped in the package, so search works offline and never writes a cache at runtime.
 *
 * Vendoring a new package here means listing it in vendored_dev_dependencies in
 * third-party-licenses/tools/collect-npm.sh, which only attributes production dependencies otherwise.
 */

import { createHash } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { VENDOR_LAYOUT } from '../src/main/typescript/lib/text-embedder.js';

const MODEL_REPO = 'Xenova/all-MiniLM-L6-v2';
const MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const MODEL_FILES: Record<string, string> = {
  'onnx/model_quantized.onnx': 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3'
};

/** The WebAssembly entry point and the single runtime variant it loads on Node and Bun. */
const ONNX_RUNTIME_FILES = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

/** Builds build/dist/vendor and returns its path. */
export async function vendorSearchRuntime(cliDir: string): Promise<string> {
  const vendorDir = path.join(cliDir, 'build/dist/vendor');
  rmSync(vendorDir, { recursive: true, force: true });

  const onnxRuntimeDist = path.join(cliDir, 'node_modules/onnxruntime-web/dist');
  copyFiles(onnxRuntimeDist, ONNX_RUNTIME_FILES, path.join(vendorDir, VENDOR_LAYOUT.onnxRuntime));

  const tokenizersPackage = path.join(cliDir, 'node_modules/@huggingface/tokenizers');
  copyFiles(path.join(tokenizersPackage, 'dist'), ['tokenizers.min.mjs'], path.join(vendorDir, VENDOR_LAYOUT.tokenizers));
  copyFiles(tokenizersPackage, ['LICENSE'], path.join(vendorDir, VENDOR_LAYOUT.tokenizers));

  const cachedModelDir = await verifiedModelDir(cliDir);
  const modelDir = path.join(vendorDir, VENDOR_LAYOUT.model);
  mkdirSync(modelDir, { recursive: true });
  for (const file of Object.keys(MODEL_FILES)) {
    copyFileSync(path.join(cachedModelDir, file), path.join(modelDir, path.basename(file)));
  }

  writeFileSync(path.join(vendorDir, 'THIRD_PARTY_NOTICES.md'), THIRD_PARTY_NOTICES);
  return vendorDir;
}

function copyFiles(fromDir: string, files: string[], toDir: string): void {
  mkdirSync(toDir, { recursive: true });
  for (const file of files) {
    copyFileSync(path.join(fromDir, file), path.join(toDir, file));
  }
}

/**
 * Returns build/search-model/<revision>, outside dist so `clean` keeps it. The folder holds every
 * model file with its expected hash, or it does not exist: files are downloaded and verified in a
 * staging folder, which then replaces it in one rename. CI caches build/search-model, so the
 * staging folder must stay outside it.
 */
async function verifiedModelDir(cliDir: string): Promise<string> {
  const modelDir = path.join(cliDir, 'build/search-model', MODEL_REVISION);
  const isComplete = Object.entries(MODEL_FILES).every(([file, sha256]) => {
    const cached = path.join(modelDir, file);
    return existsSync(cached) && hashOf(readFileSync(cached)) === sha256;
  });
  if (isComplete) {
    return modelDir;
  }

  const stagingDir = path.join(cliDir, 'build/search-model-staging');
  rmSync(stagingDir, { recursive: true, force: true });
  for (const [file, sha256] of Object.entries(MODEL_FILES)) {
    const url = `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = hashOf(bytes);
    if (actual !== sha256) {
      throw new Error(`${url} has sha256 ${actual}, expected ${sha256}`);
    }

    const staged = path.join(stagingDir, file);
    mkdirSync(path.dirname(staged), { recursive: true });
    writeFileSync(staged, bytes);
  }

  rmSync(modelDir, { recursive: true, force: true });
  mkdirSync(path.dirname(modelDir), { recursive: true });
  renameSync(stagingDir, modelDir);
  return modelDir;
}

function hashOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const THIRD_PARTY_NOTICES = `# Third-party components

The files under this directory are redistributed for documentation search.

## onnxruntime-web (${VENDOR_LAYOUT.onnxRuntime}/)

Copyright (c) Microsoft Corporation.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## @huggingface/tokenizers (${VENDOR_LAYOUT.tokenizers}/)

Apache License 2.0; see ${VENDOR_LAYOUT.tokenizers}/LICENSE.

## all-MiniLM-L6-v2 (${VENDOR_LAYOUT.model}/)

sentence-transformers/all-MiniLM-L6-v2, converted to ONNX as ${MODEL_REPO} at revision
${MODEL_REVISION}. Apache License 2.0; see ${VENDOR_LAYOUT.tokenizers}/LICENSE for the license text.
`;
