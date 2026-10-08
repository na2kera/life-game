// 家の一覧。price は購入価格、value はゴール時の評価額
import type { House } from '../core/types.ts';

export const HOUSES: House[] = [
  { id: 'cottage', name: 'こぢんまりした平屋', price: 20_000, value: 25_000 },
  { id: 'loghouse', name: '森のログハウス', price: 30_000, value: 36_000 },
  { id: 'tower', name: 'ガラス張りの高層マンション', price: 40_000, value: 52_000 },
  { id: 'mansion', name: '丘の上の大邸宅', price: 80_000, value: 110_000 },
];
