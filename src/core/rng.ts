// シード付き乱数（mulberry32）。状態は uint32 の数値 1 つで、関数はすべて純粋。

/** シードから乱数の初期状態を作る */
export function createRng(seed: number): number {
  return seed >>> 0;
}

/** [0, 1) の乱数と次の状態を返す */
export function nextFloat(rng: number): [value: number, next: number] {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** min 以上 max 以下の整数と次の状態を返す */
export function nextInt(rng: number, min: number, max: number): [value: number, next: number] {
  const [f, next] = nextFloat(rng);
  return [min + Math.floor(f * (max - min + 1)), next];
}

/** 配列をシャッフルした新しい配列と次の状態を返す（Fisher–Yates） */
export function shuffle<T>(rng: number, items: readonly T[]): [result: T[], next: number] {
  const result = [...items];
  let state = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, 0, i);
    state = next;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, state];
}
