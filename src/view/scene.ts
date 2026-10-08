// レンダラー・ライト・描画ループ。アニメーションは tween() で毎フレーム進める。
import * as THREE from 'three';

export type FrameCallback = (dt: number, elapsed: number) => void;

const SKY_COLOR = 0x9fc9e8;
const GROUND_COLOR = 0xcfe3c0;

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly callbacks = new Set<FrameCallback>();
  private lastTime = 0;
  private elapsed = 0;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(0, 8, 8);
    this.camera.lookAt(0, 0, 0);
    // カメラの子（ルーレットなど）を描画するためシーンに入れる
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9a7a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 12, 4);
    sun.target.position.set(4.5, 0, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -12;
    cam.right = 12;
    cam.top = 12;
    cam.bottom = -12;
    cam.near = 1;
    cam.far = 40;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun, sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: GROUND_COLOR, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(cb: FrameCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  start(): void {
    const loop = (now: number): void => {
      // 例外が出ても次フレームは必ず予約する（ループが止まると入力待ちに戻れなくなる）
      requestAnimationFrame(loop);
      // タブ非表示などで間が空いたときにアニメーションが飛ばないよう dt を制限する。
      // タイムスタンプが逆行した場合は 0 に丸める
      const raw = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000;
      const dt = Math.min(Math.max(raw, 0), 0.1);
      this.lastTime = now;
      this.elapsed += dt;
      for (const cb of [...this.callbacks]) {
        try {
          cb(dt, this.elapsed);
        } catch (e) {
          console.error('[scene] frame callback failed', e);
        }
      }
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (e) {
        console.error('[scene] render failed', e);
      }
    };
    requestAnimationFrame(loop);
  }

  /** durationSec かけて step(t: 0→1) を呼ぶ。終了で resolve、step が例外を出したら reject */
  tween(durationSec: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      let time = 0;
      if (durationSec <= 0) {
        try {
          step(1);
          resolve();
        } catch (e) {
          reject(e);
        }
        return;
      }
      const off = this.onFrame((dt) => {
        time += dt;
        const t = Math.min(time / durationSec, 1);
        try {
          step(t);
        } catch (e) {
          off();
          reject(e);
          return;
        }
        if (t >= 1) {
          off();
          resolve();
        }
      });
    });
  }

  wait(durationSec: number): Promise<void> {
    return this.tween(durationSec, () => {});
  }
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInOutQuad = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
