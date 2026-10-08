// 結果画面。順位と資産内訳を表示する。
import type { GameResult, GameState } from '../core/types.ts';
import type { DeviceKind, InputButton } from '../input/input.ts';
import { el, getElement } from './dom.ts';
import { formatMoney } from './format.ts';
import { keyLabels } from './hints.ts';

export class ResultScreen {
  private readonly root = getElement('result');
  private onClose: (() => void) | null = null;
  private device: DeviceKind = 'keyboard';
  private hint: HTMLElement | null = null;

  show(state: GameState, result: GameResult, onClose: () => void): void {
    this.onClose = onClose;
    this.root.hidden = false;

    const table = el('table', 'result-table');
    const head = el('tr');
    for (const h of [
      '順位',
      '名前',
      '所持金',
      '家',
      '株',
      'カード',
      '子供',
      '借用証書',
      '総資産',
    ]) {
      head.append(el('th', '', h));
    }
    table.append(head);
    for (const r of result.ranking) {
      const a = r.assets;
      const row = el('tr', result.winners.includes(r.playerIndex) ? 'winner' : '');
      const cells = [
        `${r.rank} 位`,
        state.players[r.playerIndex].name,
        formatMoney(a.money),
        formatMoney(a.houses),
        formatMoney(a.stocks),
        formatMoney(a.cards),
        formatMoney(a.children),
        formatMoney(-a.loans),
        formatMoney(a.total),
      ];
      for (const c of cells) row.append(el('td', '', c));
      table.append(row);
    }

    const box = el('div', 'panel screen');
    this.hint = el('div', 'hint');
    this.renderHint();
    box.append(el('h2', '', '結果発表'), table, this.hint);
    this.root.replaceChildren(box);
  }

  /** 操作案内のキー表記を切り替える */
  setDevice(device: DeviceKind): void {
    this.device = device;
    this.renderHint();
  }

  private renderHint(): void {
    if (this.hint) this.hint.textContent = `${keyLabels(this.device).confirm} でタイトルへ`;
  }

  hide(): void {
    this.onClose = null;
    this.root.hidden = true;
  }

  handleInput(button: InputButton): void {
    if (button !== 'confirm' || !this.onClose) return;
    const cb = this.onClose;
    this.hide();
    cb();
  }
}
