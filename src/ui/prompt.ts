// 画面下部の案内。選択肢（例: ルーレット／カード）があれば左右で切り替えて決定する。
import type { DeviceKind, InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';
import { hintText, keyLabels, type HintText } from './hints.ts';

export interface PromptChoice {
  id: string;
  label: string;
}

export class Prompt {
  private readonly root = getElement('prompt');
  private choices: PromptChoice[] = [];
  private selected = 0;
  private message: HintText = '';
  private hint: HintText = '';
  private device: DeviceKind = 'keyboard';
  private onConfirm: ((id: string) => void) | null = null;

  /**
   * 案内を表示する。choices が 2 つ以上なら左右で選べる。
   * message / hint は関数にするとキー表記（Enter / Ⓐ など）を差し込める。
   * onConfirm は決定時に選択中の id（choices が無ければ 'ok'）で呼ばれる
   */
  show(
    message: HintText,
    onConfirm: ((id: string) => void) | null,
    choices: PromptChoice[] = [],
    hint: HintText = '',
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
  info(message: HintText): void {
    this.show(message, null);
  }

  hide(): void {
    this.onConfirm = null;
    this.root.hidden = true;
  }

  /** 操作案内のキー表記を切り替える（表示中なら描き直す） */
  setDevice(device: DeviceKind): void {
    this.device = device;
    if (!this.root.hidden) this.render();
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
    const keys = keyLabels(this.device);
    const children: HTMLElement[] = [el('div', 'prompt-message', hintText(this.message, keys))];
    if (this.choices.length > 0) {
      const row = el('div', 'prompt-choices');
      row.append(
        ...this.choices.map((c, i) =>
          el('span', `prompt-choice${i === this.selected ? ' selected' : ''}`, c.label),
        ),
      );
      children.push(row);
    }
    const hint = hintText(this.hint, keys);
    if (hint) children.push(el('div', 'prompt-hint', hint));
    this.root.replaceChildren(...children);
  }
}
