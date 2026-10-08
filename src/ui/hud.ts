// 右上の HUD。全プレイヤーの状況を表示し、手番の人を強調する。
import type { GameState, Player } from '../core/types.ts';
import { el, getElement } from './dom.ts';
import { formatMoney, jobName } from './format.ts';

/** HUD が表示に使う値（演出の途中経過を反映できるよう GameState から切り出す） */
export interface HudModel {
  state: GameState;
  players: Player[];
  currentPlayer: number;
  stockPrice: number;
}

export class Hud {
  private readonly root = getElement('hud');
  private readonly colors: string[];

  constructor(colors: string[]) {
    this.colors = colors;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(model: HudModel): void {
    const { state } = model;
    this.root.replaceChildren(
      el('div', 'panel hud-stock', `株価 ${formatMoney(model.stockPrice)}`),
      ...model.players.map((p) => this.renderPlayer(state, p, p.index === model.currentPlayer)),
    );
  }

  private renderPlayer(state: GameState, p: Player, current: boolean): HTMLElement {
    const box = el('div', 'panel hud-player');
    box.classList.toggle('current', current);
    box.classList.toggle('finished', p.finished);
    box.style.setProperty('--player-color', this.colors[p.index % this.colors.length]);

    const head = el('div', 'hud-name');
    head.append(
      el('span', '', `${p.name}${p.finished ? '（ゴール）' : ''}`),
      el('span', 'hud-money', formatMoney(p.money)),
    );

    const family = [p.married ? '既婚' : '独身', p.children > 0 ? `子供 ${p.children}` : '']
      .filter(Boolean)
      .join('・');
    const job = `${jobName(state, p.jobId)}${p.degree ? '（学位）' : ''}`;
    const assets = [
      `家 ${p.houseIds.length}`,
      `株 ${p.stocks}`,
      `借用証書 ${p.loans}`,
      `手札 ${p.hand.length}`,
    ].join(' / ');

    box.append(
      head,
      el('div', 'hud-detail', `${job} / ${family}`),
      el('div', 'hud-detail', assets),
    );
    return box;
  }
}
