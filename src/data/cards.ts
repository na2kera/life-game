// カード一覧（文面はオリジナル）。効果は種別 + パラメータで定義する
import type { Card } from '../core/types.ts';

export const CARDS: Card[] = [
  // --- イベントカード（即時） ---
  {
    id: 'lottery',
    name: '福引きで一等',
    text: '商店街の福引きで一等を引き当てた。10,000 円もらう。',
    kind: 'instant',
    effect: { type: 'money', amount: 10_000 },
    copies: 2,
  },
  {
    id: 'cheer',
    name: 'みんなからの差し入れ',
    text: '頑張りが評判に。ほかの全員から 2,000 円ずつもらう。',
    kind: 'instant',
    effect: { type: 'collect', amountPerPlayer: 2_000 },
    copies: 2,
  },
  {
    id: 'bike',
    name: '自転車で転倒',
    text: '坂道で自転車ごと転んだ。治療費 6,000 円を払う。',
    kind: 'instant',
    effect: { type: 'money', amount: -6_000, lossType: 'accident' },
    copies: 2,
  },
  {
    id: 'cold',
    name: 'しつこい風邪',
    text: '季節の風邪をこじらせた。通院費 4,000 円を払う。',
    kind: 'instant',
    effect: { type: 'money', amount: -4_000, lossType: 'illness' },
    copies: 2,
  },
  {
    id: 'kitchen',
    name: '台所のぼや',
    text: '揚げ物の火が燃え移った。修理費 8,000 円を払う。',
    kind: 'instant',
    effect: { type: 'money', amount: -8_000, lossType: 'fire' },
    copies: 1,
  },
  {
    id: 'tax',
    name: '追加の納税通知',
    text: '申告漏れが見つかった。3,000 円を払う。',
    kind: 'instant',
    effect: { type: 'money', amount: -3_000, lossType: 'other' },
    copies: 1,
  },
  {
    id: 'tailwind',
    name: '追い風',
    text: '背中を押す風が吹いた。3 マス進む。',
    kind: 'instant',
    effect: { type: 'advance', steps: 3 },
    copies: 2,
  },
  // --- 所持カード ---
  {
    id: 'boost',
    name: 'ひと押しの勇気',
    text: 'ルーレットを回す前に使う。出目に 1 を足す。',
    kind: 'hold',
    effect: { type: 'spinBonus', amount: 1 },
    copies: 2,
  },
  {
    id: 'shield',
    name: 'お守り',
    text: '損失を受けるときに使う。その損失を 1 回なかったことにする。',
    kind: 'hold',
    effect: { type: 'lossShield' },
    copies: 2,
  },
  {
    id: 'payday',
    name: 'ちゃっかり給料日',
    text: 'ルーレットを回す前に使う。選んだ相手から、相手の給料 1 回分をもらう。',
    kind: 'hold',
    effect: { type: 'stealSalary' },
    copies: 1,
  },
];
