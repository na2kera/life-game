// 抽象入力。キーボード・Gamepad・Joy-Con などの実装はすべて InputSource として InputHub に登録する。

export type InputButton = 'confirm' | 'cancel' | 'up' | 'down' | 'left' | 'right';

/** 操作案内の表記を切り替えるためのデバイス種別 */
export type DeviceKind = 'keyboard' | 'joycon' | 'gamepad';

/** device は省略可（省略時はデバイス切り替えの判定に使わない） */
export type InputListener = (button: InputButton, device?: DeviceKind) => void;

/** 押下イベントを発行する入力デバイス */
export interface InputSource {
  /** 購読を開始する。戻り値は購読解除関数 */
  subscribe(listener: InputListener): () => void;
  /** ポーリングが必要なソース（Gamepad API など）は毎フレーム呼ばれる */
  update?(): void;
  dispose?(): void;
}

/** 複数の InputSource を束ね、どれから押されても同じ抽象入力として配信する */
export class InputHub {
  private readonly listeners = new Set<InputListener>();
  private readonly deviceListeners = new Set<(device: DeviceKind) => void>();
  private readonly unsubscribers = new Map<InputSource, () => void>();
  private active: DeviceKind = 'keyboard';

  /** 最後に入力があったデバイス種別 */
  get activeDevice(): DeviceKind {
    return this.active;
  }

  addSource(source: InputSource): void {
    if (this.unsubscribers.has(source)) return;
    this.unsubscribers.set(
      source,
      source.subscribe((button, device) => this.emit(button, device)),
    );
  }

  removeSource(source: InputSource): void {
    this.unsubscribers.get(source)?.();
    this.unsubscribers.delete(source);
    source.dispose?.();
  }

  /** 毎フレーム呼ぶ（ポーリング型ソースの更新） */
  update(): void {
    for (const source of this.unsubscribers.keys()) source.update?.();
  }

  subscribe(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 最後に使われたデバイス種別が変わったときに呼ばれる */
  onDeviceChange(listener: (device: DeviceKind) => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  /**
   * 入力が無くても使用中のデバイスを切り替える（例: パッドが接続された直後）。
   * 同じ値なら何もしない
   */
  setActiveDevice(device: DeviceKind): void {
    if (device === this.active) return;
    this.active = device;
    for (const listener of [...this.deviceListeners]) listener(device);
  }

  private emit(button: InputButton, device?: DeviceKind): void {
    // 案内の表記を先に切り替えてから入力を配る（入力で出た新しい案内が正しい表記になるように）
    if (device) this.setActiveDevice(device);
    for (const listener of [...this.listeners]) listener(button, device);
  }
}
