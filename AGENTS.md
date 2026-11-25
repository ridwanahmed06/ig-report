# AGENTS.md: ig-report

Public, zero-dependency static page that compares Instagram followers with following using the user's own data export. Live at https://ridwanahmed06.github.io/ig-report (repo `ridwanahmed06/ig-report`, public). The README is the user-facing manual and decisions log.

## Rules

- **Privacy is the product.** No network requests, analytics, external fonts or CDNs. The CSP meta in `src/index.html` (`connect-src 'none'`, no inline script or style) must stay strict. Never add inline `<script>` or `style=""` attributes.
- **Zero dependencies.** No framework, bundler or npm packages. `package.json` exists only for `npm test` scripts.
- Tokens live in `src/styles/tokens.css`. Components in `app.css` use tokens only.
- Usernames are untrusted input. Render them with `textContent`, validate with `USERNAME_RE` in `parse.js`, and build links only through `profileUrl()`.
- Never commit a real export (`*.zip` and `exports/` are gitignored).

## Commands

- `npm test` runs the unit tests (`node --test`). `npm run coverage` adds a coverage table.
- `python tools/test-e2e.py` runs the Playwright flow and writes screenshots at 1280px and 390px, light and dark, to `.tmp/screenshots/`.
- **Run both before claiming a change is done.**
- `python -m http.server 8000 -d src` starts a local preview.

## Deploy

Push `main`. The GitHub Action runs the tests, then deploys `src/` to Pages. There is no other step.

## Instagram export format notes

- Files: `connections/followers_and_following/followers_<n>.json` (there can be several parts) and `following.json`. Older exports use `followers.json`.
- Username lookup order: `string_list_data[0].value`, then `title`, then the `href` path. Newer `following.json` exports put the username in `title` and drop `value`.
- If Instagram changes the format again, add a fixture in `tests/fixtures/` and a test first.
