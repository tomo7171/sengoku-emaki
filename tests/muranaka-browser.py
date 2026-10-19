#!/usr/bin/env python3
"""Legacy real-time Muranaka records, settlement recovery and renderer switching.

Campaigns are valid native saves, and combat/capture/replay use the shipped
engines. Test instrumentation observes battle renderers and accelerates real
ticks. The unrelated campaign map renderer is isolated to avoid compiling its
nationwide scene in every battle fixture; the actual 2D/3D battle renderers run.
Only explicit settlement-error cases inject failed responses.
This compatibility harness explicitly selects the earlier real-time engine so
old battle ledgers, replay and renderer recovery remain covered. The separate
monthly-turns-browser.py suite exercises current live turn-based field, siege
and defensive battles; this harness does not replace those checks.
"""
import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    observe = """
window.__muranakaSettleCalls=0;window.__muranakaAccelerate=false;
Mv=()=>new Proxy({},{get:()=>()=>{}});
const muranakaSettle=ti,muranakaAdvance=ur,muranakaStart=ir;
// Test-only compatibility mode: preserve coverage of earlier real-time records.
const muranakaCreate=Xn,muranakaDefense=window.TenkaTactics.createDefense;
Xn=options=>muranakaCreate({...options,controlMode:undefined});
window.TenkaTactics.createDefense=(state,threat,options={})=>muranakaDefense(state,threat,{...options,controlMode:undefined});
ti=(state,battle)=>{
 window.__muranakaSettleCalls++;
 if(window.__muranakaSettlementFailure){
  const failure=window.__muranakaSettlementFailure;if(failure!=='permanent')window.__muranakaSettlementFailure=null;
  if(failure==='throw')throw Error('試験用：戦果の反映を再試行してください。');
  return{ok:false,state,message:'試験用：戦果の反映を再試行してください。'};
 }
 return muranakaSettle(state,battle);
};
ir=(...args)=>{const b=muranakaStart(...args);window.__muranakaBattle=b;return b;};
ur=(battle,delta)=>{
 const b=muranakaAdvance(battle,window.__muranakaAccelerate?2:delta);
 window.__muranakaBattle=b;return b;
};
const muranaka2D=window.TenkaBattle2D;
window.TenkaBattle2D={...muranaka2D,create:(mount,options)=>{
 const renderer=muranaka2D.create(mount,options),update=renderer.update;
 window.__muranaka2D=renderer;window.__muranakaBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__muranakaBattle=battle;return update(battle,...rest);};
 return renderer;
}};
const muranaka3D=G_;
G_=(mount,options)=>{
 if(window.__muranakaForce3DFailure){mount.appendChild(document.createElement('canvas'));throw Error('Test WebGL creation failure');}
 const renderer=muranaka3D(mount,options),update=renderer.update;
 window.__muranaka3D=renderer;window.__muranakaBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__muranakaBattle=battle;return update(battle,...rest);};
 return renderer;
};
"""
    fixture_bootstrap = "\nif(new URLSearchParams(location.search).has('muranakaFixture')){(" + FIXTURE + ")();history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker, observe + fixture_bootstrap + marker, 1)


FIXTURE = """()=>{
 const G=window.TenkaGame,S=window.TenkaSystems;
 let s=S.chooseClan(G.newGame(),'arima').state;
 s.gold=100000;s.food=100000;s.selectedCastleId='muranaka';
 // Keep unrelated NPC invasions out of a capture/proceed regression.
 for(const c of s.castles){c.gold=0;c.food=0;}
 const source=s.castles.find(c=>c.id==='hinoe'),target=s.castles.find(c=>c.id==='muranaka');
 Object.assign(source,{gold:100000,food:100000,troops:6000});
 Object.assign(target,{troops:40,morale:30,defense:5});
 s.armies.hinoe.units={ashigaru:4500,archer:500,cavalry:0,firearm:1000,navy:0};
 s.armies.muranaka.units={ashigaru:40,archer:0,cavalry:0,firearm:0,navy:0};
 s=G.migrate(s);
 if(!G.validate(s)||!G.save(s))throw Error('Muranaka fixture must validate and save');
 return s;
}"""


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def castle(state, key):
    return next(c for c in state['castles'] if c['id'] == key)


def orders(state):
    return state['tenka']['castleOrders']['castles']['hinoe']['remaining']


def no_overflow(page, region):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    outside = region.locator('button,input,select').evaluate_all("""nodes=>nodes.flatMap(node=>{
 const r=node.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{text:node.getAttribute('aria-label')||node.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not outside, outside


def open_battle(page, url, mode):
    print('STEP: load campaign for ' + mode, flush=True)
    page.goto(url + '?muranakaFixture=1', wait_until='domcontentloaded')
    print('STEP: campaign document ready', flush=True)
    page.wait_for_function('!!window.TenkaGame&&!!window.TenkaBattle2D')
    initial = saved(page)
    print('STEP: valid fixture saved', flush=True)
    page.get_by_role('button', name='有馬家の続きから遊ぶ', exact=True).click()
    print('STEP: campaign resumed', flush=True)
    page.get_by_role('button', name='村中城へ出陣', exact=True).click()
    print('STEP: council opened', flush=True)
    council = page.get_by_role('dialog', name='村中城 攻略の軍議', exact=True)
    council.get_by_role('button', name='野戦' if mode == 'field' else re.compile('^攻城戦')).click()
    council.get_by_role('button', name='戦場で采配する', exact=True).click()
    print('STEP: tactical battle opened', flush=True)
    battle = page.get_by_test_id('tactical-battle')
    expect(battle).to_have_attribute('data-phase', 'deployment')
    expect(page.locator('canvas.tenka-battle-2d')).to_be_visible()
    page.wait_for_function('!!window.__muranaka2D&&!!window.__muranakaBattle')
    return initial, battle


def actual_2d_input(page, battle):
    data = page.evaluate("""()=>{
 const b=window.__muranakaBattle,u=b.units.find(u=>u.side===(b.playerSide||'attacker'));
 window.__muranaka2D.focusUnit(u.id);
 return {id:u.id,x:u.x,z:u.z,screen:window.__muranaka2D.worldToScreen(u.x,u.z)};
}""")
    canvas = page.locator('canvas.tenka-battle-2d')
    canvas.scroll_into_view_if_needed()
    box = canvas.bounding_box(); assert box
    page.mouse.click(box['x'] + data['screen']['x'], box['y'] + data['screen']['y'])
    expect(battle.get_by_test_id('tactical-unit-' + data['id'])).to_have_attribute('aria-pressed', 'true')
    destination = page.evaluate("""u=>{
 const b=window.__muranakaBattle,T=window.TenkaTactics;
 for(const[x,z]of[[u.x+8,u.z+8],[u.x-8,u.z+8],[u.x+12,u.z]])
  if(T.deploy(b,{unitId:u.id,x,z}).ok)return{x,z,screen:window.__muranaka2D.worldToScreen(x,z)};
 throw Error('No legal nearby deployment');
}""", data)
    page.mouse.click(box['x'] + destination['screen']['x'], box['y'] + destination['screen']['y'])
    page.wait_for_function("p=>{const u=window.__muranakaBattle.units.find(u=>u.id===p.id);return Math.abs(u.x-p.x)<.05&&Math.abs(u.z-p.z)<.05;}", arg={**destination, 'id': data['id']})
    assert page.evaluate("window.__muranakaBattle.ledger.some(r=>r.kind==='deploy')")


def renderer_switch(page, battle, fallback=False):
    before = page.evaluate('JSON.stringify(window.__muranakaBattle)')
    if fallback:
        page.evaluate('window.__muranakaForce3DFailure=true')
    battle.get_by_role('button', name='3D表示', exact=True).click(no_wait_after=True)
    if fallback:
        expect(page.locator('canvas.tenka-battle-2d')).to_be_visible()
        expect(page.locator('.tactical-canvas canvas')).to_have_count(1)
        page.evaluate('window.__muranakaForce3DFailure=false')
    else:
        page.wait_for_function('!!window.__muranaka3D', timeout=120000)
        expect(page.locator('.tactical-canvas canvas:not(.tenka-battle-2d)')).to_be_visible()
        battle.get_by_role('button', name='2D戦況図', exact=True).click(no_wait_after=True)
        expect(page.locator('canvas.tenka-battle-2d')).to_be_visible()
    assert page.evaluate('JSON.stringify(window.__muranakaBattle)') == before


def completed_battle(page, url, width, mode, failure, shots, passed):
    before, battle = open_battle(page, url, mode)
    if mode == 'siege' and failure is None:
        actual_2d_input(page, battle)
        renderer_switch(page, battle, fallback=True)
        no_overflow(page, battle)
        battle.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-muranaka-deployment.png'))
        passed(f'{width}px: real 2D unit placement; failed-WebGL fallback removes partial canvas and preserves exact ledger, supply and deployment')
    if failure:
        page.evaluate('mode=>window.__muranakaSettlementFailure=mode', failure)
    page.evaluate('window.__muranakaAccelerate=true')
    battle.get_by_role('button', name='戦闘開始', exact=True).click()
    expect(battle).to_have_attribute('data-phase', 'finished', timeout=120000)
    settlement = page.get_by_test_id('battle-settlement')
    if failure:
        expect(settlement).to_have_attribute('data-status', 'error', timeout=120000)
        expect(settlement).to_contain_text('試験用')
        unchanged = saved(page)
        assert castle(unchanged, 'muranaka')['clan'] == 'ryuzoji'
        assert orders(unchanged) == orders(before)
        assert unchanged['gold'] == before['gold'] and unchanged['food'] == before['food']
        assert page.evaluate('window.__muranakaSettleCalls') == 1
        frozen = page.evaluate('JSON.stringify(window.__muranakaBattle)')
        page.wait_for_timeout(350)
        assert page.evaluate('JSON.stringify(window.__muranakaBattle)') == frozen
        no_overflow(page, settlement)
        settlement.screenshot(path=str(shots / f'{width}-muranaka-{failure}-retry.png'))
        settlement.get_by_role('button', name='戦果の反映を再試行', exact=True).click()
    expect(settlement).to_have_attribute('data-status', 'confirmed', timeout=120000)
    print('STEP: battle settlement confirmed', flush=True)
    expect(settlement).to_contain_text('村中城')
    after = saved(page)
    assert after['lastBattle']['targetId'] == 'muranaka'
    assert after['lastBattle']['mode'] == mode and after['lastBattle']['won']
    assert castle(after, 'muranaka')['clan'] == ('arima' if mode == 'siege' else 'ryuzoji')
    assert orders(after) == orders(before) - 1
    assert after['gold'] == before['gold'] - 120
    assert after['food'] <= before['food'] - 600
    assert page.evaluate('window.__muranakaSettleCalls') == (2 if failure else 1)
    frozen = page.evaluate('JSON.stringify(window.__muranakaBattle)')
    page.wait_for_timeout(300)
    assert page.evaluate('JSON.stringify(window.__muranakaBattle)') == frozen
    no_overflow(page, settlement)
    settlement.screenshot(path=str(shots / f'{width}-muranaka-{mode}-confirmed.png'))
    page.get_by_role('dialog').get_by_role('button', name='評定に戻る', exact=True).last.click()
    expect(battle).to_have_count(0)
    print('STEP: returned to campaign', flush=True)
    state = saved(page)
    assert orders(state) == orders(after)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='有馬家の続きから遊ぶ', exact=True).click()
    restored_battle = saved(page)
    print('STEP: battle report restored', flush=True)
    assert restored_battle['lastBattle']['id'] == after['lastBattle']['id']
    assert orders(restored_battle) == orders(after)
    page.get_by_role('button', name=re.compile('^次の月へ')).click()
    page.wait_for_function('turn=>window.TenkaGame.load().turn===turn+1', arg=before['turn'])
    advanced = saved(page)
    print('STEP: next month saved', flush=True)
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='有馬家の続きから遊ぶ', exact=True).click()
    restored = saved(page)
    assert restored['turn'] == advanced['turn']
    assert restored['lastBattle'] == advanced['lastBattle']
    assert castle(restored, 'muranaka')['clan'] == castle(after, 'muranaka')['clan']
    passed(f'{width}px {mode}: actual victory settles once, visible result/return, valid save/reload and next month' + (f'; one-shot {failure} retains the battle and retry succeeds' if failure else ''))


def permanent_failure_recovery(page, url, width, shots, passed):
    before, battle = open_battle(page, url, 'siege')
    page.evaluate("window.__muranakaSettlementFailure='permanent';window.__muranakaAccelerate=true")
    battle.get_by_role('button', name='戦闘開始', exact=True).click()
    settlement = page.get_by_test_id('battle-settlement')
    expect(settlement).to_have_attribute('data-status', 'error', timeout=120000)
    position = settlement.evaluate("node=>{const r=node.getBoundingClientRect(),d=node.closest('[role=dialog]').getBoundingClientRect();return{top:r.top,bottom:r.bottom,dialogTop:d.top,height:innerHeight};}")
    assert position['top'] >= position['dialogTop'] - 1 and position['bottom'] <= position['height'] + 1, position
    no_overflow(page, settlement)
    settlement.screenshot(path=str(shots / f'{width}-muranaka-permanent-visible.png'))
    cancel = settlement.get_by_role('button', name='戦果を反映せず戻る', exact=True)
    page.once('dialog', lambda dialog: dialog.dismiss())
    cancel.click()
    expect(battle).to_have_attribute('data-phase', 'finished')
    expect(settlement).to_have_attribute('data-status', 'error')
    page.once('dialog', lambda dialog: dialog.accept())
    cancel.click()
    expect(battle).to_have_count(0)
    expect(page.get_by_role('dialog', name='村中城 攻略の軍議', exact=True)).to_be_visible()
    after = saved(page)
    for key in ['armies', 'officers', 'gold', 'food', 'lastBattle']:
        assert after[key] == before[key], key
    assert orders(after) == orders(before)
    assert castle(after, 'muranaka')['clan'] == 'ryuzoji'
    passed(f'{width}px: permanent settlement failure offers an explicit reviewed return; dismiss keeps battle, acceptance restores prior military council without committing losses/costs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8064')
    parser.add_argument('--screenshots', default='/tmp/tenka-muranaka-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--skip-3d', action='store_true', help='Run default-2D completion and automatic fallback regressions only')
    parser.add_argument('--only', choices=['completion', 'recovery', '3d'], help='Run one group for targeted follow-up verification')
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
            context.set_default_navigation_timeout(60000); context.set_default_timeout(30000)
            page = context.new_page()
            page.on('pageerror', lambda error: (errors.append(str(error)), print('BROWSER ERROR: ' + str(error), flush=True)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.route(re.compile(re.escape(url) + r'(?:\?.*)?$'), lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            try:
                if args.only in [None, 'completion']:
                    completed_battle(page, url, width, 'siege', None, shots, passed)
                    completed_battle(page, url, width, 'field', None, shots, passed)
                    if width > 600:
                        for failure in ['return', 'throw']:
                            completed_battle(page, url, width, 'siege', failure, shots, passed)
                if args.only in [None, 'recovery'] and (width > 600 or args.only == 'recovery'):
                    permanent_failure_recovery(page, url, width, shots, passed)
                if args.only in [None, '3d'] and width > 600 and not args.skip_3d:
                    _, battle = open_battle(page, url, 'siege')
                    renderer_switch(page, battle)
                    passed(f'{width}px: real native 3D renders and switches back to 2D without resetting battle state')
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
