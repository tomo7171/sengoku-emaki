#!/usr/bin/env python3
"""Exercise optional automatic battle orders through the real React interface.

Native valid campaigns, mandatory named commanders and player deployment,
orders, turn ledgers, supply use, verification, settlement and saves are used.
Only the unrelated nationwide map is disabled; battle observation never changes
commands or time. Run against a local static server with Playwright/Chromium.
"""
import argparse
import importlib.util
import json
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('monthly_turn_browser', ROOT / 'tests/monthly-turns-browser.py')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)
FIXTURE = BASE.FIXTURE.replace("troops:mode==='defense'?1000:40", 'troops:5000').replace('morale:40,defense:10', 'morale:85,defense:60')


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
Mv=()=>new Proxy({},{get:()=>()=>{}});
const originalAuto2D=window.TenkaBattle2D;
window.TenkaBattle2D={...originalAuto2D,create:(mount,options)=>{
 const renderer=originalAuto2D.create(mount,options),update=renderer.update;
 window.__autoRenderer=renderer;window.__monthlyBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__monthlyBattle=battle;return update(battle,...rest);};return renderer;
}};
"""
    fixture = "\nconst autoFixture=new URLSearchParams(location.search).get('autoFixture');if(autoFixture){(" + FIXTURE + ")(autoFixture);history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker, observe + fixture + marker, 1)


def snapshot(page):
    return page.evaluate("""()=>{const b=window.__monthlyBattle;return{
 phase:b.phase,time:b.time,turn:b.turnNumber,ledger:JSON.stringify(b.ledger),supply:JSON.stringify(b.supply),
 units:b.units.map(u=>({id:u.id,x:u.x,z:u.z,troops:u.troops})),playerSide:b.playerSide||'attacker'
};}""")


def pause(page, orders):
    orders.get_by_test_id('auto-battle-pause').click()
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running', 'false')
    frozen = snapshot(page)
    page.wait_for_timeout(700)
    assert snapshot(page) == frozen, 'paused automatic orders must freeze time, positions, food and the ledger'
    return frozen


def select_unit(orders, unit_id):
    orders.locator('.tenka-turn-roster button[data-unit-id="' + unit_id + '"]').click()


def current(page, unit_id):
    return page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)', unit_id)


def check(page, url, width, mode, shots, passed):
    print(f'STEP {width}px {mode}: load native fixture', flush=True)
    page.goto(url + '?autoFixture=' + mode, wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame&&!!window.TenkaAutoBattle&&!!window.TenkaTurnUI')
    before = BASE.saved(page)
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    if mode == 'defense':
        page.get_by_role('button', name='籠城を指揮する', exact=True).click()
        page.get_by_role('dialog', name='清洲城 籠城の軍議', exact=True).get_by_role('button', name='この兵糧で籠城を指揮する', exact=True).click()
    else:
        page.get_by_role('button', name='稲葉山城へ出陣', exact=True).click()
        military = page.get_by_role('dialog', name='稲葉山城 攻略の軍議', exact=True)
        military.get_by_role('button', name='野戦' if mode == 'field' else re.compile('^攻城戦')).click()
        military.get_by_role('button', name='戦場で采配する', exact=True).click()
    battle = page.get_by_test_id('tactical-battle')
    expect(battle).to_have_attribute('data-phase', 'deployment')
    expect(page.locator('canvas.tenka-battle-2d')).to_be_visible()
    toolbar = battle.get_by_role('region', name='部隊と陣・柵の自由配置', exact=True)
    orders = battle.get_by_test_id('turn-orders')
    start = battle.get_by_role('button', name='戦闘開始', exact=True)
    expect(start).to_be_disabled()
    units = page.evaluate("window.__monthlyBattle.units.filter(u=>u.side===(window.__monthlyBattle.playerSide||'attacker')&&!u.foreignSupport).map(u=>({id:u.id,type:u.type}))")
    assert len(units) == 2, units
    for unit, commander in zip(units, ['oda_nobunaga', 'shibata_katsuie']):
        toolbar.get_by_role('combobox', name=BASE.NAMES[unit['type']] + '部隊の指揮武将', exact=True).select_option(commander)
    expect(start).to_be_disabled()
    for unit in units:
        BASE.deploy_unit(page, toolbar, unit['id'])
    expect(start).to_be_enabled()
    frozen = snapshot(page)
    orders.get_by_role('checkbox', name='開戦後に自動進行', exact=True).check()
    orders.get_by_role('combobox', name='自動進行の速度', exact=True).select_option('2')
    target = page.evaluate("""id=>{const b=window.__monthlyBattle,u=b.units.find(u=>u.id===id),enemy=b.units.filter(v=>v.side!==u.side&&v.troops>0).sort((a,c)=>Math.hypot(c.x-u.x,c.z-u.z)-Math.hypot(a.x-u.x,a.z-u.z))[0];return{id:enemy.id,distance:Math.hypot(enemy.x-u.x,enemy.z-u.z)};}""", units[0]['id'])
    select_unit(orders, units[0]['id'])
    orders.get_by_role('combobox', name='自動進行の攻撃目標', exact=True).select_option(target['id'])
    orders.get_by_role('button', name='この目標へ攻撃を継続', exact=True).click()
    select_unit(orders, units[1]['id'])
    orders.get_by_role('button', name='この部隊を待機', exact=True).click()
    assert snapshot(page) == frozen, 'pre-battle automatic order planning cannot move troops or spend supplies'
    BASE.no_overflow(page, orders)
    orders.screenshot(path=str(shots / f'{width}-{mode}-automatic-plan.png'))
    passed(f'{width}px {mode}: automatic mode retains mandatory officers/player deployment; explicit enemy target and another unit waiting are planned before battle without spending food')

    print(f'STEP {width}px {mode}: automatic turns and pause', flush=True)
    waiting = current(page, units[1]['id'])
    attacker = current(page, units[0]['id'])
    initial_supply = page.evaluate('window.__monthlyBattle.supply')
    start.click()
    expect(battle).to_have_attribute('data-phase', 'fighting')
    page.wait_for_function('window.__monthlyBattle.turnNumber>=3')
    stopped = pause(page, orders)
    assert stopped['time'] > frozen['time'] and stopped['turn'] >= 3
    ledgers = page.evaluate("window.__monthlyBattle.ledger.filter(r=>r.kind==='turn-end').length")
    assert ledgers >= 2, 'automatic progress must use ordinary replayable turn-end records'
    progress_supply = page.evaluate('window.__monthlyBattle.supply')
    for side in ['attacker', 'defender']:
        assert progress_supply[side]['consumed'] > initial_supply[side]['consumed'], 'automatic turns must consume real supplies on both sides'
    still = current(page, units[1]['id'])
    assert (still['x'], still['z']) == (waiting['x'], waiting['z']), 'waiting troops must never march or automatically seek a target'
    advanced = current(page, units[0]['id'])
    assert (advanced['x'], advanced['z']) != (attacker['x'], attacker['z']), 'an assigned distant enemy must be approached automatically'

    # Change a persistent command while paused, then resume by explicit button.
    select_unit(orders, units[0]['id'])
    orders.get_by_role('button', name='この部隊を待機', exact=True).click()
    expect(orders.locator('[data-unit-id="' + units[0]['id'] + '"]')).to_have_attribute('data-auto-action', 'wait')
    point = page.evaluate("""id=>{const b=window.__monthlyBattle,T=window.TenkaTactics,u=b.units.find(u=>u.id===id);for(const[x,z]of[[u.x+5,u.z],[u.x-5,u.z],[u.x,u.z+5],[u.x,u.z-5]])if(T.order(b,{unitId:id,order:'move',x,z}).ok)return{x,z};throw Error('No legal movement point');}""", units[0]['id'])
    orders.get_by_role('spinbutton', name='自動進行の移動先の東西', exact=True).fill(str(point['x']))
    orders.get_by_role('spinbutton', name='自動進行の移動先の南北', exact=True).fill(str(point['z']))
    orders.get_by_role('button', name='この地点へ移動を継続', exact=True).click()
    expect(orders.locator('[data-unit-id="' + units[0]['id'] + '"]')).to_have_attribute('data-auto-action', 'move')
    assert snapshot(page) == stopped, 'editing automatic instructions while paused must not execute a turn'
    orders.get_by_role('button', name='自動進行を開始', exact=True).click()
    page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>turn', arg=stopped['turn'])
    moved = pause(page, orders)
    assert (current(page, units[0]['id'])['x'], current(page, units[0]['id'])['z']) != (advanced['x'], advanced['z'])
    if width == 1440 and mode == 'field':
        # The older tactical-doctrine controls must override a standing attack,
        # including reselecting a stance that is already active.
        rest = battle.get_by_role('group', name='部隊の戦い方', exact=True).get_by_role('button', name='休息', exact=True)
        rest.click()
        select_unit(orders, units[0]['id'])
        orders.get_by_role('combobox', name='自動進行の攻撃目標', exact=True).select_option(target['id'])
        orders.get_by_role('button', name='この目標へ攻撃を継続', exact=True).click()
        expect(orders.locator('[data-unit-id="' + units[0]['id'] + '"]')).to_have_attribute('data-auto-action', 'attack')
        rest.click()
        expect(orders.locator('[data-unit-id="' + units[0]['id'] + '"]')).to_have_attribute('data-auto-action', 'wait')
        rested = current(page, units[0]['id'])
        rest_turn = snapshot(page)['turn']
        orders.get_by_role('button', name='自動進行を開始', exact=True).click()
        page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>turn', arg=rest_turn)
        moved = pause(page, orders)
        remained = current(page, units[0]['id'])
        assert (remained['x'], remained['z']) == (rested['x'], rested['z'])
        passed('1440px field: reselecting the existing rest doctrine overrides a persistent attack and the unit remains still after explicit resume')
    select_unit(orders, units[0]['id'])
    orders.get_by_role('combobox', name='自動進行の攻撃目標', exact=True).select_option(target['id'])
    orders.get_by_role('button', name='この目標へ攻撃を継続', exact=True).click()
    expect(orders.locator('[data-unit-id="' + units[0]['id'] + '"]')).to_have_attribute('data-auto-action', 'attack')
    assert snapshot(page) == moved
    orders.get_by_role('button', name='自動進行を開始', exact=True).click()
    page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>turn', arg=moved['turn'])
    battle.locator('xpath=ancestor::*[@role="dialog"][1]').get_by_role('button', name='閉じる', exact=True).click()
    confirm = battle.get_by_role('alertdialog', name='戦場を離れますか', exact=True)
    expect(confirm).to_be_visible()
    close_frozen = snapshot(page)
    page.wait_for_timeout(700)
    assert snapshot(page) == close_frozen, 'opening the retreat confirmation must immediately stop automatic battle'
    confirm.get_by_role('button', name='戦場に戻る', exact=True).click()
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running', 'false')
    page.wait_for_timeout(700)
    assert snapshot(page) == close_frozen, 'returning from confirmation must not silently restart automatic battle'
    BASE.no_overflow(page, orders)
    orders.screenshot(path=str(shots / f'{width}-{mode}-paused-orders.png'))
    passed(f'{width}px {mode}: timer advances native replay turns and both armies’ supplies; waiting unit stays still, pause freezes the ledger, live wait/move/attack changes work, close confirmation stops until explicit restart')

    print(f'STEP {width}px {mode}: automatic retreat and settlement', flush=True)
    for unit in units:
        select_unit(orders, unit['id'])
        orders.get_by_role('button', name='この部隊を退却', exact=True).click()
    orders.get_by_role('button', name='自動進行を開始', exact=True).click()
    expect(battle).to_have_attribute('data-phase', 'finished', timeout=90000)
    settlement = page.get_by_test_id('battle-settlement')
    expect(settlement).to_have_attribute('data-status', 'confirmed', timeout=120000)
    after = BASE.saved(page)
    assert after['lastBattle'] and after['lastBattle']['tactical']
    assert after['lastBattle']['mode'] == ('siege' if mode == 'defense' else mode)
    finished = snapshot(page)
    page.wait_for_timeout(700)
    assert snapshot(page) == finished, 'finished reports must never keep consuming food or adding replay turns'
    BASE.no_overflow(page, settlement)
    settlement.screenshot(path=str(shots / f'{width}-{mode}-settled.png'))
    settlement.get_by_role('button', name='結果を確認して評定へ', exact=True).click()
    expect(battle).to_have_count(0)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    restored = BASE.saved(page)
    assert restored['lastBattle']['id'] == after['lastBattle']['id']
    assert restored['food'] == after['food'] and restored['month'] == before['month']
    passed(f'{width}px {mode}: native automatic retreat finishes and verifies, result freezes, campaign return and report/food survive reload')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8065')
    parser.add_argument('--screenshots', default='/tmp/tenka-auto-battle-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--modes', default='field,siege,defense')
    args = parser.parse_args()
    shots = Path(args.screenshots); shots.mkdir(parents=True, exist_ok=True)
    for stale in [shots / 'failure.json', *shots.glob('*-failure.png')]:
        if stale.exists(): stale.unlink()
    url = args.url.rstrip('/') + '/'; checks, errors = [], []
    html = instrumented_html()
    def passed(message):
        checks.append(message); print('PASS: ' + message, flush=True)
        (shots / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, ensure_ascii=False, indent=2))
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in map(int, args.widths.split(',')):
            context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
            context.set_default_navigation_timeout(60000); context.set_default_timeout(30000)
            page = context.new_page()
            page.on('pageerror', lambda error: (errors.append(str(error)), print('BROWSER ERROR: ' + str(error), flush=True)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.route(re.compile(re.escape(url) + r'(?:\?.*)?$'), lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            try:
                for mode in args.modes.split(','): check(page, url, width, mode, shots, passed)
            except Exception:
                page.screenshot(path=str(shots / f'{width}-failure.png'))
                (shots / 'failure.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors, 'battle': page.evaluate('window.__monthlyBattle||null'), 'body': page.locator('body').inner_text()}, ensure_ascii=False, indent=2))
                raise
            finally:
                context.close()
        browser.close()
    assert not errors, errors
    print(json.dumps({'checks': checks, 'browser_errors': errors, 'screenshots': str(shots)}, ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    main()
