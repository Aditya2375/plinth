// Procedural demo objects, defined as signed distance functions, with a small
// sphere tracer that photographs them from any turntable camera. Because the
// shape is known exactly, the carved hull can be scored against ground truth.
import { rayDir } from './camera.js';

const len2 = (x, y) => Math.hypot(x, y);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function capsule(px, py, pz, ax, ay, az, bx, by, bz, r) {
  const pax = px - ax, pay = py - ay, paz = pz - az, bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}
function box(px, py, pz, cx, cy, cz, hx, hy, hz) {
  const qx = Math.abs(px - cx) - hx, qy = Math.abs(py - cy) - hy, qz = Math.abs(pz - cz) - hz;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
}

const rgb = (r, g, b) => [r, g, b];

const OBJECTS = {
  vase: {
    label: 'Vase',
    note: 'Smooth, convex in silhouette. The easy case.',
    sdf(x, y, z) {
      const r = 0.2 + 0.4 * Math.exp(-(((y + 0.15) / 0.46) ** 2)) + 0.16 * smooth(0.55, 0.9, y);
      return Math.max(len2(x, z) - r, Math.abs(y) - 0.92) * 0.8;
    },
    color(x, y) {
      if (Math.abs(y - 0.18) < 0.045) return rgb(242, 222, 176);
      if (Math.abs(y + 0.32) < 0.03) return rgb(242, 222, 176);
      if (y > 0.62) return rgb(40, 74, 112);
      return rgb(190, 84, 52);
    },
  },
  mug: {
    label: 'Mug',
    note: 'Hollow inside. Silhouettes cannot see a cavity, so the hull fills it.',
    sdf(x, y, z) {
      const cyl = Math.max(len2(x, z) - 0.55, Math.abs(y) - 0.45);
      const hole = Math.max(len2(x, z) - 0.45, y - 0.55, -0.34 - y);
      const body = Math.max(cyl, -hole);
      const handle = Math.hypot(len2(x - 0.66, y) - 0.28, z) - 0.075;
      return Math.min(body, handle) * 0.8;
    },
    color(x, y, z) {
      if (len2(x, z) < 0.46 && y > -0.34) return rgb(240, 208, 112);
      if (y > 0.36) return rgb(240, 208, 112);
      return rgb(34, 124, 128);
    },
  },
  stool: {
    label: 'Stool',
    note: 'Thin legs and a ring. Gaps between legs show up in the silhouettes.',
    sdf(x, y, z) {
      let d = Math.max(len2(x, z) - 0.72, Math.abs(y - 0.5) - 0.07);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2, c = Math.cos(a), s = Math.sin(a);
        d = Math.min(d, capsule(x, y, z, 0.46 * c, 0.46, 0.46 * s, 0.68 * c, -0.9, 0.68 * s, 0.075));
      }
      d = Math.min(d, Math.hypot(len2(x, z) - 0.58, y + 0.38) - 0.045);
      return d * 0.8;
    },
    color(x, y) { return y > 0.4 ? rgb(176, 120, 72) : y > -0.45 && y < -0.3 ? rgb(60, 48, 40) : rgb(122, 80, 48); },
  },
  rook: {
    label: 'Rook',
    note: 'Notched battlements and a stepped base.',
    sdf(x, y, z) {
      const rr = len2(x, z);
      const base = Math.max(rr - 0.72, Math.abs(y + 0.78) - 0.12);
      const waist = 0.34 + 0.12 * smooth(-0.6, -0.3, -y) ;
      const body = Math.max(rr - (0.4 + 0.14 * smooth(0.1, -0.6, y) - 0.0 * waist), Math.abs(y + 0.05) - 0.7);
      let top = Math.max(rr - 0.56, Math.abs(y - 0.72) - 0.2);
      const notch = Math.min(box(x, y, z, 0, 0.9, 0, 0.14, 0.14, 0.9), box(x, y, z, 0, 0.9, 0, 0.9, 0.14, 0.14));
      top = Math.max(top, -notch);
      const cap = Math.max(rr - 0.5, Math.abs(y - 0.48) - 0.05);
      return Math.min(base, body, top, cap) * 0.8;
    },
    color(x, y) { return Math.abs(y - 0.42) < 0.03 ? rgb(196, 150, 60) : y < -0.62 ? rgb(70, 78, 98) : rgb(112, 122, 142); },
  },
};

export const objectNames = Object.keys(OBJECTS);
export const objectInfo = (name) => ({ label: OBJECTS[name].label, note: OBJECTS[name].note });
export const inside = (name, x, y, z) => OBJECTS[name].sdf(x, y, z) < 0;

function normalAt(sdf, x, y, z) {
  const e = 0.003;
  const nx = sdf(x + e, y, z) - sdf(x - e, y, z), ny = sdf(x, y + e, z) - sdf(x, y - e, z), nz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// Small deterministic PRNG so renders are reproducible.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function renderView(name, cam, { noise = 3, seed = 7 } = {}) {
  const obj = OBJECTS[name];
  if (!obj) throw new Error('unknown object: ' + name);
  const { width: W, height: H } = cam;
  const data = new Uint8ClampedArray(W * H * 4), truth = new Uint8Array(W * H);
  const rand = rng(seed * 1009 + 13);
  const dist = Math.hypot(...cam.pos);
  const light = [0.45, 0.8, 0.4]; const ll = Math.hypot(...light); light[0] /= ll; light[1] /= ll; light[2] /= ll;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const dir = rayDir(cam, px + 0.5, py + 0.5);
    let t = dist - 1.4, hit = false, x = 0, y = 0, z = 0;
    for (let i = 0; i < 120 && t < dist + 1.4; i++) {
      x = cam.pos[0] + dir[0] * t; y = cam.pos[1] + dir[1] * t; z = cam.pos[2] + dir[2] * t;
      const d = obj.sdf(x, y, z);
      if (d < 0.0015) { hit = true; break; }
      t += d;
    }
    const o = (py * W + px) * 4;
    if (hit) {
      const n = normalAt(obj.sdf, x, y, z);
      const lam = Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const shade = 0.42 + 0.62 * lam;
      const c = obj.color(x, y, z);
      data[o] = c[0] * shade + (rand() - 0.5) * noise; data[o + 1] = c[1] * shade + (rand() - 0.5) * noise; data[o + 2] = c[2] * shade + (rand() - 0.5) * noise;
      truth[py * W + px] = 1;
    } else {
      const g = 236 - 14 * (py / H) + (rand() - 0.5) * noise * 1.6;
      data[o] = g; data[o + 1] = g - 2; data[o + 2] = g - 7;
    }
    data[o + 3] = 255;
  }
  return { data, width: W, height: H, truth };
}
