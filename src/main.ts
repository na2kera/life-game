// エントリ
import './style.css';
import { App } from './app.ts';
import { STANDARD_DATA } from './data/index.ts';

const canvas = document.getElementById('scene');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('#scene canvas not found');

const app = new App(canvas, STANDARD_DATA);
app.start().catch((e: unknown) => console.error(e));
