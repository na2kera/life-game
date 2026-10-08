import { describe, expect, it } from 'vitest';
import type { PadInfo, RawDetection } from '../input/gamepad.ts';
import type { RawBinding } from '../input/mapping.ts';
import { Assignment, isAbortInput, samePad } from './assignment.ts';

const pad = (index: number, id: string): PadInfo => ({
  index,
  id,
  type: 'joyconR',
  label: 'Joy-Con (R)',
  kind: 'joycon',
  custom: false,
});

const btn = (index: number): RawBinding => ({ kind: 'button', index });
const det = (padIndex: number, binding: RawBinding): RawDetection => ({ padIndex, binding, at: 0 });

const R = pad(0, 'Joy-Con (R)');
const L = pad(1, 'Joy-Con (L)');

describe('Assignment', () => {
  it('最初に入力があったパッドを対象にし、決定→キャンセル→上→下→左→右 の順に記録して完了する', () => {
    const a = new Assignment();
    expect(a.next).toBe('confirm');
    expect(a.input(det(0, btn(1)), [R, L])).toEqual({ type: 'recorded', next: 'cancel' });
    expect(a.pad).toEqual(R);
    // 別のパッドの入力は無視
    expect(a.input(det(1, btn(5)), [R, L])).toEqual({ type: 'ignored' });
    expect(a.input(det(0, btn(0)), [R, L])).toEqual({ type: 'recorded', next: 'up' });
    a.input(det(0, { kind: 'hat', index: 9, direction: 'left' }), [R, L]);
    a.input(det(0, { kind: 'hat', index: 9, direction: 'right' }), [R, L]);
    a.input(det(0, { kind: 'axis', index: 1, sign: 1 }), [R, L]);
    const result = a.input(det(0, { kind: 'axis', index: 1, sign: -1 }), [R, L]);
    expect(result).toEqual({
      type: 'done',
      pad: R,
      mapping: {
        confirm: [btn(1)],
        cancel: [btn(0)],
        up: [{ kind: 'hat', index: 9, direction: 'left' }],
        down: [{ kind: 'hat', index: 9, direction: 'right' }],
        left: [{ kind: 'axis', index: 1, sign: 1 }],
        right: [{ kind: 'axis', index: 1, sign: -1 }],
      },
    });
    expect(a.next).toBeNull();
    // 完了後の入力は無視
    expect(a.input(det(0, btn(7)), [R, L])).toEqual({ type: 'ignored' });
  });

  it('割り当て済みの入力は重複として拒否し、記録しない', () => {
    const a = new Assignment();
    a.input(det(0, btn(1)), [R]);
    expect(a.input(det(0, btn(1)), [R])).toEqual({ type: 'duplicate', binding: btn(1) });
    expect(a.bindings).toEqual([btn(1)]);
    expect(a.next).toBe('cancel');
  });

  it('一覧に無いパッドからの入力は無視する', () => {
    const a = new Assignment();
    expect(a.input(det(3, btn(1)), [R])).toEqual({ type: 'ignored' });
    expect(a.pad).toBeNull();
  });

  it('同じ index に別 id のパッドが入ったら、その入力は無視して対象を見失ったと判定する', () => {
    const a = new Assignment();
    a.input(det(0, btn(1)), [R]);
    const swapped = pad(0, 'Other Pad');
    expect(a.input(det(0, btn(0)), [swapped])).toEqual({ type: 'ignored' });
    expect(a.bindings).toEqual([btn(1)]);
    expect(a.isPadLost([swapped])).toBe(true);
  });

  it('対象パッドの切断を判定する（対象未定なら見失わない）', () => {
    const a = new Assignment();
    expect(a.isPadLost([])).toBe(false);
    a.input(det(0, btn(1)), [R, L]);
    expect(a.isPadLost([R, L])).toBe(false);
    expect(a.isPadLost([L])).toBe(true);
    expect(a.isPadLost([])).toBe(true);
  });
});

describe('isAbortInput / samePad', () => {
  it('中断はキーボードの Esc（cancel）だけ', () => {
    expect(isAbortInput('cancel', 'keyboard')).toBe(true);
    expect(isAbortInput('cancel', 'joycon')).toBe(false);
    expect(isAbortInput('cancel', 'gamepad')).toBe(false);
    expect(isAbortInput('cancel')).toBe(false);
    expect(isAbortInput('confirm', 'keyboard')).toBe(false);
  });

  it('index と id の両方が一致したときだけ同じパッド', () => {
    expect(samePad(R, pad(0, 'Joy-Con (R)'))).toBe(true);
    expect(samePad(R, pad(1, 'Joy-Con (R)'))).toBe(false);
    expect(samePad(R, pad(0, 'Joy-Con (L)'))).toBe(false);
  });
});
