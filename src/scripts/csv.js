// CSV export for a list of accounts.

/** @typedef {import('./parse.js').Account} Account */

const FORMULA_START = /^[=+\-@\t\r]/;

export const profileUrl = (username) => `https://www.instagram.com/${encodeURIComponent(username)}/`;

/** Escapes one CSV cell, and stops spreadsheets running it as a formula. */
function cell(value) {
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {number|null} timestamp Unix seconds. @returns {string} YYYY-MM-DD or '' */
export function isoDate(timestamp) {
  return timestamp == null ? '' : new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/**
 * @param {Account[]} accounts
 * @returns {string}
 */
export function toCsv(accounts) {
  const rows = [['username', 'profile_url', 'followed_at']];
  for (const a of accounts) rows.push([a.username, profileUrl(a.username), isoDate(a.timestamp)]);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
