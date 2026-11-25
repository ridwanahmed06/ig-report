// Test helper: builds small zip files in memory so the reader can be tested
// against known input. Supports stored + deflated entries and an optional
// ZIP64 layout (forced 0xFFFFFFFF markers + ZIP64 extra fields / records).
import { deflateRawSync, crc32 } from 'node:zlib';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const MAX32 = 0xffffffff;

/**
 * @param {{name: string, content: string, method?: 'store'|'deflate'}[]} entries
 * @param {{zip64?: boolean}} [opts]
 * @returns {Blob}
 */
export function makeZip(entries, { zip64 = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const method = entry.method === 'store' ? 0 : 8;
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const localExtra = zip64
      ? Buffer.concat([u16(0x0001), u16(16), u64(raw.length), u64(data.length)])
      : Buffer.alloc(0);
    const local = Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(0x0800), u16(method),
      u16(0), u16(0), u32(crc),
      u32(zip64 ? MAX32 : data.length), u32(zip64 ? MAX32 : raw.length),
      u16(name.length), u16(localExtra.length), name, localExtra, data,
    ]);

    const centralExtra = zip64
      ? Buffer.concat([u16(0x0001), u16(24), u64(raw.length), u64(data.length), u64(offset)])
      : Buffer.alloc(0);
    const central = Buffer.concat([
      u32(0x02014b50), u16(zip64 ? 45 : 20), u16(zip64 ? 45 : 20), u16(0x0800), u16(method),
      u16(0), u16(0), u32(crc),
      u32(zip64 ? MAX32 : data.length), u32(zip64 ? MAX32 : raw.length),
      u16(name.length), u16(centralExtra.length), u16(0), u16(0), u16(0), u32(0),
      u32(zip64 ? MAX32 : offset), name, centralExtra,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const cd = Buffer.concat(centrals);
  const cdOffset = offset;
  const tail = [];

  if (zip64) {
    const zip64EocdOffset = cdOffset + cd.length;
    tail.push(Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(entries.length), u64(entries.length), u64(cd.length), u64(cdOffset),
    ]));
    tail.push(Buffer.concat([u32(0x07064b50), u32(0), u64(zip64EocdOffset), u32(1)]));
  }

  tail.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(zip64 ? 0xffff : entries.length), u16(zip64 ? 0xffff : entries.length),
    u32(zip64 ? MAX32 : cd.length), u32(zip64 ? MAX32 : cdOffset), u16(0),
  ]));

  return new Blob([...locals, cd, ...tail], { type: 'application/zip' });
}
