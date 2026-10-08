// 状態機械（ターン進行）。入力はアクション、出力は新しい state とイベント列。
// applyAction は受け取った state を変更しない（内部で複製してから更新する）。
import { validateBoard } from './board.ts';
import { createRng, nextInt, shuffle } from './rng.ts';
import {
  applyStockChange,
  buildResult,
  isCardUsableNow,
  landOn,
  move,
  resolveChoice,
  useCard,
  type Ctx,
} from './rules.ts';
import type {
  Action,
  ActionResult,
  GameConfig,
  GameData,
  GameEvent,
  GameState,
  Player,
  Task,
} from './types.ts';

/** 1 アクションで処理するタスク数の上限（無限ループ検出用） */
const MAX_TASKS_PER_ACTION = 10_000;

/** ゲームデータの整合性を検証し、問題点の一覧を返す（空なら正常） */
export function validateGameData(data: GameData): string[] {
  const errors = validateBoard(data.board);
  const { rules } = data;
  const unique = (label: string, ids: string[]): void => {
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dup.length > 0) errors.push(`duplicate ${label} id: ${dup.join(', ')}`);
  };
  unique(
    'job',
    data.jobs.map((j) => j.id),
  );
  unique(
    'house',
    data.houses.map((h) => h.id),
  );
  unique(
    'card',
    data.cards.map((c) => c.id),
  );

  for (const s of data.board.spaces) {
    if (s.kind === 'house') {
      for (const id of s.houseIds) {
        if (!data.houses.some((h) => h.id === id)) errors.push(`${s.id}: unknown house ${id}`);
      }
    }
    if (s.kind === 'child' && s.count <= 0) errors.push(`${s.id}: child count must be > 0`);
  }
  if (!data.jobs.some((j) => !j.requiresDegree)) errors.push('no job without degree');
  const rouletteSize = rules.roulette.max - rules.roulette.min + 1;
  if (rules.stock.changeTable.length !== rouletteSize) {
    errors.push('stock.changeTable length must match roulette range');
  }
  if (!Number.isInteger(rules.jobCandidates) || rules.jobCandidates < 1) {
    errors.push('jobCandidates must be an integer >= 1');
  }
  if (rules.roulette.min < 1) errors.push('roulette.min must be >= 1');
  if (rules.loan.unit <= 0) errors.push('loan.unit must be > 0');
  for (const c of data.cards) {
    const holdEffect =
      c.effect.type === 'spinBonus' ||
      c.effect.type === 'lossShield' ||
      c.effect.type === 'stealSalary';
    if (holdEffect !== (c.kind === 'hold')) errors.push(`card ${c.id}: kind/effect mismatch`);
    if (c.copies < 0) errors.push(`card ${c.id}: copies must be >= 0`);
  }
  return errors;
}

export function createGame(config: GameConfig): GameState {
  const { seed } = config;
  const errors = validateGameData(config.data);
  if (errors.length > 0) throw new Error(`invalid game data:\n${errors.join('\n')}`);
  // 呼び出し元の data と切り離し、凍結した複製を以後の state で共有する
  const data = deepFreeze(deepClone(config.data));
  const { rules } = data;
  if (config.players.length < rules.minPlayers || config.players.length > rules.maxPlayers) {
    throw new Error(`players must be ${rules.minPlayers}-${rules.maxPlayers}`);
  }

  const fullDeck = data.cards.flatMap((c) => Array.from({ length: c.copies }, () => c.id));
  const [deck, rng] = shuffle(createRng(seed), fullDeck);
  const players: Player[] = config.players.map((p, index) => ({
    index,
    name: p.name,
    spaceId: data.board.startId,
    money: rules.initialMoney,
    jobId: null,
    degree: false,
    married: false,
    children: 0,
    houseIds: [],
    insurances: [],
    stocks: 0,
    loans: 0,
    hand: [],
    spinBonus: 0,
    finished: false,
    result: null,
  }));

  return {
    data,
    players,
    currentPlayer: 0,
    turn: 1,
    phase: { type: 'spin', purpose: 'move' },
    pendingChoice: null,
    tasks: [],
    stockPrice: rules.stock.initialPrice,
    deck,
    discard: [],
    rng,
    finishOrder: [],
    result: null,
    nextChoiceId: 1,
  };
}

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v: unknown) => deepClone(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepClone(v);
    return out as T;
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** data（createGame で凍結済みの静的な定義）は共有し、それ以外を複製する */
function cloneState(state: GameState): GameState {
  const { data, ...rest } = state;
  return { ...deepClone(rest), data };
}

export function applyAction(state: GameState, action: Action): ActionResult {
  const reject = (reason: string): ActionResult => ({
    state,
    events: [{ type: 'actionRejected', action, reason }],
  });
  const s = cloneState(state);
  const ctx: Ctx = { s, events: [] };

  switch (action.type) {
    case 'spin': {
      if (s.phase.type !== 'spin') return reject('not waiting for spin');
      spin(ctx, s.phase.purpose);
      break;
    }
    case 'choose': {
      if (s.phase.type !== 'choice' || !s.pendingChoice) return reject('no pending choice');
      const error = resolveChoice(ctx, action.optionId);
      if (error) return reject(error);
      break;
    }
    case 'useCard': {
      const error = useCard(ctx, action.cardId);
      if (error) return reject(error);
      break;
    }
    case 'next': {
      if (s.phase.type !== 'turnEnd') return reject('turn is not over');
      advanceTurn(ctx);
      break;
    }
  }
  run(ctx);
  return { state: s, events: ctx.events };
}

function spin(ctx: Ctx, purpose: 'move' | 'stockChange'): void {
  const s = ctx.s;
  const p = s.players[s.currentPlayer];
  const { min, max } = s.data.rules.roulette;
  const [value, next] = nextInt(s.rng, min, max);
  s.rng = next;
  if (purpose === 'move') {
    const bonus = p.spinBonus;
    p.spinBonus = 0;
    ctx.events.push({
      type: 'spun',
      playerIndex: p.index,
      purpose,
      value,
      bonus,
      total: value + bonus,
    });
    s.phase = { type: 'resolving' };
    s.tasks.push({ type: 'endTurn' }, { type: 'move', steps: value + bonus });
  } else {
    ctx.events.push({ type: 'spun', playerIndex: p.index, purpose, value, bonus: 0, total: value });
    applyStockChange(ctx, value);
    s.phase = { type: 'resolving' };
  }
}

/** 待ち状態（spin / choice / turnEnd / gameOver）になるまでタスクを処理する */
function run(ctx: Ctx): void {
  const s = ctx.s;
  let count = 0;
  while (s.phase.type === 'resolving') {
    count += 1;
    if (count > MAX_TASKS_PER_ACTION) throw new Error('task loop did not terminate');
    const task = s.tasks.pop();
    if (!task) {
      // 手番開始前の処理（所持カードの対象選択など）が終わった
      s.phase = { type: 'spin', purpose: 'move' };
      break;
    }
    execute(ctx, task);
  }
}

function execute(ctx: Ctx, task: Task): void {
  switch (task.type) {
    case 'move':
      move(ctx, task.steps, task.forcedNext);
      break;
    case 'land':
      landOn(ctx, task.spaceId);
      break;
    case 'endTurn':
      endTurn(ctx);
      break;
  }
}

function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  if (s.players.every((p) => p.finished)) {
    s.result = buildResult(s);
    s.phase = { type: 'gameOver' };
    ctx.events.push({ type: 'gameOver', result: s.result });
    return;
  }
  s.phase = { type: 'turnEnd' };
}

function advanceTurn(ctx: Ctx): void {
  const s = ctx.s;
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (s.currentPlayer + i) % n;
    if (!s.players[idx].finished) {
      s.currentPlayer = idx;
      break;
    }
  }
  s.turn += 1;
  s.phase = { type: 'spin', purpose: 'move' };
  ctx.events.push({ type: 'turnChanged', playerIndex: s.currentPlayer, turn: s.turn });
}

/**
 * ゲーム開始時のイベント（UI 用）。createGame 直後に一度だけ演出する。
 * 2 手番目以降は next の結果として turnChanged が出るので、最初の手番もこれで揃える。
 */
export function initialEvents(state: GameState): GameEvent[] {
  return [{ type: 'turnChanged', playerIndex: state.currentPlayer, turn: state.turn }];
}

/** 現在の手番で使える所持カード（UI 用） */
export function usableCards(state: GameState): string[] {
  const p = state.players[state.currentPlayer];
  return [...new Set(p.hand)].filter((id) => isCardUsableNow(state, id));
}

export { computeAssets } from './rules.ts';
