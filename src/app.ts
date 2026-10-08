// 進行役。タイトル → ゲーム → 結果を回し、core の events を view / ui の演出に対応付ける。
import * as THREE from 'three';
import { applyAction, createGame, initialEvents, usableCards } from './core/game.ts';
import type {
  Action,
  GameData,
  GameEvent,
  GameEventType,
  GameState,
  Player,
} from './core/types.ts';
import { InputHub, type InputButton } from './input/input.ts';
import { KeyboardSource } from './input/keyboard.ts';
import { Dialog } from './ui/dialog.ts';
import { CHOICE_TITLES, cardName, describeEvent } from './ui/format.ts';
import { Hud, type HudModel } from './ui/hud.ts';
import { Log } from './ui/log.ts';
import { Prompt, type PromptChoice } from './ui/prompt.ts';
import { ResultScreen } from './ui/result.ts';
import { TitleScreen } from './ui/title.ts';
import { Assets } from './view/assets.ts';
import { BoardView } from './view/board-view.ts';
import { FollowCamera } from './view/camera.ts';
import { PieceView, PLAYER_COLORS } from './view/piece-view.ts';
import { RouletteView } from './view/roulette-view.ts';
import { SceneView } from './view/scene.ts';

type Mode = 'loading' | 'title' | 'game' | 'result';

/** 演出の途中経過を表す表示用の値（HUD 用） */
type Display = Omit<HudModel, 'state'>;

type EventHandler<T extends GameEventType> = (
  e: Extract<GameEvent, { type: T }>,
) => Promise<void> | void;

const CARD_PREFIX = 'card:';

export class App {
  private readonly data: GameData;
  private readonly sceneView: SceneView;
  private readonly input = new InputHub();
  private readonly hud = new Hud(PLAYER_COLORS);
  private readonly log = new Log();
  private readonly prompt = new Prompt();
  private readonly dialog = new Dialog();
  private readonly title = new TitleScreen();
  private readonly result = new ResultScreen();

  private mode: Mode = 'loading';
  /** 演出中は入力を受け付けない */
  private busy = false;
  private state: GameState | null = null;
  private display: Display | null = null;

  private assets!: Assets;
  private board!: BoardView;
  private camera!: FollowCamera;
  private roulette!: RouletteView;
  private pieces: PieceView | null = null;
  private readonly boardCenter = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, data: GameData) {
    this.data = data;
    this.sceneView = new SceneView(canvas);
    this.input.addSource(new KeyboardSource());
    this.input.subscribe((b) => this.onInput(b));
    this.sceneView.onFrame(() => this.input.update());
  }

  async start(): Promise<void> {
    this.assets = await Assets.load();
    this.board = new BoardView(this.data.board, this.assets);
    this.sceneView.scene.add(this.board.group);
    this.boardCenter.copy(boardCenterOf(this.data));
    this.camera = new FollowCamera(this.sceneView, this.boardCenter);
    this.roulette = new RouletteView(this.sceneView, this.assets, this.data.rules.roulette);
    this.sceneView.start();
    this.showTitle();
  }

  // -------------------------------------------------------------------------
  // 画面遷移
  // -------------------------------------------------------------------------

  private showTitle(): void {
    this.mode = 'title';
    this.hud.hide();
    this.log.hide();
    this.prompt.hide();
    this.dialog.close();
    this.roulette.hide();
    if (this.pieces) {
      this.sceneView.scene.remove(this.pieces.group);
      this.pieces.dispose();
    }
    this.pieces = null;
    this.state = null;
    this.camera.follow(this.boardCenter);
    const { minPlayers, maxPlayers } = this.data.rules;
    this.title.show(minPlayers, maxPlayers, (n) => void this.startGame(n));
  }

  private async startGame(playerCount: number): Promise<void> {
    const seed = seedFromUrl() ?? Date.now();
    console.info(`[app] seed=${seed}（?seed=${seed} で同じ展開を再現できます）`);
    const players = Array.from({ length: playerCount }, (_, i) => ({ name: `プレイヤー${i + 1}` }));
    const state = createGame({ players, seed, data: this.data });
    this.state = state;
    this.mode = 'game';

    this.pieces = new PieceView(
      this.sceneView,
      this.board,
      this.assets,
      state.players.map((p) => p.spaceId),
    );
    this.sceneView.scene.add(this.pieces.group);
    this.log.clear();
    this.log.show();
    this.hud.show();
    try {
      await this.playEvents(state, initialEvents(state));
    } catch (e) {
      // 演出の失敗で進行が止まらないよう、入力待ちには必ず戻す（busy は playEvents の finally で戻る）
      console.error(e);
    }
    this.waitForInput();
  }

  private showResult(): void {
    const state = this.state;
    if (!state?.result) return;
    this.mode = 'result';
    this.prompt.hide();
    this.result.show(state, state.result, () => this.showTitle());
  }

  // -------------------------------------------------------------------------
  // 入力
  // -------------------------------------------------------------------------

  private onInput(button: InputButton): void {
    if (this.busy) return;
    switch (this.mode) {
      case 'title':
        this.title.handleInput(button);
        break;
      case 'result':
        this.result.handleInput(button);
        break;
      case 'game':
        if (this.dialog.isOpen) this.dialog.handleInput(button);
        else this.prompt.handleInput(button);
        break;
      case 'loading':
        break;
    }
  }

  /** 現在の phase に応じて、次の入力の案内を出す */
  private waitForInput(): void {
    const state = this.state;
    if (!state || this.mode !== 'game') return;
    const player = state.players[state.currentPlayer];
    const phase = state.phase;
    switch (phase.type) {
      case 'spin': {
        this.roulette.show();
        if (phase.purpose === 'stockChange') {
          this.prompt.show('株価が動く！ Enter で株価ルーレットを回す', () =>
            this.dispatch({ type: 'spin' }),
          );
          return;
        }
        const cards = usableCards(state);
        const choices: PromptChoice[] =
          cards.length > 0
            ? [
                { id: 'spin', label: 'ルーレットを回す' },
                ...cards.map((id) => ({
                  id: CARD_PREFIX + id,
                  label: `「${cardName(state, id)}」を使う`,
                })),
              ]
            : [];
        this.prompt.show(
          `${player.name} の番: Enter でルーレットを回す`,
          (id) => {
            if (id.startsWith(CARD_PREFIX)) {
              this.dispatch({ type: 'useCard', cardId: id.slice(CARD_PREFIX.length) });
            } else {
              this.dispatch({ type: 'spin' });
            }
          },
          choices,
          cards.length > 0 ? '←→ でルーレット／カードを切り替え' : '',
        );
        return;
      }
      case 'choice':
        this.roulette.hide();
        this.prompt.hide();
        if (!this.dialog.isOpen) this.openDialog();
        return;
      case 'turnEnd':
        this.roulette.hide();
        this.prompt.show(`${player.name} の番はおわり: Enter で次の人へ`, () =>
          this.dispatch({ type: 'next' }),
        );
        return;
      case 'gameOver':
        this.showResult();
        return;
      case 'resolving':
        return;
    }
  }

  private openDialog(): void {
    const choice = this.state?.pendingChoice;
    if (!choice) return;
    const name = this.state?.players[choice.playerIndex].name ?? '';
    this.dialog.open(`${name}: ${CHOICE_TITLES[choice.kind]}`, choice.options, (optionId) =>
      this.dispatch({ type: 'choose', optionId }),
    );
  }

  private dispatch(action: Action): void {
    const state = this.state;
    if (!state || this.busy) return;
    const result = applyAction(state, action);
    this.state = result.state;
    this.prompt.hide();
    this.playEvents(state, result.events)
      .then(() => this.waitForInput())
      .catch((e: unknown) => {
        console.error(e);
        this.busy = false;
        this.waitForInput();
      });
  }

  // -------------------------------------------------------------------------
  // イベント → 演出
  // -------------------------------------------------------------------------

  /** events を順に演出する。prev は events 適用前の state（HUD の途中経過に使う） */
  private async playEvents(prev: GameState, events: GameEvent[]): Promise<void> {
    const state = this.state;
    if (!state) return;
    this.busy = true;
    this.display = {
      players: structuredClone(prev.players),
      currentPlayer: prev.currentPlayer,
      stockPrice: prev.stockPrice,
    };
    this.renderHud();
    try {
      for (const e of events) {
        if (this.display) patchDisplay(this.display, e);
        this.renderHud();
        const line = describeEvent(e, state);
        if (line) this.log.push(line);
        const handler = this.handlers[e.type] as
          ((e: GameEvent) => Promise<void> | void) | undefined;
        await handler?.(e);
      }
    } finally {
      // 最後は core の state をそのまま表示して食い違いを防ぐ
      this.display = {
        players: state.players,
        currentPlayer: state.currentPlayer,
        stockPrice: state.stockPrice,
      };
      this.renderHud();
      this.busy = false;
    }
  }

  private renderHud(): void {
    if (this.state && this.display) this.hud.render({ state: this.state, ...this.display });
  }

  private followPlayer(playerIndex: number): void {
    if (this.pieces) this.camera.follow(this.pieces.positionOf(playerIndex));
  }

  /** events → 演出の対応表。ここに無いイベントは HUD 更新とログのみ */
  private readonly handlers: { [K in GameEventType]?: EventHandler<K> } = {
    actionRejected: (e) => {
      console.warn('[app] action rejected', e.action, e.reason);
    },
    turnChanged: async (e) => {
      this.followPlayer(e.playerIndex);
      await this.sceneView.wait(0.4);
    },
    spun: async (e) => {
      await this.roulette.spin(e.value);
      await this.sceneView.wait(0.6);
      this.roulette.hide();
    },
    moved: async (e) => {
      this.followPlayer(e.playerIndex);
      await this.pieces?.move(e.playerIndex, e.path);
    },
    landed: () => this.sceneView.wait(0.3),
    salaryPaid: () => this.sceneView.wait(0.3),
    eventOccurred: () => this.sceneView.wait(0.3),
    cardDrawn: () => this.sceneView.wait(0.5),
    stockPriceChanged: () => this.sceneView.wait(0.4),
    goal: () => this.sceneView.wait(0.8),
    choiceRequested: () => this.openDialog(),
  };
}

/** HUD の途中経過を events から更新する（最終値は playEvents の最後に state で上書き） */
function patchDisplay(d: Display, e: GameEvent): void {
  const p: Player | undefined = 'playerIndex' in e ? d.players[e.playerIndex] : undefined;
  switch (e.type) {
    case 'turnChanged':
      d.currentPlayer = e.playerIndex;
      break;
    case 'moneyChanged':
      if (p) p.money = e.money;
      break;
    case 'loanIssued':
    case 'loanRepaid':
      if (p) p.loans = e.loans;
      break;
    case 'jobAssigned':
      if (p) p.jobId = e.jobId;
      break;
    case 'degreeEarned':
      if (p) p.degree = true;
      break;
    case 'married':
      if (p) p.married = true;
      break;
    case 'childBorn':
      if (p) p.children = e.children;
      break;
    case 'houseBought':
      if (p) p.houseIds = [...p.houseIds, e.houseId];
      break;
    case 'insuranceBought':
      if (p) p.insurances = [...p.insurances, e.insurance];
      break;
    case 'stockBought':
      if (p) p.stocks = e.stocks;
      break;
    case 'stockPriceChanged':
      d.stockPrice = e.to;
      break;
    case 'cardKept':
      if (p) p.hand = [...e.hand];
      break;
    case 'cardUsed':
      if (p) {
        const i = p.hand.indexOf(e.cardId);
        if (i >= 0) p.hand = p.hand.filter((_, j) => j !== i);
      }
      break;
    case 'goal':
      if (p) p.finished = true;
      break;
    default:
      break;
  }
}

function boardCenterOf(data: GameData): THREE.Vector3 {
  const xs = data.board.spaces.map((s) => s.position.x);
  const zs = data.board.spaces.map((s) => s.position.z);
  return new THREE.Vector3(
    (Math.min(...xs) + Math.max(...xs)) / 2,
    0,
    (Math.min(...zs) + Math.max(...zs)) / 2,
  );
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
