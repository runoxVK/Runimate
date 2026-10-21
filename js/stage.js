// The stage canvas: view transform, rendering with onion skins and overlays,
// and pointer/touch/pen interaction for every tool.
import { app, P, curFrame, activeLayer, changed, checkpoint, cancelCheckpoint, select, undo, redo } from './app.js';
import { layerById, getStrokes, setStrokes, addDrawLayer, getXf } from './model.js';
import { computeWorld, figureBounds, poseRotate, poseIK, boneMatrix, nodeById } from './rig.js';
import { renderScene, scratchCanvas, layerMatrix, setImageLoadHandler } from './render.js';
import { drawStroke, strokesBox, hitStroke, eraseCut, eraseWhole, transformStroke, finishFreehand, shapePoints } from './brush.js';
import { evalKey, evalEntry } from './tween.js';
import { currentEntry, stop as stopPlayback } from './player.js';
import { apply, inv, chain, translate, rotate, scale, segDist, pointInPoly, boxTransform, boxValid, DEG, clamp, round2 } from './geom.js';
import { toast, popupMenu } from './ui.js';
import { snapper, mirrorMatrix, rulerHandles, dragRulerHandle, drawRuler, ruler } from './ruler.js';

export const view = { z: 1, x: 0, y: 0 };
let canvas, ctx, dpr = 1, cssW = 0, cssH = 0;
let needsRender = false;
let hover = null; // { x, y } screen, for brush cursor
let drag = null;
const pointers = new Map();
let gesture = null;
let tapInfo = null;
let longPress = 0;
let lastFit = null;
export let contextMenuProvider = () => [];
export const setContextMenuProvider = (fn) => (contextMenuProvider = fn);

export const requestRender = () => {
  if (!needsRender) {
    needsRender = true;
    requestAnimationFrame(frame);
    // rAF is paused for background pages; make sure a render still lands.
    setTimeout(frame, 100);
  }
};
function frame() {
  if (!needsRender) return;
  needsRender = false;
  render();
}

export function initStage(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas.parentElement);
  resize();
  setImageLoadHandler(() => { requestRender(); changed('thumbs'); });
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', () => { hover = null; requestRender(); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  });
  // Block Safari page pinch-zoom over the stage.
  for (const t of ['gesturestart', 'gesturechange']) canvas.addEventListener(t, (e) => e.preventDefault());
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const firstTime = !cssW;
  cssW = Math.max(1, r.width);
  cssH = Math.max(1, r.height);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  if (firstTime || lastFit) fit();
  requestRender();
}

export function fit() {
  const p = P();
  if (!p) return;
  const pad = 32;
  const z = Math.max(0.05, Math.min((cssW - pad * 2) / p.width, (cssH - pad * 2) / p.height));
  view.z = z;
  view.x = (cssW - p.width * z) / 2;
  view.y = (cssH - p.height * z) / 2;
  lastFit = true;
  requestRender();
  changed('view');
}
export function zoomBy(k, sx = cssW / 2, sy = cssH / 2) {
  const nz = clamp(view.z * k, 0.05, 16);
  const [x, y] = toStage(sx, sy);
  view.z = nz;
  view.x = sx - x * nz;
  view.y = sy - y * nz;
  lastFit = null;
  requestRender();
  changed('view');
}
export function zoomTo(z) {
  zoomBy(z / view.z);
}

export const toStage = (sx, sy) => [(sx - view.x) / view.z, (sy - view.y) / view.z];
export const toScreen = (x, y) => [x * view.z + view.x, y * view.z + view.y];
export const viewCenter = () => toStage(cssW / 2, cssH / 2);

// ---------------------------------------------------------------- state helpers
export function displayState() {
  const e = currentEntry();
  return e ? evalEntry(P(), e) : evalKey(P(), app.cur);
}
const editable = () => !app.playing && app.preview == null;

function layerMat(layer) {
  return layerMatrix(layer, getXf(curFrame(), layer.id));
}

export function ensureXf(layer) {
  const f = curFrame();
  if (!f.xf[layer.id]) f.xf[layer.id] = { x: 0, y: 0, r: 0, s: 1 };
  return f.xf[layer.id];
}

function layerContentBox(layer) {
  if (layer.kind === 'image') return { x0: 0, y0: 0, x1: layer.w, y1: layer.h };
  return strokesBox(getStrokes(layer, curFrame()));
}

// Sets the rotate/scale pivot to the content centre without moving anything on any frame.
export function ensurePivot(layer) {
  if (layer.pv) return;
  const b = layerContentBox(layer);
  const q = boxValid(b) ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : [P().width / 2, P().height / 2];
  for (const f of P().frames) {
    const xf = f.xf[layer.id];
    if (!xf) continue;
    const c = Math.cos(xf.r) * xf.s, s = Math.sin(xf.r) * xf.s;
    xf.x = xf.x - q[0] + (c * q[0] - s * q[1]);
    xf.y = xf.y - q[1] + (s * q[0] + c * q[1]);
  }
  layer.pv = q;
}

// Where freehand drawing goes. Returns { layer } or { bone } or null.
function drawTarget() {
  const p = P();
  if (app.boneDraw) {
    const layer = layerById(p, app.boneDraw.id);
    const pose = curFrame().poses[app.boneDraw.id];
    const node = layer && nodeById(layer.rig, app.boneDraw.node);
    if (!layer || !pose || !node) {
      app.boneDraw = null;
      changed('sel');
      return null;
    }
    return { bone: { layer, node, pose } };
  }
  const a = activeLayer();
  if (a && a.kind === 'draw') {
    if (a.locked) return toast(`“${a.name}” is locked`, { kind: 'warn' }), null;
    if (!a.visible) return toast(`“${a.name}” is hidden`, { kind: 'warn' }), null;
    return { layer: a };
  }
  for (let i = p.layers.length - 1; i >= 0; i--) {
    const l = p.layers[i];
    if (l.kind === 'draw' && !l.locked && l.visible) {
      app.activeLayer = l.id;
      changed('layers');
      toast(`Drawing on “${l.name}”`);
      return { layer: l };
    }
  }
  checkpoint();
  const l = addDrawLayer(p, 'frame', 'Drawing');
  app.activeLayer = l.id;
  changed('layers');
  toast(`Added layer “${l.name}”`);
  return { layer: l };
}

// Matrix from target-local coordinates to stage, plus the scale for widths.
function targetMatrix(t) {
  if (t.bone) {
    const w = computeWorld(t.bone.layer.rig, t.bone.pose).get(t.bone.node.id);
    if (!t.bone.node.art) t.bone.node.art = { strokes: [], base: w.len / (t.bone.pose.s || 1), stretch: true };
    return boneMatrix(w, t.bone.pose);
  }
  return layerMat(t.layer);
}
const matScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

function targetStrokes(t) {
  return t.bone ? t.bone.node.art.strokes : getStrokes(t.layer, curFrame());
}
function setTargetStrokes(t, arr) {
  if (t.bone) t.bone.node.art.strokes = arr;
  else setStrokes(t.layer, curFrame(), arr);
}

// ---------------------------------------------------------------- hit testing
const hitRadius = (type) => (type === 'touch' ? 22 : type === 'pen' ? 13 : 10);

function figureLayers() {
  const p = P(), f = curFrame();
  return p.layers.filter((l) => l.kind === 'figure' && l.visible && !l.locked && f.poses[l.id]);
}

function hitNode(sx, sy, r) {
  const f = curFrame();
  const layers = figureLayers().reverse();
  // Selected figure first so its nodes win when figures overlap.
  if (app.sel?.type === 'figure') layers.sort((a, b) => (b.id === app.sel.id) - (a.id === app.sel.id));
  for (const layer of layers) {
    const world = computeWorld(layer.rig, f.poses[layer.id]);
    let best = null, bd = r;
    for (const n of layer.rig.nodes) {
      const w = world.get(n.id);
      const [x, y] = toScreen(w.x, w.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d <= bd) {
        bd = d;
        best = n.id;
      }
    }
    if (best) return { layer, node: best, world };
  }
  return null;
}

function hitFigureBody(x, y, tolStage) {
  const f = curFrame();
  for (const layer of figureLayers().reverse()) {
    const world = computeWorld(layer.rig, f.poses[layer.id]);
    for (const n of layer.rig.nodes) {
      const w = world.get(n.id);
      if (w.root) continue;
      const th = (n.thick * f.poses[layer.id].s) / 2;
      if (n.shape === 'circle' || n.shape === 'filled') {
        const cx = (w.x + w.px) / 2, cy = (w.y + w.py) / 2;
        if (Math.hypot(x - cx, y - cy) <= w.len / 2 + th + tolStage) return layer;
      } else if (n.shape !== 'none' && segDist(x, y, w.px, w.py, w.x, w.y) <= th + tolStage) return layer;
      if (n.art && n.art.strokes.length) {
        const m = inv(boneMatrix(w, f.poses[layer.id]));
        const [lx, ly] = apply(m, x, y);
        if (n.art.strokes.some((s) => hitStroke(s, lx, ly, tolStage / matScale(boneMatrix(w, f.poses[layer.id]))))) return layer;
      }
    }
  }
  return null;
}

function hitDrawLayer(x, y, tolStage) {
  const p = P(), f = curFrame();
  for (let i = p.layers.length - 1; i >= 0; i--) {
    const l = p.layers[i];
    if (!l.visible || l.locked || l.kind === 'figure') continue;
    const m = layerMat(l);
    const [lx, ly] = apply(inv(m), x, y);
    if (l.kind === 'image') {
      if (lx >= 0 && ly >= 0 && lx <= l.w && ly <= l.h) return l;
      continue;
    }
    const tol = tolStage / matScale(m);
    if (getStrokes(l, f).some((s) => hitStroke(s, lx, ly, tol, true))) return l;
  }
  return null;
}

// Selection bounding box in stage space plus the rotate/scale pivot.
export function selectionBox() {
  const s = app.sel;
  if (!s) return null;
  const layer = layerById(P(), s.id);
  if (!layer) return null;
  if (s.type === 'figure') {
    const pose = curFrame().poses[s.id];
    if (!pose) return null;
    const world = computeWorld(layer.rig, pose);
    return { box: figureBounds(layer.rig, world), pivot: [pose.x, pose.y] };
  }
  if (s.type === 'layer') {
    const lb = layerContentBox(layer);
    if (!boxValid(lb)) return null;
    const m = layerMat(layer);
    const box = boxTransform(lb, m);
    const pivot = layer.pv ? apply(m, layer.pv[0], layer.pv[1]) : [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    return { box, pivot };
  }
  if (s.type === 'strokes') {
    const lb = strokesBox(s.strokes);
    if (!boxValid(lb)) return null;
    const box = boxTransform(lb, layerMat(layer));
    return { box, pivot: [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2] };
  }
  return null;
}

function handlePositions(sb) {
  const [x0, y0] = toScreen(sb.box.x0, sb.box.y0);
  const [x1, y1] = toScreen(sb.box.x1, sb.box.y1);
  return { x0, y0, x1, y1, rot: [(x0 + x1) / 2, y0 - 28], scl: [x1 + 8, y1 + 8] };
}

// ---------------------------------------------------------------- pointer input
function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function pressureOf(e) {
  if (e.pointerType !== 'pen' || !app.brush.pressure) return 1;
  const p = e.pressure || 0.5;
  return clamp(0.12 + 0.88 * Math.pow(p, 0.8), 0.05, 1);
}

const DEADZONE = new Set(['node', 'figure-move', 'xform', 'pan']);
const DRAW_TOOLS = new Set(['brush', 'eraser', 'fill', 'line', 'rect', 'ellipse', 'lasso']);

function onDown(e) {
  if (!P()) return;
  canvas.focus({ preventScroll: true });
  // On narrow screens the side panel floats over the stage; touching the stage tucks it away.
  if (app.panelOpen && innerWidth < 900) {
    app.panelOpen = false;
    changed('panel');
  }
  if (e.pointerType === 'pen' && app.fingerDraws) {
    app.fingerDraws = false;
    changed('prefs');
    toast('Stylus detected — fingers now pan, zoom and tap-undo');
  }
  canvas.setPointerCapture(e.pointerId);
  const [sx, sy] = localPoint(e);
  pointers.set(e.pointerId, { x: sx, y: sy, type: e.pointerType, t: performance.now(), sx, sy });

  const touches = [...pointers.values()].filter((p) => p.type === 'touch');
  if (touches.length === 2 && e.pointerType === 'touch') {
    abortDrag();
    startGesture(touches);
    return;
  }
  if (gesture || pointers.size > 1) return;

  if (app.playing) stopPlayback();
  if (app.preview != null) {
    app.preview = null;
    changed('playframe', 'frame');
  }

  // Ruler handles win over drawing so the guide can be moved with any drawing tool.
  if (editable()) {
    const hr = hitRadius(e.pointerType) + 4;
    const hit = rulerHandles().find((hd) => {
      const [hx, hy] = toScreen(...hd.p);
      return Math.hypot(hx - sx, hy - sy) <= hr;
    });
    if (hit) {
      const [x, y] = toStage(sx, sy);
      drag = { kind: 'ruler', id: hit.id, x0: x, y0: y, start: JSON.parse(JSON.stringify(ruler())) };
      return;
    }
  }

  const fingerNav = e.pointerType === 'touch' && !app.fingerDraws && (DRAW_TOOLS.has(app.tool) || app.tool === 'eyedropper');
  if (e.button === 1 || app.tool === 'hand' || fingerNav || spaceHeld) {
    drag = { kind: 'pan', sx, sy, vx: view.x, vy: view.y };
    return;
  }
  if (e.button === 2) return;

  if (e.pointerType === 'touch' && app.tool === 'select') {
    clearTimeout(longPress);
    longPress = setTimeout(() => {
      if (drag && !drag.moved) {
        abortDrag();
        openContextMenu(e.clientX, e.clientY);
      }
    }, 550);
  }
  startTool(e, sx, sy);
}

function onMove(e) {
  const [sx, sy] = localPoint(e);
  const ptr = pointers.get(e.pointerId);
  if (ptr) {
    ptr.x = sx;
    ptr.y = sy;
  }
  if (e.pointerType !== 'touch') {
    hover = { x: sx, y: sy };
    if (!drag) requestRender();
  }
  if (gesture) return moveGesture();
  if (!drag || !ptr) return;
  if (!drag.moved && Math.hypot(sx - ptr.sx, sy - ptr.sy) > (ptr.type === 'touch' ? 8 : 3)) {
    drag.moved = true;
    clearTimeout(longPress);
  }
  // Taps on nodes / objects only select; editing starts once the pointer really moves.
  if (!drag.moved && DEADZONE.has(drag.kind)) return;
  const evs = drag.kind === 'brush' || drag.kind === 'fill' ? e.getCoalescedEvents?.() || [e] : [e];
  for (const ev of evs) {
    const [x, y] = ev === e ? [sx, sy] : localPoint(ev);
    moveTool(ev, x, y);
  }
  requestRender();
}

function onUp(e) {
  clearTimeout(longPress);
  const ptr = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (gesture) {
    if (pointers.size === 0) endGesture();
    return;
  }
  if (drag && ptr) {
    const [sx, sy] = localPoint(e);
    endTool(e, sx, sy);
  }
  drag = null;
  requestRender();
}

function onCancel(e) {
  clearTimeout(longPress);
  pointers.delete(e.pointerId);
  if (gesture && pointers.size === 0) gesture = null;
  if (drag) abortDrag();
}

function abortDrag() {
  if (!drag) return;
  if (drag.kind === 'brush' || drag.kind === 'fill' || drag.kind === 'shape' || drag.kind === 'lasso') drag = null;
  else if (drag.kind === 'pan') drag = null;
  else drag = null; // pose / transform edits already applied stay (undo restores them)
  requestRender();
}

// Two-finger pinch zoom + pan. A quick two-finger tap is undo, three-finger tap redo.
function startGesture(touches) {
  const [a, b] = touches;
  gesture = {
    d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    z: view.z, vx: view.x, vy: view.y, t: performance.now(), moved: false, fingers: 2,
  };
}
function moveGesture() {
  const t = [...pointers.values()].filter((p) => p.type === 'touch');
  if (t.length === 3) gesture.fingers = 3;
  if (t.length < 2) return;
  const [a, b] = t;
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  if (Math.abs(d - gesture.d) > 8 || Math.hypot(mx - gesture.mx, my - gesture.my) > 8) gesture.moved = true;
  const z = clamp(gesture.z * (d / gesture.d), 0.05, 16);
  const sx = (gesture.mx - gesture.vx) / gesture.z, sy = (gesture.my - gesture.vy) / gesture.z;
  view.z = z;
  view.x = mx - sx * z;
  view.y = my - sy * z;
  lastFit = null;
  requestRender();
}
function endGesture() {
  const g = gesture;
  gesture = null;
  if (!g.moved && performance.now() - g.t < 350) {
    if (g.fingers === 3 ? redo() : undo()) toast(g.fingers === 3 ? 'Redo' : 'Undo', { ms: 900 });
  }
  changed('view');
}

let spaceHeld = false;
export const setSpaceHeld = (v) => (spaceHeld = v);

function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = localPoint(e);
  if (e.ctrlKey || e.metaKey) {
    zoomBy(Math.exp(-e.deltaY * 0.01), sx, sy);
  } else {
    const k = e.deltaMode === 1 ? 16 : 1;
    view.x -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
    view.y -= (e.shiftKey ? 0 : e.deltaY) * k;
    lastFit = null;
    requestRender();
  }
}

// ---------------------------------------------------------------- tools
function startTool(e, sx, sy) {
  if (!editable()) return;
  const [x, y] = toStage(sx, sy);
  const tool = app.tool;
  if (tool === 'select' || app.attachPending) return startSelect(e, sx, sy, x, y);
  if (tool === 'eyedropper') return eyedrop(sx, sy);
  if (e.altKey && (tool === 'brush' || tool === 'fill')) return eyedrop(sx, sy, true);
  if (tool === 'lasso') {
    drag = { kind: 'lasso', pts: [x, y], add: e.shiftKey, sx, sy };
    // Clicking inside the current selection moves it instead.
    const sb = selectionBox();
    if (app.sel?.type === 'strokes' && sb) {
      const h = handlePositions(sb);
      if (Math.hypot(sx - h.rot[0], sy - h.rot[1]) < 14) return beginTransform('rotate', sb, x, y);
      if (Math.hypot(sx - h.scl[0], sy - h.scl[1]) < 14) return beginTransform('scale', sb, x, y);
      if (x >= sb.box.x0 && x <= sb.box.x1 && y >= sb.box.y0 && y <= sb.box.y1 && !e.shiftKey) return beginTransform('move', sb, x, y);
    }
    return;
  }
  const target = drawTarget();
  if (!target) return;
  const m = targetMatrix(target);
  const mi = inv(m);
  const ms = matScale(m);
  const mirror = mirrorMatrix();
  if (tool === 'brush' || tool === 'fill') {
    const snap = tool === 'brush' ? snapper(x, y, view.z) : null;
    const [qx, qy] = snap ? snap(x, y) : [x, y];
    const [lx, ly] = apply(mi, qx, qy);
    drag = { kind: tool, target, m, mi, ms, mirror, snap, fx: qx, fy: qy, pts: [lx, ly, pressureOf(e)], lastS: [sx, sy] };
  } else if (tool === 'eraser') {
    checkpoint();
    drag = { kind: 'erase', target, mi, ms, mirror, snap: snapper(x, y, view.z), last: null, changed: false };
    eraseAt(x, y);
  } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
    drag = { kind: 'shape', shape: tool, target, m, mi, ms, mirror, x0: x, y0: y, x1: x, y1: y };
  }
}

function startSelect(e, sx, sy, x, y) {
  const f = curFrame();
  const r = hitRadius(e.pointerType);
  // 1. transform handles
  const sb = selectionBox();
  if (sb && !app.attachPending) {
    const h = handlePositions(sb);
    if (Math.hypot(sx - h.rot[0], sy - h.rot[1]) < r + 4) return beginTransform('rotate', sb, x, y);
    if (Math.hypot(sx - h.scl[0], sy - h.scl[1]) < r + 4) return beginTransform('scale', sb, x, y);
  }
  // 2. nodes
  const hn = hitNode(sx, sy, r);
  if (hn) {
    if (app.attachPending) return attachToBone(hn.layer, hn.node);
    const pose = f.poses[hn.layer.id];
    const w = hn.world.get(hn.node);
    select({ type: 'figure', id: hn.layer.id, node: hn.node });
    checkpoint();
    drag = { kind: 'node', layer: hn.layer, node: hn.node, pose, ox: w.x - x, oy: w.y - y, px: pose.x, py: pose.y, x0: x, y0: y };
    return;
  }
  if (app.attachPending) {
    toast('Tap a node (joint) to attach the drawing to its bone');
    return;
  }
  const tol = (e.pointerType === 'touch' ? 14 : 6) / view.z;
  // 3. figure bodies
  const fl = hitFigureBody(x, y, tol);
  if (fl) {
    const pose = f.poses[fl.id];
    if (!(app.sel?.type === 'figure' && app.sel.id === fl.id)) select({ type: 'figure', id: fl.id, node: null });
    checkpoint();
    drag = { kind: 'figure-move', pose, x0: x, y0: y, px: pose.x, py: pose.y };
    return;
  }
  // 4. inside an existing layer / strokes selection box
  if (sb && (app.sel.type === 'layer' || app.sel.type === 'strokes') && x >= sb.box.x0 && x <= sb.box.x1 && y >= sb.box.y0 && y <= sb.box.y1) {
    return beginTransform('move', sb, x, y);
  }
  // 5. drawing / image layers
  const dl = hitDrawLayer(x, y, tol);
  if (dl) {
    select({ type: 'layer', id: dl.id });
    return beginTransform('move', selectionBox(), x, y);
  }
  // 6. empty space: deselect and pan
  if (app.sel) select(null);
  drag = { kind: 'pan', sx, sy, vx: view.x, vy: view.y };
}

function beginTransform(mode, sb, x, y) {
  const s = app.sel;
  const layer = layerById(P(), s.id);
  checkpoint();
  const d = { kind: 'xform', mode, sel: s, layer, x0: x, y0: y, pivot: sb.pivot };
  d.a0 = Math.atan2(y - sb.pivot[1], x - sb.pivot[0]);
  d.d0 = Math.hypot(x - sb.pivot[0], y - sb.pivot[1]) || 1;
  if (s.type === 'figure') {
    const pose = curFrame().poses[s.id];
    d.pose = pose;
    d.orig = { x: pose.x, y: pose.y, r: pose.r, s: pose.s };
  } else if (s.type === 'layer') {
    if (mode !== 'move') {
      ensurePivot(layer);
      d.pivot = apply(layerMat(layer), layer.pv[0], layer.pv[1]);
    }
    const xf = ensureXf(layer);
    d.xf = xf;
    d.orig = { ...xf };
  } else if (s.type === 'strokes') {
    d.m = layerMat(layer);
    d.mi = inv(d.m);
    d.orig = s.strokes.slice();
  }
  drag = d;
}

function moveTool(e, sx, sy) {
  const [x, y] = toStage(sx, sy);
  const d = drag;
  switch (d.kind) {
    case 'pan':
      view.x = d.vx + (sx - d.sx);
      view.y = d.vy + (sy - d.sy);
      lastFit = null;
      break;
    case 'ruler':
      dragRulerHandle(d.id, x, y, d.x0, d.y0, d.start, e.shiftKey);
      break;
    case 'node': {
      const layer = d.layer;
      const world = computeWorld(layer.rig, d.pose);
      const w = world.get(d.node);
      const tx = x + d.ox, ty = y + d.oy;
      if (w.root) {
        d.pose.x = d.px + (x - d.x0);
        d.pose.y = d.py + (y - d.y0);
      } else if (app.poseMode === 'ik' && !e.shiftKey) poseIK(d.pose, world, d.node, tx, ty);
      else poseRotate(d.pose, world, d.node, tx, ty, { stretch: app.poseMode === 'stretch', snap: e.shiftKey || app.snap });
      changed('content');
      break;
    }
    case 'figure-move':
      d.pose.x = d.px + (x - d.x0);
      d.pose.y = d.py + (y - d.y0);
      changed('content');
      break;
    case 'xform':
      moveTransform(d, x, y, e.shiftKey || app.snap);
      changed('content');
      break;
    case 'brush':
    case 'fill': {
      const last = d.lastS;
      if (Math.hypot(sx - last[0], sy - last[1]) < 1.2) return;
      d.lastS = [sx, sy];
      if (d.snap) {
        // Along a ruler the line is already straight / round, so skip smoothing lag.
        [d.fx, d.fy] = d.snap(x, y);
      } else {
        const k = d.kind === 'brush' ? 1 - app.brush.smooth * 0.85 : 0.6;
        d.fx += (x - d.fx) * k;
        d.fy += (y - d.fy) * k;
      }
      const [lx, ly] = apply(d.mi, d.fx, d.fy);
      d.pts.push(lx, ly, pressureOf(e));
      break;
    }
    case 'erase':
      eraseAt(x, y);
      break;
    case 'shape': {
      let x1 = x, y1 = y;
      if (e.shiftKey) {
        const dx = x - d.x0, dy = y - d.y0;
        if (d.shape === 'line') {
          const a = Math.round(Math.atan2(dy, dx) / (45 * DEG)) * 45 * DEG, L = Math.hypot(dx, dy);
          x1 = d.x0 + Math.cos(a) * L;
          y1 = d.y0 + Math.sin(a) * L;
        } else {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          x1 = d.x0 + Math.sign(dx || 1) * m;
          y1 = d.y0 + Math.sign(dy || 1) * m;
        }
      }
      d.x1 = x1;
      d.y1 = y1;
      d.center = e.altKey && d.shape !== 'line';
      break;
    }
    case 'lasso':
      d.pts.push(x, y);
      break;
  }
}

function moveTransform(d, x, y, snap) {
  const [px, py] = d.pivot;
  let da = Math.atan2(y - py, x - px) - d.a0;
  if (snap && d.mode === 'rotate') da = Math.round(da / (15 * DEG)) * 15 * DEG;
  const k = clamp(Math.hypot(x - px, y - py) / d.d0, 0.02, 50);
  const dx = x - d.x0, dy = y - d.y0;
  if (d.sel.type === 'figure') {
    const p = d.pose, o = d.orig;
    if (d.mode === 'move') { p.x = o.x + dx; p.y = o.y + dy; }
    else if (d.mode === 'rotate') p.r = o.r + da;
    else p.s = clamp(o.s * k, 0.05, 20);
  } else if (d.sel.type === 'layer') {
    const xf = d.xf, o = d.orig;
    if (d.mode === 'move') { xf.x = o.x + dx; xf.y = o.y + dy; }
    else if (d.mode === 'rotate') xf.r = o.r + da;
    else xf.s = clamp(o.s * k, 0.02, 50);
  } else if (d.sel.type === 'strokes') {
    let sm;
    if (d.mode === 'move') sm = translate(dx, dy);
    else if (d.mode === 'rotate') sm = chain(translate(px, py), rotate(da), translate(-px, -py));
    else sm = chain(translate(px, py), scale(k), translate(-px, -py));
    const lm = chain(d.mi, sm, d.m);
    const next = d.orig.map((s) => transformStroke(s, lm));
    const cur = getStrokes(d.layer, curFrame());
    const idx = new Map(cur.map((s, i) => [s, i]));
    const arr = cur.slice();
    d.sel.strokes.forEach((s, i) => {
      const at = idx.get(s);
      if (at != null) arr[at] = next[i];
    });
    setStrokes(d.layer, curFrame(), arr);
    d.sel.strokes = next;
  }
}

function eraseAt(x, y) {
  const d = drag;
  if (d.snap) [x, y] = d.snap(x, y);
  const r = app.eraser.size / 2;
  const steps = d.last ? Math.max(1, Math.ceil(Math.hypot(x - d.last[0], y - d.last[1]) / (r * 0.5))) : 1;
  let arr = targetStrokes(d.target);
  for (let i = 1; i <= steps; i++) {
    const px = d.last ? d.last[0] + ((x - d.last[0]) * i) / steps : x;
    const py = d.last ? d.last[1] + ((y - d.last[1]) * i) / steps : y;
    const lr = r / d.ms;
    const spots = [[px, py]];
    if (d.mirror) spots.push(apply(d.mirror, px, py));
    for (const [qx, qy] of spots) {
      const [lx, ly] = apply(d.mi, qx, qy);
      arr = app.eraser.mode === 'whole' ? eraseWhole(arr, lx, ly, lr) : eraseCut(arr, lx, ly, lr);
    }
  }
  d.last = [x, y];
  if (arr !== targetStrokes(d.target)) {
    setTargetStrokes(d.target, arr);
    d.changed = true;
    changed('content');
  }
}

// d carries the target matrices; with mirror symmetry on, a reflected copy is added too.
function commitStroke(target, stroke, d) {
  checkpoint();
  const add = [stroke];
  if (d?.mirror) add.push(transformStroke(stroke, chain(d.mi, d.mirror, d.m)));
  setTargetStrokes(target, [...targetStrokes(target), ...add]);
  changed('content');
}

function endTool(e, sx, sy) {
  const d = drag;
  const [x, y] = toStage(sx, sy);
  switch (d.kind) {
    case 'pan':
      changed('view');
      break;
    case 'ruler':
      changed('pref-save', 'ruler');
      break;
    case 'node':
    case 'figure-move':
    case 'xform':
      if (!d.moved) cancelCheckpoint(); // a tap only selected something
      else changed('content');
      break;
    case 'brush': {
      // Let the smoothed line catch up to where the pen lifted.
      const [lx, ly] = apply(d.mi, ...(d.snap ? d.snap(x, y) : [x, y]));
      const n = d.pts.length;
      const lp = d.pts[n - 1];
      if (n >= 3 && Math.hypot(lx - d.pts[n - 3], ly - d.pts[n - 2]) > 0.5) d.pts.push(lx, ly, lp);
      const b = app.brush;
      const pts = finishFreehand(d.pts, { taper: b.taper, width: b.size / d.ms });
      commitStroke(d.target, { pts, w: round2(b.size / d.ms), c: b.color, o: b.opacity, fill: null, closed: false }, d);
      break;
    }
    case 'fill': {
      if (d.pts.length < 9) break;
      const pts = finishFreehand(d.pts.map((v, i) => (i % 3 === 2 ? 1 : v)), { taper: false });
      commitStroke(d.target, { pts, w: 0, c: app.fillTool.color, o: app.fillTool.opacity, fill: app.fillTool.color, closed: true }, d);
      break;
    }
    case 'erase':
      if (!d.changed) cancelCheckpoint();
      break;
    case 'shape': {
      const pts = shapeStagePoints(d);
      if (!pts) break;
      const local = [];
      for (let i = 0; i < pts.length; i += 3) {
        const [lx, ly] = apply(d.mi, pts[i], pts[i + 1]);
        local.push(round2(lx), round2(ly), 1);
      }
      const sh = app.shape;
      const closed = d.shape !== 'line';
      const fill = closed && sh.fill ? sh.fillColor : null;
      const w = !closed || sh.stroke || !fill ? round2(app.brush.size / d.ms) : 0;
      commitStroke(d.target, { pts: local, w, c: app.brush.color, o: app.brush.opacity, fill, closed }, d);
      break;
    }
    case 'lasso':
      finishLasso(d, x, y);
      break;
  }
}

function shapeStagePoints(d) {
  let { x0, y0, x1, y1 } = d;
  if (Math.hypot(x1 - x0, y1 - y0) < 2 / view.z) return null;
  if (d.center) {
    const dx = x1 - x0, dy = y1 - y0;
    x0 -= dx;
    y0 -= dy;
  }
  return shapePoints(d.shape, x0, y0, x1, y1);
}

function lassoLayers() {
  const a = activeLayer();
  if (a && a.kind === 'draw' && !a.locked && a.visible) return [a];
  return P().layers.filter((l) => l.kind === 'draw' && !l.locked && l.visible).reverse();
}

function finishLasso(d, x, y) {
  const tap = d.pts.length < 8 || Math.hypot(x - d.pts[0], y - d.pts[1]) * view.z < 4 && d.pts.length < 16;
  const prev = app.sel?.type === 'strokes' && d.add ? app.sel : null;
  for (const layer of lassoLayers()) {
    if (prev && prev.id !== layer.id) continue;
    const m = layerMat(layer), mi = inv(m);
    const strokes = getStrokes(layer, curFrame());
    let hits;
    if (tap) {
      const [lx, ly] = apply(mi, x, y);
      const tol = 8 / view.z / matScale(m);
      const hit = [...strokes].reverse().find((s) => hitStroke(s, lx, ly, tol, true));
      hits = hit ? [hit] : [];
    } else {
      const poly = [];
      for (let i = 0; i < d.pts.length; i += 2) poly.push(...apply(mi, d.pts[i], d.pts[i + 1]));
      hits = strokes.filter((s) => {
        const p = s.pts;
        let inside = 0;
        const n = p.length / 3;
        for (let i = 0; i < n; i++) if (pointInPoly(p[i * 3], p[i * 3 + 1], poly)) inside++;
        return inside >= Math.max(1, n * 0.5);
      });
    }
    if (!hits.length) continue;
    let list = hits;
    if (prev) {
      const set = new Set(prev.strokes);
      for (const s of hits) set.has(s) ? set.delete(s) : set.add(s);
      list = strokes.filter((s) => set.has(s));
    }
    if (list.length) return select({ type: 'strokes', id: layer.id, strokes: list });
  }
  if (!prev) select(null);
}

function eyedrop(sx, sy, keepTool = false) {
  render(true);
  const px = ctx.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data;
  const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  if (app.tool === 'fill' || app.prevTool === 'fill') app.fillTool.color = hex;
  else app.brush.color = hex;
  if (!keepTool && app.tool === 'eyedropper') app.tool = app.prevTool || 'brush';
  changed('tool', 'prefs');
  toast(`Picked ${hex}`, { ms: 1200 });
}

// ---------------------------------------------------------------- bone art
export function startAttach() {
  if (app.sel?.type !== 'strokes') return toast('Select strokes with the lasso first');
  if (!figureLayers().length) return toast('There is no figure on this frame to attach to');
  app.attachPending = true;
  changed('sel');
  toast('Now tap the node at the end of the bone to attach to');
}

function attachToBone(layer, nodeId) {
  const s = app.sel;
  const src = layerById(P(), s.id);
  const node = nodeById(layer.rig, nodeId);
  const pose = curFrame().poses[layer.id];
  checkpoint();
  const w = computeWorld(layer.rig, pose).get(nodeId);
  if (!node.art) node.art = { strokes: [], base: w.len / (pose.s || 1), stretch: !w.root };
  const m = chain(inv(boneMatrix(w, pose)), layerMat(src));
  node.art.strokes = [...node.art.strokes, ...s.strokes.map((st) => transformStroke(st, m))];
  const gone = new Set(s.strokes);
  setStrokes(src, curFrame(), getStrokes(src, curFrame()).filter((x) => !gone.has(x)));
  app.attachPending = false;
  select({ type: 'figure', id: layer.id, node: nodeId });
  changed('content', 'layers');
  toast('Attached — the drawing now moves with that bone');
}

export function detachArt(layer, nodeId) {
  const node = nodeById(layer.rig, nodeId);
  const pose = curFrame().poses[layer.id];
  if (!node?.art?.strokes.length || !pose) return;
  checkpoint();
  const w = computeWorld(layer.rig, pose).get(nodeId);
  let target = activeLayer();
  if (!target || target.kind !== 'draw') target = P().layers.findLast((l) => l.kind === 'draw') || addDrawLayer(P(), 'frame', 'Drawing');
  const m = chain(inv(layerMat(target)), boneMatrix(w, pose));
  const moved = node.art.strokes.map((s) => transformStroke(s, m));
  setStrokes(target, curFrame(), [...getStrokes(target, curFrame()), ...moved]);
  node.art = null;
  select({ type: 'strokes', id: target.id, strokes: moved });
  changed('content', 'layers');
  toast(`Moved the art to “${target.name}” on this frame`);
}

// ---------------------------------------------------------------- context menu
function openContextMenu(cx, cy) {
  const items = contextMenuProvider();
  if (!items.length) return;
  const anchor = { getBoundingClientRect: () => ({ left: cx, right: cx, top: cy, bottom: cy }) };
  popupMenu(anchor, items);
}

// ---------------------------------------------------------------- rendering
const ONION_PAST = '#ff4d6d', ONION_FUTURE = '#2bb6a8';

let workspaceColor = null;
function render(noOverlay = false) {
  const p = P();
  if (!p || !ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  workspaceColor ||= getComputedStyle(document.documentElement).getPropertyValue('--workspace').trim() || '#1c1e23';
  ctx.fillStyle = workspaceColor;
  ctx.fillRect(0, 0, W, H);
  const base = [dpr * view.z, 0, 0, dpr * view.z, dpr * view.x, dpr * view.y];
  ctx.setTransform(...base);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 24 * dpr;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, p.width, p.height);
  ctx.restore();

  const st = displayState();
  const editing = editable();
  if (editing && app.onion.on) drawOnion(base);
  renderScene(ctx, p, st);

  // Live previews in their target space.
  // Live previews in their target space (plus the mirrored copy when symmetry is on).
  const copies = drag?.mirror ? [null, drag.mirror] : [null];
  if (drag && (drag.kind === 'brush' || drag.kind === 'fill')) {
    const m = targetMatrix(drag.target);
    const b = app.brush;
    const live = drag.kind === 'brush'
      ? { pts: drag.pts, w: b.size / drag.ms, c: b.color, o: b.opacity, fill: null }
      : { pts: drag.pts, w: 0, c: app.fillTool.color, o: app.fillTool.opacity * 0.8, fill: app.fillTool.color, closed: true };
    for (const mm of copies) {
      ctx.save();
      if (mm) ctx.transform(...mm);
      ctx.transform(...m);
      drawStroke(ctx, live, true);
      ctx.restore();
    }
  }
  if (drag && drag.kind === 'shape') {
    const pts = shapeStagePoints(drag);
    if (pts) {
      const sh = app.shape, closed = drag.shape !== 'line';
      const live = { pts, w: !closed || sh.stroke || !sh.fill ? app.brush.size : 0, c: app.brush.color, o: app.brush.opacity, fill: closed && sh.fill ? sh.fillColor : null, closed };
      for (const mm of copies) {
        ctx.save();
        if (mm) ctx.transform(...mm);
        drawStroke(ctx, live, true);
        ctx.restore();
      }
    }
  }

  // Dim everything outside the camera frame.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  const [ax, ay] = toScreen(0, 0), [bx, by] = toScreen(p.width, p.height);
  ctx.rect(ax * dpr, ay * dpr, (bx - ax) * dpr, (by - ay) * dpr);
  ctx.fillStyle = 'rgba(24,25,29,.62)';
  ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ax * dpr + 0.5, ay * dpr + 0.5, (bx - ax) * dpr - 1, (by - ay) * dpr - 1);
  ctx.restore();

  if (app.grid) drawGrid();
  if (editing && !noOverlay) drawOverlays();
}

function drawOnion(base) {
  const p = P(), o = app.onion;
  const c = scratchCanvas('onion', canvas.width, canvas.height);
  const g = c.getContext('2d');
  const draws = [];
  for (let d = o.before; d >= 1; d--) draws.push([app.cur - d, d, ONION_PAST, o.before]);
  for (let d = o.after; d >= 1; d--) draws.push([app.cur + d, d, ONION_FUTURE, o.after]);
  for (const [k, d, color, count] of draws) {
    if (k < 0 || k >= p.frames.length) continue;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(...base);
    renderScene(g, p, evalKey(p, k), { filter: (l) => l.kind !== 'image' && !(l.kind === 'draw' && l.mode === 'sprite' && !p.frames[k].xf[l.id]) });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = o.opacity * (1 - (d - 1) / (count + 0.5));
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
  g.globalCompositeOperation = 'source-over';
}

function drawGrid() {
  const p = P();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = 'rgba(80,140,255,.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const step = 40;
  for (let x = step; x < p.width; x += step) {
    const [sx] = toScreen(x, 0);
    ctx.moveTo(Math.round(sx) + 0.5, toScreen(0, 0)[1]);
    ctx.lineTo(Math.round(sx) + 0.5, toScreen(0, p.height)[1]);
  }
  for (let y = step; y < p.height; y += step) {
    const [, sy] = toScreen(0, y);
    ctx.moveTo(toScreen(0, 0)[0], Math.round(sy) + 0.5);
    ctx.lineTo(toScreen(p.width, 0)[0], Math.round(sy) + 0.5);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80,140,255,.6)';
  ctx.beginPath();
  for (const t of [1 / 3, 2 / 3]) {
    const [sx] = toScreen(p.width * t, 0), [, sy] = toScreen(0, p.height * t);
    ctx.moveTo(sx, toScreen(0, 0)[1]);
    ctx.lineTo(sx, toScreen(0, p.height)[1]);
    ctx.moveTo(toScreen(0, 0)[0], sy);
    ctx.lineTo(toScreen(p.width, 0)[0], sy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawOverlays() {
  const p = P(), f = curFrame();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tool = app.tool;
  const showNodes = tool === 'select' || app.attachPending;

  // Bone-draw mode: highlight the target bone.
  if (app.boneDraw) {
    const layer = layerById(p, app.boneDraw.id);
    const pose = f.poses[app.boneDraw.id];
    if (layer && pose) {
      const w = computeWorld(layer.rig, pose).get(app.boneDraw.node);
      if (w) {
        const [a, b] = [toScreen(w.px, w.py), toScreen(w.x, w.y)];
        ctx.strokeStyle = 'rgba(255,196,0,.9)';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  if (showNodes) {
    for (const layer of figureLayers()) {
      const pose = f.poses[layer.id];
      const world = computeWorld(layer.rig, pose);
      const isSel = app.sel?.type === 'figure' && app.sel.id === layer.id;
      ctx.globalAlpha = isSel || app.attachPending ? 1 : 0.55;
      for (const n of layer.rig.nodes) {
        const w = world.get(n.id);
        const [x, y] = toScreen(w.x, w.y);
        const selected = isSel && app.sel.node === n.id;
        // Stick Nodes-style handles: thin hollow rings, a square for the main node.
        ctx.beginPath();
        if (w.root) ctx.rect(x - 5.5, y - 5.5, 11, 11);
        else ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        if (selected) {
          ctx.fillStyle = 'rgba(77,163,255,.9)';
          ctx.fill();
        }
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(0,0,0,.5)';
        ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = selected ? '#ffffff' : n.art ? '#d7a6ff' : '#d6d6d6';
        ctx.stroke();
        if (w.root) {
          ctx.beginPath();
          ctx.rect(x - 2, y - 2, 4, 4);
          ctx.fillStyle = selected ? '#ffffff' : '#d6d6d6';
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Selection box with rotate + scale handles.
  const sb = selectionBox();
  if (sb && (tool === 'select' || app.sel.type === 'strokes')) {
    const hp = handlePositions(sb);
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(hp.x0 - 4, hp.y0 - 4, hp.x1 - hp.x0 + 8, hp.y1 - hp.y0 + 8);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo((hp.x0 + hp.x1) / 2, hp.y0 - 4);
    ctx.lineTo(hp.rot[0], hp.rot[1] + 7);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hp.rot[0], hp.rot[1], 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(hp.scl[0] - 6, hp.scl[1] - 6, 12, 12);
    ctx.strokeRect(hp.scl[0] - 6, hp.scl[1] - 6, 12, 12);
    const [px, py] = toScreen(...sb.pivot);
    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px + 5, py);
    ctx.moveTo(px, py - 5);
    ctx.lineTo(px, py + 5);
    ctx.stroke();
  }

  if (drag?.kind === 'lasso' && drag.pts.length > 2) {
    ctx.beginPath();
    for (let i = 0; i < drag.pts.length; i += 2) {
      const [x, y] = toScreen(drag.pts[i], drag.pts[i + 1]);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(77,163,255,.1)';
    ctx.fill();
    ctx.strokeStyle = '#4da3ff';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRuler(ctx, toScreen, view.z, !!drag?.snap);

  // Brush / eraser cursor.
  if (hover && !gesture && ['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(tool)) {
    const r = ((tool === 'eraser' ? app.eraser.size : app.brush.size) * view.z) / 2;
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, Math.max(1.5, r), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- keyboard posing
// Arrow keys pose the selected node / move the selection. Returns true if handled.
export function stageKey(e) {
  if (!editable()) return false;
  const s = app.sel;
  const f = curFrame();
  const step = e.shiftKey ? 15 : e.altKey ? 1 : 5;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const dir = arrows[e.key];

  if (e.key === 'Tab' && s?.type === 'figure') {
    const layer = layerById(P(), s.id);
    const ids = layer.rig.nodes.map((n) => n.id);
    const i = ids.indexOf(s.node);
    s.node = ids[(i + (e.shiftKey ? -1 : 1) + ids.length) % ids.length] ?? ids[0];
    changed('sel');
    return true;
  }
  if (!dir || !s) return false;
  const layer = layerById(P(), s.id);
  if (!layer) return false;
  checkpoint('key:' + e.key + s.id + (s.node || ''));
  const ctrl = e.ctrlKey || e.metaKey;

  if (s.type === 'figure') {
    const pose = f.poses[s.id];
    if (!pose) return false;
    const node = s.node && nodeById(layer.rig, s.node);
    if (ctrl) {
      if (dir[0]) pose.r += dir[0] * step * DEG;
      if (dir[1]) pose.s = clamp(pose.s * (1 - dir[1] * step * 0.01), 0.05, 20);
    } else if (node && node.parent) {
      if (dir[0]) pose.a[node.id] = (pose.a[node.id] ?? node.ang) + dir[0] * step * DEG;
      if (dir[1]) pose.l[node.id] = Math.max(1, (pose.l[node.id] ?? node.len) - dir[1] * step);
    } else {
      pose.x += dir[0] * step;
      pose.y += dir[1] * step;
    }
  } else if (s.type === 'layer') {
    const xf = ensureXf(layer);
    if (ctrl) {
      ensurePivot(layer);
      if (dir[0]) xf.r += dir[0] * step * DEG;
      if (dir[1]) xf.s = clamp(xf.s * (1 - dir[1] * step * 0.01), 0.02, 50);
    } else {
      xf.x += dir[0] * step;
      xf.y += dir[1] * step;
    }
  } else if (s.type === 'strokes') {
    const m = layerMat(layer);
    const lm = chain(inv(m), translate(dir[0] * step, dir[1] * step), m);
    const next = s.strokes.map((x) => transformStroke(x, lm));
    const map = new Map(s.strokes.map((x, i) => [x, next[i]]));
    setStrokes(layer, f, getStrokes(layer, f).map((x) => map.get(x) || x));
    s.strokes = next;
  }
  changed('content');
  return true;
}

export const stageCanvas = () => canvas;
export const stageSize = () => [cssW, cssH];
