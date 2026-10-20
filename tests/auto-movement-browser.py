#!/usr/bin/env python3
"""Regress automatic movement through real commanders, deployment, and React UI.

Only the initial valid campaign and unrelated nationwide map are replaced.
No running battle, commands, target health, or time is modified by the test.
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
 const G=window.TenkaGame;let s=G.newGame();
 const home=s.castles.find(c=>c.id===(mode==='siege'?'hinoe':'kiyosu'));
 const enemy=s.castles.find(c=>c.id===(mode==='siege'?'muranaka':'inabayama'));
 s.playerClan=home.clan;s.selectedCastleId=enemy.id;s.gold=100000;s.food=1000000;
 for(const c of s.castles){c.gold=0;c.food=0;}
 Object.assign(home,{gold:100000,food:100000,troops:mode==='siege'?12000:5000,morale:100,population:250000,kokudaka:250000});
 Object.assign(enemy,{gold:100000,food:100000,troops:mode==='siege'?40:mode==='defense'?1000:3000,morale:90});
 s.armies[home.id].units={ashigaru:home.troops,archer:0,cavalry:0,firearm:0,navy:0};
 s.armies[enemy.id].units={ashigaru:enemy.troops,archer:0,cavalry:0,firearm:0,navy:0};
 const officers=s.officers.filter(o=>o.clan===s.playerClan&&o.status==='active'&&(o.birth==null||s.year-o.birth>=15));
 for(const o of officers)o.castleId=home.id;
 for(const c of s.castles.filter(c=>c.clan===s.playerClan))s.armies[c.id].commanderId=null;
 s.armies[home.id].commanderId=officers[0].id;
 if(mode==='defense')s.pendingDefense={sourceId:enemy.id,targetId:home.id,mode:'siege',clan:enemy.clan};
 s=G.migrate(s);if(!G.validate(s)||!G.save(s))throw Error('Automatic movement fixture must validate and save: '+mode);
 return s;
}"""


def instrumented_html():
    html=(ROOT/'index.html').read_text()
    marker='(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker)==1
    observe="""
Mv=()=>new Proxy({},{get:()=>()=>{}});
const movement2D=window.TenkaBattle2D;
window.TenkaBattle2D={...movement2D,create:(mount,options)=>{
 const renderer=movement2D.create(mount,options),update=renderer.update;
 window.__monthlyBattle=options.battle;
 renderer.update=(battle,...rest)=>{window.__monthlyBattle=battle;return update(battle,...rest);};return renderer;
}};
const movementAuto=window.TenkaAutoBattle;window.__movementTurns=[];
window.TenkaAutoBattle={...movementAuto,advance:(battle,orders)=>{
 const answer=movementAuto.advance(battle,orders);
 window.__movementTurns.push({turn:battle.turnNumber,ok:answer.ok,message:answer.message,
  before:battle.units.filter(u=>u.side===(battle.playerSide||'attacker')).map(u=>({id:u.id,x:u.x,z:u.z,ambush:u.ambush,revealed:u.revealed,troops:u.troops,status:u.status})),
  after:answer.battle.units.filter(u=>u.side===(battle.playerSide||'attacker')).map(u=>({id:u.id,x:u.x,z:u.z,ambush:u.ambush,revealed:u.revealed,troops:u.troops,status:u.status})),
  structures:answer.battle.structures.filter(s=>s.kind==='gate').map(s=>({id:s.id,hp:s.hp})),orders:answer.orders,
  added:answer.battle.ledger.slice(battle.ledger.length)});
 return answer;
}};
"""
    fixture="\nconst movementFixture=new URLSearchParams(location.search).get('movementFixture');if(movementFixture){("+FIXTURE+")(movementFixture);history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker,observe+fixture+marker,1)


def snapshot(page):
    return page.evaluate('JSON.stringify(window.__monthlyBattle)')


def pause(page, orders):
    orders.get_by_test_id('auto-battle-pause').click()
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running','false')
    frozen=snapshot(page)
    page.wait_for_timeout(350)
    assert snapshot(page)==frozen
    return frozen


def check(page,url,width,mode,shots,passed):
    print(f'STEP {width}px {mode}: real ordinary-foot deployment',flush=True)
    page.goto(url+'?movementFixture='+mode,wait_until='domcontentloaded')
    BASE.saved(page)
    page.get_by_role('button',name=re.compile('の続きから遊ぶ$')).click()
    if mode=='defense':
        page.get_by_role('button',name='籠城を指揮する',exact=True).click()
        page.get_by_role('dialog',name='清洲城 籠城の軍議',exact=True).get_by_role('button',name='この兵糧で籠城を指揮する',exact=True).click()
    else:
        name='村中城' if mode=='siege' else '稲葉山城'
        page.get_by_role('button',name=name+'へ出陣',exact=True).click()
        military=page.get_by_role('dialog',name=name+' 攻略の軍議',exact=True)
        military.get_by_role('button',name='野戦' if mode=='field' else re.compile('^攻城戦')).click()
        military.get_by_role('button',name='戦場で采配する',exact=True).click()
    battle=page.get_by_test_id('tactical-battle')
    expect(battle).to_have_attribute('data-phase','deployment')
    toolbar=battle.get_by_role('region',name='部隊と陣・柵の自由配置',exact=True)
    orders=battle.get_by_test_id('turn-orders')
    start=battle.get_by_role('button',name='戦闘開始',exact=True)
    expect(start).to_be_disabled()
    setup=page.evaluate("""()=>{const b=window.__monthlyBattle;return{unit:b.units.find(u=>u.side===(b.playerSide||'attacker')&&u.troops>0),officer:b.friendlyOfficers[0].id,enemy:b.units.find(u=>u.side!==(b.playerSide||'attacker')&&u.troops>0),gates:b.structures.filter(s=>s.kind==='gate').map(s=>({id:s.id,hp:s.hp}))};}""")
    unit=setup['unit'];assert unit['type']=='ashigaru'
    toolbar.get_by_role('combobox',name='足軽部隊の指揮武将',exact=True).select_option(setup['officer'])
    # Confirm the actual native suggested position, rather than choosing the
    # narrow forward fixture placement that hid this defect in earlier tests.
    toolbar.get_by_role('combobox',name='配置する部隊',exact=True).select_option(unit['id'])
    toolbar.get_by_role('spinbutton',name='部隊の東西座標',exact=True).fill(str(unit['x']))
    toolbar.get_by_role('spinbutton',name='部隊の南北座標',exact=True).fill(str(unit['z']))
    toolbar.get_by_role('button',name='この位置へ配置',exact=True).click()
    expect(start).to_be_enabled()
    if mode=='field':
        toolbar.get_by_role('button',name='伏兵を配置',exact=True).click()
        page.wait_for_function('id=>window.__monthlyBattle.units.find(u=>u.id===id).ambush',arg=unit['id'])
    enemy=setup['enemy']
    if mode=='siege':
        orders.get_by_role('combobox',name='第一目標',exact=True).select_option(enemy['id'])
        orders.get_by_role('combobox',name='第一目標の撃破後',exact=True).select_option('wait')
        orders.get_by_role('combobox',name='第二目標',exact=True).select_option('capture')
        orders.get_by_role('button',name='目標の順序を設定',exact=True).click()
    else:
        orders.get_by_role('combobox',name='自動進行の攻撃目標',exact=True).select_option(enemy['id'])
        orders.get_by_role('button',name='この目標へ攻撃を継続',exact=True).click()
    orders.get_by_role('checkbox',name='開戦後に自動進行',exact=True).check()
    orders.get_by_role('combobox',name='自動進行の速度',exact=True).select_option('4' if mode=='siege' else '1')
    original=snapshot(page)
    assert page.evaluate('window.__monthlyBattle.time')==0
    start.click()
    expect(battle).to_have_attribute('data-phase','fighting')
    expect(orders.get_by_test_id('auto-battle-running')).to_have_attribute('data-running','true')
    page.wait_for_function("id=>{const b=window.__monthlyBattle,u=b.units.find(u=>u.id===id),t=window.__movementTurns[0]?.before.find(u=>u.id===id);return t&&(Math.hypot(u.x-t.x,u.z-t.z)>.5||b.phase==='finished');}",arg=unit['id'],timeout=45000)
    if mode=='siege':
        page.wait_for_function("initial=>window.__monthlyBattle.structures.some(s=>s.kind==='gate'&&s.hp<initial.find(g=>g.id===s.id).hp)",arg=setup['gates'],timeout=45000)
        added=page.evaluate("window.__movementTurns.flatMap(t=>t.added).filter(r=>r.kind==='turn-order'&&r.command.order==='attack').map(r=>r.command.targetId)")
        assert any(gate['id'] in added for gate in setup['gates']), 'ordinary foot must clear a prerequisite gate even when the explicit goal is its defender'
        plan=orders.get_by_test_id('target-sequence-progress')
        target_after=page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)',enemy['id'])
        defeated=target_after['troops']<=0 or target_after['status'] in ['routed','destroyed']
        assert plan.get_attribute('data-sequence-index')==('1' if defeated else '0'), 'opening a necessary gate cannot complete the different enemy target'
        passed(f'{width}px siege: running ordinary foot approaches the chosen castle defender and attacks the actual blocking gate without prematurely completing the explicit target sequence')
    else:
        moving=page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)',unit['id'])
        assert moving['revealed'] and not moving['ambush']
        passed(f'{width}px {mode}: automatic attack advances ordinary foot from the confirmed native position; a concealed field unit releases its ambush rather than remaining frozen')
    initial_battle=json.loads(original)
    assert page.evaluate("before=>{const b=window.__monthlyBattle,side=b.playerSide||'attacker';return b.supply[side].consumed>before.supply[side].consumed;}",initial_battle), 'automatic motion must consume the real carried supply'
    frozen=pause(page,orders)
    assert page.evaluate("window.__movementTurns.every(t=>t.ok&&t.added.filter(r=>r.kind==='turn-end').length===1)"), 'every automatic advance must remain a single replayable native turn'
    BASE.no_overflow(page,orders)
    if mode=='siege':
        # An explicit hold must still stop this troop; clearing a gate does not
        # grant permission to ignore player pauses or move during planning.
        orders.get_by_role('button',name='この部隊を待機',exact=True).click()
        expect(orders.get_by_test_id('target-sequence-progress')).to_have_count(0)
    else:
        orders.get_by_role('button',name='この部隊を待機',exact=True).click()
    assert snapshot(page)==frozen
    held=page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)',unit['id'])
    previous_turn=page.evaluate('window.__monthlyBattle.turnNumber')
    orders.get_by_role('button',name='自動進行を開始',exact=True).click()
    page.wait_for_function('n=>window.__monthlyBattle.turnNumber>n',arg=previous_turn)
    pause(page,orders)
    after=page.evaluate('id=>window.__monthlyBattle.units.find(u=>u.id===id)',unit['id'])
    assert (after['x'],after['z'])==(held['x'],held['z']), 'deliberately waiting troops must not be forced to advance by movement recovery'
    BASE.no_overflow(page,orders)
    orders.screenshot(path=str(shots/f'{width}-{mode}-moving-then-held.png'))
    passed(f'{width}px {mode}: auto movement uses real native turn records and food; global pause freezes the battle and a new explicit wait holds the unit and clears only its old target plan')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8065')
    parser.add_argument('--widths',default='1440,390')
    parser.add_argument('--modes',default='field,siege,defense')
    parser.add_argument('--screenshots',default='/tmp/tenka-auto-movement-browser')
    args=parser.parse_args();shots=Path(args.screenshots);shots.mkdir(parents=True,exist_ok=True)
    url=args.url.rstrip('/')+'/';checks=[];errors=[];html=instrumented_html()
    def passed(message):
        checks.append(message);print('PASS: '+message,flush=True)
        (shots/'results.json').write_text(json.dumps({'checks':checks,'browser_errors':errors},ensure_ascii=False,indent=2))
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        for width in map(int,args.widths.split(',')):
            context=browser.new_context(viewport={'width':width,'height':1050 if width>600 else 844});context.set_default_timeout(30000);context.set_default_navigation_timeout(60000)
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
            page.route(re.compile(re.escape(url)+r'(?:\?.*)?$'),lambda route:route.fulfill(status=200,content_type='text/html',body=html))
            try:
                for mode in args.modes.split(','):check(page,url,width,mode,shots,passed)
            except Exception:
                page.screenshot(path=str(shots/f'{width}-failure.png'))
                (shots/'failure.json').write_text(json.dumps({'checks':checks,'browser_errors':errors,'battle':page.evaluate('window.__monthlyBattle||null'),'turns':page.evaluate('window.__movementTurns||[]'),'body':page.locator('body').inner_text()},ensure_ascii=False,indent=2))
                raise
            finally:context.close()
        browser.close()
    assert not errors,errors
    print(json.dumps({'checks':checks,'browser_errors':errors,'screenshots':str(shots)},ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':main()
