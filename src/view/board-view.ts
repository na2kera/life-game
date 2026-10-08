// 盤面。Board.spaces[].position（1m 間隔）からマス・道・ラベルを生成する。
import * as THREE from 'three';
import type { Board, Space, SpaceKind } from '../core/types.ts';
import type { Assets } from './assets.ts';

/** マスの種別 → 色。色の調整はここだけで行う */
export const SPACE_COLORS: Record<SpaceKind, number> = {
  start: 0xffffff,
  goal: 0xf2c14e,
  blank: 0xd9d4c7,
  branch: 0xb0a8c9,
  salary: 0x7fc97f,
  job: 0x5b9bd5,
  jobChange: 0x8fb8e0,
  marriage: 0xf28fad,
  child: 0xf7c3d0,
  house: 0xc98b5b,
  event: 0xe8a25c,
  card: 0x9b7fd1,
  insurance: 0x6cc4c4,
  stock: 0x4e8f6e,
  stockChange: 0x8fbf9f,
};

/** タイル上面の高さ（コマを置く高さ） */
export const TILE_TOP = 0.12;

const ROAD_COLOR = 0x8c8577;
const ROAD_WIDTH = 0.16;
const LABEL_HEIGHT = 0.62;

export class BoardView {
  readonly group = new THREE.Group();
  private readonly spaces = new Map<string, Space>();

  constructor(board: Board, assets: Assets) {
    for (const space of board.spaces) this.spaces.set(space.id, space);

    const roadMat = new THREE.MeshStandardMaterial({ color: ROAD_COLOR, roughness: 1 });
    for (const space of board.spaces) {
      const tile = assets.tile(SPACE_COLORS[space.kind]);
      tile.position.set(space.position.x, 0, space.position.z);
      this.group.add(tile);

      const label = createLabel(space.label);
      label.position.set(space.position.x, LABEL_HEIGHT, space.position.z);
      this.group.add(label);

      for (const nextId of space.next) {
        const next = this.spaces.get(nextId) ?? board.spaces.find((s) => s.id === nextId);
        if (next) this.group.add(createRoad(space, next, roadMat));
      }
    }
  }

  /** マスの上面中央のワールド座標 */
  positionOf(spaceId: string): THREE.Vector3 {
    const space = this.spaces.get(spaceId);
    if (!space) throw new Error(`unknown space: ${spaceId}`);
    return new THREE.Vector3(space.position.x, TILE_TOP, space.position.z);
  }
}

function createRoad(a: Space, b: Space, material: THREE.Material): THREE.Mesh {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const length = Math.hypot(dx, dz);
  const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.04, length), material);
  road.position.set(a.position.x + dx / 2, 0.02, a.position.z + dz / 2);
  road.rotation.y = Math.atan2(dx, dz);
  road.receiveShadow = true;
  return road;
}

/** ラベル 1 行の最大幅（canvas px）。これを超えるラベルは 2 行に折り返す */
const LABEL_MAX_LINE_WIDTH = 280;
/** canvas 1px あたりのワールド長（m）。1 行の高さ 60px = 0.18m */
const LABEL_WORLD_PER_PX = 0.003;

/** CanvasTexture のスプライトで文字を表示する（フォントはシステムの日本語フォント） */
function createLabel(text: string): THREE.Sprite {
  const fontSize = 40;
  const lineHeight = fontSize + 8;
  const font = `600 ${fontSize}px system-ui, "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif`;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.font = font;
  const lines = wrapLabel(ctx, text, LABEL_MAX_LINE_WIDTH);
  const padX = 16;
  const padY = 10;
  const width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2;
  const height = lineHeight * lines.length + padY * 2;
  canvas.width = width;
  canvas.height = height;

  ctx.font = font;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  roundRect(ctx, 0, 0, width, height, 12);
  ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, padY + lineHeight * (i + 0.5) + 2);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  // 文字の大きさは行数によらず一定（canvas の px をそのままワールド長に換算）
  sprite.scale.set(width * LABEL_WORLD_PER_PX, height * LABEL_WORLD_PER_PX, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}

/**
 * maxWidth を超える文字列を最大 2 行に折り返す。
 * 全角括弧「（」の前で切れるならそこで、次に文字数で半分に、それも収まらなければ 1 行目に入るだけ詰めて切る（日本語は文字単位）
 */
function wrapLabel(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const fits = (s: string): boolean => ctx.measureText(s).width <= maxWidth;
  if (fits(text)) return [text];
  const paren = text.indexOf('（');
  if (paren > 0 && fits(text.slice(0, paren)) && fits(text.slice(paren))) {
    return [text.slice(0, paren), text.slice(paren)];
  }
  const chars = [...text];
  // 1 文字だけ次の行に残るような偏りを避けるため、まず半分ずつに分ける
  const half = Math.ceil(chars.length / 2);
  const head = chars.slice(0, half).join('');
  const tail = chars.slice(half).join('');
  if (fits(head) && fits(tail)) return [head, tail];
  let n = 1;
  while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n += 1;
  return [chars.slice(0, n).join(''), chars.slice(n).join('')];
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
