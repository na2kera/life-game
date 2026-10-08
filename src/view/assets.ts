// 3D モデルの読み込み。public/models/<name>.glb があれば使い、無ければコードで作った仮形状を返す。
// 書き出し規約は public/models/README.md を参照。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelName = 'piece' | 'tile' | 'roulette';

const MODEL_NAMES: ModelName[] = ['piece', 'tile', 'roulette'];

/** マテリアル名にこの文字列を含むものは、プレイヤー色・マス種別色で上書きする */
const TINT_MARKER = 'tint';

export class Assets {
  private readonly models: Partial<Record<ModelName, THREE.Object3D>>;

  private constructor(models: Partial<Record<ModelName, THREE.Object3D>>) {
    this.models = models;
  }

  /** 全モデルの読み込みを試みる。失敗したものは仮形状にフォールバックする */
  static async load(): Promise<Assets> {
    const loader = new GLTFLoader();
    const entries = await Promise.all(
      MODEL_NAMES.map(async (name) => [name, await tryLoad(loader, name)] as const),
    );
    const models: Partial<Record<ModelName, THREE.Object3D>> = {};
    for (const [name, model] of entries) if (model) models[name] = model;
    return new Assets(models);
  }

  /** 読み込めたモデル名（デバッグ表示用） */
  get loaded(): ModelName[] {
    return MODEL_NAMES.filter((n) => this.models[n]);
  }

  /** コマ。原点は底面中央、前方は -Z（Blender の +Y） */
  piece(color: THREE.ColorRepresentation): THREE.Object3D {
    const model = this.models.piece;
    return model ? cloneTinted(model, color) : fallbackPiece(color);
  }

  /** マス 1 個（1m 四方以内）。原点は底面中央 */
  tile(color: THREE.ColorRepresentation): THREE.Object3D {
    const model = this.models.tile;
    return model ? cloneTinted(model, color) : fallbackTile(color);
  }

  /**
   * ルーレットの回転する円盤。XZ 平面に寝かせた状態で、出目 1 の扇形の中心が -Z（前方）、
   * 上から見て時計回りに 2, 3, ... 10 と並ぶ。原点は底面中央、半径 0.5m。
   * glb が無ければ null（roulette-view が数字入りの仮形状を作る）
   */
  roulette(): THREE.Object3D | null {
    const model = this.models.roulette;
    return model ? model.clone(true) : null;
  }
}

async function tryLoad(loader: GLTFLoader, name: ModelName): Promise<THREE.Object3D | null> {
  const url = `${import.meta.env.BASE_URL}models/${name}.glb`;
  try {
    // 未配置時に dev サーバーが index.html を返すことがあるので、先に中身の種類を確かめる
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || type.includes('text/html')) return null;
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    console.info(`[assets] loaded ${url}`);
    return root;
  } catch (e) {
    console.warn(`[assets] ${url} を読み込めなかったため仮形状を使います`, e);
    return null;
  }
}

function cloneTinted(model: THREE.Object3D, color: THREE.ColorRepresentation): THREE.Object3D {
  const root = model.clone(true);
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const tinted = mats.map((m: THREE.Material) => {
      if (!m.name.toLowerCase().includes(TINT_MARKER) || !('color' in m)) return m;
      const copy = m.clone() as THREE.Material & { color: THREE.Color };
      copy.color.set(color);
      // 複製したマテリアルは利用側で解放してよい印
      copy.userData.tintClone = true;
      return copy;
    });
    o.material = Array.isArray(o.material) ? tinted : tinted[0];
  });
  return root;
}

// ---------------------------------------------------------------------------
// 仮形状
// ---------------------------------------------------------------------------

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 車っぽい箱＋円柱のタイヤ。前方 -Z */
function fallbackPiece(color: THREE.ColorRepresentation): THREE.Object3D {
  const group = new THREE.Group();
  // geometry / material はこのコマ専用（dispose してよい）
  group.userData.ownedResources = true;
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const cabin = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });

  const wheelR = 0.05;
  group.add(mesh(new THREE.BoxGeometry(0.24, 0.1, 0.4), body, 0, wheelR + 0.05, 0));
  group.add(mesh(new THREE.BoxGeometry(0.2, 0.09, 0.2), cabin, 0, wheelR + 0.145, 0.04));
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.04, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const x of [-0.13, 0.13]) {
    for (const z of [-0.13, 0.13]) group.add(mesh(wheelGeo, tire, x, wheelR, z));
  }
  return group;
}

function fallbackTile(color: THREE.ColorRepresentation): THREE.Object3D {
  const height = 0.12;
  return mesh(
    new THREE.BoxGeometry(0.86, height, 0.86),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    0,
    height / 2,
    0,
  );
}
