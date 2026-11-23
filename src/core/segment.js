// Background-subtraction segmentation for photos of one object on a plain
// backdrop. Input is RGBA pixel data; output is a Uint8Array mask (1 = object).

export function segment(rgba, width, height, opts = {}) {
  const n = width * height;
  const dist = new Float32Array(n);
  const bg = estimateBackground(rgba, width, height);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = rgba[o] - bg[0], dg = rgba[o + 1] - bg[1], db = rgba[o + 2] - bg[2];
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  // Threshold from the backdrop's own noise: mean + 5 sigma of the border
  // distances, never below a floor. Otsu is only a cap for very busy backdrops.
  const floor = opts.minThreshold ?? 20;
  const noise = borderStats(dist, width, height);
  let t = Math.max(floor, noise.mean + 5 * noise.sigma);
  t = Math.min(t, Math.max(floor, otsu(dist)));
  t *= opts.sensitivity ?? 1;
  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = dist[i] > t ? 1 : 0;
  mask = open(mask, width, height);
  mask = fillHoles(mask, width, height);
  mask = largestComponent(mask, width, height);
  return { mask, threshold: t, background: bg };
}

// Median colour of a one-pixel-wide frame, taken in three channels. A frame
// of ~4% of the shorter side is used so a tilted backdrop still votes.
export function estimateBackground(rgba, width, height) {
  const b = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const r = [], g = [], bl = [];
  const take = (x, y) => { const o = (y * width + x) * 4; r.push(rgba[o]); g.push(rgba[o + 1]); bl.push(rgba[o + 2]); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < b || y < b || x >= width - b || y >= height - b) { if ((x + y) % 3 === 0) take(x, y); }
  }
  return [median(r), median(g), median(bl)];
}

function borderStats(dist, width, height) {
  const b = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  let n = 0, s = 0, q = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < b || y < b || x >= width - b || y >= height - b) { const d = dist[y * width + x]; n++; s += d; q += d * d; }
  }
  const mean = s / n;
  return { mean, sigma: Math.sqrt(Math.max(0, q / n - mean * mean)) };
}

function median(a) { a.sort((x, y) => x - y); return a[a.length >> 1]; }

export function otsu(values) {
  const bins = 128; let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (max <= 0) return 0;
  const hist = new Float64Array(bins);
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.floor((values[i] / max) * bins))]++;
  const total = values.length;
  let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = 0, bestT = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = i; }
  }
  return ((bestT + 1) / bins) * max;
}

export function erode(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (m[i] && m[i - 1] && m[i + 1] && m[i - w] && m[i + w]) o[i] = 1;
  }
  return o;
}

export function dilate(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m[i] || (x > 0 && m[i - 1]) || (x < w - 1 && m[i + 1]) || (y > 0 && m[i - w]) || (y < h - 1 && m[i + w])) o[i] = 1;
  }
  return o;
}

function open(m, w, h) { return dilate(erode(m, w, h), w, h); }

// Fills only small enclosed gaps (speckle, highlights). Large enclosed gaps,
// such as the space between a stool's legs or a mug handle, are real geometry.
function fillHoles(m, w, h, maxFraction = 0.0025) {
  const limit = Math.max(4, Math.floor(m.length * maxFraction));
  const seen = new Uint8Array(m.length);
  const o = Uint8Array.from(m);
  const stack = [];
  for (let s = 0; s < m.length; s++) {
    if (m[s] || seen[s]) continue;
    const comp = []; let touches = false;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const tp = (j) => { if (!m[j] && !seen[j]) { seen[j] = 1; stack.push(j); } };
      if (x > 0) tp(i - 1); if (x < w - 1) tp(i + 1);
      if (y > 0) tp(i - w); if (y < h - 1) tp(i + w);
    }
    if (!touches && comp.length <= limit) for (const i of comp) o[i] = 1;
  }
  return o;
}

function largestComponent(m, w, h) {
  const label = new Int32Array(m.length);
  let best = 0, bestSize = 0, next = 0;
  const stack = [];
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || label[s]) continue;
    next++; let size = 0; stack.push(s); label[s] = next;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % w, y = (i / w) | 0;
      const tryPush = (j) => { if (m[j] && !label[j]) { label[j] = next; stack.push(j); } };
      if (x > 0) tryPush(i - 1); if (x < w - 1) tryPush(i + 1);
      if (y > 0) tryPush(i - w); if (y < h - 1) tryPush(i + w);
    }
    if (size > bestSize) { bestSize = size; best = next; }
  }
  const o = new Uint8Array(m.length);
  if (best) for (let i = 0; i < m.length; i++) o[i] = label[i] === best ? 1 : 0;
  return o;
}

export function maskIoU(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ? 1 : 0, y = b[i] ? 1 : 0; inter += x & y; uni += x | y; }
  return uni ? inter / uni : 1;
}
