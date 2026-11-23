// Smooth surface from the carved voxels. The 0/1 occupancy grid is blurred into
// a scalar field and a surface-nets pass places one vertex per boundary cell, so
// the result has no stair-steps. Pure functions, no DOM.

export function occupancyField(hull, tolerance = 0, passes = 2) {
  const { res, misses } = hull;
  const R = res + 4, N = R * R * R;
  let a = new Float32Array(N), b = new Float32Array(N);
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    if (misses[(z * res + y) * res + x] <= tolerance) a[((z + 2) * R + (y + 2)) * R + (x + 2)] = 1;
  }
  const stride = [1, R, R * R];
  for (let p = 0; p < passes; p++) {
    for (let ax = 0; ax < 3; ax++) {
      const s = stride[ax];
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
        const i = (z * R + y) * R + x, c = [x, y, z][ax];
        const lo = c > 0 ? a[i - s] : 0, hi = c < R - 1 ? a[i + s] : 0;
        b[i] = 0.25 * lo + 0.5 * a[i] + 0.25 * hi;
      }
      const t = a; a = b; b = t;
    }
  }
  return { field: a, R };
}

// Returns { positions, indices, normals }. Triangles wind counter-clockwise seen from outside.
export function buildMesh(hull, tolerance = 0, { iso = 0.5, passes = 2 } = {}) {
  const { field, R } = occupancyField(hull, tolerance, passes);
  const size = hull.size, org = -hull.extent + 0.5 * size - 2 * size; // world position of padded sample 0
  const cells = R - 1;
  const vid = new Int32Array(cells * cells * cells).fill(-1);
  const pos = [];
  const f = (x, y, z) => field[(z * R + y) * R + x];
  const CORN = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const val = new Float32Array(8);
  for (let z = 0; z < cells; z++) for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { val[c] = f(x + CORN[c][0], y + CORN[c][1], z + CORN[c][2]); if (val[c] > iso) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [i, j] of EDGES) {
      const vi = val[i], vj = val[j];
      if ((vi > iso) === (vj > iso)) continue;
      const t = (iso - vi) / (vj - vi);
      sx += CORN[i][0] + t * (CORN[j][0] - CORN[i][0]);
      sy += CORN[i][1] + t * (CORN[j][1] - CORN[i][1]);
      sz += CORN[i][2] + t * (CORN[j][2] - CORN[i][2]);
      n++;
    }
    vid[(z * cells + y) * cells + x] = pos.length / 3;
    pos.push(org + (x + sx / n) * size, org + (y + sy / n) * size, org + (z + sz / n) * size);
  }
  const idx = [];
  const cv = (x, y, z) => vid[(z * cells + y) * cells + x];
  // One quad per grid edge that crosses the surface; its four neighbouring cells hold the corners.
  for (let z = 1; z < cells; z++) for (let y = 1; y < cells; y++) for (let x = 1; x < cells; x++) {
    const here = f(x, y, z) > iso;
    for (let ax = 0; ax < 3; ax++) {
      const nx = x + (ax === 0 ? 1 : 0), ny = y + (ax === 1 ? 1 : 0), nz = z + (ax === 2 ? 1 : 0);
      if (nx >= R || ny >= R || nz >= R) continue;
      if ((f(nx, ny, nz) > iso) === here) continue;
      let a, b, c, d;
      if (ax === 0) { a = cv(x, y - 1, z - 1); b = cv(x, y, z - 1); c = cv(x, y, z); d = cv(x, y - 1, z); }
      else if (ax === 1) { a = cv(x - 1, y, z - 1); b = cv(x - 1, y, z); c = cv(x, y, z); d = cv(x, y, z - 1); }
      else { a = cv(x - 1, y - 1, z); b = cv(x, y - 1, z); c = cv(x, y, z); d = cv(x - 1, y, z); }
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      if (here) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
    }
  }
  const positions = Float32Array.from(pos), indices = Uint32Array.from(idx);
  return { positions, indices, normals: vertexNormals(positions, indices) };
}

export function vertexNormals(positions, indices) {
  const nrm = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const i = indices[t] * 3, j = indices[t + 1] * 3, k = indices[t + 2] * 3;
    const ux = positions[j] - positions[i], uy = positions[j + 1] - positions[i + 1], uz = positions[j + 2] - positions[i + 2];
    const vx = positions[k] - positions[i], vy = positions[k + 1] - positions[i + 1], vz = positions[k + 2] - positions[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [i, j, k]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
    if (l > 0) { nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; } else nrm[i + 1] = 1;
  }
  return nrm;
}

export function meshVolume(m) {
  let v = 0; const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const i = m.indices[t] * 3, j = m.indices[t + 1] * 3, k = m.indices[t + 2] * 3;
    v += (p[i] * (p[j + 1] * p[k + 2] - p[j + 2] * p[k + 1]) - p[i + 1] * (p[j] * p[k + 2] - p[j + 2] * p[k]) + p[i + 2] * (p[j] * p[k + 1] - p[j + 1] * p[k])) / 6;
  }
  return v;
}

// Every edge shared by exactly two triangles.
export function isWatertight(m) {
  const e = new Map();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let s = 0; s < 3; s++) {
      const a = m.indices[t + s], b = m.indices[t + ((s + 1) % 3)];
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      e.set(key, (e.get(key) || 0) + 1);
    }
  }
  for (const c of e.values()) if (c !== 2) return false;
  return true;
}
