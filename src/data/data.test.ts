import { describe, expect, it } from 'vitest';
import { validateGameData } from '../core/game.ts';
import { CARDS } from './cards.ts';
import { RULES } from './constants.ts';
import { STANDARD_DATA } from './index.ts';
import { JOBS } from './jobs.ts';

describe('ゲームデータ', () => {
  it('整合性エラーがない', () => {
    expect(validateGameData(STANDARD_DATA)).toEqual([]);
  });

  it('設計書 3 章の数値', () => {
    expect(RULES.initialMoney).toBe(30_000);
    expect(RULES.roulette).toEqual({ min: 1, max: 10 });
    expect(RULES.loan).toEqual({ unit: 10_000, repayAmount: 12_000 });
    expect(RULES.stock.buyPrice).toBe(5_000);
    expect(RULES.stock.maxHold).toBe(3);
    expect(RULES.handLimit).toBe(3);
    expect(RULES.minPlayers).toBe(2);
    expect(RULES.maxPlayers).toBe(4);
  });

  it('学位が必要な職業と不要な職業の両方がある', () => {
    expect(JOBS.some((j) => j.requiresDegree)).toBe(true);
    expect(JOBS.some((j) => !j.requiresDegree)).toBe(true);
  });

  it('カードは全効果種別をカバーしている', () => {
    const types = new Set(CARDS.map((c) => c.effect.type));
    for (const t of ['money', 'collect', 'advance', 'spinBonus', 'lossShield', 'stealSalary']) {
      expect(types.has(t as never), t).toBe(true);
    }
  });

  it('損失種別ごとの保険対応', () => {
    expect(RULES.lossCoverage).toEqual({
      illness: 'life',
      fire: 'fire',
      accident: 'auto',
      other: null,
    });
  });
});
