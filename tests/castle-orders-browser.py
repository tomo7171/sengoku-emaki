#!/usr/bin/env python3
"""Exercise recruitment comparison and castle command sources through shipped UI."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

FIXTURE = """() => {
 const Game=window.TenkaGame,state=Game.newGame();
 state.selectedCastleId='kiyosu';
 state.tenka.castleOrders.castles.kiyosu.remaining=0;
 state.tenka.castleOrders.castles.inuyama.remaining=3;
 if(!Game.validate(state)||!Game.save(state))throw Error('Recruitment fixture must validate and save');
 return window.TenkaDynasty.getView(state).recruits;
}"""

def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--url',default='http://127.0.0.1:8058')
 parser.add_argument('--screenshots',default='/tmp/tenka-recruitment-browser')
 args=parser.parse_args();shots=Path(args.screenshots);shots.mkdir(parents=True,exist_ok=True)
 results=[];errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  for width in [1440,390]:
   context=browser.new_context(viewport={'width':width,'height':1000 if width>600 else 844},device_scale_factor=1)
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(args.url,wait_until='domcontentloaded')
   expect(page.get_by_role('combobox',name='開始する大名',exact=True)).to_be_visible()
   initial=page.evaluate(FIXTURE);assert len(initial)==8
   page.reload(wait_until='domcontentloaded')
   page.get_by_role('button',name='織田家の続きから遊ぶ',exact=True).click()
   # The native sidebar must recover when selecting another castle with orders.
   expect(page.locator('.action-heading')).to_contain_text('0 / 3 行動（清洲城）')
   expect(page.locator('.next-turn-button')).to_contain_text('全城の残り 3')
   repair=page.locator('.castle-actions').get_by_role('button',name=re.compile('^普請'))
   expect(repair).to_be_disabled()
   page.get_by_role('button',name='全国の城・勢力',exact=True).click()
   page.get_by_role('textbox',name='城・大名を検索',exact=True).fill('犬山')
   page.get_by_role('button',name='犬山城を選択',exact=True).click()
   expect(page.locator('.castle-title')).to_contain_text('犬山城')
   expect(page.locator('.action-heading')).to_contain_text('3 / 3 行動（犬山城）')
   expect(repair).to_be_enabled()
   prior=page.evaluate('window.TenkaGame.load()')
   repair.click()
   expect(page.locator('.action-heading')).to_contain_text('2 / 3 行動（犬山城）')
   expect(page.locator('.next-turn-button')).to_contain_text('全城の残り 2')
   repaired=page.evaluate('window.TenkaGame.load()')
   assert repaired['tenka']['castleOrders']['castles']['kiyosu']['remaining']==0
   assert repaired['tenka']['castleOrders']['castles']['inuyama']['remaining']==2
   assert next(c for c in repaired['castles'] if c['id']=='inuyama')['defense']>next(c for c in prior['castles'] if c['id']=='inuyama')['defense']
   print(f'PASS {width}px: native repair switches from exhausted Kiyosu to Inuyama; only Inuyama orders debit; total updates',flush=True)
   # Restore the fixture so the comparison tests retain their full eight-person pool.
   initial=page.evaluate(FIXTURE)
   page.reload(wait_until='domcontentloaded')
   page.get_by_role('button',name='織田家の続きから遊ぶ',exact=True).click()
   page.get_by_role('button',name='評定を開く',exact=True).click()
   council=page.locator('.tenka-council')
   council.get_by_role('button',name='家臣',exact=True).click()
   table=council.get_by_role('table',name='登用候補の一覧',exact=True)
   expect(table).to_be_visible();expect(table.locator('tbody tr')).to_have_count(8)
   source=council.get_by_role('combobox',name='命令を出す城',exact=True)
   expect(source).to_have_value('kiyosu')
   expect(council.locator('.tenka-orders')).to_contain_text('0 / 3')
   for person in initial:
    row=table.locator('tr[data-candidate-id="'+person['id']+'"]')
    expect(row).to_contain_text(person['name'])
    for label,key in [('統率','leadership'),('武勇','valor'),('知略','intelligence'),('政治','politics')]:
     expect(row.locator('td[data-label="'+label+'"]').filter(has_text=str(person[key]))).to_have_count(1)
    expect(row.get_by_role('button',name=person['name']+'を登用',exact=True)).to_be_disabled()
   source.select_option('inuyama')
   expect(council.locator('.tenka-orders')).to_contain_text('3 / 3')
   expect(council.locator('.tenka-orders')).to_contain_text('犬山城')
   selected=initial[5];row=table.locator('tr[data-candidate-id="'+selected['id']+'"]')
   hire=row.get_by_role('button',name=selected['name']+'を登用',exact=True)
   hire.scroll_into_view_if_needed();expect(hire).to_be_enabled()
   before=page.evaluate('window.TenkaGame.load().gold')
   hire.click();expect(table.locator('tbody tr')).to_have_count(7)
   expect(table.locator('tr[data-candidate-id="'+selected['id']+'"]')).to_have_count(0)
   expected=[o for o in initial if o['id']!=selected['id']]
   assert table.locator('tbody tr').evaluate_all('(rows)=>rows.map(row=>row.dataset.candidateId)')==[o['id'] for o in expected]
   for person in expected:expect(table.locator('tr[data-candidate-id="'+person['id']+'"]')).to_contain_text(person['name'])
   state=page.evaluate('window.TenkaGame.load()')
   assert state['gold']==before-150
   assert state['tenka']['castleOrders']['castles']['kiyosu']['remaining']==0
   assert state['tenka']['castleOrders']['castles']['inuyama']['remaining']==2
   hired=next(o for o in state['officers'] if o['id']==selected['id'])
   assert hired['castleId']=='inuyama' and hired['status']=='active'
   for key in ['name','birth','leadership','valor','intelligence','politics']:assert hired[key]==selected[key]
   expect(council.locator('.tenka-orders')).to_contain_text('2 / 3')
   council.get_by_role('button',name='外交',exact=True).click()
   expect(source).to_have_value('inuyama')
   action=council.locator('.tenka-action');expect(action).to_be_enabled()
   source.select_option('kiyosu');expect(action).to_be_disabled()
   source.select_option('inuyama');expect(action).to_be_enabled()
   council.get_by_role('button',name='家臣',exact=True).click()
   table.scroll_into_view_if_needed()
   bounds=table.evaluate('table=>({left:table.getBoundingClientRect().left,right:table.getBoundingClientRect().right,width:table.clientWidth,scroll:table.scrollWidth,viewport:innerWidth})')
   assert bounds['left']>=-1 and bounds['right']<=width+1 and bounds['scroll']<=bounds['width']+1,bounds
   for row in table.locator('tbody tr').all():
    box=row.bounding_box();assert box['x']>=-1 and box['x']+box['width']<=width+1,box
   first=table.locator('tbody tr').first;first.scroll_into_view_if_needed()
   page.screenshot(path=str(shots/(str(width)+'px-recruitment.png')))
   page.reload(wait_until='domcontentloaded')
   page.get_by_role('button',name='織田家の続きから遊ぶ',exact=True).click()
   page.get_by_role('button',name='評定を開く',exact=True).click()
   page.locator('.tenka-council').get_by_role('button',name='家臣',exact=True).click()
   final=page.evaluate('window.TenkaDynasty.getView(window.TenkaGame.load()).recruits')
   assert [o['id'] for o in final]==[o['id'] for o in expected]
   assert [o['name'] for o in final]==[o['name'] for o in expected]
   results.append(f'{width}px: 8 candidates, chosen hire, stable remaining list, homecastle, independent budgets, reload, no overflow')
   print('PASS '+results[-1],flush=True);context.close()
  browser.close()
 assert not errors,errors
 print(json.dumps({'checks':results,'pageErrors':errors,'screenshots':str(shots)},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
