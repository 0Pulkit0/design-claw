// Minimal STORE-only (no compression) ZIP writer. Pure: takes
// [{ name, data: Uint8Array }] and returns a Uint8Array. No dependency, no CDN,
// no build step — fits the plain-JS extension. Store method (0) is universally
// unzippable, and the crops are already-compressed PNGs so DEFLATE buys little.
// Chosen over vendoring a minified lib so the bytes stay auditable.

function crc32(buf) {
  let c = ~0 >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
const u16 = (n) => [n & 255, (n >>> 8) & 255];
const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const enc = new TextEncoder();

export function zipStore(files) {
  const parts = []; // local sections, in order
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), // sig, version, flags, method=store
      ...u16(0), ...u16(0),                                  // mod time, mod date
      ...u32(crc), ...u32(data.length), ...u32(data.length), // crc, compressed, uncompressed
      ...u16(name.length), ...u16(0),                        // name len, extra len
    ]);
    parts.push(header, name, data);
    central.push({ name, crc, size: data.length, offset });
    offset += header.length + name.length + data.length;
  }
  const cdStart = offset;
  const cd = [];
  for (const c of central) {
    cd.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), // sig, verMade, verNeed, flags, method
      ...u16(0), ...u16(0),                                             // time, date
      ...u32(c.crc), ...u32(c.size), ...u32(c.size),                    // crc, sizes
      ...u16(c.name.length), ...u16(0), ...u16(0),                      // name, extra, comment
      ...u16(0), ...u16(0), ...u32(0),                                  // disk, internal, external attrs
      ...u32(c.offset),                                                 // local header offset
    ]), c.name);
  }
  let cdSize = 0;
  for (const x of cd) cdSize += x.length;
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(central.length), ...u16(central.length),
    ...u32(cdSize), ...u32(cdStart), ...u16(0),
  ]);
  const all = [...parts, ...cd, eocd];
  let total = 0;
  for (const x of all) total += x.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
