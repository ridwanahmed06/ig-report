// Turns whatever the user dropped (an export .zip, or loose JSON/HTML files)
// into followers/following lists.
import { listEntries, readEntryText } from './zip.js';
import { classifyFile, collectLists } from './parse.js';

const isZip = (file) => /\.zip$/i.test(file.name) || file.type === 'application/zip';

/** Reads only the followers/following entries from a zip. */
async function filesFromZip(zip) {
  const entries = await listEntries(zip);
  const wanted = entries.filter((e) => classifyFile(e.name));
  return Promise.all(wanted.map(async (e) => ({ path: e.name, text: await readEntryText(zip, e) })));
}

/**
 * @param {File[]} files
 * @returns {Promise<{followers: import('./parse.js').Account[], following: import('./parse.js').Account[]}>}
 */
export async function loadExport(files) {
  const groups = await Promise.all(files.map(async (file) => {
    if (isZip(file)) return filesFromZip(file);
    if (!classifyFile(file.name)) return [];
    return [{ path: file.name, text: await file.text() }];
  }));
  return collectLists(groups.flat());
}
