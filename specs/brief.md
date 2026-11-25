# Brief: IG Report

Decisions from the interview on 2026-11-24.

- **Goal:** compare Instagram followers with following and show who doesn't follow you back.
- **Audience:** anyone on Instagram, so it should be friendly to non-technical users.
- **Platform:** Instagram only.
- **Data source:** the user's own Instagram data export (.zip, or the loose JSON/HTML files). "Just type a username" was rejected: there is no public API, browsers block cross-site reads, private accounts are hidden, and a server-side scraper breaks Instagram's rules.
- **Format:** static web page on GitHub Pages. All processing happens in the browser.
- **Lists:** Not following back (primary), Fans, Mutuals.
- **Extras:** search, profile links, CSV download and copy to clipboard.
- **Look:** clean, bright and minimal (ChatGPT-like), with automatic dark mode. No Instagram logo or brand colours, plus a "not affiliated" line.
- **Repo:** public, `ridwanahmed06/ig-report`, MIT license.
- **Added by Claude:** a "Try it with sample data" button, so visitors can see the tool without waiting for an export.
