// Gamepad API 入力。毎フレーム navigator.getGamepads() をポーリングし、接続中の全パッドの入力を
// 同じ抽象入力として配信する（交代プレイなのでどのパッドかは区別しない）。
import type { DeviceKind, InputButton, InputListener, InputSource } from './input.ts';
import { deviceKindOf, deviceLabel, detectDeviceType, type DeviceType } from './joycon.ts';
import { MappingStore } from './mapping-store.ts';
import {
  INPUT_BUTTONS,
  activeRawInputs,
  detectBinding,
  isHatNeutralValue,
  resolve,
  type GamepadSnapshot,
  type Mapping,
  type RawBinding,
} from './mapping.ts';

/** 方向の押しっぱなし: 最初の再発火までの時間 */
export const REPEAT_DELAY_MS = 400;
/** 方向の押しっぱなし: 以降の再発火間隔 */
export const REPEAT_INTERVAL_MS = 150;

const REPEATABLE: ReadonlySet<InputButton> = new Set(['up', 'down', 'left', 'right']);

/** Gamepad の必要部分だけ（テストでモックしやすいように） */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

type GamepadEventType = 'gamepadconnected' | 'gamepaddisconnected';

/** 外界への依存（navigator / window / performance）。テストでは差し替える */
export interface GamepadEnv {
  getGamepads(): readonly (GamepadLike | null)[];
  now(): number;
  addEventListener?(type: GamepadEventType, listener: () => void): void;
  removeEventListener?(type: GamepadEventType, listener: () => void): void;
}

/** 接続中のパッドの情報（設定画面・ログ表示用） */
export interface PadInfo {
  index: number;
  id: string;
  type: DeviceType;
  label: string;
  kind: DeviceKind;
  /** カスタム割り当てを使っているか（false なら機種の既定） */
  custom: boolean;
}

/** 設定画面向け: 新しく入った生入力 */
export interface RawDetection {
  padIndex: number;
  binding: RawBinding;
  at: number;
}

interface PadState {
  info: PadInfo;
  mapping: Mapping;
  snapshot: GamepadSnapshot;
  pressed: Set<InputButton>;
  /** 方向ごとの次の再発火時刻 */
  repeatAt: Map<InputButton, number>;
  /** ハット軸（ニュートラルが -1〜1 の外）と判明した軸 */
  hatAxes: Set<number>;
  /**
   * true なら次の step で「その時点で押されているもの」を前回値とみなす（立ち上がりにしない）。
   * capture 解除やマッピング変更の直後に、押しっぱなしの入力が漏れないようにする
   */
  resync: boolean;
}

function browserEnv(): GamepadEnv {
  const hasWindow = typeof window !== 'undefined';
  return {
    getGamepads: () =>
      typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
        ? navigator.getGamepads()
        : [],
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    addEventListener: hasWindow ? (t, l) => window.addEventListener(t, l) : undefined,
    removeEventListener: hasWindow ? (t, l) => window.removeEventListener(t, l) : undefined,
  };
}

function toSnapshot(gp: GamepadLike): GamepadSnapshot {
  return {
    buttons: gp.buttons.map((b) => b.pressed),
    axes: [...gp.axes],
  };
}

function copySnapshot(s: GamepadSnapshot): GamepadSnapshot {
  return { buttons: [...s.buttons], axes: [...s.axes] };
}

export class GamepadSource implements InputSource {
  private readonly env: GamepadEnv;
  private readonly store: MappingStore;
  private readonly listeners = new Set<InputListener>();
  private readonly deviceListeners = new Set<(pads: PadInfo[]) => void>();
  private readonly rawListeners = new Set<(d: RawDetection) => void>();
  private readonly pads = new Map<number, PadState>();
  private capture = false;
  private last: RawDetection | null = null;
  private readonly onConnectionEvent = (): void => this.update();

  constructor(options: { env?: GamepadEnv; store?: MappingStore } = {}) {
    this.env = options.env ?? browserEnv();
    this.store = options.store ?? new MappingStore();
    this.env.addEventListener?.('gamepadconnected', this.onConnectionEvent);
    this.env.addEventListener?.('gamepaddisconnected', this.onConnectionEvent);
  }

  subscribe(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.env.removeEventListener?.('gamepadconnected', this.onConnectionEvent);
    this.env.removeEventListener?.('gamepaddisconnected', this.onConnectionEvent);
    this.listeners.clear();
    this.deviceListeners.clear();
    this.rawListeners.clear();
  }

  /** 接続中のパッド一覧が変わったときに呼ばれる */
  onDeviceChange(listener: (pads: PadInfo[]) => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  /** 新しい生入力（ボタン・軸・ハット）を検出したときに呼ばれる（割り当て用） */
  onRawInput(listener: (d: RawDetection) => void): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  /**
   * true の間は抽象入力を配信しない（割り当て中にパッドの入力でメニューが動かないように）。
   * 生入力の検出は続ける
   */
  setCapture(enabled: boolean): void {
    this.capture = enabled;
    for (const pad of this.pads.values()) {
      pad.repeatAt.clear();
      pad.resync = true;
    }
  }

  devices(): PadInfo[] {
    return [...this.pads.values()].map((p) => ({ ...p.info })).sort((a, b) => a.index - b.index);
  }

  /** 現在の生状態（未接続なら null） */
  rawSnapshot(index: number): GamepadSnapshot | null {
    const pad = this.pads.get(index);
    return pad ? copySnapshot(pad.snapshot) : null;
  }

  /** いま入っている生入力の一覧（設定画面の表示用） */
  activeInputs(index: number): RawBinding[] {
    const pad = this.pads.get(index);
    return pad ? activeRawInputs(pad.snapshot, pad.hatAxes) : [];
  }

  /** 最後に検出した生入力 */
  lastDetected(): RawDetection | null {
    return this.last;
  }

  /** MappingStore を書き換えた後に呼ぶ */
  refreshMappings(): void {
    for (const pad of this.pads.values()) {
      const { mapping, custom } = this.store.mappingFor(pad.info.id, pad.info.type);
      pad.mapping = mapping;
      pad.info.custom = custom;
      pad.repeatAt.clear();
      pad.resync = true;
    }
    this.notifyDevices();
  }

  update(): void {
    const now = this.env.now();
    const seen = new Set<number>();
    let changed = false;

    for (const gp of this.readGamepads()) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      const snapshot = toSnapshot(gp);
      const pad = this.pads.get(gp.index);
      if (!pad || pad.info.id !== gp.id) {
        // 初めて見えたパッド: 認識させるために押したボタンを入力扱いしないよう、現状を基準にする
        this.pads.set(gp.index, this.createPad(gp, snapshot));
        changed = true;
        continue;
      }
      this.step(pad, snapshot, now);
    }

    for (const index of [...this.pads.keys()]) {
      if (!seen.has(index)) {
        this.pads.delete(index);
        changed = true;
      }
    }
    if (changed) this.notifyDevices();
  }

  private step(pad: PadState, snapshot: GamepadSnapshot, now: number): void {
    // 生入力リスナー内で setCapture(false) されても、このフレームはフレーム開始時点の値で判定する
    const capturing = this.capture;
    snapshot.axes.forEach((v, i) => {
      if (isHatNeutralValue(v)) pad.hatAxes.add(i);
    });

    const detected = detectBinding(pad.snapshot, snapshot, pad.hatAxes);
    if (detected) {
      this.last = { padIndex: pad.info.index, binding: detected, at: now };
      for (const listener of [...this.rawListeners]) listener(this.last);
    }

    // マッピングはリスナー内で差し替わることがあるので、検出後に解決する
    const current = resolve(pad.mapping, snapshot);
    const previous = pad.resync ? current : pad.pressed;
    pad.resync = false;
    pad.snapshot = snapshot;
    pad.pressed = current;

    for (const button of [...pad.repeatAt.keys()]) {
      if (!current.has(button)) pad.repeatAt.delete(button);
    }
    if (capturing) {
      // capture 中に押されていたものは、解除後も押しっぱなしの間は新規にしない
      pad.resync = true;
      return;
    }

    for (const button of INPUT_BUTTONS) {
      if (!current.has(button)) continue;
      if (!previous.has(button)) {
        if (REPEATABLE.has(button)) pad.repeatAt.set(button, now + REPEAT_DELAY_MS);
        this.emit(button, pad.info.kind);
        continue;
      }
      const at = pad.repeatAt.get(button);
      if (at !== undefined && now >= at) {
        // フレームが詰まっても連続発火しないよう、現在時刻から次を数える
        pad.repeatAt.set(button, now + REPEAT_INTERVAL_MS);
        this.emit(button, pad.info.kind);
      }
    }
  }

  private createPad(gp: GamepadLike, snapshot: GamepadSnapshot): PadState {
    const type = detectDeviceType(gp.id, gp.mapping);
    const { mapping, custom } = this.store.mappingFor(gp.id, type);
    const hatAxes = new Set<number>();
    snapshot.axes.forEach((v, i) => {
      if (isHatNeutralValue(v)) hatAxes.add(i);
    });
    return {
      info: {
        index: gp.index,
        id: gp.id,
        type,
        label: deviceLabel(type),
        kind: deviceKindOf(type),
        custom,
      },
      mapping,
      snapshot,
      pressed: resolve(mapping, snapshot),
      repeatAt: new Map(),
      hatAxes,
      resync: false,
    };
  }

  private readGamepads(): readonly (GamepadLike | null)[] {
    try {
      return this.env.getGamepads() ?? [];
    } catch {
      // 権限ポリシーなどで使えない環境
      return [];
    }
  }

  private emit(button: InputButton, kind: DeviceKind): void {
    for (const listener of [...this.listeners]) listener(button, kind);
  }

  private notifyDevices(): void {
    const pads = this.devices();
    for (const listener of [...this.deviceListeners]) listener(pads);
  }
}
