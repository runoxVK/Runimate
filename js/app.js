// Global editor state, change notifications and undo history.
import { cloneProject, layerById, getStrokes } from './model.js';

export const app = {
  project: null,
  cur: 0, // current keyframe index
  frameSel: null, // [a, b] keyframe range for copy/delete, or null
  sel: null, // { type: 'figure', id, node } | { type: 'layer', id } | { type: 'strokes', id, strokes }
  activeLayer: null,
  tool: 'select',
  poseMode: 'rotate', // rotate | stretch | ik
  brush: { color: '#1b1b1f', size: 6, opacity: 1, smooth: 0.45, pressure: true, taper: true, preset: 'pen' },
  eraser: { size: 24, mode: 'cut' },
  shape: { stroke: true, fill: false, fillColor: '#4fc3f7' },
  fillTool: { color: '#4fc3f7', opacity: 1 },
  swatches: ['#1b1b1f', '#ffffff', '#ef5350', '#ff9800', '#ffd54f', '#66bb6a', '#4fc3f7', '#5c6bc0', '#ab47bc', '#8d6e63', '#9e9e9e', '#f8bbd0'],
  onion: { on: true, before: 1, after: 1, opacity: 0.35 },
  grid: false,
  snap: false,
  fingerDraws: true, // turned off automatically once an Apple Pencil / stylus is used
  playing: false,
  playEntry: 0,
  preview: null, // expanded-timeline entry being scrubbed, or null
  boneDraw: null, // { id, node } while drawing art onto a bone
  attachPending: false, // waiting for a bone click to attach selected strokes
  ruler: null, // drawing guide, see ruler.js
  clipboard: null,
  fileHandle: null,
  rev: 0,
  savedRev: 0,
};

const PREF_KEYS = ['brush', 'eraser', 'shape', 'fillTool', 'swatches', 'onion', 'grid', 'snap', 'poseMode', 'fingerDraws', 'ruler'];
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('runimate.prefs') || '{}');
    for (const k of PREF_KEYS) if (k in p) app[k] = typeof app[k] === 'object' && !Array.isArray(app[k]) ? { ...app[k], ...p[k] } : p[k];
  } catch {}
}
let prefTimer = 0;
function savePrefs() {
  clearTimeout(prefTimer);
  prefTimer = setTimeout(() => {
    const out = {};
    for (const k of PREF_KEYS) out[k] = app[k];
    try { localStorage.setItem('runimate.prefs', JSON.stringify(out)); } catch {}
  }, 400);
}

// ---- change notifications (batched per microtask) ----
const listeners = [];
let pending = null;
export const onChange = (fn) => listeners.push(fn);
export function changed(...flags) {
  if (flags.some((f) => f === 'content' || f === 'frames' || f === 'layers' || f === 'project')) app.rev++;
  if (flags.includes('prefs') || flags.includes('tool') || flags.includes('pref-save')) savePrefs();
  if (!pending) {
    pending = new Set();
    queueMicrotask(() => {
      const set = pending;
      pending = null;
      for (const fn of listeners) fn(set);
    });
  }
  for (const f of flags) pending.add(f);
}

// ---- accessors ----
export const P = () => app.project;
export const curFrame = () => app.project.frames[app.cur];
export const activeLayer = () => layerById(app.project, app.activeLayer);
export const selLayer = () => (app.sel ? layerById(app.project, app.sel.id) : null);

export function select(sel) {
  app.sel = sel;
  if (sel) app.activeLayer = sel.id;
  app.attachPending = false;
  changed('sel');
}

export function goto(k) {
  const n = app.project.frames.length;
  k = Math.max(0, Math.min(n - 1, k));
  if (k === app.cur && !app.preview) return;
  app.cur = k;
  app.preview = null;
  if (app.sel && app.sel.type === 'strokes') app.sel = null;
  if (app.sel && app.sel.type === 'figure' && !curFrame().poses[app.sel.id]) app.sel = null;
  changed('frame', 'sel');
}

// ---- undo history ----
const LIMIT = 120;
const undoStack = [], redoStack = [];
let lastKey = null, lastT = 0;

// Call BEFORE mutating. Repeated calls with the same key within a short window coalesce
// (slider drags, held arrow keys).
export function checkpoint(key = null) {
  const now = performance.now();
  if (key && key === lastKey && now - lastT < 900) {
    lastT = now;
    return;
  }
  undoStack.push(snapshot());
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastKey = key;
  lastT = now;
}
export const breakCoalesce = () => (lastKey = null);
// Drops the checkpoint just taken when the action turned out to change nothing.
export function cancelCheckpoint() {
  undoStack.pop();
  lastKey = null;
}

const snapshot = () => ({ project: cloneProject(app.project), cur: app.cur, active: app.activeLayer });

function restore(s) {
  app.project = s.project;
  app.cur = Math.min(s.cur, app.project.frames.length - 1);
  app.activeLayer = layerById(app.project, s.active) ? s.active : app.project.layers.at(-1)?.id || null;
  app.preview = null;
  app.frameSel = null;
  validateSelection();
  changed('project');
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  lastKey = null;
  return true;
}
export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  lastKey = null;
  return true;
}
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = null;
}

export function validateSelection() {
  const s = app.sel;
  if (!s) return;
  const layer = layerById(app.project, s.id);
  if (!layer) return (app.sel = null);
  if (s.type === 'figure') {
    if (!curFrame().poses[s.id]) app.sel = null;
    else if (s.node && !layer.rig.nodes.some((n) => n.id === s.node)) s.node = null;
  } else if (s.type === 'strokes') {
    const all = new Set(getStrokes(layer, curFrame()));
    s.strokes = s.strokes.filter((x) => all.has(x));
    if (!s.strokes.length) app.sel = null;
  }
}

export function setProject(p) {
  app.project = p;
  app.cur = 0;
  app.sel = null;
  app.frameSel = null;
  app.preview = null;
  app.boneDraw = null;
  app.activeLayer = p.layers.at(-1)?.id || null;
  app.rev = 0;
  app.savedRev = 0;
  clearHistory();
  changed('project');
}
