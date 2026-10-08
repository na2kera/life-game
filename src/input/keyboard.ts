// キーボード入力: Enter/Space = 決定、Escape = キャンセル、矢印 = 方向
import type { InputButton, InputListener, InputSource } from './input.ts';

const KEY_MAP: Record<string, InputButton> = {
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'cancel',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export class KeyboardSource implements InputSource {
  private readonly target: Window;

  constructor(target: Window = window) {
    this.target = target;
  }

  subscribe(listener: InputListener): () => void {
    const onKeyDown = (e: KeyboardEvent): void => {
      const button = KEY_MAP[e.code];
      if (!button) return;
      e.preventDefault();
      // 決定・キャンセルの押しっぱなしによる連打は無視する（方向キーはリピート可）
      if (e.repeat && (button === 'confirm' || button === 'cancel')) return;
      listener(button, 'keyboard');
    };
    this.target.addEventListener('keydown', onKeyDown);
    return () => this.target.removeEventListener('keydown', onKeyDown);
  }
}
