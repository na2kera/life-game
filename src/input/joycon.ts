// Joy-Con / Pro コントローラーの機種判定と既定マッピング。
// 既定の index は「Chrome（macOS, Bluetooth）で最も可能性が高い値」の仮置き。実機で確認したら
// このファイルの JOYCON_* 定数だけを直せばよい（設定画面で生の index を表示できる）。
import type { DeviceKind } from './input.ts';
import type { HatDirection, Mapping, RawBinding } from './mapping.ts';

export type DeviceType = 'joyconL' | 'joyconR' | 'procon' | 'standard' | 'unknown';

const NINTENDO_VENDOR = '057e';
const PRODUCT_TO_TYPE: Record<string, DeviceType> = {
  '2006': 'joyconL',
  '2007': 'joyconR',
  '2009': 'procon',
};

/** gamepad.id と gamepad.mapping から機種を判定する */
export function detectDeviceType(id: string, mapping: string): DeviceType {
  if (id.includes('Joy-Con (L)')) return 'joyconL';
  if (id.includes('Joy-Con (R)')) return 'joyconR';
  if (id.includes('Pro Controller')) return 'procon';
  // Chrome: "... (Vendor: 057e Product: 2007)"、Firefox: "57e-2007-..." / "057e-2007-..."
  const chrome = /vendor:\s*([0-9a-f]{1,4})\b.*product:\s*([0-9a-f]{1,4})\b/i.exec(id);
  const firefox = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  const match = chrome ?? firefox;
  if (match) {
    const vendor = match[1].toLowerCase().padStart(4, '0');
    const product = match[2].toLowerCase().padStart(4, '0');
    const type = PRODUCT_TO_TYPE[product];
    if (vendor === NINTENDO_VENDOR && type) return type;
  }
  if (mapping === 'standard') return 'standard';
  return 'unknown';
}

/** 操作案内の切り替えに使うデバイス種別 */
export function deviceKindOf(type: DeviceType): DeviceKind {
  return type === 'joyconL' || type === 'joyconR' ? 'joycon' : 'gamepad';
}

export function deviceLabel(type: DeviceType): string {
  switch (type) {
    case 'joyconL':
      return 'Joy-Con (L)';
    case 'joyconR':
      return 'Joy-Con (R)';
    case 'procon':
      return 'Pro コントローラー';
    case 'standard':
      return 'ゲームパッド';
    case 'unknown':
      return '不明なコントローラー';
  }
}

// ---------------------------------------------------------------------------
// 既定マッピング
// ---------------------------------------------------------------------------

const button = (index: number): RawBinding => ({ kind: 'button', index });
const axis = (index: number, sign: 1 | -1): RawBinding => ({ kind: 'axis', index, sign });
const hat = (index: number, direction: HatDirection): RawBinding => ({
  kind: 'hat',
  index,
  direction,
});

/** 実機未確認: Joy-Con (R) の物理ボタン index（縦持ち基準の名前） */
const JOYCON_R_BUTTON = { A: 0, X: 1, B: 2, Y: 3 } as const; // 実機未確認
/** 実機未確認: Joy-Con (L) の物理ボタン index（縦持ち基準の名前） */
const JOYCON_L_BUTTON = { left: 0, down: 1, up: 2, right: 3 } as const; // 実機未確認
/** 実機未確認: スティックが 2 軸で来る場合の軸 index（縦持ち基準。+x = 右、+y = 下） */
const JOYCON_STICK_X = 0; // 実機未確認
const JOYCON_STICK_Y = 1; // 実機未確認
/** 実機未確認: スティックが 1 本のハット軸（8 方向値）で来る場合の軸 index */
const JOYCON_STICK_HAT = 9; // 実機未確認

/**
 * 縦持ち基準のスティック方向を、横持ちの上下左右に割り当てる。
 * 引数は「横持ちの上/下/左/右になる縦持ちの方向」。
 */
function stick(
  toUp: HatDirection,
  toDown: HatDirection,
  toLeft: HatDirection,
  toRight: HatDirection,
) {
  const axisOf = (d: HatDirection): RawBinding => {
    switch (d) {
      case 'up':
        return axis(JOYCON_STICK_Y, -1);
      case 'down':
        return axis(JOYCON_STICK_Y, 1);
      case 'left':
        return axis(JOYCON_STICK_X, -1);
      case 'right':
        return axis(JOYCON_STICK_X, 1);
    }
  };
  const both = (d: HatDirection): RawBinding[] => [axisOf(d), hat(JOYCON_STICK_HAT, d)];
  return { up: both(toUp), down: both(toDown), left: both(toLeft), right: both(toRight) };
}

/**
 * Joy-Con (R) 横持ち: 右端 = 物理 X が決定、下 = 物理 A がキャンセル。
 * スティックは時計回りに 90 度（縦持ちの左 → 横持ちの上、縦持ちの下 → 横持ちの左）。
 */
const JOYCON_R_MAPPING: Mapping = {
  confirm: [button(JOYCON_R_BUTTON.X)],
  cancel: [button(JOYCON_R_BUTTON.A)],
  ...stick('left', 'right', 'down', 'up'),
};

/**
 * Joy-Con (L) 横持ち: 右端 = 物理 ↓ が決定、下 = 物理 ← がキャンセル。
 * スティックは反時計回りに 90 度（縦持ちの右 → 横持ちの上、縦持ちの上 → 横持ちの左）。
 */
const JOYCON_L_MAPPING: Mapping = {
  confirm: [button(JOYCON_L_BUTTON.down)],
  cancel: [button(JOYCON_L_BUTTON.left)],
  ...stick('right', 'left', 'up', 'down'),
};

/** Standard Gamepad 配置（Pro コントローラーなど）: 0 = 決定、1 = キャンセル、十字 12〜15、左スティック 0/1 */
const STANDARD_MAPPING: Mapping = {
  confirm: [button(0)],
  cancel: [button(1)],
  up: [button(12), axis(1, -1)],
  down: [button(13), axis(1, 1)],
  left: [button(14), axis(0, -1)],
  right: [button(15), axis(0, 1)],
};

export const DEFAULT_MAPPINGS: Readonly<Record<DeviceType, Mapping>> = {
  joyconL: JOYCON_L_MAPPING,
  joyconR: JOYCON_R_MAPPING,
  procon: STANDARD_MAPPING,
  standard: STANDARD_MAPPING,
  unknown: STANDARD_MAPPING,
};
