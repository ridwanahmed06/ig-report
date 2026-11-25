// Turns Instagram "Download your information" files into username lists.
//
// Instagram has shipped a few shapes over the years, so every lookup has a
// fallback:
//   followers_1.json  -> [ { string_list_data: [{ href, value, timestamp }] } ]
//   following.json    -> { relationships_following: [ { title, string_list_data: [{ href, timestamp }] } ] }
//   (older exports)   -> { relationships_followers: [...] }
//   HTML exports      -> <a href="https://www.instagram.com/<username>">

/** Instagram usernames: letters, digits, dots, underscores; max 30 chars. */
const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
/** Latest plausible follow time (year 3000) in Unix seconds; anything outside is junk. */
const MAX_TIMESTAMP = 32503680000;
const FOLLOWERS_FILE_RE = /(?:^|\/)followers(?:_\d+)?\.(?:json|html)$/i;
const FOLLOWING_FILE_RE = /(?:^|\/)following\.(?:json|html)$/i;
const PROFILE_LINK_RE = /<a\b[^>]*\bhref="https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([^"/?#]+)\/?(?:[?#][^"]*)?"/gi;
/** Instagram paths that are pages, not profiles. */
const RESERVED_PATHS = new Set(['accounts', 'explore', 'p', 'reel', 'reels', 'stories', 'direct']);

export class ExportError extends Error {
  /** @param {'NO_FILES'|'NO_FOLLOWERS'|'NO_FOLLOWING'|'BAD_FILE'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ExportError';
    this.code = code;
  }
}

/**
 * @typedef {object} Account
 * @property {string} username   As Instagram displays it (original casing).
 * @property {number|null} timestamp  Unix seconds when the follow happened, if known.
 */

/**
 * @param {string} path  File path inside the zip, or a plain file name.
 * @returns {'followers'|'following'|null}
 */
export function classifyFile(path) {
  if (FOLLOWERS_FILE_RE.test(path)) return 'followers';
  if (FOLLOWING_FILE_RE.test(path)) return 'following';
  return null;
}

/** Extracts the username from a profile URL, or '' if it isn't one. */
function usernameFromHref(href) {
  if (typeof href !== 'string') return '';
  const match = href.match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function firstValid(...candidates) {
  return candidates.find((c) => typeof c === 'string' && USERNAME_RE.test(c)) ?? null;
}

/** @returns {Account|null} */
function entryToAccount(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const data = Array.isArray(entry.string_list_data) ? entry.string_list_data[0] ?? {} : {};
  const username = firstValid(data.value, entry.title, usernameFromHref(data.href));
  if (!username) return null;
  const ts = data.timestamp;
  const timestamp = Number.isFinite(ts) && ts > 0 && ts < MAX_TIMESTAMP ? ts : null;
  return { username, timestamp };
}

function findEntryArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    const key = Object.keys(parsed).find((k) => k.startsWith('relationships_'));
    if (key && Array.isArray(parsed[key])) return parsed[key];
  }
  return null;
}

/**
 * @param {string} text  Contents of a followers/following JSON file.
 * @returns {Account[]}
 */
export function parseJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExportError('BAD_FILE', "One of the files isn't valid JSON.");
  }
  const entries = findEntryArray(parsed);
  if (!entries) throw new ExportError('BAD_FILE', "One of the files isn't in Instagram's format.");
  return entries.map(entryToAccount).filter(Boolean);
}

/**
 * @param {string} text  Contents of a followers/following HTML file.
 * @returns {Account[]}
 */
export function parseHtml(text) {
  const accounts = [];
  for (const match of text.matchAll(PROFILE_LINK_RE)) {
    let username = '';
    try {
      username = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (USERNAME_RE.test(username) && !RESERVED_PATHS.has(username.toLowerCase())) {
      accounts.push({ username, timestamp: null });
    }
  }
  return accounts;
}

/** @param {string} path @param {string} text @returns {Account[]} */
export function parseFile(path, text) {
  return /\.html$/i.test(path) ? parseHtml(text) : parseJson(text);
}

/** Keeps the first occurrence of each username (case-insensitive). */
function dedupe(accounts) {
  const seen = new Set();
  return accounts.filter((a) => {
    const key = a.username.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds the followers and following lists from a set of export files.
 * Files that aren't followers/following are ignored.
 * @param {{path: string, text: string}[]} files
 * @returns {{followers: Account[], following: Account[]}}
 */
export function collectLists(files) {
  const groups = { followers: [], following: [] };
  for (const file of files) {
    const kind = classifyFile(file.path);
    if (kind) groups[kind].push(file);
  }
  if (!groups.followers.length && !groups.following.length) {
    throw new ExportError('NO_FILES', "Couldn't find your followers or following lists.");
  }
  if (!groups.followers.length) {
    throw new ExportError('NO_FOLLOWERS', 'Found who you follow, but not your followers file.');
  }
  if (!groups.following.length) {
    throw new ExportError('NO_FOLLOWING', 'Found your followers, but not the "following" file.');
  }
  const parseGroup = (group) => dedupe(group.flatMap((f) => parseFile(f.path, f.text)));
  return { followers: parseGroup(groups.followers), following: parseGroup(groups.following) };
}
