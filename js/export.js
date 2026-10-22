// Export dialog: GIF, MP4 video, PNG sequence (zip), sprite sheet, single frame, project file.
import { app, P } from './app.js';
import { expand, evalEntry, evalKey } from './tween.js';
import { renderToCanvas } from './render.js';
import { GifEncoder } from './gif.js';
import { makeZip } from './zip.js';
import { h, icon, openDialog, toast } from './ui.js';
import { downloadBlob, canShareFile, shareFile, safeName, saveProjectFile, EXT } from './fileio.js';
import { currentEntry } from './player.js';
import { hasSound, renderMix } from './audio.js';

const FORMATS = [
  { id: 'gif', label: 'Animated GIF', desc: 'Loops anywhere — chats, web', icon: 'image', anim: true, alpha: true },
  { id: 'mp4', label: 'MP4 video', desc: 'Best quality for sharing / Photos', icon: 'frames', anim: true },
  { id: 'png-seq', label: 'PNG sequence', desc: 'Every frame as PNG in a .zip', icon: 'library', anim: true, alpha: true },
  { id: 'sheet', label: 'Sprite sheet', desc: 'All frames on one PNG grid', icon: 'grid', anim: true, alpha: true },
  { id: 'png', label: 'Current frame', desc: 'One PNG image', icon: 'image', alpha: true },
  { id: 'project', label: 'Project file', desc: `Editable ${EXT} backup`, icon: 'save' },
];

const opts = { format: 'gif', scale: 1, transparent: false, from: 1, to: 0, fps: 0, loop: true };

export function openExport(initial) {
  const p = P();
  if (initial) opts.format = initial;
  opts.from = Math.min(opts.from, p.frames.length);
  opts.to = opts.to && opts.to <= p.frames.length ? opts.to : p.frames.length;
  opts.fps = p.fps;

  const body = h('div', { class: 'export' });
  const info = h('div', { class: 'muted small' });
  const progress = h('div', { class: 'progress hidden' }, h('div', { class: 'bar' }), h('span', { class: 'ptext' }));
  const result = h('div', { class: 'result hidden' });
  let busy = false, cancelled = false;

  const cards = h('div', { class: 'formats', role: 'radiogroup', 'aria-label': 'Format' },
    FORMATS.map((f) => h('button', {
      type: 'button', role: 'radio', class: 'fmt', 'data-id': f.id,
      onclick: () => { opts.format = f.id; sync(); },
      onkeydown: (e) => {
        const i = FORMATS.findIndex((x) => x.id === opts.format);
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        opts.format = FORMATS[(i + d + FORMATS.length) % FORMATS.length].id;
        sync();
        cards.querySelector(`[data-id="${opts.format}"]`).focus();
      },
    }, icon(f.icon, 22), h('b', {}, f.label), h('span', {}, f.desc))));

  const num = (key, min, max, label) => h('label', { class: 'field' }, h('span', {}, label),
    h('input', { type: 'number', class: 'num', min, max, value: opts[key], oninput: (e) => { opts[key] = Math.max(min, Math.min(max, +e.target.value || min)); sync(false); } }));
  const scaleSel = h('select', { class: 'sel', onchange: (e) => { opts.scale = +e.target.value; sync(false); } },
    [0.25, 0.5, 0.75, 1, 1.5, 2].map((s) => h('option', { value: s, selected: s === opts.scale }, `${s * 100}%`)));
  const transparent = h('input', { type: 'checkbox', checked: opts.transparent, onchange: (e) => { opts.transparent = e.target.checked; sync(false); } });
  const loop = h('input', { type: 'checkbox', checked: opts.loop, onchange: (e) => { opts.loop = e.target.checked; } });

  const rowScale = h('label', { class: 'field' }, h('span', {}, 'Size'), scaleSel);
  const rowAlpha = h('label', { class: 'field check' }, transparent, h('span', {}, 'Transparent background'));
  const rowLoop = h('label', { class: 'field check' }, loop, h('span', {}, 'Loop forever'));
  const rowRange = h('div', { class: 'row gap' }, num('from', 1, p.frames.length, 'From keyframe'), num('to', 1, p.frames.length, 'To keyframe'), num('fps', 1, 60, 'FPS'));

  body.append(cards, h('div', { class: 'export-opts' }, rowRange, h('div', { class: 'row gap' }, rowScale, rowAlpha, rowLoop)), info, progress, result);

  function sync(full = true) {
    const f = FORMATS.find((x) => x.id === opts.format);
    for (const b of cards.children) {
      const on = b.dataset.id === opts.format;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
    }
    rowRange.classList.toggle('hidden', !f.anim);
    rowScale.classList.toggle('hidden', f.id === 'project');
    rowAlpha.classList.toggle('hidden', !f.alpha);
    rowLoop.classList.toggle('hidden', f.id !== 'gif');
    const [w, hh] = dims();
    const n = f.anim ? frameEntries().length : 1;
    const soundNote = hasSound(P()) ? (f.id === 'mp4' ? ' · with sound' : f.anim ? ' · no sound in this format' : '') : '';
    info.textContent = f.id === 'project' ? 'Saves everything — layers, rigs, drawings — so you can keep editing later or on another device.'
      : `${w} × ${hh} px` + (f.anim ? ` · ${n} frames · ${(n / opts.fps).toFixed(2)} s at ${opts.fps} fps` : '') + soundNote;
    if (full) result.classList.add('hidden');
  }

  const { close, dlg } = openDialog({
    title: 'Export',
    body,
    wide: true,
    actions: [
      { label: 'Close', run: (c) => { cancelled = true; c(); } },
      { label: 'Export', primary: true, run: () => run() },
    ],
    onClose: () => (cancelled = true),
  });
  const exportBtn = dlg.querySelector('.dlg-foot .btn.primary');
  sync();
  cards.querySelector('.fmt.on').focus();

  async function run() {
    if (busy) return;
    busy = true;
    cancelled = false;
    exportBtn.disabled = true;
    result.classList.add('hidden');
    progress.classList.remove('hidden');
    const setP = (t, text) => {
      progress.querySelector('.bar').style.width = `${Math.round(t * 100)}%`;
      progress.querySelector('.ptext').textContent = text;
    };
    try {
      setP(0, 'Rendering…');
      const out = await exportNow(setP, () => cancelled);
      if (!out) return;
      showResult(out);
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e.message || e}`, { kind: 'error', ms: 5000 });
    } finally {
      busy = false;
      exportBtn.disabled = false;
      progress.classList.add('hidden');
    }
  }

  function showResult({ blob, name }) {
    window.__lastExport = { blob, name };
    result.replaceChildren(
      h('div', { class: 'result-row' },
        icon('check', 18),
        h('span', {}, `${name} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => downloadBlob(blob, name) }, icon('download', 16), ' Download'),
        canShareFile(blob, name) ? h('button', { class: 'btn', type: 'button', onclick: () => shareFile(blob, name).catch((e) => toast(e.message, { kind: 'error' })) }, icon('share', 16), ' Share / Save to Photos') : null),
    );
    if (blob.type.startsWith('image/') || blob.type.startsWith('video/')) {
      const url = URL.createObjectURL(blob);
      result.append(blob.type.startsWith('video/') ? h('video', { src: url, controls: true, loop: true, autoplay: true, muted: true, playsinline: true, class: 'preview' }) : h('img', { src: url, class: 'preview', alt: 'Export preview' }));
    }
    result.classList.remove('hidden');
    result.querySelector('.btn.primary').focus();
  }
  return close;
}

function dims() {
  const p = P();
  let w = Math.max(2, Math.round(p.width * opts.scale)), hh = Math.max(2, Math.round(p.height * opts.scale));
  if (opts.format === 'mp4') {
    w -= w % 2;
    hh -= hh % 2;
  }
  return [w, hh];
}

function frameEntries() {
  const p = P();
  const a = Math.min(opts.from, opts.to) - 1, b = Math.max(opts.from, opts.to) - 1;
  return expand(p).filter((e) => e.k >= a && e.k <= b);
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const toBlob = (c, type = 'image/png') => new Promise((r) => c.toBlob(r, type));

async function exportNow(setP, isCancelled) {
  const p = P();
  const [w, hh] = dims();
  const name = safeName(p.name);
  const bg = opts.transparent && FORMATS.find((f) => f.id === opts.format).alpha ? null : p.bg;
  const canvas = document.createElement('canvas');
  const entries = frameEntries();
  const fps = opts.fps;

  switch (opts.format) {
    case 'project': {
      await saveProjectFile(p);
      toast('Project file saved');
      return null;
    }
    case 'png': {
      const e = currentEntry();
      renderToCanvas(p, e ? evalEntry(p, e) : evalKey(p, app.cur), w, hh, { bg, canvas });
      return { blob: await toBlob(canvas), name: `${name}_frame${app.cur + 1}.png` };
    }
    case 'gif': {
      const gif = new GifEncoder(w, hh, { loop: opts.loop ? 0 : -1 });
      let t = 0, prevCs = 0;
      for (let i = 0; i < entries.length; i++) {
        if (isCancelled()) return null;
        renderToCanvas(p, evalEntry(p, entries[i]), w, hh, { bg, canvas });
        const data = canvas.getContext('2d').getImageData(0, 0, w, hh).data;
        t += 100 / fps;
        const cs = Math.round(t);
        gif.addFrame(data, cs - prevCs, { transparent: !bg });
        prevCs = cs;
        setP((i + 1) / entries.length, `Encoding frame ${i + 1} / ${entries.length}`);
        await tick();
      }
      return { blob: new Blob([gif.finish()], { type: 'image/gif' }), name: `${name}.gif` };
    }
    case 'png-seq': {
      const files = [];
      const digits = String(entries.length).length;
      for (let i = 0; i < entries.length; i++) {
        if (isCancelled()) return null;
        renderToCanvas(p, evalEntry(p, entries[i]), w, hh, { bg, canvas });
        const b = await toBlob(canvas);
        files.push({ name: `${name}_${String(i + 1).padStart(Math.max(4, digits), '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
        setP((i + 1) / entries.length, `Frame ${i + 1} / ${entries.length}`);
      }
      return { blob: makeZip(files), name: `${name}_png.zip` };
    }
    case 'sheet': {
      const n = entries.length;
      let cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const k = Math.min(1, 16384 / (cols * w), 16384 / (rows * hh));
      const fw = Math.floor(w * k), fh = Math.floor(hh * k);
      const sheet = document.createElement('canvas');
      sheet.width = cols * fw;
      sheet.height = rows * fh;
      const sctx = sheet.getContext('2d');
      for (let i = 0; i < n; i++) {
        if (isCancelled()) return null;
        renderToCanvas(p, evalEntry(p, entries[i]), fw, fh, { bg, canvas });
        sctx.drawImage(canvas, (i % cols) * fw, Math.floor(i / cols) * fh);
        setP((i + 1) / n, `Frame ${i + 1} / ${n}`);
        if (i % 8 === 7) await tick();
      }
      return { blob: await toBlob(sheet), name: `${name}_sheet_${cols}x${rows}.png` };
    }
    case 'mp4':
      return typeof VideoEncoder === 'function' ? exportMp4(entries, w, hh, fps, name, setP, isCancelled) : exportRecorder(entries, w, hh, fps, name, setP, isCancelled);
  }
}

async function exportMp4(entries, w, hh, fps, name, setP, isCancelled) {
  const p = P();
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
  const bitrate = Math.round(Math.min(20e6, Math.max(2e6, w * hh * fps * 0.18)));
  let codec = null;
  for (const c of ['avc1.640034', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1.42001f']) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec: c, width: w, height: hh, bitrate, framerate: fps });
      if (s.supported) { codec = c; break; }
    } catch {}
  }
  if (!codec) return exportRecorder(entries, w, hh, fps, name, setP, isCancelled);
  // Very short clips look odd in players; hold the single frame for at least half a second.
  const list = entries.length === 1 ? Array(Math.max(1, Math.round(fps / 2))).fill(entries[0]) : entries;
  const audio = hasSound(p) ? await prepareAudio(p, (entries[0].i ?? 0) / fps, list.length / fps) : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: hh, frameRate: fps },
    audio: audio ? { codec: 'aac', numberOfChannels: 2, sampleRate: audio.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  enc.configure({ codec, width: w, height: hh, bitrate, framerate: fps, avc: { format: 'avc' } });
  const canvas = document.createElement('canvas');
  const dur = 1e6 / fps;
  for (let i = 0; i < list.length; i++) {
    if (isCancelled() || failure) break;
    renderToCanvas(p, evalEntry(p, list[i]), w, hh, { bg: p.bg, canvas });
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * dur), duration: Math.round(dur) });
    enc.encode(vf, { keyFrame: i % Math.max(1, fps * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    setP((i + 1) / list.length, `Encoding frame ${i + 1} / ${list.length}`);
    if (i % 4 === 3) await tick();
  }
  if (isCancelled()) { try { enc.close(); } catch {} return null; }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  if (audio) {
    setP(1, 'Adding sound…');
    await encodeAudio(audio, muxer);
  }
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), name: `${name}.mp4` };
}

// Mixes the project's sound for the exported span; null if this browser can't encode AAC.
async function prepareAudio(p, t0, duration) {
  if (typeof AudioEncoder !== 'function') {
    toast('This browser can’t add sound to MP4 — the video is exported silent', { kind: 'warn', ms: 4000 });
    return null;
  }
  const sampleRate = 48000;
  const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 160000 };
  try {
    if (!(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('AAC unsupported');
  } catch {
    toast('This browser can’t encode AAC sound — the video is exported silent', { kind: 'warn', ms: 4000 });
    return null;
  }
  const mix = await renderMix(p, t0, duration, sampleRate);
  return mix ? { mix, config, sampleRate } : null;
}

async function encodeAudio({ mix, config, sampleRate }, muxer) {
  let failure = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
  enc.configure(config);
  const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
  const N = 1024;
  for (let i = 0; i < mix.length; i += N) {
    const n = Math.min(N, mix.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sampleRate) * 1e6), data });
    enc.encode(ad);
    ad.close();
    if (enc.encodeQueueSize > 32) await new Promise((r) => setTimeout(r, 1));
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
}

// Fallback for browsers without WebCodecs: real-time capture with MediaRecorder.
async function exportRecorder(entries, w, hh, fps, name, setP, isCancelled) {
  const p = P();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hh;
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const type = types.find((t) => window.MediaRecorder?.isTypeSupported?.(t));
  if (!type) throw new Error('This browser cannot record video. Try GIF or PNG sequence.');
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  renderToCanvas(p, evalEntry(p, entries[0]), w, hh, { bg: p.bg, canvas });
  rec.start();
  const t0 = performance.now();
  for (let i = 0; i < entries.length; i++) {
    if (isCancelled()) break;
    renderToCanvas(p, evalEntry(p, entries[i]), w, hh, { bg: p.bg, canvas });
    setP((i + 1) / entries.length, `Recording frame ${i + 1} / ${entries.length} (real time)`);
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await done;
  if (isCancelled()) return null;
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: type.split(';')[0] }), name: `${name}.${ext}` };
}
