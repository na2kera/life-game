// 画面下部の案内。選択肢（例: ルーレット／カード）があれば左右で切り替えて決定する。
import type { InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';

export interface PromptChoice {
  id: string;
  label: string;
}

export class Prompt {
  private readonly root = getElement('prompt');
  private choices: PromptChoice[] = [];
  private selected = 0;
  private message = '';
  private hint = '';
  private onConfirm: ((id: string) => void) | null = null;

  /**
   * 案内を表示する。choices が 2 つ以上なら左右で選べる。
   * onConfirm は決定時に選択中の id（choices が無ければ 'ok'）で呼ばれる
   */
  show(
    message: string,
    onConfirm: ((id: string) => void) | null,
    choices: PromptChoice[] = [],
    hint = '',
  ): void {
    this.message = message;
    this.choices = choices;
    this.selected = 0;
    this.hint = hint;
    this.onConfirm = onConfirm;
    this.root.classList.add('panel');
    this.root.hidden = false;
    this.render();
  }

  /** 決定を受け付けない表示だけの案内（演出中など） */
  info(message: string): void {
    this.show(message, null);
  }

  hide(): void {
    this.onConfirm = null;
    this.root.hidden = true;
  }

  handleInput(button: InputButton): void {
    if (!this.onConfirm) return;
    const n = this.choices.length;
    if (n > 1 && (button === 'left' || button === 'right')) {
      this.selected = (this.selected + (button === 'left' ? n - 1 : 1)) % n;
      this.render();
      return;
    }
    if (button === 'confirm') {
      const cb = this.onConfirm;
      const id = n > 0 ? this.choices[this.selected].id : 'ok';
      this.onConfirm = null;
      cb(id);
    }
  }

  private render(): void {
    const children: HTMLElement[] = [el('div', 'prompt-message', this.message)];
    if (this.choices.length > 0) {
      const row = el('div', 'prompt-choices');
      row.append(
        ...this.choices.map((c, i) =>
          el('span', `prompt-choice${i === this.selected ? ' selected' : ''}`, c.label),
        ),
      );
      children.push(row);
    }
    if (this.hint) children.push(el('div', 'prompt-hint', this.hint));
    this.root.replaceChildren(...children);
  }
}
