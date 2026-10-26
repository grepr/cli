import { describe, it, expect } from 'bun:test';
import { KeywordScorer, keywords } from '../../../main/typescript/lib/keyword-scorer.js';

describe('keywords', () => {
  it('test_keywords_camelCaseIdentifier_shouldSplitIntoWords', () => {
    expect(keywords('POST heartbeatSyncJob')).toEqual(['post', 'heartbeat', 'sync', 'job']);
  });

  it('test_keywords_stopWordsAndSingleCharacters_shouldBeDropped', () => {
    expect(keywords('What is the job of a reducer?')).toEqual(['job', 'reducer']);
  });
});

describe('KeywordScorer', () => {
  const texts = [
    'Submit a synchronous job and stream its results.',
    'Heartbeat a synchronous job so it is not cancelled.',
    'Create a pipeline from a template.'
  ];

  it('test_score_exactTerm_shouldRankTheTextContainingItFirst', () => {
    const scores = new KeywordScorer(texts).score('which call keeps the job alive with a heartbeat');

    expect(scores[1]).toBeGreaterThan(scores[0] ?? 0);
    expect(scores[1]).toBeGreaterThan(scores[2] ?? 0);
  });

  it('test_score_noSharedTerms_shouldBeZero', () => {
    expect(new KeywordScorer(texts).score('kubernetes autoscaler')).toEqual([0, 0, 0]);
  });

  it('test_score_rareTerm_shouldOutweighCommonTerm', () => {
    const scorer = new KeywordScorer(texts);

    // "synchronous" appears in two texts, "template" in one: the rarer term carries more weight.
    expect(scorer.score('template')[2]).toBeGreaterThan(scorer.score('synchronous')[0] ?? 0);
  });
});
