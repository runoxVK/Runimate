// Animated camera. A keyframe may carry `cam` = { x, y, z, r, shake }:
// the point it looks at (stage coords), zoom (1 = whole canvas), rotation and shake.
// Keyframes without one hold the camera of the previous keyframe.
import { chain, translate, rotate, scale, lerp, apply, inv } from './geom.js';

export const defaultCam = (p) => ({ x: p.width / 2, y: p.height / 2, z: 1, r: 0, shake: 0 });

export function camAt(p, k) {
  for (let i = k; i >= 0; i--) if (p.frames[i].cam) return p.frames[i].cam;
  return defaultCam(p);
}

export const camUsed = (p) => p.frames.some((f) => f.cam);

// Writable camera for keyframe k (created from what it currently shows).
export function ensureCam(p, k) {
  const f = p.frames[k];
  if (!f.cam) f.cam = { ...defaultCam(p), ...camAt(p, k) };
  return f.cam;
}

export function lerpCam(a, b, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    // Zoom feels even when interpolated geometrically.
    z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), t)),
    r: lerp(a.r, b.r, t),
    shake: lerp(a.shake || 0, b.shake || 0, t),
  };
}

// Deterministic per-frame jitter so exports and playback match.
function noise(i, seed) {
  const v = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}
export function withShake(cam, i) {
  if (!cam.shake) return cam;
  const s = cam.shake;
  return { ...cam, sx: noise(i, 1) * s, sy: noise(i, 2) * s, sr: noise(i, 3) * s * 0.002 };
}

// Stage → output-frame matrix for this camera.
export function camMatrix(p, cam) {
  return chain(
    translate(p.width / 2, p.height / 2),
    rotate(-(cam.r + (cam.sr || 0))),
    scale(cam.z),
    translate(-(cam.x + (cam.sx || 0)), -(cam.y + (cam.sy || 0))),
  );
}

// The camera's view rectangle in stage coordinates (4 corners, clockwise).
export function camCorners(p, cam) {
  const m = inv(camMatrix(p, cam));
  return [[0, 0], [p.width, 0], [p.width, p.height], [0, p.height]].map(([x, y]) => apply(m, x, y));
}

export const isIdentityCam = (p, c) => Math.abs(c.x - p.width / 2) < 0.01 && Math.abs(c.y - p.height / 2) < 0.01 && Math.abs(c.z - 1) < 1e-4 && Math.abs(c.r) < 1e-4 && !c.shake;
