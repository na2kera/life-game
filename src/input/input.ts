// 抽象入力。キーボード・Gamepad・Joy-Con などの実装はすべて InputSource として InputHub に登録する。

export type InputButton = 'confirm' | 'cancel' | 'up' | 'down' | 'left' | 'right';

export type InputListener = (button: InputButton) => void;

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
  private readonly unsubscribers = new Map<InputSource, () => void>();

  addSource(source: InputSource): void {
    if (this.unsubscribers.has(source)) return;
    this.unsubscribers.set(
      source,
      source.subscribe((button) => this.emit(button)),
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

  private emit(button: InputButton): void {
    for (const listener of [...this.listeners]) listener(button);
  }
}
