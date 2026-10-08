// ルール本体。applyAction の内部で複製済みの state（draft）を直接更新し、イベントを積む。
// 金額・マス・職業・カードはすべて state.data から読み、ここにはハードコードしない。
import { getSpace } from './board.ts';
import { nextInt, shuffle } from './rng.ts';
import type {
  AssetBreakdown,
  Card,
  ChoiceOption,
  GameData,
  GameEvent,
  GameResult,
  GameState,
  House,
  InsuranceType,
  Job,
  LossType,
  MoneyReason,
  PendingChoice,
  PendingChoiceDetail,
  Player,
} from './types.ts';

/** 1 回の applyAction の作業領域 */
export interface Ctx {
  s: GameState;
  events: GameEvent[];
}

// ---------------------------------------------------------------------------
// 参照ヘルパー
// ---------------------------------------------------------------------------

export function findJob(data: GameData, id: string): Job {
  const job = data.jobs.find((j) => j.id === id);
  if (!job) throw new Error(`unknown job: ${id}`);
  return job;
}

export function findHouse(data: GameData, id: string): House {
  const house = data.houses.find((h) => h.id === id);
  if (!house) throw new Error(`unknown house: ${id}`);
  return house;
}

export function findCard(data: GameData, id: string): Card {
  const card = data.cards.find((c) => c.id === id);
  if (!card) throw new Error(`unknown card: ${id}`);
  return card;
}

export function salaryOf(data: GameData, player: Player): number {
  return player.jobId ? findJob(data, player.jobId).salary : 0;
}

/** 学位の有無で就ける職業 */
export function eligibleJobs(data: GameData, degree: boolean): Job[] {
  return data.jobs.filter((j) => degree || !j.requiresDegree);
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}¥${Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function emit(ctx: Ctx, event: GameEvent): void {
  ctx.events.push(event);
}

function current(ctx: Ctx): Player {
  return ctx.s.players[ctx.s.currentPlayer];
}

/** ゴールしていない他のプレイヤー */
function activeOthers(ctx: Ctx): Player[] {
  return ctx.s.players.filter((p) => p.index !== ctx.s.currentPlayer && !p.finished);
}

function randInt(ctx: Ctx, min: number, max: number): number {
  const [value, next] = nextInt(ctx.s.rng, min, max);
  ctx.s.rng = next;
  return value;
}

function removeFromHand(ctx: Ctx, player: Player, cardId: string): void {
  const i = player.hand.indexOf(cardId);
  if (i < 0) throw new Error(`card not in hand: ${cardId}`);
  player.hand.splice(i, 1);
  ctx.s.discard.push(cardId);
}

// ---------------------------------------------------------------------------
// お金
// ---------------------------------------------------------------------------

export function receive(ctx: Ctx, playerIndex: number, amount: number, reason: MoneyReason): void {
  if (amount <= 0) return;
  const p = ctx.s.players[playerIndex];
  p.money += amount;
  emit(ctx, { type: 'moneyChanged', playerIndex, delta: amount, money: p.money, reason });
}

/** 支払い。所持金が足りなければ借用証書を自動発行して補填する */
export function pay(ctx: Ctx, playerIndex: number, amount: number, reason: MoneyReason): void {
  if (amount <= 0) return;
  const p = ctx.s.players[playerIndex];
  const { unit } = ctx.s.data.rules.loan;
  if (p.money < amount) {
    const count = Math.ceil((amount - p.money) / unit);
    p.loans += count;
    p.money += count * unit;
    emit(ctx, { type: 'loanIssued', playerIndex, count, amount: count * unit, loans: p.loans });
    emit(ctx, {
      type: 'moneyChanged',
      playerIndex,
      delta: count * unit,
      money: p.money,
      reason: 'loan',
    });
  }
  p.money -= amount;
  emit(ctx, { type: 'moneyChanged', playerIndex, delta: -amount, money: p.money, reason });
}

function transfer(ctx: Ctx, from: number, to: number, amount: number, reason: MoneyReason): void {
  pay(ctx, from, amount, reason);
  receive(ctx, to, amount, reason);
}

/** 損失。保険 → 所持カード（お守り）の順に免除を確認し、なければ支払う */
export function applyLoss(ctx: Ctx, amount: number, lossType: LossType, reason: MoneyReason): void {
  const p = current(ctx);
  const insurance = ctx.s.data.rules.lossCoverage[lossType];
  if (insurance && p.insurances.includes(insurance)) {
    emit(ctx, {
      type: 'lossExempted',
      playerIndex: p.index,
      amount,
      lossType,
      by: 'insurance',
      insurance,
      cardId: null,
    });
    return;
  }
  const shieldId = p.hand.find((id) => findCard(ctx.s.data, id).effect.type === 'lossShield');
  if (shieldId) {
    const card = findCard(ctx.s.data, shieldId);
    requestChoice(ctx, { kind: 'lossShield', amount, lossType, cardId: shieldId, reason }, [
      { id: 'use', label: `「${card.name}」で防ぐ` },
      { id: 'accept', label: `${formatMoney(amount)} を払う` },
    ]);
    return;
  }
  pay(ctx, p.index, amount, reason);
}

/** 給料の受け取り（通過・停止共通）。借用証書があれば任意返済を提示する */
export function payday(ctx: Ctx, passing: boolean): void {
  const p = current(ctx);
  const salary = salaryOf(ctx.s.data, p);
  if (salary <= 0) return;
  receive(ctx, p.index, salary, 'salary');
  emit(ctx, { type: 'salaryPaid', playerIndex: p.index, amount: salary, passing });
  offerRepay(ctx);
}

function offerRepay(ctx: Ctx): void {
  const p = current(ctx);
  const { repayAmount } = ctx.s.data.rules.loan;
  if (p.loans > 0 && p.money >= repayAmount) {
    requestChoice(ctx, { kind: 'repayLoan' }, [
      { id: 'repay', label: `借用証書を 1 枚返す（${formatMoney(repayAmount)}）` },
      { id: 'skip', label: '返さない' },
    ]);
  }
}

// ---------------------------------------------------------------------------
// 選択
// ---------------------------------------------------------------------------

export function requestChoice(
  ctx: Ctx,
  detail: PendingChoiceDetail,
  options: ChoiceOption[],
): void {
  const s = ctx.s;
  if (s.pendingChoice) throw new Error('choice already pending');
  const choice: PendingChoice = {
    ...detail,
    id: s.nextChoiceId,
    playerIndex: s.currentPlayer,
    options,
  };
  s.nextChoiceId += 1;
  s.pendingChoice = choice;
  s.phase = { type: 'choice' };
  emit(ctx, { type: 'choiceRequested', choice });
}

/** 選択を解決する。不正な選択肢ならエラー文字列を返す（state は変更しない） */
export function resolveChoice(ctx: Ctx, optionId: string): string | null {
  const s = ctx.s;
  const c = s.pendingChoice;
  if (!c) return 'no pending choice';
  if (!c.options.some((o) => o.id === optionId)) return `invalid option: ${optionId}`;
  s.pendingChoice = null;
  s.phase = { type: 'resolving' };
  emit(ctx, { type: 'choiceMade', playerIndex: c.playerIndex, kind: c.kind, optionId });
  const p = current(ctx);
  const data = s.data;

  switch (c.kind) {
    case 'branch':
      s.tasks.push({ type: 'move', steps: c.steps, forcedNext: optionId });
      break;
    case 'job':
      assignJob(ctx, optionId);
      break;
    case 'jobChange':
      if (optionId === 'change') {
        const pool = eligibleJobs(data, p.degree).filter((j) => j.id !== p.jobId);
        if (pool.length > 0) assignJob(ctx, pool[randInt(ctx, 0, pool.length - 1)].id);
      } else if (p.jobId) {
        emit(ctx, { type: 'jobKept', playerIndex: p.index, jobId: p.jobId });
      }
      break;
    case 'house':
      if (optionId !== 'skip') {
        const house = findHouse(data, optionId);
        pay(ctx, p.index, house.price, 'house');
        p.houseIds.push(house.id);
        emit(ctx, {
          type: 'houseBought',
          playerIndex: p.index,
          houseId: house.id,
          price: house.price,
        });
      }
      break;
    case 'insurance':
      if (optionId !== 'done') {
        const type = optionId as InsuranceType;
        const { price } = data.rules.insurance[type];
        pay(ctx, p.index, price, 'insurance');
        p.insurances.push(type);
        emit(ctx, { type: 'insuranceBought', playerIndex: p.index, insurance: type, price });
        offerInsurance(ctx, c.spaceId);
      }
      break;
    case 'stock':
      if (optionId === 'buy') {
        const price = data.rules.stock.buyPrice;
        pay(ctx, p.index, price, 'stock');
        p.stocks += 1;
        emit(ctx, { type: 'stockBought', playerIndex: p.index, price, stocks: p.stocks });
      }
      break;
    case 'repayLoan':
      if (optionId === 'repay') {
        const amount = data.rules.loan.repayAmount;
        pay(ctx, p.index, amount, 'loanRepay');
        p.loans -= 1;
        emit(ctx, { type: 'loanRepaid', playerIndex: p.index, count: 1, amount, loans: p.loans });
        offerRepay(ctx);
      }
      break;
    case 'lossShield':
      if (optionId === 'use') {
        removeFromHand(ctx, p, c.cardId);
        emit(ctx, { type: 'cardUsed', playerIndex: p.index, cardId: c.cardId, targetIndex: null });
        emit(ctx, {
          type: 'lossExempted',
          playerIndex: p.index,
          amount: c.amount,
          lossType: c.lossType,
          by: 'card',
          insurance: null,
          cardId: c.cardId,
        });
      } else {
        pay(ctx, p.index, c.amount, c.reason);
      }
      break;
    case 'cardTarget':
      if (optionId !== 'cancel') {
        const target = s.players[Number(optionId)];
        const amount = salaryOf(data, target);
        removeFromHand(ctx, p, c.cardId);
        emit(ctx, {
          type: 'cardUsed',
          playerIndex: p.index,
          cardId: c.cardId,
          targetIndex: target.index,
        });
        transfer(ctx, target.index, p.index, amount, 'stealSalary');
      }
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 移動
// ---------------------------------------------------------------------------

/**
 * steps マス進む。分岐では選択待ちで中断し、給料マスの通過では給料を払ってから続きをタスクに積む。
 * 出目を使い切ったとき・必ず止まるマス・ゴールでは停止して land タスクを積む。
 */
export function move(ctx: Ctx, steps: number, forcedNext?: string): void {
  const s = ctx.s;
  const board = s.data.board;
  const p = current(ctx);
  let from = p.spaceId;
  let path: string[] = [];
  const flush = (): void => {
    if (path.length === 0) return;
    emit(ctx, { type: 'moved', playerIndex: p.index, from, to: p.spaceId, path });
    from = p.spaceId;
    path = [];
  };

  let remaining = steps;
  let forced = forcedNext;
  while (remaining > 0) {
    const here = getSpace(board, p.spaceId);
    let nextId: string;
    if (forced !== undefined) {
      if (!here.next.includes(forced)) throw new Error(`invalid route ${here.id} -> ${forced}`);
      nextId = forced;
      forced = undefined;
    } else if (here.next.length === 0) {
      break;
    } else if (here.next.length > 1) {
      flush();
      requestChoice(
        ctx,
        { kind: 'branch', spaceId: here.id, steps: remaining },
        here.next.map((id, i) => ({
          id,
          label: here.kind === 'branch' ? here.routeLabels[i] : getSpace(board, id).label,
        })),
      );
      return;
    } else {
      nextId = here.next[0];
    }

    p.spaceId = nextId;
    path.push(nextId);
    remaining -= 1;
    const space = getSpace(board, nextId);
    if (remaining === 0 || space.mustStop || space.kind === 'goal') {
      flush();
      s.tasks.push({ type: 'land', spaceId: nextId });
      return;
    }
    if (space.kind === 'salary') {
      flush();
      s.tasks.push({ type: 'move', steps: remaining });
      payday(ctx, true);
      return;
    }
  }
  flush();
}

// ---------------------------------------------------------------------------
// マス効果
// ---------------------------------------------------------------------------

function assignJob(ctx: Ctx, jobId: string): void {
  const p = current(ctx);
  findJob(ctx.s.data, jobId);
  const previousJobId = p.jobId;
  p.jobId = jobId;
  emit(ctx, { type: 'jobAssigned', playerIndex: p.index, jobId, previousJobId });
}

function offerInsurance(ctx: Ctx, spaceId: string): void {
  const p = current(ctx);
  const table = ctx.s.data.rules.insurance;
  const remaining = (Object.keys(table) as InsuranceType[]).filter(
    (t) => !p.insurances.includes(t),
  );
  if (remaining.length === 0) return;
  requestChoice(ctx, { kind: 'insurance', spaceId }, [
    ...remaining.map((t) => ({
      id: t,
      label: `${table[t].name}に入る（${formatMoney(table[t].price)}）`,
    })),
    { id: 'done', label: '入らない' },
  ]);
}

export function landOn(ctx: Ctx, spaceId: string): void {
  const s = ctx.s;
  const data = s.data;
  const rules = data.rules;
  const p = current(ctx);
  const space = getSpace(data.board, spaceId);
  emit(ctx, { type: 'landed', playerIndex: p.index, spaceId, kind: space.kind });

  switch (space.kind) {
    case 'start':
    case 'blank':
    case 'branch':
      break;
    case 'salary':
      payday(ctx, false);
      break;
    case 'job': {
      if (space.degree && !p.degree) {
        p.degree = true;
        emit(ctx, { type: 'degreeEarned', playerIndex: p.index });
      }
      const pool = eligibleJobs(data, p.degree);
      if (space.mode === 'choose') {
        const [shuffled, next] = shuffle(s.rng, pool);
        s.rng = next;
        const candidates = shuffled.slice(0, rules.jobCandidates);
        if (candidates.length === 0) {
          // 候補が空だと選択肢のない choice になり進行不能になるため、ランダムに割り当てる
          assignJob(ctx, pool[randInt(ctx, 0, pool.length - 1)].id);
          break;
        }
        requestChoice(
          ctx,
          { kind: 'job', spaceId, degree: p.degree },
          candidates.map((j) => ({
            id: j.id,
            label: `${j.name}（給料 ${formatMoney(j.salary)}）`,
          })),
        );
      } else {
        assignJob(ctx, pool[randInt(ctx, 0, pool.length - 1)].id);
      }
      break;
    }
    case 'marriage':
      if (!p.married) {
        p.married = true;
        emit(ctx, { type: 'married', playerIndex: p.index });
        for (const o of activeOthers(ctx)) {
          transfer(ctx, o.index, p.index, rules.marriageGiftPerPlayer, 'gift');
        }
      }
      break;
    case 'child':
      if (p.married) {
        p.children += space.count;
        emit(ctx, {
          type: 'childBorn',
          playerIndex: p.index,
          count: space.count,
          children: p.children,
        });
        for (const o of activeOthers(ctx)) {
          transfer(ctx, o.index, p.index, rules.childGiftPerPlayer * space.count, 'gift');
        }
      }
      break;
    case 'house': {
      const houses = space.houseIds
        .filter((id) => !p.houseIds.includes(id))
        .map((id) => findHouse(data, id));
      if (houses.length > 0) {
        requestChoice(ctx, { kind: 'house', spaceId }, [
          ...houses.map((h) => ({ id: h.id, label: `${h.name}を買う（${formatMoney(h.price)}）` })),
          { id: 'skip', label: '買わない' },
        ]);
      }
      break;
    }
    case 'event': {
      const lossType = space.amount < 0 ? (space.lossType ?? 'other') : null;
      emit(ctx, {
        type: 'eventOccurred',
        playerIndex: p.index,
        spaceId,
        amount: space.amount,
        lossType,
      });
      if (space.amount > 0) receive(ctx, p.index, space.amount, 'event');
      else if (lossType) applyLoss(ctx, -space.amount, lossType, 'event');
      break;
    }
    case 'card':
      drawCard(ctx);
      break;
    case 'insurance':
      offerInsurance(ctx, spaceId);
      break;
    case 'stock':
      if (p.stocks < rules.stock.maxHold) {
        requestChoice(ctx, { kind: 'stock', spaceId }, [
          { id: 'buy', label: `株券を 1 枚買う（${formatMoney(rules.stock.buyPrice)}）` },
          { id: 'skip', label: '買わない' },
        ]);
      }
      break;
    case 'stockChange':
      s.phase = { type: 'spin', purpose: 'stockChange' };
      break;
    case 'jobChange':
      if (p.jobId) {
        requestChoice(ctx, { kind: 'jobChange', spaceId }, [
          { id: 'change', label: '転職する（くじ引き）' },
          { id: 'keep', label: '今の仕事を続ける' },
        ]);
      }
      break;
    case 'goal':
      finishPlayer(ctx);
      break;
  }
}

/** 株価変動ルーレットの結果を適用 */
export function applyStockChange(ctx: Ctx, roll: number): void {
  const s = ctx.s;
  const { stock, roulette } = s.data.rules;
  const delta = stock.changeTable[roll - roulette.min] ?? 0;
  const from = s.stockPrice;
  const to = Math.min(stock.maxPrice, Math.max(stock.minPrice, from + delta));
  s.stockPrice = to;
  emit(ctx, { type: 'stockPriceChanged', roll, from, to });
}

// ---------------------------------------------------------------------------
// カード
// ---------------------------------------------------------------------------

export function drawCard(ctx: Ctx): void {
  const s = ctx.s;
  const p = current(ctx);
  if (s.deck.length === 0) {
    if (s.discard.length === 0) {
      emit(ctx, { type: 'deckEmpty' });
      return;
    }
    const [deck, next] = shuffle(s.rng, s.discard);
    s.rng = next;
    s.deck = deck;
    s.discard = [];
    emit(ctx, { type: 'deckReshuffled', size: deck.length });
  }
  const cardId = s.deck.pop() as string;
  const card = findCard(s.data, cardId);
  emit(ctx, { type: 'cardDrawn', playerIndex: p.index, cardId });

  if (card.kind === 'hold') {
    if (p.hand.length < s.data.rules.handLimit) {
      p.hand.push(cardId);
      emit(ctx, { type: 'cardKept', playerIndex: p.index, cardId, hand: [...p.hand] });
    } else {
      s.discard.push(cardId);
      emit(ctx, { type: 'cardDiscarded', playerIndex: p.index, cardId, reason: 'handFull' });
    }
    return;
  }

  s.discard.push(cardId);
  const effect = card.effect;
  switch (effect.type) {
    case 'money':
      if (effect.amount > 0) receive(ctx, p.index, effect.amount, 'card');
      else applyLoss(ctx, -effect.amount, effect.lossType ?? 'other', 'card');
      break;
    case 'collect':
      for (const o of activeOthers(ctx)) {
        transfer(ctx, o.index, p.index, effect.amountPerPlayer, 'card');
      }
      break;
    case 'advance':
      s.tasks.push({ type: 'move', steps: effect.steps });
      break;
    default:
      // 所持カード用の効果は即時カードでは使わない
      break;
  }
}

function stealTargets(ctx: Ctx): Player[] {
  return activeOthers(ctx).filter((o) => salaryOf(ctx.s.data, o) > 0);
}

/** ルーレット前に使える所持カードか */
export function isCardUsableNow(state: GameState, cardId: string): boolean {
  if (state.phase.type !== 'spin' || state.phase.purpose !== 'move') return false;
  const p = state.players[state.currentPlayer];
  if (!p.hand.includes(cardId)) return false;
  const effect = findCard(state.data, cardId).effect;
  if (effect.type === 'spinBonus') return true;
  if (effect.type === 'stealSalary') {
    return stealTargets({ s: state, events: [] }).length > 0;
  }
  return false;
}

/** 所持カードを使う。使えなければエラー文字列を返す（state は変更しない） */
export function useCard(ctx: Ctx, cardId: string): string | null {
  if (!isCardUsableNow(ctx.s, cardId)) return `card cannot be used now: ${cardId}`;
  const p = current(ctx);
  const card = findCard(ctx.s.data, cardId);
  const effect = card.effect;
  if (effect.type === 'spinBonus') {
    removeFromHand(ctx, p, cardId);
    p.spinBonus += effect.amount;
    emit(ctx, { type: 'cardUsed', playerIndex: p.index, cardId, targetIndex: null });
  } else if (effect.type === 'stealSalary') {
    requestChoice(ctx, { kind: 'cardTarget', cardId }, [
      ...stealTargets(ctx).map((o) => ({
        id: String(o.index),
        label: `${o.name}から ${formatMoney(salaryOf(ctx.s.data, o))} もらう`,
      })),
      { id: 'cancel', label: 'やめる' },
    ]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// ゴール・資産計算
// ---------------------------------------------------------------------------

/** 総資産の内訳。ゴール済みのプレイヤーはゴール時に確定した result を返す */
export function computeAssets(state: GameState, player: Player): AssetBreakdown {
  if (player.finished && player.result) return player.result;
  const { rules } = state.data;
  const money = player.money;
  const houses = player.houseIds.reduce((sum, id) => sum + findHouse(state.data, id).value, 0);
  const stocks = player.stocks * state.stockPrice;
  const cards = player.hand.length * rules.cardCashValue;
  const children = player.children * rules.childBonus;
  const loans = player.loans * rules.loan.repayAmount;
  return {
    money,
    houses,
    stocks,
    cards,
    children,
    loans,
    total: money + houses + stocks + cards + children - loans,
  };
}

function finishPlayer(ctx: Ctx): void {
  const s = ctx.s;
  const p = current(ctx);
  p.finished = true;
  s.finishOrder.push(p.index);
  p.result = computeAssets(s, p);
  emit(ctx, { type: 'goal', playerIndex: p.index, order: s.finishOrder.length, assets: p.result });
}

/** 全員ゴール後の順位。同額は同順位 */
export function buildResult(state: GameState): GameResult {
  const entries = state.players.map((p) => ({
    playerIndex: p.index,
    assets: p.result ?? computeAssets(state, p),
  }));
  const sorted = [...entries].sort((a, b) => b.assets.total - a.assets.total);
  const ranking = sorted.map((e) => ({
    ...e,
    rank: 1 + sorted.filter((o) => o.assets.total > e.assets.total).length,
  }));
  const top = sorted[0].assets.total;
  return {
    ranking,
    winners: entries.filter((e) => e.assets.total === top).map((e) => e.playerIndex),
  };
}
