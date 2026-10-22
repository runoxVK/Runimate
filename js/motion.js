// Reusable motions: a figure's animation over a range of keyframes saved to the library
// and applied to any figure whose joints share ids (all humanoid presets do).
import { app, P, curFrame, selLayer, changed, checkpoint, goto } from './app.js';
import { deepClone, uid, clonePose, makeFrameFrom } from './model.js';
import { computeWorld, figureBounds, lerpPose } from './rig.js';
import { drawFigure } from './render.js';
import { put } from './storage.js';
import { emptyBox, boxAdd, EASES } from './geom.js';
import { toast, formDialog } from './ui.js';

function figureRange(p, id) {
  if (app.frameSel && app.frameSel[0] !== app.frameSel[1]) return [Math.min(...app.frameSel), Math.max(...app.frameSel)];
  let a = -1, b = -1;
  p.frames.forEach((f, i) => {
    if (!f.poses[id]) return;
    if (a < 0) a = i;
    b = i;
  });
  return [a, b];
}

export async function saveMotionToLibrary(refresh) {
  const s = app.sel, layer = selLayer(), p = P();
  if (s?.type !== 'figure' || !layer) return toast('Select the figure whose animation you want to save');
  const [a, b] = figureRange(p, layer.id);
  const v = await formDialog('Save motion to library', [
    { key: 'name', label: 'Name', value: `${layer.name} motion` },
    { key: 'from', label: 'From keyframe', type: 'number', value: a + 1, min: 1, max: p.frames.length },
    { key: 'to', label: 'To keyframe', type: 'number', value: b + 1, min: 1, max: p.frames.length },
  ], { ok: 'Save', note: 'Saves the joint angles, lengths, colours, movement and timing of those keyframes. Apply it to any figure with the same joints.' });
  if (!v) return;
  const lo = Math.min(v.from, v.to) - 1, hi = Math.max(v.from, v.to) - 1;
  const base = p.frames.slice(lo, hi + 1).map((f) => f.poses[layer.id]).find(Boolean);
  if (!base) return toast('The figure isn’t in those frames');
  const frames = [];
  for (let k = lo; k <= hi; k++) {
    const f = p.frames[k], q = f.poses[layer.id];
    if (!q) continue;
    frames.push({
      a: { ...q.a }, l: { ...q.l }, c: q.c ? { ...q.c } : null, o: q.o ? { ...q.o } : null, op: q.op ?? null,
      dx: q.x - base.x, dy: q.y - base.y, dr: q.r - base.r, ds: q.s / (base.s || 1),
    });
  }
  if (frames.length < 2) return toast('A motion needs at least two keyframes with the figure in them');
  const data = { rig: deepClone(layer.rig), r0: base.r, s0: base.s, flip0: !!base.flip, frames };
  const asset = { id: uid('a'), kind: 'motion', name: v.name || 'Motion', created: Date.now(), data, thumb: motionThumb(data) };
  await put('assets', asset);
  await refresh?.();
  toast(`Saved “${asset.name}” (${frames.length} keyframes) — select a figure and tap it in the Library to apply`, { ms: 3200 });
}

const clipPose = (data, cf) => ({ x: cf.dx, y: cf.dy, r: data.r0 + cf.dr, s: data.s0 * cf.ds, flip: data.flip0, a: cf.a, l: cf.l, c: cf.c, o: cf.o });

// Onion-skin style strip of the motion's poses.
export function motionThumb(data, size = 112) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const poses = data.frames.map((cf) => clipPose(data, cf));
  const b = emptyBox();
  for (const q of poses) {
    const fb = figureBounds(data.rig, computeWorld(data.rig, q));
    boxAdd(b, fb.x0, fb.y0);
    boxAdd(b, fb.x1, fb.y1);
  }
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  const k = Math.min((size - 12) / w, (size - 12) / h, 2);
  ctx.setTransform(k, 0, 0, k, size / 2 - ((b.x0 + b.x1) / 2) * k, size / 2 - ((b.y0 + b.y1) / 2) * k);
  poses.forEach((q, i) => {
    ctx.globalAlpha = 0.18 + (0.82 * (i + 1)) / poses.length;
    drawFigure(ctx, { rig: data.rig }, q);
  });
  return c.toDataURL('image/png');
}

export async function applyMotion(asset) {
  const s = app.sel, layer = selLayer(), p = P();
  if (s?.type !== 'figure' || !layer) return toast('Select a figure first, then tap the motion to apply it');
  const clip = expandClip(asset.data);
  const v = await formDialog(`Apply “${asset.name}” to ${layer.name}`, [
    { key: 'start', label: 'Start at keyframe', type: 'number', value: app.cur + 1, min: 1, max: p.frames.length + 1 },
    { key: 'repeat', label: 'Repeat', type: 'number', value: 1, min: 1, max: 50 },
    { key: 'move', label: 'Include movement (walking travels across the canvas)', type: 'checkbox', value: true },
  ], { ok: 'Apply', note: `${clip.frames.length} keyframes${v0(clip)}. Frames are added at the end if needed.` });
  if (!v) return;
  const ids = new Set(layer.rig.nodes.map((n) => n.id));
  const clipIds = new Set(clip.rig.nodes.filter((n) => n.parent).map((n) => n.id));
  const matched = [...clipIds].filter((id) => ids.has(id)).length;
  if (!matched) return toast('This figure has none of the motion’s joints (use a figure made from the same preset)', { kind: 'warn', ms: 3500 });

  checkpoint();
  const k0 = Math.max(0, Math.min(p.frames.length, v.start - 1));
  if (k0 >= p.frames.length) p.frames.push(makeFrameFrom(p.frames.at(-1), false));
  let base = null;
  for (let i = k0; i >= 0 && !base; i--) base = p.frames[i].poses[layer.id];
  for (let i = k0; i < p.frames.length && !base; i++) base = p.frames[i].poses[layer.id];
  base = clonePose(base);
  // Facing the other way: mirror the motion so it still reads correctly.
  const sign = !!base.flip !== !!clip.flip0 ? -1 : 1;
  const n = clip.frames.length;
  const last = clip.frames[n - 1];
  const stride = [last.dx + last.dx / (n - 1), last.dy + last.dy / (n - 1)];

  let k = k0;
  for (let rep = 0; rep < v.repeat; rep++) {
    for (const cf of clip.frames) {
      while (k >= p.frames.length) p.frames.push(makeFrameFrom(p.frames.at(-1), false));
      const f = p.frames[k];
      const q = clonePose(f.poses[layer.id] || base);
      for (const [id, a] of Object.entries(cf.a)) if (ids.has(id)) q.a[id] = sign * a;
      for (const [id, l] of Object.entries(cf.l)) if (ids.has(id)) q.l[id] = l;
      const pick = (m) => (m ? Object.fromEntries(Object.entries(m).filter(([id]) => ids.has(id))) : null);
      const c = pick(cf.c), o = pick(cf.o);
      if (c && Object.keys(c).length) q.c = c; else delete q.c;
      if (o && Object.keys(o).length) q.o = o; else delete q.o;
      if (cf.op != null) q.op = cf.op; else delete q.op;
      if (v.move) {
        q.x = base.x + sign * (cf.dx + rep * stride[0]);
        q.y = base.y + cf.dy + rep * stride[1];
        q.r = base.r + sign * cf.dr;
        q.s = base.s * cf.ds;
      } else {
        q.x = base.x;
        q.y = base.y;
        q.r = base.r;
        q.s = base.s;
      }
      q.flip = base.flip;
      f.poses[layer.id] = q;
      k++;
    }
  }
  changed('frames', 'content');
  goto(k0);
  toast(`Applied to ${k - k0} keyframes${matched < clipIds.size ? ` (${matched} of ${clipIds.size} joints matched)` : ''}`, { ms: 2400 });
}

// Motions saved before in-betweens were removed carry per-frame inb counts:
// expand those into real frames the same way the timeline used to.
function expandClip(data) {
  if (!data.frames.some((cf) => cf.inb > 0)) return data;
  const frames = [];
  const n = data.frames.length;
  data.frames.forEach((cf, i) => {
    frames.push(cf);
    const nx = data.frames[i + 1];
    for (let j = 1; j <= (cf.inb | 0); j++) {
      if (!nx || cf.tween === false) { frames.push(cf); continue; }
      const t = (EASES[cf.ease] || EASES.linear)(j / (cf.inb + 1));
      const q = lerpPose(data.rig, clipPose(data, cf), clipPose(data, nx), t);
      frames.push({ a: q.a, l: q.l, c: q.c || null, o: q.o || null, op: q.op ?? null, dx: q.x, dy: q.y, dr: q.r - data.r0, ds: q.s / (data.s0 || 1) });
    }
  });
  return { ...data, frames, n };
}

const v0 = (clip) => (clip.rig.nodes.length ? ` · made with ${clip.rig.nodes.length - 1} joints` : '');
