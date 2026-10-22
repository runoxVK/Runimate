// Timeline expansion: keyframes plus generated in-between frames.
import { EASES, lerp } from './geom.js';
import { lerpPose } from './rig.js';
import { camAt, lerpCam, withShake } from './camera.js';

// One entry per rendered frame: k = keyframe, u = 0..1 progress toward keyframe n, i = frame number.
export function expand(p) {
  const out = [];
  const n = p.frames.length;
  p.frames.forEach((f, k) => {
    out.push({ k, u: 0, n: k, i: out.length });
    const next = k + 1 < n ? k + 1 : p.loop && n > 1 ? 0 : k;
    for (let j = 1; j <= f.inb; j++) out.push({ k, u: f.tween && next !== k ? j / (f.inb + 1) : 0, n: next, i: out.length });
  });
  return out;
}

export const totalFrames = (p) => p.frames.reduce((a, f) => a + 1 + f.inb, 0);

export function entryOfKey(p, k) {
  let i = 0;
  for (let j = 0; j < k; j++) i += 1 + p.frames[j].inb;
  return i;
}

export function evalKey(p, k) {
  const frame = p.frames[k];
  return { k, frame, poses: frame.poses, xf: frame.xf, cam: camAt(p, k) };
}

// Rendered frame (playback / export): includes camera shake.
export function evalEntry(p, e) {
  const st = tweenEntry(p, e);
  st.cam = withShake(st.cam, e.i ?? 0);
  return st;
}

function tweenEntry(p, e) {
  if (!e.u) return evalKey(p, e.k);
  const A = p.frames[e.k], B = p.frames[e.n];
  const t = (EASES[A.ease] || EASES.linear)(e.u);
  const poses = {}, xf = {};
  for (const layer of p.layers) {
    const id = layer.id;
    if (layer.kind === 'figure') {
      const a = A.poses[id], b = B.poses[id];
      if (a) poses[id] = b ? lerpPose(layer.rig, a, b, t) : a;
    } else {
      const a = A.xf[id], b = B.xf[id];
      if (a || b) {
        const x0 = a || { x: 0, y: 0, r: 0, s: 1 }, x1 = b || { x: 0, y: 0, r: 0, s: 1 };
        xf[id] = { x: lerp(x0.x, x1.x, t), y: lerp(x0.y, x1.y, t), r: lerp(x0.r, x1.r, t), s: lerp(x0.s, x1.s, t) };
      }
    }
  }
  return { k: e.k, frame: A, poses, xf, cam: lerpCam(camAt(p, e.k), camAt(p, e.n), t) };
}
