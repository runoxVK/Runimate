// Timeline: playback controls, frame strip with thumbnails, sound lane, scrubber.
import { app, P, onChange, changed, goto, checkpoint } from './app.js';
import * as A from './actions.js';
import { togglePlay, stop as stopPlay, preview, getEntries } from './player.js';
import { entryOfKey, totalFrames, evalKey } from './tween.js';
import { renderToCanvas } from './render.js';
import { h, icon, ibtn, popupMenu, popover } from './ui.js';
import { prettyKey, keysFor } from './commands.js';
import { importSound, updateSound, removeSound, peaks, preload } from './audio.js';

let root, strip, playBtn, fpsInput, loopBtn, onionBtn, scrub, readout, frameInfo, soundBtn, lane, holdSeg, holdVal;
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
  onionBtn = ibtn('onion', tip('Onion skin (light table)', 'onion'), () => { app.onion.on = !app.onion.on; changed('prefs', 'content'); }, 'toggle');
  const onionMore = h('button', { class: 'ibtn mini', type: 'button', title: 'Onion skin settings', 'aria-label': 'Onion skin settings', onclick: (e) => onionPopover(e.currentTarget) }, icon('down', 14));

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
      (soundBtn = ibtn('sound', 'Sound — import music / voice, set where it starts', (e) => soundPopover(e.currentTarget), 'toggle')),
    ),
    h('div', { class: 'tl-group frame-props' },
      frameInfo,
      h('div', { class: 'hold-ctl', title: 'Hold: how many frames this drawing stays on screen — animating on 1s, 2s or 3s (K / Shift+K)' },
        h('span', { class: 'lbl' }, 'Hold'),
        (holdSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Hold for' }, [1, 2, 3].map((n) => h('button', { type: 'button', 'data-v': n, title: `Hold for ${n} (on ${n}s)`, onclick: () => A.setHold(n) }, `${n}s`)))),
        h('div', { class: 'stepper' },
          ibtn('minus', tip('Hold shorter', 'hold-less'), () => A.nudgeHold(-1), 'mini'),
          (holdVal = h('span', { class: 'hold-val', 'aria-live': 'polite' }, '1')),
          ibtn('plus', tip('Hold longer', 'hold-more'), () => A.nudgeHold(1), 'mini'))),
      h('button', { type: 'button', class: 'btn', title: tip('Add a 50% frame (nakawari) halfway between this frame and the next', 'mid-frame'), onclick: A.addMidFrame }, h('span', { class: 'jp', 'aria-hidden': 'true' }, '中割'), h('span', {}, '50% frame')),
    ),
    h('div', { class: 'tl-group' },
      ibtn('plus', tip('New frame — copies poses, blank drawing', 'new-frame'), () => A.newFrame(false), 'accent'),
      ibtn('copy', tip('Duplicate frame incl. drawings', 'dup-frame'), () => A.newFrame(true)),
      ibtn('dots', 'More frame actions', (e) => framesMenu(e.currentTarget)),
    ),
  );

  strip = h('div', { class: 'tl-strip', role: 'listbox', 'aria-label': 'Keyframes', 'aria-orientation': 'horizontal', tabindex: '-1' });
  scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: 0, value: 0, 'aria-label': 'Scrub through the frames', oninput: (e) => preview(+e.target.value) });
  scrub.addEventListener('change', () => {
    const e = getEntries()[+scrub.value];
    if (e && !e.u) preview(null);
  });
  readout = h('span', { class: 'readout' });
  lane = h('canvas', { class: 'sound-lane', 'aria-label': 'Sound waveforms. Drag a clip to move it in time.' });
  bindLane();
  root.append(controls, strip, h('div', { class: 'tl-row tl-lane' }, lane, h('span', { class: 'readout lane-label' }, 'Sound')), h('div', { class: 'tl-row tl-scrub' }, scrub, readout));
  // Redraw on the next frame: toggling the lane inside the observer would loop.
  new ResizeObserver(() => requestAnimationFrame(drawLane)).observe(lane);

  onChange((f) => {
    if (f.has('project') || f.has('frames') || f.has('layers')) rebuild();
    if (f.has('project') || f.has('layers') || f.has('thumbs')) markAll();
    else if (f.has('content')) markCurrent();
    if (f.has('camera') || f.has('content')) P().frames.forEach((fr) => thumbs.get(fr.id)?.el.classList.toggle('has-cam', !!fr.cam));
    if (f.has('frame') || f.has('frames') || f.has('project')) updateCurrent();
    if (f.has('playframe') || f.has('play') || f.has('frame') || f.has('frames') || f.has('project')) updatePlayhead();
    if (f.has('prefs') || f.has('project') || f.has('play') || f.has('frames') || f.has('frame')) updateControls();
    if (f.has('project')) preload();
    if (['sound', 'project', 'frames', 'playframe', 'frame', 'play'].some((k) => f.has(k))) drawLane();
  });
}

// ---------------------------------------------------------------- sound
function soundPopover(anchor) {
  const body = h('div', { class: 'pop-body sound-pop' });
  const fill = () => {
    const p = P(), list = p.sounds || [];
    body.replaceChildren(...[
      h('b', {}, 'Sound'),
      list.length ? null : h('p', { class: 'muted small' }, 'Add music, a voice line or sound effects. They play with the animation, show as a waveform on the timeline, and are included in MP4 exports (GIFs have no sound).'),
      ...list.map((s) => h('div', { class: 'sound-row' },
        h('div', { class: 'row between' }, h('span', { class: 'ell' }, icon('sound', 14), ' ', s.name), ibtn('trash', `Remove ${s.name}`, () => { removeSound(s.id); fill(); }, 'mini ghost')),
        h('div', { class: 'row gap wrap' },
          h('label', { class: 'field' }, h('span', {}, 'Starts at'), h('input', { type: 'number', class: 'num', step: 0.01, value: s.start.toFixed(2), oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) updateSound(s.id, { start: v }, 'snd-start' + s.id); } }), h('span', { class: 'suffix' }, 's')),
          h('button', { type: 'button', class: 'btn', title: 'Start this sound on the current frame', onclick: () => { updateSound(s.id, { start: +(entryOfKey(p, app.cur) / p.fps).toFixed(3) }); fill(); } }, 'Start here')),
        h('div', { class: 'row gap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Volume'), h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: s.vol ?? 1, oninput: (e) => updateSound(s.id, { vol: +e.target.value }, 'snd-vol' + s.id) })),
          h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: !!s.mute, onchange: (e) => updateSound(s.id, { mute: e.target.checked }) }), h('span', {}, 'Mute'))))),
      h('button', { type: 'button', class: 'btn primary', onclick: async () => { await importSound(); fill(); } }, icon('plus', 15), ' Import sound…'),
      list.length ? h('p', { class: 'muted small' }, 'Tip: drag a clip on the sound lane to slide it; scrub to hear where words land.') : null,
    ].filter(Boolean));
  };
  fill();
  const m = popover(anchor, body);
  m.querySelector('input, .btn')?.focus();
}

const LANE_H = 30;
function laneGeom() {
  const p = P();
  const total = Math.max(1, totalFrames(p));
  // Line the lane up with the scrubber below it (range thumbs inset ~8px each side).
  const w = lane.clientWidth, pad = 8;
  const secs = total / p.fps;
  return { w, pad, secs, x: (t) => pad + ((w - pad * 2) * t) / secs, t: (x) => ((x - pad) / (w - pad * 2)) * secs };
}

function drawLane() {
  if (!lane) return;
  const p = P();
  const has = (p?.sounds || []).length > 0;
  lane.parentElement.classList.toggle('hidden', !has);
  soundBtn?.classList.toggle('on', has);
  if (!has) return;
  const dpr = devicePixelRatio || 1;
  const W = lane.clientWidth;
  if (!W) return;
  lane.width = Math.round(W * dpr);
  lane.height = Math.round(LANE_H * dpr);
  const g = lane.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, LANE_H);
  const geo = laneGeom();
  p.sounds.forEach((s, idx) => {
    const x0 = geo.x(s.start), x1 = geo.x(s.start + (s.dur || 0));
    const y0 = 2, hh = LANE_H - 4;
    g.globalAlpha = s.mute ? 0.35 : 1;
    g.fillStyle = idx % 2 ? 'rgba(171,71,188,.28)' : 'rgba(77,163,255,.25)';
    g.fillRect(x0, y0, Math.max(2, x1 - x0), hh);
    const pk = peaks(s);
    if (pk) {
      g.fillStyle = idx % 2 ? '#d08ce0' : '#8fc4ff';
      const mid = y0 + hh / 2;
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x1); x++) {
        const t = geo.t(x) - s.start;
        const v = pk[Math.min(pk.length - 1, Math.max(0, Math.floor(t * 100)))] * (s.vol ?? 1);
        const a = Math.min(hh / 2, v * hh * 0.5);
        g.fillRect(x, mid - a, 1, a * 2 || 1);
      }
    }
    g.fillStyle = '#e9eaef';
    g.font = '11px system-ui, sans-serif';
    g.fillText(s.name, Math.max(4, x0 + 4), 13);
  });
  g.globalAlpha = 1;
  // Playhead.
  const i = app.playing ? app.playEntry : app.preview != null ? app.preview : entryOfKey(p, app.cur);
  const px = geo.x(i / p.fps);
  g.fillStyle = '#ff5a36';
  g.fillRect(px - 1, 0, 2, LANE_H);
}

function bindLane() {
  let d = null;
  lane.addEventListener('pointerdown', (e) => {
    const p = P(), geo = laneGeom();
    const r = lane.getBoundingClientRect(), x = e.clientX - r.left;
    const t = geo.t(x);
    const hit = [...(p.sounds || [])].reverse().find((s) => t >= s.start && t <= s.start + (s.dur || 0));
    lane.setPointerCapture(e.pointerId);
    d = hit ? { id: hit.id, x0: x, start: hit.start, moved: false } : { scrub: true };
    if (!hit) preview(Math.round(t * p.fps));
  });
  lane.addEventListener('pointermove', (e) => {
    if (!d) return;
    const p = P(), geo = laneGeom();
    const x = e.clientX - lane.getBoundingClientRect().left;
    if (d.scrub) return preview(Math.round(geo.t(x) * p.fps));
    const dt = geo.t(x) - geo.t(d.x0);
    if (Math.abs(x - d.x0) > 3) d.moved = true;
    // Snap the start to whole frames.
    if (d.moved) updateSound(d.id, { start: Math.round((d.start + dt) * p.fps) / p.fps }, 'snd-drag' + d.id);
  });
  const end = () => (d = null);
  lane.addEventListener('pointerup', end);
  lane.addEventListener('pointercancel', end);
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
      const el = h('div', { class: 'frame-thumb', role: 'option', tabindex: '-1' }, canvas,
        h('div', { class: 'cell-meta' }, h('span', { class: 'fnum' }), h('span', { class: 'kind', 'aria-hidden': 'true' }), h('span', { class: 'hold-chip' })),
        h('span', { class: 'hold-bar' }), h('span', { class: 'cam-badge', title: 'Camera keyframe' }, icon('camera', 12)));
      t = { el, canvas, dirty: true };
      bindThumb(t, f.id);
      thumbs.set(f.id, t);
    }
    t.canvas.style.width = `${tw}px`;
    t.canvas.style.height = `${th}px`;
    t.el.querySelector('.fnum').textContent = i + 1;
    t.el.classList.toggle('has-cam', !!f.cam);
    const mid = f.kind === 'mid', hold = f.hold || 1;
    t.el.classList.toggle('mid', mid);
    t.el.querySelector('.kind').textContent = mid ? '中' : '';
    t.el.querySelector('.hold-chip').textContent = hold > 1 ? `×${hold}` : '';
    // Exposure ticks beside the cell, one per extra frame (like hold lines on a timesheet).
    const ticks = Math.min(hold - 1, 8) * 4;
    const bar = t.el.querySelector('.hold-bar');
    bar.style.width = `${ticks}px`;
    bar.style.right = `${-ticks - 3}px`;
    t.el.style.marginRight = `${4 + (ticks ? ticks + 4 : 0)}px`;
    t.el.title = `${mid ? '50% frame (in-between)' : 'Key frame'} ${i + 1}${hold > 1 ? ` · held ${hold} frames` : ''}`;
    t.el.setAttribute('aria-label', `Frame ${i + 1}${mid ? ', in-between' : ''}${hold > 1 ? `, held ${hold}` : ''}`);
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
  frameInfo.textContent = sel && sel[1] > sel[0] ? `Frames ${sel[0] + 1}–${sel[1] + 1}` : `Frame ${app.cur + 1} / ${p.frames.length}`;
  const hold = p.frames[app.cur]?.hold || 1;
  holdVal.textContent = hold;
  for (const b of holdSeg.children) {
    const on = +b.dataset.v === hold;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  }
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

