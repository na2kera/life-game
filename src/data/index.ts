// 標準のゲームデータ一式
import type { GameData } from '../core/types.ts';
import { BOARD_SHORT } from './board-short.ts';
import { CARDS } from './cards.ts';
import { RULES } from './constants.ts';
import { HOUSES } from './houses.ts';
import { JOBS } from './jobs.ts';

export const STANDARD_DATA: GameData = {
  board: BOARD_SHORT,
  jobs: JOBS,
  houses: HOUSES,
  cards: CARDS,
  rules: RULES,
};
