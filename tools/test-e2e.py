"""End-to-end browser test for IG Report.

Serves src/ locally, drives the real page with Playwright (Chromium) and checks
the upload -> results flow, search, keyboard tabs, CSV download, the error path,
sample mode, that the page makes no outside network requests, and that the
layout doesn't overflow at 390px. Screenshots go to .tmp/screenshots/.

Run:  python tools/test-e2e.py
"""
from __future__ import annotations

import functools
import http.server
import io
import sys
import threading
import zipfile
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
FIXTURES = ROOT / "tests" / "fixtures"
SHOTS = ROOT / ".tmp" / "screenshots"
EXPORT_DIR = "connections/followers_and_following/"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:  # keep test output clean
        pass


def start_server() -> tuple[http.server.ThreadingHTTPServer, str]:
    handler = functools.partial(QuietHandler, directory=str(SRC))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


def build_export_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("personal_information/personal_information.json", "{}")
        for name in ("followers_1.json", "followers_2.json", "following.json"):
            zf.writestr(EXPORT_DIR + name, (FIXTURES / name).read_text(encoding="utf-8"))
        zf.writestr(EXPORT_DIR + "following_hashtags.json", "not json")
    return buffer.getvalue()


def upload(page: Page, name: str, data: bytes, mime: str = "application/zip") -> None:
    page.set_input_files("#file-input", files=[{"name": name, "mimeType": mime, "buffer": data}])


def watch(page: Page, base: str, problems: list[str]) -> None:
    page.on("console", lambda m: m.type == "error" and problems.append(f"console: {m.text}"))
    page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
    page.on("request", lambda r: (not r.url.startswith(base) and not r.url.startswith(("blob:", "data:")))
            and problems.append(f"outside request: {r.url}"))


def rows(page: Page) -> list[str]:
    return page.locator("#list .row-name").all_inner_texts()


def check_desktop(browser, base: str, problems: list[str]) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    page = context.new_page()
    watch(page, base, problems)
    page.goto(base)
    expect(page.locator("#start-title")).to_have_text("Who doesn't follow you back?")
    page.screenshot(path=SHOTS / "desktop-start.png", full_page=True)

    # Upload the fixture export.
    upload(page, "instagram-export.zip", build_export_zip())
    expect(page.locator("#results")).to_be_visible()
    expect(page.locator("#results-title")).to_have_text("3 accounts you follow don't follow you back.")
    expect(page.locator("#results-meta")).to_contain_text("4 followers and 4 following")
    assert rows(page) == ["@dave", "@erin", "@frank"], rows(page)
    expect(page.locator("#tab-fans .tab-count")).to_have_text("3")
    expect(page.locator("#tab-mutuals .tab-count")).to_have_text("1")
    expect(page.locator('.venn-region[data-region="notFollowingBack"]')).to_have_class("venn-region is-active")

    first = page.locator("#list a.row").first
    expect(first).to_have_attribute("href", "https://www.instagram.com/dave/")
    expect(first).to_have_attribute("target", "_blank")
    expect(first).to_have_attribute("rel", "noopener noreferrer")
    page.wait_for_timeout(700)  # let the reveal animation finish
    page.screenshot(path=SHOTS / "desktop-results.png", full_page=True)

    # Search.
    page.fill("#search", "@er")
    expect(page.locator("#list .row-name")).to_have_text(["@erin"])
    page.fill("#search", "zzz")
    expect(page.locator("#empty")).to_have_text('No usernames match "zzz".')
    expect(page.locator("#csv-btn")).to_be_disabled()
    page.fill("#search", "")
    expect(page.locator("#list .row-name")).to_have_count(3)

    # Keyboard tabs: ArrowRight moves to Fans, End jumps to Mutuals.
    page.locator("#tab-notFollowingBack").focus()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#tab-fans")).to_have_attribute("aria-selected", "true")
    assert rows(page) == ["@alice", "@carol_99", "@gina"], rows(page)
    page.keyboard.press("End")
    expect(page.locator("#tab-mutuals")).to_be_focused()
    assert rows(page) == ["@bob.builder"], rows(page)

    # Venn click switches lists too.
    box = page.locator('.venn-count[data-count="fans"]').bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    expect(page.locator("#tab-fans")).to_have_attribute("aria-selected", "true")

    # CSV download of the Fans list.
    with page.expect_download() as info:
        page.click("#csv-btn")
    download = info.value
    assert download.suggested_filename.startswith("ig-report-fans-"), download.suggested_filename
    csv_text = Path(download.path()).read_text(encoding="utf-8")
    assert csv_text.splitlines()[0] == "username,profile_url,followed_at", csv_text
    assert "alice,https://www.instagram.com/alice/,2023-11-14" in csv_text, csv_text

    # Copy (grant clipboard so writeText succeeds).
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    page.click("#copy-btn")
    expect(page.locator("#copy-btn")).to_have_text("Copied 3")
    clip = page.evaluate("navigator.clipboard.readText()")
    assert clip.replace("\r\n", "\n") == "alice\ncarol_99\ngina", repr(clip)

    # Error path: a broken zip shows a clear message.
    page.click("#restart-btn")
    expect(page.locator("#start")).to_be_visible()
    upload(page, "broken.zip", b"this is not a zip")
    expect(page.locator("#error")).to_be_visible()
    expect(page.locator("#error")).to_contain_text("couldn't be opened as a zip")
    upload(page, "export.zip", zipfile_with({"media/posts_1.json": "[]"}))
    expect(page.locator("#error")).to_contain_text("Followers and following")
    page.screenshot(path=SHOTS / "desktop-error.png", full_page=True)

    # Big accounts: only 500 rows are drawn until "Show more" is pressed.
    page.click("#restart-btn") if page.locator("#restart-btn").is_visible() else None
    upload(page, "big.zip", big_export(1200))
    expect(page.locator("#results-title")).to_have_text("1,200 accounts you follow don't follow you back.")
    expect(page.locator("#list .row")).to_have_count(500)
    expect(page.locator("#more-btn")).to_have_text("Show 500 more (700 left)")
    page.click("#more-btn")
    expect(page.locator("#list .row")).to_have_count(1000)
    page.click("#more-btn")
    expect(page.locator("#list .row")).to_have_count(1200)
    expect(page.locator("#more-wrap")).to_be_hidden()
    page.click("#restart-btn")

    # Sample mode: rows are plain text, never links.
    page.click("#sample-btn")
    expect(page.locator("#sample-note")).to_be_visible()
    assert page.locator("#list a").count() == 0
    assert page.locator("#list .row").count() > 0
    context.close()


def big_export(count: int) -> bytes:
    import json
    following = {"relationships_following": [
        {"title": f"user_{i:05d}", "string_list_data": [{"href": f"https://www.instagram.com/_u/user_{i:05d}", "timestamp": 1700000000}]}
        for i in range(count)
    ]}
    return zipfile_with({EXPORT_DIR + "followers_1.json": "[]", EXPORT_DIR + "following.json": json.dumps(following)})


def zipfile_with(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, text in files.items():
            zf.writestr(name, text)
    return buffer.getvalue()


def check_mobile(browser, base: str, problems: list[str], scheme: str) -> None:
    context = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme,
                                  is_mobile=True, has_touch=True)
    page = context.new_page()
    watch(page, base, problems)
    page.goto(base)
    suffix = "" if scheme == "light" else "-dark"
    page.screenshot(path=SHOTS / f"mobile-start{suffix}.png", full_page=True)
    upload(page, "instagram-export.zip", build_export_zip())
    expect(page.locator("#results")).to_be_visible()
    page.wait_for_timeout(700)
    page.screenshot(path=SHOTS / f"mobile-results{suffix}.png", full_page=True)
    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    if overflow > 0:
        problems.append(f"horizontal overflow of {overflow}px at 390px ({scheme})")
    context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    server, base = start_server()
    problems: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            check_desktop(browser, base, problems)
            check_mobile(browser, base, problems, "light")
            check_mobile(browser, base, problems, "dark")
            browser.close()
    finally:
        server.shutdown()

    if problems:
        print("FAIL")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"PASS: e2e flow OK. Screenshots in {SHOTS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
