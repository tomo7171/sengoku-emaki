#!/usr/bin/env python3
"""Exercise marriage, diplomatic decisions and estate management in the shipped UI.

Campaign fixtures are validated real saves. All commands, month changes and
storage restoration run through production React and campaign engines.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


FIXTURE = """kind=>{
 const G=window.TenkaGame,D=window.TenkaDiplomacy;
 let s=G.newGame();s.selectedCastleId='kiyosu';s.gold=100000;s.food=1000000;s.prestige=90;
 if(kind==='marriage'){s.year=1577;s.month=3;s.turn=(1577-1560)*12+1;s.season=0;}
 s=G.migrate(s);
 const clans=[...new Set(s.castles.map(c=>c.clan))];
 s.npcPacts=clans.flatMap((first,index)=>clans.slice(index+1).map(second=>[first,second]));
 s.alliances=['matsudaira'];s.allianceExpires={matsudaira:s.turn+12};s.relations.matsudaira=85;
 if(kind==='marriage')for(const c of s.castles.filter(c=>c.clan==='matsudaira')){
  c.troops=150;s.armies[c.id].units={ashigaru:150,archer:0,cavalry:0,firearm:0,navy:0};
 }
 if(kind==='subjugate'){
  for(const c of s.castles.filter(c=>c.clan==='saito')){c.troops=300;s.armies[c.id].units={ashigaru:300,archer:0,cavalry:0,firearm:0,navy:0};}
  s.relations.saito=100;
 }
 if(kind==='stocks')s.tenka.estates.kiyosu.unrest=50;
 if(kind==='scarce')s.food=1200+window.TenkaSystems.getView(s).economy.totals.foodUpkeep*2-1;
 s=D.initialize(s);
 if(!G.validate(s)||!G.save(s))throw Error('Council fixture must validate and save: '+kind);
 return s;
}"""


def castle(state, name):
    return next(c for c in state['castles'] if c['id'] == name)


def remaining(state, name):
    return state['tenka']['castleOrders']['castles'][name]['remaining']


def saved(page):
    state = page.evaluate('window.TenkaGame.load()')
    assert state and page.evaluate('s=>window.TenkaGame.validate(s)', state)
    return state


def resume(page, url, kind=None):
    if page.url == 'about:blank':
        page.goto(url, wait_until='domcontentloaded')
    page.wait_for_function('!!window.TenkaGame && !!window.TenkaDiplomacy')
    before = page.evaluate(FIXTURE, kind) if kind else None
    page.reload(wait_until='domcontentloaded')
    page.get_by_role('button', name='織田家の続きから遊ぶ', exact=True).click()
    return before


def council(page, tab='政務'):
    page.get_by_role('button', name='評定を開く', exact=True).click()
    panel = page.locator('.tenka-council')
    panel.get_by_role('button', name=tab, exact=True).click()
    expect(panel).to_be_visible()
    return panel


def no_overflow(page, region):
    metrics = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    assert metrics['scroll'] <= metrics['width'] + 1, metrics
    bad = region.locator('select,input,button').evaluate_all("""nodes=>nodes.flatMap(node=>{
 const r=node.getBoundingClientRect();return r.width&&(r.left<-.5||r.right>innerWidth+.5)?[{name:node.getAttribute('aria-label')||node.textContent,left:r.left,right:r.right}]:[];
})""")
    assert not bad, bad


def marriage_and_break(page, url, width, shots, passed):
    before = resume(page, url, 'marriage')
    panel = council(page, '外交')
    panel.get_by_role('combobox', name='命令を出す城', exact=True).select_option('inuyama')
    panel.get_by_role('combobox', name='交渉先の拠点', exact=True).select_option('okazaki')
    form = panel.get_by_role('region', name='姫と婚姻相手を選ぶ', exact=True)
    form.get_by_role('combobox', name='婚姻する姫を選ぶ', exact=True).select_option('oda_tokuhime')
    form.get_by_role('combobox', name='婚姻を申し込む家を選ぶ', exact=True).select_option('matsudaira')
    actual = page.evaluate("s=>window.TenkaDiplomacy.getView(s,{princessId:'oda_tokuhime'}).marriageClans.find(c=>c.id==='matsudaira').spouses", before)
    assert len(actual) >= 2
    spouse = actual[-1]
    spouse_select = form.get_by_role('combobox', name='婚姻する相手の武将を選ぶ', exact=True)
    spouse_select.select_option(spouse['id'])
    expect(spouse_select).to_have_value(spouse['id'])
    expect(form).to_contain_text('金 300 貫 ／ 犬山城の命令 1')
    no_overflow(page, form)
    form.screenshot(path=str(shots / f'{width}-actual-spouse-choice.png'))
    form.get_by_role('button', name='婚姻を結ぶ', exact=True).click()
    page.wait_for_function("id=>window.TenkaGame.load().officers.find(o=>o.id==='oda_tokuhime').marriedTo===id", arg=spouse['id'])
    married = saved(page)
    assert next(o for o in married['officers'] if o['id'] == spouse['id'])['marriedTo'] == 'oda_tokuhime'
    assert married['gold'] == before['gold'] - 300
    assert remaining(married, 'inuyama') == 2 and remaining(married, 'kiyosu') == 3
    management = panel.get_by_role('region', name='婚姻・恭順・同盟破棄', exact=True)
    review = management.get_by_role('button', name='同盟破棄を検討する', exact=True)
    review.click()
    confirmation = management.locator('.tenka-diplomacy-confirm')
    expect(confirmation).to_contain_text('友好度40と威信10')
    assert saved(page)['alliances'] == married['alliances']
    no_overflow(page, confirmation)
    confirmation.get_by_role('button', name='盟約を維持する', exact=True).click()
    expect(confirmation).to_have_count(0)
    assert saved(page)['relations']['matsudaira'] == married['relations']['matsudaira']
    review.click()
    confirmation.screenshot(path=str(shots / f'{width}-alliance-break-review.png'))
    confirmation.get_by_role('button', name='同盟破棄を確定する', exact=True).click()
    page.wait_for_function("!window.TenkaGame.load().alliances.includes('matsudaira')")
    broken = saved(page)
    assert broken['relations']['matsudaira'] == married['relations']['matsudaira'] - 40
    assert broken['prestige'] == married['prestige'] - 10
    assert remaining(broken, 'inuyama') == 1
    assert next(o for o in broken['officers'] if o['id'] == 'oda_tokuhime')['marriedTo'] == spouse['id']
    panel.get_by_role('button', name='次の月へ →', exact=True).click()
    page.wait_for_function('turn=>window.TenkaGame.load().turn>turn', arg=broken['turn'])
    advanced = saved(page)
    assert 'matsudaira' not in advanced['alliances']
    assert advanced['tenka']['dynasty']['marriages'][-1]['allianceBroken']
    resume(page, url)
    restored = saved(page)
    assert 'matsudaira' not in restored['alliances']
    assert next(o for o in restored['officers'] if o['id'] == 'oda_tokuhime')['marriedTo'] == spouse['id']
    passed(f'{width}px: actual allied spouse selection; review/cancel/confirm alliance break; real costs, surviving marriage and no monthly alliance renewal after reload')


def submission(page, url, width, shots, passed):
    before = resume(page, url, 'subjugate')
    panel = council(page, '外交')
    panel.get_by_role('combobox', name='交渉先の拠点', exact=True).select_option('inabayama')
    panel.get_by_role('combobox', name='評定の担当武将', exact=True).select_option('oda_nobunaga')
    management = panel.get_by_role('region', name='婚姻・恭順・同盟破棄', exact=True)
    expect(management).to_contain_text('自家と相手の国力比')
    expect(management).to_contain_text('金 400 貫')
    button = management.get_by_role('button', name='恭順を求める', exact=True)
    expect(button).to_be_enabled()
    no_overflow(page, management)
    management.screenshot(path=str(shots / f'{width}-submission-preview.png'))
    button.click()
    page.wait_for_function("window.TenkaGame.load().tenka.assignments.oda_nobunaga?.type==='subjugate'")
    after = saved(page)
    assert after['gold'] == before['gold'] - 400 and remaining(after, 'kiyosu') == 2
    assert after['castles'] == before['castles']
    history = after['tenka']['diplomacy']['history'][0]
    assert history['type'] == 'subjugate' and history['outcome'] in ['success', 'refused']
    expect(management).to_contain_text(history['message'])
    assert after['tenka']['diplomacy']['attempts'][0]['targetClan'] == 'saito'
    expect(button).to_be_disabled()
    management.screenshot(path=str(shots / f'{width}-submission-result.png'))
    passed(f"{width}px: real submission result {history['outcome']}; preview, 400-gold/source-order cost, assignment and repeat guard; no castle annexation")


def construction(page, url, width, shots, passed):
    before = resume(page, url, 'estate')
    panel = council(page)
    estate = panel.get_by_role('region', name='領国の経営計画', exact=True)
    expect(estate).to_contain_text('全領国の月間収支')
    expect(estate).to_contain_text('農作業の効率')
    expect(estate).to_contain_text('完成まで 9 か月')
    no_overflow(page, estate)
    estate.screenshot(path=str(shots / f'{width}-estate-budget.png'))
    estate.get_by_role('button', name='田畑の開墾に着手', exact=True).click()
    page.wait_for_function("window.TenkaGame.load().tenka.estates.kiyosu.projects.some(p=>p.type==='reclaim')")
    started = saved(page)
    project = next(p for p in started['tenka']['estates']['kiyosu']['projects'] if p['type'] == 'reclaim')
    assert project['remaining'] == 9
    assert started['gold'] == before['gold'] - 300 and remaining(started, 'kiyosu') == 2
    assert remaining(started, 'inuyama') == 3
    expect(estate).to_contain_text('完成まであと 9 / 9 か月')
    expect(estate.get_by_role('button', name='田畑の開墾に着手', exact=True)).to_be_disabled()
    for i in range(9):
        panel.get_by_role('button', name='次の月へ →', exact=True).click()
        page.wait_for_function('turn=>window.TenkaGame.load().turn===turn', arg=started['turn'] + i + 1)
    complete = saved(page)
    assert not complete['tenka']['estates']['kiyosu']['projects']
    assert castle(complete, 'kiyosu')['kokudaka'] == castle(started, 'kiyosu')['kokudaka'] + project['gain']
    assert complete['tenka']['economy']['ledger']
    expect(estate).to_contain_text('現在、進行中の工事はありません')
    no_overflow(page, estate)
    estate.screenshot(path=str(shots / f'{width}-completed-estate.png'))
    passed(f'{width}px: forecast, reserves, workforce and project costs visible; actual reclamation finishes after nine UI-driven months and balances are recorded')


def policy_and_stocks(page, url, width, shots, passed):
    before = resume(page, url, 'estate')
    panel = council(page)
    estate = panel.get_by_role('region', name='領国の経営計画', exact=True)
    policy = estate.get_by_role('combobox', name='年貢と税の方針', exact=True)
    expect(estate.get_by_role('button', name='税の方針を改める', exact=True)).to_be_disabled()
    policy.select_option('low')
    estate.get_by_role('button', name='税の方針を改める', exact=True).click()
    page.wait_for_function("window.TenkaGame.load().tenka.estates.kiyosu.taxPolicy==='low'")
    expect(policy).to_be_disabled()
    estate.get_by_role('button', name='兵糧を買い入れる', exact=True).click()
    page.wait_for_function('food=>window.TenkaGame.load().food===food', arg=before['food'] + 1200)
    number = estate.get_by_role('spinbutton', name='解兵する人数', exact=True)
    expect(estate.get_by_role('button', name='指定人数を解兵する', exact=True)).to_be_disabled()
    number.fill('400.5')
    expect(estate.get_by_role('button', name='指定人数を解兵する', exact=True)).to_be_disabled()
    number.fill('400')
    estate.get_by_role('button', name='指定人数を解兵する', exact=True).click()
    page.wait_for_function('troops=>window.TenkaGame.load().castles.find(c=>c.id==="kiyosu").troops===troops', arg=castle(before, 'kiyosu')['troops'] - 400)
    after = saved(page)
    assert remaining(after, 'kiyosu') == 0 and remaining(after, 'inuyama') == 3
    assert after['gold'] == before['gold'] - 400
    assert after['food'] == before['food'] + 1200
    expect(estate).to_contain_text('今月変更済み')
    expect(estate.get_by_role('button', name='田畑の開墾に着手', exact=True)).to_be_disabled()
    no_overflow(page, estate)
    estate.screenshot(path=str(shots / f'{width}-policy-and-demobilization.png'))
    resume(page, url)
    assert saved(page)['tenka']['estates']['kiyosu']['taxPolicy'] == 'low'
    before = resume(page, url, 'stocks')
    panel = council(page)
    estate = panel.get_by_role('region', name='領国の経営計画', exact=True)
    estate.get_by_role('button', name='兵糧を売却する', exact=True).click()
    page.wait_for_function('gold=>window.TenkaGame.load().gold===gold', arg=before['gold'] + 300)
    estate.get_by_role('button', name='領民を救済する', exact=True).click()
    page.wait_for_function('gold=>window.TenkaGame.load().gold===gold', arg=before['gold'] + 300 - 80)
    sold = saved(page)
    assert sold['food'] == before['food'] - 1200 - 600
    assert sold['tenka']['estates']['kiyosu']['unrest'] < before['tenka']['estates']['kiyosu']['unrest']
    assert remaining(sold, 'kiyosu') == 1
    resume(page, url, 'scarce')
    estate = council(page).get_by_role('region', name='領国の経営計画', exact=True)
    expect(estate.get_by_role('button', name='兵糧を売却する', exact=True)).to_be_disabled()
    expect(estate).to_contain_text('売却後に残す備蓄')
    no_overflow(page, estate)
    passed(f'{width}px: deliberate tax choice, one-month policy guard, real buy/sell/relief costs, integer demobilization, independent castle orders and two-month grain reserve')


def estate_viewport(page, url, width, shots, passed):
    resume(page, url, 'estate')
    estate = council(page).get_by_role('region', name='領国の経営計画', exact=True)
    estate.locator('.tenka-estate-reserve').scroll_into_view_if_needed()
    no_overflow(page, estate)
    page.screenshot(path=str(shots / f'{width}-estate-forecast-viewport.png'))
    estate.get_by_role('button', name='田畑の開墾に着手', exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(shots / f'{width}-estate-projects-viewport.png'))
    passed(f'{width}px: visible forecast and project controls captured within the actual scrollable council viewport')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8064')
    parser.add_argument('--screenshots', default='/tmp/tenka-campaign-council-browser')
    parser.add_argument('--widths', default='1440,390')
    parser.add_argument('--scenarios', default='marriage,submission,construction,policy')
    args = parser.parse_args()
    shots = Path(args.screenshots)
    shots.mkdir(parents=True, exist_ok=True)
    checks, errors = [], []

    def passed(message):
        checks.append(message)
        print('PASS: ' + message, flush=True)
        (shots / 'results.json').write_text(json.dumps({'checks': checks, 'browser_errors': errors}, ensure_ascii=False, indent=2))

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        for width in map(int, args.widths.split(',')):
            (shots / f'{width}-failure.png').unlink(missing_ok=True)
            context = browser.new_context(viewport={'width': width, 'height': 1050 if width > 600 else 844})
            context.set_default_timeout(60000)
            context.set_default_navigation_timeout(60000)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            try:
                scenarios = args.scenarios.split(',')
                if 'marriage' in scenarios:
                    marriage_and_break(page, args.url, width, shots, passed)
                if 'submission' in scenarios:
                    submission(page, args.url, width, shots, passed)
                if 'construction' in scenarios:
                    construction(page, args.url, width, shots, passed)
                if 'policy' in scenarios:
                    policy_and_stocks(page, args.url, width, shots, passed)
                if 'visual' in scenarios:
                    estate_viewport(page, args.url, width, shots, passed)
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
