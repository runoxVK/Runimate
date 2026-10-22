// Per-frame colour / opacity, and reusable motions from the library.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, sleep } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

test('joint colour and opacity can change per frame and blend in a 50% frame', async () => {
  const r = await app.run((m) => {
    const p = m.app.project, l = p.layers[0];
    m.A.newFrame(false);
    p.frames[1].poses[l.id].c = { armL2: '#ff0000' };
    p.frames[1].poses[l.id].o = { head: 0 };
    p.frames[1].poses[l.id].op = 0.5;
    m.goto(0);
    m.A.addMidFrame();
    const mid = p.frames[1].poses[l.id];
    const out = { c: mid.c.armL2, o: mid.o.head, op: mid.op, f0: p.frames[0].poses[l.id].c };
    m.undo(); // back to two frames for the next tests
    return out;
  });
  assert.equal(r.c, '#911111', 'halfway between #222222 and #ff0000');
  assert.equal(r.o, 0.5);
  assert.equal(r.op, 0.75);
  assert.equal(r.f0, undefined, 'other frames keep the normal colour');
});

test('“This frame” colour scope writes a frame override, not the rig colour', async () => {
  const r = await app.run(async (m) => {
    const p = m.app.project, l = p.layers[0];
    m.goto(0);
    m.select({ type: 'figure', id: l.id, node: 'armR2' });
    m.app.colorScope = 'frame';
    m.app.panelTab = 'props';
    m.changed('panel');
    await new Promise((res) => setTimeout(res, 20));
    const input = document.querySelector('[data-k="ncol"]');
    input.value = '#00ff00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    m.app.colorScope = 'all';
    return { frame: p.frames[0].poses[l.id].c?.armR2, rig: l.rig.nodes.find((n) => n.id === 'armR2').color };
  });
  assert.equal(r.frame, '#00ff00');
  assert.equal(r.rig, '#000000');
});

test('save a motion and apply it to another stickman with repeats', async () => {
  // Make a two-keyframe "step": the leg swings and the figure moves right.
  await app.run((m) => {
    const p = m.app.project, l = p.layers[0];
    p.frames[1].poses[l.id].a.legL1 = -1.2;
    p.frames[1].poses[l.id].x += 60;
    m.select({ type: 'figure', id: l.id, node: null });
    m.changed('content');
  });
  await app.run((m) => { m.lib.saveMotion(); });
  await app.page.waitForSelector('dialog[open] input');
  await app.page.keyboard.type('step');
  await app.page.keyboard.press('Enter');
  await sleep(400);
  const assets = await app.run((m) => m.lib.assets.map((a) => `${a.kind}:${a.name}:${a.data.frames?.length}`));
  assert.deepEqual(assets, ['motion:step:2']);

  // New stickman, apply from frame 1, repeat twice.
  const target = await app.run((m) => { m.goto(0); const l = m.A.insertPreset('stickman'); return m.app.sel.id; });
  await app.run((m) => { m.lib.insertAsset(m.lib.assets[0]); });
  await app.page.waitForSelector('dialog[open] input');
  await app.page.evaluate(() => {
    const inputs = document.querySelectorAll('dialog[open] input');
    inputs[1].value = '2';
  });
  await app.page.click('dialog[open] .dlg-foot .btn.primary');
  await sleep(200);
  const r = await app.run((m, id) => {
    const p = m.app.project;
    return { frames: p.frames.length, poses: p.frames.map((f) => f.poses[id] && [Math.round(f.poses[id].x), +(f.poses[id].a.legL1 ?? 0).toFixed(2)]) };
  }, target);
  assert.equal(r.frames, 4, 'frames were added for the repeat');
  const x0 = r.poses[0][0];
  assert.deepEqual(r.poses.map((q) => q[0] - x0), [0, 60, 120, 180], 'repeats keep walking forward');
  assert.equal(r.poses[1][1], -1.2);
  await app.run((m) => { m.app.panelTab = 'library'; m.changed('panel'); });
  await sleep(200);
  await app.shot('motion-library');
});

test('no console errors', () => assert.deepEqual(app.errors, []));
