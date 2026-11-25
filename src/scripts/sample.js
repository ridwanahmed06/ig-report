// Deterministic fake accounts for the "Try it with sample data" button.
// Rows built from this data are never linked, because a made-up name could
// belong to a real person on Instagram.

const FIRST = ['amber', 'basil', 'cedar', 'dune', 'ember', 'fern', 'grove', 'harbor', 'iris', 'juniper', 'kelp', 'lumen', 'moss', 'nova', 'opal', 'pebble', 'quill', 'reed', 'sage', 'tide'];
const SECOND = ['studio', 'notes', 'daily', 'films', 'kitchen', 'club', 'works', 'diary', 'lab', 'press'];
const DAY = 86400;
const START = 1640995200; // 2022-01-01

/** Small seeded PRNG (mulberry32) so the sample is the same on every visit. */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @returns {{followers: import('./parse.js').Account[], following: import('./parse.js').Account[]}} */
export function sampleLists() {
  const random = rng(42);
  const names = FIRST.flatMap((f) => SECOND.map((s) => `sample.${f}.${s}`));
  const followers = [];
  const following = [];
  for (const username of names) {
    const roll = random();
    const timestamp = START + Math.floor(random() * 1000) * DAY;
    if (roll < 0.55) {
      followers.push({ username, timestamp });
      following.push({ username, timestamp });
    } else if (roll < 0.8) {
      followers.push({ username, timestamp });
    } else {
      following.push({ username, timestamp });
    }
  }
  return { followers, following };
}
