/**
 * Okapi BM25 keyword relevance over a fixed list of texts.
 *
 * Docs search blends this with embedding similarity: the small embedding model is good at
 * paraphrase but weak at telling apart pages that differ by one exact term (a `heartbeat`
 * endpoint next to a `submit` one, `GreprJobGraph` next to `Template`), which is exactly
 * what keyword matching is good at.
 */
export class KeywordScorer {
  private readonly termCounts: Map<string, number>[];
  private readonly lengths: number[];
  private readonly averageLength: number;
  private readonly documentFrequency = new Map<string, number>();

  constructor(texts: string[]) {
    this.termCounts = texts.map(text => {
      const counts = new Map<string, number>();
      for (const term of keywords(text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
      for (const term of counts.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      return counts;
    });
    this.lengths = this.termCounts.map(counts => [...counts.values()].reduce((sum, count) => sum + count, 0));
    this.averageLength = this.lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, this.lengths.length);
  }

  /** BM25 score of each text for the query, in the order the texts were given. */
  score(query: string): number[] {
    const k1 = 1.2;
    const b = 0.75;
    const texts = this.termCounts.length;
    const terms = [...new Set(keywords(query))];

    return this.termCounts.map((counts, i) => {
      const lengthRatio = (this.lengths[i] ?? 0) / this.averageLength;
      let score = 0;
      for (const term of terms) {
        const count = counts.get(term);
        if (!count) {
          continue;
        }
        const frequency = this.documentFrequency.get(term) ?? 0;
        const idf = Math.log(1 + (texts - frequency + 0.5) / (frequency + 0.5));
        score += idf * (count * (k1 + 1)) / (count + k1 * (1 - b + b * lengthRatio));
      }
      return score;
    });
  }
}

const STOP_WORDS = new Set(
  'a an the and or of to in on for with is are be by it as at from this that how do i my our we what which when why can does not into than then its'
    .split(' ')
);

/** Lower-cased words, with camelCase identifiers split so `heartbeatSyncJob` matches "heartbeat". */
export function keywords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}
