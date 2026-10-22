// Project data model.
//
// Project
//   layers: bottom → top. kind: 'figure' | 'draw' | 'image'
//     figure: rig { nodes: [Node] }          (structure + style shared by all frames)
//     draw:   mode 'frame' (own drawing per keyframe) | 'sprite' (one drawing, animated transform)
//             strokes (sprite only), pv (pivot, local coords)
//     image:  src (data URL), w, h, pv
//   frames: keyframes, each { inb, tween, ease, poses, draws, xf }
//     poses[layerId] = Pose   (figure present in this frame iff a pose exists)
//     draws[layerId] = [Stroke]  (frame-mode draw layers)
//     xf[layerId]   = { x, y, r, s }  (draw / image layer transform)
//
// Node  { id, parent, shape, thick, color, len, ang, art? { strokes, base, stretch } }
// Pose  { x, y, r, s, flip, a: {nodeId: relAngle}, l: {nodeId: length} }
// Stroke { pts: [x, y, p, ...], w, c, o, fill, closed }  — treated as immutable everywhere.

import { IDENT_XF, uid } from './geom.js';
import { PRESETS, rigFromPreset } from './presets.js';
import { defaultPose } from './rig.js';
import { detachChildren } from './join.js';

export const FORMAT = 'runimate';
export const VERSION = 1;

export { uid };

export function newFrame() {
  return { id: uid('f'), inb: 0, tween: true, ease: 'linear', poses: {}, draws: {}, xf: {} };
}

export function newProject({ name = 'Untitled animation', width = 1280, height = 720, fps = 12, bg = '#ffffff', starter = true } = {}) {
  const p = {
    format: FORMAT, version: VERSION, id: uid('p'), name,
    width, height, fps, bg, loop: true,
    layers: [], frames: [newFrame()], sounds: [],
  };
  if (starter) {
    const preset = PRESETS.find((x) => x.id === 'stickman');
    addFigureLayer(p, rigFromPreset(preset), null, { name: 'Stickman', frameIndex: 0, x: width / 2, y: height / 2 + 40, rootAngle: preset.rootAngle });
    addDrawLayer(p, 'frame', 'Drawing');
  }
  return p;
}

export const layerById = (p, id) => p.layers.find((l) => l.id === id) || null;
export const layerIndex = (p, id) => p.layers.findIndex((l) => l.id === id);

function insertLayer(p, layer, aboveId) {
  const i = aboveId ? layerIndex(p, aboveId) : -1;
  if (i >= 0) p.layers.splice(i + 1, 0, layer);
  else p.layers.push(layer);
  return layer;
}

export function uniqueName(p, base) {
  const names = new Set(p.layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

// Adds a figure to frameIndex and every later frame.
export function addFigureLayer(p, rig, pose, { name = 'Figure', frameIndex = 0, x, y, rootAngle, aboveId } = {}) {
  const layer = { id: uid('L'), kind: 'figure', name: uniqueName(p, name), visible: true, locked: false, opacity: 1, rig };
  insertLayer(p, layer, aboveId);
  const base = pose ? { ...pose, a: { ...pose.a }, l: { ...pose.l } } : defaultPose(rig, x ?? p.width / 2, y ?? p.height / 2, rootAngle);
  if (x != null) base.x = x;
  if (y != null) base.y = y;
  for (let i = frameIndex; i < p.frames.length; i++) p.frames[i].poses[layer.id] = clonePose(base);
  return layer;
}

export function addDrawLayer(p, mode = 'frame', name, aboveId) {
  const layer = {
    id: uid('L'), kind: 'draw', mode, name: uniqueName(p, name || (mode === 'sprite' ? 'Sprite' : 'Drawing')),
    visible: true, locked: false, opacity: 1, pv: null,
  };
  if (mode === 'sprite') layer.strokes = [];
  return insertLayer(p, layer, aboveId);
}

export function addImageLayer(p, src, w, h, name = 'Image', aboveId) {
  const layer = { id: uid('L'), kind: 'image', name: uniqueName(p, name), visible: true, locked: false, opacity: 1, src, w, h, pv: [w / 2, h / 2] };
  insertLayer(p, layer, aboveId);
  const k = Math.min(p.width / w, p.height / h, 1);
  const xf = { x: p.width / 2 - w / 2, y: p.height / 2 - h / 2, r: 0, s: k };
  for (const f of p.frames) f.xf[layer.id] = { ...xf };
  return layer;
}

export function removeLayer(p, id) {
  detachChildren(p, id);
  p.layers = p.layers.filter((l) => l.id !== id);
  for (const f of p.frames) {
    delete f.poses[id];
    delete f.draws[id];
    delete f.xf[id];
  }
}

export function getStrokes(layer, frame) {
  if (layer.kind !== 'draw') return [];
  if (layer.mode === 'sprite') return layer.strokes || (layer.strokes = []);
  return frame.draws[layer.id] || [];
}
export function setStrokes(layer, frame, arr) {
  if (layer.mode === 'sprite') layer.strokes = arr;
  else if (arr.length) frame.draws[layer.id] = arr;
  else delete frame.draws[layer.id];
}

export const getXf = (frame, id) => frame.xf[id] || IDENT_XF;

export function clonePose(q) {
  const c = { ...q, a: { ...q.a }, l: { ...q.l } };
  if (q.c) c.c = { ...q.c };
  if (q.o) c.o = { ...q.o };
  return c;
}
const mapObj = (o, fn) => {
  const out = {};
  for (const k in o) out[k] = fn(o[k]);
  return out;
};
export function cloneNode(n) {
  return { ...n, art: n.art ? { ...n.art, strokes: n.art.strokes.slice() } : null };
}
export function cloneLayer(l) {
  const c = { ...l };
  if (l.rig) c.rig = { nodes: l.rig.nodes.map(cloneNode) };
  if (l.strokes) c.strokes = l.strokes.slice();
  if (l.pv) c.pv = l.pv.slice();
  if (l.join) c.join = { ...l.join };
  return c;
}
export function cloneFrame(f) {
  const c = { ...f, poses: mapObj(f.poses, clonePose), draws: mapObj(f.draws, (a) => a.slice()), xf: mapObj(f.xf, (x) => ({ ...x })) };
  if (f.cam) c.cam = { ...f.cam };
  return c;
}
// Structural clone that shares immutable stroke objects (cheap enough for undo).
export function cloneProject(p) {
  return { ...p, layers: p.layers.map(cloneLayer), frames: p.frames.map(cloneFrame), sounds: (p.sounds || []).map((s) => ({ ...s })) };
}
export const deepClone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

// New keyframe after `index`. copyDrawings=false leaves frame-by-frame layers blank.
export function makeFrameFrom(src, copyDrawings) {
  const f = cloneFrame(src);
  f.id = uid('f');
  if (!copyDrawings) f.draws = {};
  return f;
}

export function validateProject(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a Runimate project');
  if (data.format !== FORMAT) throw new Error('Not a Runimate project file');
  if (!Array.isArray(data.layers) || !Array.isArray(data.frames) || !data.frames.length) throw new Error('Project file is damaged');
  const p = data;
  p.version = VERSION;
  p.id ||= uid('p');
  p.width = +p.width || 1280;
  p.height = +p.height || 720;
  p.fps = Math.min(60, Math.max(1, +p.fps || 12));
  p.bg ||= '#ffffff';
  p.loop = p.loop !== false;
  p.sounds = Array.isArray(p.sounds) ? p.sounds : [];
  for (const l of p.layers) {
    l.visible = l.visible !== false;
    l.locked = !!l.locked;
    l.opacity ??= 1;
    if (l.kind === 'draw' && l.mode === 'sprite') l.strokes ||= [];
    if (l.kind === 'figure') for (const n of l.rig.nodes) n.art ??= null;
  }
  for (const f of p.frames) {
    f.id ||= uid('f');
    f.inb = Math.max(0, f.inb | 0);
    f.tween = f.tween !== false;
    f.ease ||= 'linear';
    f.poses ||= {};
    f.draws ||= {};
    f.xf ||= {};
  }
  return p;
}
