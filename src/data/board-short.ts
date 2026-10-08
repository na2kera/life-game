// 短縮版の盤面（34 マス）。マス 1 個 = 1m 間隔で S 字に配置する。
// 隣り合うマスの距離はすべて 1m（テストで検証）。
//
//  x:     0   1   2   3   4   5   6   7   8   9
//  z=-2       c02 c03 c04 c05 c06 c07                進学ルート（遠回り・職業を選べる）
//  z=-1       c01                 c08
//  z= 0   st  br  w01 w02 w03 w04 m01 m02 m03 m04    就職ルート（近道）→ m01 で合流
//  z= 1                                       m05
//  z= 2   m15 m14 m13 m12 m11 m10 m09 m08 m07 m06
//  z= 3   m16
//  z= 4   m17 m18 m19 m20 goal
import type { Board } from '../core/types.ts';

export const BOARD_SHORT: Board = {
  id: 'short',
  startId: 'st',
  spaces: [
    { id: 'st', kind: 'start', label: 'たびだち', next: ['br'], position: { x: 0, z: 0 } },
    {
      id: 'br',
      kind: 'branch',
      label: 'わかれ道',
      next: ['c01', 'w01'],
      routeLabels: ['進学ルート', '就職ルート'],
      position: { x: 1, z: 0 },
    },

    // --- 進学ルート ---
    {
      id: 'c01',
      kind: 'event',
      label: '入学金を納める',
      amount: -10_000,
      lossType: 'other',
      next: ['c02'],
      position: { x: 1, z: -1 },
    },
    { id: 'c02', kind: 'card', label: 'カードを引く', next: ['c03'], position: { x: 1, z: -2 } },
    {
      id: 'c03',
      kind: 'event',
      label: '奨学金に合格',
      amount: 5_000,
      next: ['c04'],
      position: { x: 2, z: -2 },
    },
    {
      id: 'c04',
      kind: 'insurance',
      label: '保険の窓口',
      next: ['c05'],
      position: { x: 3, z: -2 },
    },
    {
      id: 'c05',
      kind: 'event',
      label: '徹夜明けで寝込む',
      amount: -2_000,
      lossType: 'illness',
      next: ['c06'],
      position: { x: 4, z: -2 },
    },
    { id: 'c06', kind: 'card', label: 'カードを引く', next: ['c07'], position: { x: 5, z: -2 } },
    {
      id: 'c07',
      kind: 'blank',
      label: '卒業研究',
      next: ['c08'],
      position: { x: 6, z: -2 },
    },
    {
      id: 'c08',
      kind: 'job',
      label: '就職活動（職業を選ぶ）',
      mode: 'choose',
      degree: true,
      mustStop: true,
      next: ['m01'],
      position: { x: 6, z: -1 },
    },

    // --- 就職ルート ---
    {
      id: 'w01',
      kind: 'job',
      label: 'すぐに働く（職業はくじ引き）',
      mode: 'random',
      degree: false,
      mustStop: true,
      next: ['w02'],
      position: { x: 2, z: 0 },
    },
    {
      id: 'w02',
      kind: 'event',
      label: '初めてのボーナス',
      amount: 3_000,
      next: ['w03'],
      position: { x: 3, z: 0 },
    },
    { id: 'w03', kind: 'card', label: 'カードを引く', next: ['w04'], position: { x: 4, z: 0 } },
    {
      id: 'w04',
      kind: 'stock',
      label: '株を買う',
      next: ['m01'],
      position: { x: 5, z: 0 },
    },

    // --- 合流後 ---
    { id: 'm01', kind: 'salary', label: '給料日', next: ['m02'], position: { x: 6, z: 0 } },
    {
      id: 'm02',
      kind: 'event',
      label: '高熱で入院',
      amount: -5_000,
      lossType: 'illness',
      next: ['m03'],
      position: { x: 7, z: 0 },
    },
    { id: 'm03', kind: 'insurance', label: '保険の窓口', next: ['m04'], position: { x: 8, z: 0 } },
    { id: 'm04', kind: 'card', label: 'カードを引く', next: ['m05'], position: { x: 9, z: 0 } },
    {
      id: 'm05',
      kind: 'marriage',
      label: 'ウェディング',
      mustStop: true,
      next: ['m06'],
      position: { x: 9, z: 1 },
    },
    { id: 'm06', kind: 'salary', label: '給料日', next: ['m07'], position: { x: 9, z: 2 } },
    {
      id: 'm07',
      kind: 'house',
      label: '家を探す',
      houseIds: ['cottage', 'loghouse', 'tower'],
      next: ['m08'],
      position: { x: 8, z: 2 },
    },
    {
      id: 'm08',
      kind: 'child',
      label: '赤ちゃん誕生',
      count: 1,
      next: ['m09'],
      position: { x: 7, z: 2 },
    },
    { id: 'm09', kind: 'stock', label: '株を買う', next: ['m10'], position: { x: 6, z: 2 } },
    {
      id: 'm10',
      kind: 'event',
      label: '落雷で家が燃える',
      amount: -12_000,
      lossType: 'fire',
      next: ['m11'],
      position: { x: 5, z: 2 },
    },
    { id: 'm11', kind: 'card', label: 'カードを引く', next: ['m12'], position: { x: 4, z: 2 } },
    { id: 'm12', kind: 'salary', label: '給料日', next: ['m13'], position: { x: 3, z: 2 } },
    { id: 'm13', kind: 'jobChange', label: '転職フェア', next: ['m14'], position: { x: 2, z: 2 } },
    {
      id: 'm14',
      kind: 'child',
      label: 'ふたごが誕生',
      count: 2,
      next: ['m15'],
      position: { x: 1, z: 2 },
    },
    {
      id: 'm15',
      kind: 'stockChange',
      label: '株価が動く',
      next: ['m16'],
      position: { x: 0, z: 2 },
    },
    {
      id: 'm16',
      kind: 'event',
      label: '車をぶつけた',
      amount: -8_000,
      lossType: 'accident',
      next: ['m17'],
      position: { x: 0, z: 3 },
    },
    {
      id: 'm17',
      kind: 'house',
      label: '住みかえ',
      houseIds: ['tower', 'mansion'],
      next: ['m18'],
      position: { x: 0, z: 4 },
    },
    { id: 'm18', kind: 'salary', label: '給料日', next: ['m19'], position: { x: 1, z: 4 } },
    { id: 'm19', kind: 'card', label: 'カードを引く', next: ['m20'], position: { x: 2, z: 4 } },
    {
      id: 'm20',
      kind: 'event',
      label: '発明が大ヒット',
      amount: 20_000,
      next: ['goal'],
      position: { x: 3, z: 4 },
    },
    { id: 'goal', kind: 'goal', label: 'ゴール', next: [], position: { x: 4, z: 4 } },
  ],
};
