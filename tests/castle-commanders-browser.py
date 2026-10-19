#!/usr/bin/env python3
"""Check native castle-commander choices and saves on desktop and mobile.

Only the unrelated nationwide Three.js map is replaced by a no-op. Fixtures use
native stationing and valid saves; selections and appointments use real React
controls and Game.arrange. No army command, validation or storage is mocked.
"""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = """kind=>{
 const G=window.TenkaGame;let s=G.newGame();s.gold=100000;s.food=1000000;
 if(kind==='local'){
  const moved=window.TenkaRetainers.act(s,{type:'station',officerId:'shibata_katsuie',castleId:'inuyama'});
  if(!moved.ok)throw Error(moved.message);s=moved.state;
  s.officers.find(o=>o.id==='oda_nobutada').castleId='inuyama';
 }else{
  s.officers.find(o=>o.id==='oda_nobukiyo').castleId='kiyosu';
  s.armies.inuyama.commanderId=null;
 }
 s.selectedCastleId='inuyama';
 s.alliances=[...new Set(s.castles.map(c=>c.clan))].filter(id=>id!==s.playerClan);
 s.allianceExpires=Object.fromEntries(s.alliances.map(id=>[id,s.turn+12]));
 for(const c of s.castles){c.gold=0;c.food=0;}
 if(!G.validate(s)||!G.save(s))throw Error('Commander fixture must validate and save: '+kind);
 return s;
}"""


def instrumented_html():
    html = (ROOT / 'index.html').read_text()
    marker = '(0,zv.createRoot)(document.getElementById(`root`))'
    assert html.count(marker) == 1
    setup = """Mv=()=>new Proxy({},{get:()=>()=>{}});
const commanderFixture=new URLSearchParams(location.search).get('commanderFixture');
if(commanderFixture){(""" + FIXTURE + ")(commanderFixture);history.replaceState(null,'',location.pathname);}\n"
    return html.replace(marker, setup + marker, 1)


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def retained(state):
    return {
        'locations': {o['id']: o['castleId'] for o in state['officers'] if o['clan'] == state['playerClan']},
        'units': {c['id']: state['armies'][c['id']]['units'] for c in state['castles'] if c['clan'] == state['playerClan']},
        'orders': {id: state['tenka']['castleOrders']['castles'][id]['remaining'] for id in ['kiyosu', 'inuyama']},
        **{key: state[key] for key in ['gold', 'food', 'turn', 'month', 'actionPoints']},
    }


def no_overflow(page, panel):
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    bad = panel.locator('button,input,select').evaluate_all("""nodes=>nodes.flatMap(n=>{
 const r=n.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{name:n.getAttribute('aria-label')||n.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not bad, bad


def check(page, url, width, kind, shots, passed):
    print(f'STEP {width}px {kind}', flush=True)
    page.goto(url + '?commanderFixture=' + kind, wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame&&!!window.TenkaRetainers')
    before = saved(page)
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    page.get_by_role('button', name='大将・兵科を編制する', exact=True).click()
    panel = page.get_by_role('dialog', name='犬山城 軍備と編制', exact=True)
    selector = panel.get_by_role('combobox', name='総大将', exact=True)
    button = panel.get_by_role('button', name='編成を保存', exact=True)
    values = selector.locator('option').evaluate_all('nodes=>nodes.filter(n=>n.value).map(n=>n.value)')
    if kind == 'local':
        assert set(values) == {'oda_nobukiyo', 'shibata_katsuie'}, values
        assert 'oda_nobunaga' not in values, 'the lord stationed in Kiyosu cannot command Inuyama'
        assert 'oda_nobutada' not in values, 'a local child cannot be appointed'
        selector.select_option('shibata_katsuie')
        expect(button).to_be_enabled()
        no_overflow(page, panel)
        panel.screenshot(path=str(shots / f'{width}-local-commanders.png'))
        button.click()
        page.wait_for_function("window.TenkaGame.load().armies.inuyama.commanderId==='shibata_katsuie'")
        after = saved(page)
        assert retained(after) == retained(before), 'appointment preserves homes, troops, money, provisions and source/destination orders'
        page.reload(wait_until='domcontentloaded')
        page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
        restored = saved(page)
        assert retained(restored) == retained(before)
        assert restored['armies']['inuyama']['commanderId'] == 'shibata_katsuie'
        page.get_by_role('button', name='大将・兵科を編制する', exact=True).click()
        expect(page.get_by_role('combobox', name='総大将', exact=True)).to_have_value('shibata_katsuie')
        passed(f'{width}px: only stationed adult retainers appear; explicit local appointment saves/reloads without moving anyone or spending orders/resources')
    else:
        assert not values, values
        expect(selector).to_be_disabled()
        expect(button).to_be_disabled()
        expect(panel.get_by_role('status')).to_contain_text('「家臣」の城配置')
        no_overflow(page, panel)
        panel.screenshot(path=str(shots / f'{width}-no-local-commanders.png'))
        assert retained(saved(page)) == retained(before)
        passed(f'{width}px: a castle without stationed adults disables appointment and explains explicit retainer stationing')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8065')
    parser.add_argument('--screenshots', default='/tmp/tenka-castle-commanders-browser')
    args = parser.parse_args()
    shots = Path(args.screenshots); shots.mkdir(parents=True, exist_ok=True)
    url = args.url.rstrip('/') + '/'
    checks, errors = [], []
    html = instrumented_html()
    def passed(message):
        checks.append(message)
        print('PASS: ' + message, flush=True)
        (shots / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, ensure_ascii=False, indent=2))
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in [1440, 390]:
            context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
            context.set_default_timeout(30000)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.route(re.compile(re.escape(url) + r'(?:\?.*)?$'), lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            try:
                for kind in ['local', 'none']:
                    check(page, url, width, kind, shots, passed)
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
