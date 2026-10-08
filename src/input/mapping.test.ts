import { describe, expect, it } from 'vitest';
import {
  activeRawInputs,
  detectBinding,
  formatBinding,
  hatToDirections,
  isMapping,
  parseMappings,
  resolve,
  serializeMappings,
  type GamepadSnapshot,
  type Mapping,
} from './mapping.ts';

const HAT_NEUTRAL = 9 / 7; // ≒ 1.2857

const snap = (buttons: number[] = [], axes: number[] = []): GamepadSnapshot => {
  const b: boolean[] = Array.from({ length: 16 }, () => false);
  for (const i of buttons) b[i] = true;
  return { buttons: b, axes };
};

const MAPPING: Mapping = {
  confirm: [{ kind: 'button', index: 0 }],
  cancel: [{ kind: 'button', index: 1 }],
  up: [
    { kind: 'button', index: 12 },
    { kind: 'axis', index: 1, sign: -1 },
    { kind: 'hat', index: 9, direction: 'up' },
  ],
  down: [
    { kind: 'axis', index: 1, sign: 1 },
    { kind: 'hat', index: 9, direction: 'down' },
  ],
  left: [
    { kind: 'axis', index: 0, sign: -1 },
    { kind: 'hat', index: 9, direction: 'left' },
  ],
  right: [
    { kind: 'axis', index: 0, sign: 1 },
    { kind: 'hat', index: 9, direction: 'right' },
  ],
};

const axes = (x: number, y: number, hat = HAT_NEUTRAL): number[] => {
  const a = Array.from({ length: 10 }, () => 0);
  a[0] = x;
  a[1] = y;
  a[9] = hat;
  return a;
};

describe('hatToDirections', () => {
  it('8 方向を上から時計回りに解釈し、斜めは 2 方向を含む', () => {
    expect(hatToDirections(-1)).toEqual(['up']);
    expect(hatToDirections(-5 / 7).sort()).toEqual(['right', 'up']);
    expect(hatToDirections(-3 / 7)).toEqual(['right']);
    expect(hatToDirections(-1 / 7).sort()).toEqual(['down', 'right']);
    expect(hatToDirections(1 / 7)).toEqual(['down']);
    expect(hatToDirections(3 / 7).sort()).toEqual(['down', 'left']);
    expect(hatToDirections(5 / 7)).toEqual(['left']);
    expect(hatToDirections(1).sort()).toEqual(['left', 'up']);
  });

  it('ニュートラル（範囲外）・0・格子から外れた値・NaN は空', () => {
    expect(hatToDirections(HAT_NEUTRAL)).toEqual([]);
    expect(hatToDirections(1.28571)).toEqual([]);
    expect(hatToDirections(0)).toEqual([]);
    expect(hatToDirections(0.3)).toEqual([]);
    expect(hatToDirections(Number.NaN)).toEqual([]);
  });

  it('小さな誤差は許容する', () => {
    expect(hatToDirections(-0.42857)).toEqual(['right']);
    expect(hatToDirections(0.71429)).toEqual(['left']);
  });
});

describe('resolve', () => {
  it('ボタンを解決する', () => {
    expect([...resolve(MAPPING, snap([0], axes(0, 0)))]).toEqual(['confirm']);
    expect([...resolve(MAPPING, snap([1, 12], axes(0, 0)))].sort()).toEqual(['cancel', 'up']);
  });

  it('軸は閾値 0.5 以上で入る', () => {
    expect(resolve(MAPPING, snap([], axes(0.49, 0))).size).toBe(0);
    expect([...resolve(MAPPING, snap([], axes(0.5, 0)))]).toEqual(['right']);
    expect([...resolve(MAPPING, snap([], axes(0, -0.8)))]).toEqual(['up']);
    expect([...resolve(MAPPING, snap([], axes(-0.7, 0.9)))].sort()).toEqual(['down', 'left']);
  });

  it('ハット軸を解決し、斜めは 2 方向になる', () => {
    expect([...resolve(MAPPING, snap([], axes(0, 0, -1)))]).toEqual(['up']);
    expect([...resolve(MAPPING, snap([], axes(0, 0, 3 / 7)))].sort()).toEqual(['down', 'left']);
    expect(resolve(MAPPING, snap([], axes(0, 0, HAT_NEUTRAL))).size).toBe(0);
  });

  it('ハットのニュートラル値は通常の軸として倒れた扱いにしない', () => {
    const m: Mapping = { ...MAPPING, right: [{ kind: 'axis', index: 9, sign: 1 }] };
    expect(resolve(m, snap([], axes(0, 0, HAT_NEUTRAL))).size).toBe(0);
  });

  it('存在しないボタン・軸は押されていない扱い', () => {
    expect(resolve(MAPPING, { buttons: [], axes: [] }).size).toBe(0);
  });
});

describe('detectBinding', () => {
  it('新しく押されたボタンを返す（押しっぱなしは返さない）', () => {
    expect(detectBinding(snap([], axes(0, 0)), snap([3], axes(0, 0)))).toEqual({
      kind: 'button',
      index: 3,
    });
    expect(detectBinding(snap([3], axes(0, 0)), snap([3], axes(0, 0)))).toBeNull();
  });

  it('新しく閾値を超えた軸を符号付きで返す', () => {
    expect(detectBinding(snap([], axes(0, 0)), snap([], axes(-0.9, 0)))).toEqual({
      kind: 'axis',
      index: 0,
      sign: -1,
    });
    expect(detectBinding(snap([], axes(0, 0.4)), snap([], axes(0, 0.6)))).toEqual({
      kind: 'axis',
      index: 1,
      sign: 1,
    });
    expect(detectBinding(snap([], axes(0.8, 0)), snap([], axes(0.9, 0)))).toBeNull();
    expect(detectBinding(snap([], axes(0, 0)), snap([], axes(0.3, 0)))).toBeNull();
  });

  it('ニュートラルから入ったハット軸は hat として返す', () => {
    expect(detectBinding(snap([], axes(0, 0)), snap([], axes(0, 0, -3 / 7)))).toEqual({
      kind: 'hat',
      index: 9,
      direction: 'right',
    });
    // ハットがニュートラルに戻るのは新しい入力ではない
    expect(detectBinding(snap([], axes(0, 0, -1)), snap([], axes(0, 0)))).toBeNull();
  });

  it('斜めは拾わず、上下左右に入った時点で拾う', () => {
    expect(detectBinding(snap([], axes(0, 0)), snap([], axes(0, 0, -5 / 7)))).toBeNull();
    // 斜め → 上は値が両方 -1〜1 内なので、ハット軸と分かっている（hatAxes）前提
    expect(
      detectBinding(snap([], axes(0, 0, -5 / 7)), snap([], axes(0, 0, -1)), new Set([9])),
    ).toEqual({ kind: 'hat', index: 9, direction: 'up' });
  });

  it('hatAxes で既知のハット軸は方向の切り替わりも拾う', () => {
    expect(
      detectBinding(snap([], axes(0, 0, -1)), snap([], axes(0, 0, -3 / 7)), new Set([9])),
    ).toEqual({ kind: 'hat', index: 9, direction: 'right' });
  });

  it('ボタンを軸より優先する', () => {
    expect(detectBinding(snap([], axes(0, 0)), snap([2], axes(1, 0)))).toEqual({
      kind: 'button',
      index: 2,
    });
  });
});

describe('activeRawInputs / formatBinding', () => {
  it('押されている生入力を表示用に列挙する', () => {
    const list = activeRawInputs(snap([1], axes(-0.9, 0, -1)), new Set([9]));
    expect(list.map(formatBinding)).toEqual(['button 1', 'axis 0 -', 'hat 9 up']);
  });

  it('ハットのニュートラル値は表示しない', () => {
    expect(activeRawInputs(snap([], axes(0, 0, HAT_NEUTRAL)))).toEqual([]);
  });
});

describe('シリアライズ / 検証', () => {
  it('往復で同じ内容になる', () => {
    const json = serializeMappings({ 'pad-a': MAPPING });
    expect(parseMappings(json)).toEqual({ 'pad-a': MAPPING });
  });

  it('壊れた JSON や想定外の形は空にする', () => {
    expect(parseMappings(null)).toEqual({});
    expect(parseMappings('')).toEqual({});
    expect(parseMappings('{not json')).toEqual({});
    expect(parseMappings('[]')).toEqual({});
    expect(parseMappings('42')).toEqual({});
  });

  it('不正なエントリだけを落とす', () => {
    const broken = {
      ok: MAPPING,
      missingButton: { ...MAPPING, cancel: undefined },
      emptyList: { ...MAPPING, up: [] },
      badKind: { ...MAPPING, up: [{ kind: 'trigger', index: 0 }] },
      badSign: { ...MAPPING, up: [{ kind: 'axis', index: 0, sign: 2 }] },
      badDirection: { ...MAPPING, up: [{ kind: 'hat', index: 9, direction: 'north' }] },
      badIndex: { ...MAPPING, up: [{ kind: 'button', index: -1 }] },
      notObject: 'x',
    };
    expect(Object.keys(parseMappings(JSON.stringify(broken)))).toEqual(['ok']);
  });

  it('余計なプロパティは落とす', () => {
    const extra = { ...MAPPING, confirm: [{ kind: 'button', index: 0, junk: true }] };
    const parsed = parseMappings(JSON.stringify({ a: extra }));
    expect(parsed.a.confirm).toEqual([{ kind: 'button', index: 0 }]);
  });

  it('isMapping', () => {
    expect(isMapping(MAPPING)).toBe(true);
    expect(isMapping(null)).toBe(false);
    expect(isMapping({})).toBe(false);
  });
});
