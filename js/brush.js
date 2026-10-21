// Vector stroke geometry: variable-width strokes, erasing, hit testing, transforms.
// Strokes are immutable; every edit produces new stroke objects.
import { TAU, apply, segDist, pointInPoly, emptyBox, boxAdd, round2 } from './geom.js';

const pathCache = new WeakMap();
const boxCache = new WeakMap();

const rad = (s, i) => Math.max(0.05, (s.w * s.pts[i * 3 + 2]) / 2);

// Union of round dabs and joining quads, filled once with nonzero so
// translucent strokes never double up where they overlap themselves.
function buildPaths(s) {
  const p = s.pts, n = p.length / 3;
  let line = null, fill = null;
  if (s.fill && n >= 3) {
    fill = new Path2D();
    fill.moveTo(p[0], p[1]);
    for (let i = 1; i < n; i++) fill.lineTo(p[i * 3], p[i * 3 + 1]);
    fill.closePath();
  }
  if (s.w > 0 && n >= 1) {
    line = new Path2D();
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], r = rad(s, i);
      line.moveTo(x + r, y);
      line.arc(x, y, r, 0, TAU);
    }
    const seg = (i, j) => {
      const x0 = p[i * 3], y0 = p[i * 3 + 1], x1 = p[j * 3], y1 = p[j * 3 + 1];
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
      if (L < 1e-6) return;
      const nx = -dy / L, ny = dx / L, r0 = rad(s, i), r1 = rad(s, j);
      // Wound to match arc() so the nonzero union has no holes.
      line.moveTo(x0 + nx * r0, y0 + ny * r0);
      line.lineTo(x0 - nx * r0, y0 - ny * r0);
      line.lineTo(x1 - nx * r1, y1 - ny * r1);
      line.lineTo(x1 + nx * r1, y1 + ny * r1);
      line.closePath();
    };
    for (let i = 0; i < n - 1; i++) seg(i, i + 1);
    if (s.closed && n > 2) seg(n - 1, 0);
  }
  return { line, fill };
}

export function strokePaths(s) {
  let c = pathCache.get(s);
  if (!c) pathCache.set(s, (c = buildPaths(s)));
  return c;
}

export function drawStroke(ctx, s, live = false) {
  const { line, fill } = live ? buildPaths(s) : strokePaths(s);
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * (s.o ?? 1);
  if (fill) {
    ctx.fillStyle = s.fill;
    ctx.fill(fill);
  }
  if (line) {
    ctx.fillStyle = s.c;
    ctx.fill(line);
  }
  ctx.globalAlpha = a;
}

export function drawStrokes(ctx, strokes) {
  for (const s of strokes) drawStroke(ctx, s);
}

export function strokeBox(s) {
  let b = boxCache.get(s);
  if (b) return b;
  b = emptyBox();
  const p = s.pts;
  for (let i = 0; i < p.length; i += 3) boxAdd(b, p[i], p[i + 1], s.w > 0 ? (s.w * p[i + 2]) / 2 : 0);
  boxCache.set(s, b);
  return b;
}

export function strokesBox(strokes) {
  const b = emptyBox();
  for (const s of strokes) {
    const sb = strokeBox(s);
    boxAdd(b, sb.x0, sb.y0);
    boxAdd(b, sb.x1, sb.y1);
  }
  return b;
}

// inside=true also counts the interior of closed outlines (used for picking, not erasing).
export function hitStroke(s, x, y, tol = 0, inside = false) {
  const b = strokeBox(s);
  if (x < b.x0 - tol || x > b.x1 + tol || y < b.y0 - tol || y > b.y1 + tol) return false;
  const p = s.pts, n = p.length / 3;
  if ((s.fill || (inside && s.closed)) && n >= 3 && pointInPoly(x, y, p, 3)) return true;
  if (n === 1) return Math.hypot(x - p[0], y - p[1]) <= tol + rad(s, 0);
  const last = s.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const r = s.w > 0 ? Math.max(rad(s, i), rad(s, j)) : 1;
    if (segDist(x, y, p[i * 3], p[i * 3 + 1], p[j * 3], p[j * 3 + 1]) <= tol + r) return true;
  }
  return false;
}

export function densify(pts, spacing, closed = false) {
  const out = [];
  const n = pts.length / 3;
  const count = closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const x = pts[i * 3], y = pts[i * 3 + 1], pr = pts[i * 3 + 2];
    if (k > 0) {
      const px = out[out.length - 3], py = out[out.length - 2], pp = out[out.length - 1];
      const L = Math.hypot(x - px, y - py);
      const steps = Math.floor(L / spacing);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push(px + (x - px) * t, py + (y - py) * t, pp + (pr - pp) * t);
      }
    }
    out.push(x, y, pr);
  }
  return out;
}

// Cuts strokes where the eraser circle touches them. Filled shapes are removed whole.
export function eraseCut(strokes, ex, ey, er) {
  let changed = false;
  const out = [];
  for (const s of strokes) {
    if (!hitStroke(s, ex, ey, er)) {
      out.push(s);
      continue;
    }
    changed = true;
    const n = s.pts.length / 3;
    if (s.fill || n <= 1) continue;
    const pts = densify(s.pts, Math.max(0.75, er * 0.3), s.closed);
    const m = pts.length / 3;
    const runs = [];
    let run = null;
    for (let i = 0; i < m; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1];
      const keep = Math.hypot(x - ex, y - ey) > er + (s.w * pts[i * 3 + 2]) * 0.25;
      if (keep) {
        if (!run) runs.push((run = []));
        run.push(x, y, pts[i * 3 + 2]);
      } else run = null;
    }
    // A closed loop cut once becomes one open stroke: join the wrap-around pieces.
    if (s.closed && runs.length > 1) {
      const first = runs[0], last = runs[runs.length - 1];
      const keptStart = Math.hypot(pts[0] - ex, pts[1] - ey) > er;
      if (keptStart && last.length && first.length) {
        runs[0] = last.concat(first.slice(3));
        runs.pop();
      }
    }
    for (const r of runs) if (r.length >= 6) out.push({ ...s, pts: r, closed: false });
  }
  return changed ? out : strokes;
}

export function eraseWhole(strokes, ex, ey, er) {
  const out = strokes.filter((s) => !hitStroke(s, ex, ey, er));
  return out.length === strokes.length ? strokes : out;
}

export function transformStroke(s, m) {
  const p = s.pts, out = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const q = apply(m, p[i], p[i + 1]);
    out[i] = round2(q[0]);
    out[i + 1] = round2(q[1]);
    out[i + 2] = p[i + 2];
  }
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  return { ...s, pts: out, w: round2(s.w * k) };
}

// Applies end tapering and rounds coordinates once a freehand stroke ends.
export function finishFreehand(pts, { taper = true, width = 6 } = {}) {
  const n = pts.length / 3;
  const out = pts.slice();
  if (taper && n >= 3) {
    const cum = [0];
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(out[i * 3] - out[i * 3 - 3], out[i * 3 + 1] - out[i * 3 - 2]);
    const total = cum[n - 1];
    const T = Math.min(total * 0.3, Math.max(10, width * 4));
    if (T > 0)
      for (let i = 0; i < n; i++) {
        const f = Math.min(1, cum[i] / T, (total - cum[i]) / T);
        out[i * 3 + 2] *= 0.2 + 0.8 * Math.sqrt(Math.max(0, f));
      }
  }
  for (let i = 0; i < out.length; i += 3) {
    out[i] = round2(out[i]);
    out[i + 1] = round2(out[i + 1]);
    out[i + 2] = Math.round(out[i + 2] * 1000) / 1000;
  }
  return out;
}

export function shapePoints(kind, x0, y0, x1, y1) {
  if (kind === 'line') return [x0, y0, 1, x1, y1, 1];
  if (kind === 'rect')
    return [x0, y0, 1, x1, y0, 1, x1, y1, 1, x0, y1, 1];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const seg = Math.max(24, Math.min(96, Math.round((rx + ry) / 3)));
  const out = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * TAU;
    out.push(round2(cx + Math.cos(t) * rx), round2(cy + Math.sin(t) * ry), 1);
  }
  return out;
}
