/* App icons, drawn rather than exported, so they can be rebuilt.

   The mark is the map's own selection reticle - a ring with four ticks
   and a centre dot - in the dark theme's accent on its dark ground.

     icons/icon-192.png, icon-512.png      rounded square, for "any" use
     icons/icon-maskable-512.png           full bleed, mark inside the safe zone
     icons/apple-touch-icon.png (180)      full bleed; iOS rounds the corners
     icons/favicon-32.png, favicon.svg

   Run: node tools/icons.mjs */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });

const GROUND = [0x12, 0x1C, 0x18];
const MARK = [0xC6, 0xF2, 0x4E];

/* ---------- PNG ---------- */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- drawing, in units of the icon's width ---------- */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/* scale shrinks the mark towards the centre (the maskable icon keeps it
   inside the safe zone); rounded draws the ground as a rounded square. */
function draw(size, { scale = 1, rounded = false } = {}) {
  const img = Buffer.alloc(size * size * 4);
  const SS = 4, R = 0.25 * scale, W = 0.058 * scale, T0 = 0.315 * scale, T1 = 0.43 * scale, DOT = 0.05 * scale;
  const corner = 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ground = 0, mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size, v = (y + (sy + 0.5) / SS) / size;
          let inG = true;
          if (rounded) {
            const qx = Math.max(Math.abs(u - 0.5) - (0.5 - corner), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - corner), 0);
            inG = Math.hypot(qx, qy) <= corner;
          }
          if (!inG) continue;
          ground++;
          const cx = u - 0.5, cy = v - 0.5, r = Math.hypot(cx, cy);
          let on = Math.abs(r - R) <= W / 2 || r <= DOT;
          if (!on) {
            for (const [ax, ay, bx, by] of [[0, -T0, 0, -T1], [0, T0, 0, T1], [-T0, 0, -T1, 0], [T0, 0, T1, 0]]) {
              if (segDist(cx, cy, ax, ay, bx, by) <= W / 2) { on = true; break; }
            }
          }
          if (on) mark++;
        }
      }
      const n = SS * SS, a = ground / n, m = ground ? mark / ground : 0, o = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) img[o + k] = Math.round(GROUND[k] + (MARK[k] - GROUND[k]) * m);
      img[o + 3] = Math.round(255 * a);
    }
  }
  return png(size, img);
}

writeFileSync(join(OUT, 'icon-192.png'), draw(192, { rounded: true }));
writeFileSync(join(OUT, 'icon-512.png'), draw(512, { rounded: true }));
writeFileSync(join(OUT, 'icon-maskable-512.png'), draw(512, { scale: 0.78 }));
writeFileSync(join(OUT, 'apple-touch-icon.png'), draw(180, { scale: 0.92 }));
writeFileSync(join(OUT, 'favicon-32.png'), draw(32, { rounded: true }));

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" rx="14" fill="' + hex(GROUND) + '"/>' +
  '<g fill="none" stroke="' + hex(MARK) + '" stroke-width="3.7" stroke-linecap="round">' +
  '<circle cx="32" cy="32" r="16"/><path d="M32 11.8V4.5M32 52.2v7.3M11.8 32H4.5M52.2 32h7.3"/></g>' +
  '<circle cx="32" cy="32" r="3.2" fill="' + hex(MARK) + '"/></svg>\n';
writeFileSync(join(OUT, 'favicon.svg'), svg);
console.log('wrote icons/: icon-192, icon-512, icon-maskable-512, apple-touch-icon, favicon-32, favicon.svg');
