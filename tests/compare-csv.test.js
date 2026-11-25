import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLists } from '../src/scripts/compare.js';
import { toCsv } from '../src/scripts/csv.js';

const e = (username, timestamp = null) => ({ username, timestamp });

test('splits accounts into not-following-back, fans and mutuals', () => {
  const followers = [e('alice'), e('Bob'), e('carol')];
  const following = [e('bob'), e('dave'), e('Erin'), e('alice')];
  const result = compareLists(followers, following);
  assert.deepEqual(result.notFollowingBack.map((x) => x.username), ['dave', 'Erin']);
  assert.deepEqual(result.fans.map((x) => x.username), ['carol']);
  assert.deepEqual(result.mutuals.map((x) => x.username), ['alice', 'bob']);
});

test('matching ignores letter case', () => {
  const result = compareLists([e('SAM')], [e('sam')]);
  assert.equal(result.mutuals.length, 1);
  assert.equal(result.notFollowingBack.length, 0);
  assert.equal(result.fans.length, 0);
});

test('handles empty lists', () => {
  assert.deepEqual(compareLists([], []), { notFollowingBack: [], fans: [], mutuals: [] });
});

test('does not mutate its inputs', () => {
  const following = [e('zed'), e('amy')];
  const copy = structuredClone(following);
  compareLists([], following);
  assert.deepEqual(following, copy);
});

test('builds a CSV with header, profile link and ISO date', () => {
  const csv = toCsv([e('alice', 1700000000), e('bob')]);
  assert.equal(csv, [
    'username,profile_url,followed_at',
    'alice,https://www.instagram.com/alice/,2023-11-14',
    'bob,https://www.instagram.com/bob/,',
  ].join('\r\n') + '\r\n');
});

test('CSV escapes quotes/commas and neutralises spreadsheet formulas', () => {
  const csv = toCsv([e('=HYPERLINK("x")'), e('a,b')]);
  const lines = csv.trim().split('\r\n');
  assert.ok(lines[1].startsWith('"\'=HYPERLINK(""x"")"'));
  assert.ok(lines[2].startsWith('"a,b"'));
});
