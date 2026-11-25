import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadExport } from '../src/scripts/load.js';
import { ExportError } from '../src/scripts/parse.js';
import { ZipError } from '../src/scripts/zip.js';
import { makeZip } from './helpers/make-zip.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const DIR = 'connections/followers_and_following/';

test('loads both lists from an export zip, ignoring other files', async () => {
  const zip = makeZip([
    { name: 'personal_information/personal_information.json', content: '{}' },
    { name: `${DIR}followers_1.json`, content: fixture('followers_1.json') },
    { name: `${DIR}following.json`, content: fixture('following.json') },
    { name: `${DIR}following_hashtags.json`, content: 'not even json' },
  ]);
  const file = new File([zip], 'instagram-export.zip', { type: 'application/zip' });
  const lists = await loadExport([file]);
  assert.equal(lists.followers.length, 3);
  assert.equal(lists.following.length, 4);
});

test('loads loose files picked individually', async () => {
  const lists = await loadExport([
    new File([fixture('followers_1.html')], 'followers_1.html'),
    new File([fixture('following.json')], 'following.json'),
    new File(['ignored'], 'readme.txt'),
  ]);
  assert.equal(lists.followers.length, 2);
  assert.equal(lists.following.length, 4);
});

test('reports a helpful error when the zip has no follower data', async () => {
  const zip = makeZip([{ name: 'media/posts_1.json', content: '[]' }]);
  await assert.rejects(
    loadExport([new File([zip], 'export.zip')]),
    (err) => err instanceof ExportError && err.code === 'NO_FILES',
  );
});

test('surfaces a ZipError for a corrupt zip', async () => {
  await assert.rejects(loadExport([new File(['garbage'], 'export.zip')]), ZipError);
});
