import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyFile, parseJson, parseHtml, parseFile, collectLists, ExportError,
} from '../src/scripts/parse.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('classifies follower and following files, ignoring look-alikes', () => {
  const cases = {
    'connections/followers_and_following/followers_1.json': 'followers',
    'followers_2.html': 'followers',
    'followers_and_following/followers.json': 'followers',
    'connections/followers_and_following/following.json': 'following',
    'following.html': 'following',
    'connections/followers_and_following/following_hashtags.json': null,
    'connections/followers_and_following/pending_follow_requests.json': null,
    'connections/followers_and_following/recently_unfollowed_profiles.json': null,
    'connections/followers_and_following/close_friends.json': null,
    'followers_and_following/': null,
    'notes.txt': null,
  };
  for (const [path, kind] of Object.entries(cases)) {
    assert.equal(classifyFile(path), kind, path);
  }
});

test('parses the followers JSON shape (username in string_list_data.value)', () => {
  const entries = parseJson(fixture('followers_1.json'));
  assert.deepEqual(entries.map((e) => e.username), ['alice', 'Bob.Builder', 'carol_99']);
  assert.equal(entries[0].timestamp, 1700000000);
});

test('parses the newer following JSON shape (username in title, no value)', () => {
  const entries = parseJson(fixture('following.json'));
  assert.deepEqual(entries.map((e) => e.username), ['bob.builder', 'dave', 'erin', 'frank']);
});

test('falls back to the profile link when value and title are missing', () => {
  const json = JSON.stringify([
    { title: '', string_list_data: [{ href: 'https://www.instagram.com/_u/linked.only/' }] },
    { string_list_data: [{ href: 'https://www.instagram.com/plain_link?igsh=abc' }] },
  ]);
  assert.deepEqual(parseJson(json).map((e) => e.username), ['linked.only', 'plain_link']);
});

test('parses the legacy relationships_followers wrapper', () => {
  const json = JSON.stringify({
    relationships_followers: [{ string_list_data: [{ value: 'legacy', timestamp: 1 }] }],
  });
  assert.deepEqual(parseJson(json).map((e) => e.username), ['legacy']);
});

test('drops entries without a valid Instagram username', () => {
  const json = JSON.stringify([
    { string_list_data: [{ value: 'good.name' }] },
    { string_list_data: [{ value: 'bad name with spaces' }] },
    { string_list_data: [{ value: '<script>' }] },
    { title: 'a'.repeat(31) },
    {},
    null,
  ]);
  assert.deepEqual(parseJson(json).map((e) => e.username), ['good.name']);
});

test('treats a missing or bad timestamp as null', () => {
  const json = JSON.stringify([{ string_list_data: [{ value: 'x', timestamp: 'soon' }] }]);
  assert.equal(parseJson(json)[0].timestamp, null);
});

test('throws ExportError for malformed JSON or an unknown shape', () => {
  assert.throws(() => parseJson('{not json'), ExportError);
  assert.throws(() => parseJson('{"something_else": 1}'), ExportError);
  assert.throws(() => parseJson('42'), ExportError);
});

test('parses the HTML export format from profile links', () => {
  const entries = parseHtml(fixture('followers_1.html'));
  assert.deepEqual(entries.map((e) => e.username), ['alice', 'html_only']);
  assert.equal(entries[0].timestamp, null);
});

test('parseFile picks the parser from the extension', () => {
  assert.equal(parseFile('x/followers_1.json', fixture('followers_1.json')).length, 3);
  assert.equal(parseFile('x/followers_1.html', fixture('followers_1.html')).length, 2);
});

test('collectLists merges multi-part followers and de-duplicates', () => {
  const lists = collectLists([
    { path: 'followers_1.json', text: fixture('followers_1.json') },
    { path: 'followers_2.json', text: fixture('followers_2.json') },
    { path: 'following.json', text: fixture('following.json') },
    { path: 'following_hashtags.json', text: '[]' },
  ]);
  assert.deepEqual(
    lists.followers.map((e) => e.username),
    ['alice', 'Bob.Builder', 'carol_99', 'gina'],
  );
  assert.equal(lists.following.length, 4);
});

test('collectLists reports which file is missing', () => {
  assert.throws(
    () => collectLists([{ path: 'following.json', text: fixture('following.json') }]),
    (err) => err instanceof ExportError && err.code === 'NO_FOLLOWERS',
  );
  assert.throws(
    () => collectLists([{ path: 'followers_1.json', text: fixture('followers_1.json') }]),
    (err) => err instanceof ExportError && err.code === 'NO_FOLLOWING',
  );
  assert.throws(
    () => collectLists([]),
    (err) => err instanceof ExportError && err.code === 'NO_FILES',
  );
});

test('collectLists accepts an account with zero followers', () => {
  const lists = collectLists([
    { path: 'followers_1.json', text: '[]' },
    { path: 'following.json', text: '{"relationships_following": []}' },
  ]);
  assert.deepEqual(lists, { followers: [], following: [] });
});

test('treats out-of-range timestamps as null so dates never crash rendering', () => {
  const json = JSON.stringify([
    { string_list_data: [{ value: 'huge', timestamp: 1e20 }] },
    { string_list_data: [{ value: 'negative', timestamp: -5 }] },
  ]);
  assert.deepEqual(parseJson(json).map((e) => e.timestamp), [null, null]);
});
