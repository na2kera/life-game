// 追従カメラ。対象（現在手番のコマ）を斜め上から見下ろし、なめらかに補間して追う。
import * as THREE from 'three';
import type { SceneView } from './scene.ts';

/** 対象からカメラへのオフセット（斜め上・手前） */
const OFFSET = new THREE.Vector3(0, 4.2, 4.4);
/** 大きいほど速く追いつく */
const FOLLOW_SPEED = 3.5;

export class FollowCamera {
  private target: THREE.Vector3 | null = null;
  private readonly lookAt = new THREE.Vector3();

  constructor(sceneView: SceneView, initial: THREE.Vector3) {
    const camera = sceneView.camera;
    this.lookAt.copy(initial);
    camera.position.copy(initial).add(OFFSET);
    camera.lookAt(this.lookAt);

    sceneView.onFrame((dt) => {
      if (!this.target) return;
      const k = 1 - Math.exp(-dt * FOLLOW_SPEED);
      this.lookAt.lerp(this.target, k);
      camera.position.copy(this.lookAt).add(OFFSET);
      camera.lookAt(this.lookAt);
    });
  }

  /** 追従対象。渡した Vector3 は参照で保持し、毎フレーム最新の値を追う */
  follow(target: THREE.Vector3): void {
    this.target = target;
  }
}
