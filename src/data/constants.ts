// 設計書 3 章の数値。調整はこのファイルで行う
import type { RuleConstants } from '../core/types.ts';

export const RULES: RuleConstants = {
  minPlayers: 2,
  maxPlayers: 4,
  initialMoney: 30_000,
  roulette: { min: 1, max: 10 },
  loan: {
    // 不足時に 1 万円単位で発行
    unit: 10_000,
    // 1 枚あたりの返済額（利子 2,000 込み）。ゴール時・途中返済とも同額
    repayAmount: 12_000,
  },
  insurance: {
    life: { name: '生命保険', price: 5_000 },
    fire: { name: '火災保険', price: 4_000 },
    auto: { name: '自動車保険', price: 3_000 },
  },
  lossCoverage: {
    illness: 'life',
    fire: 'fire',
    accident: 'auto',
    other: null,
  },
  stock: {
    buyPrice: 5_000,
    initialPrice: 5_000,
    maxHold: 3,
    minPrice: 1_000,
    maxPrice: 20_000,
    // 出目 1〜10 に対応する株価の変動額
    changeTable: [-3_000, -2_000, -1_000, -1_000, 0, 1_000, 1_000, 2_000, 3_000, 4_000],
  },
  marriageGiftPerPlayer: 2_000,
  childGiftPerPlayer: 1_000,
  childBonus: 10_000,
  handLimit: 3,
  cardCashValue: 5_000,
  jobCandidates: 3,
};
