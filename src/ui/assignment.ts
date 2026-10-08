// ボタン割り当ての状態機械（DOM 非依存。設定画面から使い、単体テストする）。
// 決定 → キャンセル → 上 → 下 → 左 → 右 の順に生入力を記録し、6 つ揃ったら Mapping を作る。
import type { PadInfo, RawDetection } from '../input/gamepad.ts';
import type { DeviceKind, InputButton } from '../input/input.ts';
import { INPUT_BUTTONS, sameBinding, type Mapping, type RawBinding } from '../input/mapping.ts';

export type AssignResult =
  /** 対象外のパッドからの入力、または一覧に無いパッド */
  | { type: 'ignored' }
  /** すでに別の項目に割り当てた入力 */
  | { type: 'duplicate'; binding: RawBinding }
  | { type: 'recorded'; next: InputButton }
  | { type: 'done'; pad: PadInfo; mapping: Mapping };

/** パッドの同一性は index と id の両方で判定する（同じ index に別のパッドが入ることがある） */
export function samePad(
  a: Pick<PadInfo, 'index' | 'id'>,
  b: Pick<PadInfo, 'index' | 'id'>,
): boolean {
  return a.index === b.index && a.id === b.id;
}

/** 割り当て中に中断する入力か（キーボードの Esc のみ。パッドの入力は割り当て対象なので使わない） */
export function isAbortInput(button: InputButton, device?: DeviceKind): boolean {
  return button === 'cancel' && device === 'keyboard';
}

export class Assignment {
  private target: PadInfo | null = null;
  private readonly recorded: RawBinding[] = [];

  /** 対象パッド（最初に入力があったパッド。まだなら null） */
  get pad(): PadInfo | null {
    return this.target;
  }

  get bindings(): readonly RawBinding[] {
    return this.recorded;
  }

  /** 次に割り当てる抽象入力（完了済みなら null） */
  get next(): InputButton | null {
    return INPUT_BUTTONS[this.recorded.length] ?? null;
  }

  /**
   * 生入力を 1 つ受け取る。pads は現在接続中のパッド一覧（入力元の id を知るため）
   */
  input(detection: RawDetection, pads: readonly PadInfo[]): AssignResult {
    if (this.next === null) return { type: 'ignored' };
    const source = pads.find((p) => p.index === detection.padIndex);
    if (!source) return { type: 'ignored' };
    if (!this.target) this.target = { ...source };
    else if (!samePad(this.target, source)) return { type: 'ignored' };

    if (this.recorded.some((b) => sameBinding(b, detection.binding))) {
      return { type: 'duplicate', binding: detection.binding };
    }
    this.recorded.push(detection.binding);
    const next = this.next;
    if (next !== null) return { type: 'recorded', next };

    const mapping = {} as Mapping;
    INPUT_BUTTONS.forEach((button, i) => {
      mapping[button] = [this.recorded[i]];
    });
    return { type: 'done', pad: this.target, mapping };
  }

  /** 対象パッドが一覧から消えた（切断・差し替え）か */
  isPadLost(pads: readonly PadInfo[]): boolean {
    const target = this.target;
    return target !== null && !pads.some((p) => samePad(p, target));
  }
}
