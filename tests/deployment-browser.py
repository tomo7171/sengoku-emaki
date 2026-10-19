#!/usr/bin/env python3
"""Exercise the actual pre-battle DOM and 3D pointer controls in all three modes.

Serve the repository, then run python tests/deployment-browser.py --url http://127.0.0.1:8027
Python Playwright and Chromium are required. Fixtures prepare valid campaign saves;
all battle operations then use the shipped user interface and production engine.

This compatibility harness checks legacy real-time deployment records and 3D
pointer controls. monthly-turns-browser.py separately checks the current live
turn-based field, siege and defensive battle flows.
"""
import argparse
import json
import math
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

FIXTURE = """mode => {
 const Game=window.TenkaGame,state=Game.newGame();state.selectedCastleId='inabayama';
 if(mode==='defense')state.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:state.castles.find(c=>c.id==='inabayama').clan};
 if(!Game.validate(state)||!Game.save(state))throw Error('Invalid campaign fixture');
 return true;
}"""
REFERENCE = """mode => {
 const state=window.TenkaGame.load();
 window.__deploymentReference=mode==='defense'?window.TenkaTactics.createDefense(state):window.TenkaGame.createBattle({state,sourceId:'kiyosu',targetId:'inabayama',mode});
}"""
SPOT = """({kind,id,rotation})=>{
 const T=window.TenkaTactics,b=window.__deploymentReference,z=T.deploymentZone(b);
 for(let p=Math.ceil(z.zMin+5);p<z.zMax-5;p+=4)for(let x=Math.ceil(z.xMin+6);x<z.xMax-6;x+=4){
  const current=id&&b.fortifications.find(w=>w.id===id);
  if(current&&Math.hypot(current.x-x,current.z-p)<12)continue;
  const r=id?T.moveFortification(b,{id,x,z:p,rotation}):T.placeFortification(b,{kind,x,z:p,rotation});
  if(r.ok){window.__deploymentReference=r.battle;return{x,z:p,id:r.fortificationId||r.battle.fortifications.at(-1).id};}
 }throw Error('No open placement spot for '+kind);
}"""


ROOT = Path(__file__).resolve().parents[1]


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    legacy = """
// Test-only legacy record compatibility; current live turns are checked by monthly-turns-browser.py.
const legacyBattleCreate=Xn,legacyBattleDefense=window.TenkaTactics.createDefense;
Xn=options=>legacyBattleCreate({...options,controlMode:undefined});
window.TenkaTactics.createDefense=(state,threat,options={})=>legacyBattleDefense(state,threat,{...options,controlMode:undefined});
"""
    return html.replace(marker, legacy + marker, 1)


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--url',default='http://127.0.0.1:8027')
 parser.add_argument('--chromium',default='/usr/bin/chromium')
 parser.add_argument('--screenshots',default='/tmp/tenka-deployment-browser')
 parser.add_argument('--widths',default='1440,390')
 parser.add_argument('--modes',default='field,siege,defense')
 args=parser.parse_args();shots=Path(args.screenshots);shots.mkdir(parents=True,exist_ok=True)
 checks=[];errors=[]
 html=instrumented_html();url=args.url.rstrip('/')+'/'
 def checked(text):checks.append(text);print('PASS: '+text,flush=True)
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  for width in map(int,args.widths.split(',')):
   for mode in args.modes.split(','):
    context=browser.new_context(viewport={'width':width,'height':1100 if width>600 else 844},device_scale_factor=1)
    context.add_init_script("localStorage.setItem('tenka-battle-renderer','3d')")
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.route(url,lambda route:route.fulfill(status=200,content_type='text/html',body=html))
    page.on('console',lambda message: errors.append(message.text) if message.type=='error' else None)
    page.goto(url,wait_until='domcontentloaded')
    expect(page.get_by_role('combobox',name='開始する大名',exact=True)).to_be_visible()
    page.evaluate(FIXTURE,mode);page.reload(wait_until='domcontentloaded')
    page.get_by_role('button',name='織田家の続きから遊ぶ',exact=True).click()
    page.evaluate(REFERENCE,mode)
    if mode=='defense':
     page.get_by_role('button',name='籠城を指揮する',exact=True).click()
     page.get_by_role('button',name='この兵糧で籠城を指揮する',exact=True).click()
    else:
     page.get_by_role('button',name='稲葉山城へ出陣',exact=True).click()
     page.get_by_role('button',name=re.compile('^野戦' if mode=='field' else '^攻城戦')).click()
     page.get_by_role('button',name='戦場で采配する',exact=True).click()
    battle=page.get_by_test_id('tactical-battle');expect(battle).to_have_attribute('data-phase','deployment')
    toolbar=page.locator('.tenka-deployment');expect(toolbar).to_be_visible()
    canvas=page.locator('.tactical-canvas canvas');expect(canvas).to_be_visible()
    expect(page.locator('.tactical-graphics-error')).to_have_count(0)
    banner=page.locator('.tenka-castle-visual:not(.tenka-field-visual)')
    if mode=='field':expect(banner).to_have_count(0)
    else:
     expect(banner).to_be_visible()
     image=banner.locator('img');image.evaluate('(image)=>image.decode()')
     assert image.evaluate('(image)=>image.complete&&image.naturalWidth>=600')
     collapsed=image.bounding_box()['height']
     banner.get_by_role('button',name='城の画像を大きく見る',exact=True).click()
     expect(banner).to_have_class(re.compile('expanded'))
     assert image.bounding_box()['height']>collapsed+20
     banner.get_by_role('button',name='城の画像を小さくする',exact=True).click()
     checked(f'{width}px {mode}: castle artwork decodes and expands')
    for kind,label in [('camp','本陣'),('palisade','木柵')]:
     toolbar.get_by_role('button',name=label,exact=True).click()
     picker=toolbar.get_by_role('combobox',name='編集する陣・柵',exact=True)
     spot=page.evaluate(SPOT,{'kind':kind,'id':None,'rotation':0})
     x=toolbar.get_by_role('spinbutton',name='陣・柵の東西座標',exact=True);z=toolbar.get_by_role('spinbutton',name='陣・柵の南北座標',exact=True)
     x.fill(str(spot['x']));z.fill(str(spot['z']))
     toolbar.get_by_role('button',name='この座標に設置',exact=True).click()
     expect(picker).to_have_value(spot['id']);expect(x).to_have_value(str(spot['x']));expect(z).to_have_value(str(spot['z']))
     # Test the real parent callback order: changing tools clears the selection.
     toolbar.get_by_role('button',name=label,exact=True).click();expect(picker).to_have_value('')
     picker.select_option(spot['id']);expect(picker).to_have_value(spot['id'])
     expect(toolbar.get_by_role('button',name='この座標へ移設',exact=True)).to_be_visible()
     angle=page.evaluate("""id=>{const b=window.__deploymentReference,w=b.fortifications.find(w=>w.id===id);for(const rotation of [90,45,180,270]){const r=window.TenkaTactics.moveFortification(b,{id,x:w.x,z:w.z,rotation});if(r.ok){window.__deploymentReference=r.battle;return rotation;}}throw Error('No valid rotation');}""",spot['id'])
     rotation=toolbar.get_by_role('combobox',name='陣・柵の向き',exact=True);rotation.select_option(str(angle));expect(rotation).to_have_value(str(angle))
     moved=page.evaluate(SPOT,{'kind':kind,'id':spot['id'],'rotation':angle})
     x.fill(str(moved['x']));z.fill(str(moved['z']));toolbar.get_by_role('button',name='この座標へ移設',exact=True).click()
     expect(x).to_have_value(str(moved['x']));expect(z).to_have_value(str(moved['z']))
     toolbar.get_by_role('button',name='撤去する',exact=True).click();expect(picker).to_have_value('')
     page.evaluate("""id=>{const r=window.TenkaTactics.removeFortification(window.__deploymentReference,id);if(!r.ok)throw Error(r.message);window.__deploymentReference=r.battle;}""",spot['id'])
     checked(f'{width}px {mode}: {kind} coordinate placement, dropdown reselection, rotation, move and removal')
    if width==1440 and mode=='field':
     toolbar.get_by_role('button',name='本陣',exact=True).click()
     page.get_by_role('button',name='上から見る',exact=True).click()
     canvas.scroll_into_view_if_needed();page.wait_for_timeout(500)
     box=canvas.bounding_box();picker=toolbar.get_by_role('combobox',name='編集する陣・柵',exact=True)
     # The top camera looks north; this empty south-west patch is in the attacker zone.
     candidates=[(.23,.80),(.28,.80),(.23,.75),(.32,.77),(.37,.82),(.18,.77)]
     placed=None
     for horizontal,vertical in candidates:
      pixel={'x':box['x']+box['width']*horizontal,'y':box['y']+box['height']*vertical}
      page.mouse.click(pixel['x'],pixel['y']);page.wait_for_timeout(180)
      if picker.input_value():placed=pixel;break
     assert placed,'A real ground click must place a camp on the 3D field'
     x=toolbar.get_by_role('spinbutton',name='陣・柵の東西座標',exact=True);z=toolbar.get_by_role('spinbutton',name='陣・柵の南北座標',exact=True)
     before=(float(x.input_value()),float(z.input_value()));work_id=picker.input_value()
     # Drag starts at the same ground click: in the top view the camp footprint covers it.
     page.mouse.move(placed['x'],placed['y']);page.mouse.down();page.mouse.move(placed['x']-45,placed['y']-45,steps=12);page.mouse.up();page.wait_for_timeout(250)
     after=(float(x.input_value()),float(z.input_value()))
     assert picker.input_value()==work_id and math.dist(before,after)>2,('Actual facility drag must move the selected camp',before,after,placed,page.locator('.tactical-notice').inner_text())
     checked('1440px field: actual canvas ground click places a camp and pointer drag moves it')
     page.evaluate("""work=>{const r=window.TenkaTactics.placeFortification(window.__deploymentReference,{kind:'camp',x:work.x,z:work.z,rotation:90});if(!r.ok)throw Error(r.message);window.__deploymentReference=r.battle;}""",{'x':after[0],'z':after[1]})
     toolbar.get_by_role('button',name='木柵',exact=True).click()
     palisade=page.evaluate(SPOT,{'kind':'palisade','id':None,'rotation':45})
     toolbar.get_by_role('combobox',name='陣・柵の向き',exact=True).select_option('45')
     x.fill(str(palisade['x']));z.fill(str(palisade['z']));toolbar.get_by_role('button',name='この座標に設置',exact=True).click()
     expect(picker).to_have_value(palisade['id'])
     page.get_by_role('button',name='視点を戻す',exact=True).click()
     canvas.scroll_into_view_if_needed();page.wait_for_timeout(400)
     page.locator('.tactical-canvas').screenshot(path=str(shots/'field-camp-palisade-3d.png'))
     checked('1440px field: rendered camp and palisade screenshot saved')
    # Ensure meaningful phone bounds after the editors and canvas have actually rendered.
    toolbar.scroll_into_view_if_needed()
    geometry=page.evaluate("""()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,controls:Array.from(document.querySelectorAll('.tenka-deployment input,.tenka-deployment select,.tenka-deployment button')).filter(e=>e.getBoundingClientRect().width).map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))})""")
    assert geometry['document']<=geometry['viewport']+1,geometry
    assert all(e['left']>=-1 and e['right']<=width+1 for e in geometry['controls']),geometry
    page.screenshot(path=str(shots/f'{width}-{mode}-deployment.png'),full_page=True)
    page.get_by_role('button',name='戦闘開始',exact=True).click()
    expect(battle).to_have_attribute('data-phase','fighting')
    expect(page.locator('.tenka-deployment')).to_have_count(0)
    expect(page.get_by_role('combobox',name='編集する陣・柵',exact=True)).to_have_count(0)
    expect(page.get_by_role('button',name='本陣',exact=True)).to_have_count(0)
    checked(f'{width}px {mode}: no horizontal overflow; battle starts and removes placement editing')
    context.close()
  browser.close()
 assert not errors,errors
 print(json.dumps({'checks':checks,'browser_errors':errors,'screenshots':str(shots)},ensure_ascii=False,indent=2),flush=True)

if __name__=='__main__':main()
