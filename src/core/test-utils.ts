// テスト用ヘルパー（本番コードからは使わない）
import { RULES } from '../data/constants.ts';
import { CARDS } from '../data/cards.ts';
import { HOUSES } from '../data/houses.ts';
import { JOBS } from '../data/jobs.ts';
import { applyAction, createGame, usableCards } from './game.ts';
import type {
  Action,
  Card,
  GameData,
  GameEvent,
  GameState,
  RuleConstants,
  Space,
  SpaceEffect,
} from './types.ts';

export type SpaceSpec = SpaceEffect & { id?: string; mustStop?: boolean };

/**
 * 一本道の盤面を作る。start → specs... → goal。
 * roll を指定するとルーレットの出目が常にその値になる。
 */
export function linearData(
  specs: SpaceSpec[],
  options: { roll?: number; rules?: Partial<RuleConstants>; cards?: Card[] } = {},
): GameData {
  const ids = ['start', ...specs.map((s, i) => s.id ?? `s${i + 1}`), 'goal'];
  const spaces: Space[] = [
    { id: 'start', kind: 'start', label: 'start', next: [ids[1]], position: { x: 0, z: 0 } },
    ...specs.map((spec, i): Space => ({
      ...spec,
      id: ids[i + 1],
      label: ids[i + 1],
      next: [ids[i + 2]],
      position: { x: i + 1, z: 0 },
    })),
    { id: 'goal', kind: 'goal', label: 'goal', next: [], position: { x: ids.length - 1, z: 0 } },
  ];
  const data: GameData = {
    board: { id: 'test', startId: 'start', spaces },
    jobs: JOBS,
    houses: HOUSES,
    cards: options.cards ?? CARDS,
    rules: { ...RULES, ...options.rules },
  };
  return options.roll === undefined ? data : fixRoll(data, options.roll);
}

/** ルーレットの出目を常に roll にしたデータを返す（株価変動表も出目に合わせて縮める） */
export function fixRoll(data: GameData, roll: number): GameData {
  const { rules } = data;
  return {
    ...data,
    rules: {
      ...rules,
      roulette: { min: roll, max: roll },
      stock: {
        ...rules.stock,
        changeTable: [rules.stock.changeTable[roll - rules.roulette.min] ?? 0],
      },
    },
  };
}

export function newGame(data: GameData, players = 2, seed = 1): GameState {
  return createGame({
    data,
    seed,
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i + 1}` })),
  });
}

/** アクションを順に適用する。拒否されたら例外 */
export function act(
  state: GameState,
  ...actions: Action[]
): { state: GameState; events: GameEvent[] } {
  let s = state;
  const events: GameEvent[] = [];
  for (const action of actions) {
    const r = applyAction(s, action);
    const rejected = r.events.find((e) => e.type === 'actionRejected');
    if (rejected) throw new Error(`rejected: ${JSON.stringify(rejected)}`);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export function ofType<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** 自動プレイの方針: 次に取るアクションを返す */
export type Policy = (state: GameState) => Action;

/** pendingChoice があれば先頭の選択肢、なければ spin / next */
export const firstOptionPolicy: Policy = (state) => {
  if (state.pendingChoice) return { type: 'choose', optionId: state.pendingChoice.options[0].id };
  if (state.phase.type === 'turnEnd') return { type: 'next' };
  return { type: 'spin' };
};

/** firstOptionPolicy に加え、使える所持カードがあればルーレット前に使う */
export const cardUserPolicy: Policy = (state) => {
  if (state.phase.type === 'spin' && state.phase.purpose === 'move') {
    const usable = usableCards(state);
    if (usable.length > 0) return { type: 'useCard', cardId: usable[0] };
  }
  return firstOptionPolicy(state);
};

export function autoPlay(
  state: GameState,
  policy: Policy,
  maxActions = 5_000,
): { state: GameState; events: GameEvent[]; actions: number } {
  let s = state;
  const events: GameEvent[] = [];
  let actions = 0;
  while (s.phase.type !== 'gameOver') {
    if (actions >= maxActions) throw new Error(`game did not finish within ${maxActions} actions`);
    const r = applyAction(s, policy(s));
    const rejected = r.events.find((e) => e.type === 'actionRejected');
    if (rejected) throw new Error(`rejected: ${JSON.stringify(rejected)}`);
    s = r.state;
    events.push(...r.events);
    actions += 1;
  }
  return { state: s, events, actions };
}

/** オブジェクトを再帰的に凍結する（イミュータブル性の検証用） */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
