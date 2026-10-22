// Sound: import, waveform lane, playback, MP4 audio track, undo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openApp, exportVia, sleep, OUT } from './helpers.mjs';

let app;
const wav = path.join(OUT, 'tone.wav');

// One second 440 Hz mono 16-bit WAV.
function writeTone() {
  const sr = 22050, n = sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 440) * 12000), 44 + i * 2);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(wav, buf);
}

before(async () => {
  writeTone();
  app = await openApp();
});
after(() => app?.close());

test('import a sound from the timeline Sound button', async () => {
  await app.run((m) => { for (let i = 0; i < 12; i++) m.A.newFrame(false); m.goto(0); });
  await app.page.click('#timeline .ibtn[aria-label^="Sound"]');
  await app.page.waitForSelector('.sound-pop .btn.primary');
  const [chooser] = await Promise.all([app.page.waitForFileChooser(), app.page.click('.sound-pop .btn.primary')]);
  await chooser.accept([wav]);
  await app.page.waitForFunction(async () => (await import('/js/app.js')).app.project.sounds?.length === 1);
  const s = await app.run((m) => { const s = m.app.project.sounds[0]; return { name: s.name, start: s.start, dur: s.dur }; });
  assert.equal(s.name, 'tone');
  assert.equal(s.start, 0);
  assert.ok(Math.abs(s.dur - 1) < 0.01, `duration ${s.dur}`);
});

test('the waveform lane appears on the timeline', async () => {
  await app.page.keyboard.press('Escape');
  await sleep(200);
  const visible = await app.page.$eval('.tl-lane', (el) => !el.classList.contains('hidden') && el.offsetHeight > 0);
  assert.equal(visible, true);
  await app.shot('sound-lane');
});

test('playback runs with sound', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('Space');
  await sleep(500);
  const r = await app.run((m) => [m.app.playing, m.app.playEntry]);
  await app.key('Space');
  assert.equal(r[0], true);
  assert.ok(r[1] > 0, 'playhead moved');
});

test('MP4 export carries an AAC audio track', async () => {
  const out = await exportVia(app, 'mp4');
  assert.ok(out.name?.includes('.mp4'));
  const hasAudio = await app.page.evaluate(async () => {
    const bytes = new Uint8Array(await window.__lastExport.blob.arrayBuffer());
    const txt = new TextDecoder('latin1').decode(bytes);
    return txt.includes('mp4a') && txt.includes('soun');
  });
  assert.equal(hasAudio, true);
});

test('sounds are saved with the project and undo removes them', async () => {
  const saved = await app.run(async (m) => {
    const { projectBlob } = await import('/js/fileio.js');
    return JSON.parse(await projectBlob(m.app.project).text()).sounds.length;
  });
  assert.equal(saved, 1);
  // Undo back past the import.
  const r = await app.run((m) => { while (m.app.project.sounds.length && m.undo()); return m.app.project.sounds.length; });
  assert.equal(r, 0);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
