import { describe, expect, it } from 'vitest';
import { getLastInference, rankCandidates } from '../src/ml/ranker';

describe('ranking boundary', () => {
  it('preserves input order for tied empty-query scores without claiming WASM execution', async () => {
    const result = await rankCandidates('', [
      { id: 'z', text: '同じ資料' },
      { id: 'a', text: '同じ資料' },
    ], 'trained');
    expect(result).toEqual([{ id: 'z', score: 0 }, { id: 'a', score: 0 }]);
    expect(getLastInference()?.backend).toBe('javascript');
  });

  it('ranks arbitrary input text differently with the actual lexical implementation', async () => {
    const candidates = [
      { id: 'material', text: '材料証明書のロット番号を出荷前に確認する' },
      { id: 'humidity', text: '包装内の湿度と乾燥剤を確認する' },
    ];
    expect((await rankCandidates('材料証明書とロット番号', candidates, 'lexical'))[0]?.id).toBe('material');
    expect((await rankCandidates('湿度と乾燥剤', candidates, 'lexical'))[0]?.id).toBe('humidity');
    expect(getLastInference()?.candidateCount).toBe(2);
  });

  it('rejects ambiguous duplicate candidate IDs', async () => {
    await expect(rankCandidates('検査', [{ id: 'x', text: '検査' }, { id: 'x', text: '包装' }], 'lexical'))
      .rejects.toThrow('unique');
  });

  it('enforces a finite client-side workload', async () => {
    await expect(rankCandidates('検査', Array.from({ length: 513 }, (_, index) => ({
      id: String(index), text: '確認',
    })), 'lexical')).rejects.toThrow('512');
  });
});
