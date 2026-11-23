// Top-down slice of the hull, recorded view by view, so the cut each photo
// makes is visible as a set of removed cells.
import { Hull } from '../core/carve.js';

export function recordSlice(cams, masks, res, tolerance) {
  const hull = new Hull(res), y = Math.floor(res * 0.5);
  const steps = [];
  let prev = new Uint8Array(res * res).fill(1);
  for (let i = 0; i < cams.length; i++) {
    hull.addView(cams[i], masks[i], tolerance);
    const cur = new Uint8Array(res * res);
    for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) cur[z * res + x] = hull.misses[(z * res + y) * res + x] <= tolerance ? 1 : 0;
    steps.push({ alive: cur, killed: prev.map((p, k) => (p && !cur[k] ? 1 : 0)) });
    prev = cur;
  }
  return { res, steps, cams };
}

export function drawSlice(canvas, rec, k, cap) {
  const g = canvas.getContext('2d'), W = canvas.width, res = rec.res, cell = W / res;
  g.fillStyle = '#ecebe5'; g.fillRect(0, 0, W, W);
  // plinth circle and camera ticks
  g.strokeStyle = 'rgba(21,23,26,.35)'; g.lineWidth = 1;
  g.beginPath(); g.arc(W / 2, W / 2, W * 0.47, 0, Math.PI * 2); g.stroke();
  const cams = rec.cams;
  for (let i = 0; i < cams.length; i++) {
    const c = cams[i], a = Math.atan2(c.pos[0], c.pos[2]);
    const r0 = W * 0.47, r1 = W * 0.495;
    g.strokeStyle = i < k ? '#ff5a1f' : 'rgba(21,23,26,.25)'; g.lineWidth = i === k - 1 ? 3 : 1.4;
    g.beginPath(); g.moveTo(W / 2 + Math.sin(a) * r0, W / 2 - Math.cos(a) * r0); g.lineTo(W / 2 + Math.sin(a) * r1, W / 2 - Math.cos(a) * r1); g.stroke();
  }
  const cur = k > 0 ? rec.steps[k - 1] : null;
  const alive = cur ? cur.alive : null;
  // earlier cuts, faint
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const px = x * cell, py = (res - 1 - z) * cell; // +z up on screen
    const live = alive ? alive[z * res + x] : 1;
    if (live) { g.fillStyle = '#15171a'; g.fillRect(px, py, cell + 0.5, cell + 0.5); }
  }
  if (cur) {
    g.fillStyle = '#ff5a1f';
    for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) if (cur.killed[z * res + x]) g.fillRect(x * cell, (res - 1 - z) * cell, cell + 0.5, cell + 0.5);
  }
  let n = 0; if (alive) for (let i = 0; i < alive.length; i++) n += alive[i];
  if (cap) cap.textContent = k === 0 ? 'full block' : (() => { const c = cur.killed.reduce((a, b) => a + b, 0); return `view ${k}: ${c} ${c === 1 ? 'cell' : 'cells'} cut, ${n} left`; })();
}
