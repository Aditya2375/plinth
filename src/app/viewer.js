import * as THREE from '../../vendor/three.module.min.js';
import { OrbitControls } from '../../vendor/OrbitControls.js';

const PAPER = 0xecebe5;

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAPER);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(4.6, 2.9, 5.7);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.5; this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.target.set(0, -0.78, 0);
    this.controls.autoRotate = true; this.controls.autoRotateSpeed = 0.9;
    canvas.addEventListener('pointerdown', () => { this.controls.autoRotate = false; });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b3a6, 1.55));
    const sun = new THREE.DirectionalLight(0xfff4e4, 2.1); sun.position.set(3, 5, 2.5); this.scene.add(sun);
    this.buildFloor();
    this.camMarks = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5a1f }));
    this.scene.add(this.camMarks);
    this.smooth = null; this.mesh = null; this.cap = 0; this.dummy = new THREE.Object3D();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.loop = this.loop.bind(this); requestAnimationFrame(this.loop);
  }
  buildFloor() {
    const y = -1.08, g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 96), new THREE.MeshBasicMaterial({ color: 0xe0ded6 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = y - 0.002; g.add(disc);
    const ink = new THREE.LineBasicMaterial({ color: 0x15171a, transparent: true, opacity: 0.55 });
    const ring = (r) => { const p = []; for (let i = 0; i <= 180; i++) { const a = (i / 180) * Math.PI * 2; p.push(Math.cos(a) * r, y, Math.sin(a) * r); } const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return new THREE.Line(geo, ink); };
    g.add(ring(1.5)); g.add(ring(1.2));
    const t = [];
    for (let d = 0; d < 360; d += 5) { const a = (d * Math.PI) / 180, l = d % 30 === 0 ? 0.14 : 0.06; t.push(Math.cos(a) * 1.5, y, Math.sin(a) * 1.5, Math.cos(a) * (1.5 - l), y, Math.sin(a) * (1.5 - l)); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
    g.add(new THREE.LineSegments(tg, ink));
    this.scene.add(g);
  }
  resize() {
    const p = this.canvas.parentElement, w = Math.max(2, p.clientWidth), h = Math.max(2, p.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the object comfortably framed in narrow viewers.
    this.camera.fov = w / h < 0.9 ? 44 : 30;
    this.camera.updateProjectionMatrix();
  }
  // surf: Int32Array (x,y,z index triples), colors: Uint8Array rgb or null for matte
  setVoxels(hull, surf, colors) {
    const n = surf.length / 3;
    if (!this.mesh || this.cap < n || this.res !== hull.res) {
      if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.dispose(); }
      this.cap = Math.max(1024, Math.ceil(n * 1.3), 6 * hull.res * hull.res);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0, flatShading: true });
      this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.cap);
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
      this.mesh.frustumCulled = false;
      this.scene.add(this.mesh); this.res = hull.res;
    }
    const d = this.dummy, s = hull.size, c = new THREE.Color();
    d.scale.set(s * 1.0, s * 1.0, s * 1.0);
    for (let i = 0; i < n; i++) {
      const ctr = hull.center(surf[i * 3], surf[i * 3 + 1], surf[i * 3 + 2]);
      d.position.set(ctr[0], ctr[1], ctr[2]); d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix);
      if (colors) c.setRGB(colors[i * 3] / 255, colors[i * 3 + 1] / 255, colors[i * 3 + 2] / 255, THREE.SRGBColorSpace);
      else c.setRGB(0.62, 0.6, 0.57, THREE.SRGBColorSpace);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  // m = { positions, indices, normals }, colors = Uint8Array rgb per vertex or null (matte)
  setSmooth(m, colors) {
    if (this.smooth) { this.scene.remove(this.smooth); this.smooth.geometry.dispose(); this.smooth.material.dispose(); this.smooth = null; }
    if (!m) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    const c = new Float32Array(m.positions.length), col = new THREE.Color();
    for (let i = 0; i < c.length; i += 3) {
      if (colors) col.setRGB(colors[i] / 255, colors[i + 1] / 255, colors[i + 2] / 255, THREE.SRGBColorSpace); else col.setRGB(0.62, 0.6, 0.57, THREE.SRGBColorSpace);
      c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    this.smooth = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }));
    this.smooth.frustumCulled = false;
    this.scene.add(this.smooth);
  }
  // which = 'smooth' | 'voxels'
  show(which) {
    const smooth = which === 'smooth' && !!this.smooth;
    if (this.smooth) this.smooth.visible = smooth;
    if (this.mesh) this.mesh.visible = !smooth;
  }
  setCameraMarks(cams, used) {
    const p = [];
    for (let i = 0; i < cams.length; i++) {
      if (i >= used) continue;
      const c = cams[i], k = 1.3 / Math.hypot(...c.pos);
      p.push(c.pos[0] * k, c.pos[1] * k - 0.0, c.pos[2] * k, c.pos[0] * k * 0.9, c.pos[1] * k * 0.9, c.pos[2] * k * 0.9);
    }
    // Marks sit on the floor ring so they read as compass ticks, one per photo.
    const q = [];
    for (let i = 0; i < p.length; i += 6) {
      const a = Math.atan2(p[i], p[i + 2]);
      q.push(Math.sin(a) * 1.5, -1.08, Math.cos(a) * 1.5, Math.sin(a) * 1.72, -1.08, Math.cos(a) * 1.72);
    }
    this.camMarks.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(q, 3)); this.camMarks.geometry = g;
  }
  loop() { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(this.loop); }
}
