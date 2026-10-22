// Frames. Every keyframe is exactly one rendered frame (like Stick Nodes); smooth motion
// comes from adding 50% frames between two keyframes. Interpolation lives here for that,
// and to convert older projects whose keyframes had generated in-betweens.
import { EASES, lerp, uid } from './geom.js';
import { lerpPose } from './rig.js';
import { camAt, lerpCam, withShake } from './camera.js';

// One entry per rendered frame: k = keyframe index, i = frame number.
export const expand = (p) => p.frames.map((f, k) => ({ k, i: k }));
export const totalFrames = (p) => p.frames.length;
export const entryOfKey = (p, k) => k;

export function evalKey(p, k) {
  const frame = p.frames[k];
  return { k, frame, poses: frame.poses, xf: frame.xf, cam: camAt(p, k) };
}

// Rendered frame (playback / export): includes camera shake.
export function evalEntry(p, e) {
  const st = evalKey(p, e.k);
  return { ...st, cam: withShake(st.cam, e.i ?? e.k) };
}

// Poses and layer transforms blended from keyframe A toward B by t.
function blend(p, A, B, t) {
  const poses = {}, xf = {};
  for (const layer of p.layers) {
    const id = layer.id;
    if (layer.kind === 'figure') {
      const a = A.poses[id], b = B.poses[id];
      if (a) poses[id] = b ? lerpPose(layer.rig, a, b, t) : structuredClone(a);
    } else {
      const a = A.xf[id], b = B.xf[id];
      if (a || b) {
        const x0 = a || { x: 0, y: 0, r: 0, s: 1 }, x1 = b || { x: 0, y: 0, r: 0, s: 1 };
        xf[id] = { x: lerp(x0.x, x1.x, t), y: lerp(x0.y, x1.y, t), r: lerp(x0.r, x1.r, t), s: lerp(x0.s, x1.s, t) };
      }
    }
  }
  return { poses, xf };
}

// A new keyframe t of the way from keyframe k to keyframe n. Frame-by-frame drawings
// start blank (draw the in-between yourself with onion skin) unless copyDrawings.
export function inbetweenFrame(p, k, n, t, copyDrawings = false) {
  const A = p.frames[k], B = p.frames[n];
  const { poses, xf } = blend(p, A, B, t);
  const f = { id: uid('f'), poses, draws: {}, xf };
  if (copyDrawings) for (const id in A.draws) f.draws[id] = A.draws[id].slice();
  const ca = camAt(p, k), cb = camAt(p, n);
  if (ca !== cb) f.cam = lerpCam(ca, cb, t);
  return f;
}

// Older projects stored per-keyframe in-betweens (inb) with tween / hold and easing.
// Turn them into real frames so the animation plays exactly as before.
export function bakeInbetweens(p) {
  const src = p.frames;
  if (src.some((f) => f.inb > 0)) {
    const out = [];
    const n = src.length;
    src.forEach((f, k) => {
      out.push(f);
      const next = k + 1 < n ? k + 1 : p.loop && n > 1 ? 0 : k;
      for (let j = 1; j <= (f.inb | 0); j++) {
        const u = f.tween !== false && next !== k ? j / (f.inb + 1) : 0;
        const t = (EASES[f.ease] || EASES.linear)(u);
        // In-betweens used to show their keyframe's drawings, so they keep them.
        const g = inbetweenFrame(p, k, u ? next : k, t, true);
        if (!u) delete g.cam;
        out.push(g);
      }
    });
    p.frames = out;
  }
  for (const f of p.frames) {
    delete f.inb;
    delete f.tween;
    delete f.ease;
  }
  return p;
}
