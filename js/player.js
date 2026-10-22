// Playback and scrubbing over the expanded (keyframes + in-betweens) timeline.
import { app, P, changed } from './app.js';
import { expand, entryOfKey } from './tween.js';
import { startSound, stopSound, soundTime, blip } from './audio.js';

let entries = [];
let raf = 0, last = 0, acc = 0;
let audioClock = false; // when sound plays, its clock drives the playhead so lip-sync stays locked
let lastSoundT = 0, lastSoundAt = 0;

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
  audioClock = startSound(i / P().fps);
  last = lastSoundAt = performance.now();
  lastSoundT = -1;
  acc = 0;
  raf = requestAnimationFrame(tick);
  changed('play');
}

function tick(t) {
  if (audioClock) return tickAudio(t);
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

function tickAudio(t) {
  const st = soundTime();
  if (st !== lastSoundT) {
    lastSoundT = st;
    lastSoundAt = t;
  } else if (t - lastSoundAt > 300) {
    // The audio clock stalled (no output device, Bluetooth hiccup…): keep going on the frame timer.
    audioClock = false;
    last = t;
    acc = 0;
    raf = requestAnimationFrame(tick);
    return;
  }
  let e = Math.floor(st * P().fps + 1e-6);
  if (e >= entries.length) {
    if (!P().loop) {
      app.playEntry = entries.length - 1;
      return stop();
    }
    e = 0;
    startSound(0);
  }
  if (e !== app.playEntry) {
    app.playEntry = e;
    changed('playframe');
  }
  raf = requestAnimationFrame(tick);
}

export function stop() {
  if (!app.playing) return;
  cancelAnimationFrame(raf);
  stopSound();
  audioClock = false;
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
    blip(app.preview / P().fps, Math.max(0.08, 1.5 / P().fps));
  }
  changed('playframe', 'frame');
}
