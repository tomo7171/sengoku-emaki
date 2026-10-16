#!/usr/bin/env python3
"""Check the expanded battle landscape and player deployment in the actual UI.

Run against a locally served repository. Observation hooks exist only in the
test's HTML response; production code exposes no renderer internals. The same
UI operations are exercised in field battles, sieges and defensive sieges.
"""
import argparse
import json
import math
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    registry = 'let Ne = new Map(),'
    assert html.count(registry) == 1, 'Find the actual battle renderer'
    html = html.replace(registry, 'let Ne=(window.__wideScene=u,window.__wideCamera=f,window.__wideControls=h,window.__wideHeightAt=ve,window.__wideEntries=new Map()),', 1)
    renderer_start = html.index('function G_(')
    ground_marker = 'Oe.castShadow = !1;'
    position = html.index(ground_marker, renderer_start)
    html = html[:position] + html[position:].replace(ground_marker, ground_marker + '\n    window.__wideGround=Oe;', 1)
    water_marker = '((i.castShadow = !1), ke.push(i));'
    position = html.index(water_marker, renderer_start)
    html = html[:position] + html[position:].replace(water_marker, '((i.userData.wideTestWater=e),(i.castShadow = !1), ke.push(i));', 1)
    update_marker = 'function Wt(e, t = {}) {'
    position = html.index(update_marker, renderer_start)
    html = html[:position] + html[position:].replace(update_marker, update_marker + '\n      window.__wideUnitHits=rt;', 1)
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    observe = """
const wideEnvironmentCreate=window.TenkaBattleEnvironment.create;
window.TenkaBattleEnvironment={...window.TenkaBattleEnvironment,create:(...args)=>{
 const result=wideEnvironmentCreate(...args);window.__wideEnvironment=result;return result;
}};
const wideRendererCreate=G_;
G_=(mount,options)=>{
 const renderer=wideRendererCreate(mount,options),update=renderer.update;
 window.__wideRenderer=renderer;window.__wideBattle=options.battle;
 renderer.update=(battle,...rest)=>{
  if(battle.phase==='fighting'&&window.__wideBattle?.phase==='deployment')window.__wideStart=JSON.parse(JSON.stringify(battle));
  window.__wideBattle=battle;return update(battle,...rest);
 };
 return renderer;
};
"""
    assert marker in html
    return html.replace(marker, observe + marker, 1)


FIXTURE = """({mode,sourceId,targetId})=>{
 const G=window.TenkaGame,state=G.newGame();
 const source=state.castles.find(c=>c.id===sourceId),target=state.castles.find(c=>c.id===targetId);
 state.playerClan=mode==='defense'?target.clan:source.clan;
 state.selectedCastleId=targetId;state.alliances=[];
 if(mode==='defense')state.pendingDefense={sourceId,targetId,mode:'siege',clan:source.clan};
 if(!G.validate(state)||!G.save(state))throw Error('Invalid wide battlefield campaign fixture');
 return {targetName:target.name,clanName:G.clans[state.playerClan].name};
}"""

CHOOSE_WIDE_POSITION = """()=>{
 const b=window.__wideBattle,T=window.TenkaTactics,side=b.playerSide||'attacker';
 const units=b.units.filter(u=>u.side===side&&u.troops>0&&u.type!=='navy'),unit=units[1]||units[0],zone=T.deploymentZone(b);
 const candidates=side==='attacker'?[[-76,57],[76,78],[0,72],[-80,72],[48,72]]:[[-72,-76],[72,-76],[0,-82],[-60,-62]];
 for(let z=Math.ceil(zone.zMin+4);z<zone.zMax-4;z+=6)for(let x=Math.ceil(zone.xMin+4);x<zone.xMax-4;x+=6)candidates.push([x,z]);
 for(const[x,z]of candidates){
  if(x>=-44&&x<=44&&z>=-50&&z<=42)continue;
  if(T.deploy(b,{unitId:unit.id,x,z}).ok)return{unitId:unit.id,x,z,originalX:unit.x,originalZ:unit.z};
 }throw Error('No legal deployment point outside the old battlefield');
}"""

LANDSCAPE = """()=>{
 const b=window.__wideBattle,l=b.layout.landscape,env=window.__wideEnvironment,W=window.TenkaBattlefield;
 const meshInfo=env.meshes.map(mesh=>({name:mesh.name,visible:mesh.visible,count:mesh.isInstancedMesh?mesh.count:mesh.geometry.attributes.position.count}));
 const houses=l.settlements.flatMap(s=>s.houses),points=h=>[[h.x,h.z],...[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,z])=>[h.x+x*h.w/2,h.z+z*h.d/2])];
 const seaHouses=houses.filter(h=>points(h).some(([x,z])=>l.seas.some(sea=>W.inside(x,z,sea.polygon))));
 const seaFields=l.fields.filter(f=>points(f).some(([x,z])=>l.seas.some(sea=>W.inside(x,z,sea.polygon))));
 const water=[];window.__wideScene.traverse(mesh=>{
  const source=mesh.userData.wideTestWater;if(!source)return;
  const positions=mesh.geometry.attributes.position;let mismatched=0,heightError=0;
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),z=positions.getZ(i);
   if(!source.polygon.some(p=>Math.hypot(x-p[0],z-p[1])<.001))mismatched++;
   heightError=Math.max(heightError,Math.abs(positions.getY(i)-(source.type==='sea'?-.12:window.__wideHeightAt(x,z)-.12)));
  }
  water.push({type:source.type,visible:mesh.visible,vertices:positions.count,mismatched,heightError});
 });
 window.__wideGround.geometry.computeBoundingBox();const box=window.__wideGround.geometry.boundingBox;
 return{bounds:b.layout.bounds,version:b.battlefieldVersion,peaks:l.peaks.length,valleys:l.valleys.length,rivers:l.rivers.length,fields:l.fields.length,houses:houses.length,
  stats:env.stats,meshes:meshInfo,seaHouses:seaHouses.map(h=>h.id),seaFields:seaFields.map(f=>f.id),water,
  ground:{min:box.min.toArray(),max:box.max.toArray()}};
}"""

INVALID_WATER_POSITION = """unitId=>{
 const b=window.__wideBattle,T=window.TenkaTactics,W=window.TenkaBattlefield,z=T.deploymentZone(b);
 for(let p=Math.ceil(z.zMin+2);p<z.zMax-2;p+=3)for(let x=Math.ceil(z.xMin+2);x<z.xMax-2;x+=2){
  if(b.layout.water.some(w=>W.inside(x,p,w.polygon))&&!b.structures.some(s=>s.kind==='bridge'&&Math.abs(x-s.x)<s.w/2+1&&Math.abs(p-s.z)<s.d/2+1)&&!T.deploy(b,{unitId,x,z:p}).ok)return{x,z:p};
 }throw Error('No forbidden water point in the player deployment zone');
}"""

NEXT_UNIT_POSITION = """unitId=>{
 const b=window.__wideBattle,u=b.units.find(u=>u.id===unitId);
 for(const[dx,dz]of[[12,0],[9,-7],[-9,-7],[7,8],[-12,0]]){
  const x=u.x+dx,z=u.z+dz;
  if(x>=-44&&x<=44&&z>=-50&&z<=42)continue;
  if(window.TenkaTactics.deploy(b,{unitId,x,z}).ok)return{x,z};
 }throw Error('No nearby legal pointer destination outside the old bounds');
}"""


def canvas_pixel(page, canvas, x, z, lift=0):
    point = page.evaluate("""({x,z,lift})=>{
 const camera=window.__wideCamera;camera.updateMatrixWorld(true);
 const p=new camera.position.constructor(x,window.__wideHeightAt(x,z)+lift,z).project(camera);
 return{x:p.x,y:p.y};
}""", {'x': x, 'z': z, 'lift': lift})
    assert abs(point['x']) < .99 and abs(point['y']) < .99, point
    box = canvas.bounding_box()
    return {'x': box['x'] + (point['x'] + 1) * box['width'] / 2, 'y': box['y'] + (1 - point['y']) * box['height'] / 2}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8057')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--screenshots', default='/tmp/tenka-wide-battlefield')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--modes', default='field,siege,defense')
    parser.add_argument('--skip-coastal', action='store_true')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    shots = Path(args.screenshots)
    shots.mkdir(parents=True, exist_ok=True)
    html = instrumented_html()
    checks, errors, landscapes = [], [], []

    def passed(message):
        checks.append(message)
        print('PASS: ' + message, flush=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.chromium, args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in map(int, args.widths.split(',')):
            cases = [{'mode': mode, 'sourceId': 'inabayama' if mode == 'defense' else 'kiyosu', 'targetId': 'kiyosu' if mode == 'defense' else 'inabayama'} for mode in args.modes.split(',')]
            if width > 600 and not args.skip_coastal:
                cases.append({'mode': 'siege', 'sourceId': 'kakunodate', 'targetId': 'wakimoto', 'coastal': True})
            for case in cases:
                label = f'{width}px {case["mode"]} {case["targetId"]}'
                context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                page.route(base + '/', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
                page.goto(base + '/', wait_until='domcontentloaded')
                expect(page.get_by_role('combobox', name='開始する大名', exact=True)).to_be_visible()
                names = page.evaluate(FIXTURE, case)
                page.reload(wait_until='domcontentloaded')
                page.get_by_role('button', name=names['clanName'] + 'の続きから遊ぶ', exact=True).click()
                if case['mode'] == 'defense':
                    page.get_by_role('button', name='籠城を指揮する', exact=True).click()
                else:
                    page.get_by_role('button', name=names['targetName'] + 'へ出陣', exact=True).click()
                    page.get_by_role('button', name=re.compile('^野戦' if case['mode'] == 'field' else '^攻城戦')).click()
                    page.get_by_role('button', name='戦場で采配する', exact=True).click()
                battle = page.get_by_test_id('tactical-battle')
                expect(battle).to_have_attribute('data-phase', 'deployment', timeout=20000)
                toolbar = page.locator('.tenka-deployment')
                expect(toolbar.get_by_text('プレイヤーの布陣', exact=True)).to_be_visible()
                canvas = page.locator('.tactical-canvas canvas')
                expect(canvas).to_be_visible()
                expect(page.locator('.tactical-graphics-error')).to_have_count(0)
                page.wait_for_function('window.__wideEnvironment?.stats.houses>0')
                landscape = page.evaluate(LANDSCAPE)
                assert landscape['bounds']['minX'] == -88 and landscape['bounds']['maxX'] == 88, landscape
                assert landscape['bounds']['minZ'] == -100 and landscape['bounds']['maxZ'] == 84, landscape
                assert landscape['peaks'] >= 2 and landscape['valleys'] >= 1 and landscape['rivers'] >= 1, landscape
                assert landscape['fields'] == 15 and landscape['houses'] == 20, landscape
                assert landscape['stats']['fields'] == landscape['fields'] and landscape['stats']['houses'] == landscape['houses'], landscape
                for mesh_name in ['terrain-following-paddy-fields', 'terrain-following-dry-fields', 'settlement-stone-foundations', 'village-deep-thatched-hip-roofs', 'ordered-rice-and-vegetable-crops']:
                    assert any(mesh['name'] == mesh_name and mesh['visible'] and mesh['count'] > 0 for mesh in landscape['meshes']), (mesh_name, landscape)
                assert any(water['type'] == 'river' and water['visible'] and water['vertices'] >= 3 for water in landscape['water']), landscape
                assert all(water['mismatched'] == 0 and water['heightError'] < .02 for water in landscape['water']), landscape['water']
                assert landscape['ground']['min'][0] <= -88 and landscape['ground']['max'][0] >= 88, landscape
                assert landscape['ground']['min'][2] <= -100 and landscape['ground']['max'][2] >= 84, landscape
                assert landscape['ground']['max'][1] - landscape['ground']['min'][1] > 10, landscape
                assert not landscape['seaHouses'] and not landscape['seaFields'], landscape
                if case.get('coastal'):
                    assert any(water['type'] == 'sea' for water in landscape['water']), landscape
                landscapes.append({'case': label, **landscape})
                passed(label + ': enlarged ground, mountains, valleys, river, fields and villages render on dry land')

                choice = page.evaluate(CHOOSE_WIDE_POSITION)
                picker = toolbar.get_by_role('combobox', name='配置する部隊', exact=True)
                picker.select_option(choice['unitId'])
                expect(picker.locator('option:checked')).to_contain_text('未確認')
                x = toolbar.get_by_role('spinbutton', name='部隊の東西座標', exact=True)
                z = toolbar.get_by_role('spinbutton', name='部隊の南北座標', exact=True)
                x.fill(str(choice['x'])); z.fill(str(choice['z']))
                toolbar.get_by_role('button', name='この位置へ配置', exact=True).click()
                expect(picker.locator('option:checked')).to_contain_text('配置確認済')
                selected = page.get_by_test_id('tactical-unit-' + choice['unitId'])
                expect(selected).to_have_attribute('aria-pressed', 'true')
                expect(selected).to_have_attribute('data-x', str(choice['x']))
                expect(selected).to_have_attribute('data-z', str(choice['z']))
                expect(page.get_by_role('spinbutton', name='配置X', exact=True)).to_have_value(str(choice['x']))
                expect(page.get_by_role('spinbutton', name='配置Z', exact=True)).to_have_value(str(choice['z']))
                passed(label + ': player places a selected unit beyond the old map; the unit list and right editor stay synchronized')

                before = page.evaluate('({count:window.__wideBattle.ledger.length,unit:window.__wideBattle.units.find(u=>u.id===%s)})' % json.dumps(choice['unitId']))
                zone = page.evaluate('window.TenkaTactics.deploymentZone(window.__wideBattle)')
                enemy_z = zone['zMin'] - 1 if zone['zMin'] > 0 else zone['zMax'] + 1
                x.fill(str(choice['x'])); z.fill(str(enemy_z))
                toolbar.get_by_role('button', name='この位置へ配置', exact=True).click()
                assert z.evaluate('(input)=>!input.validity.valid'), 'Enemy deployment zone is rejected by the coordinate form'
                water = page.evaluate(INVALID_WATER_POSITION, choice['unitId'])
                x.fill(str(water['x'])); z.fill(str(water['z']))
                toolbar.get_by_role('button', name='この位置へ配置', exact=True).click()
                expect(toolbar.locator('.tenka-placement-status')).to_contain_text('避け')
                unchanged = page.evaluate('({count:window.__wideBattle.ledger.length,unit:window.__wideBattle.units.find(u=>u.id===%s)})' % json.dumps(choice['unitId']))
                assert unchanged == before, (before, unchanged)
                expect(page.get_by_role('spinbutton', name='配置X', exact=True)).to_have_value(str(choice['x']))
                expect(page.get_by_role('spinbutton', name='配置Z', exact=True)).to_have_value(str(choice['z']))
                passed(label + ': enemy territory and unbridged water cannot replace the player deployment')

                camera_before = page.evaluate('window.__wideCamera.position.toArray()')
                page.get_by_role('button', name='戦場全体', exact=True).click()
                canvas.scroll_into_view_if_needed()
                page.wait_for_timeout(400)
                camera_after = page.evaluate('window.__wideCamera.position.toArray()')
                assert math.dist(camera_before, camera_after) > 5, (camera_before, camera_after)
                projected_corners = page.evaluate("""()=>{
 const box=window.__wideBattle.layout.bounds,c=window.__wideCamera;c.updateMatrixWorld(true);
 return[box.minX,box.maxX].flatMap(x=>[box.minZ,box.maxZ].map(z=>{
  const p=new c.position.constructor(x,window.__wideHeightAt(x,z),z).project(c);return{x:p.x,y:p.y,z:p.z};
 }));
}""")
                assert all(abs(point['x']) < 1 and abs(point['y']) < 1 and -1 < point['z'] < 1 for point in projected_corners), projected_corners
                page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-{case["mode"]}-{case["targetId"]}-wide.png'))
                if width > 600 and case['mode'] == 'field':
                    other = page.evaluate('window.__wideBattle.units.find(u=>u.side===(window.__wideBattle.playerSide||"attacker")&&u.troops>0&&u.id!==%s).id' % json.dumps(choice['unitId']))
                    picker.select_option(other)
                    canvas.scroll_into_view_if_needed()
                    source = canvas_pixel(page, canvas, choice['x'], choice['z'], 1.8)
                    page.mouse.click(source['x'], source['y'])
                    expect(picker).to_have_value(choice['unitId'])
                    target = page.evaluate(NEXT_UNIT_POSITION, choice['unitId'])
                    destination = canvas_pixel(page, canvas, target['x'], target['z'])
                    page.mouse.click(destination['x'], destination['y'])
                    page.wait_for_function('({id,x,z})=>{const u=window.__wideBattle.units.find(u=>u.id===id);return Math.hypot(u.x-x,u.z-z)>3}', arg={'id': choice['unitId'], 'x': choice['x'], 'z': choice['z']})
                    clicked = page.evaluate('window.__wideBattle.units.find(u=>u.id===%s)' % json.dumps(choice['unitId']))
                    assert math.dist([clicked['x'], clicked['z']], [target['x'], target['z']]) < 2, (clicked, target)
                    page.wait_for_function('id=>{const u=window.__wideBattle.units.find(u=>u.id===id),hit=window.__wideUnitHits.get(id);return hit&&Math.hypot(hit.position.x-u.x,hit.position.z-u.z)<.01}', arg=choice['unitId'])
                    target = page.evaluate(NEXT_UNIT_POSITION, choice['unitId'])
                    source = canvas_pixel(page, canvas, clicked['x'], clicked['z'], 1.8)
                    destination = canvas_pixel(page, canvas, target['x'], target['z'])
                    page.mouse.move(source['x'], source['y']); page.mouse.down()
                    page.mouse.move(destination['x'], destination['y'], steps=10); page.mouse.up()
                    page.wait_for_function('({id,x,z})=>{const u=window.__wideBattle.units.find(u=>u.id===id);return Math.hypot(u.x-x,u.z-z)>3}', arg={'id': choice['unitId'], 'x': clicked['x'], 'z': clicked['z']})
                    dragged = page.evaluate('window.__wideBattle.units.find(u=>u.id===%s)' % json.dumps(choice['unitId']))
                    assert math.dist([dragged['x'], dragged['z']], [target['x'], target['z']]) < 2, (dragged, target)
                    choice['x'], choice['z'] = dragged['x'], dragged['z']
                    assert abs(choice['x']) > 44 or choice['z'] > 42 or choice['z'] < -50, choice
                    display = page.evaluate('({x:String(Number(%s.x.toFixed(1))),z:String(Number(%s.z.toFixed(1)))})' % (json.dumps(dragged), json.dumps(dragged)))
                    expect(page.get_by_role('spinbutton', name='配置X', exact=True)).to_have_value(display['x'])
                    expect(page.get_by_role('spinbutton', name='配置Z', exact=True)).to_have_value(display['z'])
                    canvas.scroll_into_view_if_needed()
                    page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-{case["targetId"]}-unit-pointer-deployment.png'))
                    passed(label + ': actual canvas clicks select and place the unit outside the old map; pointer drag updates its position and right editor')
                if width > 600 and case['mode'] == 'siege' and not case.get('coastal'):
                    page.get_by_role('button', name='城郭を見る', exact=True).click()
                    canvas.scroll_into_view_if_needed(); page.wait_for_timeout(250)
                    page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-{case["targetId"]}-castle.png'))
                    page.evaluate("""()=>{
 const town=window.__wideBattle.layout.landscape.settlements.find(s=>s.kind==='town'),y=window.__wideHeightAt(town.x,town.z);
 window.__wideControls.target.set(town.x,y+1.5,town.z);
 window.__wideCamera.position.set(town.x+23,y+18,town.z+26);
 window.__wideControls.update();window.__wideRenderer.update(window.__wideBattle);
}""")
                    page.wait_for_timeout(250)
                    page.locator('.tactical-canvas').screenshot(path=str(shots / f'{width}-{case["targetId"]}-town.png'))
                toolbar.scroll_into_view_if_needed()
                geometry = page.evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
                assert geometry['document'] <= geometry['viewport'] + 1, geometry
                page.get_by_role('button', name='戦闘開始', exact=True).click()
                expect(battle).to_have_attribute('data-phase', 'fighting')
                page.wait_for_function('window.__wideStart?.phase==="fighting"')
                start_unit = page.evaluate('window.__wideStart.units.find(u=>u.id===%s)' % json.dumps(choice['unitId']))
                assert start_unit['x'] == choice['x'] and start_unit['z'] == choice['z'], start_unit
                assert page.evaluate('window.__wideStart.ledger.some(e=>e.kind==="deploy"&&e.command.unitId===%s)' % json.dumps(choice['unitId'])), 'The player deployment remains in the battle record'
                expect(toolbar).to_have_count(0)
                expect(page.locator('.tactical-graphics-error')).to_have_count(0)
                passed(label + ': full battlefield camera works; battle starts with the chosen position and its command record')
                context.close()
        browser.close()
    assert not errors, errors
    summary = {'checks': checks, 'browser_errors': errors, 'landscapes': landscapes, 'screenshots': str(shots)}
    (shots / 'results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps({'checks': checks, 'browser_errors': errors, 'screenshots': str(shots)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
