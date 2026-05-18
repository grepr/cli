import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { EmbeddingsModel, EmbeddingsResponse } from 'vectra';

/**
 * Embeddings provider for Vectra using Transformers.js.
 *
 * This class implements Vectra's EmbeddingsModel interface using Transformers.js,
 * a pure JavaScript implementation of transformer models. This approach provides:
 * - Zero external dependencies (no Docker, no server startup)
 * - Automatic model caching (~90MB downloaded once, reused thereafter)
 * - Cross-platform compatibility (works on any Node.js environment)
 *
 * The model generates dense vector embeddings for text, enabling semantic similarity
 * search. The embeddings are generated using mean pooling and normalization, which
 * is standard for sentence similarity tasks.
 *
 * Design decision: We chose Transformers.js over alternatives like Ollama because:
 * 1. No runtime server dependency (Ollama requires Docker container)
 * 2. Faster startup time (no container initialization)
 * 3. Smaller distribution size (model cached by npm, not bundled)
 * 4. Better integration with Node.js ecosystem
 */
export class TransformersEmbeddings implements EmbeddingsModel {
  private pipeline: FeatureExtractionPipeline | null = null;

  /**
   * Maximum number of tokens the model can process per input.
   * This is exposed publicly so Vectra can use it for chunking decisions.
   */
  public readonly maxTokens: number;

  private readonly modelName: string;

  /**
   * Creates a new TransformersEmbeddings instance.
   *
   * @param modelName - HuggingFace model identifier (e.g., 'Xenova/all-MiniLM-L6-v2')
   *                    Default model produces 384-dimensional embeddings and is ~90MB.
   *                    See https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction
   *                    for other compatible models.
   * @param maxTokens - Maximum tokens per input. Should match model's configuration.
   *                    Used by Vectra for automatic document chunking.
   */
  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', maxTokens = 512) {
    this.modelName = modelName;
    this.maxTokens = maxTokens;
  }

  /**
   * Initializes the embedding model pipeline.
   *
   * This method is lazy - it only loads the model when first called. The model
   * is downloaded from HuggingFace on first run and cached locally by Transformers.js
   * in ~/.cache/huggingface/ (or platform equivalent).
   *
   * Subsequent calls to this method are no-ops if the pipeline is already initialized.
   *
   * @throws Error if model download or initialization fails (e.g., network issues,
   *         unsupported model architecture)
   */
  async initialize(): Promise<void> {
    if (!this.pipeline) {
      this.pipeline = await pipeline('feature-extraction', this.modelName);
    }
  }

  /**
   * Generates vector embeddings for one or more text inputs.
   *
   * This is the main method called by Vectra to generate embeddings for documents
   * and queries. The implementation:
   * 1. Initializes the pipeline if not already initialized (lazy loading)
   * 2. Normalizes input to always be an array
   * 3. Generates embeddings for each input sequentially
   * 4. Returns embeddings as a 2D array of numbers
   *
   * Important: We use mean pooling and normalization for the embeddings. This is
   * standard practice for sentence similarity tasks:
   * - Mean pooling: Averages token embeddings to get a single vector per sentence
   * - Normalization: Scales vectors to unit length, enabling cosine similarity
   *                   via simple dot product
   *
   * @param inputs - Single text string or array of strings to embed
   * @returns Promise resolving to EmbeddingsResponse with either:
   *          - success status and array of embedding vectors
   *          - error status and error message
   */
  async createEmbeddings(inputs: string | string[]): Promise<EmbeddingsResponse> {
    try {
      if (!this.pipeline) {
        await this.initialize();
      }

      if (!this.pipeline) {
        throw new Error('Pipeline not initialized');
      }

      const inputArray = Array.isArray(inputs) ? inputs : [inputs];
      const embeddings: number[][] = [];

      for (const text of inputArray) {
        const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data as Float32Array);
        embeddings.push(embedding);
      }

      return {
        status: 'success',
        output: embeddings
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error generating embeddings'
      };
    }
  }
}
