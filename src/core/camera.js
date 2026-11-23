// Turntable camera model. The object sits at the origin (Y is up) and the
// camera orbits it. All lengths are in object units; the object is assumed to
// fit inside a sphere of radius 1.

export function makeCamera({ azimuth, elevation, distance, fov, width, height }) {
  const ce = Math.cos(elevation);
  const pos = [distance * ce * Math.sin(azimuth), distance * Math.sin(elevation), distance * ce * Math.cos(azimuth)];
  const f = norm([-pos[0], -pos[1], -pos[2]]);
  const right = norm(cross(f, [0, 1, 0]));
  const up = cross(right, f);
  const focal = (width / 2) / Math.tan(fov / 2);
  return { pos, f, right, up, focal, cx: width / 2, cy: height / 2, width, height };
}

// `elevation` may be one angle or an array; an array is cycled view by view,
// which gives a second ring of viewpoints and constrains the hull better.
export function turntableCameras(count, { elevation, distance, fov, width, height }) {
  const cams = [];
  const rings = Array.isArray(elevation) ? elevation : [elevation];
  for (let i = 0; i < count; i++) {
    cams.push(makeCamera({ azimuth: (2 * Math.PI * i) / count, elevation: rings[i % rings.length], distance, fov, width, height }));
  }
  return cams;
}

// Returns [u, v, depth]. depth is the distance along the optical axis.
export function project(cam, x, y, z) {
  const dx = x - cam.pos[0], dy = y - cam.pos[1], dz = z - cam.pos[2];
  const xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
  const yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
  const zc = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
  return [cam.cx + (cam.focal * xc) / zc, cam.cy - (cam.focal * yc) / zc, zc];
}

export function rayDir(cam, u, v) {
  const a = (u - cam.cx) / cam.focal, b = -(v - cam.cy) / cam.focal;
  return norm([
    cam.f[0] + a * cam.right[0] + b * cam.up[0],
    cam.f[1] + a * cam.right[1] + b * cam.up[1],
    cam.f[2] + a * cam.right[2] + b * cam.up[2],
  ]);
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
