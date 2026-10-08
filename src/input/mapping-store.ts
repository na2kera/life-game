// gamepad.id ごとのカスタム割り当てを localStorage に保存する。
// localStorage が使えない環境（プライベートモード・テストなど）でも落ちず、メモリ上だけで動く。
import { DEFAULT_MAPPINGS, type DeviceType } from './joycon.ts';
import { parseMappings, serializeMappings, type Mapping } from './mapping.ts';

export const MAPPING_STORAGE_KEY = 'life-game.gamepad-mappings';

/** localStorage の必要部分だけ */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export class MappingStore {
  private readonly storage: StorageLike | null;
  private custom: Record<string, Mapping>;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.custom = this.load();
  }

  /** カスタム割り当てがあればそれを、無ければ機種の既定を返す */
  mappingFor(id: string, type: DeviceType): { mapping: Mapping; custom: boolean } {
    const custom = this.custom[id];
    return custom
      ? { mapping: custom, custom: true }
      : { mapping: DEFAULT_MAPPINGS[type], custom: false };
  }

  hasCustom(id: string): boolean {
    return id in this.custom;
  }

  set(id: string, mapping: Mapping): void {
    this.custom = { ...this.custom, [id]: mapping };
    this.save();
  }

  /** 全パッドのカスタム割り当てを消して既定に戻す */
  clearAll(): void {
    this.custom = {};
    try {
      this.storage?.removeItem(MAPPING_STORAGE_KEY);
    } catch (e) {
      console.warn('[input] 割り当ての削除に失敗しました', e);
    }
  }

  private load(): Record<string, Mapping> {
    try {
      return parseMappings(this.storage?.getItem(MAPPING_STORAGE_KEY));
    } catch (e) {
      console.warn('[input] 割り当ての読み込みに失敗しました', e);
      return {};
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(MAPPING_STORAGE_KEY, serializeMappings(this.custom));
    } catch (e) {
      console.warn('[input] 割り当ての保存に失敗しました', e);
    }
  }
}
