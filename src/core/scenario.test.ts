// 開始からゴールまで自動で通すシナリオテスト。イベント列と最終状態の整合性を検証する。
import { describe, expect, it } from 'vitest';
import { STANDARD_DATA } from '../data/index.ts';
import { getSpace } from './board.ts';
import { usableCards } from './game.ts';
import { nextInt } from './rng.ts';
import {
  autoPlay,
  cardUserPolicy,
  firstOptionPolicy,
  newGame,
  ofType,
  type Policy,
} from './test-utils.ts';
import type { GameEvent, GameState } from './types.ts';

/** 最後の選択肢を選ぶ（進学しない・買わない・返さない など） */
const lastOptionPolicy: Policy = (state) => {
  if (state.pendingChoice) {
    const opts = state.pendingChoice.options;
    return { type: 'choose', optionId: opts[opts.length - 1].id };
  }
  return firstOptionPolicy(state);
};

/** シード付きでランダムに選ぶ（カードも半々で使う） */
function randomPolicy(seed: number): Policy {
  let rng = seed;
  const roll = (n: number): number => {
    const [v, next] = nextInt(rng, 0, n - 1);
    rng = next;
    return v;
  };
  return (state) => {
    if (state.pendingChoice) {
      const opts = state.pendingChoice.options;
      // 所持カード対象選択の「やめる」→再使用の繰り返しを避けるため、対象選択は先頭固定
      if (state.pendingChoice.kind === 'cardTarget')
        return { type: 'choose', optionId: opts[0].id };
      return { type: 'choose', optionId: opts[roll(opts.length)].id };
    }
    if (state.phase.type === 'spin' && state.phase.purpose === 'move') {
      const usable = usableCards(state);
      if (usable.length > 0 && roll(2) === 0) return { type: 'useCard', cardId: usable[0] };
    }
    return firstOptionPolicy(state);
  };
}

function verifyGame(initial: GameState, final: GameState, events: GameEvent[]): void {
  const { data } = initial;
  const n = initial.players.length;

  // --- 終了状態 ---
  expect(final.phase.type).toBe('gameOver');
  expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);
  expect(events[events.length - 1].type).toBe('gameOver');
  expect(final.finishOrder).toHaveLength(n);
  expect(new Set(final.finishOrder).size).toBe(n);
  expect(final.pendingChoice).toBeNull();
  expect(final.tasks).toEqual([]);

  // --- お金と借用証書: イベントの積み上げと最終状態が一致 ---
  const money = initial.players.map((p) => p.money);
  const loans = initial.players.map((p) => p.loans);
  // --- 位置: moved / landed が盤面の矢印に沿っている ---
  const pos = initial.players.map((p) => p.spaceId);
  let current = initial.currentPlayer;
  let pending: { id: number; playerIndex: number } | null = null;

  for (const e of events) {
    switch (e.type) {
      case 'moneyChanged':
        money[e.playerIndex] += e.delta;
        expect(e.money).toBe(money[e.playerIndex]);
        expect(e.money).toBeGreaterThanOrEqual(0);
        expect(e.delta).not.toBe(0);
        break;
      case 'loanIssued':
        loans[e.playerIndex] += e.count;
        expect(e.loans).toBe(loans[e.playerIndex]);
        expect(e.amount).toBe(e.count * data.rules.loan.unit);
        break;
      case 'loanRepaid':
        loans[e.playerIndex] -= e.count;
        expect(e.loans).toBe(loans[e.playerIndex]);
        expect(loans[e.playerIndex]).toBeGreaterThanOrEqual(0);
        break;
      case 'moved': {
        expect(e.playerIndex).toBe(current);
        expect(e.from).toBe(pos[e.playerIndex]);
        let at = e.from;
        for (const step of e.path) {
          expect(getSpace(data.board, at).next, `${at}->${step}`).toContain(step);
          at = step;
        }
        expect(e.to).toBe(at);
        pos[e.playerIndex] = at;
        break;
      }
      case 'landed':
        expect(e.spaceId).toBe(pos[e.playerIndex]);
        break;
      case 'spun':
        expect(e.value).toBeGreaterThanOrEqual(data.rules.roulette.min);
        expect(e.value).toBeLessThanOrEqual(data.rules.roulette.max);
        expect(e.total).toBe(e.value + e.bonus);
        break;
      case 'turnChanged':
        current = e.playerIndex;
        break;
      case 'choiceRequested':
        expect(pending).toBeNull();
        expect(e.choice.playerIndex).toBe(current);
        expect(e.choice.options.length).toBeGreaterThan(0);
        pending = { id: e.choice.id, playerIndex: e.choice.playerIndex };
        break;
      case 'choiceMade':
        expect(pending?.playerIndex).toBe(e.playerIndex);
        pending = null;
        break;
      case 'goal':
        expect(pos[e.playerIndex]).toBe('goal');
        break;
      default:
        break;
    }
  }
  expect(pending).toBeNull();

  for (const p of final.players) {
    expect(p.money).toBe(money[p.index]);
    expect(p.loans).toBe(loans[p.index]);
    expect(p.spaceId).toBe(pos[p.index]);
    expect(p.finished).toBe(true);
    // 両ルートに必ず止まる職業マス、合流後に必ず止まる結婚マスがある
    expect(p.jobId).not.toBeNull();
    expect(p.married).toBe(true);
    expect(p.hand.length).toBeLessThanOrEqual(data.rules.handLimit);
    expect(p.stocks).toBeLessThanOrEqual(data.rules.stock.maxHold);

    // --- 資産内訳の合計 ---
    const a = p.result!;
    expect(a.money + a.houses + a.stocks + a.cards + a.children - a.loans).toBe(a.total);
    expect(a.money).toBe(p.money);
    expect(a.loans).toBe(p.loans * data.rules.loan.repayAmount);
    expect(a.cards).toBe(p.hand.length * data.rules.cardCashValue);
    expect(a.children).toBe(p.children * data.rules.childBonus);
  }

  // --- goal イベントの資産と最終結果の一致、順位 ---
  const goals = ofType(events, 'goal');
  expect(goals.map((g) => g.playerIndex)).toEqual(final.finishOrder);
  for (const g of goals) expect(g.assets).toEqual(final.players[g.playerIndex].result);
  const result = final.result!;
  expect(result.ranking).toHaveLength(n);
  for (let i = 1; i < n; i++) {
    expect(result.ranking[i - 1].assets.total).toBeGreaterThanOrEqual(
      result.ranking[i].assets.total,
    );
  }
  const top = Math.max(...final.players.map((p) => p.result!.total));
  expect(result.winners.length).toBeGreaterThan(0);
  for (const w of result.winners) expect(final.players[w].result!.total).toBe(top);

  // --- カードの保存: 山札 + 捨て札 + 手札 = 全枚数 ---
  const totalCards = data.cards.reduce((sum, c) => sum + c.copies, 0);
  const inHands = final.players.reduce((sum, p) => sum + p.hand.length, 0);
  expect(final.deck.length + final.discard.length + inHands).toBe(totalCards);
}

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe('シナリオ: 開始からゴールまで', () => {
  for (const players of [2, 3, 4]) {
    it(`${players} 人・先頭の選択肢を選ぶ方針で全シードが完走する`, () => {
      for (const seed of SEEDS) {
        const initial = newGame(STANDARD_DATA, players, seed);
        const { state, events, actions } = autoPlay(initial, firstOptionPolicy);
        expect(actions).toBeLessThan(2_000);
        verifyGame(initial, state, events);
      }
    });
  }

  it('2 人・4 人で最後の選択肢（就職ルート・買わない等）でも完走する', () => {
    for (const players of [2, 4]) {
      for (const seed of SEEDS) {
        const initial = newGame(STANDARD_DATA, players, seed);
        const { state, events } = autoPlay(initial, lastOptionPolicy);
        verifyGame(initial, state, events);
        // 就職ルートなので学位なし
        for (const p of state.players) expect(p.degree).toBe(false);
      }
    }
  });

  it('所持カードを積極的に使う方針でも完走する', () => {
    let used = 0;
    for (const players of [2, 4]) {
      for (const seed of SEEDS) {
        const initial = newGame(STANDARD_DATA, players, seed);
        const { state, events } = autoPlay(initial, cardUserPolicy);
        verifyGame(initial, state, events);
        used += ofType(events, 'cardUsed').length;
      }
    }
    expect(used).toBeGreaterThan(0);
  });

  it('ランダムな方針でも完走する', () => {
    for (const players of [2, 3, 4]) {
      for (const seed of SEEDS) {
        const initial = newGame(STANDARD_DATA, players, seed);
        const { state, events } = autoPlay(initial, randomPolicy(seed * 31 + players));
        verifyGame(initial, state, events);
      }
    }
  });

  it('全シードを通して主要なイベントが一通り発生している', () => {
    const seen = new Set<string>();
    for (const players of [2, 4]) {
      for (const seed of SEEDS) {
        for (const policy of [firstOptionPolicy, lastOptionPolicy, cardUserPolicy]) {
          const { events } = autoPlay(newGame(STANDARD_DATA, players, seed), policy);
          for (const e of events) seen.add(e.type);
        }
      }
    }
    for (const t of [
      'spun',
      'moved',
      'landed',
      'moneyChanged',
      'salaryPaid',
      'loanIssued',
      'loanRepaid',
      'jobAssigned',
      'degreeEarned',
      'married',
      'childBorn',
      'houseBought',
      'insuranceBought',
      'stockBought',
      'stockPriceChanged',
      'eventOccurred',
      'lossExempted',
      'cardDrawn',
      'cardKept',
      'cardUsed',
      'choiceRequested',
      'choiceMade',
      'goal',
      'turnChanged',
      'gameOver',
    ]) {
      expect(seen.has(t), t).toBe(true);
    }
  });
});
