// ゲームの型定義。core は three.js・DOM に依存しない純粋 TS。

// ---------------------------------------------------------------------------
// 盤面
// ---------------------------------------------------------------------------

/** view 用の座標（メートル。マス 1 個 = 1m） */
export interface Position {
  x: number;
  z: number;
}

/** 損失の種別。対応する保険があれば免除される */
export type LossType = 'illness' | 'fire' | 'accident' | 'other';

/** 保険の種類（生命・火災・自動車） */
export type InsuranceType = 'life' | 'fire' | 'auto';

interface SpaceBase {
  id: string;
  /** マスに表示する文言（オリジナル） */
  label: string;
  /** 次のマス。2 つ以上なら分岐（通過時に選択） */
  next: string[];
  position: Position;
  /** true なら出目が余っていてもこのマスで止まる */
  mustStop?: boolean;
}

export type SpaceEffect =
  | { kind: 'start' }
  | { kind: 'blank' }
  /** 分岐。routeLabels は next と同じ順のルート名 */
  | { kind: 'branch'; routeLabels: string[] }
  | { kind: 'salary' }
  /**
   * 職業マス。mode=choose は候補から選ぶ、random はランダム。
   * degree=true なら学位を得て、学位が必要な職業も候補になる
   */
  | { kind: 'job'; mode: 'choose' | 'random'; degree: boolean }
  | { kind: 'marriage' }
  | { kind: 'child'; count: number }
  | { kind: 'house'; houseIds: string[] }
  /** amount が正なら収入、負なら損失（lossType は損失時の種別） */
  | { kind: 'event'; amount: number; lossType?: LossType }
  | { kind: 'card' }
  | { kind: 'insurance' }
  | { kind: 'stock' }
  | { kind: 'stockChange' }
  | { kind: 'jobChange' }
  | { kind: 'goal' };

export type SpaceKind = SpaceEffect['kind'];

export type Space = SpaceBase & SpaceEffect;

export interface Board {
  id: string;
  startId: string;
  spaces: Space[];
}

// ---------------------------------------------------------------------------
// 職業・家・カード
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  name: string;
  salary: number;
  /** true なら学位（進学ルート）が必要 */
  requiresDegree: boolean;
}

export interface House {
  id: string;
  name: string;
  price: number;
  /** ゴール時の評価額 */
  value: number;
}

export type CardEffect =
  /** お金の増減。負なら損失（lossType は既定 other） */
  | { type: 'money'; amount: number; lossType?: LossType }
  /** ゴールしていない他の全プレイヤーから 1 人あたり amount を徴収 */
  | { type: 'collect'; amountPerPlayer: number }
  /** steps マス進む（通常の移動ルールに従う） */
  | { type: 'advance'; steps: number }
  /** 所持カード: 次のルーレットの出目に amount を加える */
  | { type: 'spinBonus'; amount: number }
  /** 所持カード: 損失を 1 回無効化する */
  | { type: 'lossShield' }
  /** 所持カード: 選んだ相手から相手の給料 1 回分をもらう */
  | { type: 'stealSalary' };

export type CardEffectType = CardEffect['type'];

export interface Card {
  id: string;
  name: string;
  text: string;
  /** instant: 引いたら即時適用。hold: 手札に入る */
  kind: 'instant' | 'hold';
  effect: CardEffect;
  /** 山札に入る枚数 */
  copies: number;
}

// ---------------------------------------------------------------------------
// 調整用の定数（data/constants.ts で定義）
// ---------------------------------------------------------------------------

export interface RuleConstants {
  minPlayers: number;
  maxPlayers: number;
  initialMoney: number;
  roulette: { min: number; max: number };
  loan: { unit: number; repayAmount: number };
  insurance: Record<InsuranceType, { name: string; price: number }>;
  /** 損失種別 → 免除できる保険（null は保険なし） */
  lossCoverage: Record<LossType, InsuranceType | null>;
  stock: {
    buyPrice: number;
    initialPrice: number;
    maxHold: number;
    minPrice: number;
    maxPrice: number;
    /** 出目 → 株価の変動額。index = 出目 - roulette.min */
    changeTable: number[];
  };
  marriageGiftPerPlayer: number;
  childGiftPerPlayer: number;
  childBonus: number;
  handLimit: number;
  cardCashValue: number;
  jobCandidates: number;
}

export interface GameData {
  board: Board;
  jobs: Job[];
  houses: House[];
  cards: Card[];
  rules: RuleConstants;
}

// ---------------------------------------------------------------------------
// プレイヤー・状態
// ---------------------------------------------------------------------------

export interface AssetBreakdown {
  money: number;
  houses: number;
  stocks: number;
  cards: number;
  children: number;
  /** 借用証書の返済額（総資産から差し引く） */
  loans: number;
  total: number;
}

export interface Player {
  index: number;
  name: string;
  spaceId: string;
  money: number;
  jobId: string | null;
  degree: boolean;
  married: boolean;
  children: number;
  houseIds: string[];
  insurances: InsuranceType[];
  stocks: number;
  /** 借用証書の枚数 */
  loans: number;
  /** 所持カード（カード id） */
  hand: string[];
  /** 次のルーレットに加算する値（所持カード使用による） */
  spinBonus: number;
  finished: boolean;
  /** ゴール時に確定した資産内訳 */
  result: AssetBreakdown | null;
}

export interface ChoiceOption {
  id: string;
  label: string;
}

/** 選択待ちの内容。kind ごとに解決に必要な情報を持つ */
export type PendingChoiceDetail =
  | { kind: 'branch'; spaceId: string; steps: number }
  | { kind: 'job'; spaceId: string; degree: boolean }
  | { kind: 'jobChange'; spaceId: string }
  | { kind: 'house'; spaceId: string }
  | { kind: 'insurance'; spaceId: string }
  | { kind: 'stock'; spaceId: string }
  | { kind: 'repayLoan' }
  | {
      kind: 'lossShield';
      amount: number;
      lossType: LossType;
      cardId: string;
      reason: MoneyReason;
    }
  | { kind: 'cardTarget'; cardId: string };

export type ChoiceKind = PendingChoiceDetail['kind'];

export type PendingChoice = PendingChoiceDetail & {
  /** 連番の選択 id */
  id: number;
  playerIndex: number;
  options: ChoiceOption[];
};

/** 内部の処理キュー（スタック）。外部から直接触らない */
export type Task =
  | { type: 'move'; steps: number; forcedNext?: string }
  | { type: 'land'; spaceId: string }
  | { type: 'endTurn' };

export type Phase =
  /** ルーレット待ち。move は移動、stockChange は株価変動 */
  | { type: 'spin'; purpose: 'move' | 'stockChange' }
  /** pendingChoice の選択待ち */
  | { type: 'choice' }
  /** 手番終了。next で次の人へ */
  | { type: 'turnEnd' }
  | { type: 'gameOver' }
  /** 処理中（applyAction の内部でのみ使う。外には出ない） */
  | { type: 'resolving' };

export interface RankingEntry {
  playerIndex: number;
  rank: number;
  assets: AssetBreakdown;
}

export interface GameResult {
  ranking: RankingEntry[];
  winners: number[];
}

export interface GameState {
  readonly data: GameData;
  players: Player[];
  currentPlayer: number;
  /** 何手番目か（1 始まり） */
  turn: number;
  phase: Phase;
  pendingChoice: PendingChoice | null;
  tasks: Task[];
  stockPrice: number;
  /** 山札（末尾が一番上） */
  deck: string[];
  discard: string[];
  /** シード付き乱数の内部状態 */
  rng: number;
  finishOrder: number[];
  result: GameResult | null;
  nextChoiceId: number;
}

export interface GameConfig {
  players: { name: string }[];
  seed: number;
  data: GameData;
}

// ---------------------------------------------------------------------------
// アクション・イベント
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'spin' }
  | { type: 'choose'; optionId: string }
  /** 所持カードを使う（ルーレット前のみ） */
  | { type: 'useCard'; cardId: string }
  | { type: 'next' };

export type MoneyReason =
  | 'salary'
  | 'event'
  | 'card'
  | 'gift'
  | 'loan'
  | 'loanRepay'
  | 'house'
  | 'insurance'
  | 'stock'
  | 'stealSalary';

export type GameEvent =
  | { type: 'actionRejected'; action: Action; reason: string }
  | { type: 'turnChanged'; playerIndex: number; turn: number }
  | {
      type: 'spun';
      playerIndex: number;
      purpose: 'move' | 'stockChange';
      value: number;
      bonus: number;
      total: number;
    }
  /** path は from を含まない通過順のマス id。最後が to */
  | { type: 'moved'; playerIndex: number; from: string; to: string; path: string[] }
  | { type: 'landed'; playerIndex: number; spaceId: string; kind: SpaceKind }
  | {
      type: 'moneyChanged';
      playerIndex: number;
      delta: number;
      money: number;
      reason: MoneyReason;
    }
  | { type: 'salaryPaid'; playerIndex: number; amount: number; passing: boolean }
  | { type: 'loanIssued'; playerIndex: number; count: number; amount: number; loans: number }
  | { type: 'loanRepaid'; playerIndex: number; count: number; amount: number; loans: number }
  | { type: 'jobAssigned'; playerIndex: number; jobId: string; previousJobId: string | null }
  | { type: 'jobKept'; playerIndex: number; jobId: string }
  | { type: 'degreeEarned'; playerIndex: number }
  | { type: 'married'; playerIndex: number }
  | { type: 'childBorn'; playerIndex: number; count: number; children: number }
  | { type: 'houseBought'; playerIndex: number; houseId: string; price: number }
  | { type: 'insuranceBought'; playerIndex: number; insurance: InsuranceType; price: number }
  | { type: 'stockBought'; playerIndex: number; price: number; stocks: number }
  | { type: 'stockPriceChanged'; roll: number; from: number; to: number }
  | {
      type: 'eventOccurred';
      playerIndex: number;
      spaceId: string;
      amount: number;
      lossType: LossType | null;
    }
  | {
      type: 'lossExempted';
      playerIndex: number;
      amount: number;
      lossType: LossType;
      by: 'insurance' | 'card';
      insurance: InsuranceType | null;
      cardId: string | null;
    }
  | { type: 'cardDrawn'; playerIndex: number; cardId: string }
  | { type: 'cardKept'; playerIndex: number; cardId: string; hand: string[] }
  | { type: 'cardDiscarded'; playerIndex: number; cardId: string; reason: 'handFull' }
  | { type: 'cardUsed'; playerIndex: number; cardId: string; targetIndex: number | null }
  | { type: 'deckReshuffled'; size: number }
  | { type: 'deckEmpty' }
  | { type: 'choiceRequested'; choice: PendingChoice }
  | { type: 'choiceMade'; playerIndex: number; kind: ChoiceKind; optionId: string }
  | { type: 'goal'; playerIndex: number; order: number; assets: AssetBreakdown }
  | { type: 'gameOver'; result: GameResult };

export type GameEventType = GameEvent['type'];

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}
