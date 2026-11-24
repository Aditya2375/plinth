import * as THREE from '../../vendor/three.module.min.js';
import { covariance } from '../core/splat.js';

// Draws gaussians as screen-space ellipses (EWA splatting), sorted back to front.
const VERT = `
precision highp float;
attribute vec2 corner;
attribute vec3 center;
attribute vec3 covA;   // xx xy xz
attribute vec3 covB;   // yy yz zz
attribute vec3 tint;
uniform vec2 viewport;
uniform vec2 focal;
varying vec3 vTint;
varying vec2 vPos;
void main() {
  vec4 cam = modelViewMatrix * vec4(center, 1.0);
  vec4 clip = projectionMatrix * cam;
  if (cam.z > -0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float limx = 1.3 * clip.w, limy = 1.3 * clip.w;
  if (abs(clip.x) > limx * 1.4 || abs(clip.y) > limy * 1.4) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  mat3 V = mat3(modelViewMatrix);
  mat3 S = mat3(covA.x, covA.y, covA.z, covA.y, covB.x, covB.y, covA.z, covB.y, covB.z);
  float z = -cam.z;
  mat3 J = mat3(focal.x / z, 0.0, 0.0,
                0.0, focal.y / z, 0.0,
                focal.x * cam.x / (z * z), focal.y * cam.y / (z * z), 0.0);
  mat3 T = J * V;
  mat3 C = T * S * transpose(T);
  float a = C[0][0] + 0.3, b = C[0][1], d = C[1][1] + 0.3;
  float mid = 0.5 * (a + d);
  float rad = length(vec2(0.5 * (a - d), b));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  float th = 0.5 * atan(2.0 * b, a - d);
  vec2 ax1 = vec2(cos(th), sin(th));
  vec2 ax2 = vec2(-ax1.y, ax1.x);
  vec2 m1 = min(sqrt(2.0 * l1), 1024.0) * ax1;
  vec2 m2 = min(sqrt(2.0 * l2), 1024.0) * ax2;
  vTint = tint;
  vPos = corner * 2.0;
  vec2 off = (corner.x * m1 + corner.y * m2) * 4.0 / viewport;
  gl_Position = vec4(clip.xy / clip.w + off, clip.z / clip.w, 1.0);
}`;
const FRAG = `
precision highp float;
varying vec3 vTint;
varying vec2 vPos;
void main() {
  float A = -dot(vPos, vPos);
  if (A < -4.0) discard;
  float alpha = exp(A) * 0.97;
  gl_FragColor = vec4(vTint * alpha, alpha);
}`;

export class SplatLayer {
  constructor(scene, camera, renderer) {
    this.scene = scene; this.camera = camera; this.renderer = renderer;
    this.mesh = null; this.data = null; this.order = null; this.lastDir = new THREE.Vector3(); this.lastSort = 0;
  }
  set(s, matteRgb) {
    this.dispose();
    const n = s.n, cov = new Float32Array(6);
    this.data = { n, pos: s.pos, covs: new Float32Array(n * 6), rgb: matteRgb || s.rgb, sorted: false };
    for (let i = 0; i < n; i++) { covariance(s, i, cov); this.data.covs.set(cov, i * 6); }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = {
      center: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      covA: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      covB: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
      tint: new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
    };
    for (const k in this.buf) { this.buf[k].setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, this.buf[k]); }
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: { viewport: { value: new THREE.Vector2(1, 1) }, focal: { value: new THREE.Vector2(1, 1) } },
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.visible = false;
    this.mesh.onBeforeRender = () => this.update();
    this.scene.add(this.mesh);
    this.order = new Uint32Array(n); for (let i = 0; i < n; i++) this.order[i] = i;
    this.lastSort = 0; this.lastDir.set(0, 0, 0);
  }
  setVisible(v) { if (this.mesh) this.mesh.visible = v; }
  get visible() { return !!this.mesh && this.mesh.visible; }
  update() {
    if (!this.mesh || !this.data) return;
    const cam = this.camera, size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const u = this.mesh.material.uniforms;
    u.viewport.value.copy(size);
    const f = size.y / (2 * Math.tan((cam.fov * Math.PI) / 360));
    u.focal.value.set(f, f);
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const now = performance.now();
    if (dir.distanceTo(this.lastDir) > 0.004 && now - this.lastSort > 40 || !this.data.sorted) this.sort(cam, dir, now);
  }
  sort(cam, dir, now) {
    const { n, pos, covs, rgb } = this.data, o = this.order;
    const d = new Float32Array(n), cp = cam.position;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const v = (pos[i * 3] - cp.x) * dir.x + (pos[i * 3 + 1] - cp.y) * dir.y + (pos[i * 3 + 2] - cp.z) * dir.z; d[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
    const B = 65536, cnt = new Uint32Array(B + 1), k = (B - 1) / Math.max(1e-6, mx - mn);
    const key = new Uint16Array(n);
    for (let i = 0; i < n; i++) { key[i] = Math.floor((mx - d[i]) * k); cnt[key[i] + 1]++; } // far first
    for (let i = 0; i < B; i++) cnt[i + 1] += cnt[i];
    for (let i = 0; i < n; i++) o[cnt[key[i]]++] = i;
    const b = this.buf;
    for (let j = 0; j < n; j++) {
      const i = o[j];
      b.center.array[j * 3] = pos[i * 3]; b.center.array[j * 3 + 1] = pos[i * 3 + 1]; b.center.array[j * 3 + 2] = pos[i * 3 + 2];
      b.covA.array[j * 3] = covs[i * 6]; b.covA.array[j * 3 + 1] = covs[i * 6 + 1]; b.covA.array[j * 3 + 2] = covs[i * 6 + 2];
      b.covB.array[j * 3] = covs[i * 6 + 3]; b.covB.array[j * 3 + 1] = covs[i * 6 + 4]; b.covB.array[j * 3 + 2] = covs[i * 6 + 5];
      b.tint.array[j * 3] = rgb[i * 3] / 255; b.tint.array[j * 3 + 1] = rgb[i * 3 + 1] / 255; b.tint.array[j * 3 + 2] = rgb[i * 3 + 2] / 255;
    }
    for (const kk in b) b[kk].needsUpdate = true;
    this.lastDir.copy(dir); this.lastSort = now; this.data.sorted = true;
  }
  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh = null; }
    this.data = null;
  }
}
