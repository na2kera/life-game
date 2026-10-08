import { describe, expect, it } from 'vitest';
import { BOARD_SHORT } from '../data/board-short.ts';
import { getSpace, validateBoard } from './board.ts';
import type { Board } from './types.ts';

describe('短縮版の盤面', () => {
  it('検証エラーがない', () => {
    expect(validateBoard(BOARD_SHORT)).toEqual([]);
  });

  it('約 30 マスで、必要な種別がそろっている', () => {
    expect(BOARD_SHORT.spaces.length).toBeGreaterThanOrEqual(28);
    expect(BOARD_SHORT.spaces.length).toBeLessThanOrEqual(36);
    const kinds = new Set(BOARD_SHORT.spaces.map((s) => s.kind));
    for (const k of [
      'start',
      'branch',
      'salary',
      'job',
      'marriage',
      'child',
      'house',
      'event',
      'card',
      'insurance',
      'stock',
      'stockChange',
      'jobChange',
      'goal',
    ] as const) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it('隣り合うマスは 1m 間隔で、座標は重ならない', () => {
    const keys = new Set<string>();
    for (const s of BOARD_SHORT.spaces) {
      const key = `${s.position.x},${s.position.z}`;
      expect(keys.has(key), key).toBe(false);
      keys.add(key);
      for (const n of s.next) {
        const t = getSpace(BOARD_SHORT, n);
        const d = Math.hypot(t.position.x - s.position.x, t.position.z - s.position.z);
        expect(d, `${s.id}->${n}`).toBeCloseTo(1);
      }
    }
  });

  it('進学ルートと就職ルートに分岐し、合流する。進学ルートの方が長い', () => {
    const branch = BOARD_SHORT.spaces.find((s) => s.kind === 'branch');
    expect(branch?.next).toHaveLength(2);
    const pathLength = (from: string): { length: number; end: string } => {
      let id = from;
      let length = 1;
      // 合流点（2 本以上の矢印が入るマス）まで辿る
      const incoming = (x: string): number =>
        BOARD_SHORT.spaces.filter((s) => s.next.includes(x)).length;
      while (incoming(getSpace(BOARD_SHORT, id).next[0]) < 2) {
        id = getSpace(BOARD_SHORT, id).next[0];
        length += 1;
      }
      return { length, end: getSpace(BOARD_SHORT, id).next[0] };
    };
    const [college, work] = branch!.next.map(pathLength);
    expect(college.end).toBe(work.end);
    expect(college.length).toBeGreaterThan(work.length);
  });

  it('結婚マスと職業マスは必ず止まる', () => {
    for (const s of BOARD_SHORT.spaces) {
      if (s.kind === 'marriage' || s.kind === 'job') expect(s.mustStop, s.id).toBe(true);
    }
  });

  it('ラベルは空でない', () => {
    for (const s of BOARD_SHORT.spaces) expect(s.label.length).toBeGreaterThan(0);
  });
});

describe('validateBoard', () => {
  const base = (): Board => ({
    id: 't',
    startId: 'a',
    spaces: [
      { id: 'a', kind: 'start', label: 'a', next: ['b'], position: { x: 0, z: 0 } },
      { id: 'b', kind: 'blank', label: 'b', next: ['g'], position: { x: 1, z: 0 } },
      { id: 'g', kind: 'goal', label: 'g', next: [], position: { x: 2, z: 0 } },
    ],
  });

  it('正しい盤面はエラーなし', () => {
    expect(validateBoard(base())).toEqual([]);
  });

  it('存在しない next を検出', () => {
    const b = base();
    b.spaces[1].next = ['zzz'];
    expect(validateBoard(b).join()).toContain('unknown next');
  });

  it('循環を検出', () => {
    const b = base();
    b.spaces[1].next = ['a'];
    expect(validateBoard(b).join()).toContain('cycle');
  });

  it('branch 以外の分岐を検出', () => {
    const b = base();
    b.spaces[0].next = ['b', 'g'];
    expect(validateBoard(b).join()).toContain('only branch can fork');
  });
});
