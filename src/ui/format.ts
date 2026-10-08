// 表示用の文言。core の型だけに依存する。
import type {
  ChoiceKind,
  GameEvent,
  GameState,
  InsuranceType,
  LossType,
  MoneyReason,
} from '../core/types.ts';

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}¥${Math.abs(amount).toLocaleString('ja-JP')}`;
}

export function formatDelta(amount: number): string {
  return amount >= 0 ? `+${formatMoney(amount)}` : formatMoney(amount);
}

const MONEY_REASONS: Record<MoneyReason, string> = {
  salary: '給料',
  event: 'できごと',
  card: 'カード',
  gift: 'お祝い',
  loan: '借用証書',
  loanRepay: '返済',
  house: '家の購入',
  insurance: '保険',
  stock: '株券',
  stealSalary: 'カード',
};

const LOSS_TYPES: Record<LossType, string> = {
  illness: '病気',
  fire: '火事',
  accident: '事故',
  other: 'その他',
};

export const CHOICE_TITLES: Record<ChoiceKind, string> = {
  branch: 'どちらへ進む？',
  job: '職業を選ぶ',
  jobChange: '転職する？',
  house: '家を買う？',
  insurance: '保険に入る？',
  stock: '株券を買う？',
  repayLoan: '借用証書を返す？',
  lossShield: 'カードで損失を防ぐ？',
  cardTarget: '誰から給料をもらう？',
};

export function jobName(state: GameState, jobId: string | null): string {
  if (!jobId) return '無職';
  return state.data.jobs.find((j) => j.id === jobId)?.name ?? jobId;
}

export function houseName(state: GameState, houseId: string): string {
  return state.data.houses.find((h) => h.id === houseId)?.name ?? houseId;
}

export function cardName(state: GameState, cardId: string): string {
  return state.data.cards.find((c) => c.id === cardId)?.name ?? cardId;
}

export function insuranceName(state: GameState, type: InsuranceType): string {
  return state.data.rules.insurance[type].name;
}

function spaceLabel(state: GameState, spaceId: string): string {
  return state.data.board.spaces.find((s) => s.id === spaceId)?.label ?? spaceId;
}

/** イベントをログ用の 1 行にする。ログに出さないものは null */
export function describeEvent(e: GameEvent, state: GameState): string | null {
  const name = (i: number): string => state.players[i]?.name ?? `P${i + 1}`;
  switch (e.type) {
    case 'turnChanged':
      return `${name(e.playerIndex)} の番です`;
    case 'spun':
      if (e.purpose === 'stockChange') return `株価ルーレット: ${e.value}`;
      return e.bonus > 0
        ? `${name(e.playerIndex)} のルーレット: ${e.value} +${e.bonus} = ${e.total}`
        : `${name(e.playerIndex)} のルーレット: ${e.value}`;
    case 'landed':
      return `${name(e.playerIndex)} は「${spaceLabel(state, e.spaceId)}」に止まった`;
    case 'moneyChanged':
      // 給料・借用証書は専用のイベントで表示する
      if (e.reason === 'salary' || e.reason === 'loan') return null;
      return `${name(e.playerIndex)} ${formatDelta(e.delta)}（${MONEY_REASONS[e.reason]}）`;
    case 'salaryPaid':
      return `${name(e.playerIndex)} 給料日${e.passing ? '（通過）' : ''} ${formatDelta(e.amount)}`;
    case 'loanIssued':
      return `${name(e.playerIndex)} お金が足りず借用証書を ${e.count} 枚発行（${formatDelta(e.amount)}）`;
    case 'loanRepaid':
      return `${name(e.playerIndex)} 借用証書を ${e.count} 枚返した`;
    case 'jobAssigned':
      return `${name(e.playerIndex)} は「${jobName(state, e.jobId)}」になった`;
    case 'jobKept':
      return `${name(e.playerIndex)} は今の仕事を続ける`;
    case 'degreeEarned':
      return `${name(e.playerIndex)} は学位を得た`;
    case 'married':
      return `${name(e.playerIndex)} が結婚した`;
    case 'childBorn':
      return `${name(e.playerIndex)} に子供が ${e.count} 人増えた（${e.children} 人）`;
    case 'houseBought':
      return `${name(e.playerIndex)} が「${houseName(state, e.houseId)}」を買った`;
    case 'insuranceBought':
      return `${name(e.playerIndex)} が${insuranceName(state, e.insurance)}に入った`;
    case 'stockBought':
      return `${name(e.playerIndex)} が株券を買った（${e.stocks} 枚）`;
    case 'stockPriceChanged':
      return `株価 ${formatMoney(e.from)} → ${formatMoney(e.to)}`;
    case 'eventOccurred':
      return null;
    case 'lossExempted': {
      const by =
        e.by === 'insurance' && e.insurance
          ? insuranceName(state, e.insurance)
          : e.cardId
            ? `「${cardName(state, e.cardId)}」`
            : 'カード';
      return `${name(e.playerIndex)} は${by}で${LOSS_TYPES[e.lossType]}の損失を免れた`;
    }
    case 'cardDrawn':
      return `${name(e.playerIndex)} がカード「${cardName(state, e.cardId)}」を引いた`;
    case 'cardKept':
      return `${name(e.playerIndex)} の手札に加えた（${e.hand.length} 枚）`;
    case 'cardDiscarded':
      return `手札がいっぱいなので「${cardName(state, e.cardId)}」を捨てた`;
    case 'cardUsed':
      return `${name(e.playerIndex)} が「${cardName(state, e.cardId)}」を使った`;
    case 'deckReshuffled':
      return '捨て札を混ぜて山札に戻した';
    case 'deckEmpty':
      return '山札がない';
    case 'goal':
      return `${name(e.playerIndex)} が ${e.order} 番目にゴール！`;
    case 'gameOver':
      return '全員ゴール！';
    case 'actionRejected':
    case 'moved':
    case 'choiceRequested':
    case 'choiceMade':
      return null;
  }
}
