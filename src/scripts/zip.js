// Minimal, dependency-free zip reader.
//
// It reads the zip's central directory (the file index stored at the END of
// the archive) using Blob.slice, so it never loads the whole export into
// memory. A full Instagram export can be several gigabytes; we only need two
// small JSON files from it. Entries are unpacked with the browser's built-in
// DecompressionStream. Supports stored and deflated entries, plus ZIP64.

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** Real follower files are a few MB; this stops a hostile zip from exhausting memory. */
export const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
  }
}

/**
 * @typedef {object} ZipEntry
 * @property {string} name
 * @property {number} method
 * @property {number} compressedSize
 * @property {number} size
 * @property {number} localHeaderOffset
 */

/** @param {Blob} blob @param {number} start @param {number} end */
async function readView(blob, start, end) {
  const buffer = await blob.slice(start, end).arrayBuffer();
  return new DataView(buffer);
}

/** Reads a little-endian uint64 as a JS number (safe up to 2^53). */
function getU64(view, offset) {
  return Number(view.getBigUint64(offset, true));
}

/** Finds the End Of Central Directory record by scanning backwards. */
async function findEocd(blob) {
  if (blob.size < EOCD_MIN_SIZE) throw new ZipError('This file is too small to be a zip.');
  const searchStart = Math.max(0, blob.size - EOCD_MIN_SIZE - MAX_COMMENT);
  const view = await readView(blob, searchStart, blob.size);
  for (let i = view.byteLength - EOCD_MIN_SIZE; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return { view, offset: i, absolute: searchStart + i };
  }
  throw new ZipError("This doesn't look like a zip file.");
}

/** Returns { count, cdSize, cdOffset }, following ZIP64 records when present. */
async function readDirectoryInfo(blob) {
  const { view, offset, absolute } = await findEocd(blob);
  const count = view.getUint16(offset + 10, true);
  const cdSize = view.getUint32(offset + 12, true);
  const cdOffset = view.getUint32(offset + 16, true);
  const needsZip64 = count === MAX16 || cdSize === MAX32 || cdOffset === MAX32;
  if (!needsZip64) return { count, cdSize, cdOffset };

  const locatorStart = absolute - 20;
  if (locatorStart < 0) throw new ZipError('Broken ZIP64 archive.');
  const locator = await readView(blob, locatorStart, absolute);
  if (locator.getUint32(0, true) !== SIG_ZIP64_LOCATOR) throw new ZipError('Broken ZIP64 archive.');
  const recordOffset = getU64(locator, 8);
  const record = await readView(blob, recordOffset, recordOffset + 56);
  if (record.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError('Broken ZIP64 archive.');
  return { count: getU64(record, 32), cdSize: getU64(record, 40), cdOffset: getU64(record, 48) };
}

/** Applies the ZIP64 "extended information" extra field (id 0x0001), if any. */
function applyZip64Extra(view, start, length, fields) {
  let pos = start;
  const end = start + length;
  while (pos + 4 <= end) {
    const id = view.getUint16(pos, true);
    const size = view.getUint16(pos + 2, true);
    if (id === 0x0001) {
      let cursor = pos + 4;
      const next = () => { const v = getU64(view, cursor); cursor += 8; return v; };
      return {
        size: fields.size === MAX32 ? next() : fields.size,
        compressedSize: fields.compressedSize === MAX32 ? next() : fields.compressedSize,
        localHeaderOffset: fields.localHeaderOffset === MAX32 ? next() : fields.localHeaderOffset,
      };
    }
    pos += 4 + size;
  }
  return fields;
}

/**
 * Lists the entries in a zip without reading their contents.
 * @param {Blob} blob
 * @returns {Promise<ZipEntry[]>}
 */
export async function listEntries(blob) {
  try {
    return await readCentralDirectory(blob);
  } catch (err) {
    // DataView reads past a damaged record throw RangeError; report it plainly.
    if (err instanceof ZipError) throw err;
    throw new ZipError('This zip looks incomplete or damaged.');
  }
}

/** @param {Blob} blob @returns {Promise<ZipEntry[]>} */
async function readCentralDirectory(blob) {
  const { count, cdSize, cdOffset } = await readDirectoryInfo(blob);
  if (cdOffset + cdSize > blob.size) throw new ZipError('This zip looks incomplete or damaged.');
  const view = await readView(blob, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const entries = [];
  let pos = 0;

  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > view.byteLength || view.getUint32(pos, true) !== SIG_CENTRAL) {
      throw new ZipError('This zip looks incomplete or damaged.');
    }
    const method = view.getUint16(pos + 10, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    if (pos + 46 + nameLength + extraLength + commentLength > view.byteLength) {
      throw new ZipError('This zip looks incomplete or damaged.');
    }
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + pos + 46, nameLength);
    const sizes = applyZip64Extra(view, pos + 46 + nameLength, extraLength, {
      compressedSize: view.getUint32(pos + 20, true),
      size: view.getUint32(pos + 24, true),
      localHeaderOffset: view.getUint32(pos + 42, true),
    });
    entries.push({ name: decoder.decode(nameBytes), method, ...sizes });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Reads one entry and decodes it as UTF-8 text.
 * @param {Blob} blob
 * @param {ZipEntry} entry
 * @param {{maxBytes?: number}} [opts]
 * @returns {Promise<string>}
 */
export async function readEntryText(blob, entry, { maxBytes = MAX_ENTRY_BYTES } = {}) {
  if (entry.method !== METHOD_STORE && entry.method !== METHOD_DEFLATE) {
    throw new ZipError(`Unsupported compression in "${entry.name}".`);
  }
  if (entry.size > maxBytes) {
    throw new ZipError(`"${entry.name}" is too large to be a followers list.`);
  }
  const header = await readView(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (header.byteLength < 30 || header.getUint32(0, true) !== SIG_LOCAL) {
    throw new ZipError(`Couldn't find "${entry.name}" inside the zip.`);
  }
  const dataStart = entry.localHeaderOffset + 30
    + header.getUint16(26, true) + header.getUint16(28, true);
  const data = blob.slice(dataStart, dataStart + entry.compressedSize);
  if (entry.method === METHOD_STORE) return data.text();
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError('This browser is too old to open zip files. Update it, or unzip the export and pick the two files instead.');
  }
  try {
    const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await streamToText(stream, maxBytes, entry.name);
  } catch (err) {
    if (err instanceof ZipError) throw err;
    throw new ZipError(`"${entry.name}" is damaged inside the zip.`);
  }
}

/** Decodes a byte stream as UTF-8, giving up once it passes maxBytes. */
async function streamToText(stream, maxBytes, name) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ZipError(`"${name}" is too large to be a followers list.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
