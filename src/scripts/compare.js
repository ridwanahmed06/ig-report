// Compares followers with following. Usernames match case-insensitively.

/** @typedef {import('./parse.js').Account} Account */

const byUsername = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });

/**
 * @param {Account[]} followers
 * @param {Account[]} following
 * @returns {{notFollowingBack: Account[], fans: Account[], mutuals: Account[]}}
 */
export function compareLists(followers, following) {
  const followerKeys = new Set(followers.map((a) => a.username.toLowerCase()));
  const followingKeys = new Set(following.map((a) => a.username.toLowerCase()));

  return {
    notFollowingBack: following.filter((a) => !followerKeys.has(a.username.toLowerCase())).sort(byUsername),
    fans: followers.filter((a) => !followingKeys.has(a.username.toLowerCase())).sort(byUsername),
    mutuals: following.filter((a) => followerKeys.has(a.username.toLowerCase())).sort(byUsername),
  };
}
