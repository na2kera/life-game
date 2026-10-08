import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPPINGS, detectDeviceType, deviceKindOf, deviceLabel } from './joycon.ts';
import { resolve, type GamepadSnapshot } from './mapping.ts';

const HAT_NEUTRAL = 9 / 7;

const stick = (x: number, y: number, hat = HAT_NEUTRAL): GamepadSnapshot => {
  const axes = Array.from({ length: 10 }, () => 0);
  axes[0] = x;
  axes[1] = y;
  axes[9] = hat;
  return { buttons: Array.from({ length: 16 }, () => false), axes };
};

const press = (index: number): GamepadSnapshot => {
  const s = stick(0, 0);
  s.buttons[index] = true;
  return s;
};

const pressed = (type: keyof typeof DEFAULT_MAPPINGS, s: GamepadSnapshot): string[] =>
  [...resolve(DEFAULT_MAPPINGS[type], s)].sort();

describe('detectDeviceType', () => {
  it('id の機種名で判定する', () => {
    expect(detectDeviceType('Joy-Con (L) (Vendor: 057e Product: 2006)', '')).toBe('joyconL');
    expect(detectDeviceType('Joy-Con (R)', '')).toBe('joyconR');
    expect(detectDeviceType('Pro Controller (STANDARD GAMEPAD)', 'standard')).toBe('procon');
  });

  it('Vendor / Product で判定する（Chrome 形式・Firefox 形式）', () => {
    expect(detectDeviceType('Wireless Gamepad (Vendor: 057e Product: 2006)', '')).toBe('joyconL');
    expect(detectDeviceType('Wireless Gamepad (Vendor: 057E Product: 2007)', '')).toBe('joyconR');
    expect(
      detectDeviceType('Unknown (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'standard'),
    ).toBe('procon');
    expect(detectDeviceType('57e-2007-Wireless Gamepad', '')).toBe('joyconR');
    expect(detectDeviceType('057e-2006-Wireless Gamepad', '')).toBe('joyconL');
  });

  it('任天堂以外のベンダーは Product が同じでも Joy-Con にしない', () => {
    expect(detectDeviceType('Pad (Vendor: 1234 Product: 2007)', '')).toBe('unknown');
  });

  it('それ以外は mapping で standard / unknown', () => {
    expect(
      detectDeviceType('Xbox Wireless Controller (Vendor: 045e Product: 0b13)', 'standard'),
    ).toBe('standard');
    expect(detectDeviceType('Some Pad', '')).toBe('unknown');
  });
});

describe('deviceLabel / deviceKindOf', () => {
  it('表示名と案内用の種別', () => {
    expect(deviceLabel('joyconR')).toBe('Joy-Con (R)');
    expect(deviceLabel('joyconL')).toBe('Joy-Con (L)');
    expect(deviceKindOf('joyconL')).toBe('joycon');
    expect(deviceKindOf('joyconR')).toBe('joycon');
    expect(deviceKindOf('procon')).toBe('gamepad');
    expect(deviceKindOf('standard')).toBe('gamepad');
  });
});

describe('既定マッピング', () => {
  it('Joy-Con (R): 物理 X（1）= 決定、物理 A（0）= キャンセル', () => {
    expect(pressed('joyconR', press(1))).toEqual(['confirm']);
    expect(pressed('joyconR', press(0))).toEqual(['cancel']);
  });

  it('Joy-Con (R): スティックは時計回りに 90 度（2 軸）', () => {
    expect(pressed('joyconR', stick(-1, 0))).toEqual(['up']);
    expect(pressed('joyconR', stick(1, 0))).toEqual(['down']);
    expect(pressed('joyconR', stick(0, 1))).toEqual(['left']);
    expect(pressed('joyconR', stick(0, -1))).toEqual(['right']);
  });

  it('Joy-Con (R): ハット軸でも同じ回転', () => {
    expect(pressed('joyconR', stick(0, 0, 5 / 7))).toEqual(['up']); // 縦持ちの左
    expect(pressed('joyconR', stick(0, 0, -3 / 7))).toEqual(['down']); // 縦持ちの右
    expect(pressed('joyconR', stick(0, 0, 1 / 7))).toEqual(['left']); // 縦持ちの下
    expect(pressed('joyconR', stick(0, 0, -1))).toEqual(['right']); // 縦持ちの上
  });

  it('Joy-Con (L): 物理 ↓（1）= 決定、物理 ←（0）= キャンセル', () => {
    expect(pressed('joyconL', press(1))).toEqual(['confirm']);
    expect(pressed('joyconL', press(0))).toEqual(['cancel']);
  });

  it('Joy-Con (L): スティックは反時計回りに 90 度（2 軸・ハット）', () => {
    expect(pressed('joyconL', stick(1, 0))).toEqual(['up']);
    expect(pressed('joyconL', stick(-1, 0))).toEqual(['down']);
    expect(pressed('joyconL', stick(0, -1))).toEqual(['left']);
    expect(pressed('joyconL', stick(0, 1))).toEqual(['right']);
    expect(pressed('joyconL', stick(0, 0, -3 / 7))).toEqual(['up']); // 縦持ちの右
    expect(pressed('joyconL', stick(0, 0, -1))).toEqual(['left']); // 縦持ちの上
  });

  it('Pro / standard: 0 = 決定、1 = キャンセル、十字 12〜15、左スティック', () => {
    for (const type of ['procon', 'standard', 'unknown'] as const) {
      expect(pressed(type, press(0))).toEqual(['confirm']);
      expect(pressed(type, press(1))).toEqual(['cancel']);
      expect(pressed(type, press(12))).toEqual(['up']);
      expect(pressed(type, press(13))).toEqual(['down']);
      expect(pressed(type, press(14))).toEqual(['left']);
      expect(pressed(type, press(15))).toEqual(['right']);
      expect(pressed(type, stick(0, -1))).toEqual(['up']);
      expect(pressed(type, stick(1, 0))).toEqual(['right']);
    }
  });
});
