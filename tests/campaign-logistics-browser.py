#!/usr/bin/env python3
"""Real campaign UI: graph routes, gathering troops, ration choice and battles.

Only renderer observations are injected. Campaign saves, graph traversal,
transfers, supply validation and 3D combat are the production implementations.

This compatibility harness explicitly uses the earlier real-time battle mode;
monthly-turns-browser.py separately verifies current live player-planned turns
in field, siege and defensive battles. No production mode or rule is changed.
"""
import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy']


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
// Test-only legacy record compatibility; current live turns are checked by monthly-turns-browser.py.
const legacyBattleCreate=Xn,legacyBattleDefense=window.TenkaTactics.createDefense;
Xn=options=>legacyBattleCreate({...options,controlMode:undefined});
window.TenkaTactics.createDefense=(state,threat,options={})=>legacyBattleDefense(state,threat,{...options,controlMode:undefined});
const logisticsRenderer=G_;
G_=(mount,options)=>{
 const renderer=logisticsRenderer(mount,options),update=renderer.update;
 window.__logisticsBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__logisticsBattle=battle;return update(battle,...rest);};
 return renderer;
};
"""
    graph_marker = 'routeOverlay.userData.selectedCount=segments.filter(route=>route.selected).length;'
    assert html.count(graph_marker) == 1
    html = html.replace(graph_marker, graph_marker + "window.__logisticsRoutes={...routeOverlay.userData,segments:segments.map(route=>({id:route.id,sourceId:route.sourceId,targetId:route.targetId,selected:route.selected,route:route.route,dashed:route.dashed})),meshes:routeOverlay.children.map(mesh=>({selected:mesh.userData.selected,route:mesh.userData.route,vertices:mesh.geometry.attributes.position.count,depthTest:mesh.material.depthTest,renderOrder:mesh.renderOrder}))};", 1)
    return html.replace(marker, observe + marker, 1)


FIXTURE = """kind=>{
 const G=window.TenkaGame;let s=G.newGame();s.gold=100000;s.food=100000;
 if(kind==='defense')s.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:'saito'};
 if(kind==='sea'){s=window.TenkaSystems.chooseClan(s,'murakami_noshima').state;s.selectedCastleId='noshima';s.food=100000;s.gold=100000;}
 s=G.migrate(s);
 if(!G.validate(s)||!G.save(s))throw Error('Native logistics fixture must validate and save');
 return s;
}"""


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def resume(page, url, kind=None):
    if page.url == 'about:blank':
        page.goto(url, wait_until='domcontentloaded')
    else:
        page.reload(wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame')
    fixture = page.evaluate(FIXTURE, kind) if kind else None
    if kind:
        page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name=re.compile('の続きから遊ぶ$')).click()
    page.wait_for_function('!!window.__logisticsRoutes', timeout=60000)
    return fixture


def no_overflow(page, region):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    offenders = region.locator('input,select,button').evaluate_all("""nodes=>nodes.flatMap(node=>{
 const r=node.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{text:node.getAttribute('aria-label')||node.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not offenders, offenders


def castle(state, castle_id):
    return next(c for c in state['castles'] if c['id'] == castle_id)


def units(state):
    return {kind: sum(army['units'][kind] for army in state['armies'].values()) for kind in TYPES}


def map_and_gather(page, url, width, shots, passed):
    before = resume(page, url, 'ordinary')
    panel = page.get_by_role('region', name='城の接続先と進軍路', exact=True)
    expect(panel).to_contain_text('清洲城の接続先')
    expect(panel.locator('.tenka-route-row')).to_have_count(len(castle(before, 'kiyosu')['neighbors']))
    graph = page.evaluate('window.__logisticsRoutes')
    assert len(before['castles']) == 95
    assert graph['segmentCount'] == graph['selectedCount'] == len(castle(before, 'kiyosu')['neighbors'])
    assert all(s['selected'] and s['sourceId'] == 'kiyosu' for s in graph['segments'])
    assert all(not m['depthTest'] and m['renderOrder'] >= 44 and m['vertices'] > 0 for m in graph['meshes'])
    markers = page.locator('.castle-marker.connected')
    expect(markers.first).to_be_visible(timeout=30000)
    page.get_by_test_id('scene').locator('..').screenshot(path=str(shots / f'{width}-map-connections.png'))
    panel.get_by_role('button', name='接続先を地図で見る', exact=True).click()
    assert all(before['castles'][next(i for i, c in enumerate(before['castles']) if c['id'] == m)]['id'] in castle(before, 'kiyosu')['neighbors'] for m in markers.evaluate_all("nodes=>nodes.map(n=>n.dataset.testid.replace('marker-',''))"))
    toggle = panel.get_by_role('checkbox', name='全国の接続線', exact=True)
    expect(toggle).not_to_be_checked(); toggle.check()
    expected_edges = len({':'.join(sorted([c['id'], dest])) for c in before['castles'] for dest in c['neighbors']})
    page.wait_for_function('(n)=>window.__logisticsRoutes.segmentCount===n', arg=expected_edges)
    toggle.uncheck()
    page.wait_for_function('(n)=>window.__logisticsRoutes.segmentCount===n', arg=len(castle(before, 'kiyosu')['neighbors']))
    no_overflow(page, panel)
    panel.screenshot(path=str(shots / f'{width}-connections.png'))

    gathering = page.get_by_role('region', name='周辺の自領から集兵', exact=True)
    source = gathering.get_by_role('combobox', name='集兵の出発元', exact=True)
    count = gathering.get_by_role('spinbutton', name='集兵人数', exact=True)
    submit = gathering.get_by_role('button', name='清洲城へ集兵する', exact=True)
    expect(source).to_have_value(''); expect(count).to_have_value(''); expect(submit).to_be_disabled()
    source.select_option('inuyama'); count.fill('600.5'); expect(submit).to_be_disabled()
    count.fill('600'); expect(submit).to_be_enabled()
    expect(gathering).to_contain_text('兵糧60石')
    no_overflow(page, gathering); gathering.screenshot(path=str(shots / f'{width}-gather-choice.png'))
    submit.click()
    page.wait_for_function("window.TenkaGame.load().castles.find(c=>c.id==='kiyosu').troops===3800")
    after = saved(page)
    assert castle(after, 'inuyama')['troops'] == castle(before, 'inuyama')['troops'] - 600
    assert units(after) == units(before)
    assert after['food'] == before['food'] - 60
    assert after['tenka']['castleOrders']['castles']['inuyama']['remaining'] == 2
    assert after['tenka']['castleOrders']['castles']['kiyosu']['remaining'] == 3
    assert after['officers'] == before['officers']
    for target in ['kiyosu', 'inuyama']:
        assert after['armies'][target]['commanderId'] == before['armies'][target]['commanderId']
    resume(page, url)
    restored = saved(page)
    assert restored['armies'] == after['armies'] and restored['food'] == after['food']
    assert restored['tenka']['castleOrders'] == after['tenka']['castleOrders']
    panel = page.get_by_role('region', name='城の接続先と進軍路', exact=True)
    panel.get_by_role('button', name='稲葉山城を地図で確認', exact=True).click()
    expect(panel).to_contain_text('稲葉山城の接続先')
    page.wait_for_function("window.__logisticsRoutes.segments.every(s=>s.sourceId==='inabayama')")
    own_row = panel.locator('.tenka-route-row').filter(has=page.get_by_role('button', name='清洲城を地図で確認', exact=True))
    expect(own_row).to_contain_text('清洲城 → 稲葉山城')
    own_row.get_by_role('button', name='この道で出陣', exact=True).click()
    dialog = page.get_by_role('dialog', name='稲葉山城 攻略の軍議', exact=True)
    expect(dialog).to_be_visible()
    passed(f'{width}px: selected graph roads, all-route toggle, named castle/battle selection and typed 600-soldier gathering persist with exact resources and source castle orders')
    return restored, dialog


def supply_choices(page, dialog, state, width, shots, passed, defending=False):
    region = dialog.get_by_role('region', name='合戦に持ち込む兵糧', exact=True)
    quantity = region.get_by_role('spinbutton', name='合戦に持ち込む兵糧の数量', exact=True)
    start_name = 'この兵糧で籠城を指揮する' if defending else '戦場で采配する'
    start = dialog.get_by_role('button', name=start_name, exact=True)
    initial_value = int(quantity.input_value())
    assert initial_value > 200
    quantity.fill(''); expect(start).to_be_disabled()
    expect(region).to_contain_text('整数で指定')
    quantity.fill(str(state['food'] + 1)); expect(start).to_be_disabled()
    quantity.fill('200.5'); expect(start).to_be_disabled()
    quantity.fill('200'); expect(start).to_be_enabled()
    no_overflow(page, region)
    region.screenshot(path=str(shots / f'{width}-{"defense" if defending else "offense"}-supply-200.png'))
    passed(f'{width}px: {"defensive" if defending else "offensive"} ration choice rejects blank, fractional and excess quantities and accepts explicit 200 instead of recommended {initial_value}')
    return start


def actual_battle(page, start, width, shots, passed, defending=False):
    start.click()
    battle = page.get_by_test_id('tactical-battle')
    expect(battle).to_have_attribute('data-phase', 'deployment', timeout=60000)
    expect(page.locator('.tactical-canvas canvas')).to_be_visible(timeout=60000)
    expect(page.locator('.tactical-graphics-error')).to_have_count(0)
    page.wait_for_function('!!window.__logisticsBattle')
    state = page.evaluate('window.__logisticsBattle')
    assert state['carriedSupply'] == 200
    assert bool(state.get('defending')) == defending
    assert state['mode'] == ('siege' if defending else 'field')
    status = page.get_by_role('region', name='部隊の疲労・隊列と戦い方', exact=True)
    expect(status).to_be_visible()
    expect(status).to_contain_text('疲労'); expect(status).to_contain_text('隊列'); expect(status).to_contain_text('戦闘態勢')
    expect(status.get_by_role('button', name='休息', exact=True)).to_be_visible()
    expect(status.get_by_role('button', name='迎撃', exact=True)).to_be_visible()
    no_overflow(page, status)
    page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-{"defense" if defending else "field"}-battle.png'))
    page.get_by_role('button', name='戦闘開始', exact=True).click()
    expect(battle).to_have_attribute('data-phase', 'fighting')
    status.get_by_role('button', name='休息', exact=True).click()
    expect(status.get_by_role('button', name='休息', exact=True)).to_have_attribute('aria-pressed', 'true')
    assert page.evaluate("window.__logisticsBattle.units.some(u=>u.side===(window.__logisticsBattle.playerSide||'attacker')&&u.stance==='rest')")
    passed(f'{width}px: real 3D {"siege defense" if defending else "field battle"} receives chosen 200 rations; readiness/fatigue/formation and player stance controls work')


def sea_routes(page, url, width, shots, passed):
    state = resume(page, url, 'sea')
    panel = page.get_by_role('region', name='城の接続先と進軍路', exact=True)
    expect(panel).to_contain_text('能島城の接続先')
    expect(panel).to_contain_text('海路')
    graph = page.evaluate('window.__logisticsRoutes')
    native_seas = {dest for dest in castle(state, 'noshima')['neighbors'] if castle(state, 'noshima')['routes'][dest] == 'sea'}
    assert {s['targetId'] for s in graph['segments'] if s['route'] == 'sea'} == native_seas
    assert all(s['dashed'] for s in graph['segments'] if s['route'] == 'sea')
    assert any(m['route'] == 'sea' and m['vertices'] > 0 for m in graph['meshes'])
    panel.screenshot(path=str(shots / f'{width}-sea-connections.png'))
    no_overflow(page, panel)
    passed(f'{width}px: native Noshima island connections show every sea destination and actual dashed sea geometry')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8063')
    parser.add_argument('--screenshots', default='/tmp/tenka-campaign-logistics')
    parser.add_argument('--widths', default='1440,390')
    args = parser.parse_args()
    shots = Path(args.screenshots); shots.mkdir(parents=True, exist_ok=True)
    url = args.url.rstrip('/') + '/'
    html = instrumented_html(); checks, errors = [], []

    def passed(message):
        checks.append(message); print('PASS: ' + message, flush=True)
        (shots / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, ensure_ascii=False, indent=2))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in map(int, args.widths.split(',')):
            context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
            # This regression exercises the optional production WebGL battle renderer.
            context.add_init_script("localStorage.setItem('tenka-battle-renderer', '3d')")
            context.set_default_navigation_timeout(60000); context.set_default_timeout(30000)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.route(url, lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            try:
                state, dialog = map_and_gather(page, url, width, shots, passed)
                dialog.get_by_role('button', name='野戦', exact=True).click()
                start = supply_choices(page, dialog, state, width, shots, passed)
                if width > 600:
                    actual_battle(page, start, width, shots, passed)
                state = resume(page, url, 'defense')
                expect(page.get_by_test_id('tactical-battle')).to_have_count(0)
                page.get_by_role('button', name='籠城を指揮する', exact=True).click()
                dialog = page.get_by_role('dialog', name='清洲城 籠城の軍議', exact=True)
                expect(dialog).to_be_visible(); expect(page.get_by_test_id('tactical-battle')).to_have_count(0)
                start = supply_choices(page, dialog, state, width, shots, passed, defending=True)
                if width <= 600:
                    actual_battle(page, start, width, shots, passed, defending=True)
                else:
                    sea_routes(page, url, width, shots, passed)
            except Exception:
                page.screenshot(path=str(shots / f'{width}-failure.png'))
                (shots / 'failure.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, ensure_ascii=False, indent=2))
                raise
            finally:
                context.close()
        browser.close()
    assert not errors, errors
    print(json.dumps({'checks': checks, 'browser_errors': errors, 'screenshots': str(shots)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
