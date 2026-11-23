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

// ---- smooth mesh exporters (mesh = { positions, indices, normals }, colors = Uint8Array rgb per vertex) ----
export function toOBJMesh(mesh, colors) {
  const n = mesh.positions.length / 3, out = ['# Plinth smooth mesh, vertex colours as extra v columns (0-1)', 'o plinth'];
  for (let i = 0; i < n; i++) {
    const p = mesh.positions, c = colors ? [colors[i * 3] / 255, colors[i * 3 + 1] / 255, colors[i * 3 + 2] / 255] : [0.6, 0.6, 0.6];
    out.push(`v ${p[i * 3].toFixed(5)} ${p[i * 3 + 1].toFixed(5)} ${p[i * 3 + 2].toFixed(5)} ${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`);
  }
  for (let i = 0; i < n; i++) out.push(`vn ${mesh.normals[i * 3].toFixed(4)} ${mesh.normals[i * 3 + 1].toFixed(4)} ${mesh.normals[i * 3 + 2].toFixed(4)}`);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] + 1, b = mesh.indices[t + 1] + 1, c = mesh.indices[t + 2] + 1;
    out.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  return out.join('\n') + '\n';
}

export function toPLYTriMesh(mesh, colors) {
  const n = mesh.positions.length / 3, f = mesh.indices.length / 3;
  const out = ['ply', 'format ascii 1.0', 'comment Plinth smooth mesh', `element vertex ${n}`,
    'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue',
    `element face ${f}`, 'property list uchar int vertex_indices', 'end_header'];
  for (let i = 0; i < n; i++) {
    const p = mesh.positions, c = colors ? [colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]] : [160, 160, 160];
    out.push(`${p[i * 3].toFixed(5)} ${p[i * 3 + 1].toFixed(5)} ${p[i * 3 + 2].toFixed(5)} ${c[0]} ${c[1]} ${c[2]}`);
  }
  for (let t = 0; t < mesh.indices.length; t += 3) out.push(`3 ${mesh.indices[t]} ${mesh.indices[t + 1]} ${mesh.indices[t + 2]}`);
  return out.join('\n') + '\n';
}

// Binary glTF 2.0 with positions, normals, vertex colours and triangle indices.
export function toGLB(mesh, colors) {
  const n = mesh.positions.length / 3, nIdx = mesh.indices.length;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) col[i] = colors ? colors[i] / 255 : 0.62;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = mesh.positions[i * 3 + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const bytes = [mesh.positions.byteLength, mesh.normals.byteLength, col.byteLength, mesh.indices.byteLength];
  const offs = [0, bytes[0], bytes[0] + bytes[1], bytes[0] + bytes[1] + bytes[2]];
  const binLen = offs[3] + bytes[3];
  const json = {
    asset: { version: '2.0', generator: 'Plinth' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: false }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: offs[0], byteLength: bytes[0], target: 34962 },
      { buffer: 0, byteOffset: offs[1], byteLength: bytes[1], target: 34962 },
      { buffer: 0, byteOffset: offs[2], byteLength: bytes[2], target: 34962 },
      { buffer: 0, byteOffset: offs[3], byteLength: bytes[3], target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: nIdx, type: 'SCALAR' },
    ],
  };
  let js = JSON.stringify(json); while (js.length % 4) js += ' ';
  const jsonBytes = new TextEncoder().encode(js);
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
  u8.set(new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, bytes[0]), o + offs[0]);
  u8.set(new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, bytes[1]), o + offs[1]);
  u8.set(new Uint8Array(col.buffer), o + offs[2]);
  u8.set(new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, bytes[3]), o + offs[3]);
  return buf;
}
