/* OmniGuide - a vector tile reader, just large enough for GBIF's binned
   occurrence tiles.

   WHY THIS EXISTS.

   The habitat build needs to know how many records of a species fall in
   each grid square. It used to find out by paging records through the
   search API and counting them itself, which is both the wrong tool -
   GBIF answers that with "too many requests, use a download" once you
   lean on it - and, as it turned out, a biased one, because the pages
   come back in date order and the build only ever read the first few.

   GBIF's map service already does the counting. Ask it for a tile with
   square binning and it returns one polygon per occupied square with the
   exact number of matching records in it, for the whole dataset, in half
   a second. This reads that tile.

   Mapbox Vector Tile 2.1, protobuf wire format. Only what the binned
   tiles use: one layer, polygon features, integer attributes. No
   dependency, in keeping with png.mjs next door. */

function reader(buf) {
  let p = 0;
  const r = {
    more: () => p < buf.length,
    /* Multiplied rather than shifted, so a count past 2^31 survives. */
    varint() {
      let v = 0, mul = 1;
      for (;;) {
        if (p >= buf.length) throw new Error('mvt: truncated varint');
        const b = buf[p++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) return v;
        mul *= 128;
      }
    },
    bytes() {
      const n = r.varint();
      if (p + n > buf.length) throw new Error('mvt: truncated field');
      const s = buf.subarray(p, p + n);
      p += n;
      return s;
    },
    skip(wire) {
      if (wire === 0) r.varint();
      else if (wire === 1) p += 8;
      else if (wire === 2) r.bytes();
      else if (wire === 5) p += 4;
      else throw new Error('mvt: unsupported wire type ' + wire);
    }
  };
  return r;
}

const zigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function packed(buf) {
  const r = reader(buf), out = [];
  while (r.more()) out.push(r.varint());
  return out;
}

function value(buf) {
  const r = reader(buf);
  let v = null;
  while (r.more()) {
    const tag = r.varint(), field = Math.floor(tag / 8), wire = tag % 8;
    /* Floats and doubles are skipped: a count is an integer, and a
       value this reader does not understand is better left null than
       guessed at. */
    if (field === 1 && wire === 2) v = Buffer.from(r.bytes()).toString('utf8');
    else if ((field === 4 || field === 5) && wire === 0) v = r.varint();
    else if (field === 6 && wire === 0) v = zigzag(r.varint());
    else if (field === 7 && wire === 0) v = r.varint() !== 0;
    else r.skip(wire);
  }
  return v;
}

/* Bounding box of a polygon's rings, in tile units. */
function bbox(geom) {
  let x = 0, y = 0, i = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  while (i < geom.length) {
    const cmd = geom[i] % 8, count = Math.floor(geom[i] / 8);
    i++;
    if (cmd === 7) continue;                       // close path
    if (cmd !== 1 && cmd !== 2) throw new Error('mvt: unknown geometry command ' + cmd);
    for (let k = 0; k < count; k++) {
      x += zigzag(geom[i++]); y += zigzag(geom[i++]);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

/* Every bin in the tile as { x0, y0, x1, y1, total }, in tile units from
   the top-left corner, with the layer's extent. */
export function decodeBins(buffer, attribute = 'total') {
  const tile = reader(buffer);
  const bins = [];
  let extent = 4096;

  while (tile.more()) {
    const tag = tile.varint(), field = Math.floor(tag / 8), wire = tag % 8;
    if (!(field === 3 && wire === 2)) { tile.skip(wire); continue; }

    const layer = reader(tile.bytes());
    const keys = [], values = [], features = [];
    let ext = 4096;
    while (layer.more()) {
      const t = layer.varint(), f = Math.floor(t / 8), w = t % 8;
      if (f === 2 && w === 2) features.push(layer.bytes());
      else if (f === 3 && w === 2) keys.push(Buffer.from(layer.bytes()).toString('utf8'));
      else if (f === 4 && w === 2) values.push(value(layer.bytes()));
      else if (f === 5 && w === 0) ext = layer.varint();
      else layer.skip(w);
    }
    extent = ext;
    const want = keys.indexOf(attribute);
    if (want < 0) continue;

    for (const fb of features) {
      const fr = reader(fb);
      let tags = [], geom = [];
      while (fr.more()) {
        const t = fr.varint(), f = Math.floor(t / 8), w = t % 8;
        if (f === 2 && w === 2) tags = packed(fr.bytes());
        else if (f === 4 && w === 2) geom = packed(fr.bytes());
        else fr.skip(w);
      }
      let total = null;
      for (let i = 0; i + 1 < tags.length; i += 2) {
        if (tags[i] === want) total = values[tags[i + 1]];
      }
      if (typeof total !== 'number' || !geom.length) continue;
      const b = bbox(geom);
      b.total = total;
      bins.push(b);
    }
  }
  return { extent, bins };
}
