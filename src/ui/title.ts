// 開始画面。人数を上下で選び、決定で開始する。
import type { InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';

export class TitleScreen {
  private readonly root = getElement('title');
  private count = 2;
  private min = 2;
  private max = 4;
  private onStart: ((players: number) => void) | null = null;

  show(min: number, max: number, onStart: (players: number) => void): void {
    this.min = min;
    this.max = max;
    this.count = Math.min(Math.max(this.count, min), max);
    this.onStart = onStart;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.onStart = null;
    this.root.hidden = true;
  }

  handleInput(button: InputButton): void {
    if (!this.onStart) return;
    if (button === 'up' || button === 'right') {
      this.count = Math.min(this.count + 1, this.max);
      this.render();
    } else if (button === 'down' || button === 'left') {
      this.count = Math.max(this.count - 1, this.min);
      this.render();
    } else if (button === 'confirm') {
      const cb = this.onStart;
      this.hide();
      cb(this.count);
    }
  }

  private render(): void {
    const box = el('div', 'panel screen');
    const count = el('div', 'title-count');
    count.append(
      el('span', 'arrow', this.count > this.min ? '▼' : '　'),
      el('span', '', `${this.count} 人で遊ぶ`),
      el('span', 'arrow', this.count < this.max ? '▲' : '　'),
    );
    box.append(
      el('h1', '', 'life-game'),
      el('div', '', 'プレイ人数を選んでください'),
      count,
      el('div', 'hint', '↑↓ で人数を変更 / Enter で開始'),
    );
    this.root.replaceChildren(box);
  }
}
