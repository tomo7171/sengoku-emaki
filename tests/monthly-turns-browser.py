#!/usr/bin/env python3
"""Exercise monthly government, castle rosters, and player-planned battle turns.

Uses valid native campaign saves and the actual React interface, 2D renderer,
commands, battle turns, replay verification, settlement and storage. Only the
unrelated nationwide Three.js map is replaced by a no-op, to keep repeated
battle fixtures independent of GPU compilation. No battle or campaign command
is mocked or auto-executed; instrumentation only observes rendered battles.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
NAMES = {'ashigaru': '足軽', 'archer': '弓', 'cavalry': '騎馬', 'firearm': '鉄砲', 'navy': '水軍'}
FIXTURE = """mode=>{
 const G=window.TenkaGame;let s=G.newGame();s.selectedCastleId=mode==='economy'?'kiyosu':'inabayama';s.gold=100000;s.food=1000000;
 for(const c of s.castles){c.gold=0;c.food=0;}
 const home=s.castles.find(c=>c.id==='kiyosu'),enemy=s.castles.find(c=>c.id==='inabayama');
 Object.assign(home,{gold:100000,food:100000,troops:5000,population:100000,kokudaka:100000});
 Object.assign(enemy,{gold:100000,food:100000,troops:mode==='defense'?1000:40,morale:40,defense:10});
 s.armies.kiyosu.units={ashigaru:4000,archer:1000,cavalry:0,firearm:0,navy:0};
 s.armies.inabayama.units={ashigaru:enemy.troops,archer:0,cavalry:0,firearm:0,navy:0};
 for(const o of s.officers)if(o.clan===s.playerClan&&o.status==='active'&&s.year-o.birth>=15)o.castleId='kiyosu';
 for(const c of s.castles.filter(c=>c.clan===s.playerClan))s.armies[c.id].commanderId=null;
 s.armies.kiyosu.commanderId='oda_nobunaga';
 if(mode==='economy'){enemy.gold=0;enemy.food=0;}
 if(mode==='defense')s.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:enemy.clan};
 s=G.migrate(s);if(!G.validate(s)||!G.save(s))throw Error('Monthly fixture must validate and save: '+mode);return s;
}"""


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
Mv=()=>new Proxy({},{get:()=>()=>{}});
const monthly2D=window.TenkaBattle2D;
window.TenkaBattle2D={...monthly2D,create:(mount,options)=>{
 const renderer=monthly2D.create(mount,options),update=renderer.update;
 window.__monthlyRenderer=renderer;window.__monthlyBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__monthlyBattle=battle;return update(battle,...rest);};return renderer;
}};
"""
    bootstrap = "\nconst fixtureKind=new URLSearchParams(location.search).get('monthlyFixture');if(fixtureKind){(" + FIXTURE + ")(fixtureKind);history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker, observe + bootstrap + marker, 1)


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def remaining(state, castle):
    return state['tenka']['castleOrders']['castles'][castle]['remaining']


def no_overflow(page, region):
    metrics = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    assert metrics['scroll'] <= metrics['width'] + 1, metrics
    bad = region.locator('button,input,select').evaluate_all("""nodes=>nodes.flatMap(node=>{
 const r=node.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{name:node.getAttribute('aria-label')||node.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not bad, bad


def resume(page, url, kind):
    print('STEP load: ' + kind, flush=True)
    page.goto(url + '?monthlyFixture=' + kind, wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame&&!!window.TenkaTurnUI&&!!window.TenkaCalendar')
    before = saved(page)
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    return before


def government(page, url, width, shots, passed):
    before = resume(page, url, 'economy')
    assert before['month'] == 3
    page.get_by_role('button', name='評定を開く', exact=True).click()
    panel = page.locator('.tenka-council')
    expect(panel).to_contain_text('1560年3月')
    estate = panel.get_by_role('region', name='領国の経営計画', exact=True)
    for text in ['田畑の被害', '治水', '飢饉', '疫病', '民心']:
        expect(estate).to_contain_text(text)
    estate.get_by_text('兵科ごとの毎月の軍給・兵糧支給', exact=True).click()
    expect(estate.get_by_role('table', name='兵科ごとの月額維持費', exact=True)).to_be_visible()
    comparison = page.evaluate("""s=>{
 const S=window.TenkaSystems,base=S.getView(s).castles.find(c=>c.id==='kiyosu').economy.forecast;
 const more=JSON.parse(JSON.stringify(s));more.castles.find(c=>c.id==='kiyosu').troops+=1000;more.armies.kiyosu.units.ashigaru+=1000;
 const grown=S.getView(more).castles.find(c=>c.id==='kiyosu').economy.forecast;
 return{base,grown};
}""", before)
    assert comparison['grown']['militaryUpkeep'] > comparison['base']['militaryUpkeep']
    assert comparison['grown']['foodUpkeep'] > comparison['base']['foodUpkeep']
    assert comparison['grown']['netIncome'] < comparison['base']['netIncome']
    page.get_by_role('combobox', name='評定の担当武将', exact=True).select_option('oda_nobunaga')
    water_before = before['tenka']['estates']['kiyosu']['waterControl']
    estate.get_by_role('button', name='堤防と用水路を整備する', exact=True).click()
    page.wait_for_function('v=>window.TenkaGame.load().tenka.estates.kiyosu.waterControl>v', arg=water_before)
    page.get_by_role('combobox', name='評定の担当武将', exact=True).select_option('shibata_katsuie')
    estate.get_by_role('button', name='衛生と医療を整える', exact=True).click()
    page.wait_for_function("window.TenkaGame.load().tenka.assignments.shibata_katsuie?.type==='sanitation'")
    acted = saved(page)
    assert remaining(acted, 'kiyosu') == 1 and remaining(acted, 'inuyama') == 3
    no_overflow(page, estate)
    estate.locator('.tenka-estate-harvest').screenshot(path=str(shots / f'{width}-disaster-economy.png'))
    panel.get_by_role('button', name='次の月へ →', exact=True).click()
    page.wait_for_function('window.TenkaGame.load().month===4')
    advanced = saved(page)
    assert advanced['turn'] == before['turn'] + 1 and advanced['season'] == before['season']
    assert remaining(advanced, 'kiyosu') == 3 and remaining(advanced, 'inuyama') == 3
    expect(panel).to_contain_text('1560年4月')
    passed(f'{width}px: March to April, independent monthly castle-order refresh, wages/food scale with troops, disaster indicators and actual waterworks/sanitation commands')
    panel.get_by_role('button', name='家臣', exact=True).click()
    roster = panel.get_by_role('region', name='武将の城への配置', exact=True)
    roster.get_by_role('combobox', name='武将の所属城で絞り込む', exact=True).select_option('kiyosu')
    roster.get_by_role('searchbox', name='配置する武将を検索', exact=True).fill('柴田')
    expect(roster.get_by_role('region', name='清洲城の家臣一覧', exact=True)).to_be_visible()
    roster.get_by_role('combobox', name='柴田勝家の配置先の城', exact=True).select_option('inuyama')
    roster.get_by_role('button', name='柴田勝家を城に配置', exact=True).click()
    page.wait_for_function("window.TenkaGame.load().officers.find(o=>o.id==='shibata_katsuie').castleId==='inuyama'")
    stationed = saved(page)
    assert remaining(stationed, 'kiyosu') == 2 and remaining(stationed, 'inuyama') == 3
    roster.get_by_role('combobox', name='武将の所属城で絞り込む', exact=True).select_option('inuyama')
    expect(roster.get_by_role('region', name='犬山城の家臣一覧', exact=True)).to_contain_text('柴田勝家')
    no_overflow(page, roster)
    roster.screenshot(path=str(shots / f'{width}-castle-roster.png'))
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    restored = saved(page)
    assert restored['month'] == 4 and remaining(restored, 'kiyosu') == 2
    assert next(o for o in restored['officers'] if o['id'] == 'shibata_katsuie')['castleId'] == 'inuyama'
    passed(f'{width}px: castle-grouped retainer list, search and explicit stationing; source budget and saved month/roster survive reload')


def deploy_unit(page, toolbar, unit_id):
    toolbar.get_by_role('combobox', name='配置する部隊', exact=True).select_option(unit_id)
    point = page.evaluate("""id=>{
 const b=window.__monthlyBattle,T=window.TenkaTactics,u=b.units.find(u=>u.id===id),zone=T.deploymentZone(b),rear=(b.playerSide==='defender'?zone.zMax-6:zone.zMin+6);
 for(const[x,z]of[[u.x,rear],[u.x+8,rear],[u.x-8,rear],[u.x+8,u.z+8],[u.x-8,u.z+8],[u.x+12,u.z],[u.x,u.z]])if(T.deploy(b,{unitId:id,x,z}).ok)return{x,z};
 throw Error('No legal deployment coordinate');
}""", unit_id)
    toolbar.get_by_role('spinbutton', name='部隊の東西座標', exact=True).fill(str(point['x']))
    toolbar.get_by_role('spinbutton', name='部隊の南北座標', exact=True).fill(str(point['z']))
    toolbar.get_by_role('button', name='この位置へ配置', exact=True).click()
    page.wait_for_function("p=>{const u=window.__monthlyBattle.units.find(u=>u.id===p.id);return u.deployedConfirmed&&Math.abs(u.x-p.x)<.01&&Math.abs(u.z-p.z)<.01;}", arg={**point, 'id': unit_id})


def combat(page, url, width, mode, shots, passed):
    before = resume(page, url, mode)
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
    page.wait_for_function("window.__monthlyBattle?.controlMode==='turns'")
    toolbar = battle.get_by_role('region', name='部隊と陣・柵の自由配置', exact=True)
    start = battle.get_by_role('button', name='戦闘開始', exact=True)
    expect(start).to_be_disabled()
    units = page.evaluate("window.__monthlyBattle.units.filter(u=>u.side===(window.__monthlyBattle.playerSide||'attacker')&&!u.foreignSupport).map(u=>({id:u.id,type:u.type}))")
    assert len(units) == 2, units
    for unit, commander in zip(units, ['oda_nobunaga', 'shibata_katsuie']):
        toolbar.get_by_role('combobox', name=NAMES[unit['type']] + '部隊の指揮武将', exact=True).select_option(commander)
    expect(start).to_be_disabled()
    for unit in units:
        deploy_unit(page, toolbar, unit['id'])
    expect(start).to_be_enabled()
    no_overflow(page, toolbar)
    toolbar.screenshot(path=str(shots / f'{width}-{mode}-player-deployment.png'))
    passed(f'{width}px {mode}: missing commanders/placement block start; distinct real officers and player-selected coordinates confirm every troop type')
    start.click()
    expect(battle).to_have_attribute('data-phase', 'fighting')
    turn = battle.get_by_test_id('turn-orders')
    expect(turn).to_be_visible()
    frozen = page.evaluate('JSON.stringify(window.__monthlyBattle)')
    page.wait_for_timeout(650)
    assert page.evaluate('JSON.stringify(window.__monthlyBattle)') == frozen, 'idle rendering must never execute a combat turn'
    turn.locator('.tenka-turn-roster button').first.click()
    selected = page.evaluate('window.TenkaTactics.turnView(window.__monthlyBattle).units[0]')
    point = page.evaluate("""id=>{
 const b=window.__monthlyBattle,T=window.TenkaTactics,u=b.units.find(u=>u.id===id);
 for(const[x,z]of[[u.x+5,u.z],[u.x-5,u.z],[u.x,u.z+5],[u.x,u.z-5]])if(T.order(b,{unitId:id,order:'move',x,z}).ok)return{x,z};
 throw Error('No legal planned move');
}""", selected['id'])
    turn.get_by_role('spinbutton', name='ターン移動先の東西', exact=True).fill(str(point['x']))
    turn.get_by_role('spinbutton', name='ターン移動先の南北', exact=True).fill(str(point['z']))
    canonical = page.evaluate('({time:window.__monthlyBattle.time,supply:window.__monthlyBattle.supply,units:window.__monthlyBattle.units.map(u=>({id:u.id,x:u.x,z:u.z,troops:u.troops}))})')
    turn.get_by_role('button', name='移動を計画', exact=True).click()
    planned = page.evaluate('({time:window.__monthlyBattle.time,supply:window.__monthlyBattle.supply,units:window.__monthlyBattle.units.map(u=>({id:u.id,x:u.x,z:u.z,troops:u.troops}))})')
    assert planned == canonical, 'planning cannot move soldiers or consume food'
    assert page.evaluate("id=>{const b=window.__monthlyBattle;return b.ledger.at(-1).kind==='turn-order'&&!!b.units.find(u=>u.id===id).turnPlan.move;}", selected['id'])
    no_overflow(page, turn)
    turn.screenshot(path=str(shots / f'{width}-{mode}-planned-turn.png'))
    turn.get_by_role('button', name='このターンを実行', exact=True).click()
    page.wait_for_function('window.__monthlyBattle.turnNumber===2')
    executed = page.evaluate('window.__monthlyBattle')
    assert executed['time'] > canonical['time']
    assert executed['supply'][executed.get('playerSide', 'attacker')]['consumed'] > canonical['supply'][executed.get('playerSide', 'attacker')]['consumed']
    before_positions = {u['id']: u for u in canonical['units']}
    rules = page.evaluate('window.TenkaTactics.turnRules')
    for unit in executed['units']:
        previous = before_positions[unit['id']]
        assert ((unit['x'] - previous['x']) ** 2 + (unit['z'] - previous['z']) ** 2) ** .5 <= rules[unit['type']]['movement'] * 1.5 + .1
    frozen = page.evaluate('JSON.stringify(window.__monthlyBattle)')
    page.wait_for_timeout(500)
    assert page.evaluate('JSON.stringify(window.__monthlyBattle)') == frozen
    passed(f'{width}px {mode}: no idle movement, planning leaves time/food/positions unchanged, explicit turn advances both armies within troop movement budgets')
    # Plan each contingent's retreat through the normal battle buttons. The
    # explicit turn button still controls every step, so the final report stays
    # on screen for its acknowledgement instead of the close-dialog shortcut.
    for unit in units:
        battle.get_by_test_id('tactical-unit-' + unit['id']).click()
        battle.locator('.tactical-order-bar').get_by_role('button', name='退却', exact=True).click()
    for _ in range(80):
        if battle.get_attribute('data-phase') == 'finished':
            break
        previous_turn = page.evaluate('window.__monthlyBattle.turnNumber')
        turn.get_by_role('button', name='このターンを実行', exact=True).click()
        page.wait_for_function("number=>window.__monthlyBattle.phase==='finished'||window.__monthlyBattle.turnNumber>number", arg=previous_turn)
    expect(battle).to_have_attribute('data-phase', 'finished')
    settlement = page.get_by_test_id('battle-settlement')
    expect(settlement).to_have_attribute('data-status', 'confirmed', timeout=120000)
    after = saved(page)
    assert after['lastBattle'] and after['lastBattle']['tactical']
    assert after['lastBattle']['mode'] == ('siege' if mode == 'defense' else mode)
    no_overflow(page, settlement)
    settlement.screenshot(path=str(shots / f'{width}-{mode}-settled.png'))
    if battle.count():
        settlement.get_by_role('button', name='結果を確認して評定へ', exact=True).click()
    expect(battle).to_have_count(0)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    restored = saved(page)
    assert restored['lastBattle']['id'] == after['lastBattle']['id']
    assert restored['food'] == after['food']
    assert restored['month'] == before['month']
    passed(f'{width}px {mode}: explicit retreat replays/settles, visible result, campaign return and valid report/supply save-reload')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8065')
    parser.add_argument('--screenshots', default='/tmp/tenka-monthly-turns-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--modes', default='field,siege,defense')
    parser.add_argument('--only', choices=['government', 'combat'])
    args = parser.parse_args()
    shots = Path(args.screenshots); shots.mkdir(parents=True, exist_ok=True)
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
                if args.only != 'combat': government(page, url, width, shots, passed)
                if args.only != 'government':
                    for mode in args.modes.split(','): combat(page, url, width, mode, shots, passed)
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
