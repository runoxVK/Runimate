// Timeline: playback controls, keyframe strip with thumbnails, in-between settings, scrubber.
import { app, P, onChange, changed, goto, checkpoint } from './app.js';
import * as A from './actions.js';
import { togglePlay, stop as stopPlay, preview, getEntries } from './player.js';
import { entryOfKey, totalFrames, evalKey } from './tween.js';
import { renderToCanvas } from './render.js';
import { h, icon, ibtn, popupMenu, popover } from './ui.js';
import { prettyKey, keysFor } from './commands.js';

let root, strip, playBtn, fpsInput, loopBtn, onionBtn, scrub, readout, frameInfo, inbVal, tweenSeg, easeSel;
const thumbs = new Map(); // frame id -> { el, canvas, dirty }
let thumbTimer = 0, staleTimer = 0;

const tip = (label, id) => (keysFor(id) ? `${label} (${prettyKey(keysFor(id))})` : label);

export function initTimeline(el) {
  root = el;
  playBtn = ibtn('play', tip('Play', 'play'), togglePlay, 'play');
  fpsInput = h('input', {
    type: 'number', class: 'num fps', min: 1, max: 60, 'aria-label': 'Frames per second',
    onchange: (e) => { checkpoint('fps'); P().fps = Math.max(1, Math.min(60, +e.target.value || 12)); changed('project'); },
  });
  loopBtn = ibtn('loop', tip('Loop playback', 'loop'), () => { checkpoint(); P().loop = !P().loop; changed('project'); }, 'toggle');
  onionBtn = ibtn('onion', tip('Onion skin', 'onion'), () => { app.onion.on = !app.onion.on; changed('prefs', 'content'); }, 'toggle');
  const onionMore = h('button', { class: 'ibtn mini', type: 'button', title: 'Onion skin settings', 'aria-label': 'Onion skin settings', onclick: (e) => onionPopover(e.currentTarget) }, icon('down', 14));

  inbVal = h('span', { class: 'inb-val', 'aria-live': 'polite' }, '0');
  tweenSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Between this frame and the next' },
    h('button', { type: 'button', 'data-v': 'tween', title: 'Smoothly move between this keyframe and the next', onclick: () => A.setFrameProp('tween', true) }, 'Tween'),
    h('button', { type: 'button', 'data-v': 'hold', title: 'Hold this pose for the in-between frames', onclick: () => A.setFrameProp('tween', false) }, 'Hold'));
  easeSel = h('select', { class: 'sel', 'aria-label': 'Easing', onchange: (e) => A.setFrameProp('ease', e.target.value) },
    [['linear', 'Linear'], ['inout', 'Ease in-out'], ['in', 'Ease in'], ['out', 'Ease out']].map(([v, l]) => h('option', { value: v }, l)));
  frameInfo = h('span', { class: 'frame-info' });

  const controls = h('div', { class: 'tl-row tl-top' },
    h('div', { class: 'tl-group' },
      ibtn('first', tip('First frame', 'first-frame'), () => { stopPlay(); goto(0); }),
      ibtn('prev', tip('Previous frame', 'prev-frame'), () => { stopPlay(); goto(app.cur - 1); }),
      playBtn,
      ibtn('next', tip('Next frame', 'next-frame'), () => { stopPlay(); goto(app.cur + 1); }),
      ibtn('last', tip('Last frame', 'last-frame'), () => { stopPlay(); goto(P().frames.length - 1); }),
      h('label', { class: 'fps-wrap', title: 'Playback speed in frames per second (Shift+[ / Shift+])' }, fpsInput, h('span', {}, 'fps')),
      loopBtn,
      h('span', { class: 'onion-wrap' }, onionBtn, onionMore),
    ),
    h('div', { class: 'tl-group frame-props' },
      frameInfo,
      h('span', { class: 'lbl', title: 'Extra frames generated after this keyframe (T / Alt+T)' }, 'In-betweens'),
      h('div', { class: 'stepper' },
        ibtn('minus', tip('Fewer in-betweens', 'inb-less'), () => A.nudgeInbetweens(-1), 'mini'),
        inbVal,
        ibtn('plus', tip('More in-betweens', 'inb-more'), () => A.nudgeInbetweens(1), 'mini')),
      tweenSeg,
      easeSel,
    ),
    h('div', { class: 'tl-group' },
      ibtn('plus', tip('New frame — copies poses, blank drawing', 'new-frame'), () => A.newFrame(false), 'accent'),
      ibtn('copy', tip('Duplicate frame incl. drawings', 'dup-frame'), () => A.newFrame(true)),
      ibtn('dots', 'More frame actions', (e) => framesMenu(e.currentTarget)),
    ),
  );

  strip = h('div', { class: 'tl-strip', role: 'listbox', 'aria-label': 'Keyframes', 'aria-orientation': 'horizontal', tabindex: '-1' });
  scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: 0, value: 0, 'aria-label': 'Scrub through every frame, including in-betweens', oninput: (e) => preview(+e.target.value) });
  scrub.addEventListener('change', () => {
    const e = getEntries()[+scrub.value];
    if (e && !e.u) preview(null);
  });
  readout = h('span', { class: 'readout' });
  root.append(controls, strip, h('div', { class: 'tl-row tl-scrub' }, scrub, readout));

  onChange((f) => {
    if (f.has('project') || f.has('frames') || f.has('layers')) rebuild();
    if (f.has('project') || f.has('layers') || f.has('thumbs')) markAll();
    else if (f.has('content')) markCurrent();
    if (f.has('camera') || f.has('content')) P().frames.forEach((fr) => thumbs.get(fr.id)?.el.classList.toggle('has-cam', !!fr.cam));
    if (f.has('frame') || f.has('frames') || f.has('project')) updateCurrent();
    if (f.has('playframe') || f.has('play') || f.has('frame') || f.has('frames') || f.has('project')) updatePlayhead();
    if (f.has('prefs') || f.has('project') || f.has('play') || f.has('frames') || f.has('frame')) updateControls();
  });
}

function framesMenu(anchor) {
  const k = (id) => prettyKey(keysFor(id));
  popupMenu(anchor, [
    { label: 'Copy frame(s)', icon: 'copy', keys: k('copy-frames'), run: A.copyFrames },
    { label: 'Paste frame(s) after this', icon: 'paste', keys: k('paste-frames'), run: A.pasteFrames, disabled: app.clipboard?.type !== 'frames' },
    '-',
    { label: 'Move left', icon: 'prev', keys: k('move-frame-left'), run: () => A.moveFrames(-1) },
    { label: 'Move right', icon: 'next', keys: k('move-frame-right'), run: () => A.moveFrames(1) },
    '-',
    { label: 'Delete frame(s)', icon: 'trash', keys: k('delete-frame'), run: A.deleteFrames },
  ]);
}

function onionPopover(anchor) {
  const o = app.onion;
  const rng = (key, min, max, step, label) => h('label', { class: 'field col' }, h('span', {}, label),
    h('input', { type: 'range', min, max, step, value: o[key], oninput: (e) => { o[key] = +e.target.value; changed('prefs', 'content'); } }));
  const m = popover(anchor, h('div', { class: 'pop-body' },
    h('b', {}, 'Onion skin'),
    rng('before', 0, 5, 1, 'Frames before (red)'),
    rng('after', 0, 5, 1, 'Frames after (green)'),
    rng('opacity', 0.05, 0.9, 0.05, 'Strength')));
  m.querySelector('input').focus();
}

// ---------------------------------------------------------------- strip
function thumbSize() {
  const p = P();
  return [88, Math.max(20, Math.min(56, Math.round((88 * p.height) / p.width)))];
}

function rebuild() {
  const p = P();
  const [tw, th] = thumbSize();
  const ids = new Set(p.frames.map((f) => f.id));
  for (const id of [...thumbs.keys()]) if (!ids.has(id)) thumbs.delete(id);
  const els = p.frames.map((f, i) => {
    let t = thumbs.get(f.id);
    if (!t) {
      const canvas = h('canvas', { class: 'thumb-c' });
      const el = h('div', { class: 'frame-thumb', role: 'option', tabindex: '-1' }, canvas, h('span', { class: 'fnum' }), h('span', { class: 'badge' }), h('span', { class: 'cam-badge', title: 'Camera keyframe' }, icon('camera', 12)));
      t = { el, canvas, dirty: true };
      bindThumb(t, f.id);
      thumbs.set(f.id, t);
    }
    t.canvas.style.width = `${tw}px`;
    t.canvas.style.height = `${th}px`;
    t.el.querySelector('.fnum').textContent = i + 1;
    const badge = t.el.querySelector('.badge');
    badge.textContent = f.inb ? `${f.tween ? '~' : '⏸'}${f.inb}` : '';
    t.el.classList.toggle('has-cam', !!f.cam);
    badge.title = f.inb ? `${f.inb} ${f.tween ? 'tweened' : 'held'} in-between frame${f.inb > 1 ? 's' : ''}` : '';
    t.el.style.setProperty('--inb', Math.min(f.inb, 12));
    t.el.setAttribute('aria-label', `Frame ${i + 1}${f.inb ? `, ${f.inb} in-betweens` : ''}`);
    return t.el;
  });
  const add = h('button', { class: 'frame-add', type: 'button', title: tip('New frame', 'new-frame'), 'aria-label': 'New frame', onclick: () => A.newFrame(false) }, icon('plus', 22));
  strip.replaceChildren(...els, add);
  scheduleThumbs();
}

function bindThumb(t, id) {
  let down = null, timer = 0;
  const idx = () => P().frames.findIndex((f) => f.id === id);
  t.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, type: e.pointerType, armed: e.pointerType !== 'touch', dragging: false, id: e.pointerId };
    if (e.pointerType === 'touch') timer = setTimeout(() => { if (down) { down.armed = true; t.el.classList.add('lift'); } }, 380);
  });
  t.el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (!down.dragging && down.armed && Math.abs(dx) > 8) {
      down.dragging = true;
      t.el.setPointerCapture(down.id);
      t.el.classList.add('dragging');
    }
    if (!down.armed && Math.abs(dx) > 10) { clearTimeout(timer); down = null; return; }
    if (down.dragging) {
      t.el.style.transform = `translateX(${dx}px)`;
      showDropMarker(e.clientX);
    }
  });
  const end = (e) => {
    clearTimeout(timer);
    t.el.classList.remove('lift');
    if (!down) return;
    const d = down;
    down = null;
    if (d.dragging) {
      t.el.style.transform = '';
      t.el.classList.remove('dragging');
      const to = dropIndex(e.clientX);
      hideDropMarker();
      const from = idx();
      if (to !== from && to !== from + 1) {
        checkpoint();
        const p = P();
        const [f] = p.frames.splice(from, 1);
        const at = to > from ? to - 1 : to;
        p.frames.splice(at, 0, f);
        app.cur = at;
        app.frameSel = null;
        changed('frames', 'frame');
      }
      return;
    }
    if (e.type === 'pointercancel') return;
    const i = idx();
    stopPlay();
    if (e.shiftKey) {
      app.frameSel = [app.frameSel ? app.frameSel[0] : app.cur, i];
      changed('frames');
    } else app.frameSel = null;
    goto(i);
    changed('frames');
  };
  t.el.addEventListener('pointerup', end);
  t.el.addEventListener('pointercancel', end);
  t.el.addEventListener('contextmenu', (e) => { e.preventDefault(); goto(idx()); framesMenu(t.el); });
}

let marker;
function dropIndex(x) {
  const els = [...strip.querySelectorAll('.frame-thumb')];
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return els.length;
}
function showDropMarker(x) {
  marker ||= h('div', { class: 'drop-marker' });
  const els = [...strip.querySelectorAll('.frame-thumb')];
  const i = dropIndex(x);
  const ref = els[i] || strip.querySelector('.frame-add');
  const r = ref.getBoundingClientRect(), sr = strip.getBoundingClientRect();
  marker.style.left = `${r.left - sr.left + strip.scrollLeft - 4}px`;
  if (!marker.isConnected) strip.append(marker);
}
const hideDropMarker = () => marker?.remove();

function updateCurrent() {
  const p = P();
  const sel = app.frameSel ? [Math.min(...app.frameSel), Math.max(...app.frameSel)] : null;
  p.frames.forEach((f, i) => {
    const t = thumbs.get(f.id);
    if (!t) return;
    t.el.classList.toggle('cur', i === app.cur);
    t.el.classList.toggle('in-sel', !!sel && i >= sel[0] && i <= sel[1]);
    t.el.setAttribute('aria-selected', i === app.cur);
  });
  const cur = thumbs.get(p.frames[app.cur]?.id);
  cur?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const f = p.frames[app.cur];
  inbVal.textContent = f.inb;
  for (const b of tweenSeg.children) b.classList.toggle('on', (b.dataset.v === 'tween') === f.tween);
  easeSel.value = f.ease;
  easeSel.disabled = !f.tween || !f.inb;
  frameInfo.textContent = sel && sel[1] > sel[0] ? `Frames ${sel[0] + 1}–${sel[1] + 1}` : `Frame ${app.cur + 1} / ${p.frames.length}`;
}

function updatePlayhead() {
  const p = P();
  const total = totalFrames(p);
  scrub.max = Math.max(0, total - 1);
  const i = app.playing ? app.playEntry : app.preview != null ? app.preview : entryOfKey(p, app.cur);
  scrub.value = i;
  readout.textContent = `${i + 1} / ${total}  ·  ${(i / p.fps).toFixed(2)}s / ${(total / p.fps).toFixed(2)}s`;
  if (app.playing) {
    const k = getEntries()[app.playEntry]?.k;
    p.frames.forEach((f, j) => thumbs.get(f.id)?.el.classList.toggle('cur', j === k));
  }
}

function updateControls() {
  const p = P();
  playBtn.replaceChildren(icon(app.playing ? 'pause' : 'play'));
  playBtn.title = app.playing ? tip('Pause', 'play') : tip('Play', 'play');
  playBtn.classList.toggle('on', app.playing);
  if (document.activeElement !== fpsInput) fpsInput.value = p.fps;
  loopBtn.classList.toggle('on', p.loop);
  loopBtn.setAttribute('aria-pressed', p.loop);
  onionBtn.classList.toggle('on', app.onion.on);
  onionBtn.setAttribute('aria-pressed', app.onion.on);
  root.classList.toggle('playing', app.playing);
}

// ---------------------------------------------------------------- thumbnails
function markCurrent() {
  const t = thumbs.get(P().frames[app.cur]?.id);
  if (t) t.dirty = true;
  clearTimeout(staleTimer);
  // Sprite layers and rig edits can change other frames too; refresh them lazily.
  staleTimer = setTimeout(markAll, 1500);
  scheduleThumbs(160);
}
function markAll() {
  for (const t of thumbs.values()) t.dirty = true;
  scheduleThumbs(60);
}
function scheduleThumbs(ms = 100) {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(drawThumbs, ms);
}
function drawThumbs() {
  if (app.playing) return scheduleThumbs(500);
  const p = P();
  const [w, hh] = thumbSize();
  const t0 = performance.now();
  // Current frame first, then the rest in small batches to keep the UI responsive.
  const order = [app.cur, ...p.frames.keys()];
  for (const i of order) {
    const f = p.frames[i];
    const t = f && thumbs.get(f.id);
    if (!t || !t.dirty) continue;
    renderToCanvas(p, evalKey(p, i), w * 2, hh * 2, { canvas: t.canvas });
    t.dirty = false;
    if (performance.now() - t0 > 12) return scheduleThumbs(16);
  }
}

