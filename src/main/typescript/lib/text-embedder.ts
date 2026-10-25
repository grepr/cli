import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type * as Ort from 'onnxruntime-web';
import type * as Tokenizers from '@huggingface/tokenizers';

/**
 * Turns text into a vector for semantic search. Index building and querying must use the same
 * embedder, or their vectors are not comparable.
 */
export interface TextEmbedder {
  /** Loads the model. Idempotent; embed and countTokens require it. */
  initialize(): Promise<void>;
  /** Returns a unit-length vector, so the dot product of two vectors is their cosine similarity. */
  embed(text: string): Promise<Float32Array>;
  /** Counts the model's tokens in text, excluding the [CLS] and [SEP] markers embed adds. */
  countTokens(text: string): number;
}

/** Directory names under the vendor directory, written by scripts/search-runtime-assets.ts. */
export const VENDOR_LAYOUT = {
  onnxRuntime: 'onnxruntime-web',
  tokenizers: 'tokenizers',
  model: 'all-MiniLM-L6-v2'
};

/** Positions the model has embeddings for: inputs longer than this, markers included, are truncated. */
const MODEL_MAX_TOKENS = 512;

/**
 * all-MiniLM-L6-v2 (384 dimensions, mean pooled), run on onnxruntime-web's WebAssembly backend.
 *
 * The runtime, tokenizer and model are not npm dependencies: the build copies just the files
 * inference needs into build/dist/vendor (see scripts/search-runtime-assets.ts) and they are loaded
 * from there on first use. That keeps the install small and free of the native ONNX runtime, and
 * keeps CLI startup fast for commands that never search.
 */
export class MiniLmEmbedder implements TextEmbedder {
  private ort: typeof Ort | null = null;
  private session: Ort.InferenceSession | null = null;
  private tokenizer: Tokenizers.Tokenizer | null = null;

  /** @param vendorDir - Where scripts/search-runtime-assets.ts put the runtime and model. */
  constructor(private readonly vendorDir: string = defaultVendorDir()) {}

  async initialize(): Promise<void> {
    if (this.session) {
      return;
    }

    const ort: typeof Ort = await import(this.vendorUrl(VENDOR_LAYOUT.onnxRuntime, 'ort.wasm.min.mjs'));
    // Multithreaded WebAssembly spawns workers that Node and Bun cannot load from these files.
    // Embedding one query is a few milliseconds of work, so a single thread costs nothing noticeable.
    ort.env.wasm.numThreads = 1;

    const { Tokenizer }: typeof Tokenizers = await import(this.vendorUrl(VENDOR_LAYOUT.tokenizers, 'tokenizers.min.mjs'));
    const modelDir = path.join(this.vendorDir, VENDOR_LAYOUT.model);
    const [tokenizerJson, tokenizerConfig, model] = await Promise.all([
      readFile(path.join(modelDir, 'tokenizer.json'), 'utf-8'),
      readFile(path.join(modelDir, 'tokenizer_config.json'), 'utf-8'),
      readFile(path.join(modelDir, 'model_quantized.onnx'))
    ]);

    this.tokenizer = new Tokenizer(JSON.parse(tokenizerJson), JSON.parse(tokenizerConfig));
    this.session = await ort.InferenceSession.create(model);
    this.ort = ort;
  }

  async embed(text: string): Promise<Float32Array> {
    const { ort, session, tokenizer } = this.loaded();

    const { ids } = tokenizer.encode(text);
    // Keep the closing [SEP] when truncating, as the model saw in training.
    const inputIds = ids.length <= MODEL_MAX_TOKENS ? ids : ids.slice(0, MODEL_MAX_TOKENS - 1).concat(ids.slice(-1));
    const length = inputIds.length;
    const shape = [1, length];

    const outputs = await session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds, BigInt), shape),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(length).fill(1n), shape),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(length), shape)
    });
    const hidden = outputs.last_hidden_state;
    if (!hidden || !(hidden.data instanceof Float32Array)) {
      throw new Error('Embedding model returned no float last_hidden_state output');
    }

    return meanPoolAndNormalize(hidden.data, length);
  }

  countTokens(text: string): number {
    return this.loaded().tokenizer.encode(text, { add_special_tokens: false }).ids.length;
  }

  private loaded(): { ort: typeof Ort; session: Ort.InferenceSession; tokenizer: Tokenizers.Tokenizer } {
    if (!this.ort || !this.session || !this.tokenizer) {
      throw new Error('Embedding model not initialized; call initialize() first');
    }
    return { ort: this.ort, session: this.session, tokenizer: this.tokenizer };
  }

  private vendorUrl(...segments: string[]): string {
    return pathToFileURL(path.join(this.vendorDir, ...segments)).href;
  }
}

/** Averages the per-token vectors of a [1, tokens, dims] output, then scales to unit length. */
function meanPoolAndNormalize(hidden: Float32Array, tokens: number): Float32Array {
  const dims = hidden.length / tokens;
  const pooled = Float32Array.from({ length: dims }, (_, dim) => {
    let sum = 0;
    for (let token = 0; token < tokens; token++) {
      sum += hidden[token * dims + dim] ?? 0;
    }
    return sum / tokens;
  });

  const norm = Math.hypot(...pooled);
  return pooled.map(value => value / norm);
}

/** The vendor directory sits beside the compiled lib/ directory: build/dist/vendor. */
function defaultVendorDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor');
}
