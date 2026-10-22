// Asset library: saved figures and drawings (like Stick Nodes' saved stickfigures),
// stored in IndexedDB and shareable between devices as .runilib files.
import { app, P, curFrame, selLayer, changed } from './app.js';
import { deepClone, uid, getStrokes, getXf } from './model.js';
import { computeWorld, figureBounds } from './rig.js';
import { resolvePoses } from './join.js';
import { drawFigure, layerMatrix } from './render.js';
import { strokesBox, transformStroke, drawStrokes } from './brush.js';
import { PRESETS, rigFromPreset } from './presets.js';
import { put, del, listAssets } from './storage.js';
import { insertFigure, insertDrawing } from './actions.js';
import { toast, promptDialog, confirmDialog } from './ui.js';
import { downloadBlob, pickFile } from './fileio.js';
import { translate } from './geom.js';
import { motionThumb, applyMotion, saveMotionToLibrary } from './motion.js';
import { writeLibraryToFolder } from './folder.js';

export let assets = [];
let builtins = null;

// write = false on start-up so an empty browser library never overwrites the folder's copy.
export async function refreshAssets(write = true) {
  try {
    assets = await listAssets();
  } catch (e) {
    console.warn('Library unavailable', e);
    assets = [];
  }
  if (write) writeLibraryToFolder(assets);
  changed('assets');
}

export function builtinAssets() {
  builtins ||= PRESETS.map((pr) => {
    const rig = rigFromPreset(pr);
    const pose = { x: 0, y: 0, r: pr.rootAngle, s: 1, flip: false, a: {}, l: {} };
    return { id: 'builtin:' + pr.id, builtin: true, kind: 'figure', name: pr.name, data: { rig, pose }, thumb: thumbnail('figure', { rig, pose }) };
  });
  return builtins;
}

export function thumbnail(kind, data, size = 112) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  if (kind === 'motion') return motionThumb(data, size);
  const ctx = c.getContext('2d');
  let b;
  if (kind === 'figure') b = figureBounds(data.rig, computeWorld(data.rig, data.pose));
  else b = strokesBox(data.strokes);
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  const k = Math.min((size - 16) / w, (size - 16) / h, 3);
  ctx.setTransform(k, 0, 0, k, size / 2 - ((b.x0 + b.x1) / 2) * k, size / 2 - ((b.y0 + b.y1) / 2) * k);
  if (kind === 'figure') drawFigure(ctx, { rig: data.rig }, data.pose);
  else drawStrokes(ctx, data.strokes);
  return c.toDataURL('image/png');
}

// Captures the current selection as an asset.
export async function saveSelectionToLibrary() {
  const s = app.sel, layer = selLayer();
  if (!s || !layer) return toast('Select a figure, a drawing layer or some strokes to save');
  let kind, data, name;
  if (s.type === 'figure') {
    kind = 'figure';
    // Saved figures stand on their own, so use where it is on screen, not its joint offset.
    const pose = deepClone(resolvePoses(P(), curFrame())[s.id] || curFrame().poses[s.id]);
    pose.x = 0;
    pose.y = 0;
    data = { rig: deepClone(layer.rig), pose };
    name = layer.name;
  } else {
    const strokes = s.type === 'strokes' ? s.strokes : getStrokes(layer, curFrame());
    if (!strokes.length) return toast('That layer is empty on this frame');
    if (layer.kind !== 'draw') return toast('Images can’t be saved to the library yet');
    // Store in stage units, centred on the origin.
    const m = layerMatrix(layer, getXf(curFrame(), layer.id));
    const staged = strokes.map((x) => transformStroke(x, m));
    const b = strokesBox(staged);
    const centred = staged.map((x) => transformStroke(x, translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2)));
    kind = 'drawing';
    data = { strokes: centred };
    name = layer.name;
  }
  const n = await promptDialog(kind === 'figure' ? 'Save figure to library' : 'Save drawing to library', name, { ok: 'Save', label: 'Name' });
  if (!n) return;
  const asset = { id: uid('a'), kind, name: n, created: Date.now(), data, thumb: thumbnail(kind, data) };
  await put('assets', asset);
  await refreshAssets();
  toast(`Saved “${n}” to your library`);
}

export const saveMotion = () => saveMotionToLibrary(refreshAssets);

export function insertAsset(a) {
  if (a.kind === 'motion') return applyMotion(a);
  if (a.kind === 'figure') insertFigure(deepClone(a.data.rig), deepClone(a.data.pose), a.name);
  else insertDrawing(a.data.strokes, a.name);
}

export async function renameAsset(a) {
  const n = await promptDialog('Rename', a.name, { ok: 'Rename' });
  if (!n) return;
  await put('assets', { ...a, name: n });
  refreshAssets();
}

export async function deleteAsset(a) {
  if (!(await confirmDialog(`Delete “${a.name}” from your library? This can’t be undone.`, { ok: 'Delete', danger: true }))) return;
  await del('assets', a.id);
  refreshAssets();
}

export function exportLibrary(list = assets) {
  if (!list.length) return toast('Your library is empty');
  const blob = new Blob([JSON.stringify({ format: 'runimate-library', version: 1, assets: list })], { type: 'application/octet-stream' });
  downloadBlob(blob, `runimate-library-${new Date().toISOString().slice(0, 10)}.runilib`);
}

export async function importLibrary() {
  const file = await pickFile('.runilib,.json');
  if (file) await importLibraryFile(file);
}

// merge = true skips items already in the library (used when syncing with a projects folder).
export async function importLibraryFile(file, { merge = false } = {}) {
  try {
    const data = JSON.parse(await file.text());
    const list = data.format === 'runimate-library' ? data.assets : data.kind ? [data] : null;
    if (!list) throw new Error('Not a Runimate library file');
    const existing = new Set(assets.map((a) => a.id));
    let added = 0;
    for (const a of list) {
      if (!a || !a.kind || !a.data) continue;
      if (merge && existing.has(a.id)) continue;
      const rec = { ...a, id: existing.has(a.id) ? uid('a') : a.id || uid('a'), created: a.created || Date.now() };
      rec.thumb ||= thumbnail(rec.kind, rec.data);
      await put('assets', rec);
      added++;
    }
    await refreshAssets();
    if (!merge || added) toast(`${merge ? 'Loaded' : 'Imported'} ${added} item${added === 1 ? '' : 's'} into your library`);
    return added;
  } catch (e) {
    toast(e.message, { kind: 'error' });
  }
}

export function exportAsset(a) {
  exportLibrary([a]);
}

