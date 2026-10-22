// Figure joining: a sword attached to a stickman's hand follows it on every frame.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp, dist } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

// World position of a joint of the layer named `name` on frame k.
const at = (name, joint, k) => app.run((m, name, joint, k) => {
  const { resolvePoses } = m.join;
  const p = m.app.project, l = p.layers.find((x) => x.name === name);
  const pose = resolvePoses(p, p.frames[k])[l.id];
  if (!pose) return null;
  const w = m.rig.computeWorld(l.rig, pose).get(joint);
  return [w.x, w.y];
}, name, joint, k);

test('attach a sword to the stickman’s hand by tapping the hand', async () => {
  await app.run((m) => { m.A.insertPreset('sword'); });
  assert.equal(await app.run((m) => m.app.sel.type), 'figure');
  await app.page.focus('#stage-canvas');
  await app.key('j');
  const hand = await at('Stickman', 'armL2', 0);
  const [hx, hy] = await app.toPage(...hand);
  await app.page.mouse.click(hx, hy);
  const join = await app.run((m) => m.app.project.layers.find((l) => l.name === 'Sword').join);
  assert.equal(join?.node, 'armL2');
  await app.shot('joining-attached');
});

test('attaching keeps the sword where it was on screen', async () => {
  const r = await app.run((m) => {
    const p = m.app.project, l = p.layers.find((x) => x.name === 'Sword');
    const w = m.join.resolvePoses(p, p.frames[0])[l.id];
    return [w.x, w.y];
  });
  const expected = await app.run((m) => [m.app.project.width / 2, m.app.project.height / 2]);
  assert.ok(Math.abs(r[0] - expected[0]) < 200 && Math.abs(r[1] - expected[1]) < 200, 'still near where it was inserted');
});

test('posing the arm carries the sword along', async () => {
  const swordBefore = await at('Sword', 'root', 0);
  const handBefore = await at('Stickman', 'armL2', 0);
  const elbow = await at('Stickman', 'armL1', 0);
  await app.run((m) => { const l = m.app.project.layers.find((x) => x.name === 'Stickman'); m.select({ type: 'figure', id: l.id, node: null }); });
  // Drag the stickman's hand (the stickman is selected, so its nodes win).
  await app.dragStage([handBefore, [handBefore[0] - 40, handBefore[1] - 70]]);
  const handAfter = await at('Stickman', 'armL2', 0);
  const swordAfter = await at('Sword', 'root', 0);
  assert.ok(dist(handBefore, handAfter) > 20, 'hand moved');
  // The sword's root keeps its distance to the hand (it's rigidly attached).
  assert.ok(Math.abs(dist(swordAfter, handAfter) - dist(swordBefore, handBefore)) < 0.5);
  assert.ok(dist(swordBefore, swordAfter) > 20, 'sword moved with the hand');
  assert.ok(elbow);
});

test('new frames keep the join; deleting the parent detaches in place', async () => {
  await app.key('n');
  const s1 = await at('Sword', 'blade', 1);
  assert.ok(s1, 'sword visible on frame 2');
  const before = await app.run((m) => {
    const p = m.app.project, l = p.layers.find((x) => x.name === 'Sword');
    return p.frames.map((f) => { const w = m.join.resolvePoses(p, f)[l.id]; return [w.x, w.y]; });
  });
  const after = await app.run((m) => {
    const p = m.app.project;
    m.A.deleteLayer(p.layers.find((x) => x.name === 'Stickman').id);
    const l = p.layers.find((x) => x.name === 'Sword');
    return { join: !!l.join, pos: p.frames.map((f) => [f.poses[l.id].x, f.poses[l.id].y]) };
  });
  assert.equal(after.join, false);
  after.pos.forEach((q, i) => assert.ok(dist(q, before[i]) < 0.01, `frame ${i + 1} kept its place`));
  await app.run((m) => m.undo());
  assert.equal(await app.run((m) => !!m.app.project.layers.find((x) => x.name === 'Sword').join), true, 'undo restores the join');
});

test('a figure can’t be attached to something attached to it', async () => {
  const r = await app.run((m) => {
    const p = m.app.project;
    const sword = p.layers.find((x) => x.name === 'Sword'), man = p.layers.find((x) => x.name === 'Stickman');
    return m.join.wouldCycle(p, man.id, sword.id);
  });
  assert.equal(r, true);
});

test('detach keeps the sword where it is', async () => {
  const before = await at('Sword', 'root', 0);
  await app.run((m) => { m.goto(0); const l = m.app.project.layers.find((x) => x.name === 'Sword'); m.select({ type: 'figure', id: l.id, node: null }); m.A.detachSelected(); });
  const after = await at('Sword', 'root', 0);
  assert.equal(await app.run((m) => !!m.app.project.layers.find((x) => x.name === 'Sword').join), false);
  assert.ok(dist(before, after) < 0.01);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
