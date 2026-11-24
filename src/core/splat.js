// Gaussian splats from the carved mesh. Points are sampled over the surface in
// proportion to triangle area, coloured straight from the photos (so colour is
// finer than the mesh), and each becomes a flat gaussian lying in the surface.
// These are splats placed on a recovered surface, not splats optimised against
// the photos. Pure functions, no DOM.
import { colorizePoints } from './carve.js';

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// mesh = { positions, indices, normals }. Returns typed arrays; rgb is filled by buildSplats.
export function samplesOnMesh(mesh, count, seed = 11) {
  const { positions: P, indices: I, normals: N } = mesh;
  const tri = I.length / 3, cum = new Float64Array(tri);
  let total = 0;
  for (let t = 0; t < tri; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = total;
  }
  const R = rng(seed), pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = R() * total; let lo = 0, hi = tri - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
    const a = I[lo * 3] * 3, b = I[lo * 3 + 1] * 3, c = I[lo * 3 + 2] * 3;
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] = w * P[a + k] + u * P[b + k] + v * P[c + k];
      const n = w * N[a + k] + u * N[b + k] + v * N[c + k];
      if (k === 0) nx = n; else if (k === 1) ny = n; else nz = n;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
  }
  return { pos, nrm, area: total };
}

// Shortest-arc quaternion (x,y,z,w) taking +Z to the unit vector n.
export function quatFromZ(nx, ny, nz) {
  if (nz < -0.999999) return [1, 0, 0, 0];
  const w = 1 + nz, x = -ny, y = nx, l = Math.hypot(x, y, w);
  return [x / l, y / l, 0, w / l];
}

export function buildSplats(mesh, cams, imgs, { count = 60000, slack = 0.2, seed = 11 } = {}) {
  const { pos, nrm, area } = samplesOnMesh(mesh, count, seed);
  const rgb = colorizePoints(pos, nrm, cams, imgs, slack);
  const radius = Math.sqrt(area / count) * 1.0;
  const scale = new Float32Array(count * 3), quat = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    scale[i * 3] = radius; scale[i * 3 + 1] = radius; scale[i * 3 + 2] = radius * 0.18;
    const q = quatFromZ(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    quat.set(q, i * 4);
  }
  return { n: count, pos, scale, quat, rgb, radius };
}

// 3x3 covariance (upper triangle: xx, xy, xz, yy, yz, zz) of gaussian i.
export function covariance(s, i, out = new Float32Array(6)) {
  const [x, y, z, w] = [s.quat[i * 4], s.quat[i * 4 + 1], s.quat[i * 4 + 2], s.quat[i * 4 + 3]];
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
  const sx = s.scale[i * 3], sy = s.scale[i * 3 + 1], sz = s.scale[i * 3 + 2];
  const M = [R[0] * sx, R[1] * sy, R[2] * sz, R[3] * sx, R[4] * sy, R[5] * sz, R[6] * sx, R[7] * sy, R[8] * sz];
  out[0] = M[0] * M[0] + M[1] * M[1] + M[2] * M[2];
  out[1] = M[0] * M[3] + M[1] * M[4] + M[2] * M[5];
  out[2] = M[0] * M[6] + M[1] * M[7] + M[2] * M[8];
  out[3] = M[3] * M[3] + M[4] * M[4] + M[5] * M[5];
  out[4] = M[3] * M[6] + M[4] * M[7] + M[5] * M[8];
  out[5] = M[6] * M[6] + M[7] * M[7] + M[8] * M[8];
  return out;
}

// ".splat": 32 bytes per gaussian (position f32 x3, scale f32 x3, rgba u8 x4,
// rotation u8 x4 as w,x,y,z * 128 + 128). Read by the common web splat viewers.
export function toSplat(s) {
  const buf = new ArrayBuffer(s.n * 32), dv = new DataView(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < s.n; i++) {
    const o = i * 32;
    for (let k = 0; k < 3; k++) { dv.setFloat32(o + k * 4, s.pos[i * 3 + k], true); dv.setFloat32(o + 12 + k * 4, s.scale[i * 3 + k], true); }
    u8[o + 24] = s.rgb[i * 3]; u8[o + 25] = s.rgb[i * 3 + 1]; u8[o + 26] = s.rgb[i * 3 + 2]; u8[o + 27] = 255;
    const q = [s.quat[i * 4 + 3], s.quat[i * 4], s.quat[i * 4 + 1], s.quat[i * 4 + 2]];
    for (let k = 0; k < 4; k++) u8[o + 28 + k] = Math.max(0, Math.min(255, Math.round(q[k] * 128 + 128)));
  }
  return new Uint8Array(buf);
}

// Binary PLY in the layout used by the original 3D Gaussian Splatting code
// (degree-0 colour, log scales, logit opacity, w-first quaternion).
export function toGaussianPLY(s) {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex ${s.n}\n${props.map((p) => 'property float ' + p).join('\n')}\nend_header\n`;
  const hb = new TextEncoder().encode(head), body = new DataView(new ArrayBuffer(s.n * props.length * 4));
  const C0 = 0.28209479177387814, op = Math.log(0.97 / 0.03);
  for (let i = 0; i < s.n; i++) {
    const v = [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2], 0, 0, 0,
      (s.rgb[i * 3] / 255 - 0.5) / C0, (s.rgb[i * 3 + 1] / 255 - 0.5) / C0, (s.rgb[i * 3 + 2] / 255 - 0.5) / C0, op,
      Math.log(s.scale[i * 3]), Math.log(s.scale[i * 3 + 1]), Math.log(s.scale[i * 3 + 2]),
      s.quat[i * 4 + 3], s.quat[i * 4], s.quat[i * 4 + 1], s.quat[i * 4 + 2]];
    for (let k = 0; k < v.length; k++) body.setFloat32((i * props.length + k) * 4, v[k], true);
  }
  const out = new Uint8Array(hb.length + body.byteLength);
  out.set(hb, 0); out.set(new Uint8Array(body.buffer), hb.length);
  return out;
}
