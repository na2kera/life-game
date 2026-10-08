// 開始画面。2 行メニュー: 「○ 人で遊ぶ」（左右で人数変更、決定で開始）と「コントローラー設定」。
import type { DeviceKind, InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';
import { keyLabels } from './hints.ts';

type Row = 'start' | 'settings';
const ROWS: readonly Row[] = ['start', 'settings'];

export class TitleScreen {
  private readonly root = getElement('title');
  private count = 2;
  private min = 2;
  private max = 4;
  private row = 0;
  private device: DeviceKind = 'keyboard';
  private onStart: ((players: number) => void) | null = null;
  private onSettings: (() => void) | null = null;

  show(min: number, max: number, onStart: (players: number) => void, onSettings: () => void): void {
    this.min = min;
    this.max = max;
    this.count = Math.min(Math.max(this.count, min), max);
    this.onStart = onStart;
    this.onSettings = onSettings;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.onStart = null;
    this.onSettings = null;
    this.root.hidden = true;
  }

  /** 操作案内のキー表記を切り替える（表示中なら描き直す） */
  setDevice(device: DeviceKind): void {
    this.device = device;
    if (!this.root.hidden) this.render();
  }

  handleInput(button: InputButton): void {
    if (!this.onStart) return;
    const row = ROWS[this.row];
    switch (button) {
      case 'up':
      case 'down':
        this.row = (this.row + (button === 'up' ? ROWS.length - 1 : 1)) % ROWS.length;
        this.render();
        break;
      case 'left':
      case 'right':
        if (row !== 'start') break;
        this.count =
          button === 'right'
            ? Math.min(this.count + 1, this.max)
            : Math.max(this.count - 1, this.min);
        this.render();
        break;
      case 'confirm':
        if (row === 'start') {
          const cb = this.onStart;
          this.hide();
          cb(this.count);
        } else {
          const cb = this.onSettings;
          this.hide();
          cb?.();
        }
        break;
      case 'cancel':
        break;
    }
  }

  private render(): void {
    const keys = keyLabels(this.device);
    const row = ROWS[this.row];
    const box = el('div', 'panel screen');

    const count = el('div', 'title-count');
    const countItem = el('span', `prompt-choice${row === 'start' ? ' selected' : ''}`);
    countItem.append(
      el('span', 'arrow', this.count > this.min ? '◀' : '　'),
      el('span', '', `${this.count} 人で遊ぶ`),
      el('span', 'arrow', this.count < this.max ? '▶' : '　'),
    );
    count.append(countItem);

    const settings = el('div');
    settings.append(
      el('span', `prompt-choice${row === 'settings' ? ' selected' : ''}`, 'コントローラー設定'),
    );

    box.append(
      el('h1', '', 'life-game'),
      el('div', '', 'プレイ人数を選んでください'),
      count,
      settings,
      el(
        'div',
        'hint',
        `${keys.horizontal} で人数を変更 / ${keys.vertical} で項目を選択 / ${keys.confirm} で決定`,
      ),
    );
    this.root.replaceChildren(box);
  }
}
