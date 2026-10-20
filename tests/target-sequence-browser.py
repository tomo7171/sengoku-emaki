#!/usr/bin/env python3
"""Exercise optional three-goal orders through the real React battle interface.

Only campaign fixtures and nationwide-map rendering are replaced. Officers,
explicit deployment, targets, all turns, supply, automatic order transitions,
and the actual battle UI remain native. No live battle state is modified.
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
FIXTURE = """mode=>{
 const G=window.TenkaGame;let s=G.newGame();s.selectedCastleId='inabayama';s.gold=100000;s.food=1000000;
 for(const c of s.castles){c.gold=0;c.food=0;}
 const home=s.castles.find(c=>c.id==='kiyosu'),enemy=s.castles.find(c=>c.id==='inabayama');
 Object.assign(home,{gold:100000,food:100000,troops:31000,population:1000000,kokudaka:1000000});
 Object.assign(enemy,{gold:100000,food:100000,troops:mode==='defense'?1080:10080,population:250000,kokudaka:250000,morale:85,defense:60});
 s.armies.kiyosu.units={ashigaru:0,archer:1000,cavalry:0,firearm:30000,navy:0};
 s.armies.inabayama.units={ashigaru:40,archer:40,cavalry:mode==='defense'?500:5000,firearm:mode==='defense'?500:5000,navy:0};
 for(const o of s.officers)if(o.clan===s.playerClan&&o.status==='active'&&s.year-o.birth>=15)o.castleId='kiyosu';
 for(const c of s.castles.filter(c=>c.clan===s.playerClan))s.armies[c.id].commanderId=null;
 s.armies.kiyosu.commanderId='oda_nobunaga';
 if(mode==='defense')s.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:enemy.clan};
 s=G.migrate(s);if(!G.validate(s)||!G.save(s))throw Error('Target sequence fixture must validate and save: '+mode);return s;
}"""


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
Mv=()=>new Proxy({},{get:()=>()=>{}});
const originalSequence2D=window.TenkaBattle2D;
window.TenkaBattle2D={...originalSequence2D,create:(mount,options)=>{
 const renderer=originalSequence2D.create(mount,options),update=renderer.update;
 window.__monthlyBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__monthlyBattle=battle;return update(battle,...rest);};return renderer;
}};
"""
    fixture = "\nconst sequenceFixture=new URLSearchParams(location.search).get('sequenceFixture');if(sequenceFixture){(" + FIXTURE + ")(sequenceFixture);history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker, observe + fixture + marker, 1)


def snapshot(page):
    return page.evaluate('JSON.stringify(window.__monthlyBattle)')


def select_unit(orders, unit_id):
    orders.locator('.tenka-turn-roster button[data-unit-id="' + unit_id + '"]').click()


def current(page, unit_id):
    return page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)', unit_id)


def progress(orders):
    node = orders.get_by_test_id('target-sequence-progress')
    return {'index': node.get_attribute('data-sequence-index'), 'paused': node.get_attribute('data-sequence-paused'), 'text': node.inner_text()}


def pause(page, orders):
    orders.get_by_test_id('auto-battle-pause').click()
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running', 'false')
    frozen = {'battle': snapshot(page), 'progress': progress(orders)}
    page.wait_for_timeout(700)
    assert {'battle': snapshot(page), 'progress': progress(orders)} == frozen, 'global pause must preserve positions, supplies, replay and target-sequence progress'
    return frozen


def check(page, url, width, mode, shots, passed):
    print(f'STEP {width}px {mode}: prepare real three-target orders before deployment', flush=True)
    page.goto(url + '?sequenceFixture=' + mode, wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame&&!!window.TenkaAutoBattle&&!!window.TenkaTurnUI')
    BASE.saved(page)
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
    fighter = next(unit for unit in units if unit['type'] == 'firearm')
    watcher = next(unit for unit in units if unit['type'] == 'archer')
    targets = page.evaluate("""mode=>{const b=window.__monthlyBattle,other=u=>u.side!==(b.playerSide||'attacker');
 const enemies=b.units.filter(other),cavalry=enemies.find(u=>u.type==='cavalry');
 if(mode==='siege')return[...b.structures.filter(s=>s.kind==='gate').sort((a,c)=>c.z-a.z).map(s=>s.id),cavalry.id];
 return[enemies.find(u=>u.type==='ashigaru').id,enemies.find(u=>u.type==='archer').id,cavalry.id];
 }""", mode)
    assert len(targets) == 3 and len(set(targets)) == 3, targets
    frozen = snapshot(page)
    orders.get_by_role('checkbox', name='開戦後に自動進行', exact=True).check()
    orders.get_by_role('combobox', name='自動進行の速度', exact=True).select_option('4')
    select_unit(orders, fighter['id'])
    for label, target, after in zip(['第一', '第二', '第三'], targets, ['next', 'wait', 'defend']):
        orders.get_by_role('combobox', name=label + '目標', exact=True).select_option(target)
        orders.get_by_role('combobox', name=label + '目標の撃破後', exact=True).select_option(after)
    orders.get_by_role('button', name='目標の順序を設定', exact=True).click()
    plan = orders.get_by_test_id('target-sequence-progress')
    expect(plan).to_have_attribute('data-unit-id', fighter['id'])
    expect(plan).to_have_attribute('data-sequence-index', '0')
    expect(plan).to_have_attribute('data-sequence-paused', 'false')
    for index in range(3):
        expect(plan.locator('[data-sequence-goal="' + str(index) + '"]')).to_have_attribute('data-goal-status', 'current' if index == 0 else 'remaining')
    assert snapshot(page) == frozen, 'sequence planning before mandatory deployment cannot execute combat, move soldiers or spend food'
    expect(start).to_be_disabled()
    select_unit(orders, watcher['id'])
    orders.get_by_role('button', name='この部隊を待機', exact=True).click()
    for unit, commander in [(fighter, 'oda_nobunaga'), (watcher, 'shibata_katsuie')]:
        toolbar.get_by_role('combobox', name=BASE.NAMES[unit['type']] + '部隊の指揮武将', exact=True).select_option(commander)
    expect(start).to_be_disabled()
    for unit in units:
        BASE.deploy_unit(page, toolbar, unit['id'])
    expect(start).to_be_enabled()
    select_unit(orders, fighter['id'])
    expect(plan).to_have_attribute('data-sequence-index', '0')
    BASE.no_overflow(page, orders)
    orders.screenshot(path=str(shots / f'{width}-{mode}-three-target-plan.png'))
    passed(f'{width}px {mode}: three explicit ordered goals and next/wait/defend outcomes can be prepared before mandatory commanders and placement; planning consumes no time or food')

    print(f'STEP {width}px {mode}: native goal defeats advance then wait', flush=True)
    watcher_before = current(page, watcher['id'])
    start.click()
    expect(battle).to_have_attribute('data-phase', 'fighting')
    expect(plan).to_have_attribute('data-sequence-index', '2', timeout=120000)
    expect(plan).to_have_attribute('data-sequence-paused', 'true')
    expect(plan.locator('[data-sequence-goal="0"]')).to_have_attribute('data-goal-status', 'achieved')
    expect(plan.locator('[data-sequence-goal="1"]')).to_have_attribute('data-goal-status', 'achieved')
    expect(plan.locator('[data-sequence-goal="2"]')).to_have_attribute('data-goal-status', 'remaining')
    expect(orders.get_by_role('button', name='次の目標へ進む', exact=True)).to_be_visible()
    defeated = page.evaluate("""ids=>{const b=window.__monthlyBattle;return ids.map(id=>{const t=b.units.find(u=>u.id===id)||b.structures.find(s=>s.id===id);return{id,defeated:'hp'in t?t.hp<=0:t.troops<=0||['routed','destroyed'].includes(t.status)};});}""", targets[:2])
    assert all(target['defeated'] for target in defeated), defeated
    waiting = current(page, fighter['id'])
    turn = page.evaluate('window.__monthlyBattle.turnNumber')
    page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>=turn+2', arg=turn)
    still = current(page, fighter['id'])
    assert (still['x'], still['z']) == (waiting['x'], waiting['z']), 'per-unit wait after second target must hold its position while the whole battle continues'
    watcher_after = current(page, watcher['id'])
    assert (watcher_after['x'], watcher_after['z']) == (watcher_before['x'], watcher_before['z'])
    pause(page, orders)
    assert progress(orders)['index'] == '2' and progress(orders)['paused'] == 'true'
    BASE.no_overflow(page, orders)
    orders.screenshot(path=str(shots / f'{width}-{mode}-after-second-goal-wait.png'))
    passed(f'{width}px {mode}: actual first and second goals are destroyed through replayable turns; first advances automatically, second pauses only that unit, other targets stay explicit and global pause freezes progress/food')

    print(f'STEP {width}px {mode}: explicit individual resume and quick-order override', flush=True)
    # Global resume cannot override a per-unit wait between targets.
    orders.get_by_role('button', name='自動進行を開始', exact=True).click()
    turn = page.evaluate('window.__monthlyBattle.turnNumber')
    page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>turn', arg=turn)
    global_only = pause(page, orders)
    assert progress(orders)['index'] == '2' and progress(orders)['paused'] == 'true'
    stayed = current(page, fighter['id'])
    assert (stayed['x'], stayed['z']) == (still['x'], still['z']), 'global resume must not silently release a target-sequence wait'
    orders.get_by_role('button', name='次の目標へ進む', exact=True).click()
    expect(plan).to_have_attribute('data-sequence-paused', 'false')
    expect(plan).to_have_attribute('data-sequence-index', '2')
    expect(plan.locator('[data-sequence-goal="2"]')).to_have_attribute('data-goal-status', 'current')
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running', 'false')
    assert snapshot(page) == global_only['battle'], 'individual next-goal permission while globally paused must not execute a turn'
    turn = page.evaluate('window.__monthlyBattle.turnNumber')
    orders.get_by_role('button', name='自動進行を開始', exact=True).click()
    page.wait_for_function('turn=>window.__monthlyBattle.turnNumber>turn', arg=turn)
    pause(page, orders)
    # Existing quick orders intentionally replace the entire sequence.
    orders.get_by_role('button', name='この部隊を待機', exact=True).click()
    expect(orders.locator('[data-unit-id="' + fighter['id'] + '"]')).to_have_attribute('data-auto-action', 'wait')
    expect(plan).to_have_count(0)
    quick = snapshot(page)
    page.wait_for_timeout(400)
    assert snapshot(page) == quick
    assert not page.evaluate("window.__monthlyBattle.ledger.some(r=>!['deploy','start','turn-order','turn-end','stance'].includes(r.kind))"), 'sequence orders must use normal native turn records'
    BASE.no_overflow(page, orders)
    orders.screenshot(path=str(shots / f'{width}-{mode}-quick-wait-clears-plan.png'))
    passed(f'{width}px {mode}: global resume respects per-unit wait; explicit next-goal permission retains global pause, resumes third target on request, and a quick wait cancels the queue without mutating other units')
    if width == 1440 and mode == 'field':
        # Parent battle order-bar commands must invalidate an older queue too.
        for label, target in zip(['第一', '第二', '第三'], [targets[2], '', '']):
            orders.get_by_role('combobox', name=label + '目標', exact=True).select_option(target)
        orders.get_by_role('button', name='目標の順序を設定', exact=True).click()
        expect(plan).to_have_count(1)
        before_manual = page.evaluate('window.__monthlyBattle.turnNumber')
        orders.get_by_role('button', name='手動ターン', exact=True).click()
        battle.locator('.tactical-order-bar[aria-label="部隊への指示"]').get_by_role('button', name='防御', exact=True).click()
        orders.get_by_role('button', name='自動命令', exact=True).click()
        expect(plan).to_have_count(0)
        expect(orders.locator('.tenka-turn-roster button[data-unit-id="' + fighter['id'] + '"]')).to_have_attribute('data-auto-action', 'defend')
        assert page.evaluate('window.__monthlyBattle.turnNumber') == before_manual
        passed('1440px field: switching to manual and issuing defense through the parent battlefield order bar clears the old queue and inherits the new defense when returning to automatic mode')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8065')
    parser.add_argument('--screenshots', default='/tmp/tenka-target-sequence-browser')
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
