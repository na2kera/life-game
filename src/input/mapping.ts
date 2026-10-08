// 生のゲームパッド入力（ボタン index / 軸 index と符号 / ハット軸の 8 方向値）→ 抽象入力の対応表と解決。
// DOM・Gamepad API に依存しない純粋関数だけを置く（テスト対象）。
import type { InputButton } from './input.ts';

export type HatDirection = 'up' | 'down' | 'left' | 'right';

export type RawBinding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; sign: 1 | -1 }
  | { kind: 'hat'; index: number; direction: HatDirection };

/** 1 つの抽象入力に複数の生入力を割り当てられる（例: 十字キーと左スティック） */
export type Mapping = Record<InputButton, RawBinding[]>;

/** ある瞬間のゲームパッドの生状態 */
export interface GamepadSnapshot {
  buttons: boolean[];
  axes: number[];
}

/** 抽象入力の一覧（割り当て順もこの順） */
export const INPUT_BUTTONS: readonly InputButton[] = [
  'confirm',
  'cancel',
  'up',
  'down',
  'left',
  'right',
];

/** 軸をその方向に倒したとみなす閾値 */
export const AXIS_THRESHOLD = 0.5;

const HAT_DIRECTIONS: readonly HatDirection[] = ['up', 'down', 'left', 'right'];

/**
 * Chrome のハット軸は上から時計回りに -1, -5/7, -3/7, -1/7, 1/7, 3/7, 5/7, 1 の 8 値。
 * それ以外（ニュートラルの 9/7 ≒ 1.2857 や 0 など）は「押されていない」。
 */
const HAT_STEPS: readonly (readonly HatDirection[])[] = [
  ['up'],
  ['up', 'right'],
  ['right'],
  ['down', 'right'],
  ['down'],
  ['down', 'left'],
  ['left'],
  ['up', 'left'],
];

/** 格子点（奇数/7）からのずれの許容幅 */
const HAT_TOLERANCE = 0.05;

/** ハット軸の値を方向の集合に変換する。斜めは 2 方向を含む。ニュートラルは空 */
export function hatToDirections(value: number): HatDirection[] {
  if (!Number.isFinite(value) || Math.abs(value) > 1 + HAT_TOLERANCE) return [];
  const pos = ((value + 1) * 7) / 2; // -1 → 0, 1 → 7
  const step = Math.round(pos);
  if (Math.abs(pos - step) * (2 / 7) > HAT_TOLERANCE) return [];
  const dirs = HAT_STEPS[step];
  return dirs ? [...dirs] : [];
}

/** ハット軸のニュートラル値（-1〜1 の外）かどうか */
export function isHatNeutralValue(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) > 1 + HAT_TOLERANCE;
}

export function isBindingActive(binding: RawBinding, snapshot: GamepadSnapshot): boolean {
  switch (binding.kind) {
    case 'button':
      return snapshot.buttons[binding.index] === true;
    case 'axis': {
      const v = snapshot.axes[binding.index];
      return (
        v !== undefined && Math.abs(v) <= 1 + HAT_TOLERANCE && v * binding.sign >= AXIS_THRESHOLD
      );
    }
    case 'hat': {
      const v = snapshot.axes[binding.index];
      return v !== undefined && hatToDirections(v).includes(binding.direction);
    }
  }
}

/** 生状態から、いま押されている抽象入力の集合を求める */
export function resolve(mapping: Mapping, snapshot: GamepadSnapshot): Set<InputButton> {
  const out = new Set<InputButton>();
  for (const button of INPUT_BUTTONS) {
    if (mapping[button].some((b) => isBindingActive(b, snapshot))) out.add(button);
  }
  return out;
}

/**
 * prev → cur で新しく押された生入力を 1 つ返す（設定画面の割り当て用）。
 * 優先順: ボタン → ハット軸 → 通常の軸。
 * ハット軸かどうかは、prev / cur のどちらかが -1〜1 の外（ハットのニュートラル値）か、
 * hatAxes に含まれるかで判断する。
 */
export function detectBinding(
  prev: GamepadSnapshot,
  cur: GamepadSnapshot,
  hatAxes: ReadonlySet<number> = new Set(),
): RawBinding | null {
  for (let i = 0; i < cur.buttons.length; i++) {
    if (cur.buttons[i] && !prev.buttons[i]) return { kind: 'button', index: i };
  }
  for (let i = 0; i < cur.axes.length; i++) {
    const c = cur.axes[i];
    const p = prev.axes[i];
    const isHat =
      hatAxes.has(i) || isHatNeutralValue(c) || (p !== undefined && isHatNeutralValue(p));
    if (!isHat) continue;
    const curDirs = hatToDirections(c);
    // 斜めは曖昧なので、上下左右のどれか 1 方向に入った瞬間だけ拾う
    if (curDirs.length !== 1) continue;
    const prevDirs = p === undefined ? [] : hatToDirections(p);
    if (prevDirs.length === 1 && prevDirs[0] === curDirs[0]) continue;
    return { kind: 'hat', index: i, direction: curDirs[0] };
  }
  for (let i = 0; i < cur.axes.length; i++) {
    const c = cur.axes[i];
    const p = prev.axes[i] ?? 0;
    if (hatAxes.has(i) || isHatNeutralValue(c) || isHatNeutralValue(p)) continue;
    if (!Number.isFinite(c) || Math.abs(c) < AXIS_THRESHOLD) continue;
    const sign: 1 | -1 = c > 0 ? 1 : -1;
    // 前フレームで同じ向きに倒れていたなら新規ではない
    if (p * sign >= AXIS_THRESHOLD) continue;
    return { kind: 'axis', index: i, sign };
  }
  return null;
}

/** いま入っている生入力の一覧（設定画面の表示用） */
export function activeRawInputs(
  snapshot: GamepadSnapshot,
  hatAxes: ReadonlySet<number> = new Set(),
): RawBinding[] {
  const out: RawBinding[] = [];
  snapshot.buttons.forEach((pressed, index) => {
    if (pressed) out.push({ kind: 'button', index });
  });
  snapshot.axes.forEach((v, index) => {
    if (hatAxes.has(index)) {
      for (const direction of hatToDirections(v)) out.push({ kind: 'hat', index, direction });
      return;
    }
    if (isHatNeutralValue(v) || !Number.isFinite(v) || Math.abs(v) < AXIS_THRESHOLD) return;
    out.push({ kind: 'axis', index, sign: v > 0 ? 1 : -1 });
  });
  return out;
}

/** 表示用の文字列。例: `button 1` / `axis 0 -` / `hat 9 up` */
export function formatBinding(b: RawBinding): string {
  switch (b.kind) {
    case 'button':
      return `button ${b.index}`;
    case 'axis':
      return `axis ${b.index} ${b.sign > 0 ? '+' : '-'}`;
    case 'hat':
      return `hat ${b.index} ${b.direction}`;
  }
}

export function sameBinding(a: RawBinding, b: RawBinding): boolean {
  return formatBinding(a) === formatBinding(b);
}

// ---------------------------------------------------------------------------
// シリアライズ / 検証（localStorage 用）
// ---------------------------------------------------------------------------

function isIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 256;
}

export function isRawBinding(v: unknown): v is RawBinding {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!isIndex(o.index)) return false;
  switch (o.kind) {
    case 'button':
      return true;
    case 'axis':
      return o.sign === 1 || o.sign === -1;
    case 'hat':
      return typeof o.direction === 'string' && (HAT_DIRECTIONS as string[]).includes(o.direction);
    default:
      return false;
  }
}

/** 6 つの抽象入力すべてに 1 つ以上の正しい生入力があるものだけを Mapping とみなす */
export function isMapping(v: unknown): v is Mapping {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return INPUT_BUTTONS.every((button) => {
    const list = o[button];
    return Array.isArray(list) && list.length > 0 && list.every(isRawBinding);
  });
}

/** 余計なプロパティを落としたコピー */
function cleanBinding(b: RawBinding): RawBinding {
  switch (b.kind) {
    case 'button':
      return { kind: 'button', index: b.index };
    case 'axis':
      return { kind: 'axis', index: b.index, sign: b.sign };
    case 'hat':
      return { kind: 'hat', index: b.index, direction: b.direction };
  }
}

function cleanMapping(m: Mapping): Mapping {
  const out = {} as Mapping;
  for (const button of INPUT_BUTTONS) out[button] = m[button].map(cleanBinding);
  return out;
}

export function serializeMappings(mappings: Readonly<Record<string, Mapping>>): string {
  const out: Record<string, Mapping> = {};
  for (const [id, m] of Object.entries(mappings)) out[id] = cleanMapping(m);
  return JSON.stringify(out);
}

/** JSON を読み、正しい Mapping だけを残す。JSON 自体が壊れていれば空 */
export function parseMappings(json: string | null | undefined): Record<string, Mapping> {
  if (!json) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, Mapping> = {};
  for (const [id, m] of Object.entries(raw as Record<string, unknown>)) {
    if (isMapping(m)) out[id] = cleanMapping(m);
  }
  return out;
}
