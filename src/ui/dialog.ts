// 選択肢ダイアログ（choiceRequested）。上下で選び、決定で確定する。
import type { ChoiceOption } from '../core/types.ts';
import type { InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';

/** キャンセルボタンで選ぶ選択肢の id（見つかった最初のもの） */
const CANCEL_IDS = ['cancel', 'skip', 'done'];

export class Dialog {
  private readonly root = getElement('dialog');
  private title = '';
  private options: ChoiceOption[] = [];
  private selected = 0;
  private onChoose: ((optionId: string) => void) | null = null;

  get isOpen(): boolean {
    return this.onChoose !== null;
  }

  open(title: string, options: ChoiceOption[], onChoose: (optionId: string) => void): void {
    this.title = title;
    this.options = options;
    this.selected = 0;
    this.onChoose = onChoose;
    this.root.classList.add('panel');
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.onChoose = null;
    this.root.hidden = true;
  }

  handleInput(button: InputButton): void {
    if (!this.onChoose || this.options.length === 0) return;
    const n = this.options.length;
    switch (button) {
      case 'up':
        this.selected = (this.selected - 1 + n) % n;
        this.render();
        break;
      case 'down':
        this.selected = (this.selected + 1) % n;
        this.render();
        break;
      case 'confirm':
        this.choose(this.options[this.selected].id);
        break;
      case 'cancel': {
        const cancel = this.options.find((o) => CANCEL_IDS.includes(o.id));
        if (cancel) this.choose(cancel.id);
        break;
      }
      default:
        break;
    }
  }

  private choose(optionId: string): void {
    const cb = this.onChoose;
    this.close();
    cb?.(optionId);
  }

  private render(): void {
    this.root.replaceChildren(
      el('div', 'dialog-title', this.title),
      ...this.options.map((o, i) =>
        el('div', `dialog-option${i === this.selected ? ' selected' : ''}`, o.label),
      ),
    );
  }
}
