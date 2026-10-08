// 職業一覧（名称はオリジナル）
import type { Job } from '../core/types.ts';

export const JOBS: Job[] = [
  // 学位が必要（進学ルートでのみ就ける）
  { id: 'starchart', name: '星図研究者', salary: 14_000, requiresDegree: true },
  { id: 'surgeon', name: '外科医', salary: 16_000, requiresDegree: true },
  { id: 'lawyer', name: '弁護士', salary: 13_000, requiresDegree: true },
  { id: 'roboticist', name: 'ロボット技師', salary: 12_000, requiresDegree: true },
  { id: 'architect', name: '建築家', salary: 11_000, requiresDegree: true },
  // 学位不要
  { id: 'baker', name: 'パン職人', salary: 7_000, requiresDegree: false },
  { id: 'firefighter', name: '消防士', salary: 8_000, requiresDegree: false },
  { id: 'fisher', name: '漁師', salary: 6_000, requiresDegree: false },
  { id: 'courier', name: '配達ドライバー', salary: 6_000, requiresDegree: false },
  { id: 'stylist', name: '美容師', salary: 7_000, requiresDegree: false },
  { id: 'streamer', name: '配信者', salary: 5_000, requiresDegree: false },
];
