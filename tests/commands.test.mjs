// Runs every editing command in each selection state and checks the panels render,
// so a crash anywhere in the menus / shortcuts shows up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openApp } from './helpers.mjs';

let app;
before(async () => (app = await openApp()));
after(() => app?.close());

test('every command runs in every selection state', async () => {
  const errors = await app.run(async (m) => {
    const skipGroups = new Set(['File']);
    const skip = new Set(['palette', 'help', 'save-asset', 'projects', 'import-image', 'sound-import']);
    const errors = [];
    const fig = () => m.app.project.layers.find((l) => l.kind === 'figure');
    const draw = () => m.app.project.layers.find((l) => l.kind === 'draw');
    const setups = {
      none: () => m.select(null),
      figure: () => { const l = fig(); if (l && m.curFrame().poses[l.id]) m.select({ type: 'figure', id: l.id, node: 'armR2' }); },
      strokes: () => {
        const l = draw(), f = m.curFrame();
        f.draws[l.id] = [{ pts: [10, 10, 1, 100, 100, 1, 200, 50, 1], w: 5, c: '#000', o: 1, fill: null, closed: false }];
        m.select({ type: 'strokes', id: l.id, strokes: f.draws[l.id].slice() });
      },
      layer: () => m.select({ type: 'layer', id: draw().id }),
    };
    for (const [name, setup] of Object.entries(setups)) {
      for (const c of m.cmds.commands) {
        if (skipGroups.has(c.group) || skip.has(c.id)) continue;
        try {
          setup();
          await c.run();
          await new Promise((r) => setTimeout(r, 0));
        } catch (e) {
          errors.push(`${name}/${c.id}: ${e.message}`);
        }
        document.querySelectorAll('dialog[open]').forEach((d) => d.close());
        if (m.app.playing) m.player.stop();
        if (!fig()) m.A.insertPreset('stickman');
        if (!draw()) m.A.addLayer('frame');
      }
    }
    for (const tab of ['props', 'layers', 'library']) for (const tool of ['select', 'brush', 'camera']) for (const [name, setup] of Object.entries(setups)) {
      try {
        m.app.panelTab = tab;
        m.A.setTool(tool);
        setup();
        m.changed('panel');
        await new Promise((r) => setTimeout(r, 5));
      } catch (e) {
        errors.push(`panel ${tab}/${tool}/${name}: ${e.message}`);
      }
    }
    return errors;
  });
  assert.deepEqual(errors, []);
});

test('undo / redo survive the whole run', async () => {
  const r = await app.run((m) => {
    let u = 0, r = 0;
    while (m.undo()) u++;
    while (m.redo()) r++;
    return [u, r];
  });
  assert.ok(r[0] > 20);
  assert.equal(r[0], r[1]);
});

test('no console errors', () => assert.deepEqual(app.errors, []));
