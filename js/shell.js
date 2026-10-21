// App chrome: top bar, tool bar, tool options bar, banners and the stage context menu.
import { app, P, onChange, changed, checkpoint, canUndo, canRedo, undo, redo, select } from './app.js';
import * as A from './actions.js';
import { layerById } from './model.js';
import { nodeById } from './rig.js';
import { runCommand, keysFor, prettyKey, openHelp } from './commands.js';
import { setContextMenuProvider, view, zoomBy, fit } from './stage.js';
import { saveSelectionToLibrary } from './library.js';
import { openExport } from './export.js';
import { h, icon, ibtn, popupMenu, promptDialog, popover } from './ui.js';
import { ruler, RULER_TYPES, setRulerType, resetRuler, lineAngle, setLineAngle, nudgeRuler } from './ruler.js';

const tip = (label, id) => (keysFor(id) ? `${label} (${prettyKey(keysFor(id))})` : label);

const TOOLS = [
  ['select', 'select', 'Animate / select', 'tool-select'],
  ['brush', 'brush', 'Brush', 'tool-brush'],
  ['eraser', 'eraser', 'Eraser', 'tool-eraser'],
  ['fill', 'fill', 'Fill shape', 'tool-fill'],
  ['line', 'line', 'Line', 'tool-line'],
  ['rect', 'rect', 'Rectangle', 'tool-rect'],
  ['ellipse', 'ellipse', 'Ellipse', 'tool-ellipse'],
  ['lasso', 'lasso', 'Lasso select', 'tool-lasso'],
  ['eyedropper', 'eyedropper', 'Eyedropper', 'tool-eyedropper'],
  ['hand', 'hand', 'Hand (pan)', 'tool-hand'],
];

const BRUSHES = {
  pen: { label: 'Pen', size: 6, opacity: 1, smooth: 0.45, pressure: true, taper: true },
  ink: { label: 'Ink', size: 3, opacity: 1, smooth: 0.6, pressure: true, taper: true },
  pencil: { label: 'Pencil', size: 2, opacity: 0.85, smooth: 0.2, pressure: true, taper: false },
  marker: { label: 'Marker', size: 14, opacity: 1, smooth: 0.3, pressure: false, taper: false },
  highlighter: { label: 'Highlighter', size: 28, opacity: 0.35, smooth: 0.3, pressure: false, taper: false },
};

let topbar, toolbar, optbar, banner, nameBtn, saveState, undoBtn, redoBtn, zoomLabel, rulerToolBtn;

export function initShell() {
  topbar = document.getElementById('topbar');
  toolbar = document.getElementById('toolbar');
  optbar = document.getElementById('optbar');
  banner = document.getElementById('banner');

  // ---- top bar
  nameBtn = h('button', { type: 'button', class: 'proj-name', title: 'Rename animation', onclick: rename });
  saveState = h('span', { class: 'save-state', 'aria-live': 'polite' });
  undoBtn = ibtn('undo', tip('Undo', 'undo'), () => undo());
  redoBtn = ibtn('redo', tip('Redo', 'redo'), () => redo());
  const menuBtn = h('button', { type: 'button', class: 'brand', title: 'Menu', 'aria-label': 'Main menu', onclick: (e) => mainMenu(e.currentTarget) },
    h('span', { class: 'logo', 'aria-hidden': 'true' }, icon('figure', 18)), h('span', { class: 'brand-name' }, 'Runimate'), icon('down', 14));
  topbar.append(
    h('div', { class: 'tb-left' }, menuBtn, nameBtn, saveState),
    h('div', { class: 'tb-mid' }, undoBtn, redoBtn,
      ibtn('folder', tip('Your animations', 'projects'), () => runCommand('projects')),
      ibtn('save', tip('Save', 'save'), () => runCommand('save'))),
    h('div', { class: 'tb-right' },
      ibtn('search', tip('Command palette', 'palette'), () => runCommand('palette')),
      ibtn('keyboard', tip('Keyboard shortcuts', 'help'), openHelp),
      h('button', { type: 'button', class: 'btn primary', title: tip('Export', 'export'), onclick: () => openExport() }, icon('export', 16), h('span', { class: 'hide-sm' }, 'Export')),
      ibtn('panel', tip('Toggle side panel', 'panel'), () => runCommand('panel'))),
  );

  // ---- tool bar
  const toolBtns = TOOLS.map(([id, ic, label, cmd]) => {
    const b = ibtn(ic, tip(label, cmd), () => A.setTool(id), 'tool');
    b.dataset.tool = id;
    b.setAttribute('aria-pressed', 'false');
    return b;
  });
  zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: tip('Fit to window', 'zoom-fit'), onclick: fit });
  toolbar.append(
    h('div', { class: 'tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }, toolBtns),
    h('div', { class: 'tools-bottom' },
      (rulerToolBtn = ibtn('ruler', tip('Ruler & symmetry', 'ruler-toggle'), (e) => rulerPopover(e.currentTarget), 'toggle')),
      ibtn('figure', tip('Add a stickman', 'add-stickman'), () => A.insertPreset('stickman')),
      ibtn('plus', tip('Zoom in', 'zoom-in'), () => zoomBy(1.25), 'mini'),
      zoomLabel,
      ibtn('minus', tip('Zoom out', 'zoom-out'), () => zoomBy(0.8), 'mini')),
  );
  // Roving arrow-key focus inside the tool bar.
  toolbar.querySelector('.tools').addEventListener('keydown', (e) => {
    const list = toolBtns;
    const i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    list[(i + d + list.length) % list.length].focus();
  });

  setContextMenuProvider(contextItems);

  onChange((f) => {
    if (['tool', 'prefs', 'sel', 'project', 'layers', 'frame', 'ruler'].some((k) => f.has(k))) renderOptions();
    if (f.has('tool') || f.has('project')) updateTools();
    if (f.has('ruler') || f.has('tool') || f.has('project')) {
      const on = ruler().type !== 'off';
      rulerToolBtn.classList.toggle('on', on);
      rulerToolBtn.setAttribute('aria-pressed', on);
      rulerToolBtn.replaceChildren(icon(RULER_ICON[ruler().type], 20));
    }
    if (f.has('view') || f.has('project')) zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
    updateTop();
    updateBanner();
  });
}

function updateTop() {
  const p = P();
  if (!p) return;
  nameBtn.textContent = p.name;
  document.title = `${p.name} — Runimate`;
  const dirty = app.rev !== app.savedRev;
  saveState.textContent = dirty ? 'Unsaved…' : 'Saved';
  saveState.classList.toggle('dirty', dirty);
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
}

function updateTools() {
  for (const b of toolbar.querySelectorAll('[data-tool]')) {
    const on = b.dataset.tool === app.tool;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
  document.body.dataset.tool = app.tool;
}

function updateBanner() {
  let msg = null;
  if (app.boneDraw) {
    const l = layerById(P(), app.boneDraw.id);
    const n = l && nodeById(l.rig, app.boneDraw.node);
    msg = [icon('bone', 16), h('span', {}, `Drawing on ${l?.name || 'figure'}${n?.parent ? '’s bone' : '’s main node'} — strokes stick to it`), h('button', { class: 'btn primary', type: 'button', onclick: A.endBoneDraw }, 'Done')];
  } else if (app.attachPending) {
    msg = [icon('bone', 16), h('span', {}, 'Tap a node: the selected drawing will attach to that bone'), h('button', { class: 'btn', type: 'button', onclick: () => { app.attachPending = false; changed('sel'); } }, 'Cancel')];
  } else if (app.preview != null) {
    msg = [icon('frames', 16), h('span', {}, 'Previewing an in-between frame — tap the canvas or a frame to edit')];
  }
  banner.classList.toggle('show', !!msg);
  if (msg) banner.replaceChildren(...msg);
}

async function rename() {
  const n = await promptDialog('Rename animation', P().name, { ok: 'Rename' });
  if (!n) return;
  checkpoint();
  P().name = n;
  changed('project');
}

function mainMenu(anchor) {
  const k = (id) => prettyKey(keysFor(id));
  const item = (id, label, ic) => ({ label, icon: ic, keys: k(id), run: () => runCommand(id) });
  popupMenu(anchor, [
    item('new', 'New animation…', 'new'),
    item('projects', 'Your animations…', 'folder'),
    item('open-file', 'Open project file…', 'upload'),
    '-',
    item('save', 'Save', 'save'),
    item('save-as', 'Save to file…', 'download'),
    item('export', 'Export GIF / MP4 / PNG…', 'export'),
    '-',
    item('import-image', 'Import image to trace…', 'image'),
    item('lib-import', 'Import library file…', 'upload'),
    item('lib-export', 'Export my library…', 'download'),
    '-',
    item('palette', 'Command palette…', 'search'),
    item('help', 'Keyboard shortcuts', 'keyboard'),
  ]);
}

// ---------------------------------------------------------------- tool options
function optSlider(label, get, set, { min, max, step = 1, fmt = (v) => v, width = 110 }) {
  const out = h('output', {}, fmt(get()));
  const input = h('input', { type: 'range', min, max, step, value: get(), style: { width: `${width}px` }, 'aria-label': label,
    oninput: (e) => { set(+e.target.value); out.textContent = fmt(+e.target.value); changed('pref-save', 'content'); } });
  return h('label', { class: 'opt' }, h('span', { class: 'opt-l' }, label), input, out);
}
function optCheck(label, get, set, title) {
  return h('label', { class: 'opt check', title: title || label }, h('input', { type: 'checkbox', checked: get(), onchange: (e) => { set(e.target.checked); changed('pref-save'); } }), h('span', {}, label));
}
function optColor(label, get, set) {
  const input = h('input', { type: 'color', class: 'color', value: get(), 'aria-label': label, oninput: (e) => { set(e.target.value); changed('pref-save'); } });
  return h('label', { class: 'opt', title: label }, input);
}
function swatches(set, cur) {
  return h('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour swatches' }, app.swatches.map((c) => h('button', {
    type: 'button', class: `sw ${c.toLowerCase() === cur.toLowerCase() ? 'on' : ''}`, style: { background: c }, title: c, 'aria-label': `Colour ${c}`,
    onclick: () => { set(c); changed('prefs', 'tool'); },
  })));
}
function optSeg(options, get, set) {
  return h('div', { class: 'seg', role: 'group' }, options.map(([v, l, t, ic]) => h('button', {
    type: 'button', class: get() === v ? 'on' : '', title: t || l, 'aria-pressed': get() === v,
    onclick: () => { set(v); changed('prefs', 'tool'); },
  }, ic ? icon(ic, 15) : null, h('span', {}, l))));
}
const hint = (t) => h('span', { class: 'hint' }, t);

function targetPicker() {
  if (app.boneDraw) return null;
  const l = layerById(P(), app.activeLayer);
  const isDraw = l && l.kind === 'draw';
  return h('button', {
    type: 'button', class: 'btn target', title: 'Layer you are drawing on',
    onclick: (e) => popupMenu(e.currentTarget, [
      ...P().layers.filter((x) => x.kind === 'draw').reverse().map((x) => ({ label: `${x.name}${x.mode === 'sprite' ? ' (sprite)' : ''}`, icon: x.id === app.activeLayer ? 'check' : x.mode === 'sprite' ? 'sprite' : 'brush', run: () => { app.activeLayer = x.id; select(null); changed('layers'); } })),
      '-',
      { label: 'New frame-by-frame layer', icon: 'plus', run: () => A.addLayer('frame') },
      { label: 'New sprite layer', icon: 'sprite', run: () => A.addLayer('sprite') },
    ]),
  }, icon('layers', 15), h('span', { class: 'ell' }, isDraw ? l.name : 'Auto layer'), icon('down', 12));
}

function renderOptions() {
  const t = app.tool, b = app.brush;
  const parts = [];
  const sizeSlider = (obj, label = 'Size') => optSlider(label, () => obj.size, (v) => (obj.size = v), { min: 1, max: 120, step: 0.5, fmt: (v) => `${v}` });
  if (t === 'select') {
    parts.push(optSeg([
      ['rotate', 'Rotate', 'Joints swing around their parent (1)', 'rotate'],
      ['stretch', 'Stretch', 'Drag changes bone length too (2)', 'stretch'],
      ['ik', 'IK', 'Drag hands / feet; elbows and knees follow (3)', 'ik'],
    ], () => app.poseMode, (v) => (app.poseMode = v)));
    parts.push(optCheck('Snap 15°', () => app.snap, (v) => (app.snap = v), 'Snap angles while posing (or hold Shift)'));
    parts.push(hint(app.sel?.type === 'figure' ? 'Drag nodes to pose · Tab cycles joints · arrows rotate / stretch' : 'Tap a figure, drawing or image to select it · drag empty space to pan'));
  } else if (t === 'brush' || t === 'line' || t === 'rect' || t === 'ellipse') {
    if (t === 'brush') parts.push(h('div', { class: 'seg presets' }, Object.entries(BRUSHES).map(([id, pr]) => h('button', {
      type: 'button', class: b.preset === id ? 'on' : '', title: `${pr.label} brush`,
      onclick: () => { Object.assign(b, { size: pr.size, opacity: pr.opacity, smooth: pr.smooth, pressure: pr.pressure, taper: pr.taper, preset: id }); changed('prefs', 'tool'); },
    }, pr.label))));
    parts.push(optColor('Colour', () => b.color, (v) => (b.color = v)), swatches((c) => (b.color = c), b.color));
    parts.push(sizeSlider(b), optSlider('Opacity', () => b.opacity, (v) => (b.opacity = v), { min: 0.05, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, width: 80 }));
    if (t === 'brush') {
      parts.push(optSlider('Smooth', () => b.smooth, (v) => (b.smooth = v), { min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}`, width: 70 }));
      parts.push(optCheck('Pressure', () => b.pressure, (v) => (b.pressure = v), 'Apple Pencil / pen pressure changes width'));
      parts.push(optCheck('Taper', () => b.taper, (v) => (b.taper = v), 'Thin the start and end of strokes'));
    } else if (t !== 'line') {
      const sh = app.shape;
      parts.push(optCheck('Outline', () => sh.stroke, (v) => (sh.stroke = v)));
      parts.push(optCheck('Fill', () => sh.fill, (v) => (sh.fill = v)));
      parts.push(optColor('Fill colour', () => sh.fillColor, (v) => (sh.fillColor = v)));
      parts.push(hint('Shift: square / circle · Alt: from centre'));
    } else parts.push(hint('Shift: snap to 45°'));
  } else if (t === 'eraser') {
    parts.push(optSeg([['cut', 'Partial', 'Erase only where you rub'], ['whole', 'Whole strokes', 'Remove any stroke you touch']], () => app.eraser.mode, (v) => (app.eraser.mode = v)));
    parts.push(sizeSlider(app.eraser));
    parts.push(hint('Erases the active drawing layer (or bone art while drawing on a bone)'));
  } else if (t === 'fill') {
    const f = app.fillTool;
    parts.push(optColor('Fill colour', () => f.color, (v) => (f.color = v)), swatches((c) => (f.color = c), f.color));
    parts.push(optSlider('Opacity', () => f.opacity, (v) => (f.opacity = v), { min: 0.05, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, width: 80 }));
    parts.push(hint('Draw around an area to fill it'));
  } else if (t === 'lasso') {
    parts.push(hint('Draw a loop around strokes (Shift adds) · tap a stroke to pick it'));
    if (app.sel?.type === 'strokes') parts.push(
      h('button', { type: 'button', class: 'btn', onclick: A.flipSelection }, icon('flip', 15), 'Flip'),
      h('button', { type: 'button', class: 'btn', onclick: A.startAttach, title: tip('Attach to a bone', 'attach') }, icon('bone', 15), 'Attach to bone'),
      h('button', { type: 'button', class: 'btn', onclick: saveSelectionToLibrary }, icon('library', 15), 'Save'),
      h('button', { type: 'button', class: 'btn danger', onclick: A.deleteSelection }, icon('trash', 15), 'Delete'));
  } else if (t === 'eyedropper') parts.push(hint('Tap the canvas to pick a colour'));
  else if (t === 'hand') parts.push(hint('Drag to pan · pinch or Ctrl+scroll to zoom'));

  const drawing = ['brush', 'eraser', 'fill', 'line', 'rect', 'ellipse'].includes(t);
  const right = drawing || t === 'lasso' ? targetPicker() : null;
  optbar.replaceChildren(h('div', { class: 'opts' }, parts), h('div', { class: 'opts-right' }, drawing ? rulerButton() : null, right));
}

// ---------------------------------------------------------------- ruler
const RULER_ICON = { off: 'ruler', line: 'ruler', circle: 'circle', mirror: 'mirror' };

function rulerButton() {
  const r = ruler();
  const label = RULER_TYPES.find(([v]) => v === r.type)[1];
  return h('button', {
    type: 'button', class: `btn target ${r.type !== 'off' ? 'accent' : ''}`, title: tip('Ruler & symmetry', 'ruler-toggle'),
    onclick: (e) => rulerPopover(e.currentTarget),
  }, icon(RULER_ICON[r.type], 15), h('span', {}, r.type === 'off' ? 'Ruler' : label), icon('down', 12));
}

function rulerPopover(anchor) {
  const body = h('div', { class: 'pop-body ruler-pop' });
  const num = (label, get, set, opts = {}) => h('label', { class: 'field' }, h('span', {}, label),
    h('input', { type: 'number', class: 'num', value: Math.round(get() * 10) / 10, step: opts.step || 1, min: opts.min, oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) set(v); } }));
  const fill = () => {
    const r = ruler();
    const parts = [
      h('b', {}, 'Ruler & symmetry'),
      h('div', { class: 'seg wrap' }, RULER_TYPES.map(([v, l]) => h('button', {
        type: 'button', class: r.type === v ? 'on' : '', 'aria-pressed': r.type === v,
        onclick: () => { setRulerType(v); fill(); body.querySelector('.seg .on')?.focus(); },
      }, v !== 'off' ? icon(RULER_ICON[v], 15) : null, h('span', {}, l)))),
    ];
    if (r.type === 'line' || r.type === 'circle') {
      parts.push(h('label', { class: 'field check' },
        h('input', { type: 'checkbox', checked: r.anywhere, onchange: (e) => { r.anywhere = e.target.checked; changed('pref-save', 'content'); fill(); } }),
        h('span', {}, r.type === 'line' ? 'Snap from anywhere (parallel lines)' : 'Snap from anywhere (concentric circles)')));
      parts.push(h('p', { class: 'muted small' }, r.anywhere ? 'Every brush stroke follows the guide.' : 'Strokes that start near the guide follow it; others stay freehand.'));
    }
    if (r.type === 'line') parts.push(num('Angle °', lineAngle, setLineAngle));
    if (r.type === 'circle') parts.push(num('Radius', () => r.r, (v) => { r.r = Math.max(4, v); changed('pref-save', 'content'); }, { min: 4 }));
    if (r.type === 'mirror') parts.push(h('div', { class: 'seg' }, [['v', 'Left ↔ right'], ['h', 'Top ↕ bottom']].map(([v, l]) => h('button', {
      type: 'button', class: r.axis === v ? 'on' : '', onclick: () => { r.axis = v; changed('pref-save', 'content'); fill(); },
    }, l))));
    if (r.type !== 'off') {
      parts.push(h('div', { class: 'row gap' }, h('span', { class: 'muted' }, 'Move'),
        ibtn('prev', 'Move left', () => nudgeRuler(-10, 0), 'mini'), ibtn('up', 'Move up', () => nudgeRuler(0, -10), 'mini'),
        ibtn('down', 'Move down', () => nudgeRuler(0, 10), 'mini'), ibtn('next', 'Move right', () => nudgeRuler(10, 0), 'mini'),
        h('button', { type: 'button', class: 'btn', onclick: () => { resetRuler(); fill(); } }, 'Reset')));
      parts.push(h('p', { class: 'muted small' }, 'Drag the white handles on the canvas to place it (Shift snaps the angle).'));
    }
    body.replaceChildren(...parts);
  };
  fill();
  const m = popover(anchor, body);
  m.querySelector('.seg .on, .seg button')?.focus();
}

// ---------------------------------------------------------------- context menu
function contextItems() {
  const s = app.sel;
  const k = (id) => prettyKey(keysFor(id));
  const it = (label, ic, id, run) => ({ label, icon: ic, keys: id ? k(id) : '', run: run || (() => runCommand(id)) });
  if (s?.type === 'figure') return [
    it('Copy', 'copy', 'copy'), it('Copy pose', 'copy', 'copy-pose'), it('Paste pose', 'paste', 'paste-pose'),
    it('Duplicate', 'copy', 'duplicate'), it('Flip', 'flip', 'flip'), '-',
    it('Add joint', 'plus', 'add-node'), it('Draw on this bone', 'brush', 'bone-draw'), it('Save to library', 'library', 'save-asset'), '-',
    it('Remove from here on', 'trash', 'delete'),
  ];
  if (s?.type === 'strokes') return [
    it('Copy', 'copy', 'copy'), it('Cut', 'scissors', 'cut'), it('Duplicate', 'copy', 'duplicate'), it('Flip', 'flip', 'flip'), '-',
    it('Attach to a bone', 'bone', 'attach'), it('Save to library', 'library', 'save-asset'), '-', it('Delete', 'trash', 'delete'),
  ];
  if (s?.type === 'layer') return [
    it('Copy', 'copy', 'copy'), it('Duplicate', 'copy', 'duplicate'), it('Flip', 'flip', 'flip'), it('Save to library', 'library', 'save-asset'), '-', it('Delete', 'trash', 'delete'),
  ];
  return [
    it('Paste', 'paste', 'paste'), it('Add a stickman', 'figure', 'add-stickman'), it('New frame', 'plus', 'new-frame'),
    it('Select all strokes', 'lasso', 'select-all'), '-', it(app.onion.on ? 'Hide onion skin' : 'Show onion skin', 'onion', 'onion'), it('Fit to window', 'fit', 'zoom-fit'),
  ];
}

