#!/usr/bin/env python3
"""Verify real battle personnel reports, prisoner decisions and old-save ages.

Serve this repository, then run:
    python tests/aftermath-browser.py --url http://127.0.0.1:8016
Requires Python playwright and Chromium; each browser context has isolated saves.
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


CAPTURE_FIXTURE = """() => {
  const Game=window.TenkaGame, state=Game.newGame();
  const check=(ok,text)=>{if(!ok)throw new Error(text);};
  for(const castle of state.castles.filter(c=>c.clan==='imagawa'&&c.id!=='narumi')){
    castle.clan='oda';castle.clanName=Game.clans.oda.name;castle.color=Game.clans.oda.color;
    state.armies[castle.id].commanderId=null;
    for(const officer of state.officers.filter(o=>o.castleId===castle.id))officer.castleId='narumi';
  }
  const target=state.castles.find(c=>c.id==='narumi');
  Object.assign(target,{troops:100,defense:10,morale:10});
  state.armies.narumi.units={ashigaru:100,archer:0,cavalry:0,firearm:0,navy:0};
  state.castles.find(c=>c.id==='kiyosu').troops=8000;
  state.armies.kiyosu.units={ashigaru:2000,archer:1000,cavalry:1000,firearm:4000,navy:0};
  const clans=[...new Set(state.castles.map(c=>c.clan))];
  state.alliances=clans.filter(id=>!['oda','imagawa'].includes(id));
  state.allianceExpires=Object.fromEntries(state.alliances.map(id=>[id,state.turn+12]));
  state.npcPacts=[];
  for(let i=0;i<clans.length;i++)for(let j=i+1;j<clans.length;j++){
    if(clans[i]!=='oda'&&clans[j]!=='oda')state.npcPacts.push([clans[i],clans[j]]);
  }
  check(Game.validate(state),'prebattle fixture must validate');
  let battle=Game.startBattle(Game.createBattle({state,sourceId:'kiyosu',targetId:'narumi',mode:'siege'}));
  for(let batch=0;batch<400&&battle.phase==='fighting';batch++){
    let steps=0;
    for(;steps<8&&battle.phase==='fighting';steps++)Game.simulateTick(battle);
    if(steps)battle.ledger.push({kind:'tick',steps});
  }
  check(battle.phase==='finished'&&Game.report(battle).won,'real siege must finish in victory');
  const result=Game.settle(state,battle);
  check(result.ok,result.message);
  check(Game.validate(result.state)&&Game.save(result.state),'actual settled state must save');
  const captives=result.state.officers.filter(o=>o.status==='captive'&&o.capturedBy==='oda');
  check(captives.length>=2,'real last-holding siege must capture multiple retainers');
  return {captives:captives.map(o=>({id:o.id,name:o.name})),state:result.state};
}"""


def picker(page):
    field = page.get_by_role("combobox", name="開始する大名", exact=True)
    expect(field).to_be_visible()
    expect(field.locator("option")).to_have_count(72)
    return field


def resume(page):
    picker(page)
    page.get_by_role("button", name="織田家の続きから遊ぶ", exact=True).click()


def open_report(page):
    page.get_by_role("button", name="直近の合戦を見る", exact=True).click()
    section = page.get_by_role("region", name="戦後の武将・捕虜の処遇", exact=True)
    expect(section).to_be_visible()
    expect(section.get_by_role("heading", name="武将の安否と捕虜の処遇", exact=True)).to_be_visible()
    return section


def saved_state(page):
    return page.evaluate("() => window.TenkaGame.load()")


def raw_storage(page):
    return page.evaluate("() => JSON.stringify(Object.entries(localStorage).sort())")


def prisoner_card(report, name):
    return report.locator(".tenka-aftermath-person").filter(has_text=re.compile(re.escape(name)))


def wait_status(page, officer_id, status):
    page.wait_for_function(
        "args => window.TenkaGame.load()?.officers.find(o=>o.id===args.id)?.status===args.status",
        arg={"id": officer_id, "status": status},
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8016")
    parser.add_argument("--chromium", default="/usr/bin/chromium")
    parser.add_argument("--screenshot", default="/tmp/tenka-aftermath.png")
    args = parser.parse_args()
    checks, errors = [], []
    def checked(message):
        checks.append(message)
        print("PASS: " + message, flush=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=args.chromium,
            headless=True,
            args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        )
        desktop = browser.new_context(viewport={"width": 1440, "height": 1050})
        page = desktop.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="domcontentloaded")
        picker(page)
        assert raw_storage(page) == "[]"
        fixture = page.evaluate(CAPTURE_FIXTURE)
        page.reload(wait_until="domcontentloaded")
        resume(page)
        report = open_report(page)
        summary = report.locator(".tenka-aftermath-summary")
        expect(summary).to_contain_text(f"捕虜 {len(fixture['captives'])} 人")
        for person in fixture["captives"]:
            expect(prisoner_card(report, person["name"])).to_contain_text("自家の捕虜")
        historical_outcomes = saved_state(page)["lastBattle"]["officerOutcomes"]
        checked("A real simulated last-holding siege lists every captured retainer after save/reload")

        released, executed = fixture["captives"][:2]
        prisoner_card(report, released["name"]).get_by_role("button", name="解放する", exact=True).click()
        wait_status(page, released["id"], "ronin")
        expect(prisoner_card(report, released["name"])).to_contain_text("解放済み・浪人")
        assert saved_state(page)["lastBattle"]["officerOutcomes"] == historical_outcomes
        checked("Releasing a captive changes current employment and saves without altering the original battle fate")

        execution_card = prisoner_card(report, executed["name"])
        original = raw_storage(page)
        execution_card.get_by_role("button", name="処断する", exact=True).click()
        expect(execution_card.get_by_role("alert")).to_contain_text("処断しますか")
        assert raw_storage(page) == original, "Opening execution confirmation must not execute or spend a command"
        assert next(o for o in saved_state(page)["officers"] if o["id"] == executed["id"])["status"] == "captive"
        execution_card.get_by_role("button", name="戻る", exact=True).click()
        assert raw_storage(page) == original
        execution_card.get_by_role("button", name="処断する", exact=True).click()
        execution_card.get_by_role("button", name="処断を確定する", exact=True).click()
        wait_status(page, executed["id"], "dead")
        expect(execution_card).to_contain_text("処断済み")
        final_state = saved_state(page)
        person = next(o for o in final_state["officers"] if o["id"] == executed["id"])
        assert person["deathYear"] == final_state["year"]
        assert final_state["lastBattle"]["officerOutcomes"] == historical_outcomes
        checked("Execution occurs only after explicit confirmation; cancelling preserves storage byte for byte")

        page.reload(wait_until="domcontentloaded")
        resume(page)
        report = open_report(page)
        expect(prisoner_card(report, released["name"])).to_contain_text("解放済み・浪人")
        expect(prisoner_card(report, executed["name"])).to_contain_text("処断済み")
        Path(args.screenshot).parent.mkdir(parents=True, exist_ok=True)
        report.scroll_into_view_if_needed()
        page.screenshot(path=args.screenshot, animations="disabled")
        checked("Battle report and both prisoner decisions persist through a second browser reload")
        desktop.close()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        phone = mobile.new_page()
        phone.on("pageerror", lambda error: errors.append(str(error)))
        phone.goto(args.url, wait_until="domcontentloaded")
        picker(phone)
        assert phone.evaluate("state => window.TenkaGame.save(state)", fixture["state"])
        phone.reload(wait_until="domcontentloaded")
        resume(phone)
        mobile_report = open_report(phone)
        mobile_card = prisoner_card(mobile_report, released["name"])
        release_button = mobile_card.get_by_role("button", name="解放する", exact=True)
        release_button.scroll_into_view_if_needed()
        expect(release_button).to_be_visible()
        box = release_button.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= 391
        assert phone.evaluate("() => document.documentElement.scrollWidth<=innerWidth")
        assert phone.locator(".modal").evaluate("node=>node.scrollWidth<=node.clientWidth")
        release_button.click()
        wait_status(phone, released["id"], "ronin")
        checked("390px phone report has no horizontal overflow and prisoner release remains operable")
        mobile.close()

        # A separate legacy context models the reported centuries-old officers.
        # Migration must retire them at a recorded lifespan rather than age 200+.
        legacy_context = browser.new_context(viewport={"width": 1440, "height": 1050})
        legacy = legacy_context.new_page()
        legacy.on("pageerror", lambda error: errors.append(str(error)))
        legacy.goto(args.url, wait_until="domcontentloaded")
        picker(legacy)
        migration = legacy.evaluate("""() => {
          const Game=window.TenkaGame,s=Game.newGame();
          // Deliberately model a genuine quarterly save, before the month field existed.
          delete s.month;delete s.tenka.calendar;s.year=1780;s.season=0;s.turn=881;
          const state=Game.migrate(s),older=state.officers.filter(o=>o.birth<1680);
          const nobunaga=state.officers.find(o=>o.id==='oda_nobunaga');
          return {saved:Game.save(state),older:older.map(o=>({id:o.id,status:o.status,age:window.TenkaDynasty.age(state,o)})),nobunaga};
        }""")
        assert migration["saved"]
        assert all(o["status"] == "dead" and o["age"] <= 100 for o in migration["older"])
        legacy.reload(wait_until="domcontentloaded")
        resume(legacy)
        legacy.get_by_role("button", name="評定を開く", exact=True).click()
        legacy.get_by_role("button", name="一門・継承", exact=True).click()
        nobunaga_card = legacy.locator(".tenka-family .tenka-officer").filter(has_text="織田信長")
        expect(nobunaga_card).to_contain_text("享年")
        expect(nobunaga_card).to_contain_text(f"{migration['nobunaga']['diedAtAge']}歳")
        assert not re.search(r"[2-9]\d{2}歳", nobunaga_card.inner_text())
        checked("Year1780 legacy saves retire historical NPCs and display a fixed age at death, never 200+ years")
        assert errors == [], f"Unexpected JavaScript errors: {errors}"
        legacy_context.close()
        browser.close()
    print(json.dumps({"passed": checks, "javascript_errors": errors, "screenshot": args.screenshot}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
