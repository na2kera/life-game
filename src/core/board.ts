// 盤面（データ駆動）の参照と検証
import type { Board, Space } from './types.ts';

export function getSpace(board: Board, id: string): Space {
  const space = board.spaces.find((s) => s.id === id);
  if (!space) throw new Error(`unknown space: ${id}`);
  return space;
}

/**
 * 盤面データの整合性を検証し、問題点の一覧を返す（空なら正常）。
 * - id の重複、存在しない next、start/goal の有無
 * - 分岐ラベルの数
 * - 循環がないこと（必ずゴールへ進む）と、全マスからゴールへ到達できること
 */
export function validateBoard(board: Board): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const s of board.spaces) {
    if (ids.has(s.id)) errors.push(`duplicate id: ${s.id}`);
    ids.add(s.id);
  }
  if (!ids.has(board.startId)) errors.push(`start not found: ${board.startId}`);
  for (const s of board.spaces) {
    for (const n of s.next) if (!ids.has(n)) errors.push(`${s.id}: unknown next ${n}`);
    if (s.kind === 'goal' && s.next.length > 0) errors.push(`${s.id}: goal must not have next`);
    if (s.kind !== 'goal' && s.next.length === 0) errors.push(`${s.id}: dead end`);
    if (s.kind === 'branch' && s.routeLabels.length !== s.next.length) {
      errors.push(`${s.id}: routeLabels length mismatch`);
    }
    if (s.kind !== 'branch' && s.next.length > 1) errors.push(`${s.id}: only branch can fork`);
  }
  if (!board.spaces.some((s) => s.kind === 'goal')) errors.push('no goal');
  if (errors.length > 0) return errors;

  // 循環検出とゴール到達性（DFS）
  const state = new Map<string, 'visiting' | 'done'>();
  const reachesGoal = new Map<string, boolean>();
  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 'visiting') {
      errors.push(`cycle at ${id}`);
      return false;
    }
    if (st === 'done') return reachesGoal.get(id) ?? false;
    state.set(id, 'visiting');
    const space = getSpace(board, id);
    let ok = space.kind === 'goal';
    for (const n of space.next) if (visit(n)) ok = true;
    state.set(id, 'done');
    reachesGoal.set(id, ok);
    return ok;
  };
  for (const s of board.spaces) {
    if (!visit(s.id)) errors.push(`${s.id}: cannot reach goal`);
  }
  return [...new Set(errors)];
}
