// Command registry: every action has a name, optional shortcuts and shows up in the
// command palette (Ctrl+K) and the shortcuts sheet (?), so the whole app works from the keyboard.
import { app, P, changed, undo, redo, canUndo, canRedo, select, goto, checkpoint } from './app.js';
import * as A from './actions.js';
import { togglePlay, stop as stopPlay } from './player.js';
import { fit, zoomBy, zoomTo, stageKey, stageCanvas } from './stage.js';
import { openExport } from './export.js';
import { save, saveAs, openFile, newProjectDialog, projectsDialog } from './projects.js';
import { saveSelectionToLibrary, importLibrary, exportLibrary } from './library.js';
import { h, icon, openDialog, isTyping, toast, isMac } from './ui.js';
import { toggleRuler, setRulerType, ruler } from './ruler.js';

export const commands = [];
const byId = new Map();
function cmd(id, group, label, keys, run, opts = {}) {
  const c = { id, group, label, keys: keys ? [].concat(keys) : [], run, ...opts };
  commands.push(c);
  byId.set(id, c);
}
export const runCommand = (id) => byId.get(id)?.run();
export const keysFor = (id) => byId.get(id)?.keys[0] || '';

const panelTab = (t) => () => { app.panelTab = t; app.panelOpen = true; changed('panel'); };

// ---- File
cmd('new', 'File', 'New animation…', 'ctrl+alt+n', newProjectDialog);
cmd('projects', 'File', 'Your animations…', 'ctrl+o', projectsDialog);
cmd('open-file', 'File', 'Open project file…', 'ctrl+shift+o', openFile);
cmd('save', 'File', 'Save', 'ctrl+s', save);
cmd('save-as', 'File', 'Save to file…', 'ctrl+shift+s', saveAs);
cmd('export', 'File', 'Export (GIF, MP4, PNG)…', 'ctrl+e', () => openExport());
cmd('import-image', 'File', 'Import image (for tracing)…', 'ctrl+alt+i', A.importImage);
cmd('lib-import', 'File', 'Import library file…', null, importLibrary);
cmd('lib-export', 'File', 'Export my library…', null, () => exportLibrary());

// ---- Edit
cmd('undo', 'Edit', 'Undo', ['ctrl+z'], () => undo() || toast('Nothing to undo', { ms: 900 }), { enabled: canUndo });
cmd('redo', 'Edit', 'Redo', ['ctrl+shift+z', 'ctrl+y'], () => redo() || toast('Nothing to redo', { ms: 900 }), { enabled: canRedo });
cmd('copy', 'Edit', 'Copy (selection, or frame if nothing selected)', 'ctrl+c', () => A.copy());
cmd('cut', 'Edit', 'Cut', 'ctrl+x', () => A.copy(true));
cmd('paste', 'Edit', 'Paste', 'ctrl+v', A.paste);
cmd('duplicate', 'Edit', 'Duplicate selection', 'ctrl+d', A.duplicateSelection);
cmd('delete', 'Edit', 'Delete selection', ['delete', 'backspace'], () => A.deleteSelection() || toast('Nothing selected', { ms: 900 }));
cmd('select-all', 'Edit', 'Select all strokes on layer', 'ctrl+a', A.selectAll);
cmd('deselect', 'Edit', 'Deselect / cancel', 'escape', escape);
cmd('flip', 'Edit', 'Flip horizontally', 'shift+f', A.flipSelection);
cmd('save-asset', 'Edit', 'Save selection to library', 'ctrl+shift+l', saveSelectionToLibrary);

// ---- Tools
const tool = (t) => () => A.setTool(t);
cmd('tool-select', 'Tools', 'Animate / select tool', 'v', tool('select'));
cmd('tool-brush', 'Tools', 'Brush', 'b', tool('brush'));
cmd('tool-eraser', 'Tools', 'Eraser', 'e', tool('eraser'));
cmd('tool-fill', 'Tools', 'Fill shape (draw a filled area)', 'f', tool('fill'));
cmd('tool-line', 'Tools', 'Line', 'l', tool('line'));
cmd('tool-rect', 'Tools', 'Rectangle', 'r', tool('rect'));
cmd('tool-ellipse', 'Tools', 'Ellipse', 'u', tool('ellipse'));
cmd('tool-lasso', 'Tools', 'Lasso select strokes', 's', tool('lasso'));
cmd('tool-eyedropper', 'Tools', 'Eyedropper', 'i', tool('eyedropper'));
cmd('tool-hand', 'Tools', 'Hand (pan)', 'h', tool('hand'));
cmd('tool-camera', 'Tools', 'Camera tool (animate pan / zoom / rotate)', 'c', tool('camera'));
cmd('camera-view', 'Playback', 'Toggle camera view when playing', 'shift+c', () => { app.camView = !app.camView; changed('prefs', 'content'); toast(app.camView ? 'Playback shows the camera’s shot' : 'Playback shows the whole stage', { ms: 1400 }); });
cmd('camera-reset', 'Tools', 'Reset camera on this frame', null, () => (A.resetCamera()));
cmd('brush-bigger', 'Tools', 'Bigger brush / eraser', ']', () => brushSize(1.25));
cmd('brush-smaller', 'Tools', 'Smaller brush / eraser', '[', () => brushSize(0.8));
cmd('pose-rotate', 'Tools', 'Pose mode: rotate joints', '1', () => poseMode('rotate'));
cmd('pose-stretch', 'Tools', 'Pose mode: stretch joints', '2', () => poseMode('stretch'));
cmd('pose-ik', 'Tools', 'Pose mode: IK (drag hands / feet)', '3', () => poseMode('ik'));

// ---- Figures
cmd('add-stickman', 'Figure', 'Add a stickman', 'shift+a', () => A.insertPreset('stickman'));
cmd('add-node', 'Figure', 'Add joint to selected node', 'a', A.addNode);
cmd('delete-node', 'Figure', 'Delete selected joint', 'x', A.removeNode);
cmd('next-node', 'Figure', 'Next joint', 'tab', () => {}, { hidden: true, label2: 'Tab / Shift+Tab' });
cmd('copy-pose', 'Figure', 'Copy pose', 'ctrl+shift+c', A.copyPose);
cmd('paste-pose', 'Figure', 'Paste pose', 'ctrl+shift+v', A.pastePose);
cmd('reset-pose', 'Figure', 'Reset pose to default', null, A.resetPose);
cmd('bone-draw', 'Figure', 'Draw on selected bone', 'shift+b', A.startBoneDraw);
cmd('attach', 'Figure', 'Attach selected strokes to a bone', 'shift+t', A.startAttach);

// ---- Frames
cmd('new-frame', 'Frames', 'New frame (copies poses)', 'n', () => A.newFrame(false));
cmd('dup-frame', 'Frames', 'Duplicate frame (copies drawings too)', 'shift+n', () => A.newFrame(true));
cmd('delete-frame', 'Frames', 'Delete frame', 'shift+delete', A.deleteFrames);
cmd('prev-frame', 'Frames', 'Previous frame', [',', 'arrowleft'], () => step(-1));
cmd('next-frame', 'Frames', 'Next frame', ['.', 'arrowright'], () => step(1));
cmd('first-frame', 'Frames', 'First frame', 'home', () => { stopPlay(); goto(0); });
cmd('last-frame', 'Frames', 'Last frame', 'end', () => { stopPlay(); goto(P().frames.length - 1); });
cmd('move-frame-left', 'Frames', 'Move frame left', 'alt+,', () => A.moveFrames(-1));
cmd('move-frame-right', 'Frames', 'Move frame right', 'alt+.', () => A.moveFrames(1));
cmd('extend-left', 'Frames', 'Extend frame selection left', 'shift+,', () => extend(-1));
cmd('extend-right', 'Frames', 'Extend frame selection right', 'shift+.', () => extend(1));
cmd('copy-frames', 'Frames', 'Copy frame(s)', 'ctrl+alt+c', A.copyFrames);
cmd('paste-frames', 'Frames', 'Paste frame(s) after current', 'ctrl+alt+v', A.pasteFrames);
cmd('inb-more', 'Frames', 'More in-betweens (slower, smoother)', 't', () => A.nudgeInbetweens(1));
cmd('inb-less', 'Frames', 'Fewer in-betweens', 'alt+t', () => A.nudgeInbetweens(-1));
cmd('tween-toggle', 'Frames', 'Toggle tween / hold for frame', 'y', () => A.setFrameProp('tween', !P().frames[app.cur].tween));

// ---- Playback & view
cmd('play', 'Playback', 'Play / pause', 'space', togglePlay);
cmd('loop', 'Playback', 'Toggle loop', 'shift+l', () => { checkpoint(); P().loop = !P().loop; changed('project'); toast(P().loop ? 'Loop on' : 'Loop off', { ms: 900 }); });
cmd('onion', 'Playback', 'Toggle onion skin', 'o', () => { app.onion.on = !app.onion.on; changed('prefs', 'content'); toast(app.onion.on ? 'Onion skin on' : 'Onion skin off', { ms: 900 }); });
cmd('fps-up', 'Playback', 'Faster (FPS +1)', 'shift+]', () => setFps(P().fps + 1));
cmd('fps-down', 'Playback', 'Slower (FPS −1)', 'shift+[', () => setFps(P().fps - 1));
cmd('zoom-in', 'View', 'Zoom in', ['=', 'ctrl+='], () => zoomBy(1.25));
cmd('zoom-out', 'View', 'Zoom out', ['-', 'ctrl+-'], () => zoomBy(0.8));
cmd('zoom-fit', 'View', 'Fit canvas to window', ['0', 'ctrl+0'], fit);
cmd('zoom-100', 'View', 'Actual size (100%)', 'ctrl+alt+0', () => zoomTo(1));
cmd('ruler-toggle', 'Tools', 'Ruler on / off', 'q', () => { toggleRuler(); rulerToast(); });
cmd('ruler-line', 'Tools', 'Straight ruler', 'shift+q', () => { setRulerType('line'); rulerToast(); });
cmd('ruler-circle', 'Tools', 'Circle ruler', null, () => { setRulerType('circle'); rulerToast(); });
cmd('ruler-mirror', 'Tools', 'Mirror symmetry', 'm', () => { setRulerType('mirror'); rulerToast(); });
cmd('ruler-anywhere', 'Tools', 'Ruler: snap strokes from anywhere', null, () => { ruler().anywhere = !ruler().anywhere; changed('pref-save', 'ruler'); toast(ruler().anywhere ? 'Every stroke follows the ruler' : 'Only strokes started near the ruler follow it', { ms: 1600 }); });
cmd('grid', 'View', 'Toggle grid', 'g', () => { app.grid = !app.grid; changed('prefs', 'content'); });
cmd('panel', 'View', 'Show / hide side panel', '\\', () => { app.panelOpen = !app.panelOpen; changed('panel'); });
cmd('panel-props', 'View', 'Properties panel', 'alt+1', panelTab('props'));
cmd('panel-layers', 'View', 'Layers panel', 'alt+2', panelTab('layers'));
cmd('panel-library', 'View', 'Library panel', 'alt+3', panelTab('library'));
cmd('focus-cycle', 'View', 'Move focus between areas', 'f6', cycleFocus);
cmd('palette', 'Help', 'Command palette', ['ctrl+k', '/'], openPalette);
cmd('help', 'Help', 'Keyboard shortcuts', ['?', 'shift+/', 'f1'], openHelp);

function rulerToast() {
  const t = ruler().type;
  const drawing = ['brush', 'eraser', 'fill', 'line', 'rect', 'ellipse'].includes(app.tool);
  if (t !== 'off' && !drawing) A.setTool('brush');
  toast({ off: 'Ruler off', line: 'Straight ruler — strokes started near it follow it. Drag its handles to move it.', circle: 'Circle ruler — strokes started near it follow the circle', mirror: 'Mirror symmetry — everything you draw is reflected' }[t], { ms: 2200 });
}
function escape() {
  if (app.playing) return stopPlay();
  if (app.boneDraw) return A.endBoneDraw();
  if (app.attachPending) { app.attachPending = false; changed('sel'); return; }
  if (app.frameSel) { app.frameSel = null; changed('frames'); }
  if (app.sel) select(null);
  stageCanvas()?.focus();
}
function step(d) {
  stopPlay();
  goto(app.cur + d);
  app.frameSel = null;
}
function extend(d) {
  const s = app.frameSel || [app.cur, app.cur];
  const b = Math.max(0, Math.min(P().frames.length - 1, s[1] + d));
  app.frameSel = [s[0], b];
  goto(b);
  changed('frames');
}
function brushSize(k) {
  const t = app.tool === 'eraser' ? app.eraser : app.brush;
  t.size = Math.max(1, Math.min(400, Math.round(t.size * k * 10) / 10));
  changed('tool', 'content');
}
function poseMode(m) {
  app.poseMode = m;
  changed('tool');
  toast({ rotate: 'Rotate: joints swing around their parent', stretch: 'Stretch: drag to change bone length too', ik: 'IK: drag a hand or foot, the elbow / knee follows' }[m], { ms: 1600 });
}
function setFps(v) {
  checkpoint('fps');
  P().fps = Math.max(1, Math.min(60, v));
  changed('project');
}

// ---------------------------------------------------------------- keyboard routing
function comboOf(e) {
  let k = e.key.toLowerCase();
  if (k === ' ') k = 'space';
  if (k === 'del') k = 'delete';
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  // Shift is implied by printable symbols like '?' but we keep it for letters/named keys.
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k) || [',', '.', '[', ']', '/'].includes(k))) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}
// Shifted punctuation arrives as the shifted character on most layouts.
const SHIFTED = { '<': ',', '>': '.', '{': '[', '}': ']', '?': '/' };

const keyMap = new Map();
function buildKeyMap() {
  keyMap.clear();
  for (const c of commands) for (const k of c.keys) keyMap.set(k, c);
}

export function initKeys() {
  buildKeyMap();
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const typing = isTyping(e.target);
    let combo = comboOf(e);

    if (typing) {
      // Only global save/undo-ish shortcuts while typing in a field; Escape leaves the field.
      if (e.key === 'Escape') { e.target.blur(); stageCanvas()?.focus(); e.preventDefault(); }
      if (!['ctrl+s', 'ctrl+e', 'ctrl+k', 'ctrl+o'].includes(combo)) return;
    }
    // Buttons/checkboxes keep their native Space / Enter behaviour.
    const onControl = e.target.closest?.('button, [role="radio"], input, select, a, .frame-thumb');
    if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
    const onStage = e.target === stageCanvas() || e.target === document.body;
    if (onStage && stageKey(e)) return e.preventDefault();
    if (e.key === 'Tab') return; // native focus navigation elsewhere
    if (!onStage && e.key.startsWith('Arrow') && !e.altKey && !e.ctrlKey) return; // lists / sliders use arrows

    let c = keyMap.get(combo);
    if (!c && e.shiftKey && SHIFTED[e.key]) c = keyMap.get(comboOf({ ...e, key: SHIFTED[e.key], shiftKey: true, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey }));
    if (!c && e.key === '?') c = byId.get('help');
    if (!c) return;
    if (c.enabled && !c.enabled()) { e.preventDefault(); return; }
    e.preventDefault();
    c.run();
  });
}

export function prettyKey(k) {
  if (!k) return '';
  return k.split('+').map((p) => ({ ctrl: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: 'Shift', space: 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', escape: 'Esc', delete: 'Del', backspace: '⌫', home: 'Home', end: 'End', tab: 'Tab' }[p] || p.toUpperCase())).join(isMac ? '' : '+');
}

// ---------------------------------------------------------------- palette & help
function openPalette() {
  const input = h('input', { type: 'search', class: 'text palette-input', placeholder: 'Type a command…', 'aria-label': 'Search commands' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  let items = [], idx = 0;
  const visible = commands.filter((c) => !c.hidden);
  const { close } = openDialog({ title: 'Command palette', body: h('div', {}, input, list), cls: 'palette' });
  function score(c, q) {
    const s = `${c.group} ${c.label}`.toLowerCase();
    if (!q) return 1;
    let i = 0, sc = 0;
    for (const ch of q) {
      const j = s.indexOf(ch, i);
      if (j < 0) return 0;
      sc += j === i ? 2 : 1;
      i = j + 1;
    }
    return sc + (s.includes(q) ? 10 : 0);
  }
  function draw() {
    const q = input.value.trim().toLowerCase();
    items = visible.map((c) => [c, score(c, q)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 60);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((c, i) => h('div', {
      class: `palette-item ${i === idx ? 'on' : ''}`, role: 'option', 'aria-selected': i === idx,
      onclick: () => { close(); c.run(); },
    }, h('span', { class: 'muted small' }, c.group), h('span', { class: 'grow' }, c.label), c.keys[0] ? h('kbd', {}, prettyKey(c.keys[0])) : null)));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  input.addEventListener('input', () => { idx = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') idx = Math.min(items.length - 1, idx + 1);
    else if (e.key === 'ArrowUp') idx = Math.max(0, idx - 1);
    else if (e.key === 'Enter') { const c = items[idx]; close(); c?.run(); return; }
    else return;
    e.preventDefault();
    draw();
  });
  draw();
  input.focus();
}

export function openHelp() {
  const groups = {};
  for (const c of commands) (groups[c.group] ||= []).push(c);
  const extra = {
    Figure: [['Tab / Shift+Tab', 'Select next / previous joint'], ['← →', 'Rotate selected joint (Shift = 15°, Alt = 1°)'], ['↑ ↓', 'Stretch selected joint'], ['Ctrl + ← →', 'Rotate whole figure'], ['Ctrl + ↑ ↓', 'Scale whole figure'], ['Arrows (main node)', 'Move figure'], ['Shift while dragging', 'Snap angles to 15°']],
    View: [['Two-finger drag / pinch', 'Pan and zoom (iPad)'], ['Two-finger tap', 'Undo (three fingers: redo)'], ['Ctrl + wheel / trackpad pinch', 'Zoom'], ['Wheel / two-finger scroll', 'Pan'], ['Long-press / right-click', 'Context menu']],
    Tools: [['Alt + click (brush)', 'Pick colour'], ['Shift (shapes)', 'Square / circle / 45° line'], ['Alt (shapes)', 'Draw from centre']],
  };
  const body = h('div', { class: 'help-cols' }, Object.entries(groups).map(([g, list]) => h('section', {},
    h('h3', {}, g),
    h('dl', {},
      list.filter((c) => c.keys.length && !c.hidden).map((c) => [h('dt', {}, c.keys.map((k) => h('kbd', {}, prettyKey(k)))), h('dd', {}, c.label)]),
      (extra[g] || []).map(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)])))));
  openDialog({ title: 'Keyboard shortcuts', body, wide: true, cls: 'help' });
}

function cycleFocus() {
  const zones = ['#toolbar', '#stage-canvas', '#panel', '#timeline'].map((s) => document.querySelector(s)).filter((z) => z && z.offsetParent !== null);
  const i = zones.findIndex((z) => z.contains(document.activeElement));
  const z = zones[(i + 1) % zones.length];
  const target = z.matches('canvas') ? z : z.querySelector('button.on, .on button, button, input, select, [tabindex="0"]') || z;
  target.focus();
}
