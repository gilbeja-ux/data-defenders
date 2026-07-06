#!/usr/bin/env node
// Generates the PWA / app icons (no dependencies — hand-rolled PNG encoder).
// Motif: the node holder ring inside the data tunnel — cyan ring, blue + white
// node carriages, golden payload core on deep navy.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function render(S) {
  const px = Buffer.alloc(S * S * 4);
  const C = S / 2;
  const ringR = S * 0.34, ringW = S * 0.05;
  const nodeR = S * 0.075;
  const nL = { x: C - ringR, y: C };          // blue node (left)
  const nR = { x: C + ringR, y: C };          // white node (right)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - C, dy = y - C;
      const d = Math.hypot(dx, dy);
      // deep navy base with a subtle radial lift toward the center
      let r = 3, g = 8, b = 20;
      const lift = 1 - smooth(0, S * 0.7, d);
      r += 6 * lift; g += 14 * lift; b += 30 * lift;
      // golden payload glow at the core
      const core = 1 - smooth(0, S * 0.16, d);
      r += 250 * core; g += 190 * core; b += 60 * core;
      // cyan holder ring with soft glow
      const ring = 1 - smooth(0, ringW, Math.abs(d - ringR));
      const glow = (1 - smooth(0, ringW * 3.2, Math.abs(d - ringR))) * 0.35;
      r += 40 * ring + 20 * glow; g += 190 * ring + 90 * glow; b += 255 * ring + 130 * glow;
      // node carriages
      const dl = Math.hypot(x - nL.x, y - nL.y);
      const dr = Math.hypot(x - nR.x, y - nR.y);
      const nl = 1 - smooth(nodeR * 0.75, nodeR, dl);
      const nr = 1 - smooth(nodeR * 0.75, nodeR, dr);
      r = r * (1 - nl) + 60 * nl;  g = g * (1 - nl) + 150 * nl;  b = b * (1 - nl) + 255 * nl;
      r = r * (1 - nr) + 245 * nr; g = g * (1 - nr) + 250 * nr; b = b * (1 - nr) + 255 * nr;
      const i = (y * S + x) * 4;
      px[i] = Math.min(255, r); px[i + 1] = Math.min(255, g); px[i + 2] = Math.min(255, b); px[i + 3] = 255;
    }
  }
  return encodePNG(S, S, px);
}

const outDir = path.join(__dirname, '..', 'src', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', file);
}
