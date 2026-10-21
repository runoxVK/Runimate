// Animated GIF encoder: per-frame median-cut palettes + LZW.

function quantize(rgba, maxColors) {
  const hist = new Uint32Array(32768), rs = new Uint32Array(32768), gs = new Uint32Array(32768), bs = new Uint32Array(32768);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    hist[k]++;
    rs[k] += r;
    gs[k] += g;
    bs[k] += b;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
  const avg = (k) => [Math.round(rs[k] / hist[k]), Math.round(gs[k] / hist[k]), Math.round(bs[k] / hist[k])];
  let palette;
  if (bins.length <= maxColors) {
    palette = bins.map(avg);
  } else {
    const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
    const boxes = [bins];
    while (boxes.length < maxColors) {
      let bi = -1, best = -1, bc = 0;
      boxes.forEach((box, i) => {
        if (box.length < 2) return;
        let count = 0;
        const lo = [31, 31, 31], hi = [0, 0, 0];
        for (const k of box) {
          count += hist[k];
          for (let c = 0; c < 3; c++) {
            const v = ch(k, c);
            if (v < lo[c]) lo[c] = v;
            if (v > hi[c]) hi[c] = v;
          }
        }
        for (let c = 0; c < 3; c++) {
          const score = (hi[c] - lo[c]) * Math.sqrt(count);
          if (score > best) { best = score; bi = i; bc = c; }
        }
      });
      if (bi < 0 || best <= 0) break;
      const box = boxes[bi].sort((a, b) => ch(a, bc) - ch(b, bc));
      let total = 0;
      for (const k of box) total += hist[k];
      let acc = 0, cut = 1;
      for (let i = 0; i < box.length - 1; i++) {
        acc += hist[box[i]];
        if (acc >= total / 2) { cut = i + 1; break; }
      }
      boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
    }
    palette = boxes.map((box) => {
      let n = 0, r = 0, g = 0, b = 0;
      for (const k of box) { n += hist[k]; r += rs[k]; g += gs[k]; b += bs[k]; }
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
  }
  const lut = new Int16Array(32768).fill(-1);
  for (const k of bins) {
    const [r, g, b] = avg(k);
    let bi = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    lut[k] = bi;
  }
  return { palette, lut };
}

class ByteWriter {
  constructor() { this.chunks = []; this.buf = new Uint8Array(1 << 16); this.n = 0; }
  byte(b) {
    if (this.n === this.buf.length) { this.chunks.push(this.buf); this.buf = new Uint8Array(1 << 16); this.n = 0; }
    this.buf[this.n++] = b;
  }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  bytes(arr) { for (let i = 0; i < arr.length; i++) this.byte(arr[i]); }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() {
    const parts = [...this.chunks, this.buf.subarray(0, this.n)];
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

const table = new Int32Array(1 << 20);
let gen = 0;

function lzw(w, idx, minSize) {
  const clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, next = eoi + 1;
  let acc = 0, bits = 0;
  const block = new Uint8Array(255);
  let bn = 0;
  const flushByte = (b) => {
    block[bn++] = b;
    if (bn === 255) { w.byte(255); w.bytes(block); bn = 0; }
  };
  const emit = (code) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) { flushByte(acc & 255); acc >>>= 8; bits -= 8; }
  };
  const reset = () => { gen++; if (gen > 0x7ffff) { table.fill(0); gen = 1; } };
  w.byte(minSize);
  reset();
  emit(clear);
  let cur = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = (cur << 8) | k;
    const v = table[key];
    if (v >>> 12 === gen) { cur = v & 4095; continue; }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      size = minSize + 1;
      reset();
    } else {
      if (next >= 1 << size) size++;
      table[key] = (gen << 12) | next++;
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits > 0) flushByte(acc & 255);
  if (bn) { w.byte(bn); w.bytes(block.subarray(0, bn)); }
  w.byte(0);
}

export class GifEncoder {
  constructor(width, height, { loop = 0 } = {}) {
    this.w = width;
    this.h = height;
    const o = (this.out = new ByteWriter());
    o.str('GIF89a');
    o.u16(width);
    o.u16(height);
    o.byte(0);
    o.byte(0);
    o.byte(0);
    if (loop >= 0) {
      o.bytes([0x21, 0xff, 0x0b]);
      o.str('NETSCAPE2.0');
      o.bytes([3, 1]);
      o.u16(loop);
      o.byte(0);
    }
  }

  // rgba: Uint8ClampedArray, delay in 1/100 s
  addFrame(rgba, delay, { transparent = false } = {}) {
    const o = this.out;
    const { palette, lut } = quantize(rgba, transparent ? 255 : 256);
    const off = transparent ? 1 : 0;
    const count = palette.length + off;
    let bitsN = 1;
    while (1 << bitsN < count) bitsN++;
    const n = this.w * this.h;
    const idx = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (rgba[j + 3] < 128) idx[i] = 0;
      else idx[i] = lut[((rgba[j] >> 3) << 10) | ((rgba[j + 1] >> 3) << 5) | (rgba[j + 2] >> 3)] + off;
    }
    o.bytes([0x21, 0xf9, 4, ((transparent ? 2 : 1) << 2) | (transparent ? 1 : 0)]);
    o.u16(Math.max(2, Math.round(delay)));
    o.byte(0);
    o.byte(0);
    o.byte(0x2c);
    o.u16(0);
    o.u16(0);
    o.u16(this.w);
    o.u16(this.h);
    o.byte(0x80 | (bitsN - 1));
    const tableSize = 1 << bitsN;
    for (let i = 0; i < tableSize; i++) {
      const c = palette[i - off] || [0, 0, 0];
      o.bytes(c);
    }
    lzw(o, idx, Math.max(2, bitsN));
  }

  finish() {
    this.out.byte(0x3b);
    return this.out.result();
  }
}
