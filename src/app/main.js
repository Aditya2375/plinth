import { turntableCameras } from '../core/camera.js';
import { segment, maskIoU } from '../core/segment.js';
import { Hull, surface, normals, colorize, colorizePoints, iou } from '../core/carve.js';
import { buildMesh, isWatertight } from '../core/mesh.js';
import { renderView, objectNames, objectInfo, inside, distance } from '../core/synth.js';
import { toPLYPoints, toOBJMesh, toPLYTriMesh, toGLB } from '../core/export.js';
import { Viewer } from './viewer.js';
import { buildSplats, toSplat, toGaussianPLY } from '../core/splat.js';
import { recordSlice, drawSlice } from './slice.js';
import { framesFromImages, framesFromVideo } from './loaders.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const DEMO = { elevation: [0.15, 0.62], distance: 3.4, fov: 44 * DEG, size: 128 };

const S = {
  mode: 'demo', object: 'teapot', count: 36, res: 96, tol: 0, shape: 'splats', splats: null, mesh: null, meshK: -1, meshRgb: null,
  views: [], cams: [], k: 0, hull: null, surf: null, colors: null, nrm: null,
  matte: false, token: 0, playTimer: 0, rec: null, user: { frames: null, elev: 20, fov: 44, dist: 3.4, sens: 1 },
};
let viewer;
const SPLATS = 60000;
const fmt = (n) => n.toLocaleString('en-US');
const busy = (on, text) => { $('busy').hidden = !on; if (text) $('busyText').textContent = text; };
const tick = () => new Promise((r) => setTimeout(r));
const say = (t) => { $('status').textContent = t || ''; };

function drawThumb(canvas, v, used, sel) {
  const g = canvas.getContext('2d');
  canvas.width = v.img.width; canvas.height = v.img.height;
  g.putImageData(new ImageData(new Uint8ClampedArray(v.img.data), v.img.width, v.img.height), 0, 0);
  // silhouette edge in orange
  const o = g.getImageData(0, 0, canvas.width, canvas.height), w = canvas.width, h = canvas.height, m = v.mask;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w])) { o.data[i * 4] = 255; o.data[i * 4 + 1] = 90; o.data[i * 4 + 2] = 31; }
  }
  g.putImageData(o, 0, 0);
}

function buildSheet() {
  const box = $('thumbs'); box.replaceChildren();
  S.views.forEach((v, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'thumb'; b.dataset.i = i;
    const c = document.createElement('canvas'); drawThumb(c, v);
    const t = document.createElement('div'); t.className = 't';
    const a = document.createElement('span'); a.textContent = String(i + 1).padStart(2, '0');
    const d = document.createElement('span'); d.textContent = Math.round((360 * i) / S.views.length) + '\u00b0';
    t.append(a, d); b.append(c, t);
    b.addEventListener('click', () => { stopPlay(); setK(i + 1, true); });
    box.append(b);
  });
}
function markSheet() {
  [...$('thumbs').children].forEach((b, i) => { b.classList.toggle('off', i >= S.k); b.classList.toggle('sel', i === S.k - 1); });
  $('sheetCount').textContent = `${S.k} / ${S.views.length}`;
}

async function loadDemo() {
  const my = ++S.token; stopPlay();
  busy(true, 'Photographing ' + objectInfo(S.object).label); say('');
  const cams = turntableCameras(S.count, { elevation: DEMO.elevation, distance: DEMO.distance, fov: DEMO.fov, width: DEMO.size, height: DEMO.size });
  const views = [];
  for (let i = 0; i < cams.length; i++) {
    const img = renderView(S.object, cams[i], { noise: 4, seed: i + 1 });
    const { mask } = segment(img.data, img.width, img.height);
    views.push({ img, mask, truth: img.truth });
    if (i % 3 === 2) { await tick(); if (my !== S.token) return; }
  }
  S.cams = cams; S.views = views; S.mode = 'demo';
  afterLoad();
}

function userCams() {
  const f = S.user.frames;
  return turntableCameras(f.length, { elevation: S.user.elev * DEG, distance: S.user.dist, fov: S.user.fov * DEG, width: f[0].width, height: f[0].height });
}
function buildUserViews() {
  S.cams = userCams();
  S.views = S.user.frames.map((img) => ({ img, mask: segment(img.data, img.width, img.height, { sensitivity: S.user.sens }).mask, truth: null }));
}

function afterLoad() {
  S.rec = null; clearInterval(sliceTimer);
  $('views').max = String(S.views.length);
  buildSheet(); viewer.setCameraMarks(S.cams, 0);
  const demo = S.mode === 'demo';
  $('gtRow').hidden = !demo; $('gtRow2').hidden = !demo; $('gtRow3').hidden = !demo;
  $('statsNote').textContent = demo ? 'Scored against the exact shape the photos were drawn from.' : 'No ground truth for your own photos. Check the orange outlines on the contact sheet instead.';
  $('subjectNote').textContent = demo ? objectInfo(S.object).note : 'Showing your own object.';
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', demo && c.dataset.name === S.object));
  $('count').disabled = !demo; $('backDemo').hidden = demo;
  busy(false);
  recomputeHull(0); updateAll(0);
  if (sliceSeen) { ensureSlice(); showSlice(S.views.length); }
  play();
}

// ---- carving -------------------------------------------------------------
function recomputeHull(k) {
  S.hull = new Hull(S.res); S.k = 0;
  for (let i = 0; i < k; i++) { S.hull.addView(S.cams[i], S.views[i].mask, S.tol); S.k++; }
}
function stepHull() { S.hull.addView(S.cams[S.k], S.views[S.k].mask, S.tol); S.k++; }

function applyShape() {
  const fresh = S.mesh && S.meshK === S.k && S.k > 0;
  viewer.show(fresh ? S.shape : 'voxels');
}

function updateAll(delayColor) {
  const h = S.hull, total = h.res ** 3, left = h.count(S.tol);
  S.surf = surface(h, S.tol);
  viewer.setVoxels(h, S.surf, S.matte ? null : S.colors && S.colors.k === S.k ? S.colors.rgb : null);
  viewer.setCameraMarks(S.cams, S.k);
  applyShape();
  $('rVox').textContent = fmt(left);
  const drop = S.k === 0 ? null : (1 - left / total) * 100;
  $('rDrop').textContent = drop === null ? 'solid block' : `${drop.toFixed(1)}% of the block cut away`;
  $('views').value = S.k; $('viewsNum').textContent = `${S.k} / ${S.views.length}`;
  $('sVol').textContent = (h.volume(S.tol)).toFixed(3); $('sSurf').textContent = fmt(S.surf.length / 3);
  markSheet();
  if (delayColor !== undefined) scheduleSettle();
}

let settleTimer = 0;
function scheduleSettle() { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 220); }
function settle() {
  if (S.k === 0) { $('sIou').textContent = '-'; $('sMask').textContent = '-'; $('sErr').textContent = '-'; $('sTris').textContent = '-'; return; }
  const my = S.token, h = S.hull;
  S.nrm = normals(h, S.surf, S.tol);
  const used = S.cams.slice(0, S.k), imgs = S.views.slice(0, S.k).map((v) => v.img);
  const rgb = colorize(h, S.surf, S.nrm, used, imgs);
  if (my !== S.token) return;
  S.colors = { k: S.k, rgb };
  if (!S.matte) viewer.setVoxels(h, S.surf, rgb);
  buildSmooth();
  if (S.mode === 'demo') {
    const res = h.res, truth = new Uint8Array(res ** 3);
    for (let z = 0; z < res; z++) for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const c = h.center(x, y, z); truth[h.index(x, y, z)] = inside(S.object, c[0], c[1], c[2]) ? 1 : 0; }
    $('sIou').textContent = (iou(h.alive(S.tol), truth) * 100).toFixed(1) + '%';
    let a = 0; for (let i = 0; i < S.k; i++) a += maskIoU(S.views[i].mask, S.views[i].truth);
    $('sMask').textContent = ((a / S.k) * 100).toFixed(1) + '%';
  }
}

let splatTimer = 0;
function ensureSplats() {
  if (S.splats && S.splatsK === S.k) return;
  ensureMesh();
  S.splats = buildSplats(S.mesh, S.cams.slice(0, S.k), S.views.slice(0, S.k).map((v) => v.img), { count: SPLATS, slack: S.hull.size * 1.75 });
  S.splatsK = S.k; viewer.setSplats(S.splats, S.matte); applyShape();
}
function buildSmooth() {
  const h = S.hull, my = S.token;
  const m = buildMesh(h, S.tol);
  const rgb = colorizePoints(m.positions, m.normals, S.cams.slice(0, S.k), S.views.slice(0, S.k).map((v) => v.img), h.size * 1.75);
  if (my !== S.token) return;
  S.mesh = m; S.meshK = S.k; S.meshRgb = rgb;
  viewer.setSmooth(m, S.matte ? null : rgb);
  S.splats = null; S.splatsK = -1; viewer.setSplats(null);
  clearTimeout(splatTimer); splatTimer = setTimeout(() => { if (my === S.token) ensureSplats(); }, 900);
  applyShape();
  $('sTris').textContent = `${fmt(m.indices.length / 3)} tris, ${isWatertight(m) ? 'closed' : 'open edges'}`;
  if (S.mode === 'demo') {
    let e = 0; const n = m.positions.length / 3;
    for (let i = 0; i < n; i++) e += distance(S.object, m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
    $('sErr').textContent = ((e / n) * 100).toFixed(2) + '% of radius';
  }
}

function setK(k, fromUser) {
  k = Math.max(0, Math.min(S.views.length, k));
  if (k === S.k + 1) stepHull(); else if (k !== S.k) recomputeHull(k);
  updateAll(1);
}
function stopPlay() { clearInterval(S.playTimer); S.playTimer = 0; }
function play() {
  stopPlay(); recomputeHull(0); updateAll(1); viewer.controls.autoRotate = true;
  const total = S.views.length, ms = Math.max(60, Math.min(170, 5200 / total));
  S.playTimer = setInterval(() => { if (S.k >= total) { stopPlay(); return; } stepHull(); updateAll(); if (S.k >= total) { stopPlay(); scheduleSettle(); } }, ms);
}

let sliceK = 0, sliceTimer = 0, sliceSeen = false;
function showSlice(k) { sliceK = k; $('sliceK').value = k; if (S.rec) drawSlice($('slice'), S.rec, k, $('sliceCap')); }
function ensureSlice() {
  if (!S.views.length) return;
  if (!S.rec) { S.rec = recordSlice(S.cams, S.views.map((v) => v.mask), 64, S.tol); $('sliceK').max = String(S.views.length); showSlice(sliceSeen ? S.views.length : 0); }
}
function playSlice() {
  ensureSlice(); clearInterval(sliceTimer); showSlice(0); sliceSeen = true;
  sliceTimer = setInterval(() => { if (sliceK >= S.views.length) { clearInterval(sliceTimer); return; } showSlice(sliceK + 1); }, 170);
}

// ---- own photos ------------------------------------------------------------
async function useFiles(files) {
  const list = [...files]; if (!list.length) return;
  const msg = $('ownMsg'); msg.textContent = '';
  try {
    stopPlay(); busy(true, 'Reading your files');
    const videos = list.filter((f) => f.type.startsWith('video/'));
    let frames;
    if (videos.length) {
      if (list.length > 1) throw new Error('Drop one video, or a set of photos, not both.');
      frames = await framesFromVideo(videos[0], 36, (i, n) => { $('busyText').textContent = `Reading frame ${i} of ${n}`; });
    } else frames = await framesFromImages(list, (i, n) => { $('busyText').textContent = `Reading photo ${i} of ${n}`; });
    S.user.frames = frames; S.mode = 'user'; S.token++;
    buildUserViews(); afterLoad();
    msg.textContent = `${frames.length} frames read. Check the orange outlines on the contact sheet; if they miss parts of the object, change Mask sensitivity.`;
    $('viewer').scrollIntoView?.();
  } catch (e) { busy(false); msg.textContent = e.message || 'Could not read those files.'; if (S.views.length) { if (S.mode === 'demo') afterLoad(); } }
}
function rerunUser() {
  if (S.mode !== 'user') return;
  clearTimeout(rerunUser.t);
  rerunUser.t = setTimeout(() => { stopPlay(); buildUserViews(); const k = S.views.length; afterLoad(); stopPlay(); recomputeHull(k); updateAll(1); }, 250);
}

// ---- export ----------------------------------------------------------------
function save(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function ensureColors() {
  if (S.colors && S.colors.k === S.k) return S.colors.rgb;
  S.nrm = normals(S.hull, S.surf, S.tol);
  const rgb = colorize(S.hull, S.surf, S.nrm, S.cams.slice(0, S.k), S.views.slice(0, S.k).map((v) => v.img));
  S.colors = { k: S.k, rgb }; return rgb;
}
function ensureMesh() { if (!S.mesh || S.meshK !== S.k) buildSmooth(); }
const base = () => 'plinth-' + (S.mode === 'demo' ? S.object : 'scan');
function exportable() { if (S.k < 3) { say('Use at least three views before exporting.'); return false; } return true; }

// ---- wiring ------------------------------------------------------------------
function init() {
  viewer = new Viewer($('gl'));
  const subj = $('subjects');
  for (const n of objectNames) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.name = n; b.textContent = objectInfo(n).label;
    b.addEventListener('click', () => { S.object = n; S.mode = 'demo'; loadDemo(); });
    subj.append(b);
  }
  $('play').addEventListener('click', play);
  $('views').addEventListener('input', (e) => { stopPlay(); viewer.controls.autoRotate = false; setK(Number(e.target.value), true); });
  $('mColor').addEventListener('click', () => { S.matte = false; $('mColor').classList.add('on'); $('mMatte').classList.remove('on'); updateAll(1); if (S.mesh && S.meshK === S.k) { viewer.setSmooth(S.mesh, S.meshRgb); if (S.splats) viewer.setSplats(S.splats, false); } applyShape(); });
  $('mMatte').addEventListener('click', () => { S.matte = true; $('mMatte').classList.add('on'); $('mColor').classList.remove('on'); updateAll(); if (S.mesh && S.meshK === S.k) { viewer.setSmooth(S.mesh, null); if (S.splats) viewer.setSplats(S.splats, true); } applyShape(); });
  const setShape = (sh) => { S.shape = sh; for (const [id, k] of [['sSplats', 'splats'], ['sSmooth', 'smooth'], ['sVoxels', 'voxels']]) { $(id).classList.toggle('on', sh === k); $(id).setAttribute('aria-pressed', sh === k); } applyShape(); };
  $('sSplats').addEventListener('click', () => setShape('splats')); $('sSmooth').addEventListener('click', () => setShape('smooth')); $('sVoxels').addEventListener('click', () => setShape('voxels'));
  $('count').addEventListener('input', (e) => { $('countNum').textContent = e.target.value; });
  $('count').addEventListener('change', (e) => { S.count = Number(e.target.value); loadDemo(); });
  $('res').addEventListener('change', (e) => { S.res = Number(e.target.value); S.rec = null; const k = S.views.length; stopPlay(); recomputeHull(k); updateAll(1); if (sliceSeen) { ensureSlice(); showSlice(S.views.length); } });
  $('tol').addEventListener('input', (e) => { $('tolNum').textContent = e.target.value; S.tol = Number(e.target.value); S.rec = null; const k = S.k; stopPlay(); recomputeHull(k); updateAll(1); if (sliceSeen) { ensureSlice(); showSlice(S.views.length); } });
  $('xPoints').addEventListener('click', () => { if (!exportable()) return; const rgb = ensureColors(); save(base() + '-points.ply', toPLYPoints(S.hull, S.surf, rgb)); });
  $('xMesh').addEventListener('click', () => { if (!exportable()) return; ensureMesh(); save(base() + '-mesh.ply', toPLYTriMesh(S.mesh, S.meshRgb)); });
  $('xObj').addEventListener('click', () => { if (!exportable()) return; ensureMesh(); save(base() + '.obj', toOBJMesh(S.mesh, S.meshRgb)); });
  $('xSplat').addEventListener('click', () => { if (!exportable()) return; ensureSplats(); save(base() + '.splat', toSplat(S.splats), 'application/octet-stream'); });
  $('xGs').addEventListener('click', () => { if (!exportable()) return; ensureSplats(); save(base() + '-gaussians.ply', toGaussianPLY(S.splats), 'application/octet-stream'); });
  $('xGlb').addEventListener('click', () => { if (!exportable()) return; ensureMesh(); save(base() + '.glb', toGLB(S.mesh, S.meshRgb), 'model/gltf-binary'); });

  const drop = $('drop'), file = $('file');
  drop.addEventListener('click', (e) => { if (e.target !== file) file.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { useFiles(file.files); file.value = ''; });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => useFiles(e.dataTransfer.files));
  const bind = (id, key, scale, outId, show) => $(id).addEventListener('input', (e) => { S.user[key] = Number(e.target.value) * scale; $(outId).textContent = show(S.user[key]); rerunUser(); });
  bind('fElev', 'elev', 1, 'fElevN', (v) => v + '\u00b0'); bind('fFov', 'fov', 1, 'fFovN', (v) => v + '\u00b0');
  bind('fDist', 'dist', 0.1, 'fDistN', (v) => v.toFixed(1)); bind('fSens', 'sens', 0.01, 'fSensN', (v) => v.toFixed(1));
  $('backDemo').addEventListener('click', () => { S.mode = 'demo'; loadDemo(); });

  $('slicePlay').addEventListener('click', playSlice);
  $('sliceK').addEventListener('input', (e) => { clearInterval(sliceTimer); ensureSlice(); sliceSeen = true; showSlice(Number(e.target.value)); });
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !sliceSeen && S.views.length) playSlice(); }, { threshold: 0.4 });
  io.observe($('method'));
  loadDemo();
}
init();
// Test hook: lets the browser check read state without exposing mutators.
window.__plinth = { get state() { return { mode: S.mode, k: S.k, views: S.views.length, voxels: S.hull ? S.hull.count(S.tol) : 0, meshFresh: !!S.mesh && S.meshK === S.k, tris: S.mesh ? S.mesh.indices.length / 3 : 0, shape: S.shape }; } };
