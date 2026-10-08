// 左下のイベントログ。直近の数行だけを表示する。
import { el, getElement } from './dom.ts';

const MAX_LINES = 6;

export class Log {
  private readonly root = getElement('log');
  private lines: string[] = [];

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  clear(): void {
    this.lines = [];
    this.render();
  }

  push(line: string): void {
    this.lines = [...this.lines, line].slice(-MAX_LINES);
    this.render();
  }

  private render(): void {
    this.root.replaceChildren(...this.lines.map((l) => el('div', 'log-line', l)));
    this.root.classList.add('panel');
  }
}
