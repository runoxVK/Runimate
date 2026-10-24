// Editing actions shared by menus, panels, shortcuts and the command palette.
import { app, P, curFrame, activeLayer, selLayer, changed, checkpoint, select, goto } from './app.js';
import {
  layerById, layerIndex, getStrokes, setStrokes, addFigureLayer, addDrawLayer, addImageLayer, removeLayer,
  makeFrameFrom, deepClone, uid, cloneLayer, uniqueName, getXf,
} from './model.js';
import { addChildNode, deleteNode, moveNodeOrder, flipPose, nodeById, rootNode, computeWorld, bakeDefaults, figureBounds, descendants } from './rig.js';
import { strokesBox, transformStroke } from './brush.js';
import { layerMatrix } from './render.js';
import { viewCenter, ensureXf, detachArt, startAttach, startJoin } from './stage.js';
import { inv, chain, translate, scale, boxValid, DEG } from './geom.js';
import { toast, promptDialog } from './ui.js';
import { PRESETS, rigFromPreset } from './presets.js';
import { defaultCam } from './camera.js';
import { inbetweenFrame } from './tween.js';
import { resolvePoses, detachLayer, detachChildren, setJoinScale } from './join.js';
import { pickFile, loadImageFile } from './fileio.js';

export function resetCamera() {
  checkpoint();
  curFrame().cam = defaultCam(P());
  changed('content', 'camera');
}
export function removeCameraKey() {
  const f = curFrame();
  if (!f.cam) return;
  checkpoint();
  delete f.cam;
  changed('content', 'frames');
}

export function setTool(t) {
  if (t === app.tool) return;
  if (t === 'eyedropper') app.prevTool = app.tool;
  if (app.boneDraw && !['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'eyedropper', 'hand'].includes(t)) endBoneDraw();
  app.tool = t;
  app.attachPending = false;
  changed('tool');
}

// ------------------------------------------------------------------ frames
const range = () => {
  const s = app.frameSel;
  return s ? [Math.min(s[0], s[1]), Math.max(s[0], s[1])] : [app.cur, app.cur];
};

export function newFrame(copyDrawings = false) {
  checkpoint();
  const f = makeFrameFrom(curFrame(), copyDrawings);
  P().frames.splice(app.cur + 1, 0, f);
  app.frameSel = null;
  changed('frames', 'content');
  goto(app.cur + 1);
}

export function deleteFrames() {
  const [a, b] = range();
  const p = P();
  if (b - a + 1 >= p.frames.length) return toast('An animation needs at least one frame', { kind: 'warn' });
  checkpoint();
  p.frames.splice(a, b - a + 1);
  app.frameSel = null;
  app.cur = Math.min(a, p.frames.length - 1);
  app.sel = null;
  changed('frames', 'content', 'frame', 'sel');
  toast(b > a ? `Deleted ${b - a + 1} frames` : 'Frame deleted', { ms: 1400 });
}

export function moveFrames(dir) {
  const [a, b] = range();
  const p = P();
  if (a + dir < 0 || b + dir >= p.frames.length) return;
  checkpoint();
  const block = p.frames.splice(a, b - a + 1);
  p.frames.splice(a + dir, 0, ...block);
  app.cur += dir;
  if (app.frameSel) app.frameSel = [a + dir, b + dir];
  changed('frames', 'frame');
}

// Exposure: how many rendered frames each selected frame stays on screen.
export function setHold(n) {
  const [a, b] = range();
  checkpoint('hold');
  for (let i = a; i <= b; i++) P().frames[i].hold = Math.max(1, Math.min(99, n | 0));
  changed('frames');
}
export function nudgeHold(d) {
  const [a, b] = range();
  checkpoint('hold');
  for (let i = a; i <= b; i++) {
    const f = P().frames[i];
    f.hold = Math.max(1, Math.min(99, (f.hold || 1) + d));
  }
  changed('frames');
  const f = P().frames[app.cur];
  toast(`Hold ×${f.hold} (on ${f.hold}s)`, { ms: 900 });
}
// Shoot the whole animation on 1s / 2s / 3s.
export function shootOn(n) {
  checkpoint();
  for (const f of P().frames) f.hold = n;
  changed('frames');
  toast(`Every frame now holds for ${n} — animating on ${n}s`, { ms: 1600 });
}

// Stick Nodes' "add 50% frame": a new frame halfway between this frame and the next.
export function addMidFrame() {
  const p = P();
  const k = app.cur;
  if (k >= p.frames.length - 1) return toast('Go to a frame that has a frame after it — the 50% frame goes between them', { ms: 2600 });
  checkpoint();
  p.frames.splice(k + 1, 0, inbetweenFrame(p, k, k + 1, 0.5));
  app.frameSel = null;
  changed('frames', 'content');
  goto(k + 1);
  toast(`Added a 50% frame between frames ${k + 1} and ${k + 2}`, { ms: 1400 });
}

export function copyFrames() {
  const [a, b] = range();
  setClipboard({ type: 'frames', frames: deepClone(P().frames.slice(a, b + 1)) });
  toast(b > a ? `Copied ${b - a + 1} frames` : 'Frame copied', { ms: 1200 });
}
export function pasteFrames() {
  const c = app.clipboard;
  if (c?.type !== 'frames') return toast('No frames on the clipboard — select frames and press Ctrl+C');
  checkpoint();
  const p = P();
  const ids = new Set(p.layers.map((l) => l.id));
  const keep = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => ids.has(k)));
  const frames = deepClone(c.frames).map((f) => ({ ...f, id: uid('f'), poses: keep(f.poses), draws: keep(f.draws), xf: keep(f.xf) }));
  p.frames.splice(app.cur + 1, 0, ...frames);
  app.frameSel = frames.length > 1 ? [app.cur + 1, app.cur + frames.length] : null;
  changed('frames', 'content');
  goto(app.cur + 1);
  toast(`Pasted ${frames.length} frame${frames.length > 1 ? 's' : ''}`, { ms: 1200 });
}

// ------------------------------------------------------------------ clipboard
function setClipboard(c) {
  app.clipboard = c;
  try {
    localStorage.setItem('runimate.clipboard', JSON.stringify(c));
  } catch {}
  changed('clipboard');
}
export function loadClipboard() {
  try {
    const c = JSON.parse(localStorage.getItem('runimate.clipboard') || 'null');
    if (c) app.clipboard = c;
  } catch {}
}

const stageMat = (layer) => layerMatrix(layer, getXf(curFrame(), layer.id));

export function copy(cut = false) {
  const s = app.sel, layer = selLayer();
  if (!s || !layer) return copyFrames();
  if (s.type === 'strokes') {
    const m = stageMat(layer);
    setClipboard({ type: 'strokes', strokes: s.strokes.map((x) => transformStroke(x, m)), src: { layer: layer.id, frame: curFrame().id } });
  } else if (s.type === 'figure') {
    const world = resolvePoses(P(), curFrame())[layer.id] || curFrame().poses[layer.id];
    setClipboard({ type: 'figure', layer: deepClone(cloneLayer(layer)), pose: deepClone(world), src: { layer: layer.id } });
  } else if (s.type === 'layer') {
    const c = { type: 'layer', layer: deepClone(cloneLayer(layer)), xf: deepClone(getXf(curFrame(), layer.id)), src: { layer: layer.id } };
    if (layer.kind === 'draw' && layer.mode === 'frame') c.strokes = deepClone(getStrokes(layer, curFrame()));
    setClipboard(c);
  }
  if (cut) deleteSelection();
  else toast('Copied', { ms: 900 });
}

export function paste() {
  const c = app.clipboard;
  if (!c) return toast('Clipboard is empty');
  if (c.type === 'frames') return pasteFrames();
  if (c.type === 'pose') return pastePose();
  const p = P(), f = curFrame();
  if (c.type === 'strokes') {
    const target = drawLayerForInsert();
    checkpoint();
    const sameSpot = c.src?.layer === target.id && c.src?.frame === f.id;
    const off = sameSpot ? 16 : 0;
    const m = chain(inv(stageMat(target)), translate(off, off));
    const strokes = deepClone(c.strokes).map((x) => transformStroke(x, m));
    setStrokes(target, f, [...getStrokes(target, f), ...strokes]);
    changed('content', 'layers');
    select({ type: 'strokes', id: target.id, strokes });
    if (app.tool !== 'select' && app.tool !== 'lasso') setToolKeepBone('lasso');
    return;
  }
  if (c.type === 'figure') {
    checkpoint();
    const pose = deepClone(c.pose);
    if (c.src && f.poses[c.src.layer]) { pose.x += 24; pose.y += 24; }
    // Pasted copies stand on their own (they aren't attached to anything).
    const rig = deepClone(c.layer.rig);
    const layer = addFigureLayer(p, rig, pose, { name: c.layer.name, frameIndex: app.cur, aboveId: app.activeLayer });
    changed('layers', 'content');
    select({ type: 'figure', id: layer.id, node: null });
    setToolKeepBone('select');
    return;
  }
  if (c.type === 'layer') {
    checkpoint();
    const src = deepClone(c.layer);
    const layer = { ...src, id: uid('L'), name: uniqueName(p, src.name) };
    p.layers.splice(layerIndex(p, app.activeLayer) + 1 || p.layers.length, 0, layer);
    const xf = { ...c.xf, x: c.xf.x + 24, y: c.xf.y + 24 };
    for (let i = layer.kind === 'image' ? 0 : app.cur; i < p.frames.length; i++) p.frames[i].xf[layer.id] = { ...xf };
    if (c.strokes) f.draws[layer.id] = c.strokes;
    changed('layers', 'content');
    select({ type: 'layer', id: layer.id });
  }
}
const setToolKeepBone = (t) => { app.tool = t; changed('tool'); };

export function copyPose() {
  const s = app.sel;
  if (s?.type !== 'figure') return toast('Select a figure to copy its pose');
  setClipboard({ type: 'pose', pose: deepClone(curFrame().poses[s.id]), src: { layer: s.id } });
  toast('Pose copied — select a figure and press Ctrl+Shift+V', { ms: 1800 });
}
export function pastePose() {
  const s = app.sel, c = app.clipboard;
  if (c?.type !== 'pose' && c?.type !== 'figure') return toast('Copy a pose first (Ctrl+Shift+C)');
  if (s?.type !== 'figure') return toast('Select the figure to paste the pose onto');
  const layer = selLayer();
  const target = curFrame().poses[s.id];
  checkpoint();
  const src = c.pose;
  const ids = new Set(layer.rig.nodes.map((n) => n.id));
  let matched = 0;
  for (const k of Object.keys(src.a)) if (ids.has(k)) { target.a[k] = src.a[k]; matched++; }
  for (const k of Object.keys(src.l)) if (ids.has(k)) target.l[k] = src.l[k];
  target.r = src.r;
  target.s = src.s;
  target.flip = src.flip;
  if (c.src?.layer === s.id) { target.x = src.x; target.y = src.y; }
  changed('content');
  toast(matched ? 'Pose pasted' : 'Pose pasted (the rigs have no matching joints)', { ms: 1400 });
}

// ------------------------------------------------------------------ selection edits
export function deleteSelection() {
  const s = app.sel, layer = selLayer(), p = P(), f = curFrame();
  if (!s || !layer) return false;
  checkpoint();
  if (s.type === 'strokes') {
    const gone = new Set(s.strokes);
    setStrokes(layer, f, getStrokes(layer, f).filter((x) => !gone.has(x)));
  } else if (s.type === 'figure') {
    for (let i = app.cur; i < p.frames.length; i++) delete p.frames[i].poses[layer.id];
    if (!p.frames.some((fr) => fr.poses[layer.id])) removeLayer(p, layer.id);
    toast(`Removed “${layer.name}” from this frame onward`, { ms: 1600 });
  } else if (s.type === 'layer') {
    if (layer.kind === 'draw' && layer.mode === 'frame') setStrokes(layer, f, []);
    else removeLayer(p, layer.id);
  }
  app.sel = null;
  changed('content', 'layers', 'sel');
  return true;
}

export function duplicateSelection() {
  const s = app.sel;
  if (!s) return toast('Select something to duplicate');
  const saved = app.clipboard;
  copy();
  const c = app.clipboard;
  if (c.type === 'strokes') c.src = { layer: s.id, frame: curFrame().id };
  paste();
  app.clipboard = saved;
}

export function flipSelection() {
  const s = app.sel, layer = selLayer(), f = curFrame();
  if (!s || !layer) return toast('Select a figure or drawing to flip');
  checkpoint();
  if (s.type === 'figure') flipPose(layer.rig, f.poses[s.id]);
  else if (s.type === 'strokes' || (s.type === 'layer' && layer.kind === 'draw')) {
    const list = s.type === 'strokes' ? s.strokes : getStrokes(layer, f);
    const b = strokesBox(list);
    if (!boxValid(b)) return;
    const cx = (b.x0 + b.x1) / 2;
    const m = chain(translate(cx, 0), scale(-1, 1), translate(-cx, 0));
    const next = list.map((x) => transformStroke(x, m));
    const map = new Map(list.map((x, i) => [x, next[i]]));
    setStrokes(layer, f, getStrokes(layer, f).map((x) => map.get(x) || x));
    if (s.type === 'strokes') s.strokes = next;
  } else return toast('Images can’t be flipped');
  changed('content');
}

export function selectAll() {
  const l = activeLayer();
  const layer = l && l.kind === 'draw' ? l : P().layers.findLast((x) => x.kind === 'draw' && x.visible && !x.locked);
  if (!layer) return;
  const strokes = getStrokes(layer, curFrame());
  if (!strokes.length) return toast(`Nothing drawn on “${layer.name}” in this frame`);
  select({ type: 'strokes', id: layer.id, strokes: strokes.slice() });
}

// ------------------------------------------------------------------ figures & nodes
function insertPoint() {
  const p = P();
  const [x, y] = viewCenter();
  return [Math.max(40, Math.min(p.width - 40, x)), Math.max(40, Math.min(p.height - 40, y))];
}

export function insertFigure(rig, pose, name) {
  checkpoint();
  const [x, y] = insertPoint();
  const p = P();
  let base = pose ? deepClone(pose) : null;
  if (!base) {
    const preset = PRESETS.find((q) => q.name === name);
    base = { x, y, r: preset ? preset.rootAngle : -Math.PI / 2, s: 1, flip: false, a: {}, l: {} };
  }
  // Centre the figure's bounds on the insert point.
  base.x = 0;
  base.y = 0;
  const b = figureBounds(rig, computeWorld(rig, base));
  base.x = x - (b.x0 + b.x1) / 2;
  base.y = y - (b.y0 + b.y1) / 2;
  const layer = addFigureLayer(p, rig, base, { name, frameIndex: app.cur, aboveId: app.activeLayer });
  changed('layers', 'content');
  app.tool = 'select';
  changed('tool');
  select({ type: 'figure', id: layer.id, node: null });
  return layer;
}
export const insertPreset = (id) => {
  const preset = PRESETS.find((q) => q.id === id) || PRESETS[0];
  insertFigure(rigFromPreset(preset), null, preset.name);
};

const figSel = () => {
  const s = app.sel;
  if (s?.type !== 'figure') {
    toast('Select a figure first');
    return null;
  }
  return { s, layer: selLayer(), pose: curFrame().poses[s.id] };
};

export function addNode() {
  const fs = figSel();
  if (!fs) return;
  checkpoint();
  const parent = fs.s.node || rootNode(fs.layer.rig).id;
  const n = addChildNode(fs.layer.rig, parent);
  fs.s.node = n.id;
  changed('content', 'sel');
  toast('Added a joint — drag the new node (or use arrow keys) to place it', { ms: 2000 });
}
export function removeNode() {
  const fs = figSel();
  if (!fs) return;
  const n = fs.s.node && nodeById(fs.layer.rig, fs.s.node);
  if (!n || !n.parent) return toast('Select a joint (not the main node) to delete it');
  checkpoint();
  detachChildren(P(), fs.layer.id, descendants(fs.layer.rig, n.id));
  deleteNode(fs.layer.rig, n.id);
  fs.s.node = n.parent;
  changed('content', 'sel');
}
export function nodeOrder(dir) {
  const fs = figSel();
  if (!fs || !fs.s.node) return;
  checkpoint();
  moveNodeOrder(fs.layer.rig, fs.s.node, dir);
  changed('content');
}
export function resetPose() {
  const fs = figSel();
  if (!fs) return;
  checkpoint();
  fs.pose.a = {};
  fs.pose.l = {};
  changed('content');
}
export function setDefaultPose() {
  const fs = figSel();
  if (!fs) return;
  checkpoint();
  bakeDefaults(fs.layer.rig, fs.pose);
  changed('content');
  toast('This pose is now the figure’s default (used by Reset pose and the library)');
}

export function startBoneDraw() {
  const fs = figSel();
  if (!fs) return;
  const node = fs.s.node || rootNode(fs.layer.rig).id;
  app.boneDraw = { id: fs.s.id, node };
  if (!['brush', 'line', 'rect', 'ellipse', 'fill', 'eraser'].includes(app.tool)) app.tool = 'brush';
  changed('tool', 'sel');
}
export function endBoneDraw() {
  if (!app.boneDraw) return;
  const { id, node } = app.boneDraw;
  app.boneDraw = null;
  app.tool = 'select';
  select({ type: 'figure', id, node });
  changed('tool');
}
export function clearArt() {
  const fs = figSel();
  if (!fs || !fs.s.node) return;
  const n = nodeById(fs.layer.rig, fs.s.node);
  if (!n?.art) return;
  checkpoint();
  n.art = null;
  changed('content');
}
export function detachSelectedArt() {
  const fs = figSel();
  if (fs && fs.s.node) detachArt(fs.layer, fs.s.node);
}
export { startAttach, startJoin };

export function detachSelected() {
  const fs = figSel();
  if (!fs) return;
  if (!fs.layer.join) return toast('This figure isn’t attached to anything');
  checkpoint();
  detachLayer(P(), fs.layer);
  changed('content', 'layers', 'sel');
  toast(`Detached “${fs.layer.name}” — it now moves on its own`);
}
export function setJoinScaling(on) {
  const fs = figSel();
  if (!fs?.layer.join) return;
  checkpoint();
  setJoinScale(P(), fs.layer, on);
  changed('content');
}

export function nudgeRotate(deg) {
  const s = app.sel, layer = selLayer();
  if (!s || !layer) return;
  checkpoint('rot');
  if (s.type === 'figure') curFrame().poses[s.id].r += deg * DEG;
  else if (s.type === 'layer') ensureXf(layer).r += deg * DEG;
  changed('content');
}

// ------------------------------------------------------------------ layers
export function drawLayerForInsert() {
  const a = activeLayer();
  if (a && a.kind === 'draw' && !a.locked) return a;
  const l = P().layers.findLast((x) => x.kind === 'draw' && !x.locked);
  if (l) return l;
  const nl = addDrawLayer(P(), 'frame', 'Drawing');
  changed('layers');
  return nl;
}

export function addLayer(mode = 'frame') {
  checkpoint();
  const l = addDrawLayer(P(), mode, null, app.activeLayer);
  app.activeLayer = l.id;
  app.sel = null;
  changed('layers', 'sel');
  toast(mode === 'sprite' ? 'Sprite layer: one drawing you can move, turn and scale per frame (it tweens)' : 'Frame-by-frame layer: every keyframe gets its own drawing', { ms: 3200 });
  if (!['brush', 'fill', 'line', 'rect', 'ellipse'].includes(app.tool)) setTool('brush');
}

export function deleteLayer(id = app.activeLayer) {
  const l = layerById(P(), id);
  if (!l) return;
  checkpoint();
  removeLayer(P(), id);
  if (app.sel?.id === id) app.sel = null;
  app.activeLayer = P().layers.at(-1)?.id || null;
  changed('layers', 'content', 'sel');
  toast(`Deleted layer “${l.name}” — Ctrl+Z to undo`, { ms: 1800 });
}

export function moveLayer(id, dir) {
  const p = P(), i = layerIndex(p, id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.layers.length) return;
  checkpoint();
  [p.layers[i], p.layers[j]] = [p.layers[j], p.layers[i]];
  changed('layers', 'content');
}

export function duplicateLayer(id = app.activeLayer) {
  const p = P(), src = layerById(p, id);
  if (!src) return;
  checkpoint();
  const l = { ...deepClone(cloneLayer(src)), id: uid('L'), name: uniqueName(p, src.name + ' copy') };
  p.layers.splice(layerIndex(p, id) + 1, 0, l);
  for (const f of p.frames) {
    if (f.poses[id]) f.poses[l.id] = deepClone(f.poses[id]);
    if (f.draws[id]) f.draws[l.id] = f.draws[id].slice();
    if (f.xf[id]) f.xf[l.id] = { ...f.xf[id] };
  }
  app.activeLayer = l.id;
  changed('layers', 'content');
}

export function toggleLayer(id, key) {
  const l = layerById(P(), id);
  if (!l) return;
  checkpoint();
  l[key] = !l[key];
  if (app.sel?.id === id && (key === 'locked' ? l.locked : !l.visible)) app.sel = null;
  changed('layers', 'content', 'sel');
}

export async function renameLayer(id = app.activeLayer) {
  const l = layerById(P(), id);
  if (!l) return;
  const name = await promptDialog('Rename layer', l.name, { ok: 'Rename' });
  if (!name) return;
  checkpoint();
  l.name = name;
  changed('layers');
}

export function setActiveLayer(id) {
  const l = layerById(P(), id);
  if (!l) return;
  app.activeLayer = id;
  if (l.kind === 'figure' && curFrame().poses[id] && l.visible && !l.locked) select({ type: 'figure', id, node: null });
  else if (app.sel && app.sel.id !== id) select(null);
  changed('layers');
}

export async function importImage() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const { src, w, h } = await loadImageFile(file);
    checkpoint();
    const l = addImageLayer(P(), src, w, h, file.name.replace(/\.[^.]+$/, '') || 'Image', app.activeLayer);
    changed('layers', 'content');
    select({ type: 'layer', id: l.id });
    setTool('select');
    toast('Image added — lower its opacity in Properties to trace over it', { ms: 2600 });
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

// Insert library drawings into the active drawing layer at the view centre.
export function insertDrawing(strokes, name) {
  const p = P(), f = curFrame();
  checkpoint();
  let target = activeLayer();
  if (!target || target.kind !== 'draw' || target.locked) {
    target = addDrawLayer(p, 'sprite', name || 'Drawing', app.activeLayer);
  }
  const [x, y] = insertPoint();
  const m = chain(inv(stageMat(target)), translate(x, y));
  const placed = deepClone(strokes).map((s) => transformStroke(s, m));
  setStrokes(target, f, [...getStrokes(target, f), ...placed]);
  app.activeLayer = target.id;
  changed('layers', 'content');
  select({ type: 'strokes', id: target.id, strokes: placed });
  app.tool = 'select';
  changed('tool');
}
