// Sound clips: project.sounds = [{ id, name, src (data URL), start (s), dur (s), vol, mute }].
// Played with Web Audio during playback / scrubbing and mixed into MP4 exports.
import { P, changed, checkpoint, app } from './app.js';
import { uid } from './geom.js';
import { entryOfKey } from './tween.js';
import { readAsDataURL, pickFile } from './fileio.js';
import { toast } from './ui.js';

let ctx = null;
const buffers = new Map(); // sound id -> AudioBuffer
const pending = new Map(); // sound id -> Promise
const peaksCache = new Map();
let playing = [];

export function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const activeSounds = (p = P()) => (p.sounds || []).filter((s) => !s.mute);
export const hasSound = (p = P()) => activeSounds(p).length > 0;

export function decode(sound) {
  if (buffers.has(sound.id)) return Promise.resolve(buffers.get(sound.id));
  if (pending.has(sound.id)) return pending.get(sound.id);
  const c = audioCtx();
  if (!c) return Promise.reject(new Error('Audio isn’t supported in this browser'));
  const job = fetch(sound.src)
    .then((r) => r.arrayBuffer())
    .then((buf) => new Promise((res, rej) => c.decodeAudioData(buf, res, rej)))
    .then((ab) => {
      buffers.set(sound.id, ab);
      pending.delete(sound.id);
      changed('sound');
      return ab;
    });
  pending.set(sound.id, job);
  job.catch(() => pending.delete(sound.id));
  return job;
}
export const preload = (p = P()) => (p.sounds || []).forEach((s) => decode(s).catch(() => {}));

// ---------------------------------------------------------------- playback
let clock0 = 0; // ctx time that corresponds to `sec0`
let sec0 = 0;

// Starts every ready clip from animation time `sec`. Returns true if the audio clock drives playback.
export function startSound(sec) {
  stopSound();
  const p = P();
  if (!hasSound(p)) return false;
  const c = audioCtx();
  if (!c) return false;
  const at = c.currentTime + 0.05;
  clock0 = at;
  sec0 = sec;
  for (const s of activeSounds(p)) {
    const buf = buffers.get(s.id);
    if (!buf) continue;
    schedule(c, s, buf, at, sec);
  }
  // A suspended context's clock doesn't move yet; let the frame timer lead this time.
  return c.state === 'running';
}

function schedule(c, s, buf, at, sec, dur = null) {
  const offset = sec - s.start;
  if (offset >= buf.duration) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = s.vol ?? 1;
  src.connect(g).connect(c.destination);
  const when = at + Math.max(0, -offset);
  if (dur != null) {
    if (offset < 0 && -offset > dur) return;
    src.start(when, Math.max(0, offset), dur);
  } else src.start(when, Math.max(0, offset));
  playing.push(src);
}

// Seconds of animation time elapsed since startSound(), from the audio clock.
export const soundTime = () => (ctx ? sec0 + Math.max(0, ctx.currentTime - clock0) : null);

export function stopSound() {
  for (const s of playing) {
    try { s.stop(); } catch {}
  }
  playing = [];
}

// Short snippet while scrubbing, so you can find the frame a word starts on.
let lastBlip = 0;
export function blip(sec, dur) {
  const p = P();
  if (!hasSound(p) || app.playing) return;
  const now = performance.now();
  if (now - lastBlip < 40) return;
  lastBlip = now;
  stopSound();
  const c = audioCtx();
  if (!c) return;
  for (const s of activeSounds(p)) {
    const buf = buffers.get(s.id);
    if (buf) schedule(c, s, buf, c.currentTime + 0.01, sec, dur);
  }
}

// ---------------------------------------------------------------- editing
export async function importSound() {
  const file = await pickFile('audio/*,.mp3,.wav,.m4a,.aac,.ogg');
  if (!file) return;
  if (file.size > 40e6) return toast('That sound is over 40 MB — trim it first', { kind: 'warn' });
  try {
    const src = await readAsDataURL(file);
    const s = { id: uid('s'), name: file.name.replace(/\.[^.]+$/, '') || 'Sound', src, start: +(entryOfKey(P(), app.cur) / P().fps).toFixed(3), dur: 0, vol: 1, mute: false };
    const buf = await decode(s);
    s.dur = buf.duration;
    checkpoint();
    (P().sounds ||= []).push(s);
    changed('sound', 'project');
    toast(`Added “${s.name}” (${buf.duration.toFixed(1)} s) starting at ${s.start.toFixed(2)} s`);
  } catch (e) {
    toast(`Couldn’t read that sound: ${e.message || e}`, { kind: 'error', ms: 4000 });
  }
}

export function updateSound(id, patch, key) {
  const s = P().sounds?.find((x) => x.id === id);
  if (!s) return;
  checkpoint(key);
  Object.assign(s, patch);
  changed('sound', 'content');
}

export function removeSound(id) {
  checkpoint();
  P().sounds = P().sounds.filter((s) => s.id !== id);
  changed('sound', 'project');
}

// Max amplitude per 1/100 s for drawing waveforms.
export function peaks(sound) {
  const buf = buffers.get(sound.id);
  if (!buf) return null;
  let pk = peaksCache.get(sound.id);
  if (pk) return pk;
  const n = Math.max(1, Math.ceil(buf.duration * 100));
  pk = new Float32Array(n);
  const step = buf.length / n;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = pk[i];
      const end = Math.min(d.length, Math.floor((i + 1) * step));
      for (let j = Math.floor(i * step); j < end; j += 4) {
        const v = Math.abs(d[j]);
        if (v > m) m = v;
      }
      pk[i] = m;
    }
  }
  peaksCache.set(sound.id, pk);
  return pk;
}

// ---------------------------------------------------------------- export
// Mixes every active clip for animation time [t0, t0 + dur) into a stereo buffer.
export async function renderMix(p, t0, dur, sampleRate = 48000) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const length = Math.max(1, Math.ceil(dur * sampleRate));
  const off = new OAC(2, length, sampleRate);
  let any = false;
  for (const s of activeSounds(p)) {
    const buf = await decode(s).catch(() => null);
    if (!buf) continue;
    const offset = t0 - s.start;
    if (offset >= buf.duration || -offset >= dur) continue;
    const src = off.createBufferSource();
    src.buffer = buf;
    const g = off.createGain();
    g.gain.value = s.vol ?? 1;
    src.connect(g).connect(off.destination);
    src.start(Math.max(0, -offset), Math.max(0, offset));
    any = true;
  }
  return any ? off.startRendering() : null;
}
