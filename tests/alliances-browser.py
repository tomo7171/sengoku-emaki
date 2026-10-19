#!/usr/bin/env python3
"""Exercise officer stationing and both directions of allied aid in the real UI.

Fixtures use valid campaign saves and the shipped aid queue. The actual native
war adapter, UI actions, resource accounting and 3D battle renderer run without
mocks. Renderer observations are injected into the test response only.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy']


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
const allianceTestRenderer=G_;
G_=(mount,options)=>{
 const renderer=allianceTestRenderer(mount,options),update=renderer.update;
 window.__allianceBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__allianceBattle=battle;return update(battle,...rest);};
 return renderer;
};
"""
    return html.replace(marker, observe + marker, 1)


FIXTURE = """kind=>{
 const G=window.TenkaGame,A=window.TenkaAllies;
 let s=G.newGame();s.selectedCastleId='kiyosu';s.gold=100000;s.food=100000;
 s.alliances=['matsudaira'];s.allianceExpires={matsudaira:s.turn+4};s.relations.matsudaira=80;
 const setArmy=(id,units)=>{const c=s.castles.find(c=>c.id===id);c.troops=Object.values(units).reduce((a,b)=>a+b,0);s.armies[id].units={...units};c.food=100000;c.gold=100000;};
 const units=(ashigaru,archer=0,cavalry=0,firearm=0)=>({ashigaru,archer,cavalry,firearm,navy:0});
 setArmy('kiyosu',units(2600,800,400,1200));setArmy('inuyama',units(1500,600,500,600));
 setArmy('okazaki',units(3500,1000,500));setArmy('iwamura',units(1600,600));
 if(kind==='outgoing-defense')s.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:'saito'};
 if(kind==='outgoing-field')s.selectedCastleId='inabayama';
 s=G.migrate(s);
 if(kind==='incoming-send'||kind==='incoming-decline'){
  const defense=kind==='incoming-decline';
  if(!A.queueWar(s,defense?'iwamura':'okazaki',defense?'okazaki':'iwamura','siege'))throw Error('Native allied war must queue');
 }
 if(!G.validate(s)||!G.save(s))throw Error('Alliance campaign fixture must validate and save');
 return s;
}"""

CHOOSE_POSITION = """id=>{
 const b=window.__allianceBattle,u=b.units.find(u=>u.id===id),T=window.TenkaTactics;
 const choices=(b.playerSide||'attacker')==='defender'?[[150,-160],[-150,-160],[u.x+12,u.z-10]]:[[150,150],[-150,150],[u.x+12,u.z+10]];
 for(const[x,z]of choices)if(T.deploy(b,{unitId:id,x,z}).ok)return{x,z};
 throw Error('No legal allied deployment point');
}"""


def castle(state, castle_id):
    return next(c for c in state['castles'] if c['id'] == castle_id)


def remaining(state, castle_id):
    return state['tenka']['castleOrders']['castles'][castle_id]['remaining']


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def resume(page, url, kind=None):
    if page.url == 'about:blank':
        page.goto(url, wait_until='domcontentloaded')
    elif not kind:
        page.reload(wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame')
    initial = page.evaluate(FIXTURE, kind) if kind else None
    if kind:
        page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    return initial


def no_overflow(page, region):
    metrics = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    assert metrics['scroll'] <= metrics['width'] + 1, metrics
    bad = region.locator('select,input,button').evaluate_all("""nodes=>nodes.flatMap(node=>{
 const r=node.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{name:node.getAttribute('aria-label')||node.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not bad, bad


def station_officer(page, url, width, shots, passed):
    before = resume(page, url, 'station')
    assert before['armies']['kiyosu']['commanderId'] == 'oda_nobunaga'
    page.get_by_role('button', name='評定を開く', exact=True).click()
    council = page.locator('.tenka-council')
    council.get_by_role('button', name='家臣', exact=True).click()
    row = council.locator('.tenka-station-person[data-officer-id="oda_nobunaga"]')
    expect(row).to_contain_text('現在の城：清洲城')
    select = row.get_by_role('combobox', name='織田信長の配置先の城', exact=True)
    button = row.get_by_role('button', name='織田信長を城に配置', exact=True)
    expect(select).to_have_value(''); expect(button).to_be_disabled()
    select.select_option('inuyama'); expect(button).to_be_enabled(); button.click()
    expect(row).to_contain_text('現在の城：犬山城')
    page.wait_for_function("window.TenkaGame.load().officers.find(o=>o.id==='oda_nobunaga').castleId==='inuyama'")
    after = saved(page)
    assert after['armies']['kiyosu']['commanderId'] is None
    assert after['armies']['inuyama']['commanderId'] == before['armies']['inuyama']['commanderId']
    assert after['armies']['kiyosu']['units'] == before['armies']['kiyosu']['units']
    assert after['armies']['inuyama']['units'] == before['armies']['inuyama']['units']
    assert remaining(after, 'kiyosu') == remaining(before, 'kiyosu') - 1
    assert remaining(after, 'inuyama') == remaining(before, 'inuyama')
    no_overflow(page, row); row.screenshot(path=str(shots / f'{width}-officer-station.png'))
    resume(page, url)
    page.get_by_role('button', name='評定を開く', exact=True).click()
    page.locator('.tenka-council').get_by_role('button', name='家臣', exact=True).click()
    expect(page.locator('.tenka-station-person[data-officer-id="oda_nobunaga"]')).to_contain_text('現在の城：犬山城')
    assert remaining(saved(page), 'kiyosu') == remaining(after, 'kiyosu')
    passed(f'{width}px: explicit officer stationing preserves garrisons/destination commander, debits source castle, survives reload')


def incoming_aid(page, url, width, shots, passed, send):
    before = resume(page, url, 'incoming-send' if send else 'incoming-decline')
    pending = before['tenka']['allies']['pending'][0]
    page.get_by_role('button', name='援軍要請を確認', exact=True).click()
    dialog = page.get_by_role('dialog', name='同盟国の援軍要請', exact=True)
    section = dialog.get_by_role('region', name='同盟国の援軍要請', exact=True)
    source = section.get_by_role('combobox', name='松平家への援軍の出兵元', exact=True)
    count = section.get_by_role('spinbutton', name='松平家への援軍の人数', exact=True)
    send_button = section.get_by_role('button', name='援軍を送る', exact=True)
    expect(source).to_have_value(''); expect(count).to_have_value(''); expect(send_button).to_be_disabled()
    initial = saved(page)
    assert initial['armies'] == before['armies'] and initial['food'] == before['food']
    assert initial['tenka']['allies']['pending'][0]['id'] == pending['id']
    if send:
        source.select_option('inuyama'); count.fill('700')
        expect(send_button).to_be_enabled()
        preview = page.evaluate("s=>window.TenkaAllies.preview(s,{requestId:s.tenka.allies.pending[0].id,sourceId:'inuyama',troops:700})", before)
        assert preview['ok'], preview
        no_overflow(page, section)
        section.screenshot(path=str(shots / f'{width}-incoming-send-choice.png'))
        send_button.click()
    else:
        section.get_by_role('button', name='援軍を断る', exact=True).click()
    page.wait_for_function('window.TenkaGame.load().tenka.allies.pending.length===0')
    after = saved(page); report = after['tenka']['allies']['reports'][0]
    assert len(after['aiBattles']) == 1 and report['battleId'] == after['aiBattles'][0]['id']
    war = after['aiBattles'][0]
    assert war['sourceId'] == pending['sourceId'] and war['targetId'] == pending['targetId']
    assert report['requestId'] == pending['id'] and report['decision'] == ('send' if send else 'decline')
    if send:
        assert report['troops'] == 700 and report['casualties'] + report['survivors'] == 700
        assert report['sourceId'] == 'inuyama' and report['casualtyUnits'] == war['supportLosses']
        assert war['supportArmy']['troops'] == 700 and war['supportArmy']['side'] == pending['side']
        assert castle(after, 'inuyama')['troops'] == castle(before, 'inuyama')['troops'] - report['casualties']
        for key in TYPES:
            assert after['armies']['inuyama']['units'][key] == before['armies']['inuyama']['units'][key] - report['casualtyUnits'][key]
        assert after['armies']['kiyosu'] == before['armies']['kiyosu']
        assert after['food'] == before['food'] - preview['foodCost'] and after['gold'] == before['gold'] - 120
        assert remaining(after, 'inuyama') == remaining(before, 'inuyama') - 1
        assert remaining(after, 'kiyosu') == remaining(before, 'kiyosu')
        assert after['relations']['matsudaira'] == before['relations']['matsudaira'] + 5
    else:
        assert after['relations']['matsudaira'] == before['relations']['matsudaira'] - 15
        assert after['food'] == before['food'] and after['gold'] == before['gold']
        for key in ['kiyosu', 'inuyama']:
            assert after['armies'][key] == before['armies'][key]
            assert remaining(after, key) == remaining(before, key)
        duplicate = page.evaluate("({s,id})=>{const result=window.TenkaAllies.act(s,{type:'decline',requestId:id});return{ok:result.ok,state:result.state};}", {'s': after, 'id': pending['id']})
        assert not duplicate['ok'] and duplicate['state'] == after
    expect(section.locator('.tenka-aid-request')).to_have_count(0)
    section.locator('.tenka-aid-history summary').click()
    expect(section.locator('.tenka-aid-history')).to_contain_text(report['message'])
    no_overflow(page, section)
    section.screenshot(path=str(shots / f'{width}-incoming-{report["decision"]}-result.png'))
    resume(page, url)
    restored = saved(page)
    assert restored['tenka']['allies']['reports'][0] == report
    assert restored['relations']['matsudaira'] == after['relations']['matsudaira']
    assert restored['tenka']['allies']['pending'] == [] and len(restored['aiBattles']) == 1
    if send:
        page.get_by_role('button', name='評定を開く', exact=True).click()
        council = page.locator('.tenka-council')
        council.get_by_role('button', name='外交', exact=True).click()
        history = council.get_by_role('region', name='同盟国の援軍要請', exact=True)
        history.locator('.tenka-aid-history summary').click()
        expect(history.locator('.tenka-aid-history')).to_contain_text(report['message'])
        outgoing = council.get_by_role('region', name='同盟国へ援軍を要請', exact=True)
        context_picker = outgoing.get_by_role('combobox', name='援軍を要請する戦場', exact=True)
        expect(context_picker).to_have_value('')
        context_id = page.evaluate("s=>window.TenkaAllies.getSupportView(s).contexts.find(c=>c.sourceId==='kiyosu'&&c.targetId==='inabayama'&&c.mode==='siege').id", restored)
        context_picker.select_option(context_id)
        expect(outgoing).to_contain_text('清洲城 → 稲葉山城 ／ 攻城・籠城戦')
        expect(outgoing.get_by_role('combobox', name='援軍を頼む同盟国の城', exact=True)).to_have_value('')
        expect(outgoing.get_by_role('spinbutton', name='同盟国に要請する援軍の人数', exact=True)).to_have_value('')
        expect(outgoing.get_by_role('button', name='この人数で援軍を要請する', exact=True)).to_be_disabled()
        no_overflow(page, outgoing)
        outgoing.screenshot(path=str(shots / f'{width}-council-aid-context.png'))
        assert saved(page)['tenka']['allies']['committed'] == []
    passed(f'{width}px: incoming {pending["side"]} request waits for a choice; ' + ('chosen 700 troops fight, lose soldiers, return and persist with exact costs' if send else 'refusal resolves its native war once, costs friendship 15 and spends no player troops/orders'))


def outgoing_aid(page, url, width, shots, passed, defending=False):
    before = resume(page, url, 'outgoing-defense' if defending else 'outgoing-field')
    mode = 'defense' if defending else 'field'
    if defending:
        page.get_by_role('button', name='同盟国へ援軍を要請', exact=True).click()
        dialog = page.get_by_role('dialog', name='同盟国へ援軍を要請', exact=True)
    else:
        page.get_by_role('button', name='稲葉山城へ出陣', exact=True).click()
        page.get_by_role('button', name='野戦', exact=True).click()
        dialog = page.get_by_role('dialog', name='稲葉山城 攻略の軍議', exact=True)
    section = dialog.get_by_role('region', name='同盟国へ援軍を要請', exact=True)
    expect(section.get_by_role('combobox', name='援軍を要請する戦場', exact=True)).to_have_count(0)
    source = section.get_by_role('combobox', name='援軍を頼む同盟国の城', exact=True)
    count = section.get_by_role('spinbutton', name='同盟国に要請する援軍の人数', exact=True)
    request = section.get_by_role('button', name='この人数で援軍を要請する', exact=True)
    expect(source).to_have_value(''); expect(count).to_have_value(''); expect(request).to_be_disabled()
    source.select_option('okazaki'); count.fill('900'); expect(request).to_be_enabled()
    no_overflow(page, section)
    section.screenshot(path=str(shots / f'{width}-outgoing-{mode}-choice.png'))
    request.click()
    page.wait_for_function('window.TenkaGame.load().tenka.allies.committed.length===1')
    reserved = saved(page); support = reserved['tenka']['allies']['committed'][0]
    assert support['sourceId'] == 'okazaki' and support['troops'] == 900 and support['defending'] == defending
    assert support['battleSourceId'] == ('inabayama' if defending else 'kiyosu')
    assert support['targetId'] == ('kiyosu' if defending else 'inabayama')
    assert support['mode'] == ('siege' if defending else 'field')
    assert castle(reserved, 'okazaki')['troops'] == castle(before, 'okazaki')['troops'] - 900
    assert castle(reserved, 'okazaki')['food'] == castle(before, 'okazaki')['food'] - support['foodCost']
    assert castle(reserved, 'okazaki')['gold'] == castle(before, 'okazaki')['gold'] - support['goldCost']
    assert reserved['food'] == before['food'] and reserved['gold'] == before['gold']
    for key in ['kiyosu', 'inuyama']:
        assert reserved['armies'][key] == before['armies'][key] and remaining(reserved, key) == remaining(before, key)
    expect(section.locator('.tenka-aid-committed')).to_contain_text('900 人')
    if defending:
        dialog.get_by_role('button', name='閉じる', exact=True).click()
        page.get_by_role('button', name='籠城を指揮する', exact=True).click()
    else:
        page.get_by_role('button', name='戦場で采配する', exact=True).click()
    battle = page.get_by_test_id('tactical-battle')
    expect(battle).to_have_attribute('data-phase', 'deployment', timeout=30000)
    expect(page.locator('.tactical-canvas canvas')).to_be_visible()
    expect(page.locator('.tactical-graphics-error')).to_have_count(0)
    data = page.evaluate('window.__allianceBattle')
    guests = [unit for unit in data['units'] if unit.get('foreignSupport')]
    assert guests and sum(unit['troops'] for unit in guests) == 900
    for key in TYPES:
        assert sum(unit['troops'] for unit in guests if unit['type'] == key) == support['units'][key]
    unit = guests[0]
    assert unit['supportClan'] == 'matsudaira' and unit['supportCastleId'] == 'okazaki'
    toolbar = page.locator('.tenka-deployment')
    toolbar.get_by_role('combobox', name='配置する部隊', exact=True).select_option(unit['id'])
    expect(page.locator('.selected-unit-title')).to_contain_text(unit['commanderName'])
    expect(page.locator('.tactical-unit-editor')).to_contain_text('同盟国の援軍です')
    expect(page.get_by_role('combobox', name='部隊の兵科', exact=True)).to_be_disabled()
    expect(page.get_by_role('combobox', name='部隊の将', exact=True)).to_be_disabled()
    expect(page.get_by_role('combobox', name='部隊の兵科', exact=True).locator('option:checked')).to_contain_text('同盟国の編制')
    expect(page.get_by_role('combobox', name='部隊の将', exact=True).locator('option:checked')).to_contain_text(unit['commanderName'] + '（同盟国）')
    expect(page.get_by_role('spinbutton', name='部隊の人数', exact=True)).to_be_disabled()
    expect(page.get_by_role('spinbutton', name='部隊の人数', exact=True)).to_have_value(str(unit['troops']))
    expect(page.get_by_role('spinbutton', name='配置X', exact=True)).to_be_enabled()
    expect(page.get_by_role('spinbutton', name='配置Z', exact=True)).to_be_enabled()
    expect(page.get_by_role('button', name='配置を適用', exact=True)).to_be_enabled()
    position = page.evaluate(CHOOSE_POSITION, unit['id'])
    toolbar.get_by_role('spinbutton', name='部隊の東西座標', exact=True).fill(str(position['x']))
    toolbar.get_by_role('spinbutton', name='部隊の南北座標', exact=True).fill(str(position['z']))
    toolbar.get_by_role('button', name='この位置へ配置', exact=True).click()
    selected = page.get_by_test_id('tactical-unit-' + unit['id'])
    expect(selected).to_have_attribute('data-x', str(position['x']))
    expect(selected).to_have_attribute('data-z', str(position['z']))
    placed = page.evaluate('id=>window.__allianceBattle.units.find(u=>u.id===id)', unit['id'])
    for key in ['troops', 'type', 'commanderName', 'supportClan', 'supportCastleId']:
        assert placed[key] == unit[key]
    no_overflow(page, page.locator('.tactical-unit-editor'))
    page.locator('.tactical-unit-editor').screenshot(path=str(shots / f'{width}-allied-{mode}-readonly-editor.png'))
    page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-allied-{mode}-battle.png'))
    page.get_by_role('button', name='戦闘開始', exact=True).click()
    expect(battle).to_have_attribute('data-phase', 'fighting')
    assert page.evaluate('window.__allianceBattle.units.some(u=>u.foreignSupport&&u.side===window.__allianceBattle.playerSide)')
    expect(page.locator('.tactical-graphics-error')).to_have_count(0)
    passed(f'{width}px: outgoing {mode} request reserves exactly 900 allied soldiers; real 3D guests retain identity/roster and accept player deployment')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8060')
    parser.add_argument('--screenshots', default='/tmp/tenka-alliances-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--scenarios', default='station,send,decline,field,defense')
    args = parser.parse_args()
    shots = Path(args.screenshots); shots.mkdir(parents=True, exist_ok=True)
    url = args.url.rstrip('/') + '/'
    html = instrumented_html(); checks, errors = [], []

    def passed(message):
        checks.append(message); print('PASS: ' + message, flush=True)
        (shots / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors, 'screenshots': str(shots)}, ensure_ascii=False, indent=2))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in map(int, args.widths.split(',')):
            context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
            # This regression exercises the optional production WebGL battle renderer.
            context.add_init_script("localStorage.setItem('tenka-battle-renderer', '3d')")
            # Software WebGL may compile the national map again on reload.
            context.set_default_navigation_timeout(60000)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.route(url, lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            try:
                scenarios = args.scenarios.split(',')
                if 'station' in scenarios:
                    station_officer(page, url, width, shots, passed)
                if 'send' in scenarios:
                    incoming_aid(page, url, width, shots, passed, send=True)
                if 'decline' in scenarios:
                    incoming_aid(page, url, width, shots, passed, send=False)
                if 'field' in scenarios:
                    outgoing_aid(page, url, width, shots, passed)
                if width > 600 and 'defense' in scenarios:
                    outgoing_aid(page, url, width, shots, passed, defending=True)
            except Exception:
                page.screenshot(path=str(shots / f'{width}-failure.png'))
                raise
            finally:
                context.close()
        browser.close()
    assert not errors, errors
    print(json.dumps({'checks': checks, 'browser_errors': errors, 'screenshots': str(shots)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
