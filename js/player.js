// Playback and scrubbing over the expanded (keyframes + in-betweens) timeline.
import { app, P, changed } from './app.js';
import { expand, entryOfKey } from './tween.js';

let entries = [];
let raf = 0, last = 0, acc = 0;

export const getEntries = () => entries;

export function currentEntry() {
  if (app.playing) return entries[app.playEntry] || null;
  if (app.preview != null) return entries[app.preview] || null;
  return null;
}

export function play() {
  if (app.playing) return;
  entries = expand(P());
  app.preview = null;
  let i = entryOfKey(P(), app.cur);
  if (!P().loop && i >= entries.length - 1) i = 0;
  app.playEntry = i;
  app.playing = true;
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(tick);
  changed('play');
}

function tick(t) {
  const step = 1000 / P().fps;
  acc = Math.min(acc + (t - last), step * 4);
  last = t;
  let moved = false;
  while (acc >= step) {
    acc -= step;
    moved = true;
    app.playEntry++;
    if (app.playEntry >= entries.length) {
      if (P().loop) app.playEntry = 0;
      else {
        app.playEntry = entries.length - 1;
        stop();
        return;
      }
    }
  }
  if (moved) changed('playframe');
  raf = requestAnimationFrame(tick);
}

export function stop() {
  if (!app.playing) return;
  cancelAnimationFrame(raf);
  app.playing = false;
  const e = entries[app.playEntry];
  if (e) app.cur = e.k;
  changed('play', 'frame', 'sel');
}

export const togglePlay = () => (app.playing ? stop() : play());

// Scrub preview of any rendered frame (including in-betweens). null exits preview.
export function preview(i) {
  if (app.playing) stop();
  if (i == null) {
    app.preview = null;
  } else {
    entries = expand(P());
    app.preview = Math.max(0, Math.min(entries.length - 1, i));
    app.cur = entries[app.preview].k;
  }
  changed('playframe', 'frame');
}
