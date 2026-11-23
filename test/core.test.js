import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera, project, turntableCameras, rayDir } from '../src/core/camera.js';
import { segment, maskIoU, otsu } from '../src/core/segment.js';
import { Hull, carve, surface, normals, colorize, iou } from '../src/core/carve.js';
import { renderView, objectNames, inside } from '../src/core/synth.js';
import { toPLYPoints, toOBJ, toPLYMesh } from '../src/core/export.js';

const CAM = { elevation: [0.15, 0.62], distance: 3.4, fov: (44 * Math.PI) / 180, width: 96, height: 96 };

test('the origin projects to the image centre at the camera distance', () => {
  const c = makeCamera({ azimuth: 1.1, elevation: 0.3, distance: 3.4, fov: 0.6, width: 100, height: 80 });
  const [u, v, z] = project(c, 0, 0, 0);
  assert.ok(Math.abs(u - 50) < 1e-9 && Math.abs(v - 40) < 1e-9);
  assert.ok(Math.abs(z - 3.4) < 1e-9);
});
test('rayDir inverts project', () => {
  const c = makeCamera({ azimuth: 2.0, elevation: 0.2, distance: 3, fov: 0.7, width: 120, height: 90 });
  const p = [0.3, -0.2, 0.5];
  const [u, v, z] = project(c, ...p);
  const d = rayDir(c, u, v);
  const q = [c.pos[0] + d[0] * z / (d[0] * c.f[0] + d[1] * c.f[1] + d[2] * c.f[2]), 0, 0];
  const t = z / (d[0] * c.f[0] + d[1] * c.f[1] + d[2] * c.f[2]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c.pos[i] + d[i] * t - p[i]) < 1e-9);
  assert.ok(q);
});
test('cameras are spread evenly and all look at the origin', () => {
  const cams = turntableCameras(8, CAM);
  assert.equal(cams.length, 8);
  for (const c of cams) { const [u, v] = project(c, 0, 0, 0); assert.ok(Math.abs(u - 48) < 1e-9 && Math.abs(v - 48) < 1e-9); }
});
test('otsu separates two clusters', () => {
  const a = new Float32Array(1000); for (let i = 0; i < 1000; i++) a[i] = i < 600 ? 5 : 200;
  const t = otsu(a); assert.ok(t > 5 && t < 200);
});
test('segmentation recovers the true silhouette of every demo object', () => {
  for (const name of objectNames) {
    const cam = turntableCameras(6, CAM)[2];
    const img = renderView(name, cam, { noise: 6 });
    const { mask } = segment(img.data, img.width, img.height);
    const score = maskIoU(mask, img.truth);
    assert.ok(score > 0.93, `${name} mask IoU ${score}`);
  }
});
test('a hull rejects an out-of-range resolution', () => {
  assert.throws(() => new Hull(4)); assert.throws(() => new Hull(500)); assert.throws(() => new Hull(12.5));
});
test('carving a sphere of silhouettes keeps a ball', () => {
  const cams = turntableCameras(12, CAM);
  const masks = cams.map((c) => {
    const m = new Uint8Array(c.width * c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const r = c.focal * 0.6 / 3.4; if (Math.hypot(x + 0.5 - c.cx, y + 0.5 - c.cy) < r * 1.0) m[y * c.width + x] = 1;
    } return m;
  });
  const h = carve(cams, masks, { res: 40 });
  const vol = h.volume(); const ball = (4 / 3) * Math.PI * 0.6 ** 3;
  assert.ok(vol > ball * 0.8 && vol < ball * 1.5, `volume ${vol} vs ${ball}`);
});
test('hull against ground truth is high for every demo object', () => {
  const res = 48;
  for (const name of objectNames) {
    const cams = turntableCameras(24, CAM);
    const masks = cams.map((c) => segment(...(r => [r.data, r.width, r.height])(renderView(name, c))).mask);
    const hull = carve(cams, masks, { res });
    const truth = new Uint8Array(res ** 3);
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const c = hull.center(x, y, z); truth[hull.index(x, y, z)] = inside(name, c[0], c[1], c[2]) ? 1 : 0; }
    const score = iou(hull.alive(0), truth);
    // Hulls only ever add volume: every true voxel should survive (allowing boundary noise).
    let lost = 0, tv = 0; const a = hull.alive(0);
    for (let i = 0; i < truth.length; i++) if (truth[i]) { tv++; if (!a[i]) lost++; }
    assert.ok(score > (name === 'mug' ? 0.25 : 0.7), `${name} IoU ${score}`);
    assert.ok(lost / tv < 0.1, `${name} lost ${(lost / tv).toFixed(3)} of the true volume`);
  }
});
test('more views never add volume', () => {
  const cams = turntableCameras(16, CAM);
  const masks = cams.map((c) => segment(...(r => [r.data, r.width, r.height])(renderView('stool', c))).mask);
  const h = new Hull(32); let prev = Infinity;
  for (let i = 0; i < cams.length; i++) { const n = h.addView(cams[i], masks[i], 0); assert.ok(n <= prev); prev = n; }
});
test('the mug hull fills the cavity (a known limit of silhouettes)', () => {
  const res = 48, name = 'mug';
  const cams = turntableCameras(24, CAM);
  const masks = cams.map((c) => segment(...(r => [r.data, r.width, r.height])(renderView(name, c))).mask);
  const hull = carve(cams, masks, { res });
  const c = hull.center(res >> 1, Math.round(res * 0.62), res >> 1);
  assert.equal(inside(name, ...c), false);
  assert.equal(hull.misses[hull.index(res >> 1, Math.round(res * 0.62), res >> 1)], 0);
});
test('surface, normals and colour agree on a rendered vase', () => {
  const res = 40;
  const cams = turntableCameras(16, CAM);
  const imgs = cams.map((c) => renderView('vase', c));
  const masks = imgs.map((i) => segment(i.data, i.width, i.height).mask);
  const hull = carve(cams, masks, { res });
  const surf = surface(hull); const nrm = normals(hull, surf);
  assert.ok(surf.length / 3 > 200);
  const cols = colorize(hull, surf, nrm, cams, imgs);
  // The vase's top section is blue, its body terracotta.
  let blueTop = 0, topCount = 0;
  for (let i = 0; i < surf.length / 3; i++) {
    const c = hull.center(surf[i * 3], surf[i * 3 + 1], surf[i * 3 + 2]);
    if (c[1] > 0.7 && Math.hypot(c[0], c[2]) > 0.3 && nrm[i * 3 + 1] < 0.6) { topCount++; if (cols[i * 3 + 2] > cols[i * 3]) blueTop++; }
  }
  assert.ok(topCount > 5 && blueTop / topCount > 0.8, `${blueTop}/${topCount}`);
});
test('exports are well formed', () => {
  const res = 16; const h = new Hull(res);
  const cams = turntableCameras(4, CAM); const m = new Uint8Array(96 * 96).fill(1);
  for (const c of cams) h.addView(c, m, 0);
  const surf = surface(h); const cols = new Uint8Array(surf.length).fill(200);
  const ply = toPLYPoints(h, surf, cols).split('\n');
  assert.equal(ply[0], 'ply'); assert.equal(Number(ply[3].split(' ')[2]), surf.length / 3);
  assert.equal(ply.length - 1 - ply.indexOf('end_header') - 1, surf.length / 3);
  const obj = toOBJ(h, 0); assert.ok(obj.includes('\nf '));
  const mesh = toPLYMesh(h, 0, null); assert.ok(mesh.startsWith('ply'));
});

test('a second ring of cameras tightens the stool hull (the claim made on the page)', () => {
  const res = 48, name = 'stool';
  const score = (elevation) => {
    const cams = turntableCameras(24, { ...CAM, elevation });
    const masks = cams.map((c) => segment(...(r => [r.data, r.width, r.height])(renderView(name, c))).mask);
    const hull = carve(cams, masks, { res });
    const truth = new Uint8Array(res ** 3);
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const c = hull.center(x, y, z); truth[hull.index(x, y, z)] = inside(name, c[0], c[1], c[2]) ? 1 : 0; }
    return iou(hull.alive(0), truth);
  };
  const one = score(0.35), two = score([0.15, 0.62]);
  assert.ok(two > one + 0.1, `one ring ${one}, two rings ${two}`);
});

// ---- v1.1: smooth mesh, GLB, teapot ----
import { buildMesh, meshVolume, isWatertight } from '../src/core/mesh.js';
import { toGLB, toOBJMesh, toPLYTriMesh } from '../src/core/export.js';
import { distance } from '../src/core/synth.js';
import { colorizePoints } from '../src/core/carve.js';

function demoHull(name, res = 64, n = 36) {
  const cams = turntableCameras(n, { ...CAM, width: 128, height: 128 });
  const imgs = cams.map((c, i) => renderView(name, c, { noise: 4, seed: i + 1 }));
  const masks = imgs.map((im) => segment(im.data, im.width, im.height).mask);
  return { cams, imgs, hull: carve(cams, masks, { res }) };
}

test('smooth mesh of every demo object is closed at 96 cubed, faces outward, and hugs the true surface', () => {
  for (const name of objectNames) {
    const { hull } = demoHull(name, 96);
    const m = buildMesh(hull, 0);
    assert.ok(isWatertight(m), name + ' mesh has open or non-manifold edges');
    assert.ok(meshVolume(m) > 0, name + ' triangles wind inward');
    let err = 0; const n = m.positions.length / 3;
    for (let i = 0; i < n; i++) err += distance(name, m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
    assert.ok(err / n < 0.03, `${name} mean surface error ${(err / n).toFixed(4)}`);
  }
});

test('mesh volume agrees with the voxel volume of the hull', () => {
  const { hull } = demoHull('vase', 96);
  const m = buildMesh(hull, 0);
  const rel = Math.abs(meshVolume(m) - hull.volume(0)) / hull.volume(0);
  assert.ok(rel < 0.03, 'relative volume difference ' + rel);
});

test('mesh normals are unit length and point away from the inside', () => {
  const { hull } = demoHull('teapot', 64);
  const m = buildMesh(hull, 0);
  let outward = 0; const n = m.positions.length / 3;
  for (let i = 0; i < n; i++) {
    const nx = m.normals[i * 3], ny = m.normals[i * 3 + 1], nz = m.normals[i * 3 + 2];
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-4);
    const e = 0.04;
    if (inside('teapot', m.positions[i * 3] + nx * e, m.positions[i * 3 + 1] + ny * e, m.positions[i * 3 + 2] + nz * e) === false) outward++;
  }
  assert.ok(outward / n > 0.97, 'outward fraction ' + outward / n);
});

test('the teapot, with a spout and a handle, carves to over 95% overlap', () => {
  const { hull } = demoHull('teapot', 96);
  const truth = new Uint8Array(96 ** 3);
  for (let z = 0; z < 96; z++) for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) truth[hull.index(x, y, z)] = inside('teapot', ...hull.center(x, y, z)) ? 1 : 0;
  assert.ok(iou(hull.alive(0), truth) > 0.95);
});

test('vertex colours come from the photos: the vase is red-brown and navy, never grey', () => {
  const { hull, cams, imgs } = demoHull('vase', 64);
  const m = buildMesh(hull, 0);
  const rgb = colorizePoints(m.positions, m.normals, cams, imgs, hull.size * 1.75);
  let grey = 0; const n = m.positions.length / 3;
  for (let i = 0; i < n; i++) if (rgb[i * 3] === 150 && rgb[i * 3 + 1] === 150 && rgb[i * 3 + 2] === 150) grey++;
  assert.ok(grey / n < 0.02, 'uncoloured fraction ' + grey / n);
});

test('GLB is a valid binary glTF 2.0 container whose accessors fit the buffer', () => {
  const { hull, cams, imgs } = demoHull('rook', 48, 24);
  const m = buildMesh(hull, 0);
  const rgb = colorizePoints(m.positions, m.normals, cams, imgs, hull.size * 1.75);
  const buf = toGLB(m, rgb), dv = new DataView(buf);
  assert.equal(dv.getUint32(0, true), 0x46546c67); assert.equal(dv.getUint32(4, true), 2); assert.equal(dv.getUint32(8, true), buf.byteLength);
  const jl = dv.getUint32(12, true); assert.equal(dv.getUint32(16, true), 0x4e4f534a);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  const binHead = 20 + jl; assert.equal(dv.getUint32(binHead + 4, true), 0x004e4942);
  const binLen = dv.getUint32(binHead, true); assert.equal(binHead + 8 + binLen, buf.byteLength);
  assert.equal(json.buffers[0].byteLength, binLen);
  for (const bv of json.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= binLen);
  assert.equal(json.accessors[0].count, m.positions.length / 3);
  assert.equal(json.accessors[3].count, m.indices.length);
  const idxOff = binHead + 8 + json.bufferViews[3].byteOffset;
  for (let i = 0; i < 30; i++) assert.ok(dv.getUint32(idxOff + i * 4, true) < json.accessors[0].count);
  assert.ok(json.accessors[0].min.every(Number.isFinite) && json.accessors[0].max.every(Number.isFinite));
});

test('OBJ and PLY mesh exporters write one record per vertex and face', () => {
  const { hull } = demoHull('mug', 48, 24);
  const m = buildMesh(hull, 0), rgb = new Uint8Array(m.positions.length).fill(200);
  const obj = toOBJMesh(m, rgb).split('\n'), ply = toPLYTriMesh(m, rgb).split('\n');
  assert.equal(obj.filter((l) => l.startsWith('v ')).length, m.positions.length / 3);
  assert.equal(obj.filter((l) => l.startsWith('f ')).length, m.indices.length / 3);
  assert.ok(ply.includes(`element face ${m.indices.length / 3}`));
  assert.equal(ply.filter((l) => l.startsWith('3 ')).length, m.indices.length / 3);
});
