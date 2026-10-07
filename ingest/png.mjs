/* Minimal PNG reader for the ingest pipeline.

   The habitat build needs pixels out of two very different PNGs - MRLC's
   paletted land-cover renders (colour type 3) and AWS terrarium elevation
   tiles (colour type 6) - and Node ships no image decoder. This handles the
   non-interlaced 8-bit cases those two services actually return and refuses
   anything else rather than quietly producing wrong pixels. */
import { inflateSync } from 'node:zlib';

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12]
      };
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.depth !== 8) throw new Error('unsupported bit depth ' + ihdr.depth);
  if (ihdr.interlace) throw new Error('interlaced PNG not supported');

  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const ch = CHANNELS[ihdr.color];
  if (!ch) throw new Error('unsupported colour type ' + ihdr.color);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.w * ch;
  const out = Buffer.alloc(stride * ihdr.h);

  /* Undo the per-scanline filters. Each row is prefixed with its filter
     type and predicted from the row above and the pixel to the left. */
  let rp = 0;
  for (let y = 0; y < ihdr.h; y++) {
    const filter = raw[rp++];
    const row = rp; rp += stride;
    const o = y * stride, prev = o - stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[row + x];
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = (x >= ch && y > 0) ? out[prev + x - ch] : 0;
      let r;
      if (filter === 0) r = v;
      else if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error('bad filter ' + filter);
      out[o + x] = r & 0xff;
    }
  }
  return { width: ihdr.w, height: ihdr.h, channels: ch, color: ihdr.color, data: out, palette: plte, trns };
}

/* Palette index at a pixel, for colour-type-3 images such as the MRLC
   land-cover renders where the index is the meaningful value. */
export function paletteIndex(img, x, y) {
  if (img.color !== 3) throw new Error('not a paletted image');
  return img.data[y * img.width + x];
}

/* Terrarium elevation in metres: (R * 256 + G + B / 256) - 32768. */
export function terrariumMetres(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  return (img.data[i] * 256 + img.data[i + 1] + img.data[i + 2] / 256) - 32768;
}
