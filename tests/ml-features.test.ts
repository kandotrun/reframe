import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FEATURE_DIM, frozenEmbedding, lexicalScores, normalizeText, textFeatures,
} from '../src/ml/features';

type ParityFixtures = {
  texts: string[];
  features: { index: number; value: number }[][];
  embeddings: number[][];
  tolerance: number;
};

describe('portable ML preprocessing', () => {
  it('matches Python features for Japanese, normalized Unicode, emoji and empty input', () => {
    const fixtures: ParityFixtures = JSON.parse(readFileSync(
      resolve('public/models/parity-fixtures.json'), 'utf8',
    ));
    fixtures.texts.forEach((text, index) => {
      const actual = textFeatures(text);
      const expected = new Float32Array(FEATURE_DIM);
      for (const { index: column, value } of fixtures.features[index]!) expected[column] = value;
      expect(actual.length).toBe(expected.length);
      for (let column = 0; column < FEATURE_DIM; column++) {
        expect(Math.abs(actual[column]! - expected[column]!)).toBeLessThan(fixtures.tolerance);
      }
    });
  });

  it('normalizes full-width letters and whitespace without dropping Japanese or emoji', () => {
    expect(normalizeText(' ＡＢＣ　１２３、検査🙂\n').join('')).toBe('abc123検査🙂');
  });

  it('makes the untrained baseline deterministic and handles empty text', () => {
    const embedding = frozenEmbedding(textFeatures('ロットの材料証明書'));
    expect(Array.from(embedding)).toEqual(Array.from(frozenEmbedding(textFeatures('ロットの材料証明書'))));
    expect(Math.abs(Array.from(embedding).reduce((sum, n) => sum + n * n, 0) - 1)).toBeLessThan(1e-5);
    expect(Array.from(frozenEmbedding(textFeatures(''))).every((n) => n === 0)).toBe(true);
  });

  it('uses the query in the lexical baseline and gives empty queries zero scores', () => {
    const documents = ['出荷前に材料証明書のロット番号を確認する', '湿度を記録して包装用の乾燥剤を交換する'];
    const certificate = lexicalScores('材料証明書とロット番号', documents);
    const humidity = lexicalScores('湿度と乾燥剤', documents);
    expect(certificate[0]).toBeGreaterThan(certificate[1]!);
    expect(humidity[1]).toBeGreaterThan(humidity[0]!);
    expect(lexicalScores('', documents)).toEqual([0, 0]);
  });
});
