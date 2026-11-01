// Generates PNG app icons (teal rounded square with a white heart) without dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, { maskable = false, rounded = true } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0, heart = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
        const r = rounded && !maskable ? 0.22 : 0;
        const dx = Math.max(0, Math.abs(u - 0.5) - (0.5 - r)), dy = Math.max(0, Math.abs(v - 0.5) - (0.5 - r));
        if (dx * dx + dy * dy <= r * r + 1e-9) bg++;
        const scale = maskable ? 0.28 : 0.36;
        const hx = (u - 0.5) / scale, hy = -(v - 0.52) / scale;
        const a = hx * hx + hy * hy - 1;
        if (a * a * a - hx * hx * hy * hy * hy <= 0) heart++;
      }
      const cov = bg / (S * S), h = heart / (S * S);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const R = 15 + (255 - 15) * h, G = 118 + (255 - 118) * h, B = 110 + (255 - 110) * h;
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = Math.round(255 * cov);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192));
writeFileSync('public/icons/icon-512.png', png(512));
writeFileSync('public/icons/maskable-512.png', png(512, { maskable: true }));
writeFileSync('public/icons/apple-touch-icon.png', png(180, { rounded: false }));
console.log('icons written');
