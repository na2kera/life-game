import { describe, expect, it } from 'vitest';
import {
  GamepadSource,
  REPEAT_DELAY_MS,
  REPEAT_INTERVAL_MS,
  type GamepadEnv,
  type GamepadLike,
  type PadInfo,
  type RawDetection,
} from './gamepad.ts';
import { InputHub, type DeviceKind, type InputButton } from './input.ts';
import { MAPPING_STORAGE_KEY, MappingStore, type StorageLike } from './mapping-store.ts';
import { DEFAULT_MAPPINGS } from './joycon.ts';
import type { Mapping } from './mapping.ts';

const HAT_NEUTRAL = 9 / 7;

/** テスト用の書き換え可能なパッド */
class FakePad implements GamepadLike {
  connected = true;
  buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  axes: number[];
  readonly index: number;
  readonly id: string;
  readonly mapping: string;

  constructor(index: number, id: string, mapping = '', axes = [0, 0]) {
    this.index = index;
    this.id = id;
    this.mapping = mapping;
    this.axes = axes;
  }

  set(button: number, pressed: boolean): this {
    this.buttons[button] = { pressed };
    return this;
  }
}

class FakeEnv implements GamepadEnv {
  pads: (GamepadLike | null)[] = [];
  time = 0;
  readonly handlers = new Map<string, Set<() => void>>();
  getGamepads(): readonly (GamepadLike | null)[] {
    return this.pads;
  }
  now(): number {
    return this.time;
  }
  addEventListener(type: string, l: () => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)?.add(l);
  }
  removeEventListener(type: string, l: () => void): void {
    this.handlers.get(type)?.delete(l);
  }
}

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

function setup(storage: StorageLike | null = null) {
  const env = new FakeEnv();
  const store = new MappingStore(storage);
  const source = new GamepadSource({ env, store });
  const events: [InputButton, DeviceKind | undefined][] = [];
  source.subscribe((b, d) => events.push([b, d]));
  const tick = (ms = 16): void => {
    env.time += ms;
    source.update();
  };
  return { env, store, source, events, tick };
}

const PRO_ID = 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)';
const JOYCON_R_ID = 'Joy-Con (R) (Vendor: 057e Product: 2007)';

describe('GamepadSource', () => {
  it('立ち上がりエッジだけを配信し、デバイス種別を添える', () => {
    const { env, events, tick } = setup();
    const pad = new FakePad(0, PRO_ID, 'standard');
    env.pads = [pad];
    tick();
    pad.set(0, true);
    tick();
    tick();
    pad.set(0, false);
    tick();
    pad.set(0, true);
    tick();
    expect(events).toEqual([
      ['confirm', 'gamepad'],
      ['confirm', 'gamepad'],
    ]);
  });

  it('初めて見えたフレームで押されていた入力は配信しない（認識させるための押下）', () => {
    const { env, events, tick } = setup();
    env.pads = [new FakePad(0, PRO_ID, 'standard').set(0, true)];
    tick();
    tick();
    expect(events).toEqual([]);
  });

  it('Joy-Con は joycon 種別で、横持ち補正された方向になる', () => {
    const { env, events, tick } = setup();
    const pad = new FakePad(0, JOYCON_R_ID, '', [0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_NEUTRAL]);
    env.pads = [pad];
    tick();
    pad.set(1, true);
    tick();
    pad.axes = [-1, 0, 0, 0, 0, 0, 0, 0, 0, HAT_NEUTRAL];
    tick();
    pad.axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 5 / 7];
    tick(); // ハットで上 → 2 軸の上は離したが、上が続いているので新規ではない
    expect(events).toEqual([
      ['confirm', 'joycon'],
      ['up', 'joycon'],
    ]);
  });

  it('方向は初回 400ms、以降 150ms ごとにリピートする。決定はリピートしない', () => {
    const { env, events, tick } = setup();
    const pad = new FakePad(0, PRO_ID, 'standard');
    env.pads = [pad];
    tick();
    pad.set(13, true).set(0, true);
    tick(); // t=32: down, confirm
    tick(REPEAT_DELAY_MS - 1); // まだ
    expect(events.map((e) => e[0])).toEqual(['confirm', 'down']);
    tick(1); // 400ms 経過
    expect(events.map((e) => e[0])).toEqual(['confirm', 'down', 'down']);
    tick(REPEAT_INTERVAL_MS - 10);
    expect(events.length).toBe(3);
    tick(10);
    expect(events.map((e) => e[0])).toEqual(['confirm', 'down', 'down', 'down']);
    // 離すとリピートは止まり、押し直すと初回遅延からやり直し
    pad.set(13, false);
    tick(1000);
    pad.set(13, true);
    tick();
    tick(REPEAT_INTERVAL_MS);
    expect(events.filter((e) => e[0] === 'down').length).toBe(4); // 押し直しの 1 回だけ
  });

  it('切断・接続を通知し、切断したパッドの状態を捨てる', () => {
    const { env, source, events, tick } = setup();
    const notified: PadInfo[][] = [];
    source.onDeviceChange((pads) => notified.push(pads));
    const pad = new FakePad(0, JOYCON_R_ID);
    env.pads = [pad];
    tick();
    expect(notified.at(-1)?.map((p) => [p.index, p.label, p.type, p.custom])).toEqual([
      [0, 'Joy-Con (R)', 'joyconR', false],
    ]);
    pad.set(1, true);
    tick();
    env.pads = [null];
    tick();
    expect(notified.at(-1)).toEqual([]);
    expect(source.devices()).toEqual([]);
    expect(source.rawSnapshot(0)).toBeNull();
    // 再接続時に押しっぱなしでも新規入力にしない
    env.pads = [pad];
    tick();
    expect(events).toEqual([['confirm', 'joycon']]);
    expect(notified.length).toBe(3);
  });

  it('connected が false のパッドは無視する', () => {
    const { env, source, tick } = setup();
    const pad = new FakePad(0, PRO_ID, 'standard');
    pad.connected = false;
    env.pads = [pad];
    tick();
    expect(source.devices()).toEqual([]);
  });

  it('gamepadconnected / gamepaddisconnected で即座に一覧を更新する', () => {
    const { env, source } = setup();
    env.pads = [new FakePad(0, PRO_ID, 'standard')];
    for (const h of env.handlers.get('gamepadconnected') ?? []) h();
    expect(source.devices().length).toBe(1);
    env.pads = [];
    for (const h of env.handlers.get('gamepaddisconnected') ?? []) h();
    expect(source.devices().length).toBe(0);
    source.dispose();
    expect(env.handlers.get('gamepadconnected')?.size).toBe(0);
  });

  it('getGamepads が例外を出しても落ちない', () => {
    const env = new FakeEnv();
    env.getGamepads = () => {
      throw new Error('blocked');
    };
    const source = new GamepadSource({ env, store: new MappingStore(null) });
    expect(() => source.update()).not.toThrow();
  });

  it('生入力を検出し、capture 中は抽象入力を配信しない', () => {
    const { env, source, events, tick } = setup();
    const raws: RawDetection[] = [];
    source.onRawInput((d) => raws.push(d));
    const pad = new FakePad(0, PRO_ID, 'standard', [0, 0]);
    env.pads = [pad];
    tick();
    source.setCapture(true);
    pad.set(5, true);
    tick();
    pad.axes = [0, -0.9];
    tick();
    expect(raws.map((r) => r.binding)).toEqual([
      { kind: 'button', index: 5 },
      { kind: 'axis', index: 1, sign: -1 },
    ]);
    expect(source.lastDetected()?.binding).toEqual({ kind: 'axis', index: 1, sign: -1 });
    expect(source.activeInputs(0)).toEqual([
      { kind: 'button', index: 5 },
      { kind: 'axis', index: 1, sign: -1 },
    ]);
    expect(events).toEqual([]);
    // capture を解除しても押しっぱなしの入力は新規にならない
    source.setCapture(false);
    tick();
    expect(events).toEqual([]);
  });

  it('capture 中の最後の生入力でリスナーが capture を解除しても、その入力は抽象入力に漏れない', () => {
    const { env, store, source, events, tick } = setup();
    const pad = new FakePad(0, PRO_ID, 'standard', [0, 0]);
    env.pads = [pad];
    tick();
    const custom: Mapping = {
      confirm: [{ kind: 'button', index: 7 }],
      cancel: [{ kind: 'button', index: 6 }],
      up: [{ kind: 'button', index: 2 }],
      down: [{ kind: 'button', index: 3 }],
      left: [{ kind: 'button', index: 4 }],
      right: [{ kind: 'axis', index: 0, sign: 1 }],
    };
    // 設定画面と同じく、最後の生入力を受けたリスナーの中で保存・解除・再読込する
    const off = source.onRawInput((d) => {
      if (d.binding.kind === 'axis' && d.binding.index === 0) {
        off();
        store.set(PRO_ID, custom);
        source.setCapture(false);
        source.refreshMappings();
      }
    });
    source.setCapture(true);
    pad.axes = [1, 0];
    tick();
    expect(events).toEqual([]);
    // 押しっぱなしのまま: 立ち上がりにもリピートにもならない
    tick();
    tick(REPEAT_DELAY_MS + 10);
    tick(REPEAT_INTERVAL_MS + 10);
    expect(events).toEqual([]);
    // 離して押し直せば新しい割り当てで入る
    pad.axes = [0, 0];
    tick();
    pad.axes = [1, 0];
    tick();
    expect(events).toEqual([['right', 'gamepad']]);
  });

  it('refreshMappings の直後、新しい割り当てで押されている入力は新規にしない', () => {
    const { env, store, source, events, tick } = setup();
    const pad = new FakePad(0, PRO_ID, 'standard');
    env.pads = [pad];
    tick();
    pad.set(9, true);
    tick();
    store.set(PRO_ID, { ...DEFAULT_MAPPINGS.standard, confirm: [{ kind: 'button', index: 9 }] });
    source.refreshMappings();
    tick();
    tick();
    expect(events).toEqual([]);
  });

  it('カスタム割り当てを使い、refreshMappings で反映する', () => {
    const storage = new MemoryStorage();
    const { env, store, source, events, tick } = setup(storage);
    const pad = new FakePad(0, PRO_ID, 'standard');
    env.pads = [pad];
    tick();
    const custom: Mapping = {
      confirm: [{ kind: 'button', index: 7 }],
      cancel: [{ kind: 'button', index: 6 }],
      up: [{ kind: 'button', index: 2 }],
      down: [{ kind: 'button', index: 3 }],
      left: [{ kind: 'button', index: 4 }],
      right: [{ kind: 'button', index: 5 }],
    };
    store.set(PRO_ID, custom);
    source.refreshMappings();
    expect(source.devices()[0].custom).toBe(true);
    expect(storage.getItem(MAPPING_STORAGE_KEY)).toContain('"index":7');
    pad.set(0, true);
    tick();
    pad.set(7, true);
    tick();
    expect(events).toEqual([['confirm', 'gamepad']]);

    // 別インスタンスでも localStorage から読める
    expect(new MappingStore(storage).hasCustom(PRO_ID)).toBe(true);

    store.clearAll();
    source.refreshMappings();
    expect(source.devices()[0].custom).toBe(false);
    expect(storage.getItem(MAPPING_STORAGE_KEY)).toBeNull();
  });
});

describe('MappingStore', () => {
  it('壊れたデータや例外を出すストレージでも落ちない', () => {
    const broken = new MemoryStorage();
    broken.setItem(MAPPING_STORAGE_KEY, '{oops');
    expect(new MappingStore(broken).hasCustom('x')).toBe(false);

    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = new MappingStore(throwing);
    const m = store.mappingFor('x', 'joyconR');
    expect(m.custom).toBe(false);
    expect(() => store.set('x', m.mapping)).not.toThrow();
    expect(store.mappingFor('x', 'joyconR').custom).toBe(true);
    expect(() => store.clearAll()).not.toThrow();
  });
});

describe('InputHub', () => {
  it('最後に入力があったデバイスが変わったときだけ通知する', () => {
    const hub = new InputHub();
    let emit: (b: InputButton, d?: DeviceKind) => void = () => {};
    hub.addSource({
      subscribe: (l) => {
        emit = l;
        return () => {};
      },
    });
    const changes: DeviceKind[] = [];
    const inputs: [InputButton, DeviceKind | undefined][] = [];
    hub.onDeviceChange((d) => changes.push(d));
    hub.subscribe((b, d) => inputs.push([b, d]));
    expect(hub.activeDevice).toBe('keyboard');
    emit('confirm', 'keyboard');
    emit('up', 'joycon');
    emit('down', 'joycon');
    emit('left');
    emit('cancel', 'keyboard');
    expect(changes).toEqual(['joycon', 'keyboard']);
    // 入力なしでの切り替え（パッド接続時）。同じ値なら通知しない
    hub.setActiveDevice('keyboard');
    hub.setActiveDevice('gamepad');
    hub.setActiveDevice('gamepad');
    expect(changes).toEqual(['joycon', 'keyboard', 'gamepad']);
    expect(hub.activeDevice).toBe('gamepad');
    expect(inputs).toEqual([
      ['confirm', 'keyboard'],
      ['up', 'joycon'],
      ['down', 'joycon'],
      ['left', undefined],
      ['cancel', 'keyboard'],
    ]);
  });
});
