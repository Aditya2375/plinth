// Turns user files into equally sized RGBA frames. Everything stays in memory
// in this tab; nothing is sent over the network.
export const LIMITS = { maxImages: 120, minImages: 6, maxImageBytes: 30 * 1024 * 1024, maxVideoBytes: 200 * 1024 * 1024, maxSide: 192 };

function naturalSort(a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); }

function fit(w, h) { const s = Math.min(1, LIMITS.maxSide / Math.max(w, h)); return [Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s))]; }

function grab(source, sw, sh, W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, sw, sh, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H);
  return { data: d.data, width: W, height: H };
}

export async function framesFromImages(files, onProgress) {
  const list = [...files].filter((f) => f.type.startsWith('image/')).sort(naturalSort);
  if (list.length < LIMITS.minImages) throw new Error(`Need at least ${LIMITS.minImages} photos, got ${list.length}.`);
  if (list.length > LIMITS.maxImages) throw new Error(`At most ${LIMITS.maxImages} photos, got ${list.length}.`);
  const frames = []; let W = 0, H = 0, ratio = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.size > LIMITS.maxImageBytes) throw new Error(`${f.name} is larger than 30 MB.`);
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { throw new Error(`${f.name} could not be read as an image.`); }
    if (i === 0) { [W, H] = fit(bmp.width, bmp.height); ratio = bmp.width / bmp.height; }
    else if (Math.abs(bmp.width / bmp.height - ratio) / ratio > 0.03) { bmp.close(); throw new Error(`${f.name} has a different shape from the first photo. Crop all photos the same way.`); }
    frames.push(grab(bmp, bmp.width, bmp.height, W, H)); bmp.close();
    onProgress?.(i + 1, list.length);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  return frames;
}

export async function framesFromVideo(file, count, onProgress) {
  if (file.size > LIMITS.maxVideoBytes) throw new Error('Video is larger than 200 MB.');
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video could not be decoded by your browser.')); });
    if (!isFinite(v.duration) || v.duration < 1) throw new Error('The video is too short or has no length.');
    const [W, H] = fit(v.videoWidth, v.videoHeight);
    const frames = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(v.duration - 0.05, (v.duration * i) / count + 0.02);
      await new Promise((res, rej) => { v.onseeked = res; v.onerror = () => rej(new Error('Seeking in the video failed.')); v.currentTime = t; });
      frames.push(grab(v, v.videoWidth, v.videoHeight, W, H));
      onProgress?.(i + 1, count);
    }
    return frames;
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
