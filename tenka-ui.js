/* 天下布武 — council and tactical controls. No external runtime dependencies. */
(function(global){
'use strict';
const format=n=>Math.round(n||0).toLocaleString('ja-JP');
const unitNames={ashigaru:'足軽',cavalry:'騎馬',firearm:'鉄砲',archer:'弓',navy:'水軍'};
const seasons=['春','夏','秋','冬'];
const labels={reclaim:'開墾を命じる',commercial:'商業を振興する',levy:'領民を動員する',reward:'家臣を加増する',negotiation:'使者を派遣する',infiltrate:'内応を働きかける',enlist:'召し抱える',release:'解放する',execute:'処断する'};
function era(year){return year>=1615?'元和'+(year-1614)+'年':year>=1596?'慶長'+(year-1595)+'年':year>=1592?'文禄'+(year-1591)+'年':year>=1573?'天正'+(year-1572)+'年':year>=1570?'元亀'+(year-1569)+'年':'永禄'+(year-1557)+'年';}
const outcomeLabels={survived:'生還',retreated:'退却・生還',escaped:'退却・生還',captured:'捕虜',killed:'討死',unrecorded:'安否の記録なし'};
function battleAftermathView(state,battle=state.lastBattle){
 const records=Array.isArray(battle?.officerOutcomes)?battle.officerOutcomes:null;
 const decisions=Array.isArray(state.tenka?.prisonerDecisions)?state.tenka.prisonerDecisions:[];
 const ownClan=state.playerClan;
 const clanName=clan=>state.castles.find(c=>c.clan===clan)?.clanName||'他家';
 const rows=(records||[]).filter(r=>r&&r.officerId).map(record=>{
  const officer=state.officers.find(o=>o.id===record.officerId);
  const own=record.clan===ownClan;
  const decision=decisions.filter(d=>d.officerId===record.officerId&&(!d.battleId||d.battleId===battle.id)).sort((a,b)=>(b.turn||0)-(a.turn||0))[0];
  const prisoner=officer?.status==='captive'&&officer.capturedBy===ownClan;
  let current='';
  if(record.outcome==='captured'){
   if(prisoner)current='自家の捕虜・処遇を選択できます';
   else if(officer?.status==='captive')current=clanName(officer.capturedBy)+'の捕虜';
   else if(decision?.type==='execute'&&decision.outcome!=='failure')current='処断済み';
   else if(officer?.status==='dead'||officer?.status==='executed')current='現在は故人';
   else if(officer?.clan===ownClan&&officer?.status==='active')current='自家に出仕中';
   else if(decision?.type==='release'&&decision.outcome!=='failure')current=officer?.status==='ronin'?'解放済み・浪人':'解放済み・旧主に帰参';
   else if(officer?.status==='ronin')current='現在は浪人';
   else if(officer?.status==='active')current=clanName(officer.clan)+'に出仕中';
  }
  return {...record,name:record.name||officer?.name||'名不詳',officer,own,prisoner,current,decision,label:outcomeLabels[record.outcome]||'記録あり'};
 });
 const counts={killed:rows.filter(o=>o.outcome==='killed').length,captured:rows.filter(o=>o.outcome==='captured').length,survived:rows.filter(o=>['survived','retreated','escaped'].includes(o.outcome)).length};
 return {legacy:records===null,rows,counts};
}
function create(React){
const h=React.createElement;
function Portrait({officer,size=48,year}){return h('img',{className:'tenka-portrait',src:global.TenkaPortraits?.uri(officer,year==null?undefined:{year}),width:size,height:size,alt:officer.name+'の創作肖像',loading:'lazy'});}
function RetainerStations({state,onState,onNotify}){
 const [destinations,setDestinations]=React.useState({}),[feedback,setFeedback]=React.useState(null);
 const [castleFilter,setCastleFilter]=React.useState('all'),[query,setQuery]=React.useState(''),[sort,setSort]=React.useState('name');
 const [commonDestination,setCommonDestination]=React.useState(''),[selected,setSelected]=React.useState({});
 const retainers=global.TenkaRetainers;
 if(!retainers)return null;
 const view=retainers.getView(state),castles=view.castles||[],officers=view.officers||[],cost=view.cost??1;
 const destinationFor=officer=>castles.find(c=>c.id===(destinations[officer.id]??commonDestination));
 const matching=officers.filter(officer=>(castleFilter==='all'||(castleFilter==='unassigned'?!officer.castleId:officer.castleId===castleFilter))&&(!query.trim()||[officer.name,officer.castleName,officer.sourceCastleName].some(value=>String(value||'').includes(query.trim()))));
 const compare=(a,b)=>sort==='name'?a.name.localeCompare(b.name,'ja'):(Number(b[sort])||0)-(Number(a[sort])||0)||a.name.localeCompare(b.name,'ja');
 const groups=[...castles.map(c=>({...c,officers:matching.filter(o=>o.castleId===c.id).sort(compare)})),{id:'unassigned',name:'未配属',province:'命令元の城から配属',officers:matching.filter(o=>!o.castleId||!castles.some(c=>c.id===o.castleId)).sort(compare)}].filter(group=>group.officers.length||!query.trim()&&(castleFilter==='all'||castleFilter===group.id));
 const selectedIds=officers.filter(o=>selected[o.id]).map(o=>o.id),selectable=matching.filter(o=>!view.blocked&&o.available!==false&&!o.busy);
 const station=(officer,castleId)=>{
  const result=retainers.act(state,{type:'station',officerId:officer.id,castleId});
  setFeedback({ok:result.ok,text:result.message,rows:[]});
  if(result.ok){onState?.(result.state);setDestinations(previous=>({...previous,[officer.id]:''}));setSelected(previous=>({...previous,[officer.id]:false}));}
  onNotify?.({text:result.message,success:result.ok});
 };
 const stationSelected=()=>{
  if(!commonDestination||!selectedIds.length||view.blocked)return;
  let current=state,successes=0;const rows=[],completed=[];
  for(const id of selectedIds){const officer=officers.find(o=>o.id===id),result=retainers.act(current,{type:'station',officerId:id,castleId:commonDestination});rows.push({id,ok:result.ok,text:result.message||officer.name+'の配置を確認してください。'});if(result.ok){current=result.state;successes++;completed.push(id);}}
  if(successes)onState?.(current);
  setSelected(previous=>{const next={...previous};for(const id of completed)delete next[id];return next;});
  setDestinations(previous=>{const next={...previous};for(const id of completed)next[id]='';return next;});
  const text=successes+' 人を配置しました。'+(rows.length-successes?' 配置できなかった '+(rows.length-successes)+' 人は選択を残しています。':'');
  setFeedback({ok:successes===rows.length,text,rows});onNotify?.({text,success:successes===rows.length});
 };
 return h('section',{className:'tenka-retainer-stations','aria-label':'武将の城への配置'},
  h('div',{className:'tenka-section-heading'},h('h4',null,'城ごとの家臣配置'),h('span',null,'成人の家臣 '+officers.length+' 人 ／ 自領 '+castles.length+' 城')),
  h('p',{className:'tenka-note'},'城ごとに所属と能力を比較できます。配置先を選び、一人ずつ、または選んだ武将をまとめて配属してください。一人につき移動元の城の今月の命令を'+cost+'回使用します。城の大将は別に任命できます。'),
  h('div',{className:'tenka-station-toolbar'},
   h('label',{className:'tenka-field'},h('span',null,'所属の城で絞り込む'),h('select',{'aria-label':'武将の所属城で絞り込む',value:castleFilter,onChange:e=>setCastleFilter(e.target.value)},h('option',{value:'all'},'全ての城（'+officers.length+'人）'),castles.map(c=>h('option',{key:c.id,value:c.id},c.name+'（'+officers.filter(o=>o.castleId===c.id).length+'人）')),h('option',{value:'unassigned'},'未配属（'+officers.filter(o=>!o.castleId).length+'人）'))),
   h('label',{className:'tenka-field'},h('span',null,'武将・城を検索'),h('input',{type:'search','aria-label':'配置する武将を検索',value:query,placeholder:'武将名・城名',onChange:e=>setQuery(e.target.value)})),
   h('label',{className:'tenka-field'},h('span',null,'城の中で並べ替え'),h('select',{'aria-label':'配置武将の並べ替え',value:sort,onChange:e=>setSort(e.target.value)},[['name','名前順'],['leadership','統率が高い順'],['valor','武勇が高い順'],['intelligence','知略が高い順'],['politics','政治が高い順']].map(([value,label])=>h('option',{key:value,value},label))))),
  h('div',{className:'tenka-station-batch'},
   h('label',{className:'tenka-field'},h('span',null,'共通の配置先'),h('select',{'aria-label':'選んだ武将の共通配置先',value:commonDestination,disabled:!!view.blocked,onChange:e=>setCommonDestination(e.target.value)},h('option',{value:''},'配置先の城を選ぶ'),castles.map(c=>h('option',{key:c.id,value:c.id},c.name+' ／ '+(c.province||'自領'))))),
   h('div',{className:'tenka-station-selection'},h('strong',null,selectedIds.length+' 人を選択'),h('button',{type:'button',disabled:!selectable.length,onClick:()=>setSelected(previous=>({...previous,...Object.fromEntries(selectable.map(o=>[o.id,true]))}))},'表示中の配置可能な武将を選ぶ'),h('button',{type:'button',disabled:!selectedIds.length,onClick:()=>setSelected({})},'選択を解除')),
   h('button',{type:'button',className:'tenka-primary-button',disabled:!!view.blocked||!commonDestination||!selectedIds.length,onClick:stationSelected},'選んだ武将をまとめて配置'),
   h('small',null,'命令は一人ずつ確認します。残り命令が足りない武将や任務中の武将は移動せず、理由を表示します。')),
  view.blocked&&h('p',{className:'tenka-feedback failure',role:'status'},view.message||'先に合戦・援軍要請への対応を決めてください。'),
  feedback&&h('div',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},h('p',null,feedback.text),(feedback.rows||[]).length>0&&h('ul',{className:'tenka-station-results'},feedback.rows.map(row=>h('li',{key:row.id,className:row.ok?'success':'failure'},(row.ok?'配置済み：':'未配置：')+row.text)))),
  !matching.length&&h('p',{className:'tenka-note'},officers.length?'条件に一致する武将がいません。所属の絞り込みや検索語を変更してください。':'配置できる成人の家臣がいません。登用・元服で家臣団を整えましょう。'),
  h('div',{className:'tenka-station-castles'},groups.map(group=>h('section',{className:'tenka-station-castle',key:group.id,'aria-label':group.name+'の家臣一覧'},
   h('header',{className:'tenka-station-castle-heading'},h('h5',null,group.name),h('span',null,(group.province||'自領')+' ／ '+group.officers.length+' 人'+(group.id==='unassigned'?'':' ／ 今月の命令 '+(group.remaining??0)+' / 3'))),
   group.officers.length?h('div',{className:'tenka-station-list'},group.officers.map(officer=>{
    const destination=destinationFor(officer),currentId=officer.castleId;
    const disabled=!!view.blocked||officer.available===false||!!officer.busy||!destination||destination.id===currentId||(officer.remaining??3)<cost;
    return h('article',{className:'tenka-station-person',key:officer.id,'data-officer-id':officer.id},
     h('label',{className:'tenka-station-checkbox'},h('input',{type:'checkbox','aria-label':officer.name+'をまとめ配置に選ぶ',checked:!!selected[officer.id],disabled:!!view.blocked||officer.available===false||!!officer.busy,onChange:e=>setSelected(previous=>({...previous,[officer.id]:e.target.checked}))}),h('span',{className:'tenka-visually-hidden'},officer.name+'を選択')),
     h('div',{className:'tenka-station-identity'},h(Portrait,{officer,year:state.year,size:48}),h('div',null,h('strong',null,officer.name),h('small',null,'現在の城：'+(officer.castleName||'未配属')),h('small',null,(officer.sourceCastleName||officer.castleName||'命令元の城')+' ／ 命令 '+(officer.remaining??0)+' / 3'),h('span',{className:'tenka-station-stats'},'統率 '+format(officer.leadership)+'　武勇 '+format(officer.valor)+'　知略 '+format(officer.intelligence)+'　政治 '+format(officer.politics)))),
     h('div',{className:'tenka-station-command'},h('label',{className:'tenka-field'},h('span',null,'配置先の城'),h('select',{'aria-label':officer.name+'の配置先の城',value:destination?.id||'',disabled:!!view.blocked||officer.available===false||!!officer.busy,onChange:e=>setDestinations(previous=>({...previous,[officer.id]:e.target.value}))},h('option',{value:''},'配置先を選ぶ'),castles.map(c=>h('option',{key:c.id,value:c.id,disabled:c.id===currentId},c.name+' ／ '+(c.province||'自領')+(c.id===currentId?'（現在の城）':''))))),h('button',{type:'button','aria-label':officer.name+'を城に配置',disabled,onClick:()=>station(officer,destination?.id)},'配置する')),
     officer.reason&&h('small',{className:'tenka-station-reason'},officer.reason));
   })):h('p',{className:'tenka-station-empty'},'所属する成人武将はいません。共通の配置先でこの城を選び、家臣を配属できます。')))));
}
function AidRequests({state,onState,onNotify,compact=false,showHistory=true}){
 const [sources,setSources]=React.useState({});
 const [counts,setCounts]=React.useState({});
 const [feedback,setFeedback]=React.useState(null);
 const allies=global.TenkaAllies;
 if(!allies)return null;
 const view=allies.getView(state),requests=view.requests||[],reports=view.reports||[];
 const decide=(type,request)=>{
  const result=allies.act(state,{type,requestId:request.id,sourceId:sources[request.id],troops:Number(counts[request.id])});
  setFeedback({ok:result.ok,text:result.message});
  if(result.ok)onState(result.state);
  onNotify?.({text:result.message,success:result.ok});
 };
 return h('section',{className:'tenka-aid-requests'+(compact?' compact':''),'aria-label':'同盟国の援軍要請'},
  h('div',{className:'tenka-section-heading'},h('h4',null,'同盟国の援軍要請'),h('span',null,requests.length?'未回答 '+requests.length+' 件':'未回答の要請なし')),
  h('p',{className:'tenka-note'},'同盟国の攻勢・防衛に援軍を出すか、断るかを決めてください。出兵元の城と人数はプレイヤーが指定します。拒否すると、その同盟国との友好度が'+(view.declineRelationLoss??15)+'下がります。'),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  requests.length?h('div',{className:'tenka-aid-list'},requests.map(request=>{
   const source=(request.sources||[]).find(c=>c.id===sources[request.id]);
   const rawCount=counts[request.id]??'',troops=Number(rawCount),validCount=rawCount!==''&&Number.isInteger(troops)&&troops>0;
   const estimate=source&&validCount?allies.preview?.(state,{requestId:request.id,sourceId:source.id,troops}):null;
   const disabled=!source||!validCount||troops>source.maxTroops||request.canSend===false||estimate?.ok===false||!!source.reason;
   return h('article',{className:'tenka-aid-request',key:request.id,'data-aid-request-id':request.id},
    h('header',null,h('span',{className:'tenka-aid-side'},request.side==='attacker'?'同盟国の攻勢':'同盟国の防衛'),h('h5',null,request.allyName+'から援軍の要請'),h('p',null,request.sourceName+' → '+request.targetName+' ／ 敵：'+request.opponentName)),
    h('p',{className:'tenka-aid-summary'},(request.mode==='siege'?'攻城・籠城戦':'野戦')+' ／ 要請兵力 '+format(request.requestedTroops)+' 人',h('small',null,'要請人数にかかわらず、派遣する人数を指定できます。')),
    h('div',{className:'tenka-aid-controls'},h('label',{className:'tenka-field'},h('span',null,'出兵元の城'),h('select',{'aria-label':request.allyName+'への援軍の出兵元',value:source?.id||'',onChange:e=>setSources(previous=>({...previous,[request.id]:e.target.value}))},h('option',{value:''},'城を選ぶ'),(request.sources||[]).map(c=>h('option',{key:c.id,value:c.id,disabled:!c.maxTroops||!!c.reason},c.name+' ／ 派兵上限 '+format(c.maxTroops)+' 人'+(c.reason?' ／ '+c.reason:''))))),h('label',{className:'tenka-field'},h('span',null,'派遣する人数'),h('input',{type:'number',inputMode:'numeric',min:1,max:source?.maxTroops,step:1,'aria-label':request.allyName+'への援軍の人数',value:rawCount,onChange:e=>setCounts(previous=>({...previous,[request.id]:e.target.value}))}))),
    source&&h('div',{className:'tenka-aid-resources'},h('span',null,'城の兵力 '+format(source.troops)+' 人 ／ 守備に残す最低兵力 '+format(source.minimumGarrison)+' 人'),h('span',null,'派兵上限 '+format(source.maxTroops)+' 人'+(estimate?.remainingGarrison!=null?' ／ 派兵後の守備兵 '+format(estimate.remainingGarrison)+' 人':'')),h('span',null,source.commanderName?'指揮：'+source.commanderName:'指揮武将を確認してください'),estimate?.foodCost!=null&&h('span',null,'兵糧 '+format(estimate.foodCost)+' 石 ／ 金 '+format(estimate.goldCost)+' 貫 ／ '+source.name+'の命令 '+(estimate.orderCost??1)),h('small',null,'自家の蓄え：兵糧 '+format(state.food)+' 石 ／ 金 '+format(state.gold)+' 貫')),
    estimate?.message&&estimate.ok===false&&h('p',{className:'tenka-feedback failure',role:'status'},estimate.message),
    h('div',{className:'tenka-aid-actions'},h('button',{type:'button',className:'tenka-aid-send',disabled,onClick:()=>decide('send',request)},'援軍を送る'),h('button',{type:'button',className:'tenka-aid-decline',onClick:()=>decide('decline',request)},'援軍を断る')),
    h('small',{className:'tenka-aid-warning'},request.active===false?'失効した要請を終了しても、友好度は下がりません。':'断った場合：'+request.allyName+'との友好度 −'+(view.declineRelationLoss??15)+'。回答するまで次の月には進みません。'));
  })):h('p',{className:'tenka-aid-empty'},'現在、同盟国からの援軍要請はありません。'),
  showHistory&&reports.length>0&&h('details',{className:'tenka-aid-history'},h('summary',null,'援軍の回答・戦果の記録（'+reports.length+'件）'),h('div',null,reports.slice().reverse().map(report=>h('article',{key:report.id},h('strong',null,(report.date||((report.year||state.year)+'年'))+' ／ '+report.allyName),h('p',null,report.message||((report.decision==='received'?'同盟軍が参戦':report.decision==='send'?'自軍を援軍として派遣':'援軍を拒否')+' ／ '+(report.sourceName||'')+' → '+(report.targetName||''))),['send','received'].includes(report.decision)&&h('small',null,(report.decision==='received'?'同盟援軍 ':'派遣 ')+format(report.troops)+' 人 ／ 損失 '+format(report.casualties)+' 人 ／ 帰還 '+format(report.survivors)+' 人'),h('small',null,'友好度 '+((report.relationChange||0)>0?'+':'')+(report.relationChange||0)))))));
}
function AidRequestForm({state,onState,onNotify,war,compact=false}){
 const [contextId,setContext]=React.useState('');
 const [castleId,setCastle]=React.useState('');
 const [count,setCount]=React.useState('');
 const [feedback,setFeedback]=React.useState(null);
 const allies=global.TenkaAllies;
 if(!allies?.getSupportView)return null;
 const initial=allies.getSupportView(state,war||{}),contexts=initial.contexts||[];
 const context=war?.sourceId?war:contexts.find(entry=>(entry.id||entry.sourceId+'-'+entry.targetId+'-'+entry.mode)===contextId)||null;
 const view=context?allies.getSupportView(state,context):initial;
 const committed=(state.tenka?.allies?.committed||view.supports||[]);
 const source=context?(view.sources||[]).find(entry=>entry.id===castleId):null;
 const troops=Number(count),validCount=count!==''&&Number.isSafeInteger(troops)&&troops>0;
 const action={...context,supportCastleId:source?.id,troops};
 const estimate=context&&source&&validCount?allies.previewSupport(state,action):null;
 const disabled=!context||!source||!validCount||troops>source.maxTroops||view.ok===false||estimate?.ok!==true||!!source.reason;
 const report=result=>{setFeedback({ok:result.ok,text:result.message});if(result.ok){onState(result.state);setCastle('');setCount('');}onNotify?.({text:result.message,success:result.ok});};
 const contextName=entry=>((entry.defending?'自家の防衛':'自家の攻勢')+' ／ '+(entry.sourceName||state.castles.find(c=>c.id===entry.sourceId)?.name||'出陣元')+' → '+(entry.targetName||state.castles.find(c=>c.id===entry.targetId)?.name||'戦場')+' ／ '+(entry.mode==='field'?'野戦':'攻城・籠城戦'));
 return h('section',{className:'tenka-aid-requests tenka-request-support'+(compact?' compact':''),'aria-label':'同盟国へ援軍を要請'},
  h('div',{className:'tenka-section-heading'},h('h4',null,'同盟国へ援軍を要請'),h('span',null,'自家の侵攻・防衛への支援')),
  h('p',{className:'tenka-note'},'援軍を頼む戦場、同盟国の城、人数を指定してください。要請した兵は同盟国の城から出兵し、自家の部隊とともに戦います。要請時の費用は同盟国側が負担し、取り消しても戻りません。'),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  !war?.sourceId&&h('label',{className:'tenka-field'},h('span',null,'援軍を要請する戦場'),h('select',{'aria-label':'援軍を要請する戦場',value:context?context.id||context.sourceId+'-'+context.targetId+'-'+context.mode:'',disabled:!contexts.length,onChange:e=>{setContext(e.target.value);setCastle('');setCount('');setFeedback(null);}},h('option',{value:''},contexts.length?'戦場を選ぶ':'要請できる侵攻・防衛はありません'),contexts.map(entry=>h('option',{key:entry.id||entry.sourceId+'-'+entry.targetId+'-'+entry.mode,value:entry.id||entry.sourceId+'-'+entry.targetId+'-'+entry.mode},contextName(entry))))),
  context&&h('article',{className:'tenka-aid-request'},h('p',{className:'tenka-aid-summary'},contextName(context)),
   h('div',{className:'tenka-aid-controls'},h('label',{className:'tenka-field'},h('span',null,'援軍を頼む同盟国の城'),h('select',{'aria-label':'援軍を頼む同盟国の城',value:source?.id||'',onChange:e=>setCastle(e.target.value)},h('option',{value:''},'同盟国の城を選ぶ'),(view.sources||[]).map(entry=>h('option',{key:entry.id,value:entry.id,disabled:!entry.maxTroops||!!entry.reason},entry.allyName+' ／ '+(entry.sourceName||entry.name)+' ／ 上限 '+format(entry.maxTroops)+' 人'+(entry.reason?' ／ '+entry.reason:''))))),h('label',{className:'tenka-field'},h('span',null,'要請する人数'),h('input',{type:'number',inputMode:'numeric',min:1,max:source?.maxTroops,step:1,'aria-label':'同盟国に要請する援軍の人数',value:count,onChange:e=>setCount(e.target.value)}))),
   source&&h('div',{className:'tenka-aid-resources'},h('span',null,'同盟国の城の兵力 '+format(source.troops)+' 人 ／ 守備に残す最低兵力 '+format(source.minimumGarrison)+' 人'),h('span',null,'援軍の上限 '+format(source.maxTroops)+' 人'+(estimate?.remainingGarrison!=null?' ／ 出兵後の守備兵 '+format(estimate.remainingGarrison)+' 人':'')),estimate?.foodCost!=null&&h('span',null,'同盟国側の負担：兵糧 '+format(estimate.foodCost)+' 石 ／ 金 '+format(estimate.goldCost)+' 貫'),h('small',null,'自家の兵・兵糧・命令は、援軍要請では消費しません。')),
   estimate?.ok===false&&estimate.message&&h('p',{className:'tenka-feedback failure',role:'status'},estimate.message),
   view.ok===false&&view.message&&h('p',{className:'tenka-feedback failure',role:'status'},view.message),
   !(view.sources||[]).length&&h('p',{className:'tenka-aid-empty'},'援軍を要請できる有効な同盟国の城がありません。外交交渉で同盟を結んでください。'),
   h('div',{className:'tenka-aid-actions'},h('button',{type:'button',className:'tenka-aid-send',disabled,onClick:()=>report(allies.requestSupport(state,action))},'この人数で援軍を要請する'))),
  committed.length>0&&h('div',{className:'tenka-aid-committed'},h('h5',null,'参戦予定の同盟軍'),committed.map(support=>h('article',{key:support.id},h('strong',null,(support.allyName||support.clanName||state.castles.find(c=>c.clan===support.allyClan)?.clanName||'同盟軍')+' ／ '+(support.sourceName||state.castles.find(c=>c.id===support.sourceId)?.name||'同盟国の城')+' '+format(support.troops)+' 人'),h('small',null,'戦場：'+(state.castles.find(c=>c.id===support.targetId)?.name||support.targetId)+' ／ '+(support.defending?'自家の防衛':'自家の攻勢')+' ／ '+(support.mode==='field'?'野戦':'攻城・籠城戦')),h('small',null,Object.entries(support.units||{}).filter(([,number])=>number>0).map(([type,number])=>(unitNames[type]||type)+' '+format(number)+'人').join(' ／ ')),h('button',{type:'button','aria-label':(support.sourceName||'同盟軍')+'の援軍要請を取り消す',onClick:()=>report(allies.cancelSupport(state,{supportId:support.id}))},'援軍要請を取り消す')))),
  !context&&!contexts.length&&h('p',{className:'tenka-aid-empty'},initial.message||'隣接する戦場と有効な同盟がある場合に援軍を要請できます。'));
}
function MarriageDiplomacy({state,onState,onNotify,orderCastleId,targetClan}){
 const [princessId,setPrincess]=React.useState(''),[clanId,setClan]=React.useState(''),[spouseId,setSpouse]=React.useState(''),[feedback,setFeedback]=React.useState(null);
 const diplomacy=global.TenkaDiplomacy;
 if(!diplomacy)return null;
 const initial=diplomacy.getView(state),princesses=initial.princesses||[];
 const princess=princesses.find(p=>p.id===princessId)||princesses.find(p=>p.eligible)||princesses[0];
 const view=diplomacy.getView(state,{princessId:princess?.id}),clans=view.marriageClans||[];
 const clan=clans.find(c=>c.id===clanId)||clans.find(c=>c.id===targetClan)||clans[0];
 const spouses=clan?.spouses||[],spouse=spouses.find(p=>p.id===spouseId)||spouses[0];
 const action={type:'marry',princessId:princess?.id,targetClan:clan?.id,spouseId:spouse?.id,orderCastleId};
 const preview=princess?.eligible&&spouse?diplomacy.preview(state,action):null;
 const report=result=>{setFeedback({ok:result.ok,text:result.message});if(result.ok)onState?.(result.state);onNotify?.({text:result.message,success:result.ok});};
 return h('section',{className:'tenka-marriage-diplomacy','aria-label':'姫と婚姻相手を選ぶ'},
  h('div',{className:'tenka-section-heading'},h('h4',null,'姫と他家の婚姻'),h('span',null,'同盟国とも婚姻を結べます')),
  h('p',{className:'tenka-note'},'18歳以上の未婚の姫と、相手方の成人した未婚男性を選びます。姫ごとに親族関係を確認し、婚姻できる人物を表示します。'),
  h('div',{className:'tenka-marriage-controls'},
   h('label',{className:'tenka-field'},h('span',null,'婚姻する姫'),h('select',{'aria-label':'婚姻する姫を選ぶ',value:princess?.id||'',disabled:!princesses.length,onChange:e=>{setPrincess(e.target.value);setClan('');setSpouse('');setFeedback(null);}},princesses.length?princesses.map(p=>h('option',{key:p.id,value:p.id},p.name+' ／ '+p.age+'歳'+(p.eligible?'':' ／ '+(p.reason||'婚姻できません')))):h('option',{value:''},'婚姻できる姫がいません'))),
   h('label',{className:'tenka-field'},h('span',null,'婚姻を申し込む家'),h('select',{'aria-label':'婚姻を申し込む家を選ぶ',value:clan?.id||'',disabled:!clans.length||!princess?.eligible,onChange:e=>{setClan(e.target.value);setSpouse('');setFeedback(null);}},clans.length?clans.map(c=>h('option',{key:c.id,value:c.id},c.name+(state.alliances.includes(c.id)?' ／ 同盟国':''))):h('option',{value:''},'婚姻できる家がありません'))),
   h('label',{className:'tenka-field'},h('span',null,'実際の婚姻相手'),h('select',{'aria-label':'婚姻する相手の武将を選ぶ',value:spouse?.id||'',disabled:!spouses.length||!princess?.eligible,onChange:e=>{setSpouse(e.target.value);setFeedback(null);}},spouses.length?spouses.map(p=>h('option',{key:p.id,value:p.id},p.name+' ／ '+p.age+'歳'+(p.role?' ／ '+p.role:''))):h('option',{value:''},'条件に合う婚姻相手がいません'))),
   h('button',{type:'button',className:'tenka-primary-button',disabled:preview?.ok!==true,onClick:()=>report(diplomacy.act(state,action))},'婚姻を結ぶ')),
  princess&&!princess.eligible&&h('p',{className:'tenka-feedback failure',role:'status'},princess.reason||'この姫は現在、婚姻できません。'),
  !princesses.length&&h('p',{className:'tenka-note'},'姫が生まれると一門に加わります。18歳に成長した未婚の姫が必要です。'),
  princess?.eligible&&!spouses.length&&h('p',{className:'tenka-note'},'この姫と婚姻できる成人の未婚男性が相手方にいません。別の家や姫を選ぶか、次の世代の成長をお待ちください。'),
  preview&&h('p',{className:preview.ok?'tenka-command-cost':'tenka-feedback failure',role:preview.ok?undefined:'status'},preview.ok?'婚姻の費用：金 '+format(preview.cost?.gold)+' 貫 ／ '+(state.castles.find(c=>c.id===orderCastleId)?.name||'命令元の城')+'の命令 '+(preview.cost?.commands??1):preview.message),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text));
}
function DiplomacyManagement({state,onState,onNotify,targetClan,officerId,orderCastleId}){
 const [confirmClan,setConfirm]=React.useState(''),[feedback,setFeedback]=React.useState(null);
 const diplomacy=global.TenkaDiplomacy;
 if(!diplomacy)return null;
 const view=diplomacy.getView(state),target=(view.targets||[]).find(c=>c.clan===targetClan);
 const action=type=>({type,targetClan,officerId,orderCastleId});
 const subjugation=target?diplomacy.preview(state,action('subjugate')):null,rupture=target?.allied?diplomacy.preview(state,action('breakAlliance')):null;
 const report=result=>{setFeedback({ok:result.ok,text:result.message});setConfirm('');if(result.ok)onState?.(result.state);onNotify?.({text:result.message,success:result.ok});};
 const cost=preview=>'金 '+format(preview?.cost?.gold)+' 貫 ／ 命令 '+(preview?.cost?.commands??1);
 return h('section',{className:'tenka-diplomacy-management','aria-label':'婚姻・恭順・同盟破棄'},
  h(MarriageDiplomacy,{state,onState,onNotify,orderCastleId,targetClan}),
  target&&h('div',{className:'tenka-diplomacy-decisions'},
   h('article',null,h('h4',null,target.name+'に恭順を求める'),h('p',null,'国力と兵力、友好、威信をもとに従属を交渉します。相手の城と家臣団はその家のものとして存続します。'),
    subjugation?.powerRatio!=null&&h('p',{className:'tenka-negotiation-odds'},'自家と相手の国力比 '+Number(subjugation.powerRatio).toFixed(2)+' 倍'+(subjugation.chance!=null?' ／ 受諾の見込み '+Math.round(subjugation.chance)+'％':'')),
    subjugation?.message&&h('small',{className:subjugation.ok?'':'tenka-blocked-reason'},subjugation.message),h('small',{className:'tenka-command-cost'},cost(subjugation)),h('button',{type:'button',className:'tenka-primary-button',disabled:subjugation?.ok!==true,onClick:()=>report(diplomacy.act(state,action('subjugate')))},'恭順を求める')),
   h('article',null,h('h4',null,target.name+'との同盟'),h('p',null,target.allied?'盟約を破棄すると相互の保護と援軍の協力が終了します。友好度 −40、威信 −10。婚姻の記録と配偶関係は残ります。':'現在、この家とは同盟を結んでいません。'),
    target.subordinate&&h('p',null,'この家は自家に恭順中です。同盟を破棄すると恭順関係と貢納も終了します。'),
    target.allied&&h(React.Fragment,null,h('small',{className:'tenka-command-cost'},cost(rupture)),rupture?.ok===false&&h('small',{className:'tenka-blocked-reason'},rupture.message),h('button',{type:'button',className:'tenka-danger-button',disabled:rupture?.ok!==true,onClick:()=>setConfirm(targetClan)},'同盟破棄を検討する'),
     confirmClan===targetClan&&h('div',{className:'tenka-diplomacy-confirm',role:'alert'},h('p',null,target.name+'との同盟を破棄しますか？ 援軍・相互保護が終了し、友好度40と威信10を失います。'+(rupture?.releasesVassal?'恭順関係と貢納も解消します。':'')),h('div',null,h('button',{type:'button',className:'tenka-danger-button',onClick:()=>report(diplomacy.act(state,{...action('breakAlliance'),confirm:true}))},'同盟破棄を確定する'),h('button',{type:'button',onClick:()=>setConfirm('')},'盟約を維持する')))))),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  (view.history||[]).length>0&&h('details',{className:'tenka-aid-history'},h('summary',null,'婚姻と外交の記録'),view.history.slice(0,12).map((entry,index)=>h('article',{key:entry.id||index},h('p',null,entry.message||entry.text||entry.title)))));
}
function EstateManagement({state,castleId,officerId,onState,onNotify}){
 const [policyDraft,setPolicy]=React.useState(null),[demobilizeCount,setDemobilize]=React.useState(''),[feedback,setFeedback]=React.useState(null);
 const systems=global.TenkaSystems,view=systems.getView(state),castle=(view.castles||[]).find(c=>c.id===castleId),estate=castle?.economy;
 if(!estate)return null;
 const forecast=estate.forecast||{},totals=view.economy?.totals||{},monthly=Number.isInteger(state.month),period=monthly?'月':'季',remaining=global.TenkaOrders?.remaining(state,castleId)??state.actionPoints;
 const officer=(view.officers||[]).find(o=>o.id===officerId)||view.administrationFallback;
 const interrupted=!!state.pendingDefense||!!global.TenkaAllies?.hasPendingEngagement?.(state),blocked=!!state.gameOver||interrupted||remaining<1||!officer||officer.available===false||!!officer.busy;
 const policyChanged=state.tenka?.estates?.[castleId]?.policyTurn===state.turn;
 const policy=policyDraft?.castleId===castleId?policyDraft.value:estate.taxPolicy;
 const cost=type=>estate.costs?.[type]||systems.ACTIONS[type]||{};
 const act=(type,extra={})=>{const result=systems.act(state,{type,castleId,orderCastleId:castleId,officerId,...extra});setFeedback({ok:result.ok,text:result.message});if(result.ok)onState?.(result.state);onNotify?.({text:result.message,success:result.ok});};
 const metric=(label,value,note)=>h('div',{className:'tenka-metric',key:label},h('small',null,label),h('strong',null,value),h('span',null,note));
 const signed=value=>(value>=0?'+':'')+format(value);
 const gains=(type,gain)=>type==='commercial'?'商業施設の本格操業':typeof gain==='object'?Object.entries(gain).map(([key,value])=>(key==='kokudaka'?'石高':key==='commerce'?'商業':key)+' +'+format(value)).join(' ／ '):'石高 +'+format(gain)+' 石';
 const project=(type,title,description)=>{const plan=cost(type);return h('article',{className:'tenka-estate-project',key:type},h('h5',null,title),h('p',null,description),h('p',{className:'tenka-project-plan'},'完成まで '+format(plan.duration)+' '+(monthly?'か月':'季')+' ／ 必要な働き手 '+format(plan.workforce)+' 人',h('small',null,'成果の目安：'+gains(type,plan.gain)),h('small',null,'工事中の継続費：毎'+period+' '+format(plan.upkeep)+' 貫')),h('small',{className:'tenka-command-cost'},'着工：金 '+format(plan.gold)+' 貫 ／ 兵糧 '+format(plan.food)+' 石 ／ 命令1'),plan.reason&&h('p',{className:'tenka-blocked-reason'},plan.reason),h('button',{type:'button',className:'tenka-primary-button',disabled:blocked||plan.available===false||(state.gold||0)<(plan.gold||0)||(state.food||0)<(plan.food||0),onClick:()=>act(type)},title+'に着手'));};
 const stockAction=(type,title,description)=>{const plan=cost(type),needsGold=plan.gold||0,needsFood=plan.food||0,reserve=type==='sellGrain'?Math.ceil((totals.foodUpkeep||0)*(monthly?6:2)):0,shortage=(state.food||0)-needsFood<reserve;return h('article',{key:type},h('h5',null,title),h('p',null,description),h('small',{className:'tenka-command-cost'},'金 '+format(needsGold)+' 貫 ／ 兵糧 '+format(needsFood)+' 石 ／ 命令1'),reserve>0&&h('small',{className:shortage?'tenka-blocked-reason':'tenka-command-cost'},'売却後に残す備蓄：'+format(reserve)+' 石'+(shortage?'。兵糧が足りないため売却できません。':'')),h('button',{type:'button',disabled:blocked||(state.gold||0)<needsGold||(state.food||0)<needsFood||shortage,onClick:()=>act(type)},title));};
 return h('section',{className:'tenka-estate-management','aria-label':'領国の経営計画'},
  h('div',{className:'tenka-section-heading'},h('h4',null,'領国の収支と民の暮らし'),h('span',null,estate.taxLabel+' ／ '+castle.name)),
  h('div',{className:'tenka-metrics'},metric(monthly?'今月の収支':'季節の収支',signed(forecast.netIncome)+' 貫','収入 '+format(forecast.income)+' − 支出 '+format(forecast.upkeep)),metric('兵糧の維持',format(forecast.foodUpkeep)+' 石 / '+period,'9月の収穫見込 '+format(forecast.harvest)+' 石'),metric('働き手の余力',format(estate.laborAvailable)+' 人','工事に従事 '+format((estate.projects||[]).reduce((sum,p)=>sum+(p.workforce||0),0))+' 人 ／ 農作業の効率 '+format(estate.laborEfficiency)+'％'),metric('民の不満',format(estate.unrest)+' / 100','重税・徴兵・窮乏が治安と生産に影響')),
  h('div',{className:'tenka-estate-reserve'},h('strong',null,'全領国の蓄え：金 '+format(state.gold)+' 貫 ／ 兵糧 '+format(state.food)+' 石'),h('span',null,'全領国の'+(monthly?'月間':'季節')+'収支 '+signed(totals.netIncome)+' 貫 ／ 兵糧の維持 '+format(totals.foodUpkeep)+' 石'),h('span',null,'現在の兵糧で約 '+(Number.isFinite(monthly?totals.foodReserveMonths:view.economy?.reserveSeasons)?Math.round((monthly?totals.foodReserveMonths:view.economy.reserveSeasons)*10)/10:'—')+' '+(monthly?'か月':'季')+'を維持できます。秋の収穫や次の出兵費は別に見積もってください。')),
  h('details',{className:'tenka-estate-breakdown'},h('summary',null,'この城の収支の内訳を見る'),h('dl',null,[['年貢・税収',forecast.taxIncome],['商業収入',forecast.commerceIncome],['兵の賃金（軍給）',forecast.militaryUpkeep],['城・領地の維持費',forecast.maintenance],['工事の継続費',forecast.projectUpkeep]].map(([label,value])=>h('div',{key:label},h('dt',null,label),h('dd',null,format(value)+' 貫'))))),
  h('div',{className:'tenka-estate-harvest','aria-label':'収穫と災害の見通し'},
   h('div',{className:'tenka-metrics'},metric('秋の収穫見込',format(forecast.harvest)+' 石','被害のない場合 '+format(forecast.baselineHarvest??forecast.harvest)+' 石 ／ 減収 '+format(forecast.harvestLoss)+' 石'),metric('田畑の被害',format(estate.cropDamage)+' / 100','戦禍・害虫・日照り・風水害が収穫を減らします'),metric('民心',format(estate.publicOrder??100-estate.unrest)+' / 100','不満が重なると農民一揆・一向一揆の危険'),metric('治水',format(estate.waterControl)+' / 100','堤防・用水路の整備で洪水と日照りの危険を軽減')),
   h('div',{className:'tenka-estate-health'},h('span',null,'飢饉 '+format(estate.famine)+' / 100'),h('span',null,'疫病 '+format(estate.epidemic)+' / 100'),h('span',null,'戦禍 '+format(estate.devastation)+' / 100'),estate.uprising&&h('strong',{role:'alert'},(estate.uprising.label||(estate.uprising.kind==='ikko'?'一向一揆':'農民一揆'))+'が発生中 ／ 勢力 '+format(estate.uprising.strength))),
   estate.risks&&h('details',{className:'tenka-estate-risks'},h('summary',null,'今月の天候・害虫の危険を見る'),h('dl',null,Object.entries(estate.risks).map(([kind,chance])=>h('div',{key:kind},h('dt',null,({drought:'日照り',pests:'害虫',typhoon:'台風',flood:'洪水'})[kind]||kind),h('dd',null,Number(chance||0).toLocaleString('ja-JP',{maximumFractionDigits:1})+'％ / 月')))),h('p',null,'数値は今月の発生確率です。治水が低い領地や台風期の沿岸部は、備蓄と復旧の備えが必要です。'))),
  forecast.militaryBreakdown&&h('details',{className:'tenka-estate-breakdown tenka-military-pay'},h('summary',null,'兵科ごとの毎月の軍給・兵糧支給'),h('p',{className:'tenka-note'},'保有する兵には出陣中以外も軍給と兵糧を支給します。増兵すると毎月の負担が増え、収入と蓄えが減ります。'),h('div',{className:'tenka-table-scroll'},h('table',{'aria-label':'兵科ごとの月額維持費'},h('thead',null,h('tr',null,['兵科','保有兵数','賃金 / 月','兵糧 / 月'].map(label=>h('th',{key:label,scope:'col'},label)))),h('tbody',null,forecast.militaryBreakdown.filter(line=>line.troops>0).map(line=>h('tr',{key:line.type},h('th',{scope:'row'},line.label||unitNames[line.type]||line.type),h('td',null,format(line.troops)+' 人'),h('td',null,format(line.monthlyWages)+' 貫'),h('td',null,format(line.monthlyFood)+' 石'))))),h('p',{className:'tenka-military-total'},'月額合計：軍給 '+format(forecast.monthlyWages)+' 貫 ／ 兵糧 '+format(forecast.monthlyFood)+' 石'))),
  (estate.events||[]).length>0&&h('details',{className:'tenka-estate-events'},h('summary',null,'この城の災害・民情の記録（'+estate.events.length+'件）'),estate.events.map((event,index)=>h('article',{key:event.id||index},h('small',null,event.year+'年 '+(event.month?event.month+'月':seasons[event.season])+' ／ '+castle.name),h('h5',null,event.title),h('p',null,event.text)))),
  h('div',{className:'tenka-estate-policy'},h('label',{className:'tenka-field'},h('span',null,'この城の年貢・税の方針'),h('select',{'aria-label':'年貢と税の方針',value:policy,disabled:blocked||policyChanged,onChange:e=>setPolicy({castleId,value:e.target.value})},(view.economy?.policies||[]).map(p=>h('option',{value:p.id,key:p.id},p.label)))),h('button',{type:'button',disabled:blocked||policyChanged||policy===estate.taxPolicy,onClick:()=>act('tax',{policy})},'税の方針を改める'),h('p',null,(view.economy?.policies||[]).find(p=>p.id===policy)?.description||''),h('small',null,policyChanged?'この城の年貢方針は今月変更済みです。次の月に再検討できます。':'方針の変更はこの城の命令1。同じ月の変更は1回まで。')),
  h('div',{className:'tenka-section-heading'},h('h4',null,'継続する開発計画'),h('span',null,'開発余地 '+format(estate.developmentCapacity)+' ／ 開墾済み '+format(estate.reclaimed))),
  h('div',{className:'tenka-estate-projects'},project('reclaim','田畑の開墾','働き手と兵糧を継続して充て、新田の完成を待ちます。'),project('commercial','商いの振興','街道と城下に投資します。維持費を含めた収支と人手を確かめましょう。')),
  estate.projects?.length?h('div',{className:'tenka-project-progress'},h('h5',null,'進行中の工事'),estate.projects.map(p=>h('article',{key:p.id},h('strong',null,p.label||p.type),h('span',null,'完成まであと '+format(p.remaining)+' / '+format(p.total)+' '+(monthly?'か月':'季')+' ／ 働き手 '+format(p.workforce)+' 人 ／ 継続費 '+format(p.upkeep)+' 貫'),h('span',null,'完成時：'+gains(p.type,p.gain)),p.status&&h('small',null,p.status)))):h('p',{className:'tenka-note'},'現在、進行中の工事はありません。開発には数か月を要し、働き手と維持費を使います。'),
  h('div',{className:'tenka-estate-stocks'},stockAction('relief','領民を救済する','金と兵糧を配り、飢饉・民の不満・一揆を和らげます。'),systems.ACTIONS.waterworks&&stockAction('waterworks','堤防と用水路を整備する','治水を高め、洪水・日照りの危険と田畑の被害を抑えます。'),systems.ACTIONS.sanitation&&stockAction('sanitation','衛生と医療を整える','井戸や町村を清め、疫病と民の不満を抑えます。'),stockAction('buyGrain','兵糧を買い入れる','金400貫で兵糧1,200石を確保します。'),stockAction('sellGrain','兵糧を売却する','兵糧1,200石を金300貫に換えます。売却後も'+(monthly?'6か月':'2季')+'分の備蓄が必要です。')),
  h('div',{className:'tenka-estate-demobilize'},h('label',{className:'tenka-field'},h('span',null,'農村へ帰す兵の人数'),h('input',{type:'number',inputMode:'numeric',min:1,step:1,max:Math.max(0,(castle.troops||0)-150),'aria-label':'解兵する人数',value:demobilizeCount,onChange:e=>setDemobilize(e.target.value)})),h('button',{type:'button',disabled:blocked||!Number.isSafeInteger(Number(demobilizeCount))||Number(demobilizeCount)<=0||Number(demobilizeCount)>(castle.troops||0)-150,onClick:()=>act('demobilize',{troops:Number(demobilizeCount)})},'指定人数を解兵する'),h('small',null,'守備兵を150人以上残します。兵を農村へ帰し、兵糧の消費と働き手の不足を緩和します。命令1。')),
  interrupted&&h('p',{className:'tenka-blocked-reason'},'先に合戦・援軍への対応を決めてください。'),remaining<1&&h('p',{className:'tenka-blocked-reason'},'この城の今月の命令がありません。別の城を選ぶか、次の月へ進んでください。'),officer?.busy&&h('p',{className:'tenka-blocked-reason'},'この武将は今月の任務中です。別の武将か奉行衆を担当に選んでください。'),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text));
}
function TacticalCommandStatus({battle,onBattle,selectedUnitId}){
 const [feedback,setFeedback]=React.useState('');
 const tactics=global.TenkaTactics;
 if(!tactics?.tacticalView)return null;
 const view=tactics.tacticalView(battle,selectedUnitId),selected=view.selected,side=battle.playerSide||'attacker';
 const setStance=key=>{const result=tactics.stance(battle,selected.id,key);setFeedback(result.message||'部隊の構えを変更しました。');if(result.ok&&result.battle)onBattle?.(result.battle);};
 return h('section',{className:'tenka-tactical-status','aria-label':'部隊の疲労・隊列と戦い方'},
  selected?h(React.Fragment,null,h('div',{className:'tenka-tactical-readiness'},h('strong',null,'戦闘態勢 '+format(selected.readiness)+' / 100'),h('span',null,'疲労 '+format(selected.fatigue)+' ／ 隊列 '+format(selected.cohesion)+' ／ 制圧 '+format(selected.suppression)),h('small',null,selected.exposure+' ／ '+selected.fireLane)),
   h('div',{className:'tenka-stance-controls',role:'group','aria-label':'部隊の戦い方'},Object.entries(tactics.stances||{}).map(([key,stance])=>h('button',{type:'button',key,'aria-pressed':selected.stance===key,disabled:selected.side!==side||!['deployment','fighting'].includes(battle.phase),title:stance.description,onClick:()=>setStance(key)},stance.name))),
   h('p',{className:'tenka-stance-description'},tactics.stances?.[selected.stance]?.description||''),
   (selected.advice||[]).length>0&&h('ul',{className:'tenka-tactical-advice'},selected.advice.map((text,index)=>h('li',{key:index},text)))):h('p',null,'味方部隊を選ぶと、疲労・隊列・射界を確認し、休息や迎撃などの戦い方を指示できます。'),
  h('details',null,h('summary',null,'戦場で判断すること'),h('ul',null,(view.principles||[]).map((text,index)=>h('li',{key:index},text)))),
  feedback&&h('p',{className:'tenka-placement-status',role:'status'},feedback));
}
function Council({state,onState,selectedCastleId,onNotify,onNextSeason}){
 const systems=global.TenkaSystems;
 const [tab,setTab]=React.useState('政務');
 const owned=state.castles.filter(c=>c.clan===state.playerClan);
 const enemies=state.castles.filter(c=>c.clan!==state.playerClan);
 const [castleId,setCastle]=React.useState(owned.some(c=>c.id===selectedCastleId)?selectedCastleId:owned[0]?.id||'');
 const [officerId,setOfficer]=React.useState('');
 const [targetId,setTarget]=React.useState(enemies.some(c=>c.id===selectedCastleId)?selectedCastleId:enemies[0]?.id||'');
 const [targetOfficerId,setTargetOfficer]=React.useState('');
 const [heirId,setHeir]=React.useState('');
 const [regentId,setRegent]=React.useState('');
 const [princessId,setPrincess]=React.useState('');
 const [marriageClanId,setMarriageClan]=React.useState('');
 const [feedback,setFeedback]=React.useState(null);
 const view=systems.getView(state);
 const dynasty=global.TenkaDynasty;
 const dynastyView=dynasty?.getView(state)||{};
 const family=dynastyView.family||{};
 const roster=(view.officers||state.officers.filter(o=>o.clan===state.playerClan)).filter(o=>o.clan===state.playerClan);
 const delegates=roster.filter(o=>o.status==='active'&&(o.birth==null||state.year-o.birth>=15));
 const available=delegates.filter(o=>!o.busy);
 const fallback=['政務','家臣'].includes(tab)?view.administrationFallback:null;
 const chosen=available.find(o=>o.id===officerId)||available[0]||fallback;
 const castle=owned.find(c=>c.id===castleId)||owned[0];
 const castleRemaining=global.TenkaOrders?.remaining(state,castle?.id)??state.actionPoints;
 const castleOrders=c=>global.TenkaOrders?.remaining(state,c.id)??state.actionPoints;
 const target=enemies.find(c=>c.id===targetId)||enemies[0];
 const opposition=state.officers.filter(o=>o.clan===target?.clan&&o.status==='active'&&(o.birth==null||state.year-o.birth>=15));
 const prisoners=state.officers.filter(o=>o.status==='captive'&&o.capturedBy===state.playerClan);
 const canAssign=type=>!!chosen&&(!chosen.administrative||chosen.allowedActions?.includes(type));
 const report=result=>{
   setFeedback({ok:result.ok,text:result.message});
   if(result.ok)onState(result.state);
   onNotify?.({text:result.message,success:result.ok});
 };
 const act=(type,extra={})=>{
   if(!canAssign(type)){report({ok:false,message:'担当できる武将がいません。家臣の登用、または次の月へ進んで任務の完了をお待ちください。'});return;}
   const result=systems.act(state,{type,castleId:['negotiation','infiltrate'].includes(type)?target?.id:castle?.id,orderCastleId:castle?.id,targetCastleId:target?.id,targetClan:target?.clan,officerId:chosen?.id,targetOfficerId:extra.targetOfficerId||targetOfficerId||opposition[0]?.id,...extra});
   report(result);
 };
 const dynastyAct=(type,extra={})=>{if(dynasty)report(dynasty.act(state,{type,orderCastleId:castle?.id,...extra}));};
 const field=(title,child)=>h('label',{className:'tenka-field'},h('span',null,title),child);
 const selector=(value,onChange,options,aria)=>h('select',{'aria-label':aria,value,disabled:!options.some(o=>!o.disabled),onChange:e=>onChange(e.target.value)},options.length?options.map(o=>h('option',{key:o.id,value:o.id,disabled:!!o.disabled},o.label)):h('option',{value:''},'選択できる人物がいません'));
 const actions=(type,title,text)=>h('button',{key:type,className:'tenka-action',disabled:castleRemaining<1||!!state.pendingDefense||!canAssign(type),onClick:()=>act(type)},h('strong',null,title),h('span',null,text),h('small',null,'金 '+format(systems.ACTIONS[type]?.gold)+' 貫 ／ 兵糧 '+format(systems.ACTIONS[type]?.food)+' 石 ・ '+(castle?.name||'選択した城')+'の命令1 →'));
 const metric=(title,value,note)=>h('div',{className:'tenka-metric',key:title},h('small',null,title),h('strong',null,value),h('span',null,note));
 const economy=(view.castles||[]).find(c=>c.id===castle?.id)||castle;
 const loyalty=officer=>officer.loyalty??state.tenka?.loyalty?.[officer.id]??70;
 const age=officer=>dynasty?.age?dynasty.age(state,officer):officer.age??(officer.birth==null?null:state.year-officer.birth);
 const ageLabel=officer=>age(officer)==null?'年齢不詳':(['dead','executed'].includes(officer.status)?'享年 ':'')+age(officer)+'歳';
 const originLabel=officer=>officer.origin==='fictional'?'この年代記の人物':'史実の人物';
 const kin=(dynastyView.kin||[]).filter(o=>o.gender!=='female');
 const princesses=dynastyView.princesses||[];
 const recruits=dynastyView.recruits||[];
 const heirs=dynastyView.eligibleHeirs||[];
 const regents=dynastyView.eligibleRegents||[];
 const marriageClans=dynastyView.marriageClans||[];
 const selectedHeir=heirs.find(o=>o.id===heirId)||heirs.find(o=>o.id===family.heir?.id)||heirs[0];
 const selectedRegent=regents.find(o=>o.id===regentId)||regents.find(o=>o.id===family.regent?.id)||regents[0];
 const marriageable=o=>o.marriageable??(age(o)>=18&&!o.marriedTo&&!['dead','executed','captive'].includes(o.status));
 const selectedPrincess=princesses.find(o=>o.id===princessId&&marriageable(o))||princesses.find(marriageable);
 const selectedMarriage=marriageClans.find(c=>c.id===marriageClanId)||marriageClans[0];
 const nextSeason=()=>{setFeedback(null);onNextSeason?.();};
 const dateLabel=global.TenkaCalendar?.format?.(state)||(state.year+'年 '+(state.month||[3,6,9,12][state.season||0])+'月');
 const recruitmentRecord=state.tenka?.dynasty?.recruitment?.[state.playerClan];
 const recruitmentFull=recruitmentRecord?.turn===state.turn&&recruitmentRecord.count>=2;
 const recruitButton=(candidate,compact=false)=>{
   const cost=candidate.cost??(delegates.length?150:0);
   const orderCost=candidate.commandCost??(delegates.length?1:0);
   const full=recruitmentFull&&!candidate.emergency;
   return h('button',{className:compact?'tenka-primary-button':'','aria-label':candidate.name+'を登用',disabled:full||!!state.pendingDefense||castleRemaining<orderCost||(state.gold||0)<cost,onClick:()=>dynastyAct('recruit',{candidateId:candidate.id})},full?'今月の登用は終了':compact?'家臣を登用する':'登用する',compact&&h('small',null,full?'次の月に新たな人材を探す':'金 '+format(cost)+' 貫'+(orderCost?' ・ 命令1':' ・ 命令不要')));
 };
 return h('div',{className:'tenka-council'},
  h('div',{className:'tenka-council-intro'},h('div',null,h('span',{className:'tenka-kicker'},'TENKA FUBU / 評定'),h('h3',null,'国を富ませ、人を用い、時を読む。'),h('p',null,'各城は毎月3回の命令を出せます。武将の任務は毎月一つ。命令と任務は次の月に回復します。')),h('div',{className:'tenka-season-control'},h('div',{className:'tenka-orders'},h('strong',null,castleRemaining+' / 3'),h('span',null,(castle?.name||'選択した城')+'の今月の命令')),onNextSeason&&h('button',{className:'tenka-next-season',disabled:!!state.pendingDefense,onClick:nextSeason},'次の月へ →'),h('small',null,state.pendingDefense?'先に敵襲への対応を決めてください':dateLabel+' ／ 各城ごとに命令を回復'))),
  h('nav',{className:'tenka-tabs','aria-label':'評定の項目'},['政務','外交','調略','家臣','一門・継承','軍学','年代記'].map(name=>h('button',{key:name,'aria-pressed':name===tab,onClick:()=>{setTab(name);setFeedback(null);}},name))),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  !available.length&&['政務','外交','調略','家臣'].includes(tab)&&h('aside',{className:'tenka-availability',role:'status'},h('div',null,h('strong',null,delegates.length?'成人武将は今月の任務に就いています。':'登用や元服で家臣団を整えましょう。'),h('p',null,fallback?'奉行衆が開墾・商業・動員・褒賞・捕虜の解放を代行します。外交・調略・出陣には成人武将が必要です。':'次の月へ進むと任務が完了します。成人武将がいない場合も、在地の人材を登用して再起できます。')),h('div',{className:'tenka-inline-actions'},recruits[0]&&recruitButton(recruits[0],true),h('button',{onClick:()=>setTab('家臣')},'人材を確認する'))),
  ['政務','外交','調略','家臣'].includes(tab)&&h('div',{className:'tenka-assignment'},
   field('担当武将',selector(chosen?.id||'',setOfficer,[...(!chosen?[{id:'',label:'任務可能な成人武将がいません',disabled:true}]:[]),...delegates.map(o=>({id:o.id,label:o.name+' ／ 政'+o.politics+'・知'+o.intelligence+(o.busy?'・任務中（翌月に復帰）':''),disabled:!!o.busy})),...(fallback?[{id:fallback.id,label:'奉行衆 ／ 政務を代行'}]:[])],'評定の担当武将')),
   field('命令を出す城',selector(castle?.id||'',setCastle,owned.map(c=>({id:c.id,label:c.name+' ／ '+(c.province||'自領')+' ／ 命令 '+castleOrders(c)+' / 3'})),'命令を出す城')),
   ['外交','調略'].includes(tab)&&field('相手の勢力・拠点',selector(target?.id||'',setTarget,enemies.map(c=>({id:c.id,label:c.clanName+' ／ '+c.name})),'交渉先の拠点')),
   chosen&&h('div',{className:'tenka-delegate'},chosen.administrative?h('span',{className:'tenka-administration-seal','aria-hidden':true},'奉行'):h(Portrait,{officer:chosen,year:state.year}),h('div',null,h('strong',null,chosen.name),h('small',null,chosen.administrative?'武将が不在の間、領国の政務を代行':'統率 '+chosen.leadership+' ／ 政治 '+chosen.politics+' ／ 知略 '+chosen.intelligence)))),
  tab==='政務'&&castle&&h('section',null,
   h('div',{className:'tenka-section-heading'},h('h4',null,castle.province+'・'+castle.name),h('span',null,'石高と民力が動員・収穫の土台になります')),
   h('div',{className:'tenka-metrics'},metric('石高',format(castle.kokudaka)+' 石','秋の収穫を支える生産力'),metric('動員枠',format(systems.mobilizationLimit(castle))+' 人','現兵力 '+format(castle.troops)+' 人'),metric('商業',format(economy.commerce)+'','月間収入 +'+format(economy.economy?.forecast?.commerceIncome??economy.income)+' 貫'),metric('人口',format(castle.population)+' 人','開墾と商いを担う領民'),metric('士気',castle.morale+' / 100','兵糧の不足・敗戦で低下')),
   h(EstateManagement,{state,castleId:castle.id,officerId:chosen?.id,onState,onNotify}),
   h('div',{className:'tenka-action-grid'},!economy.economy&&actions('reclaim','田畑の開墾','新田を開き石高を増加。担当武将の政治力が成果を左右します。'),!economy.economy&&actions('commercial','商いの振興','街道・城下の商業を育て、毎月の銭収入を増やします。'),actions('levy','兵の動員','石高・人口・地形に応じた上限まで徴募。農村の働き手と兵糧の余力を確かめてください。')),
   h('p',{className:'tenka-note'},'戦争は領国の余力で支えます。開発中の人手・税負担・城の維持費を見比べ、凶作や出兵に備えて兵糧と金を残しましょう。')),
  tab==='外交'&&h(AidRequests,{state,onState,onNotify}),
  tab==='外交'&&h(AidRequestForm,{state,onState,onNotify}),
  tab==='外交'&&target&&h('section',null,
   h('div',{className:'tenka-metrics'},metric('交渉先',target.clanName,target.name),metric('外交関係',(state.relations[target.clan]??0)+'',state.alliances.includes(target.clan)?'盟約を締結中':'信頼を重ねて盟約へ'),metric('相手の兵力',format(target.troops)+' 人','消耗した勢力には交渉の余地も生まれます')),
   h('div',{className:'tenka-action-grid'},actions('negotiation','使者と贈答','家臣を使者に送り関係を改善。十分な信頼を得れば期限付きの盟約を結びます。')),
   h(DiplomacyManagement,{state,onState,onNotify,targetClan:target.clan,officerId:chosen?.id,orderCastleId:castle?.id}),
   h('p',{className:'tenka-note'},'同盟国への侵攻はできません。婚姻で家同士を結び、恭順の交渉で従属関係を築けます。同盟の破棄には友好と威信を失う代償があります。')),
  tab==='調略'&&target&&h('section',null,
   field('内応を誘う武将',selector(opposition.some(o=>o.id===targetOfficerId)?targetOfficerId:opposition[0]?.id||'',setTargetOfficer,opposition.map(o=>({id:o.id,label:o.name+' ／ 忠誠 '+loyalty(o)})),'調略の対象武将')),
   h('div',{className:'tenka-action-grid'},actions('infiltrate','内応の密約','知略に長けた家臣を送り、敵将の忠誠を揺さぶります。疲弊した守備と低い忠誠は離反の機会になります。')),
   h('p',{className:'tenka-note'},'結果は担当武将の知略・対象の忠誠・領国の疲弊に左右されます。戦場で兵を減らすだけでなく、家臣の結束も守りましょう。')),
  tab==='家臣'&&h('section',null,
   h(RetainerStations,{state,onState,onNotify}),
   h('div',{className:'tenka-section-heading'},h('h4',null,'新たな家臣の登用'),h('span',null,'候補 '+recruits.length+' 人 ／ 今月あと '+Math.max(0,2-(recruitmentRecord?.turn===state.turn?recruitmentRecord.count||0:0))+' 人を登用できます')),
   h('p',{className:'tenka-note'},'各地の在地人材と仕官を求める浪人を登用します。史実の人物は生年に応じて誕生・元服し、この年代記で生まれる子や在地人材は創作の人物として区別します。成人武将が一人もいない場合、最初の登用は金・命令を消費しません。'),
   recruits.length?h('div',{className:'tenka-recruit-list'},h('table',{className:'tenka-recruit-table','aria-label':'登用候補の一覧'},h('caption',null,'在地人材8人と仕官を求める浪人を比較できます。登用済みの候補は一覧から除かれます。'),h('thead',null,h('tr',null,['武将','出自・年齢','統率','武勇','知略','政治','費用','登用'].map(label=>h('th',{key:label,scope:'col'},label)))),h('tbody',null,recruits.map(o=>h('tr',{key:o.id,'data-candidate-id':o.id},h('th',{scope:'row','data-label':'武将'},h('div',{className:'tenka-recruit-person'},h(Portrait,{officer:o,year:state.year,size:48}),h('strong',null,o.name))),h('td',{'data-label':'出自・年齢'},h('span',null,(o.originPlace||'浪人')+' ／ '+ageLabel(o)),h('small',null,originLabel(o))),...['leadership','valor','intelligence','politics'].map((stat,i)=>h('td',{key:stat,'data-label':['統率','武勇','知略','政治'][i],className:'tenka-recruit-stat'},o[stat])),h('td',{'data-label':'費用'},format(o.cost??150)+' 貫',h('small',null,o.commandCost===0?'命令不要':'命令1')),h('td',{'data-label':'登用'},recruitButton(o))))))):h('p',{className:'tenka-note'},'今月の仕官希望者はいません。次の月に新たな在地人材を探せます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'家臣団'),h('span',null,'武将ごとに異なる創作肖像・能力・忠誠')),
   roster.some(o=>o.status==='active')?h('div',{className:'tenka-officer-grid'},roster.filter(o=>o.status==='active').map(o=>h('article',{className:'tenka-officer',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)+(o.busy?' ／ 今月は任務中':'')),h('small',null,'忠誠 '+loyalty(o)+' ／ 統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),h('button',{disabled:castleRemaining<1||!!state.pendingDefense||!canAssign('reward'),onClick:()=>act('reward',{targetOfficerId:o.id})},'加増・褒賞'))))):h('p',{className:'tenka-note'},'成人の家臣がいません。上の「新たな家臣の登用」から人材を迎えてください。領国の政務は奉行衆が支えます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'捕らえた武将'),h('span',null,prisoners.length+' 人')),
   prisoners.length?h('div',{className:'tenka-officer-grid'},prisoners.map(o=>h('article',{className:'tenka-officer prisoner',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('small',null,'統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),h('div',{className:'tenka-prisoner-actions'},['enlist','release','execute'].map(type=>h('button',{key:type,disabled:castleRemaining<1||!!state.pendingDefense||!canAssign(type),onClick:()=>act(type,{targetOfficerId:o.id})},labels[type]))))))):h('p',{className:'tenka-note'},'捕虜はいません。落城・敗走時には武将の捕縛、討ち死に、逃亡が発生します。'),
   h('p',{className:'tenka-note'},'史実に登場する人物を収録しています。合戦後の生死・離反・登用は、この年代記での分岐です。'),
   state.lastBattle&&h(BattleAftermath,{state,battle:state.lastBattle,onState,onNotify,selectedCastleId:castle?.id,compact:true})),
  tab==='一門・継承'&&h('section',{className:'tenka-family'},
   h('div',{className:'tenka-section-heading'},h('h4',null,'家を継ぎ、次の世代を育てる'),h('span',null,'家督の備え・一門の誕生・姫の婚姻')),
   h('div',{className:'tenka-family-leaders'},[['当主',family.head],['世継ぎ',family.heir],['後見役',family.regent]].map(([role,o])=>h('article',{className:'tenka-family-leader',key:role},h('span',{className:'tenka-person-tag'},role),o?h(React.Fragment,null,h(Portrait,{officer:o,year:state.year,size:68}),h('strong',null,o.name),h('small',null,ageLabel(o)+' ／ '+originLabel(o))):h('p',null,role==='後見役'?'未指定（幼主を支える成人武将）':'未指定')))),
   h('div',{className:'tenka-succession-controls'},
    h('div',null,field('次の世継ぎ',selector(selectedHeir?.id||'',setHeir,heirs.map(o=>({id:o.id,label:o.name+' ／ '+ageLabel(o)})),'世継ぎを選ぶ')),h('button',{className:'tenka-primary-button',disabled:!selectedHeir||selectedHeir.id===family.heir?.id,onClick:()=>dynastyAct('appointHeir',{targetOfficerId:selectedHeir.id})},'世継ぎを定める')),
    h('div',null,field('幼主を補佐する後見役',selector(selectedRegent?.id||'',setRegent,regents.map(o=>({id:o.id,label:o.name+' ／ '+ageLabel(o)+'・政'+o.politics})),'後見役を選ぶ')),h('button',{className:'tenka-primary-button',disabled:!selectedRegent||selectedRegent.id===family.regent?.id,onClick:()=>dynastyAct('appointRegent',{targetOfficerId:selectedRegent.id})},'後見役を定める'))),
   h('p',{className:'tenka-note'},'当主が亡くなると、指定した世継ぎが家督を継ぎます。幼い当主には成人の後見役を置けます。男子は出生時から一門に入り、15歳で元服して政務と合戦を担います。女子は姫として育ち、18歳から婚姻を結べます。出生・婚姻の結果は史実と異なる場合があります。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'一門衆'),h('span',null,kin.length+' 人 ／ 幼年の一門もここで確認できます')),
   kin.length?h('div',{className:'tenka-officer-grid'},kin.map(o=>h('article',{className:'tenka-officer',key:o.id},h(Portrait,{officer:o,year:state.year,size:62}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)),h('small',null,['dead','executed'].includes(o.status)?'故人':o.status==='captive'?'捕縛中':o.id===family.head?.id?'当主':o.id===family.heir?.id?'世継ぎ':age(o)<15?'幼年・'+(o.birth+15)+'年に元服':'元服済み・一門衆'))))):h('p',{className:'tenka-note'},'一門の誕生や養子によって、ここに家族が加わります。世継ぎは家臣団からも指定できます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'姫と政略結婚'),h('span',null,'姫は18歳から婚姻を結べます')),
   princesses.length?h('div',{className:'tenka-officer-grid'},princesses.map(o=>h('article',{className:'tenka-officer',key:o.id},h(Portrait,{officer:o,year:state.year,size:62}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)),h('small',null,['dead','executed'].includes(o.status)?'故人':o.status==='captive'?'捕縛中':o.marriedTo?'婚姻済み':age(o)<18?'成長を見守る・'+(o.birth+18)+'年から婚姻可':'婚姻可能'))))):h('p',{className:'tenka-note'},'姫が誕生するとここに加わります。成長後は他家との婚姻で外交関係を結べます。'),
   h(MarriageDiplomacy,{state,onState,onNotify,orderCastleId:castle?.id}),
   h('div',{className:'tenka-section-heading'},h('h4',null,'次の世代の便り'),h('span',null,'史実の生年と元服年')),
   (dynastyView.upcoming||[]).length?h('div',{className:'tenka-upcoming'},dynastyView.upcoming.map(event=>h('article',{key:event.id},h('strong',null,event.year+'年'),h('div',null,h('span',{className:'tenka-person-tag'},event.origin==='fictional'?'この年代記':event.kind==='birth'?'史実の生年':'元服の予定'),h('h5',null,event.title),h('p',null,event.text))))):h('p',{className:'tenka-note'},'近い将来の誕生・元服の知らせはありません。在地人材の登用は毎月行えます。')),
  tab==='軍学'&&h('section',null,h('div',{className:'tenka-section-heading'},h('h4',null,'兵科・地形・兵站'),h('span',null,'戦略を、戦場の配置につなぐ')),
   h('div',{className:'tenka-table-scroll'},h('table',{className:'tenka-unit-table'},h('thead',null,h('tr',null,['兵科','得意とする働き','不利となる状況'].map(s=>h('th',{key:s},s)))),h('tbody',null,[['足軽','長柄で戦列を支え、城門と曲輪を攻める','弓・鉄砲の射程内で足を止める'],['騎馬','平地で機動・側面攻撃・追撃','森林・斜面・渡河と密集した槍の戦列'],['鉄砲','射程と火力で敵の戦列を崩す','雨天・接近戦・装填中の突撃'],['弓','山林・曲輪からの射撃と継続した援護','至近距離の騎馬や足軽'],['水軍','沿岸の輸送と船上からの射撃','陸上での戦闘には参加できない']].map(row=>h('tr',{key:row[0]},row.map((s,i)=>h(i?'td':'th',{key:i},s))))))),
   h('div',{className:'tenka-action-grid'},h('article',{className:'tenka-lore'},h('h4',null,'野戦と伏兵'),h('p',null,'部隊ごとに陣形を選び、森林・丘陵を使って伏兵を配置。射程、側面、武将の兵科適性が戦果を左右します。')),h('article',{className:'tenka-lore'},h('h4',null,'籠城と地の利'),h('p',null,'敵襲の急報から防御戦を指揮します。堀・城門・曲輪・本丸を利用し、高所の弓・鉄砲で敵の進軍を妨げましょう。')),h('article',{className:'tenka-lore'},h('h4',null,'戦の兵糧'),h('p',null,'兵力に比例して維持・出陣・戦闘の兵糧を消費します。長期戦と大軍は領国の蓄えを圧迫します。')))),
  tab==='年代記'&&h('section',null,h('div',{className:'tenka-section-heading'},h('h4',null,'史実と、あなたの年代記'),h('span',null,era(state.year)+' '+dateLabel)),
   h('p',{className:'tenka-note'},'開始年は1560年。鉄砲伝来（1543年）は既往史です。史実の年表と、プレイで起きた合戦・登用の記録を区別して表示します。史実の戦いは当事者や領地が変われば同じ結果にはなりません。'),
   h('div',{className:'tenka-chronicle'},(view.chronicle||state.tenka?.chronicle||[]).map((event,index)=>h('article',{key:event.id||index},h('div',null,h('span',{className:'tenka-event-tag'},event.kind==='past'?'既往史':event.kind==='branch'?'分岐の記録':'史実・年代'),h('strong',null,(event.year||'')+'年 '+(event.month?event.month+'月':event.season!=null?seasons[event.season]||'':''))),h('h4',null,event.title),h('p',null,event.text||event.description),event.source&&h('a',{href:typeof event.source==='string'?event.source:event.source.url,target:'_blank',rel:'noreferrer'},'参考資料')))),
   h('details',{className:'tenka-historical-note'},h('summary',null,'再現と史料について'),h('p',null,'武将名・旧国・主要拠点は1560年春を基準としています。石高・兵数・能力・兵科相性はゲーム用の推計です。城郭は特徴を反映した模式復元、肖像は個人ごとの創作表現で、実際の容貌や発掘図面の完全復元ではありません。')))
 );
}
function BattleAftermath({state,battle=state.lastBattle,onState,onNotify,selectedCastleId,compact=false}){
 const [officerId,setOfficer]=React.useState('');
 const [castleId,setCastle]=React.useState(selectedCastleId||'');
 const [feedback,setFeedback]=React.useState(null);
 const [executionId,setExecution]=React.useState(null);
 if(!battle)return null;
 const systems=global.TenkaSystems;
 const model=battleAftermathView(state,battle);
 const view=systems.getView(state);
 const postVictory=state.gameOver&&state.winner===state.playerClan;
 const available=(view.officers||[]).filter(o=>o.status==='active'&&(postVictory||o.available!==false&&!o.busy));
 const candidates=available.length?available:view.administrationFallback?[view.administrationFallback]:[];
 const delegate=candidates.find(o=>o.id===officerId)||candidates[0];
 const owned=state.castles.filter(c=>c.clan===state.playerClan);
 const destination=owned.find(c=>c.id===castleId)||global.TenkaOrders?.defaultCastle(state,selectedCastleId)||owned[0];
 const remaining=global.TenkaOrders?.remaining(state,destination?.id)??state.actionPoints;
 const captives=model.rows.filter(o=>o.prisoner);
 const blocked=type=>!onState?'この記録からの命令はできません':state.pendingDefense?'先に敵襲への対応を決めてください':state.gameOver&&!postVictory?'この年代記は決着しました':!postVictory&&remaining<1?'この城の今月の命令がありません。別の城を選ぶか次の月に処遇を決められます':!delegate?'担当できる成人武将がいません':delegate.administrative&&!delegate.allowedActions?.includes(type)?'説得・処断には成人武将が必要です':(state.gold||0)<(systems.ACTIONS[type]?.gold||0)?'金が不足しています':'';
 const decide=(type,row)=>{
  const reason=blocked(type);
  if(reason){setFeedback({id:row.officerId,ok:false,text:reason});return;}
  const result=systems.act(state,{type,officerId:delegate.id,castleId:destination?.id,orderCastleId:destination?.id,targetOfficerId:row.officerId});
  setFeedback({id:row.officerId,ok:result.ok,text:result.message});setExecution(null);
  if(result.ok)onState?.(result.state);
  onNotify?.({text:result.message,success:result.ok});
 };
 return h('section',{className:'tenka-aftermath'+(compact?' compact':''),'aria-label':'戦後の武将・捕虜の処遇'},
  h('div',{className:'tenka-aftermath-heading'},h('div',null,h('span',{className:'tenka-kicker'},'合戦後の報告'),h('h3',null,'武将の安否と捕虜の処遇')),h('small',null,battle.defender||'合戦の記録')),
  model.legacy?h('p',{className:'tenka-note'},'この合戦は旧形式の記録のため、武将ごとの安否は記録されていません。現在の捕虜は「評定 → 家臣」で確認できます。次の合戦から人物別に記録します。'):h(React.Fragment,null,
   h('p',{className:'tenka-aftermath-summary',role:'status'},'討死 '+model.counts.killed+' 人 ／ 捕虜 '+model.counts.captured+' 人 ／ 生還・退却 '+model.counts.survived+' 人'),
   h('p',{className:'tenka-aftermath-note'},'当時の安否と現在の状態を表示します。兵士の損失には戦死・負傷・離散を含み、武将の討死とは別に記録します。'),
   captives.length>0&&h('div',{className:'tenka-aftermath-delegate'},h('label',{className:'tenka-field'},h('span',null,'捕虜の処遇を命じる城'),h('select',{'aria-label':'捕虜の処遇を命じる城',value:destination?.id||'',disabled:!owned.length,onChange:e=>setCastle(e.target.value)},owned.map(c=>h('option',{value:c.id,key:c.id},c.name+' ／ 命令 '+(global.TenkaOrders?.remaining(state,c.id)??state.actionPoints)+' / 3')))),h('label',{className:'tenka-field'},h('span',null,'捕虜の処遇を命じる担当'),h('select',{'aria-label':'捕虜の処遇の担当武将',value:delegate?.id||'',disabled:!candidates.length,onChange:e=>setOfficer(e.target.value)},candidates.length?candidates.map(o=>h('option',{value:o.id,key:o.id},o.name+(o.administrative?' ／ 解放を代行':''))):h('option',{value:''},postVictory?'成人武将がいません':'未任務の成人武将がいません'))),h('small',null,(postVictory?'天下統一後の処遇は命令を消費しません。':'各処遇は選択した城の命令1。')+'召し抱えは金 '+format(systems.ACTIONS.enlist.gold)+' 貫。奉行衆は解放を代行します。')),
   model.rows.length?h('div',{className:'tenka-aftermath-list'},model.rows.map(row=>h('article',{className:'tenka-aftermath-person '+row.outcome,key:row.officerId},
    row.officer&&h(Portrait,{officer:row.officer,year:battle.year||state.year,size:52}),
    h('div',{className:'tenka-aftermath-person-body'},h('div',{className:'tenka-aftermath-person-title'},h('strong',null,row.name),h('span',{className:'tenka-side-tag'},row.own?'味方':'敵'),h('span',{className:'tenka-fate-tag'},row.label)),row.current&&h('small',null,'現在：'+row.current),row.decision?.message&&h('p',{className:'tenka-aftermath-decision'},row.decision.message),
     row.prisoner&&h(React.Fragment,null,h('div',{className:'tenka-aftermath-actions'},['enlist','release','execute'].map(type=>h('button',{key:type,disabled:!!blocked(type),title:blocked(type)||systems.ACTIONS[type].description,onClick:()=>type==='execute'?setExecution(row.officerId):decide(type,row)},labels[type]))),
      (blocked('release')||blocked('enlist'))&&h('small',{className:'tenka-aftermath-blocked'},blocked('release')||blocked('enlist')),
      executionId===row.officerId&&h('div',{className:'tenka-execution-confirm',role:'alert'},h('p',null,row.name+'を処断しますか？ 武将は死亡し、友好・威信・家臣の忠誠が低下します。'),h('button',{onClick:()=>decide('execute',row)},'処断を確定する'),h('button',{onClick:()=>setExecution(null)},'戻る'))),
     feedback?.id===row.officerId&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text))
   ))):h('p',{className:'tenka-note'},'この合戦に出陣・在城した武将の記録はありません。')
  )
 );
}
function Tactics({battle,onBattle,selectedUnitId,onSelectedUnitChange,deploymentTool,onDeploymentToolChange,selectedStructureId,onSelectedStructureChange,placementRotation=0,onPlacementRotationChange}){
 const tactics=global.TenkaTactics,side=battle.playerSide||'attacker',deploying=battle.phase==='deployment';
 const [message,setMessage]=React.useState(''),[localTool,setLocalTool]=React.useState('unit'),[draft,setDraft]=React.useState(null),[localUnitId,setLocalUnit]=React.useState(''),[unitDraft,setUnitDraft]=React.useState(null);
 const deploymentRoster=battle.units.filter(u=>u.side===side&&!['destroyed','routed'].includes(u.status));
 const units=deploymentRoster.filter(u=>u.troops>0);
 const unit=units.find(u=>u.id===(selectedUnitId||localUnitId));
 const turnMode=battle.controlMode==='turns',deploymentStatus=turnMode?tactics.deploymentStatus?.(battle):null;
 const checkedUnits=new Set(turnMode?units.filter(entry=>entry.deployedConfirmed).map(entry=>entry.id):(battle.ledger||[]).filter(entry=>entry.kind==='deploy').map(entry=>entry.command?.unitId));
 const checkedCount=units.filter(u=>checkedUnits.has(u.id)).length;
 const terrainNames={mountain:'山',valley:'谷',river:'川',field:'田畑',town:'町',village:'村',forest:'林',hill:'丘陵'};
 const terrainAdvice={mountain:'高低差と迂回路に注意',valley:'進路と側面の守りを確認',river:'橋や渡れる場所を確認',field:'見通しを確かめ、射界を取る',town:'道や建物を目印に布陣',village:'部隊の間隔と進路を確保',forest:'足軽・弓・鉄砲の伏兵に活用',hill:'高低差を見ながら布陣'};
 const features=(battle.terrainFeatures||[]).filter(feature=>Number.isFinite(feature.x)&&Number.isFinite(feature.z));
 const unitKey=unit?unit.id+':'+unit.x+':'+unit.z:'';
 const unitX=unitDraft?.key===unitKey?unitDraft.x:String(Math.round((unit?.x||0)*10)/10),unitZ=unitDraft?.key===unitKey?unitDraft.z:String(Math.round((unit?.z||0)*10)/10);
 const nearFeatures=unit?features.filter(feature=>Math.hypot(unit.x-feature.x,unit.z-feature.z)<=feature.radius).map(feature=>feature.name||terrainNames[feature.type]||'地形'):[];
 const tool=deploymentTool||localTool;
 const works=(battle.fortifications||[]).filter(s=>s.side===side&&s.hp>0);
 const selected=works.find(s=>s.id===selectedStructureId),kind=selected?.kind||(tool==='camp'?'camp':'palisade');
 const zone=tactics.deploymentZone(battle),budget=tactics.fortificationBudget?.(battle);
 const key=selected?.id||'new:'+tool;
 const defaultX=selected?.x??Math.round((zone.xMin+zone.xMax)/2),defaultZ=selected?.z??Math.round((zone.zMin+zone.zMax)/2);
 const x=draft?.key===key?draft.x:String(defaultX),z=draft?.key===key?draft.z:String(defaultZ);
 const rotation=selected?.rotation??placementRotation;
 const result=(outcome)=>{if(outcome?.ok===false){setMessage(outcome.message);return false;}if(outcome?.battle){onBattle(outcome.battle);setMessage(outcome.message||'布陣を変更しました。');setDraft(null);setUnitDraft(null);return true;}return false;};
 const selectTool=(next)=>{setLocalTool(next);onDeploymentToolChange?.(next);onSelectedStructureChange?.(null);setDraft(null);setMessage(next==='unit'?'味方部隊を選び、戦場の地面をクリックして配置します。':'戦場の地面をクリックして'+(next==='camp'?'本陣':'木柵')+'を設置します。');};
 const selectWork=(id)=>{const work=works.find(s=>s.id===id);setDraft(null);if(work){setLocalTool(work.kind);onDeploymentToolChange?.(work.kind);onPlacementRotationChange?.(work.rotation||0);}onSelectedStructureChange?.(work?.id||null);setMessage(work?'戦場の地面をクリックするか、座標を指定して移設できます。':'新しい'+(tool==='camp'?'本陣':'木柵')+'を設置します。');};
 const coordinate=(axis,value)=>setDraft({key,x,z,[axis]:value});
 const place=(e)=>{e?.preventDefault();if(x.trim()===''||z.trim()===''){setMessage('東西・南北の座標を両方入力してください。');return;}const command={x:Number(x),z:Number(z),rotation};if(selected)result(tactics.moveFortification(battle,{...command,id:selected.id}));else{const before=new Set(works.map(s=>s.id)),outcome=tactics.placeFortification(battle,{...command,kind});if(result(outcome)){const placed=(outcome.battle.fortifications||[]).find(s=>s.side===side&&!before.has(s.id));if(placed)onSelectedStructureChange?.(placed.id);}}};
 const rotate=(value)=>{const angle=Number(value);if(!selected||result(tactics.moveFortification(battle,{id:selected.id,x:selected.x,z:selected.z,rotation:angle})))onPlacementRotationChange?.(angle);};
 const remove=()=>{if(selected&&result(tactics.removeFortification(battle,selected.id)))onSelectedStructureChange?.(null);};
 const selectUnit=(id)=>{setLocalTool('unit');onDeploymentToolChange?.('unit');onSelectedStructureChange?.(null);setLocalUnit(id);onSelectedUnitChange?.(id);setUnitDraft(null);setMessage('選んだ部隊を、地面のクリック／ドラッグか座標で配置してください。');};
 const unitCoordinate=(axis,value)=>setUnitDraft({key:unitKey,x:unitX,z:unitZ,[axis]:value});
 const deployUnit=(e)=>{e?.preventDefault();if(!unit)return;if(unitX.trim()===''||unitZ.trim()===''){setMessage('部隊を置く東西・南北の座標を両方入力してください。');return;}result(tactics.deploy(battle,{unitId:unit.id,x:Number(unitX),z:Number(unitZ)}));};
 const formation=(value)=>result(tactics.formation(battle,unit.id,value));
 const ambush=()=>result(tactics.ambush(battle,unit.id));
 const availableToRestore=entry=>{const others=deploymentRoster.filter(other=>other.id!==entry.id&&!other.foreignSupport);return Math.max(0,Math.min((battle.availableUnits?.[entry.type]||0)-others.filter(other=>other.type===entry.type).reduce((sum,other)=>sum+other.troops,0),(battle.availableTroops||0)-others.reduce((sum,other)=>sum+other.troops,0)));};
 const changeReserve=(entry)=>{if(entry.foreignSupport)return;const troops=entry.troops>0?0:availableToRestore(entry);if(!entry.troops&&troops<1){setMessage('この兵科を出陣させる予備兵がいません。ほかの部隊の兵数を確認してください。');return;}const outcome=tactics.deploy(battle,{unitId:entry.id,troops,...(troops===0?{commanderId:null}:{}),confirmPosition:false});if(result(outcome))setMessage((unitNames[entry.type]||'部隊')+(troops===0?'を予備へ戻しました。兵は失われず、指揮武将をほかの兵科に指定できます。':'を出陣へ戻しました。指揮武将と配置を確認してください。'));};
 if(!deploying&&!unit)return null;
 return h('section',{className:'tenka-tactical-doctrine'+(deploying?' tenka-deployment':''),'aria-label':deploying?'部隊と陣・柵の自由配置':'部隊の陣形と伏兵'},
  deploying&&h(React.Fragment,null,
   h('div',{className:'tenka-deployment-heading'},h('strong',null,'プレイヤーの布陣'),h('small',null,(battle.mode==='field'?'野戦':side==='defender'?'籠城戦':'攻城戦')+' ／ 開戦前に自由配置')),
   (battle.layout?.landscape?.profile?.label||battle.armyDeployment)&&h('p',{className:'tenka-army-deployment'},battle.layout?.landscape?.profile?.label&&h('span',null,'戦場：'+battle.layout.landscape.profile.label),battle.armyDeployment?.[side]&&h('span',null,(turnMode?'自軍の仮配置案：':'自軍の初期陣：')+battle.armyDeployment[side].name),battle.armyDeployment?.[side==='attacker'?'defender':'attacker']&&h('span',null,'敵軍の布陣：'+battle.armyDeployment[side==='attacker'?'defender':'attacker'].name)),
   turnMode&&deploymentStatus&&h('div',{className:'tenka-deployment-commanders','aria-label':'各兵科の指揮武将と配置確認'},
    h('h4',null,'各兵科を指揮する武将を決める'),h('p',null,'出陣元の城にいる配下武将を、各兵科に一人ずつ指定してください。同じ武将で複数の部隊を指揮することはできません。武将が足りない場合は、出陣させない兵科を「予備へ戻す」で控えにしてください。予備兵は城に残り、失われません。'),
    h('div',{className:'tenka-commander-rows'},deploymentRoster.map(entry=>h('div',{className:'tenka-commander-row'+(entry.troops>0?'':' tenka-unit-reserve'),key:entry.id,'data-deployment-unit-id':entry.id},h('div',null,h('strong',null,(unitNames[entry.type]||'部隊')+' '+format(entry.troops)+'人'),h('small',null,entry.troops>0?(entry.deployedConfirmed?'配置確定':'仮配置・未確定'):'予備兵 '+format(availableToRestore(entry))+'人 ／ 戦闘には参加しません')),
     entry.foreignSupport?h('span',{className:'tenka-allied-commander'},(entry.commanderName||'同盟軍の武将')+' ／ 同盟援軍'):h('label',{className:'tenka-field'},h('span',null,'指揮武将'),h('select',{'aria-label':(unitNames[entry.type]||'部隊')+'部隊の指揮武将',value:entry.commanderId||'',onChange:e=>result(tactics.assignCommander(battle,entry.id,e.target.value))},h('option',{value:'',disabled:true},'配下武将を選ぶ'),(deploymentStatus.officers||[]).map(officer=>{const assigned=units.find(other=>other.id!==entry.id&&!other.foreignSupport&&other.commanderId===officer.id);return h('option',{key:officer.id,value:officer.id,disabled:!!assigned},officer.name+' ／ 統'+format(officer.leadership)+' 武'+format(officer.valor)+' 知'+format(officer.intelligence)+(assigned?'（'+(unitNames[assigned.type]||'他部隊')+'を指揮）':''));}))),
     h('button',{type:'button','aria-label':(unitNames[entry.type]||'部隊')+'部隊の現在位置を確定',disabled:!!entry.deployedConfirmed||entry.troops<1,onClick:()=>result(tactics.confirmDeployment(battle,entry.id))},entry.deployedConfirmed?'位置を確定済み':'現在位置で配置を確定'),
     !entry.foreignSupport&&h('button',{type:'button',className:'tenka-reserve-toggle','aria-label':(unitNames[entry.type]||'部隊')+'部隊を'+(entry.troops>0?'予備へ戻す':'出陣へ戻す'),disabled:entry.troops<1&&availableToRestore(entry)<1,onClick:()=>changeReserve(entry)},entry.troops>0?'予備へ戻す':'出陣へ戻す')))),
    h('p',{className:deploymentStatus.ready?'tenka-deployment-ready':'tenka-blocked-reason',role:'status'},deploymentStatus.message),
    deploymentStatus.duplicate?.length>0&&h('p',{className:'tenka-blocked-reason',role:'alert'},'同じ武将が複数の部隊に指定されています。各隊に別の武将を割り当ててください。')),
   h('div',{className:'tenka-placement-tools',role:'group','aria-label':'戦場に配置するもの'},[['unit','部隊'],['camp','本陣'],['palisade','木柵']].map(([id,name])=>h('button',{type:'button',key:id,'aria-pressed':tool===id,onClick:()=>selectTool(id)},name))),
   h('p',{className:'tenka-placement-help'},tool==='unit'?'① 部隊を選ぶ → ② 地形を見て地面をクリック／ドラッグ、または座標を入力 → ③ 陣形と陣・柵を整える。':selected?'選択した'+(selected.kind==='camp'?'本陣':'木柵')+'を地面のクリック／タップで移設。向き・座標も変更できます。':'戦場の地面をクリック／タップして'+(tool==='camp'?'本陣':'木柵')+'を設置。既設の陣・柵は選択して移設・撤去できます。'),
   h('div',{className:'tenka-placement-budget','aria-label':'設営できる数'},budget&&h('span',null,'本陣 '+budget.camp.used+' / '+budget.camp.limit+'　木柵 '+budget.palisade.used+' / '+budget.palisade.limit),h('small',null,'配置範囲　東西 '+Math.ceil(zone.xMin)+'～'+Math.floor(zone.xMax)+' ／ 南北 '+Math.ceil(zone.zMin)+'～'+Math.floor(zone.zMax))),
   tool==='unit'&&h('div',{className:'tenka-player-deployment'},
    h('div',{className:'tenka-deployment-progress'},h('strong',null,'配置確認 '+checkedCount+' / '+units.length+' 部隊'),h('small',null,checkedCount===units.length&&units.length>0?'全隊の位置を確認しました。陣形と本陣・木柵を整えたら戦闘開始へ。':checkedCount>0?(turnMode?'未確認の部隊は仮配置です。全隊の位置を自分で決めるまで開戦できません。':'未確認の部隊は初期案の位置にいます。全隊の配置を見渡して開戦してください。'):(turnMode?'現在の配置は初期案です。地面のクリック・座標指定・現在位置の確定で、全隊の布陣を決めてください。':'現在の配置は初期案です。確認していない部隊も、その位置で開戦できます。'))),
    h('label',{className:'tenka-deployment-unit-picker'},h('span',null,'配置する部隊'),h('select',{'aria-label':'配置する部隊',value:unit?.id||'',onChange:e=>selectUnit(e.target.value)},h('option',{value:'',disabled:true},'部隊を選んで布陣を決める'),units.map((entry,index)=>h('option',{key:entry.id,value:entry.id},'第'+(index+1)+'部隊 ／ '+(entry.commanderName||(turnMode?'指揮武将未指定':'組頭'))+' · '+(unitNames[entry.type]||'部隊')+' '+format(entry.troops)+'人 ／ '+(checkedUnits.has(entry.id)?'配置確認済':'仮配置・未確認'))))),
    unit&&h(React.Fragment,null,
     h('form',{className:'tenka-unit-coordinates',onSubmit:deployUnit},h('label',null,'東西 X',h('input',{type:'number',step:'any',min:zone.xMin,max:zone.xMax,'aria-label':'部隊の東西座標',value:unitX,onChange:e=>unitCoordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'any',min:zone.zMin,max:zone.zMax,'aria-label':'部隊の南北座標',value:unitZ,onChange:e=>unitCoordinate('z',e.target.value)})),h('button',{type:'submit'},'この位置へ配置')),
     h('small',{className:'tenka-unit-position'},(checkedUnits.has(unit.id)?'配置確認済':'仮配置・未確認')+' ／ 現在地：'+(nearFeatures.length?nearFeatures.join('・'):'開けた地形')+'　東西 '+Math.round(unit.x*10)/10+'・南北 '+Math.round(unit.z*10)/10))),
   features.length>0&&h('details',{className:'tenka-terrain-guide'},h('summary',null,'戦場の地形と陣取り（'+features.length+'か所）'),h('p',null,'山・谷・川、田畑や町村を目印に、射界・退路・味方との間隔を見ながら配置を決めてください。'),h('ul',null,features.map((feature,index)=>h('li',{key:feature.id||index},h('strong',null,feature.name||terrainNames[feature.type]||'地形'),h('span',null,(terrainNames[feature.type]||'地形')+' ／ 東西 '+Math.round(feature.x)+'・南北 '+Math.round(feature.z)),h('small',null,terrainAdvice[feature.type]||'戦場を見ながら位置を確認'))))),
   tool!=='unit'&&h('div',{className:'tenka-fieldworks-editor'},
    h('p',{className:'tenka-fieldworks-effect'},tactics.fortificationTypes?.[kind]?.description||''),
    h('label',{className:'tenka-fieldworks-picker'},h('span',null,'設営済みの陣・柵'),h('select',{'aria-label':'編集する陣・柵',value:selected?.id||'',onChange:e=>selectWork(e.target.value)},h('option',{value:''},'新しく設置する'),works.map((work,index)=>h('option',{key:work.id,value:work.id},(work.kind==='camp'?'本陣':'木柵')+' '+(index+1)+' ／ 東西 '+work.x+'・南北 '+work.z)))),
    h('form',{className:'tenka-fieldworks-coordinates',onSubmit:place},h('label',null,'東西 X',h('input',{type:'number',step:'any',min:zone.xMin,max:zone.xMax,'aria-label':'陣・柵の東西座標',value:x,onChange:e=>coordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'any',min:zone.zMin,max:zone.zMax,'aria-label':'陣・柵の南北座標',value:z,onChange:e=>coordinate('z',e.target.value)})),h('label',null,'向き',h('select',{'aria-label':'陣・柵の向き',value:rotation,onChange:e=>rotate(e.target.value)},[0,30,45,60,90,120,135,150,180,210,225,240,270,300,315,330].map(angle=>h('option',{key:angle,value:angle},angle+'°')))),h('button',{type:'submit',disabled:!selected&&budget?.[kind]?.remaining===0},selected?'この座標へ移設':'この座標に設置'),selected&&h('button',{type:'button',className:'tenka-remove-work',onClick:remove},'撤去する')),
    h('small',null,'水面・城郭・部隊と重なる場所には設営できません。城壁や城門など既存の城の施設は移設できません。'))),
  unit&&h('div',{className:'tenka-unit-doctrine'},h('strong',null,(unit.commanderName||(turnMode?'指揮武将未指定':'組頭'))+'隊 · '+(unitNames[unit.type]||'部隊')),h('label',null,'陣形 ',h('select',{'aria-label':'部隊の陣形',value:unit.formation||'line',onChange:e=>formation(e.target.value)},[['line','横陣'],['wedge','魚鱗'],['defensive','方円'],['loose','散開']].map(([id,label])=>h('option',{value:id,key:id},label)))),h('button',{type:'button',onClick:ambush,disabled:!deploying},unit.ambush?'伏兵を解除':'伏兵を配置')),
  h(TacticalCommandStatus,{battle,onBattle,selectedUnitId:unit?.id||selectedUnitId}),
  h('small',{className:'tenka-placement-status',role:'status','aria-live':'polite'},message||(deploying?'配置を終えたら「戦闘開始」を押してください。':unit?'森林・丘陵での伏兵は初撃を強化。陣形により移動と攻防が変化します。':'')),
  battle.supply&&h('small',{className:'tenka-supply-note'},'自軍の兵糧：'+format(Math.max(0,battle.supply[side].initial-battle.supply[side].consumed))+' 石 ／ 合戦中の消費 '+format(battle.supply[side].consumed)+' 石'));
}

return {Council,Tactics,Portrait,BattleAftermath,RetainerStations,AidRequests,AidRequestForm,MarriageDiplomacy,DiplomacyManagement,EstateManagement,TacticalCommandStatus};
}
global.TenkaUI={create,era,battleAftermathView};
})(typeof window==='undefined'?globalThis:window);
