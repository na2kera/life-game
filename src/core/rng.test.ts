import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, shuffle } from './rng.ts';

describe('rng', () => {
  it('同じシードなら同じ列になる', () => {
    const seq = (seed: number): number[] => {
      let r = createRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const [v, n] = nextFloat(r);
        out.push(v);
        r = n;
      }
      return out;
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
  });

  it('nextFloat は [0, 1)、nextInt は範囲内で全値が出る', () => {
    let r = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const [f] = nextFloat(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const [v, n] = nextInt(r, 1, 10);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
      seen.add(v);
      r = n;
    }
    expect(seen.size).toBe(10);
  });

  it('純粋関数: 同じ状態からは同じ値', () => {
    expect(nextInt(123, 1, 10)).toEqual(nextInt(123, 1, 10));
  });

  it('shuffle は元配列を変えず、要素を保つ', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const [out, next] = shuffle(createRng(1), src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(src);
    expect(next).not.toBe(createRng(1));
    expect(shuffle(createRng(1), src)[0]).toEqual(out);
  });
});
