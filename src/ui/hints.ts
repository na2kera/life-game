// 操作案内のキー表記。最後に使ったデバイスに合わせて切り替える。
import type { DeviceKind } from '../input/input.ts';

export interface KeyLabels {
  confirm: string;
  cancel: string;
  /** 上下 */
  vertical: string;
  /** 左右 */
  horizontal: string;
}

const KEYBOARD: KeyLabels = { confirm: 'Enter', cancel: 'Esc', vertical: '↑↓', horizontal: '←→' };
const PAD: KeyLabels = {
  confirm: 'Ⓐ',
  cancel: 'Ⓑ',
  vertical: 'スティック上下',
  horizontal: 'スティック左右',
};

export function keyLabels(device: DeviceKind): KeyLabels {
  return device === 'keyboard' ? KEYBOARD : PAD;
}

/** 固定の文字列か、キー表記から作る文字列 */
export type HintText = string | ((keys: KeyLabels) => string);

export function hintText(text: HintText, keys: KeyLabels): string {
  return typeof text === 'function' ? text(keys) : text;
}
