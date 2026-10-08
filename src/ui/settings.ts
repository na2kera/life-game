// コントローラー設定画面。接続中のパッドと「いま押されている生の入力」を表示し、
// 決定 → キャンセル → 上 → 下 → 左 → 右 の順に実際に押して割り当てる。
// キーボードは常に有効なので、割り当てに失敗しても Esc で抜けられる。
import type { GamepadSource, PadInfo, RawDetection } from '../input/gamepad.ts';
import type { DeviceKind, InputButton } from '../input/input.ts';
import type { MappingStore } from '../input/mapping-store.ts';
import { INPUT_BUTTONS, formatBinding } from '../input/mapping.ts';
import { Assignment, isAbortInput } from './assignment.ts';
import { el, getElement } from './dom.ts';
import { keyLabels } from './hints.ts';

const BUTTON_NAMES: Record<InputButton, string> = {
  confirm: '決定',
  cancel: 'キャンセル',
  up: '上',
  down: '下',
  left: '左',
  right: '右',
};

type MenuId = 'assign' | 'reset' | 'back';
const MENU: readonly { id: MenuId; label: string }[] = [
  { id: 'assign', label: '割り当てを始める' },
  { id: 'reset', label: '既定に戻す' },
  { id: 'back', label: '戻る' },
];

/** 描画内容。前回と同じなら DOM を作り直さない（毎フレーム呼ばれるため） */
interface View {
  pads: { title: string; id: string }[];
  pressed: string;
  last: string;
  assigning: { step: string; done: string } | null;
  selected: number;
  message: string;
  device: DeviceKind;
}

export class SettingsScreen {
  private readonly root = getElement('settings');
  private readonly gamepad: GamepadSource;
  private readonly store: MappingStore;
  private selected = 0;
  private device: DeviceKind = 'keyboard';
  private message = '';
  private assigning: Assignment | null = null;
  private onClose: (() => void) | null = null;
  private offRaw: (() => void) | null = null;
  private offDevices: (() => void) | null = null;
  private lastViewKey = '';

  constructor(gamepad: GamepadSource, store: MappingStore) {
    this.gamepad = gamepad;
    this.store = store;
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.selected = 0;
    this.message = '';
    this.assigning = null;
    this.offRaw?.();
    this.offDevices?.();
    this.offRaw = this.gamepad.onRawInput((d) => this.onRaw(d));
    this.offDevices = this.gamepad.onDeviceChange((pads) => this.onPadsChange(pads));
    this.root.hidden = false;
    this.render(true);
  }

  hide(): void {
    this.stopAssigning();
    this.offRaw?.();
    this.offRaw = null;
    this.offDevices?.();
    this.offDevices = null;
    this.onClose = null;
    this.root.hidden = true;
  }

  setDevice(device: DeviceKind): void {
    this.device = device;
    if (!this.root.hidden) this.render();
  }

  /** 毎フレーム呼ぶ（生入力の表示更新） */
  update(): void {
    if (!this.onClose) return;
    this.render();
  }

  /** 対象パッドが一覧から消えたら（切断・別パッドへの差し替え）即座に中断する */
  private onPadsChange(pads: PadInfo[]): void {
    if (this.assigning?.isPadLost(pads)) {
      this.stopAssigning();
      this.message = '対象のコントローラーが切断されたので中断しました';
    }
    this.render();
  }

  handleInput(button: InputButton, device?: DeviceKind): void {
    if (!this.onClose) return;
    if (this.assigning) {
      // 割り当て中はパッドの抽象入力は止めてある。キーボードの Esc だけ受け付ける
      if (isAbortInput(button, device)) {
        this.stopAssigning();
        this.message = '割り当てを中断しました';
        this.render();
      }
      return;
    }
    switch (button) {
      case 'up':
      case 'down':
        this.selected = (this.selected + (button === 'up' ? MENU.length - 1 : 1)) % MENU.length;
        this.render();
        break;
      case 'confirm':
        this.execute(MENU[this.selected].id);
        break;
      case 'cancel':
        this.close();
        break;
      default:
        break;
    }
  }

  private execute(id: MenuId): void {
    switch (id) {
      case 'assign':
        this.assigning = new Assignment();
        this.message = '';
        this.gamepad.setCapture(true);
        break;
      case 'reset':
        this.store.clearAll();
        this.gamepad.refreshMappings();
        this.message = 'すべてのコントローラーを既定の割り当てに戻しました';
        break;
      case 'back':
        this.close();
        return;
    }
    this.render();
  }

  private close(): void {
    const cb = this.onClose;
    this.hide();
    cb?.();
  }

  private stopAssigning(): void {
    if (!this.assigning) return;
    this.assigning = null;
    this.gamepad.setCapture(false);
  }

  private onRaw(d: RawDetection): void {
    const a = this.assigning;
    if (!a) return;
    const result = a.input(d, this.gamepad.devices());
    switch (result.type) {
      case 'ignored':
        return;
      case 'duplicate':
        this.message = `${formatBinding(result.binding)} は割り当て済みです。別の入力を押してください`;
        break;
      case 'recorded':
        this.message = '';
        break;
      case 'done':
        this.store.set(result.pad.id, result.mapping);
        this.stopAssigning();
        this.gamepad.refreshMappings();
        this.message = `${result.pad.label}（#${result.pad.index}）の割り当てを保存しました`;
        break;
    }
    this.render();
  }

  private view(): View {
    const pads = this.gamepad.devices();
    const pressed = pads.flatMap((p) =>
      this.gamepad.activeInputs(p.index).map((b) => `#${p.index} ${formatBinding(b)}`),
    );
    const last = this.gamepad.lastDetected();
    const a = this.assigning;
    return {
      pads: pads.map((p) => ({
        title: `#${p.index} ${p.label}（${p.custom ? 'カスタム' : '既定'}の割り当て）`,
        id: p.id,
      })),
      pressed: pressed.length > 0 ? pressed.join(' / ') : 'なし',
      last: last ? `#${last.padIndex} ${formatBinding(last.binding)}` : 'なし',
      assigning: a
        ? {
            step: `「${BUTTON_NAMES[INPUT_BUTTONS[a.bindings.length]]}」に使う入力をコントローラーで押してください（${a.bindings.length + 1}/${INPUT_BUTTONS.length}）`,
            done: a.bindings
              .map((b, i) => `${BUTTON_NAMES[INPUT_BUTTONS[i]]}: ${formatBinding(b)}`)
              .join(' / '),
          }
        : null,
      selected: this.selected,
      message: this.message,
      device: this.device,
    };
  }

  private render(force = false): void {
    const v = this.view();
    const key = JSON.stringify(v);
    if (!force && key === this.lastViewKey) return;
    this.lastViewKey = key;
    const keys = keyLabels(v.device);

    const box = el('div', 'panel screen');
    box.append(el('h2', '', 'コントローラー設定'));

    if (v.pads.length === 0) {
      box.append(el('div', '', 'コントローラーのボタンをどれか押すと認識されます'));
    } else {
      for (const p of v.pads) {
        box.append(el('div', '', p.title), el('div', 'prompt-hint', p.id));
      }
    }

    box.append(
      el('div', 'hint', `いま押されている入力: ${v.pressed}`),
      el('div', 'prompt-hint', `最後に検出した入力: ${v.last}`),
    );

    if (v.assigning) {
      box.append(el('div', 'prompt-message', v.assigning.step));
      if (v.assigning.done) box.append(el('div', 'prompt-hint', v.assigning.done));
    } else {
      const menu = el('div');
      menu.append(
        ...MENU.map((m, i) =>
          el('div', `dialog-option${i === v.selected ? ' selected' : ''}`, m.label),
        ),
      );
      box.append(menu);
    }

    if (v.message) box.append(el('div', 'prompt-hint', v.message));

    box.append(
      el(
        'div',
        'hint',
        v.assigning
          ? 'キーボードの Esc で中断'
          : `${keys.vertical} で選択 / ${keys.confirm} で決定 / ${keys.cancel} で戻る`,
      ),
    );
    this.root.replaceChildren(box);
  }
}
