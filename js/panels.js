// Side panel: Properties (context sensitive), Layers and Library tabs.
import { app, P, curFrame, onChange, changed, checkpoint, selLayer, select } from './app.js';
import { layerById, getStrokes, setStrokes, getXf } from './model.js';
import { SHAPES, nodeById } from './rig.js';
import * as A from './actions.js';
import { ensureXf, ensurePivot, fit } from './stage.js';
import { saveSelectionToLibrary, builtinAssets, assets, insertAsset, renameAsset, deleteAsset, exportAsset, importLibrary, exportLibrary, refreshAssets } from './library.js';
import { projectForm } from './projects.js';
import { h, icon, ibtn, popupMenu } from './ui.js';
import { prettyKey, keysFor } from './commands.js';
import { DEG } from './geom.js';

let root, tabsEl, body;
let binds = [];
let search = '';

const tip = (label, id) => (keysFor(id) ? `${label} (${prettyKey(keysFor(id))})` : label);
const TABS = [['props', 'Properties', 'sliders'], ['layers', 'Layers', 'layers'], ['library', 'Library', 'library']];

export function initPanels(el) {
  root = el;
  app.panelTab ||= 'props';
  app.panelOpen ??= innerWidth >= 900;
  tabsEl = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label, ic]) => h('button', {
    type: 'button', role: 'tab', 'data-tab': id, title: `${label} (${prettyKey(keysFor('panel-' + id))})`,
    onclick: () => { app.panelTab = id; changed('panel'); },
    onkeydown: (e) => {
      const i = TABS.findIndex((t) => t[0] === app.panelTab);
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      app.panelTab = TABS[(i + d + TABS.length) % TABS.length][0];
      changed('panel');
      setTimeout(() => tabsEl.querySelector('.on')?.focus());
    },
  }, icon(ic, 16), h('span', {}, label))));
  body = h('div', { class: 'panel-body', role: 'tabpanel' });
  root.append(tabsEl, body);
  onChange((f) => {
    const structural = ['sel', 'layers', 'project', 'frame', 'frames', 'assets', 'panel', 'tool', 'clipboard'].some((k) => f.has(k));
    if (structural) render();
    else if (f.has('content') || f.has('playframe')) sync();
  });
}

function render() {
  document.body.classList.toggle('panel-closed', !app.panelOpen);
  for (const b of tabsEl.children) {
    const on = b.dataset.tab === app.panelTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
  }
  // Keep focus and scroll if the user is in the middle of editing a field.
  const focused = document.activeElement;
  const keepFocus = body.contains(focused) && focused.dataset.k;
  const scroll = body.scrollTop;
  binds = [];
  const content = app.panelTab === 'layers' ? layersTab() : app.panelTab === 'library' ? libraryTab() : propsTab();
  body.replaceChildren(content);
  body.scrollTop = scroll;
  if (keepFocus) {
    const el = body.querySelector(`[data-k="${CSS.escape(keepFocus)}"]`);
    el?.focus();
    if (el && (el.type === 'search' || el.type === 'text')) el.setSelectionRange(el.value.length, el.value.length);
  }
  sync();
}

function sync() {
  for (const b of binds) if (document.activeElement !== b.el) b.set(b.get());
}

// ---------------------------------------------------------------- field builders
const edit = (key, fn) => {
  checkpoint(key);
  fn();
  changed('content');
};
function bind(el, get, set) {
  binds.push({ el, get, set });
  return el;
}
function num(label, key, get, set, { min = -1e6, max = 1e6, step = 1, suffix = '' } = {}) {
  const input = h('input', { type: 'number', class: 'num', min, max, step, 'data-k': key, 'aria-label': label,
    oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) edit(key, () => set(Math.max(min, Math.min(max, v)))); } });
  bind(input, get, (v) => (input.value = Math.round(v * 100) / 100));
  return h('label', { class: 'field' }, h('span', {}, label), input, suffix ? h('span', { class: 'suffix' }, suffix) : null);
}
function range(label, key, get, set, { min = 0, max = 1, step = 0.01, fmt = (v) => v } = {}) {
  const out = h('output', {});
  const input = h('input', { type: 'range', min, max, step, 'data-k': key, 'aria-label': label,
    oninput: (e) => { edit(key, () => set(+e.target.value)); out.textContent = fmt(+e.target.value); } });
  bind(input, get, (v) => { input.value = v; out.textContent = fmt(v); });
  return h('label', { class: 'field col' }, h('span', { class: 'row between' }, h('span', {}, label), out), input);
}
function color(label, key, get, set) {
  const input = h('input', { type: 'color', class: 'color', 'data-k': key, 'aria-label': label, oninput: (e) => edit(key, () => set(e.target.value)) });
  bind(input, get, (v) => (input.value = v));
  return h('label', { class: 'field' }, h('span', {}, label), input);
}
function check(label, key, get, set) {
  const input = h('input', { type: 'checkbox', 'data-k': key, onchange: (e) => edit(null, () => set(e.target.checked)) });
  bind(input, get, (v) => (input.checked = v));
  return h('label', { class: 'field check' }, input, h('span', {}, label));
}
function seg(label, options, get, set) {
  const el = h('div', { class: 'seg wrap', role: 'group', 'aria-label': label }, options.map(([v, l, t]) => h('button', {
    type: 'button', 'data-v': v, title: t || l, onclick: () => edit(null, () => set(v)),
  }, l)));
  bind(el, get, (v) => { for (const b of el.children) { b.classList.toggle('on', b.dataset.v === String(v)); b.setAttribute('aria-pressed', b.dataset.v === String(v)); } });
  return label ? h('div', { class: 'field col' }, h('span', {}, label), el) : el;
}
const btn = (label, ic, onclick, cls = '', title = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick, title: title || label }, ic ? icon(ic, 16) : null, h('span', {}, label));
const section = (title, ...children) => h('section', { class: 'psec' }, title ? h('h3', {}, title) : null, ...children);
const row = (...c) => h('div', { class: 'row gap wrap' }, ...c);

// ---------------------------------------------------------------- Properties
function propsTab() {
  const s = app.sel, layer = selLayer();
  if (app.boneDraw) return boneDrawProps();
  if (s && layer) {
    if (s.type === 'figure') return figureProps(layer);
    if (s.type === 'strokes') return strokesProps(layer);
    if (s.type === 'layer') return layerProps(layer);
  }
  return projectProps();
}

function projectProps() {
  const p = P();
  const form = projectForm(p, (k, v) => {
    if ((k === 'width' || k === 'height') && !(v >= 16 && v <= 4096)) return;
    edit('proj:' + k, () => (p[k] = v));
    if (k === 'width' || k === 'height') fit();
    if (k === 'name' || k === 'fps') changed('project');
  });
  return h('div', {},
    section('Animation', form, check('Loop playback', 'loop', () => p.loop, (v) => (p.loop = v))),
    section('Getting started',
      h('ul', { class: 'tips' },
        h('li', {}, 'Drag the ', h('b', {}, 'round nodes'), ' to pose a figure. The ', h('b', {}, 'square node'), ' moves the whole figure.'),
        h('li', {}, 'While drawing, press ', h('kbd', {}, 'Q'), ' for a ruler or ', h('kbd', {}, 'M'), ' for mirror symmetry.'),
        h('li', {}, 'Press ', h('kbd', {}, 'N'), ' for a new frame, then pose again. Add ', h('b', {}, 'in-betweens'), ' in the timeline for smooth motion.'),
        h('li', {}, 'Pick the ', h('b', {}, 'Brush'), ' (', h('kbd', {}, 'B'), ') to draw on the current frame. Onion skin (', h('kbd', {}, 'O'), ') shows neighbours.'),
        h('li', {}, 'Select a joint and choose ', h('b', {}, 'Draw on this bone'), ' to give your figure drawn parts that move with it.'),
        h('li', {}, 'Save figures and drawings in the ', h('b', {}, 'Library'), ' tab to reuse them anywhere.'),
        h('li', {}, h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'K'), ' finds any command; ', h('kbd', {}, '?'), ' lists every shortcut.'))));
}

function figureProps(layer) {
  const f = curFrame(), s = app.sel;
  const pose = () => curFrame().poses[s.id];
  const node = s.node ? nodeById(layer.rig, s.node) : null;
  const parts = [];
  parts.push(section(null,
    h('div', { class: 'row between' }, h('div', { class: 'title' }, icon('figure', 18), h('b', {}, layer.name)), ibtn('pen', 'Rename', () => A.renameLayer(layer.id), 'ghost mini')),
    h('div', { class: 'grid2' },
      num('X', 'fx', () => pose().x, (v) => (pose().x = v)),
      num('Y', 'fy', () => pose().y, (v) => (pose().y = v)),
      num('Turn', 'fr', () => (pose().r * 180) / Math.PI + 90, (v) => (pose().r = (v - 90) * DEG), { step: 1, suffix: '°' }),
      num('Size', 'fs', () => pose().s * 100, (v) => (pose().s = Math.max(5, v) / 100), { min: 5, max: 2000, step: 5, suffix: '%' })),
    range('Opacity', 'lop', () => layer.opacity, (v) => (layer.opacity = v), { fmt: (v) => `${Math.round(v * 100)}%` }),
    row(btn('Flip', 'flip', A.flipSelection, '', tip('Flip horizontally', 'flip')), btn('Copy pose', 'copy', A.copyPose, '', tip('Copy pose', 'copy-pose')), btn('Paste pose', 'paste', A.pastePose, '', tip('Paste pose', 'paste-pose'))),
    row(btn('Reset pose', 'rotate', A.resetPose), btn('Save to library', 'library', saveSelectionToLibrary, 'accent', tip('Save to library', 'save-asset'))),
  ));

  if (node) {
    const isRoot = !node.parent;
    const nd = () => nodeById(layer.rig, s.node);
    const joint = section(isRoot ? 'Main node' : 'Selected joint',
      isRoot ? h('p', { class: 'muted small' }, 'The main node moves the whole figure. Add joints to it to build new limbs.') : null,
      !isRoot ? seg('Segment shape (all frames)', SHAPES.map((x) => [x.id, x.label]), () => nd().shape, (v) => (nd().shape = v)) : null,
      !isRoot ? range('Thickness', 'nth', () => nd().thick, (v) => (nd().thick = v), { min: 1, max: 80, step: 1, fmt: (v) => `${v}px` }) : null,
      !isRoot ? h('div', { class: 'row gap wrap' }, color('Color', 'ncol', () => nd().color, (v) => (nd().color = v)), swatchRow((c) => edit(null, () => (nd().color = c)))) : null,
      !isRoot ? h('div', { class: 'grid2' },
        num('Length', 'nlen', () => pose().l[node.id] ?? node.len, (v) => (pose().l[node.id] = Math.max(1, v)), { min: 1, max: 5000 }),
        num('Angle', 'nang', () => ((pose().a[node.id] ?? node.ang) * 180) / Math.PI, (v) => (pose().a[node.id] = v * DEG), { step: 1, suffix: '°' })) : null,
      !isRoot ? h('p', { class: 'muted small' }, 'Length and angle are per frame (they tween). Shape, thickness and colour apply to every frame.') : null,
      row(
        btn('Add joint', 'plus', A.addNode, '', tip('Add a joint here', 'add-node')),
        !isRoot ? btn('Delete joint', 'trash', A.removeNode, 'danger', tip('Delete joint', 'delete-node')) : null),
      !isRoot ? row(btn('Draw behind', 'down', () => A.nodeOrder(-1), '', 'Draw this segment behind others'), btn('Draw in front', 'up', () => A.nodeOrder(1), '', 'Draw this segment in front')) : null,
      !isRoot ? row(btn('Color → whole figure', 'figure', () => edit(null, () => layer.rig.nodes.forEach((n) => (n.color = node.color)))), btn('Thickness → whole figure', 'figure', () => edit(null, () => layer.rig.nodes.forEach((n) => (n.thick = node.thick))))) : null,
    );
    parts.push(joint);
    const art = node.art && node.art.strokes.length ? node.art : null;
    parts.push(section('Drawn art on this bone',
      h('p', { class: 'muted small' }, art ? `${art.strokes.length} stroke${art.strokes.length > 1 ? 's' : ''} attached — they move${art.stretch !== false ? ' and stretch' : ''} with this bone on every frame.` : 'Draw a head, hand, hat or prop that sticks to this bone in every frame.'),
      row(btn(art ? 'Draw more' : 'Draw on this bone', 'brush', A.startBoneDraw, 'accent', tip('Draw on this bone', 'bone-draw'))),
      art && !isRoot ? check('Stretch with the bone', 'astr', () => nd().art?.stretch !== false, (v) => nd().art && (nd().art.stretch = v)) : null,
      art ? row(btn('Detach to layer', 'scissors', A.detachSelectedArt), btn('Remove art', 'trash', A.clearArt, 'danger')) : null,
    ));
  } else {
    parts.push(section('Joints', h('p', { class: 'muted small' }, 'Tap a node to select a joint. ', h('kbd', {}, 'Tab'), ' cycles joints; arrow keys rotate and stretch.'),
      row(btn('Add joint', 'plus', A.addNode))));
  }
  parts.push(section('Rig',
    row(btn('Set as default pose', 'check', A.setDefaultPose, '', 'Make this pose the default used by “Reset pose” and new copies'),
      btn('Remove from here on', 'trash', A.deleteSelection, 'danger', 'Remove the figure from this frame and every later frame'))));
  return h('div', {}, parts);
}

function swatchRow(pick) {
  return h('div', { class: 'swatches' }, app.swatches.slice(0, 8).map((c) => h('button', { type: 'button', class: 'sw', style: { background: c }, title: c, 'aria-label': `Colour ${c}`, onclick: () => pick(c) })));
}

function strokesProps(layer) {
  const s = app.sel;
  const recolor = (c, key) => {
    const f = curFrame();
    const map = new Map(s.strokes.map((x) => [x, { ...x, c: x.w > 0 ? c : x.c, fill: x.fill ? c : null }]));
    setStrokes(layer, f, getStrokes(layer, f).map((x) => map.get(x) || x));
    s.strokes = s.strokes.map((x) => map.get(x));
  };
  return h('div', {},
    section(`${s.strokes.length} stroke${s.strokes.length > 1 ? 's' : ''} selected`,
      h('p', { class: 'muted small' }, `On “${layer.name}”. Drag inside the box to move, use the round handle to rotate and the square one to scale. Arrow keys nudge.`),
      h('div', { class: 'row gap wrap' }, color('Recolor', 'srec', () => s.strokes[0]?.fill || s.strokes[0]?.c || '#000000', (v) => recolor(v)), swatchRow((c) => edit(null, () => recolor(c)))),
      row(btn('Flip', 'flip', A.flipSelection), btn('Duplicate', 'copy', A.duplicateSelection, '', tip('Duplicate', 'duplicate')), btn('Delete', 'trash', A.deleteSelection, 'danger')),
      row(btn('Attach to a bone', 'bone', A.startAttach, 'accent', tip('Attach to a bone', 'attach')), btn('Save to library', 'library', saveSelectionToLibrary, '', tip('Save to library', 'save-asset'))),
      app.attachPending ? h('p', { class: 'callout' }, 'Tap the node at the end of the bone you want to attach to. Esc cancels.') : null));
}

function layerProps(layer) {
  const xf = () => getXf(curFrame(), layer.id);
  const set = (k) => (v) => { ensureXf(layer)[k] = v; };
  const kind = layer.kind === 'image' ? 'Image' : layer.mode === 'sprite' ? 'Sprite drawing' : 'Frame-by-frame drawing';
  return h('div', {},
    section(null,
      h('div', { class: 'row between' }, h('div', { class: 'title' }, icon(layer.kind === 'image' ? 'image' : layer.mode === 'sprite' ? 'sprite' : 'brush', 18), h('b', {}, layer.name)), ibtn('pen', 'Rename', () => A.renameLayer(layer.id), 'ghost mini')),
      h('p', { class: 'muted small' }, kind + (layer.mode === 'sprite' ? ' — one drawing shared by all frames; move / turn / scale it per frame and it tweens.' : layer.kind === 'image' ? ' — great for tracing. Lower the opacity and lock the layer.' : ' — each keyframe has its own drawing. The transform below moves this frame’s drawing.')),
      h('div', { class: 'grid2' },
        num('X', 'lx', () => xf().x, set('x')),
        num('Y', 'ly', () => xf().y, set('y')),
        num('Turn', 'lr', () => (xf().r * 180) / Math.PI, (v) => { ensurePivot(layer); ensureXf(layer).r = v * DEG; }, { suffix: '°' }),
        num('Size', 'ls', () => xf().s * 100, (v) => { ensurePivot(layer); ensureXf(layer).s = Math.max(1, v) / 100; }, { min: 1, max: 5000, step: 5, suffix: '%' })),
      range('Opacity', 'lop', () => layer.opacity, (v) => (layer.opacity = v), { fmt: (v) => `${Math.round(v * 100)}%` }),
      row(btn('Reset transform', 'rotate', () => edit(null, () => { const x = ensureXf(layer); x.x = x.y = x.r = 0; x.s = 1; })),
        layer.kind === 'draw' ? btn('Flip', 'flip', A.flipSelection) : null),
      layer.kind === 'draw' ? row(btn('Save drawing to library', 'library', saveSelectionToLibrary, 'accent'), btn(layer.mode === 'sprite' ? 'Delete layer' : 'Clear this frame', 'trash', A.deleteSelection, 'danger')) : row(btn('Delete layer', 'trash', A.deleteSelection, 'danger'))),
  );
}

function boneDrawProps() {
  const layer = layerById(P(), app.boneDraw.id);
  const node = layer && nodeById(layer.rig, app.boneDraw.node);
  return h('div', {}, section('Drawing on a bone',
    h('p', {}, 'Everything you draw now is attached to ', h('b', {}, `${layer?.name || 'the figure'}`), node?.parent ? ' — the highlighted bone.' : ' — its main node.'),
    h('p', { class: 'muted small' }, 'Pose the figure afterwards: the drawing follows the bone on every frame. Use the eraser to fix mistakes.'),
    row(btn('Done', 'check', A.endBoneDraw, 'primary', 'Finish (Esc)'))));
}

// ---------------------------------------------------------------- Layers
function layersTab() {
  const p = P(), f = curFrame();
  const list = h('div', { class: 'layer-list', role: 'listbox', 'aria-label': 'Layers (top first)' });
  const rows = [...p.layers].reverse().map((l) => {
    const active = l.id === app.activeLayer;
    const absent = l.kind === 'figure' && !f.poses[l.id];
    const kindIcon = l.kind === 'figure' ? 'figure' : l.kind === 'image' ? 'image' : l.mode === 'sprite' ? 'sprite' : 'brush';
    const kindName = l.kind === 'figure' ? 'Figure' : l.kind === 'image' ? 'Image' : l.mode === 'sprite' ? 'Sprite' : 'Frames';
    const rowEl = h('div', { class: `layer ${active ? 'on' : ''} ${absent ? 'absent' : ''} ${l.visible ? '' : 'hidden-l'}` },
      ibtn(l.visible ? 'eye' : 'eyeoff', l.visible ? 'Hide layer' : 'Show layer', () => A.toggleLayer(l.id, 'visible'), 'mini ghost'),
      ibtn(l.locked ? 'lock' : 'unlock', l.locked ? 'Unlock layer' : 'Lock layer', () => A.toggleLayer(l.id, 'locked'), 'mini ghost'),
      h('button', {
        type: 'button', class: 'layer-name', role: 'option', 'aria-selected': active, title: `${kindName} layer — double-click or F2 to rename, Alt+↑/↓ to reorder`,
        onclick: () => A.setActiveLayer(l.id),
        ondblclick: () => A.renameLayer(l.id),
        onkeydown: (e) => {
          const btns = [...list.querySelectorAll('.layer-name')];
          const i = btns.indexOf(e.currentTarget);
          if (e.key === 'F2') A.renameLayer(l.id);
          else if (e.altKey && e.key === 'ArrowUp') { A.moveLayer(l.id, 1); refocus(l.id); }
          else if (e.altKey && e.key === 'ArrowDown') { A.moveLayer(l.id, -1); refocus(l.id); }
          else if (e.key === 'ArrowDown') btns[Math.min(btns.length - 1, i + 1)]?.focus();
          else if (e.key === 'ArrowUp') btns[Math.max(0, i - 1)]?.focus();
          else return;
          e.preventDefault();
          e.stopPropagation();
        },
        'data-layer': l.id,
      }, icon(kindIcon, 16), h('span', { class: 'grow ell' }, l.name), absent ? h('span', { class: 'tag' }, 'not in frame') : h('span', { class: 'tag' }, kindName)),
      ibtn('dots', `Layer actions for ${l.name}`, (e) => popupMenu(e.currentTarget, [
        { label: 'Rename', icon: 'pen', keys: 'F2', run: () => A.renameLayer(l.id) },
        { label: 'Duplicate', icon: 'copy', run: () => A.duplicateLayer(l.id) },
        { label: 'Move up', icon: 'up', keys: 'Alt+↑', run: () => A.moveLayer(l.id, 1) },
        { label: 'Move down', icon: 'down', keys: 'Alt+↓', run: () => A.moveLayer(l.id, -1) },
        ...(l.kind === 'figure' && absent ? [{ label: 'Add back to this frame', icon: 'plus', run: () => readdFigure(l) }] : []),
        '-',
        { label: 'Delete layer', icon: 'trash', run: () => A.deleteLayer(l.id) },
      ]), 'mini ghost'));
    return rowEl;
  });
  list.append(...rows);
  const al = layerById(p, app.activeLayer);
  return h('div', {},
    section('Add',
      h('div', { class: 'grid2' },
        btn('Frame-by-frame', 'brush', () => A.addLayer('frame'), '', 'New drawing layer: every keyframe has its own drawing'),
        btn('Sprite', 'sprite', () => A.addLayer('sprite'), '', 'New sprite layer: one drawing you animate by moving, turning and scaling'),
        btn('Figure', 'figure', () => { app.panelTab = 'library'; changed('panel'); }, '', 'Add a stick figure from the library'),
        btn('Image', 'image', A.importImage, '', 'Import a picture to trace over'))),
    section('Layers', list,
      al ? range(`“${al.name}” opacity`, 'alop', () => al.opacity, (v) => (al.opacity = v), { fmt: (v) => `${Math.round(v * 100)}%` }) : null),
  );
}
function refocus(id) {
  setTimeout(() => body.querySelector(`[data-layer="${id}"]`)?.focus());
}
function readdFigure(l) {
  const p = P();
  // Copy the nearest pose from an earlier (or later) frame.
  let src = null;
  for (let i = app.cur; i >= 0 && !src; i--) src = p.frames[i].poses[l.id];
  for (let i = app.cur; i < p.frames.length && !src; i++) src = p.frames[i].poses[l.id];
  if (!src) return;
  checkpoint();
  curFrame().poses[l.id] = JSON.parse(JSON.stringify(src));
  changed('content', 'layers');
  select({ type: 'figure', id: l.id, node: null });
}

// ---------------------------------------------------------------- Library
function libraryTab() {
  const q = search.trim().toLowerCase();
  const match = (a) => !q || a.name.toLowerCase().includes(q);
  const card = (a) => h('div', { class: 'asset' },
    h('button', { type: 'button', class: 'asset-btn', title: `Insert ${a.name}`, onclick: () => insertAsset(a) },
      h('img', { src: a.thumb, alt: '' }), h('span', { class: 'ell' }, a.name)),
    a.builtin ? null : ibtn('dots', `Actions for ${a.name}`, (e) => popupMenu(e.currentTarget, [
      { label: 'Insert', icon: 'plus', run: () => insertAsset(a) },
      { label: 'Rename', icon: 'pen', run: () => renameAsset(a) },
      { label: 'Export file', icon: 'download', run: () => exportAsset(a) },
      '-',
      { label: 'Delete', icon: 'trash', run: () => deleteAsset(a) },
    ]), 'mini ghost asset-more'));
  const grid = (list, empty) => list.length ? h('div', { class: 'asset-grid' }, list.map(card)) : h('p', { class: 'muted small' }, empty);
  const figs = assets.filter((a) => a.kind === 'figure' && match(a));
  const draws = assets.filter((a) => a.kind === 'drawing' && match(a));
  const input = h('input', { type: 'search', class: 'text', placeholder: 'Search library', value: search, 'data-k': 'libsearch', 'aria-label': 'Search library',
    oninput: (e) => { search = e.target.value; render(); } });
  return h('div', {},
    section(null, input,
      row(btn('Save selection', 'plus', saveSelectionToLibrary, 'accent', tip('Save the selected figure or drawing', 'save-asset')),
        ibtn('upload', 'Import library file (.runilib)', importLibrary),
        ibtn('download', 'Export your whole library (.runilib)', () => exportLibrary()))),
    section('Built-in figures', grid(builtinAssets().filter(match), 'No match')),
    section('My figures', grid(figs, q ? 'No match' : 'Select a figure and press “Save selection” — it keeps its rig, colours and drawn bone art.')),
    section('My drawings', grid(draws, q ? 'No match' : 'Select strokes (lasso) or a drawing layer and press “Save selection”.')),
  );
}

export function initLibraryData() {
  refreshAssets();
}

