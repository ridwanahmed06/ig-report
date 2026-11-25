import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listEntries, readEntryText, ZipError } from '../src/scripts/zip.js';
import { makeZip } from './helpers/make-zip.js';

const ENTRIES = [
  { name: 'connections/followers_and_following/followers_1.json', content: '[{"a":1}]' },
  { name: 'stored.txt', content: 'plain stored text', method: 'store' },
  { name: 'unicode-é.txt', content: 'héllo ✓' },
];

test('lists every entry name in a normal zip', async () => {
  const entries = await listEntries(makeZip(ENTRIES));
  assert.deepEqual(entries.map((e) => e.name), ENTRIES.map((e) => e.name));
});

test('reads deflated and stored entries back as text', async () => {
  const blob = makeZip(ENTRIES);
  const entries = await listEntries(blob);
  for (const [i, entry] of entries.entries()) {
    assert.equal(await readEntryText(blob, entry), ENTRIES[i].content);
  }
});

test('reads a ZIP64 archive (used by very large Instagram exports)', async () => {
  const blob = makeZip(ENTRIES, { zip64: true });
  const entries = await listEntries(blob);
  assert.equal(entries.length, ENTRIES.length);
  assert.equal(await readEntryText(blob, entries[0]), ENTRIES[0].content);
  assert.equal(await readEntryText(blob, entries[1]), ENTRIES[1].content);
});

test('throws a ZipError for a file that is not a zip', async () => {
  await assert.rejects(listEntries(new Blob(['definitely not a zip file'])), ZipError);
});

test('throws a ZipError for an empty file', async () => {
  await assert.rejects(listEntries(new Blob([])), ZipError);
});

test('throws a ZipError for unsupported compression methods', async () => {
  const blob = makeZip([{ name: 'a.txt', content: 'x' }]);
  const [entry] = await listEntries(blob);
  await assert.rejects(readEntryText(blob, { ...entry, method: 12 }), ZipError);
});

test('throws a ZipError when an entry points at a bad local header', async () => {
  const blob = makeZip([{ name: 'a.txt', content: 'x' }]);
  const [entry] = await listEntries(blob);
  await assert.rejects(readEntryText(blob, { ...entry, localHeaderOffset: 3 }), ZipError);
});

test('refuses to unpack an entry bigger than the size limit', async () => {
  const blob = makeZip([{ name: 'big.json', content: 'x'.repeat(5000) }]);
  const [entry] = await listEntries(blob);
  await assert.rejects(readEntryText(blob, entry, { maxBytes: 1000 }), /too large/);
});

test('stops unpacking when the real output exceeds the limit, even if the header lies', async () => {
  const blob = makeZip([{ name: 'bomb.json', content: 'y'.repeat(50000) }]);
  const [entry] = await listEntries(blob);
  await assert.rejects(readEntryText(blob, { ...entry, size: 10 }, { maxBytes: 1000 }), ZipError);
});

test('reports corrupt compressed data as a ZipError', async () => {
  const blob = makeZip([{ name: 'a.json', content: 'z'.repeat(2000) }]);
  const [entry] = await listEntries(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dataStart = 30 + entry.name.length;
  bytes.fill(0xff, dataStart, dataStart + 8);
  await assert.rejects(readEntryText(new Blob([bytes]), entry), ZipError);
});

test('turns low-level read errors in a damaged directory into ZipError', async () => {
  const blob = makeZip([{ name: 'a.txt', content: 'x' }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  view.setUint16(eocd + 10, 0xffff, true); // claims ZIP64, but there is no locator
  await assert.rejects(listEntries(new Blob([bytes])), ZipError);
  view.setUint16(eocd + 10, 1, true);
  const cdStart = view.getUint32(eocd + 16, true);
  view.setUint16(cdStart + 30, 40, true); // extra field longer than the directory
  view.setUint32(eocd + 12, 46 + 5 + 6, true);
  await assert.rejects(listEntries(new Blob([bytes])), ZipError);
});
