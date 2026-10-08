// プレイヤーのコマ。moved の path を 1 マスずつ放物線で跳ねながら進む。
import * as THREE from 'three';
import type { Assets } from './assets.ts';
import type { BoardView } from './board-view.ts';
import { easeInOutQuad, type SceneView } from './scene.ts';

/** プレイヤー色（HUD と共通） */
export const PLAYER_COLORS = ['#e05a4f', '#3f7fd6', '#3aa860', '#e0a32e'];

const HOP_SECONDS = 0.28;
const HOP_HEIGHT = 0.35;
const SLOT_OFFSET = 0.2;
/** 同じマスに複数いるときの配置（人数ごと） */
const SLOT_LAYOUTS: [number, number][][] = [
  [[0, 0]],
  [
    [-1, 0],
    [1, 0],
  ],
  [
    [-1, -1],
    [1, -1],
    [0, 1],
  ],
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
];

interface Piece {
  object: THREE.Object3D;
  spaceId: string;
  /** 移動アニメーション中は配置の自動補間をしない */
  moving: boolean;
}

export class PieceView {
  readonly group = new THREE.Group();
  private readonly pieces: Piece[] = [];
  private readonly sceneView: SceneView;
  private readonly board: BoardView;
  private readonly offFrame: () => void;

  constructor(sceneView: SceneView, board: BoardView, assets: Assets, spaceIds: string[]) {
    this.sceneView = sceneView;
    this.board = board;
    spaceIds.forEach((spaceId, i) => {
      const object = assets.piece(PLAYER_COLORS[i % PLAYER_COLORS.length]);
      this.group.add(object);
      this.pieces.push({ object, spaceId, moving: false });
    });
    for (const p of this.pieces) p.object.position.copy(this.slotPosition(p));
    // 移動していないコマを所定の位置へなめらかに寄せる
    this.offFrame = sceneView.onFrame((dt) => {
      const k = 1 - Math.exp(-dt * 10);
      for (const p of this.pieces) {
        if (!p.moving) p.object.position.lerp(this.slotPosition(p), k);
      }
    });
  }

  /**
   * 毎フレームの購読を解除し、仮形状のコマ専用の geometry / material を解放する。
   * glb 由来のコマは読み込んだモデルと geometry を共有しているので解放しない
   * （tint で複製した material だけは各コマ専用なので解放する）
   */
  dispose(): void {
    this.offFrame();
    for (const p of this.pieces) {
      const owned = p.object.userData.ownedResources === true;
      p.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (owned || m.userData.tintClone === true) m.dispose();
        if (owned) o.geometry.dispose();
      });
    }
    this.group.clear();
    this.pieces.length = 0;
  }

  /** コマの現在位置（カメラ追従用） */
  positionOf(playerIndex: number): THREE.Vector3 {
    return this.pieces[playerIndex].object.position;
  }

  /** path（from を含まない通過順のマス id）を 1 マスずつ跳ねて進む */
  async move(playerIndex: number, path: string[]): Promise<void> {
    const piece = this.pieces[playerIndex];
    piece.moving = true;
    for (let i = 0; i < path.length; i++) {
      const last = i === path.length - 1;
      const start = piece.object.position.clone();
      const prevSpace = piece.spaceId;
      piece.spaceId = path[i];
      // 途中はマスの中央、最後は混雑に応じた位置へ
      const end = last ? this.slotPosition(piece) : this.board.positionOf(path[i]);
      this.face(piece.object, this.board.positionOf(prevSpace), this.board.positionOf(path[i]));
      await this.sceneView.tween(HOP_SECONDS, (t) => {
        const e = easeInOutQuad(t);
        piece.object.position.lerpVectors(start, end, e);
        piece.object.position.y += 4 * HOP_HEIGHT * t * (1 - t);
      });
    }
    piece.moving = false;
  }

  /** 演出なしで配置する（ゲーム開始時など） */
  place(playerIndex: number, spaceId: string): void {
    const piece = this.pieces[playerIndex];
    piece.spaceId = spaceId;
    piece.object.position.copy(this.slotPosition(piece));
  }

  private face(object: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) return;
    // モデルの前方は -Z
    object.rotation.y = Math.atan2(-dx, -dz);
  }

  private slotPosition(piece: Piece): THREE.Vector3 {
    const center = this.board.positionOf(piece.spaceId);
    const occupants = this.pieces.filter((p) => p.spaceId === piece.spaceId);
    if (occupants.length <= 1) return center;
    const layout = SLOT_LAYOUTS[Math.min(occupants.length, SLOT_LAYOUTS.length) - 1];
    const [ox, oz] = layout[occupants.indexOf(piece) % layout.length];
    return center.add(new THREE.Vector3(ox * SLOT_OFFSET, 0, oz * SLOT_OFFSET));
  }
}
