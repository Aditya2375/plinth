// Writes a turntable photo set and a video source frames for browser tests.
import { writeFileSync, mkdirSync } from 'node:fs';
import { turntableCameras } from '../src/core/camera.js';
import { renderView } from '../src/core/synth.js';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const N = 24, W = 160;
const cams = turntableCameras(N, { elevation: 0.35, distance: 3.4, fov: 44 * Math.PI / 180, width: W, height: W });
cams.forEach((c, i) => {
  const img = renderView('rook', c, { noise: 5, seed: i + 3 });
  const ppm = Buffer.concat([Buffer.from(`P6\n${W} ${W}\n255\n`), Buffer.from(Array.from({ length: W * W }, (_, p) => [img.data[p * 4], img.data[p * 4 + 1], img.data[p * 4 + 2]]).flat())]);
  writeFileSync(`${out}/frame-${String(i + 1).padStart(2, '0')}.ppm`, ppm);
});
