import { describe, expect, it } from 'vitest';
import { STANDARD_DATA } from '../data/index.ts';
import { applyAction, createGame, initialEvents, usableCards, validateGameData } from './game.ts';
import { computeAssets } from './rules.ts';
import {
  act,
  autoPlay,
  deepFreeze,
  firstOptionPolicy,
  fixRoll,
  linearData,
  newGame,
  ofType,
} from './test-utils.ts';
import type { Card, GameState } from './types.ts';

const card = (id: string): Card => {
  const c = STANDARD_DATA.cards.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return { ...c, copies: 1 };
};

/** createGame 直後の state を編集する（テストの前提づくり用） */
function setup(state: GameState, edit: (s: GameState) => void): GameState {
  edit(state);
  return state;
}

describe('createGame', () => {
  it('初期状態', () => {
    const s = newGame(STANDARD_DATA, 3, 5);
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(p.money).toBe(30_000);
      expect(p.spaceId).toBe('st');
      expect(p.jobId).toBeNull();
      expect(p.loans).toBe(0);
    }
    expect(s.phase).toEqual({ type: 'spin', purpose: 'move' });
    expect(s.pendingChoice).toBeNull();
    expect(s.stockPrice).toBe(5_000);
    const totalCopies = STANDARD_DATA.cards.reduce((n, c) => n + c.copies, 0);
    expect(s.deck).toHaveLength(totalCopies);
  });

  it('人数は 2〜4 人', () => {
    expect(() => newGame(STANDARD_DATA, 1)).toThrow();
    expect(() => newGame(STANDARD_DATA, 5)).toThrow();
    expect(() => newGame(STANDARD_DATA, 4)).not.toThrow();
  });

  it('不正なデータは拒否', () => {
    const data = linearData([{ kind: 'house', houseIds: ['nope'] }]);
    expect(() => newGame(data)).toThrow(/unknown house/);
  });
});

describe('applyAction の基本', () => {
  it('入力の state を変更しない', () => {
    const s = deepFreeze(newGame(STANDARD_DATA, 2, 9));
    const snapshot = JSON.stringify(s);
    let cur: GameState = s;
    for (let i = 0; i < 30; i++) {
      deepFreeze(cur);
      cur = applyAction(cur, firstOptionPolicy(cur)).state;
    }
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('不正なアクションは actionRejected を返し、state はそのまま', () => {
    const s = newGame(STANDARD_DATA);
    for (const action of [
      { type: 'choose', optionId: 'x' } as const,
      { type: 'next' } as const,
      { type: 'useCard', cardId: 'boost' } as const,
    ]) {
      const r = applyAction(s, action);
      expect(r.state).toBe(s);
      expect(r.events.map((e) => e.type)).toEqual(['actionRejected']);
    }
  });

  it('選択肢にない id は拒否', () => {
    let s = newGame(linearData([{ kind: 'stock' }], { roll: 1 }));
    s = act(s, { type: 'spin' }).state;
    expect(s.pendingChoice?.kind).toBe('stock');
    const r = applyAction(s, { type: 'choose', optionId: 'zzz' });
    expect(r.state).toBe(s);
    expect(r.events[0].type).toBe('actionRejected');
    expect(applyAction(s, { type: 'spin' }).events[0].type).toBe('actionRejected');
  });

  it('同じシードなら同じ展開になる', () => {
    const a = autoPlay(newGame(STANDARD_DATA, 3, 77), firstOptionPolicy);
    const b = autoPlay(newGame(STANDARD_DATA, 3, 77), firstOptionPolicy);
    expect(b.events).toEqual(a.events);
    const c = autoPlay(newGame(STANDARD_DATA, 3, 78), firstOptionPolicy);
    expect(c.events).not.toEqual(a.events);
  });
});

describe('移動', () => {
  it('出目の数だけ進み、moved.path に通過マスが並ぶ', () => {
    const s = newGame(
      linearData([{ kind: 'blank' }, { kind: 'blank' }, { kind: 'blank' }], { roll: 3 }),
    );
    const r = act(s, { type: 'spin' });
    expect(ofType(r.events, 'spun')[0]).toMatchObject({ value: 3, total: 3 });
    expect(ofType(r.events, 'moved')).toEqual([
      { type: 'moved', playerIndex: 0, from: 'start', to: 's3', path: ['s1', 's2', 's3'] },
    ]);
    expect(r.state.players[0].spaceId).toBe('s3');
    expect(r.state.phase.type).toBe('turnEnd');
  });

  it('next で次のプレイヤーへ', () => {
    const s = newGame(linearData([{ kind: 'blank' }, { kind: 'blank' }], { roll: 1 }), 3);
    const r = act(s, { type: 'spin' }, { type: 'next' });
    expect(r.state.currentPlayer).toBe(1);
    expect(r.state.turn).toBe(2);
    expect(ofType(r.events, 'turnChanged')).toEqual([
      { type: 'turnChanged', playerIndex: 1, turn: 2 },
    ]);
  });

  it('分岐で選択待ちになり、選んだルートへ残りの出目で進む', () => {
    const data = fixRoll(STANDARD_DATA, 3);
    let r = act(newGame(data), { type: 'spin' });
    expect(r.state.players[0].spaceId).toBe('br');
    const choice = r.state.pendingChoice;
    expect(choice).toMatchObject({ kind: 'branch', spaceId: 'br', steps: 2, playerIndex: 0 });
    expect(choice?.options).toEqual([
      { id: 'c01', label: '進学ルート' },
      { id: 'w01', label: '就職ルート' },
    ]);

    // 就職ルート: w01 は必ず止まる職業マス
    const work = act(r.state, { type: 'choose', optionId: 'w01' });
    expect(work.state.players[0].spaceId).toBe('w01');
    expect(work.state.players[0].jobId).not.toBeNull();
    expect(ofType(work.events, 'moved')[0]).toMatchObject({ from: 'br', to: 'w01' });

    // 進学ルート: c01 → c02 で停止（c02 はカードマスなので、その後の移動はカード次第）
    r = act(r.state, { type: 'choose', optionId: 'c01' });
    expect(ofType(r.events, 'moved')[0].path).toEqual(['c01', 'c02']);
    expect(ofType(r.events, 'landed')[0].spaceId).toBe('c02');
  });

  it('必ず止まるマス（結婚）では出目が余っていても止まる', () => {
    const data = linearData(
      [{ kind: 'marriage', mustStop: true }, { kind: 'blank' }, { kind: 'blank' }],
      {
        roll: 3,
      },
    );
    const r = act(newGame(data), { type: 'spin' });
    expect(r.state.players[0].spaceId).toBe('s1');
    expect(r.state.players[0].married).toBe(true);
  });

  it('ゴールでは出目が余っていても止まる', () => {
    const r = act(newGame(linearData([{ kind: 'blank' }], { roll: 9 })), { type: 'spin' });
    expect(r.state.players[0].spaceId).toBe('goal');
    expect(r.state.players[0].finished).toBe(true);
  });
});

describe('給料', () => {
  const data = linearData([{ kind: 'salary' }, { kind: 'blank' }, { kind: 'blank' }]);

  it('通過で受け取る', () => {
    const s = setup(newGame(fixRoll(data, 3)), (st) => (st.players[0].jobId = 'baker'));
    const r = act(s, { type: 'spin' });
    expect(ofType(r.events, 'salaryPaid')).toEqual([
      { type: 'salaryPaid', playerIndex: 0, amount: 7_000, passing: true },
    ]);
    expect(r.state.players[0].money).toBe(37_000);
    expect(r.state.players[0].spaceId).toBe('s3');
    // 給料マスで moved が区切られる
    expect(ofType(r.events, 'moved').map((e) => e.path)).toEqual([['s1'], ['s2', 's3']]);
  });

  it('停止でも受け取る（1 回だけ）', () => {
    const s = setup(newGame(fixRoll(data, 1)), (st) => (st.players[0].jobId = 'baker'));
    const r = act(s, { type: 'spin' });
    expect(ofType(r.events, 'salaryPaid')).toEqual([
      { type: 'salaryPaid', playerIndex: 0, amount: 7_000, passing: false },
    ]);
    expect(r.state.players[0].money).toBe(37_000);
  });

  it('職業がなければ受け取らない', () => {
    const r = act(newGame(fixRoll(data, 3)), { type: 'spin' });
    expect(ofType(r.events, 'salaryPaid')).toHaveLength(0);
  });

  it('借用証書があれば給料時に任意で返せる（通過時は返済後に移動を続ける）', () => {
    const s = setup(newGame(fixRoll(data, 3)), (st) => {
      st.players[0].jobId = 'baker';
      st.players[0].loans = 2;
    });
    let r = act(s, { type: 'spin' });
    expect(r.state.pendingChoice?.kind).toBe('repayLoan');
    expect(r.state.players[0].spaceId).toBe('s1');
    r = act(r.state, { type: 'choose', optionId: 'repay' });
    // 37,000 - 12,000 = 25,000 なのでもう 1 枚返せる
    expect(r.state.players[0]).toMatchObject({ loans: 1, money: 25_000 });
    expect(r.state.pendingChoice?.kind).toBe('repayLoan');
    r = act(r.state, { type: 'choose', optionId: 'skip' });
    expect(r.state.players[0]).toMatchObject({ loans: 1, money: 25_000, spaceId: 's3' });
    expect(r.state.phase.type).toBe('turnEnd');
  });

  it('返済額に足りなければ返済の選択は出ない', () => {
    const s = setup(newGame(fixRoll(data, 1)), (st) => {
      st.players[0].jobId = 'baker';
      st.players[0].loans = 1;
      st.players[0].money = 0;
    });
    const r = act(s, { type: 'spin' });
    expect(r.state.pendingChoice).toBeNull();
    expect(r.state.players[0].money).toBe(7_000);
  });
});

describe('職業', () => {
  it('進学ルートの職業マス: 学位を得て候補から選ぶ', () => {
    const data = linearData([{ kind: 'job', mode: 'choose', degree: true, mustStop: true }], {
      roll: 1,
    });
    const r = act(newGame(data), { type: 'spin' });
    expect(ofType(r.events, 'degreeEarned')).toHaveLength(1);
    const choice = r.state.pendingChoice;
    expect(choice?.kind).toBe('job');
    expect(choice?.options).toHaveLength(STANDARD_DATA.rules.jobCandidates);
    const pick = choice!.options[1].id;
    const r2 = act(r.state, { type: 'choose', optionId: pick });
    expect(r2.state.players[0].jobId).toBe(pick);
    expect(ofType(r2.events, 'jobAssigned')[0]).toMatchObject({ jobId: pick, previousJobId: null });
  });

  it('就職ルートの職業マス: 学位不要の職業からランダム', () => {
    const data = linearData([{ kind: 'job', mode: 'random', degree: false, mustStop: true }], {
      roll: 1,
    });
    for (let seed = 1; seed <= 30; seed++) {
      const r = act(newGame(data, 2, seed), { type: 'spin' });
      const job = STANDARD_DATA.jobs.find((j) => j.id === r.state.players[0].jobId);
      expect(job?.requiresDegree).toBe(false);
    }
  });

  it('転職マス: 引き直すと別の職業、続けるとそのまま', () => {
    const data = linearData([{ kind: 'jobChange' }], { roll: 1 });
    const s = setup(newGame(data), (st) => (st.players[0].jobId = 'baker'));
    let r = act(s, { type: 'spin' });
    expect(r.state.pendingChoice?.kind).toBe('jobChange');
    const changed = act(r.state, { type: 'choose', optionId: 'change' });
    expect(changed.state.players[0].jobId).not.toBe('baker');
    expect(ofType(changed.events, 'jobAssigned')[0].previousJobId).toBe('baker');
    r = act(r.state, { type: 'choose', optionId: 'keep' });
    expect(r.state.players[0].jobId).toBe('baker');
    expect(ofType(r.events, 'jobKept')).toHaveLength(1);
  });
});

describe('結婚・子供', () => {
  const data = linearData(
    [
      { kind: 'child', count: 1 },
      { kind: 'marriage', mustStop: true },
      { kind: 'child', count: 2 },
    ],
    { roll: 1 },
  );

  it('結婚前の子供マスは何も起きない', () => {
    const r = act(newGame(data), { type: 'spin' });
    expect(r.state.players[0].children).toBe(0);
    expect(ofType(r.events, 'childBorn')).toHaveLength(0);
  });

  it('結婚でお祝い金、結婚後の子供マスで子供が増え、お祝い金を受け取る', () => {
    const s = setup(newGame(data, 3), (st) => (st.players[0].spaceId = 's1'));
    let r = act(s, { type: 'spin' });
    expect(ofType(r.events, 'married')).toHaveLength(1);
    expect(r.state.players.map((p) => p.money)).toEqual([34_000, 28_000, 28_000]);

    // next で P2 の手番に移るので、P1 の手番に戻して続ける
    r = act(r.state, { type: 'next' });
    r = act(
      setup(r.state, (st) => (st.currentPlayer = 0)),
      { type: 'spin' },
    );
    expect(r.state.players[0].children).toBe(2);
    expect(ofType(r.events, 'childBorn')[0]).toMatchObject({ count: 2, children: 2 });
    // 1 人あたり 1,000 × 2 人
    expect(r.state.players.map((p) => p.money)).toEqual([38_000, 26_000, 26_000]);
  });
});

describe('家', () => {
  const data = linearData([{ kind: 'house', houseIds: ['cottage', 'tower'] }], { roll: 1 });

  it('選択肢に家と「買わない」が並び、買うと支払う', () => {
    let r = act(newGame(data), { type: 'spin' });
    expect(r.state.pendingChoice?.options.map((o) => o.id)).toEqual(['cottage', 'tower', 'skip']);
    r = act(r.state, { type: 'choose', optionId: 'cottage' });
    expect(r.state.players[0]).toMatchObject({ money: 10_000, houseIds: ['cottage'] });
    expect(ofType(r.events, 'houseBought')[0]).toMatchObject({ houseId: 'cottage', price: 20_000 });
  });

  it('買わない', () => {
    let r = act(newGame(data), { type: 'spin' });
    r = act(r.state, { type: 'choose', optionId: 'skip' });
    expect(r.state.players[0]).toMatchObject({ money: 30_000, houseIds: [] });
  });

  it('所持金が足りなければ借用証書を 1 万円単位で自動発行', () => {
    let r = act(newGame(data), { type: 'spin' });
    r = act(r.state, { type: 'choose', optionId: 'tower' });
    expect(r.state.players[0]).toMatchObject({ money: 0, loans: 1 });
    expect(ofType(r.events, 'loanIssued')).toEqual([
      { type: 'loanIssued', playerIndex: 0, count: 1, amount: 10_000, loans: 1 },
    ]);
  });

  it('不足額が 1 万円を超えると 2 枚発行', () => {
    const s = setup(newGame(data), (st) => (st.players[0].money = 29_999));
    let r = act(s, { type: 'spin' });
    r = act(r.state, { type: 'choose', optionId: 'tower' });
    expect(r.state.players[0]).toMatchObject({ money: 9_999, loans: 2 });
  });
});

describe('イベントマスと保険', () => {
  const lossData = linearData([{ kind: 'event', amount: -5_000, lossType: 'illness' }], {
    roll: 1,
  });

  it('収入', () => {
    const r = act(newGame(linearData([{ kind: 'event', amount: 3_000 }], { roll: 1 })), {
      type: 'spin',
    });
    expect(r.state.players[0].money).toBe(33_000);
    expect(ofType(r.events, 'eventOccurred')[0]).toMatchObject({ amount: 3_000, lossType: null });
  });

  it('損失を支払う', () => {
    const r = act(newGame(lossData), { type: 'spin' });
    expect(r.state.players[0].money).toBe(25_000);
    expect(ofType(r.events, 'eventOccurred')[0]).toMatchObject({
      amount: -5_000,
      lossType: 'illness',
    });
  });

  it('対応する保険があれば免除', () => {
    const s = setup(newGame(lossData), (st) => (st.players[0].insurances = ['life']));
    const r = act(s, { type: 'spin' });
    expect(r.state.players[0].money).toBe(30_000);
    expect(ofType(r.events, 'lossExempted')[0]).toMatchObject({
      by: 'insurance',
      insurance: 'life',
      amount: 5_000,
    });
  });

  it('対応しない保険では免除されない', () => {
    const s = setup(newGame(lossData), (st) => (st.players[0].insurances = ['fire', 'auto']));
    const r = act(s, { type: 'spin' });
    expect(r.state.players[0].money).toBe(25_000);
  });

  it('お守りカードを持っていれば使うか選べる', () => {
    const s = setup(newGame(lossData), (st) => (st.players[0].hand = ['shield']));
    const r = act(s, { type: 'spin' });
    expect(r.state.pendingChoice).toMatchObject({ kind: 'lossShield', amount: 5_000 });

    const used = act(r.state, { type: 'choose', optionId: 'use' });
    expect(used.state.players[0]).toMatchObject({ money: 30_000, hand: [] });
    expect(used.state.discard).toContain('shield');
    expect(ofType(used.events, 'lossExempted')[0]).toMatchObject({ by: 'card', cardId: 'shield' });

    const accepted = act(r.state, { type: 'choose', optionId: 'accept' });
    expect(accepted.state.players[0]).toMatchObject({ money: 25_000, hand: ['shield'] });
  });

  it('保険マス: 未加入の保険を続けて購入できる', () => {
    let r = act(newGame(linearData([{ kind: 'insurance' }], { roll: 1 })), { type: 'spin' });
    expect(r.state.pendingChoice?.options.map((o) => o.id)).toEqual([
      'life',
      'fire',
      'auto',
      'done',
    ]);
    r = act(r.state, { type: 'choose', optionId: 'fire' });
    expect(r.state.pendingChoice?.options.map((o) => o.id)).toEqual(['life', 'auto', 'done']);
    r = act(r.state, { type: 'choose', optionId: 'done' });
    expect(r.state.players[0]).toMatchObject({ insurances: ['fire'], money: 26_000 });
    expect(r.state.phase.type).toBe('turnEnd');
  });
});

describe('株', () => {
  it('株マスで 1 枚購入。上限では選択肢が出ない', () => {
    const data = linearData([{ kind: 'stock' }], { roll: 1 });
    let r = act(newGame(data), { type: 'spin' });
    r = act(r.state, { type: 'choose', optionId: 'buy' });
    expect(r.state.players[0]).toMatchObject({ stocks: 1, money: 25_000 });

    const full = setup(newGame(data), (st) => (st.players[0].stocks = 3));
    const r2 = act(full, { type: 'spin' });
    expect(r2.state.pendingChoice).toBeNull();
    expect(r2.state.phase.type).toBe('turnEnd');
  });

  it('株価変動マス: ルーレットを回して変動表に従い全員共通の株価が動く', () => {
    const data = linearData([{ kind: 'stockChange' }], { roll: 1 });
    let r = act(newGame(data), { type: 'spin' });
    expect(r.state.phase).toEqual({ type: 'spin', purpose: 'stockChange' });
    r = act(r.state, { type: 'spin' });
    expect(ofType(r.events, 'spun')[0].purpose).toBe('stockChange');
    // 出目 1 → -3,000
    expect(ofType(r.events, 'stockPriceChanged')).toEqual([
      { type: 'stockPriceChanged', roll: 1, from: 5_000, to: 2_000 },
    ]);
    expect(r.state.stockPrice).toBe(2_000);
    expect(r.state.phase.type).toBe('turnEnd');
  });

  it('株価は上下限でクランプ', () => {
    const data = linearData([{ kind: 'stockChange' }], { roll: 1 });
    const s = setup(newGame(data), (st) => (st.stockPrice = 2_000));
    const r = act(s, { type: 'spin' }, { type: 'spin' });
    expect(r.state.stockPrice).toBe(1_000);
  });
});

describe('カード', () => {
  const cardBoard = (cards: Card[], extra = 0) =>
    linearData(
      [{ kind: 'card' }, ...Array.from({ length: extra }, () => ({ kind: 'blank' as const }))],
      { roll: 1, cards },
    );

  it('即時: お金を受け取る', () => {
    const r = act(newGame(cardBoard([card('lottery')])), { type: 'spin' });
    expect(ofType(r.events, 'cardDrawn')[0].cardId).toBe('lottery');
    expect(r.state.players[0].money).toBe(40_000);
    expect(r.state.discard).toEqual(['lottery']);
  });

  it('即時: 損失は保険で免除される', () => {
    const s = setup(
      newGame(cardBoard([card('bike')])),
      (st) => (st.players[0].insurances = ['auto']),
    );
    const r = act(s, { type: 'spin' });
    expect(r.state.players[0].money).toBe(30_000);
    expect(ofType(r.events, 'lossExempted')).toHaveLength(1);
  });

  it('即時: 他の全員から徴収（ゴール済みの人は除く）', () => {
    const s = setup(
      newGame(cardBoard([card('cheer')]), 3),
      (st) => (st.players[2].finished = true),
    );
    const r = act(s, { type: 'spin' });
    expect(r.state.players.map((p) => p.money)).toEqual([32_000, 28_000, 30_000]);
  });

  it('即時: N マス進む', () => {
    const r = act(newGame(cardBoard([card('tailwind')], 5)), { type: 'spin' });
    expect(r.state.players[0].spaceId).toBe('s4');
    expect(ofType(r.events, 'moved').map((e) => e.to)).toEqual(['s1', 's4']);
  });

  it('所持カードは手札に入り、上限を超えると捨てる', () => {
    let r = act(newGame(cardBoard([card('boost')])), { type: 'spin' });
    expect(r.state.players[0].hand).toEqual(['boost']);
    expect(ofType(r.events, 'cardKept')).toHaveLength(1);

    const full = setup(newGame(cardBoard([card('boost')])), (st) => {
      st.players[0].hand = ['shield', 'shield', 'payday'];
    });
    r = act(full, { type: 'spin' });
    expect(r.state.players[0].hand).toEqual(['shield', 'shield', 'payday']);
    expect(ofType(r.events, 'cardDiscarded')[0]).toMatchObject({
      cardId: 'boost',
      reason: 'handFull',
    });
    expect(r.state.discard).toEqual(['boost']);
  });

  it('山札が尽きたら捨て札をシャッフルして戻す', () => {
    const data = linearData([{ kind: 'card' }, { kind: 'card' }], {
      roll: 1,
      cards: [card('lottery')],
    });
    let r = act(newGame(data), { type: 'spin' }, { type: 'next' });
    r = act(
      setup(r.state, (st) => (st.currentPlayer = 0)),
      { type: 'spin' },
    );
    expect(ofType(r.events, 'deckReshuffled')).toEqual([{ type: 'deckReshuffled', size: 1 }]);
    expect(r.state.players[0].money).toBe(50_000);
  });

  it('出目 +1 カード: ルーレット前に使う', () => {
    const data = linearData([{ kind: 'blank' }, { kind: 'blank' }, { kind: 'blank' }], { roll: 1 });
    const s = setup(newGame(data), (st) => (st.players[0].hand = ['boost', 'shield']));
    expect(usableCards(s)).toEqual(['boost']);
    let r = act(s, { type: 'useCard', cardId: 'boost' });
    expect(r.state.players[0]).toMatchObject({ spinBonus: 1, hand: ['shield'] });
    expect(r.state.phase).toEqual({ type: 'spin', purpose: 'move' });
    r = act(r.state, { type: 'spin' });
    expect(ofType(r.events, 'spun')[0]).toMatchObject({ value: 1, bonus: 1, total: 2 });
    expect(r.state.players[0]).toMatchObject({ spaceId: 's2', spinBonus: 0 });
  });

  it('お守りはルーレット前には使えない', () => {
    const s = setup(
      newGame(linearData([{ kind: 'blank' }])),
      (st) => (st.players[0].hand = ['shield']),
    );
    expect(applyAction(s, { type: 'useCard', cardId: 'shield' }).events[0].type).toBe(
      'actionRejected',
    );
  });

  it('給料をもらうカード: 相手を選ぶと相手の給料 1 回分を受け取る', () => {
    const data = linearData([{ kind: 'blank' }], { roll: 1 });
    const s = setup(newGame(data, 3), (st) => {
      st.players[0].hand = ['payday'];
      st.players[1].jobId = 'firefighter';
    });
    let r = act(s, { type: 'useCard', cardId: 'payday' });
    // 職業がない P3 は対象外
    expect(r.state.pendingChoice?.options.map((o) => o.id)).toEqual(['1', 'cancel']);
    r = act(r.state, { type: 'choose', optionId: '1' });
    expect(r.state.players.map((p) => p.money)).toEqual([38_000, 22_000, 30_000]);
    expect(r.state.players[0].hand).toEqual([]);
    expect(r.state.phase).toEqual({ type: 'spin', purpose: 'move' });
    expect(ofType(r.events, 'cardUsed')[0]).toMatchObject({ cardId: 'payday', targetIndex: 1 });
  });

  it('給料をもらうカード: 対象がいなければ使えない', () => {
    const s = setup(
      newGame(linearData([{ kind: 'blank' }])),
      (st) => (st.players[0].hand = ['payday']),
    );
    expect(usableCards(s)).toEqual([]);
  });
});

describe('ゴールと資産計算', () => {
  it('総資産 = 所持金 + 家 + 株 + カード + 子供 − 借用証書', () => {
    const s = setup(newGame(linearData([], { roll: 1 })), (st) => {
      const p = st.players[0];
      p.money = 50_000;
      p.houseIds = ['cottage'];
      p.stocks = 2;
      p.hand = ['boost'];
      p.children = 3;
      p.loans = 2;
      p.insurances = ['life'];
      st.stockPrice = 7_000;
    });
    const r = act(s, { type: 'spin' });
    const goal = ofType(r.events, 'goal')[0];
    expect(goal.assets).toEqual({
      money: 50_000,
      houses: 25_000,
      stocks: 14_000,
      cards: 5_000,
      children: 30_000,
      loans: 24_000,
      total: 50_000 + 25_000 + 14_000 + 5_000 + 30_000 - 24_000,
    });
    expect(goal.order).toBe(1);
    expect(r.state.players[0].result).toEqual(goal.assets);
  });

  it('ゴール済みの人は手番を飛ばし、全員ゴールで gameOver と勝者', () => {
    const data = linearData([{ kind: 'blank' }], { roll: 2 });
    let s = setup(newGame(data, 3), (st) => {
      st.players[1].money = 99_000;
    });
    let r = act(s, { type: 'spin' }, { type: 'next' }, { type: 'spin' }, { type: 'next' });
    expect(r.state.currentPlayer).toBe(2);
    r = act(r.state, { type: 'spin' });
    expect(r.state.phase.type).toBe('gameOver');
    const over = ofType(r.events, 'gameOver')[0];
    expect(over.result.winners).toEqual([1]);
    expect(over.result.ranking.map((e) => [e.playerIndex, e.rank])).toEqual([
      [1, 1],
      [0, 2],
      [2, 2],
    ]);
    expect(r.state.finishOrder).toEqual([0, 1, 2]);
    // gameOver 後のアクションは拒否
    s = r.state;
    expect(applyAction(s, { type: 'spin' }).events[0].type).toBe('actionRejected');
  });

  it('同点なら勝者は複数', () => {
    const data = linearData([], { roll: 1 });
    const r = act(newGame(data), { type: 'spin' }, { type: 'next' }, { type: 'spin' });
    expect(ofType(r.events, 'gameOver')[0].result.winners).toEqual([0, 1]);
  });

  it('computeAssets は内訳の合計と total が一致', () => {
    const s = newGame(STANDARD_DATA);
    const a = computeAssets(s, s.players[0]);
    expect(a.money + a.houses + a.stocks + a.cards + a.children - a.loans).toBe(a.total);
  });
});

describe('createGame の state はシリアライズ可能', () => {
  it('JSON 往復で同じ', () => {
    const { data, ...rest } = createGame({
      data: STANDARD_DATA,
      seed: 3,
      players: [{ name: 'A' }, { name: 'B' }],
    });
    expect(data).not.toBe(STANDARD_DATA);
    expect(data).toEqual(STANDARD_DATA);
    expect(JSON.parse(JSON.stringify(rest))).toEqual(rest);
  });
});

describe('レビュー指摘への対応', () => {
  it('jobCandidates が 1 未満のデータは検証エラー', () => {
    const data = linearData([], { rules: { ...STANDARD_DATA.rules, jobCandidates: 0 } });
    expect(validateGameData(data).join()).toContain('jobCandidates');
    expect(() => newGame(data)).toThrow(/jobCandidates/);
  });

  it('職業候補が空になる場合は選択を出さずランダムに割り当てる（防御）', () => {
    const data = linearData([{ kind: 'job', mode: 'choose', degree: true, mustStop: true }], {
      roll: 1,
    });
    const s = newGame(data);
    // 検証をすり抜けた不正データを想定して、state の data だけ差し替える
    const broken: GameState = {
      ...s,
      data: { ...s.data, rules: { ...s.data.rules, jobCandidates: 0 } },
    };
    const r = act(broken, { type: 'spin' });
    expect(r.state.pendingChoice).toBeNull();
    expect(r.state.players[0].jobId).not.toBeNull();
    expect(ofType(r.events, 'jobAssigned')).toHaveLength(1);
    expect(r.state.phase.type).toBe('turnEnd');
  });

  it('createGame は data を複製して凍結し、以後の state で共有する', () => {
    const config = JSON.parse(JSON.stringify(STANDARD_DATA)) as typeof STANDARD_DATA;
    const snapshot = JSON.stringify(config);
    const s = newGame(config);
    expect(s.data).not.toBe(config);
    expect(Object.isFrozen(s.data)).toBe(true);
    expect(Object.isFrozen(s.data.rules.stock.changeTable)).toBe(true);
    expect(Object.isFrozen(config)).toBe(false);
    // ESM のテストは strict mode なので凍結済みオブジェクトへの代入は throw する
    expect(() => {
      (s.data.rules as { initialMoney: number }).initialMoney = 1;
    }).toThrow(TypeError);
    expect(() => {
      s.data.board.spaces.push(s.data.board.spaces[0]);
    }).toThrow(TypeError);
    expect(JSON.stringify(config)).toBe(snapshot);
    // applyAction 後の state も同じ凍結済み data を共有する
    const r = applyAction(s, { type: 'spin' });
    expect(r.state.data).toBe(s.data);
  });

  it('computeAssets はゴール済みなら確定した result を返す（株価が後で動いても変わらない）', () => {
    const s = setup(newGame(linearData([], { roll: 1 })), (st) => (st.players[0].stocks = 2));
    const r = act(s, { type: 'spin' });
    const fixed = r.state.players[0].result!;
    expect(fixed.stocks).toBe(10_000);
    const later = setup(r.state, (st) => (st.stockPrice = 20_000));
    expect(computeAssets(later, later.players[0])).toEqual(fixed);
    // ゴールしていない人は現在の株価で計算する
    const other = setup(later, (st) => (st.players[1].stocks = 1));
    expect(computeAssets(other, other.players[1]).stocks).toBe(20_000);
  });

  it('initialEvents は最初の手番の turnChanged を返す', () => {
    const s = newGame(STANDARD_DATA, 3);
    expect(initialEvents(s)).toEqual([{ type: 'turnChanged', playerIndex: 0, turn: 1 }]);
    // 2 手番目以降は next が同じ形の turnChanged を出す
    const r = autoPlay(s, firstOptionPolicy);
    const changes = ofType([...initialEvents(s), ...r.events], 'turnChanged');
    expect(changes.map((e) => e.turn)).toEqual(changes.map((_, i) => i + 1));
  });
});
