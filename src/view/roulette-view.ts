// ルーレット演出。出目は core で先に決まっており、その数字で止まるように回す。
// カメラの子として画面の左寄りに表示する。
import * as THREE from 'three';
import type { Assets } from './assets.ts';
import { easeOutCubic, type SceneView } from './scene.ts';

const DISTANCE = 4;
const SPIN_SECONDS = 2.6;
const EXTRA_TURNS = 5;
const SECTOR_COLORS = [
  '#e07a6f',
  '#e9a95f',
  '#e6cf6a',
  '#9fcf7a',
  '#6fbf9f',
  '#6fb3d9',
  '#7f95d9',
  '#a587d1',
  '#d487b8',
  '#c9b49a',
];

export class RouletteView {
  private readonly root = new THREE.Group();
  /** 回転する円盤（Y 軸回り） */
  private readonly wheel: THREE.Object3D;
  private readonly sceneView: SceneView;
  private readonly min: number;
  private readonly count: number;
  private angle = 0;

  constructor(sceneView: SceneView, assets: Assets, range: { min: number; max: number }) {
    this.sceneView = sceneView;
    this.min = range.min;
    this.count = range.max - range.min + 1;

    // 円盤は XZ 平面に寝かせた向きで作り、カメラに向けて起こす
    const tilt = new THREE.Group();
    tilt.rotation.x = Math.PI / 2;
    this.wheel = assets.roulette() ?? createFallbackWheel(this.min, this.count);
    tilt.add(this.wheel);
    this.root.add(tilt);
    const frame = createFrame();
    this.root.add(frame);
    // 盤面より手前に常に描く（カメラ空間に置いているため盤面とめり込むことがある）
    drawOnTop(this.wheel, 10);
    drawOnTop(frame, 11);
    this.root.visible = false;
    sceneView.camera.add(this.root);

    sceneView.onFrame(() => this.layout());
  }

  show(): void {
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  /** value で止まるまで回す */
  async spin(value: number): Promise<void> {
    this.show();
    const step = (Math.PI * 2) / this.count;
    const k = value - this.min;
    // 扇形の中で少しずらして止める（ちょうど中央だと機械的に見えるため）
    const jitter = (Math.random() - 0.5) * step * 0.6;
    const target = k * step + jitter;
    const from = this.angle;
    const delta = EXTRA_TURNS * Math.PI * 2 + mod(from - target, Math.PI * 2);
    await this.sceneView.tween(SPIN_SECONDS, (t) => {
      // 角度を減らす向き = 画面上で時計回り
      this.angle = from - delta * easeOutCubic(t);
      this.wheel.rotation.y = this.angle;
    });
    this.angle = mod(this.angle, Math.PI * 2);
    this.wheel.rotation.y = this.angle;
  }

  /** 画面サイズに応じて左寄りの位置に置く */
  private layout(): void {
    if (!this.root.visible) return;
    const camera = this.sceneView.camera;
    const halfH = DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfW = halfH * camera.aspect;
    this.root.position.set(-Math.min(halfW * 0.62, halfW - 0.7), halfH * 0.2, -DISTANCE);
  }
}

function drawOnTop(object: THREE.Object3D, renderOrder: number): void {
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.renderOrder = renderOrder;
    const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) m.depthTest = false;
  });
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** 数字入りの仮の円盤。出目 min の扇形の中心が -Z、上から見て時計回りに並ぶ */
function createFallbackWheel(min: number, count: number): THREE.Object3D {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const c = size / 2;
  const r = size / 2 - 4;
  const step = (Math.PI * 2) / count;
  // キャンバスの上 = -Z（前方）、右 = +X。角度は上から時計回り
  for (let k = 0; k < count; k++) {
    const a0 = k * step - step / 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a0 + step);
    ctx.closePath();
    ctx.fillStyle = SECTOR_COLORS[k % SECTOR_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(k * step);
    ctx.fillStyle = '#2b2b2b';
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(min + k), 0, -r * 0.72);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(c, c, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#f4f4f4';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.CircleGeometry(0.5, 64);
  geometry.rotateX(-Math.PI / 2);
  const disc = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
  disc.position.y = 0.02;
  const group = new THREE.Group();
  group.add(disc);
  return group;
}

/** 固定の枠と針（回転しない）。カメラ空間で XY 平面 */
function createFrame(): THREE.Object3D {
  const group = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.56, 64),
    new THREE.MeshBasicMaterial({ color: 0x3a3f4a }),
  );
  rim.position.z = 0.03;
  group.add(rim);

  const pointerShape = new THREE.Shape();
  pointerShape.moveTo(0, 0.42);
  pointerShape.lineTo(-0.07, 0.6);
  pointerShape.lineTo(0.07, 0.6);
  pointerShape.closePath();
  const pointer = new THREE.Mesh(
    new THREE.ShapeGeometry(pointerShape),
    new THREE.MeshBasicMaterial({ color: 0xd94b3d }),
  );
  pointer.position.z = 0.05;
  group.add(pointer);
  return group;
}
