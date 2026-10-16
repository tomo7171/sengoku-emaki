#!/usr/bin/env python3
"""Check the actual 3D castle, gate breach, and siege settlement in Chromium.

Serve this repository, then run:
  python tests/castle-renderer-browser.py --url http://127.0.0.1:8047

Campaign fixtures use production save validation. Battles and cameras are opened
through the actual UI. A test-only route exposes the private renderer and model
registry so the gate's visible state can be checked without adding debug exports
to the shipped game. The capture check uses the production simulation and ledger.
"""
import argparse
import json
import math
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CAMPAIGN = """({sourceId,targetId,opposingClan}) => {
 const G=window.TenkaGame,state=G.newGame();
 const source=state.castles.find(c=>c.id===sourceId);
 const target=state.castles.find(c=>c.id===targetId);
 state.playerClan=source.clan;state.selectedCastleId=targetId;state.alliances=[];
 if(opposingClan){
  target.clan=opposingClan;target.clanName=G.clans[opposingClan].name;target.color=G.clans[opposingClan].color;
  for(const officer of state.officers.filter(o=>o.castleId===targetId))officer.castleId=sourceId;
  state.armies[targetId].commanderId=null;
 }
 for(const [castle,units] of [[source,{ashigaru:4000,archer:500,cavalry:0,firearm:2000,navy:0}],[target,{ashigaru:250,archer:100,cavalry:0,firearm:50,navy:0}]]){
  castle.troops=Object.values(units).reduce((a,b)=>a+b,0);
  state.armies[castle.id].units={...units};
 }
 if(!G.validate(state)||!G.save(state))throw Error('Invalid siege campaign fixture');
 return {targetName:target.name,clanName:G.clans[source.clan].name};
}"""


def instrumented_html():
    """Use the shipped script verbatim apart from test-only observation points."""
    html = (ROOT / 'index.html').read_text()
    registry = 'let Ne = new Map(),'
    assert html.count(registry) == 1, 'Find the production castle model registry'
    html = html.replace(registry, 'let Ne = (window.__castleTestScene=u,window.__castleTestCamera=f,window.__castleTestEntries=new Map()),', 1)
    attach = 'e.appendChild(d.domElement));'
    renderer_start = html.index('function G_(')
    attach_start = html.index(attach, renderer_start)
    html = html[:attach_start] + html[attach_start:].replace(attach, attach + '\n    window.__castleTestWebglRenderer=d;', 1)
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert marker in html, 'Find the production React bootstrap'
    observe = """
const castleTestTextureFactory=window.TenkaFortressMaterials.createTextures;
window.TenkaFortressMaterials={...window.TenkaFortressMaterials,createTextures:(...args)=>{
 const maps=castleTestTextureFactory(...args);
 window.__castleTestFortressMaps=maps;
 window.__castleTestFortressDecoded=null;
 maps?.ready?.then(decoded=>{if(window.__castleTestFortressMaps===maps)window.__castleTestFortressDecoded=decoded;});
 return maps;
}};
const castleTestOriginalRenderer=G_;
G_=(mount,options)=>{
 const renderer=castleTestOriginalRenderer(mount,options);
 window.__castleTestRenderer=renderer;
 window.__castleTestBattle=options.battle;
 const update=renderer.update;
 renderer.update=(battle,...rest)=>{
  window.__castleTestBattle=battle;
  return update(battle,...rest);
 };
 return renderer;
};
"""
    return html.replace(marker, observe + marker, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8047')
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    parser.add_argument('--screenshots', default='/tmp/tenka-fortress-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--castles', default='nanao,kiyosu,shuri')
    args = parser.parse_args()
    base = args.url.rstrip('/')
    screenshots = Path(args.screenshots)
    screenshots.mkdir(parents=True, exist_ok=True)
    html = instrumented_html()
    results, errors, render_stats, architecture_stats = [], [], [], []

    def passed(message):
        results.append(message)
        print('PASS: ' + message, flush=True)

    cases = [
        {'sourceId': 'toyama', 'targetId': 'nanao'},
        {'sourceId': 'inabayama', 'targetId': 'kiyosu'},
        # A changed owner makes the normally peaceful Ryukyu land connection a
        # valid synthetic siege fixture while preserving its stone castle plan.
        {'sourceId': 'zakimi', 'targetId': 'shuri', 'opposingClan': 'oda'},
    ]
    selected_castles = set(args.castles.split(','))
    cases = [case for case in cases if case['targetId'] in selected_castles]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=args.chromium, headless=True,
            args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        )
        for width in map(int, args.widths.split(',')):
            for case in cases if width > 600 else cases[:1]:
                context = browser.new_context(viewport={'width': width, 'height': 1000 if width > 600 else 844})
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
                page.route(base + '/', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
                page.goto(base + '/', wait_until='domcontentloaded')
                expect(page.get_by_role('combobox', name='開始する大名', exact=True)).to_be_visible()
                names = page.evaluate(CAMPAIGN, case)
                page.reload(wait_until='domcontentloaded')
                page.get_by_role('button', name=names['clanName'] + 'の続きから遊ぶ', exact=True).click()
                page.evaluate('window.__castleTestCampaign=window.TenkaGame.load()')
                page.get_by_role('button', name=names['targetName'] + 'へ出陣', exact=True).click()
                page.get_by_role('button', name=re.compile('^攻城戦')).click()
                page.get_by_role('button', name='戦場で采配する', exact=True).click()
                battle = page.get_by_test_id('tactical-battle')
                expect(battle).to_have_attribute('data-phase', 'deployment', timeout=20000)
                canvas = page.locator('.tactical-canvas canvas')
                expect(canvas).to_be_visible()
                expect(page.locator('.tactical-graphics-error')).to_have_count(0)
                page.wait_for_function('window.__castleTestEntries?.size>0')
                assert page.evaluate('!!window.TenkaCastleModels'), 'The detailed 3D castle module is loaded'
                page.wait_for_function('window.__castleTestFortressDecoded?.length===3&&window.__castleTestFortressDecoded.every(Boolean)')
                textures = page.evaluate('Object.fromEntries(["stone","earth","plaster"].map(name=>[name,{name:window.__castleTestFortressMaps[name].name,width:window.__castleTestFortressMaps[name].image.width,height:window.__castleTestFortressMaps[name].image.height}]))')
                assert all(item['width'] >= 512 and item['height'] >= 512 for item in textures.values()), textures
                passed(f'{width}px {case["targetId"]}: three new stone, earth and plaster material photographs decode')
                architecture = page.evaluate("""()=>{
 const entries=[...window.__castleTestEntries].map(([id,entry])=>({id,...entry.group.userData.castleModel,
  hitHeight:entry.hit.geometry.parameters.height,hitCenter:entry.hit.position.y-entry.group.position.y}));
 const precinct=window.__castleTestScene.getObjectByName('castle-precinct-earthworks');
 const names=window.__castleTestScene.getObjectByName('castle-bailey-names');
 return {entries,precinct:precinct?.userData.precincts,precinctMeshes:precinct?.children.length,
  labels:names?.children.map(sprite=>({name:sprite.name,role:sprite.userData.baileyRole})),
  baileys:window.__castleTestBattle.layout.baileys.length};
}""")
                principal = [item for item in architecture['entries'] if item.get('principal')]
                assert principal and all(item['storeys'] >= 2 for item in principal), principal
                assert all(item['storeys'] >= 2 for item in architecture['entries'] if item['kind'] in ['gate', 'watchtower']), architecture
                assert all(item['hitHeight'] + .001 >= item['visualHeight'] for item in architecture['entries']), architecture
                assert all(math.isclose(item['hitCenter'], item['hitHeight'] / 2, abs_tol=.001) for item in architecture['entries']), architecture
                assert architecture['precinct'] and architecture['precinctMeshes'] > 0, architecture
                assert architecture['precinct']['earthSegments'] + architecture['precinct']['stoneSegments'] > 0, architecture
                if case['targetId'] == 'nanao':
                    assert architecture['precinct']['earthSegments'] > 0 and architecture['precinct']['stoneSegments'] > 0, architecture
                if case['targetId'] in ['nanao', 'kiyosu']:
                    assert any(item.get('architecture') == 'roofed-earth-wall' for item in architecture['entries']), architecture
                assert len(architecture['labels']) == architecture['baileys'], architecture
                roles = [label['role'] for label in architecture['labels']]
                assert roles.count('honmaru') == 1 and roles.count('ninomaru') <= 1 and roles.count('sannomaru') <= 1, roles
                if case['targetId'] == 'nanao':
                    assert all(role in roles for role in ['honmaru', 'ninomaru', 'sannomaru', 'support']), roles
                architecture_stats.append({'width': width, 'castle': case['targetId'], 'principal': principal, 'precinct': architecture['precinct']})
                passed(f'{width}px {case["targetId"]}: multi-storey hall, turrets and gates have matching higher hitboxes; retaining masonry and bailey labels render')
                for label, suffix in [('城郭を見る', 'castle'), ('城門に寄る', 'gate')]:
                    page.get_by_role('button', name=label, exact=True).click()
                    canvas.scroll_into_view_if_needed()
                    page.wait_for_timeout(450)
                    page.locator('.tactical-canvas').screenshot(path=str(screenshots / f'{width}-{case["targetId"]}-{suffix}.png'))
                    statistics = page.evaluate('({calls:window.__castleTestWebglRenderer.info.render.calls,triangles:window.__castleTestWebglRenderer.info.render.triangles,geometries:window.__castleTestWebglRenderer.info.memory.geometries,textures:window.__castleTestWebglRenderer.info.memory.textures})')
                    render_stats.append({'width': width, 'castle': case['targetId'], 'camera': suffix, **statistics})
                passed(f'{width}px {case["targetId"]}: actual siege UI renders castle and gate camera views')

                page.get_by_role('button', name='城郭を見る', exact=True).click()
                page.get_by_role('button', name='曲輪名を隠す', exact=True).click()
                page.wait_for_function("window.__castleTestScene.getObjectByName('castle-bailey-names').visible===false")
                page.get_by_role('button', name='曲輪名を表示', exact=True).click()
                page.wait_for_function("window.__castleTestScene.getObjectByName('castle-bailey-names').visible===true")
                last_camera = page.evaluate('window.__castleTestCamera.position.toArray()')
                for role, label in [('honmaru', '本丸'), ('ninomaru', '二の丸'), ('sannomaru', '三の丸')]:
                    button = page.get_by_role('button', name=label + 'を見る', exact=True)
                    if role not in roles:
                        expect(button).to_have_count(0)
                        continue
                    button.click()
                    canvas.scroll_into_view_if_needed()
                    page.wait_for_timeout(350)
                    position = page.evaluate('window.__castleTestCamera.position.toArray()')
                    assert math.dist(position, last_camera) > .1, (role, position, last_camera)
                    last_camera = position
                    if case['targetId'] == 'nanao':
                        page.locator('.tactical-canvas').screenshot(path=str(screenshots / f'{width}-{case["targetId"]}-{role}.png'))
                passed(f'{width}px {case["targetId"]}: bailey name toggle and existing honmaru/ninomaru/sannomaru camera controls work')
                page.get_by_role('button', name='城門に寄る', exact=True).click()
                canvas.scroll_into_view_if_needed()

                gate = page.evaluate("""()=>{
 const gate=window.__castleTestBattle.structures.find(s=>(s.kind||s.type)==='gate');
 const entry=window.__castleTestEntries.get(gate.id);
 return {id:gate.id,visible:entry.group.visible,active:entry.hit.userData.active,
  door:!!entry.door,rotation:entry.door?.rotation.x,
  namedDoor:entry.door?.name,parts:entry.door?.children.length,model:entry.group.userData.castleModel};
}""")
                assert gate['door'] and gate['visible'] and gate['active'], gate
                assert gate.get('model', {}).get('kind') == 'gate', gate
                page.evaluate("""id=>{
 window.__castleTestOriginalBattle=window.__castleTestBattle;
 const visual=JSON.parse(JSON.stringify(window.__castleTestBattle));
 visual.structures.find(s=>s.id===id).hp=0;
 window.__castleTestRenderer.update(visual);
}""", gate['id'])
                page.wait_for_function("id=>window.__castleTestEntries.get(id).hit.userData.active===false", arg=gate['id'])
                breached = page.evaluate("""id=>{
 const entry=window.__castleTestEntries.get(id);
 return {frame:entry.group.visible,active:entry.hit.userData.active,rotation:entry.door.rotation.x};
}""", gate['id'])
                assert breached['frame'] and not breached['active'], breached
                assert math.isclose(breached['rotation'], -math.pi / 2, abs_tol=.01), breached
                page.locator('.tactical-canvas').screenshot(path=str(screenshots / f'{width}-{case["targetId"]}-gate-breached.png'))
                page.evaluate('window.__castleTestRenderer.update(window.__castleTestOriginalBattle)')
                passed(f'{width}px {case["targetId"]}: breached gate lowers its door and retains an open frame')

                if case['targetId'] == 'nanao':
                    page.get_by_role('button', name='曲輪名を隠す', exact=True).click()
                    page.wait_for_function("window.__castleTestScene.getObjectByName('castle-bailey-names').visible===false")
                    page.get_by_role('button', name='戦闘開始', exact=True).click()
                    expect(battle).to_have_attribute('data-phase', 'fighting')
                    page.wait_for_timeout(1000)
                    assert page.evaluate("window.__castleTestScene.getObjectByName('castle-bailey-names').visible===false"), 'Hidden bailey labels remain hidden across battle ticks'
                    page.get_by_role('button', name='曲輪名を表示', exact=True).click()
                    page.wait_for_function("window.__castleTestScene.getObjectByName('castle-bailey-names').visible===true")
                    assert page.evaluate("window.__castleTestScene.getObjectByName('castle-bailey-names').children.some(sprite=>sprite.visible)"), 'Showing bailey labels restores actual sprites from the gate view'
                    page.get_by_role('button', name='一時停止', exact=True).click()
                    passed(f'{width}px nanao: hidden bailey labels persist through battle start and ticks, then can be shown again')

                if case['targetId'] == 'nanao' and width > 600:
                    settled = page.evaluate("""()=>{
 const G=window.TenkaGame,b=JSON.parse(JSON.stringify(window.__castleTestBattle));
 let steps=0;
 while(b.phase==='fighting'&&steps<15000){
  let batch=0;
  while(b.phase==='fighting'&&batch<8){G.simulateTick(b);steps++;batch++;}
  b.ledger.push({kind:'tick',steps:batch});
 }
 const result=G.settle(window.__castleTestCampaign,b);
 window.__castleTestRenderer.update(b);
 return {phase:b.phase,outcome:b.outcome,steps,gates:b.structures.filter(s=>s.kind==='gate').map(s=>s.hp),
  ok:result.ok,message:result.message,valid:result.ok&&G.validate(result.state),
  owner:result.state.castles.find(c=>c.id==='nanao').clan,player:result.state.playerClan};
}""")
                    assert settled['phase'] == 'finished' and settled['outcome'] == 'captured', settled
                    assert settled['ok'] and settled['valid'] and settled['owner'] == settled['player'], settled
                    assert all(hp == 0 for hp in settled['gates']), settled
                    page.wait_for_timeout(150)
                    passed('1440px nanao: production simulation breaches every gate and settles a valid castle capture')

                geometry = page.evaluate('({viewport:innerWidth,document:document.documentElement.scrollWidth})')
                assert geometry['document'] <= geometry['viewport'] + 1, geometry
                expect(page.locator('.tactical-graphics-error')).to_have_count(0)
                context.close()
        browser.close()
    assert not errors, errors
    print(json.dumps({'checks': results, 'browser_errors': errors, 'render_stats': render_stats, 'architecture_stats': architecture_stats, 'screenshots': str(screenshots)}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
