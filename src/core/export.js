// Plain-text exporters. Coordinates are object units, Y up.
export function toPLYPoints(hull, surf, colors) {
  const n = surf.length / 3;
  const lines = ['ply', 'format ascii 1.0', 'comment Plinth visual hull point cloud', `element vertex ${n}`,
    'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'end_header'];
  for (let i = 0; i < n; i++) {
    const c = hull.center(surf[i * 3], surf[i * 3 + 1], surf[i * 3 + 2]);
    lines.push(`${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)} ${colors[i * 3]} ${colors[i * 3 + 1]} ${colors[i * 3 + 2]}`);
  }
  return lines.join('\n') + '\n';
}

// Exposed voxel faces as quads. `colorOf(ix,iy,iz)` returns [r,g,b] or null.
export function exposedFaces(hull, tolerance, colorOf) {
  const { res, misses } = hull;
  const alive = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < res && y < res && z < res && misses[(z * res + y) * res + x] <= tolerance;
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const quads = [];
  for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    if (!alive(x, y, z)) continue;
    const col = colorOf ? colorOf(x, y, z) : null;
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = dirs[d];
      if (alive(x + dx, y + dy, z + dz)) continue;
      quads.push({ x, y, z, d, col });
    }
  }
  return quads;
}

const FACE_CORNERS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];

export function toOBJ(hull, tolerance) {
  const quads = exposedFaces(hull, tolerance, null);
  const s = hull.size, e = hull.extent;
  const lines = ['# Plinth visual hull, voxel surface', 'o hull'];
  let v = 0;
  for (const q of quads) {
    for (const c of FACE_CORNERS[q.d]) {
      lines.push(`v ${(-e + (q.x + c[0]) * s).toFixed(4)} ${(-e + (q.y + c[1]) * s).toFixed(4)} ${(-e + (q.z + c[2]) * s).toFixed(4)}`);
    }
    lines.push(`f ${v + 1} ${v + 2} ${v + 3} ${v + 4}`); v += 4;
  }
  return lines.join('\n') + '\n';
}

export function toPLYMesh(hull, tolerance, colorOf) {
  const quads = exposedFaces(hull, tolerance, colorOf);
  const s = hull.size, e = hull.extent;
  const head = ['ply', 'format ascii 1.0', 'comment Plinth visual hull mesh', `element vertex ${quads.length * 4}`,
    'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue',
    `element face ${quads.length}`, 'property list uchar int vertex_indices', 'end_header'];
  const body = [], faces = []; let v = 0;
  for (const q of quads) {
    const col = q.col || [160, 160, 160];
    for (const c of FACE_CORNERS[q.d]) body.push(`${(-e + (q.x + c[0]) * s).toFixed(4)} ${(-e + (q.y + c[1]) * s).toFixed(4)} ${(-e + (q.z + c[2]) * s).toFixed(4)} ${col[0]} ${col[1]} ${col[2]}`);
    faces.push(`4 ${v} ${v + 1} ${v + 2} ${v + 3}`); v += 4;
  }
  return head.concat(body, faces).join('\n') + '\n';
}
