// Version history: snapshots, restore (keeping the current state), copies, pruning.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

const versions = () => app.run(async (m) => (await m.versions.listVersions()).map((v) => ({ label: v.label, auto: v.auto, frames: v.frames })));

test('Ctrl+Alt+S saves a named version', async () => {
  await app.page.focus('#stage-canvas');
  await app.key('s', ['Control', 'Alt']);
  await sleep(300);
  const v = await versions();
  assert.equal(v.length, 1);
  assert.deepEqual(v[0], { label: 'Saved version', auto: false, frames: 1 });
});

test('restoring brings the old state back and keeps the current one as a version', async () => {
  await app.run((m) => { for (let i = 0; i < 4; i++) m.A.newFrame(false); });
  assert.equal(await app.run((m) => m.app.project.frames.length), 5);
  await app.run(async (m) => { const [v] = await m.versions.listVersions(); await m.versions.restoreVersion(v); });
  const r = await app.run((m) => [m.app.project.frames.length]);
  assert.deepEqual(r, [1]);
  const v = await versions();
  assert.equal(v.length, 2);
  assert.deepEqual(v[0], { label: 'Before restoring', auto: true, frames: 5 });
});

test('the history dialog lists versions and can open a copy', async () => {
  const id0 = await app.run((m) => m.app.project.id);
  await app.key('h', ['Control', 'Alt']);
  await app.page.waitForSelector('.ver');
  assert.equal((await app.page.$$('.ver')).length, 2);
  await app.shot('versions-dialog');
  // Second button on the newest version is “Open copy”.
  await app.page.evaluate(() => document.querySelector('.ver').querySelectorAll('.btn')[1].click());
  await sleep(400);
  const r = await app.run((m) => [m.app.project.id, m.app.project.frames.length, m.app.project.name]);
  assert.notEqual(r[0], id0);
  assert.equal(r[1], 5);
  assert.match(r[2], /\(/);
});

test('automatic snapshots are capped at 30 per animation', async () => {
  const n = await app.run(async (m) => {
    for (let i = 0; i < 34; i++) await m.versions.snapshot('', true);
    return (await m.versions.listVersions()).filter((v) => v.auto).length;
  });
  assert.equal(n, 30);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
