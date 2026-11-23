// Visual hull by voxel carving. A voxel survives only if it lands inside the
// object silhouette in (almost) every view.
import { project } from './camera.js';

export class Hull {
  constructor(res, extent = 1.05) {
    if (!Number.isInteger(res) || res < 8 || res > 192) throw new RangeError('resolution must be an integer from 8 to 192');
    this.res = res; this.extent = extent;
    this.size = (2 * extent) / res;               // voxel edge length
    this.misses = new Uint8Array(res * res * res); // views whose silhouette excluded this voxel
    this.views = 0;
  }
  center(ix, iy, iz) {
    const s = this.size, e = this.extent;
    return [-e + (ix + 0.5) * s, -e + (iy + 0.5) * s, -e + (iz + 0.5) * s];
  }
  index(ix, iy, iz) { return (iz * this.res + iy) * this.res + ix; }

  // Adds one silhouette. Returns the number of voxels that are still alive for
  // the given tolerance (voxels allowed to miss up to `tolerance` views).
  addView(cam, mask, tolerance = 0) {
    const { res, size, extent, misses } = this;
    const { width, height } = cam;
    // x_c = a.(p - pos); precompute linear terms so the inner loop is cheap.
    const r = cam.right, u = cam.up, f = cam.f, p = cam.pos;
    for (let iz = 0; iz < res; iz++) {
      const z = -extent + (iz + 0.5) * size;
      for (let iy = 0; iy < res; iy++) {
        const y = -extent + (iy + 0.5) * size;
        let idx = (iz * res + iy) * res;
        for (let ix = 0; ix < res; ix++, idx++) {
          if (misses[idx] > tolerance) continue;
          const x = -extent + (ix + 0.5) * size;
          const dx = x - p[0], dy = y - p[1], dz = z - p[2];
          const zc = dx * f[0] + dy * f[1] + dz * f[2];
          let inside = false;
          if (zc > 0.05) {
            const uu = cam.cx + (cam.focal * (dx * r[0] + dy * r[1] + dz * r[2])) / zc;
            const vv = cam.cy - (cam.focal * (dx * u[0] + dy * u[1] + dz * u[2])) / zc;
            const px = Math.floor(uu), py = Math.floor(vv);
            if (px >= 0 && py >= 0 && px < width && py < height) inside = mask[py * width + px] === 1;
          }
          if (!inside && misses[idx] < 255) misses[idx]++;
        }
      }
    }
    this.views++;
    return this.count(tolerance);
  }

  count(tolerance = 0) {
    let c = 0; const m = this.misses;
    for (let i = 0; i < m.length; i++) if (m[i] <= tolerance) c++;
    return c;
  }
  alive(tolerance = 0) {
    const a = new Uint8Array(this.misses.length);
    for (let i = 0; i < a.length; i++) a[i] = this.misses[i] <= tolerance ? 1 : 0;
    return a;
  }
  volume(tolerance = 0) { return this.count(tolerance) * this.size ** 3; }
}

export function carve(cameras, masks, { res = 64, tolerance = 0, extent = 1.05 } = {}) {
  if (cameras.length !== masks.length) throw new Error('one mask is required per camera');
  const hull = new Hull(res, extent);
  for (let i = 0; i < cameras.length; i++) hull.addView(cameras[i], masks[i], tolerance);
  return hull;
}

// Surface voxels are alive voxels with at least one dead face neighbour.
export function surface(hull, tolerance = 0) {
  const { res, misses } = hull;
  const out = [];
  const alive = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < res && y < res && z < res && misses[(z * res + y) * res + x] <= tolerance;
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    if (!alive(x, y, z)) continue;
    if (!alive(x - 1, y, z) || !alive(x + 1, y, z) || !alive(x, y - 1, z) || !alive(x, y + 1, z) || !alive(x, y, z - 1) || !alive(x, y, z + 1)) out.push(x, y, z);
  }
  return Int32Array.from(out);
}

// Approximate outward normal from the occupancy gradient over a small window.
export function normals(hull, surf, tolerance = 0, radius = 2) {
  const { res, misses } = hull;
  const nrm = new Float32Array(surf.length);
  const occ = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < res && y < res && z < res && misses[(z * res + y) * res + x] <= tolerance ? 1 : 0);
  for (let k = 0; k < surf.length; k += 3) {
    const x = surf[k], y = surf[k + 1], z = surf[k + 2];
    let gx = 0, gy = 0, gz = 0;
    for (let a = -radius; a <= radius; a++) for (let b = -radius; b <= radius; b++) {
      gx += occ(x - radius, y + a, z + b) - occ(x + radius, y + a, z + b);
      gy += occ(x + a, y - radius, z + b) - occ(x + a, y + radius, z + b);
      gz += occ(x + a, y + b, z - radius) - occ(x + a, y + b, z + radius);
    }
    const l = Math.hypot(gx, gy, gz);
    if (l < 1e-6) { nrm[k] = 0; nrm[k + 1] = 1; nrm[k + 2] = 0; } else { nrm[k] = gx / l; nrm[k + 1] = gy / l; nrm[k + 2] = gz / l; }
  }
  return nrm;
}

// Colour surface voxels from the photos. A z-buffer of surface voxels per view
// decides which voxels each camera can actually see.
// images: array of { data: Uint8ClampedArray RGBA, width, height }
export function colorize(hull, surf, nrm, cameras, images) {
  const n = surf.length / 3;
  const acc = new Float32Array(n * 3), wsum = new Float32Array(n);
  const slack = hull.size * 1.75;
  for (let v = 0; v < cameras.length; v++) {
    const cam = cameras[v], img = images[v];
    const zbuf = new Float32Array(cam.width * cam.height).fill(Infinity);
    const proj = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = hull.center(surf[i * 3], surf[i * 3 + 1], surf[i * 3 + 2]);
      const [u, w, z] = project(cam, c[0], c[1], c[2]);
      proj[i * 3] = u; proj[i * 3 + 1] = w; proj[i * 3 + 2] = z;
      const px = Math.floor(u), py = Math.floor(w);
      if (px >= 0 && py >= 0 && px < cam.width && py < cam.height) { const q = py * cam.width + px; if (z < zbuf[q]) zbuf[q] = z; }
    }
    for (let i = 0; i < n; i++) {
      const u = proj[i * 3], w = proj[i * 3 + 1], z = proj[i * 3 + 2];
      const px = Math.floor(u), py = Math.floor(w);
      if (px < 0 || py < 0 || px >= cam.width || py >= cam.height) continue;
      // The neighbourhood minimum keeps thin gaps in the z-buffer from hiding visible voxels.
      let zmin = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if (qx >= 0 && qy >= 0 && qx < cam.width && qy < cam.height) zmin = Math.min(zmin, zbuf[qy * cam.width + qx]);
      }
      if (z > zmin + slack) continue;
      const c = hull.center(surf[i * 3], surf[i * 3 + 1], surf[i * 3 + 2]);
      const tx = cam.pos[0] - c[0], ty = cam.pos[1] - c[1], tz = cam.pos[2] - c[2];
      const tl = Math.hypot(tx, ty, tz);
      const facing = (nrm[i * 3] * tx + nrm[i * 3 + 1] * ty + nrm[i * 3 + 2] * tz) / tl;
      if (facing <= 0.1) continue;
      const wgt = facing * facing;
      const o = (py * img.width + px) * 4;
      acc[i * 3] += img.data[o] * wgt; acc[i * 3 + 1] += img.data[o + 1] * wgt; acc[i * 3 + 2] += img.data[o + 2] * wgt; wsum[i] += wgt;
    }
  }
  const colors = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (wsum[i] > 0) { colors[i * 3] = acc[i * 3] / wsum[i]; colors[i * 3 + 1] = acc[i * 3 + 1] / wsum[i]; colors[i * 3 + 2] = acc[i * 3 + 2] / wsum[i]; }
    else { colors[i * 3] = 150; colors[i * 3 + 1] = 150; colors[i * 3 + 2] = 150; }
  }
  return colors;
}

export function iou(gridA, gridB) {
  let inter = 0, uni = 0;
  for (let i = 0; i < gridA.length; i++) { const a = gridA[i] ? 1 : 0, b = gridB[i] ? 1 : 0; inter += a & b; uni += a | b; }
  return uni ? inter / uni : 1;
}
