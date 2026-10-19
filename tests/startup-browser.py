#!/usr/bin/env python3
"""Exercise real start/resume/faction selection in the shipped browser game.

Run a static server from the repository, then:
    python tests/startup-browser.py --url http://127.0.0.1:8000
Requires the Python playwright package and Chromium (default /usr/bin/chromium).
"""

import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def raw_storage(page):
    return page.evaluate("() => JSON.stringify(Object.entries(localStorage).sort())")


def saved_state(page):
    return page.evaluate("() => window.TenkaGame.load()")


def wait_for_clan(page, clan):
    page.wait_for_function(
        "clan => window.TenkaGame.load()?.playerClan === clan", arg=clan
    )


def assert_picker(page):
    picker = page.get_by_role("combobox", name="開始する大名", exact=True)
    expect(picker).to_be_visible()
    expect(picker.locator("option")).to_have_count(72)
    values = picker.locator("option").evaluate_all("nodes => nodes.map(n => n.value)")
    assert len(set(values)) == 72, "Every faction must have one selectable option"
    assert {"oda", "shimazu", "takeda", "date", "kakizaki", "ryukyu"} <= set(values)
    return picker


def assert_mobile_control(page, locator):
    expect(locator).to_be_visible()
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box and box["width"] >= 44 and box["height"] >= 35
    assert box["x"] >= 0 and box["x"] + box["width"] <= 391
    assert 0 <= box["y"] < 844 and box["y"] + box["height"] <= 845


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--screenshot", default="/tmp/tenka-daimyo-start.png")
    args = parser.parse_args()
    checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=args.chromium,
            headless=True,
            args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 1050})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="domcontentloaded")
        picker = assert_picker(page)
        assert raw_storage(page) == "[]", "Opening the chooser must not save Oda implicitly"
        page.reload(wait_until="domcontentloaded")
        picker = assert_picker(page)
        assert raw_storage(page) == "[]", "Reloading before start must retain a clean save slot"
        checks.append("Unstarted reload keeps all 72 choices and does not create a save")

        picker.select_option("shimazu")
        expect(page.locator(".tenka-start-lord")).to_contain_text("島津家")
        assert raw_storage(page) == "[]", "Previewing a faction must not create a save"
        page.get_by_role("button", name="選んだ大名で始める", exact=True).click()
        wait_for_clan(page, "shimazu")
        state = saved_state(page)
        assert (state["year"], state["month"], state["turn"]) == (1560, 3, 1)
        chosen_castle = next(c for c in state["castles"] if c["id"] == state["selectedCastleId"])
        assert chosen_castle["clan"] == "shimazu"
        expect(page.locator(".player-profile")).to_contain_text("島津")
        checks.append("Starting Shimazu creates its own valid campaign, castle and header")

        page.get_by_role("button", name="次の月へ").click()
        page.wait_for_function("() => window.TenkaGame.load()?.turn === 2")
        page.reload(wait_until="domcontentloaded")
        picker = assert_picker(page)
        expect(page.get_by_role("button", name="島津家の続きから遊ぶ", exact=True)).to_be_visible()
        expect(page.locator(".tenka-start-saved")).to_contain_text("第2月")
        original = raw_storage(page)
        picker.select_option("takeda")
        assert raw_storage(page) == original, "Changing the preview must preserve progressed storage"
        page.get_by_role("button", name="選んだ大名で始める", exact=True).click()
        expect(page.get_by_role("button", name="武田家で新しく始める", exact=True)).to_be_visible()
        assert raw_storage(page) == original, "Opening confirmation must preserve storage"
        page.get_by_role("button", name="大名選択に戻る", exact=True).click()
        assert_picker(page)
        assert raw_storage(page) == original, "Cancelling a reset must preserve storage byte for byte"
        page.get_by_role("button", name="島津家の続きから遊ぶ", exact=True).click()
        assert saved_state(page)["turn"] == 2
        assert saved_state(page)["playerClan"] == "shimazu"
        checks.append("Progressed saves retain 72 choices; preview and cancelled reset preserve the save")

        page.locator(".player-profile").click()
        page.get_by_role("button", name="大名を選んで新しく始める", exact=True).click()
        picker = assert_picker(page)
        assert raw_storage(page) == original, "Profile restart must enter selection without resetting"
        assert picker.input_value() == "shimazu"
        picker.select_option("takeda")
        expect(page.locator(".tenka-start-lord")).to_contain_text("武田家")
        Path(args.screenshot).parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=args.screenshot, animations="disabled")
        page.get_by_role("button", name="選んだ大名で始める", exact=True).click()
        page.get_by_role("button", name="武田家で新しく始める", exact=True).click()
        wait_for_clan(page, "takeda")
        state = saved_state(page)
        assert (state["year"], state["month"], state["season"], state["turn"]) == (1560, 3, 0, 1)
        assert page.evaluate("() => window.TenkaGame.validate(window.TenkaGame.load())")
        head = page.evaluate("() => window.TenkaDynasty.getView(window.TenkaGame.load()).family.head")
        assert head["name"] == "武田晴信" and head["status"] == "active"
        assert next(c for c in state["castles"] if c["id"] == state["selectedCastleId"])["clan"] == "takeda"
        expect(page.locator(".player-profile")).to_contain_text("武田")
        checks.append("Profile restart preserves the save until Takeda is explicitly confirmed")

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        phone = mobile.new_page()
        phone.on("pageerror", lambda error: errors.append(str(error)))
        phone.goto(args.url, wait_until="domcontentloaded")
        phone_picker = assert_picker(phone)
        phone_picker.select_option("date")
        assert_mobile_control(phone, phone.get_by_role("button", name="選んだ大名で始める", exact=True))
        assert phone.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        phone.get_by_role("button", name="選んだ大名で始める", exact=True).click()
        wait_for_clan(phone, "date")
        phone.reload(wait_until="domcontentloaded")
        assert_picker(phone)
        assert_mobile_control(phone, phone.get_by_role("button", name="選んだ大名で始める", exact=True))
        assert_mobile_control(phone, phone.get_by_role("button", name="伊達家の続きから遊ぶ", exact=True))
        assert phone.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
        phone.get_by_role("button", name="伊達家の続きから遊ぶ", exact=True).click()
        wait_for_clan(phone, "date")
        checks.append("390px phone offers usable new-start and resume controls without horizontal overflow")
        assert errors == [], f"Unexpected JavaScript errors: {errors}"
        mobile.close()
        context.close()
        browser.close()
    print(json.dumps({"passed": checks, "javascript_errors": errors, "screenshot": args.screenshot}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
