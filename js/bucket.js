// Bucket fill for vector drawings: the line art is rasterised, the tapped area is flood
// filled, and its outline (with any holes) is traced back into a filled stroke that sits
// underneath the lines. Small gaps in the lines can be closed by thickening them first.
import { P, curFrame } from './app.js';
import { getStrokes, getXf } from './model.js';
import { strokePaths } from './brush.js';
import { layerMatrix, drawFigure } from './render.js';
import { resolvePoses } from './join.js';
import { round2 } from './geom.js';

const MAX_SIDE = 2048;

// Draws every boundary (line strokes, and figures when sampling all layers) as solid ink.
function renderBoundary(p, targetLayer, sampleAll, gap, k) {
  const W = Math.ceil(p.width * k), H = Math.ceil(p.height * k);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = ctx.strokeStyle = '#000';
  ctx.lineJoin = ctx.lineCap = 'round';
  const f = curFrame();
  const world = sampleAll ? resolvePoses(p, f) : null;
  for (const layer of p.layers) {
    if (sampleAll ? !layer.visible : layer !== targetLayer) continue;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (layer.kind === 'draw') {
      const m = layerMatrix(layer, getXf(f, layer.id));
      ctx.transform(...m);
      const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      for (const s of getStrokes(layer, f)) {
        if (!(s.w > 0)) continue; // fills aren't boundaries, lines are
        const { line } = strokePaths(s);
        if (!line) continue;
        ctx.fill(line);
        if (gap > 0) {
          ctx.lineWidth = (gap * 2) / scale;
          ctx.stroke(line);
        }
      }
    } else if (layer.kind === 'figure' && world[layer.id]) {
      drawFigure(ctx, layer, world[layer.id]);
    }
  }
  return { ctx, W, H };
}

function dilate(mask, W, H, r) {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let last = -1e9;
    const row = y * W;
    for (let x = 0; x < W; x++) if (mask[row + x]) last = x; else if (x - last <= r) tmp[row + x] = 1;
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) if (mask[row + x]) { last = x; tmp[row + x] = 1; } else if (last - x <= r) tmp[row + x] = 1;
  }
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) if (tmp[y * W + x]) last = y; else if (y - last <= r) out[y * W + x] = 1;
    last = 1e9;
    for (let y = H - 1; y >= 0; y--) if (tmp[y * W + x]) { last = y; out[y * W + x] = 1; } else if (last - y <= r) out[y * W + x] = 1;
  }
  return out;
}

// Pixel-edge contours of a mask (clockwise around filled pixels), as integer-corner loops.
function traceLoops(mask, W, H) {
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  const W1 = W + 1;
  const next = new Map();
  const add = (x0, y0, x1, y1) => {
    const a = y0 * W1 + x0, b = y1 * W1 + x1;
    const list = next.get(a);
    if (list) list.push(b);
    else next.set(a, [b]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const [start] of next) {
    let list = next.get(start);
    while (list && list.length) {
      const loop = [];
      let v = start;
      for (let guard = 0; guard < 4e6; guard++) {
        const l = next.get(v);
        if (!l || !l.length) break;
        const nv = l.pop();
        loop.push(v % W1, Math.floor(v / W1));
        v = nv;
        if (v === start) break;
      }
      if (loop.length >= 8) loops.push(loop);
      list = next.get(start);
    }
  }
  return loops;
}

const area = (pts) => {
  let s = 0;
  for (let i = 0, n = pts.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return s / 2;
};

// Ramer–Douglas–Peucker on a closed loop of [x, y, ...].
function simplify(pts, eps) {
  const n = pts.length / 2;
  if (n < 4) return pts;
  const keep = new Uint8Array(n);
  const rec = (a, b) => {
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[(b % n) * 2], by = pts[(b % n) * 2 + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      rec(a, best);
      rec(best, b);
    }
  };
  // Split the loop at its two farthest-apart points.
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i * 2] - pts[0]) ** 2 + (pts[i * 2 + 1] - pts[1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  keep[0] = keep[far] = 1;
  rec(0, far);
  rec(far, n);
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

// Returns { outer, holes } in stage coordinates, or null if the tap is on a line.
export function traceFillRegion(x, y, { targetLayer, sampleAll = false, gap = 0 }) {
  const p = P();
  const k = Math.min(1, MAX_SIDE / Math.max(p.width, p.height));
  const { ctx, W, H } = renderBoundary(p, targetLayer, sampleAll, gap, k);
  const px = Math.floor(x * k), py = Math.floor(y * k);
  if (px < 0 || py < 0 || px >= W || py >= H) return null;
  const img = ctx.getImageData(0, 0, W, H).data;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = img[i * 4 + 3] > 96 ? 1 : 0;
  if (wall[py * W + px]) return null;

  // Flood fill (4-connected) from the tap.
  const region = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0, count = 0;
  stack[sp++] = py * W + px;
  region[py * W + px] = 1;
  while (sp) {
    const i = stack[--sp];
    count++;
    const x0 = i % W;
    if (x0 > 0 && !region[i - 1] && !wall[i - 1]) { region[i - 1] = 1; stack[sp++] = i - 1; }
    if (x0 < W - 1 && !region[i + 1] && !wall[i + 1]) { region[i + 1] = 1; stack[sp++] = i + 1; }
    if (i >= W && !region[i - W] && !wall[i - W]) { region[i - W] = 1; stack[sp++] = i - W; }
    if (i < W * (H - 1) && !region[i + W] && !wall[i + W]) { region[i + W] = 1; stack[sp++] = i + W; }
  }
  if (count < 4) return null;

  // Grow under the lines (and back over the closed gaps) so no paper shows at the edges.
  const grown = dilate(region, W, H, Math.round(gap * k) + 2);
  for (let i = 0; i < W * H; i++) if (grown[i] && !region[i] && !wall[i]) grown[i] = 0;

  const loops = traceLoops(grown, W, H).map((l) => simplify(l, 0.75)).filter((l) => l.length >= 6 && Math.abs(area(l)) > 4);
  if (!loops.length) return null;
  loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const toStage = (l) => l.map((v) => round2(v / k));
  return { outer: toStage(loops[0]), holes: loops.slice(1).map(toStage) };
}
