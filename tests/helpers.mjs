// Shared setup for the browser tests: starts serve.py on a free port, launches a
// headless Chrome / Edge with a fresh profile and offers small helpers for driving the app.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'tests', 'output');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findBrowser() {
  const found = BROWSERS.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium-based browser.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const child = spawn(py, [path.join(ROOT, 'serve.py'), String(port)], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { child, url };
    } catch {}
    await sleep(100);
  }
  child.kill();
  throw new Error(`serve.py did not start (tried "${py}"; set PYTHON to override)`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens the app on a fresh profile. Call `close()` when done.
export async function openApp({ width = 1366, height = 900, touch = false } = {}) {
  const server = await startServer();
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--no-first-run'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1, hasTouch: touch });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  await sleep(300);

  const app = {
    page, browser, errors,
    // Runs `fn(mods)` in the page with the app's modules loaded: { app, A, T, stage, player, ... }.
    run: (fn, ...args) => page.evaluate(async (src, args) => {
      const mods = {
        ...(await import('/js/app.js')),
        A: await import('/js/actions.js'),
        T: await import('/js/tween.js'),
        rig: await import('/js/rig.js'),
        stage: await import('/js/stage.js'),
        player: await import('/js/player.js'),
        cmds: await import('/js/commands.js'),
        lib: await import('/js/library.js'),
        exp: await import('/js/export.js'),
        join: await import('/js/join.js'),
        motion: await import('/js/motion.js'),
        audio: await import('/js/audio.js'),
        folder: await import('/js/folder.js'),
        projects: await import('/js/projects.js'),
        versions: await import('/js/versions.js'),
      };
      // eslint-disable-next-line no-new-func
      return new Function('m', 'args', `return (${src})(m, ...args);`)(mods, args);
    }, fn.toString(), args),
    // Stage coordinates -> page pixels.
    toPage: (x, y) => page.evaluate(async (x, y) => {
      const m = await import('/js/stage.js');
      const r = document.getElementById('stage-canvas').getBoundingClientRect();
      const [sx, sy] = m.toScreen(x, y);
      return [r.left + sx, r.top + sy];
    }, x, y),
    async drag(points, steps = 8) {
      await page.mouse.move(...points[0]);
      await page.mouse.down();
      for (const p of points.slice(1)) await page.mouse.move(p[0], p[1], { steps });
      await page.mouse.up();
    },
    // Drag through stage-coordinate points.
    async dragStage(points, steps = 8) {
      const pts = [];
      for (const p of points) pts.push(await app.toPage(...p));
      await app.drag(pts, steps);
    },
    async key(k, mods = []) {
      for (const m of mods) await page.keyboard.down(m);
      await page.keyboard.press(k);
      for (const m of [...mods].reverse()) await page.keyboard.up(m);
    },
    // World positions of the first figure's joints on the current frame.
    joints: () => app.run((m) => {
      const p = m.app.project, l = p.layers.find((x) => x.kind === 'figure');
      return Object.fromEntries([...m.rig.computeWorld(l.rig, p.frames[m.app.cur].poses[l.id])].map(([k, v]) => [k, [v.x, v.y]]));
    }),
    // Strokes on the first drawing layer of the current frame, as [x, y, x, y, ...].
    strokes: () => app.run((m) => {
      const l = m.app.project.layers.find((x) => x.kind === 'draw');
      return (m.curFrame().draws[l.id] || []).map((s) => s.pts.filter((_, i) => i % 3 !== 2));
    }),
    async shot(name) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    },
    async close() {
      await browser.close().catch(() => {});
      server.child.kill();
    },
  };
  return app;
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Runs an export format through the real dialog and returns { name, mb, preview } where
// preview is the decoded image size or video [width, height, duration].
export function exportVia(app, format) {
  return app.page.evaluate(async (format) => {
    const E = await import('/js/export.js');
    const close = E.openExport(format);
    const dlg = document.querySelector('dialog[open]');
    dlg.querySelector('.dlg-foot .btn.primary').click();
    for (let i = 0; i < 300 && !dlg.querySelector('.result:not(.hidden)'); i++) await new Promise((r) => setTimeout(r, 100));
    const name = dlg.querySelector('.result-row span')?.textContent || null;
    const media = dlg.querySelector('.preview');
    let preview = null;
    if (media?.tagName === 'IMG') {
      await media.decode().catch(() => {});
      preview = [media.naturalWidth, media.naturalHeight];
    } else if (media?.tagName === 'VIDEO') {
      await new Promise((r) => (media.readyState >= 1 ? r() : ((media.onloadedmetadata = r), setTimeout(r, 4000))));
      preview = [media.videoWidth, media.videoHeight, media.duration];
    }
    close();
    return { name, preview };
  }, format);
}
