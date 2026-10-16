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
   if(!canAssign(type)){report({ok:false,message:'担当できる武将がいません。家臣の登用、または次の季節へ進んで任務の完了をお待ちください。'});return;}
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
 const recruitmentRecord=state.tenka?.dynasty?.recruitment?.[state.playerClan];
 const recruitmentFull=recruitmentRecord?.turn===state.turn&&recruitmentRecord.count>=2;
 const recruitButton=(candidate,compact=false)=>{
   const cost=candidate.cost??(delegates.length?150:0);
   const orderCost=candidate.commandCost??(delegates.length?1:0);
   const full=recruitmentFull&&!candidate.emergency;
   return h('button',{className:compact?'tenka-primary-button':'','aria-label':candidate.name+'を登用',disabled:full||!!state.pendingDefense||castleRemaining<orderCost||(state.gold||0)<cost,onClick:()=>dynastyAct('recruit',{candidateId:candidate.id})},full?'今季の登用は終了':compact?'家臣を登用する':'登用する',compact&&h('small',null,full?'次の季節に新たな人材を探す':'金 '+format(cost)+' 貫'+(orderCost?' ・ 命令1':' ・ 命令不要')));
 };
 return h('div',{className:'tenka-council'},
  h('div',{className:'tenka-council-intro'},h('div',null,h('span',{className:'tenka-kicker'},'TENKA FUBU / 評定'),h('h3',null,'国を富ませ、人を用い、時を読む。'),h('p',null,'各城は一季に3回の命令を出せます。武将の任務は一季に一つ。命令と任務は次の季節に回復します。')),h('div',{className:'tenka-season-control'},h('div',{className:'tenka-orders'},h('strong',null,castleRemaining+' / 3'),h('span',null,(castle?.name||'選択した城')+'の今季の命令')),onNextSeason&&h('button',{className:'tenka-next-season',disabled:!!state.pendingDefense,onClick:nextSeason},'次の季節へ →'),h('small',null,state.pendingDefense?'先に敵襲への対応を決めてください':state.year+'年 '+seasons[state.season]+' ／ 各城ごとに命令を回復'))),
  h('nav',{className:'tenka-tabs','aria-label':'評定の項目'},['政務','外交','調略','家臣','一門・継承','軍学','年代記'].map(name=>h('button',{key:name,'aria-pressed':name===tab,onClick:()=>{setTab(name);setFeedback(null);}},name))),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  !available.length&&['政務','外交','調略','家臣'].includes(tab)&&h('aside',{className:'tenka-availability',role:'status'},h('div',null,h('strong',null,delegates.length?'成人武将は今季の任務に就いています。':'登用や元服で家臣団を整えましょう。'),h('p',null,fallback?'奉行衆が開墾・商業・動員・褒賞・捕虜の解放を代行します。外交・調略・出陣には成人武将が必要です。':'次の季節へ進むと任務が完了します。成人武将がいない場合も、在地の人材を登用して再起できます。')),h('div',{className:'tenka-inline-actions'},recruits[0]&&recruitButton(recruits[0],true),h('button',{onClick:()=>setTab('家臣')},'人材を確認する'))),
  ['政務','外交','調略','家臣'].includes(tab)&&h('div',{className:'tenka-assignment'},
   field('担当武将',selector(chosen?.id||'',setOfficer,[...(!chosen?[{id:'',label:'任務可能な成人武将がいません',disabled:true}]:[]),...delegates.map(o=>({id:o.id,label:o.name+' ／ 政'+o.politics+'・知'+o.intelligence+(o.busy?'・任務中（次季に復帰）':''),disabled:!!o.busy})),...(fallback?[{id:fallback.id,label:'奉行衆 ／ 政務を代行'}]:[])],'評定の担当武将')),
   field('命令を出す城',selector(castle?.id||'',setCastle,owned.map(c=>({id:c.id,label:c.name+' ／ '+(c.province||'自領')+' ／ 命令 '+castleOrders(c)+' / 3'})),'命令を出す城')),
   ['外交','調略'].includes(tab)&&field('相手の勢力・拠点',selector(target?.id||'',setTarget,enemies.map(c=>({id:c.id,label:c.clanName+' ／ '+c.name})),'交渉先の拠点')),
   chosen&&h('div',{className:'tenka-delegate'},chosen.administrative?h('span',{className:'tenka-administration-seal','aria-hidden':true},'奉行'):h(Portrait,{officer:chosen,year:state.year}),h('div',null,h('strong',null,chosen.name),h('small',null,chosen.administrative?'武将が不在の間、領国の政務を代行':'統率 '+chosen.leadership+' ／ 政治 '+chosen.politics+' ／ 知略 '+chosen.intelligence)))),
  tab==='政務'&&castle&&h('section',null,
   h('div',{className:'tenka-section-heading'},h('h4',null,castle.province+'・'+castle.name),h('span',null,'石高と民力が動員・収穫の土台になります')),
   h('div',{className:'tenka-metrics'},metric('石高',format(castle.kokudaka)+' 石','秋の収穫を支える生産力'),metric('動員枠',format(systems.mobilizationLimit(castle))+' 人','現兵力 '+format(castle.troops)+' 人'),metric('商業',format(economy.commerce)+'','季節収入 +'+format(economy.income)+' 貫'),metric('人口',format(castle.population)+' 人','開墾と商いを担う領民'),metric('士気',castle.morale+' / 100','兵糧の不足・敗戦で低下')),
   h('div',{className:'tenka-action-grid'},actions('reclaim','田畑の開墾','新田を開き石高を増加。担当武将の政治力が成果を左右します。'),actions('commercial','商いの振興','街道・城下の商業を育て、季節ごとの銭収入を増やします。'),actions('levy','兵の動員','石高・人口・地形に応じた上限まで徴募。兵には継続して兵糧が必要です。')),
   h('p',{className:'tenka-note'},'戦争は領国の余力で支えます。開墾と商業への投資を先に行い、守備兵と兵糧を残して出陣しましょう。')),
  tab==='外交'&&target&&h('section',null,
   h('div',{className:'tenka-metrics'},metric('交渉先',target.clanName,target.name),metric('外交関係',(state.relations[target.clan]??0)+'',state.alliances.includes(target.clan)?'盟約を締結中':'信頼を重ねて盟約へ'),metric('相手の兵力',format(target.troops)+' 人','消耗した勢力には交渉の余地も生まれます')),
   h('div',{className:'tenka-action-grid'},actions('negotiation','使者と贈答','家臣を使者に送り関係を改善。十分な信頼を得れば期限付きの盟約を結びます。')),
   h('p',{className:'tenka-note'},'同盟国への侵攻はできません。周辺の強国と交渉し、戦線を絞ることも天下への道です。')),
  tab==='調略'&&target&&h('section',null,
   field('内応を誘う武将',selector(opposition.some(o=>o.id===targetOfficerId)?targetOfficerId:opposition[0]?.id||'',setTargetOfficer,opposition.map(o=>({id:o.id,label:o.name+' ／ 忠誠 '+loyalty(o)})),'調略の対象武将')),
   h('div',{className:'tenka-action-grid'},actions('infiltrate','内応の密約','知略に長けた家臣を送り、敵将の忠誠を揺さぶります。疲弊した守備と低い忠誠は離反の機会になります。')),
   h('p',{className:'tenka-note'},'結果は担当武将の知略・対象の忠誠・領国の疲弊に左右されます。戦場で兵を減らすだけでなく、家臣の結束も守りましょう。')),
  tab==='家臣'&&h('section',null,
   h('div',{className:'tenka-section-heading'},h('h4',null,'新たな家臣の登用'),h('span',null,'候補 '+recruits.length+' 人 ／ 今季あと '+Math.max(0,2-(recruitmentRecord?.turn===state.turn?recruitmentRecord.count||0:0))+' 人を登用できます')),
   h('p',{className:'tenka-note'},'各地の在地人材と仕官を求める浪人を登用します。史実の人物は生年に応じて誕生・元服し、この年代記で生まれる子や在地人材は創作の人物として区別します。成人武将が一人もいない場合、最初の登用は金・命令を消費しません。'),
   recruits.length?h('div',{className:'tenka-recruit-list'},h('table',{className:'tenka-recruit-table','aria-label':'登用候補の一覧'},h('caption',null,'在地人材8人と仕官を求める浪人を比較できます。登用済みの候補は一覧から除かれます。'),h('thead',null,h('tr',null,['武将','出自・年齢','統率','武勇','知略','政治','費用','登用'].map(label=>h('th',{key:label,scope:'col'},label)))),h('tbody',null,recruits.map(o=>h('tr',{key:o.id,'data-candidate-id':o.id},h('th',{scope:'row','data-label':'武将'},h('div',{className:'tenka-recruit-person'},h(Portrait,{officer:o,year:state.year,size:48}),h('strong',null,o.name))),h('td',{'data-label':'出自・年齢'},h('span',null,(o.originPlace||'浪人')+' ／ '+ageLabel(o)),h('small',null,originLabel(o))),...['leadership','valor','intelligence','politics'].map((stat,i)=>h('td',{key:stat,'data-label':['統率','武勇','知略','政治'][i],className:'tenka-recruit-stat'},o[stat])),h('td',{'data-label':'費用'},format(o.cost??150)+' 貫',h('small',null,o.commandCost===0?'命令不要':'命令1')),h('td',{'data-label':'登用'},recruitButton(o))))))):h('p',{className:'tenka-note'},'今季の仕官希望者はいません。次の季節に新たな在地人材を探せます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'家臣団'),h('span',null,'武将ごとに異なる創作肖像・能力・忠誠')),
   roster.some(o=>o.status==='active')?h('div',{className:'tenka-officer-grid'},roster.filter(o=>o.status==='active').map(o=>h('article',{className:'tenka-officer',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)+(o.busy?' ／ 今季は任務中':'')),h('small',null,'忠誠 '+loyalty(o)+' ／ 統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),h('button',{disabled:castleRemaining<1||!!state.pendingDefense||!canAssign('reward'),onClick:()=>act('reward',{targetOfficerId:o.id})},'加増・褒賞'))))):h('p',{className:'tenka-note'},'成人の家臣がいません。上の「新たな家臣の登用」から人材を迎えてください。領国の政務は奉行衆が支えます。'),
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
   h('div',{className:'tenka-marriage-controls'},
    field('婚姻する姫',selector(selectedPrincess?.id||'',setPrincess,princesses.filter(marriageable).map(o=>({id:o.id,label:o.name+' ／ '+ageLabel(o)})),'婚姻する姫を選ぶ')),
    field('婚姻相手',selector(selectedMarriage?.id||'',setMarriageClan,marriageClans.map(c=>({id:c.id,label:c.name+' ／ '+c.spouseName})),'婚姻を申し込む家を選ぶ')),
    h('button',{className:'tenka-primary-button',disabled:!selectedPrincess||!selectedMarriage||!!state.pendingDefense,onClick:()=>dynastyAct('marry',{princessId:selectedPrincess.id,targetClan:selectedMarriage.id,spouseId:selectedMarriage.spouseId})},'婚姻を結ぶ')),
   h('div',{className:'tenka-section-heading'},h('h4',null,'次の世代の便り'),h('span',null,'史実の生年と元服年')),
   (dynastyView.upcoming||[]).length?h('div',{className:'tenka-upcoming'},dynastyView.upcoming.map(event=>h('article',{key:event.id},h('strong',null,event.year+'年'),h('div',null,h('span',{className:'tenka-person-tag'},event.origin==='fictional'?'この年代記':event.kind==='birth'?'史実の生年':'元服の予定'),h('h5',null,event.title),h('p',null,event.text))))):h('p',{className:'tenka-note'},'近い将来の誕生・元服の知らせはありません。在地人材の登用は毎季行えます。')),
  tab==='軍学'&&h('section',null,h('div',{className:'tenka-section-heading'},h('h4',null,'兵科・地形・兵站'),h('span',null,'戦略を、戦場の配置につなぐ')),
   h('div',{className:'tenka-table-scroll'},h('table',{className:'tenka-unit-table'},h('thead',null,h('tr',null,['兵科','得意とする働き','不利となる状況'].map(s=>h('th',{key:s},s)))),h('tbody',null,[['足軽','長柄で戦列を支え、城門と曲輪を攻める','弓・鉄砲の射程内で足を止める'],['騎馬','平地で機動・側面攻撃・追撃','森林・斜面・渡河と密集した槍の戦列'],['鉄砲','射程と火力で敵の戦列を崩す','雨天・接近戦・装填中の突撃'],['弓','山林・曲輪からの射撃と継続した援護','至近距離の騎馬や足軽'],['水軍','沿岸の輸送と船上からの射撃','陸上での戦闘には参加できない']].map(row=>h('tr',{key:row[0]},row.map((s,i)=>h(i?'td':'th',{key:i},s))))))),
   h('div',{className:'tenka-action-grid'},h('article',{className:'tenka-lore'},h('h4',null,'野戦と伏兵'),h('p',null,'部隊ごとに陣形を選び、森林・丘陵を使って伏兵を配置。射程、側面、武将の兵科適性が戦果を左右します。')),h('article',{className:'tenka-lore'},h('h4',null,'籠城と地の利'),h('p',null,'敵襲の急報から防御戦を指揮します。堀・城門・曲輪・本丸を利用し、高所の弓・鉄砲で敵の進軍を妨げましょう。')),h('article',{className:'tenka-lore'},h('h4',null,'戦の兵糧'),h('p',null,'兵力に比例して維持・出陣・戦闘の兵糧を消費します。長期戦と大軍は領国の蓄えを圧迫します。')))),
  tab==='年代記'&&h('section',null,h('div',{className:'tenka-section-heading'},h('h4',null,'史実と、あなたの年代記'),h('span',null,era(state.year)+' '+state.year+'年 '+seasons[state.season])),
   h('p',{className:'tenka-note'},'開始年は1560年。鉄砲伝来（1543年）は既往史です。史実の年表と、プレイで起きた合戦・登用の記録を区別して表示します。史実の戦いは当事者や領地が変われば同じ結果にはなりません。'),
   h('div',{className:'tenka-chronicle'},(view.chronicle||state.tenka?.chronicle||[]).map((event,index)=>h('article',{key:event.id||index},h('div',null,h('span',{className:'tenka-event-tag'},event.kind==='past'?'既往史':event.kind==='branch'?'分岐の記録':'史実・年代'),h('strong',null,(event.year||'')+'年 '+(event.season!=null?seasons[event.season]||'':''))),h('h4',null,event.title),h('p',null,event.text||event.description),event.source&&h('a',{href:typeof event.source==='string'?event.source:event.source.url,target:'_blank',rel:'noreferrer'},'参考資料')))),
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
 const blocked=type=>!onState?'この記録からの命令はできません':state.pendingDefense?'先に敵襲への対応を決めてください':state.gameOver&&!postVictory?'この年代記は決着しました':!postVictory&&remaining<1?'この城の今季の命令がありません。別の城を選ぶか次の季節に処遇を決められます':!delegate?'担当できる成人武将がいません':delegate.administrative&&!delegate.allowedActions?.includes(type)?'説得・処断には成人武将が必要です':(state.gold||0)<(systems.ACTIONS[type]?.gold||0)?'金が不足しています':'';
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
 const units=battle.units.filter(u=>u.side===side&&u.troops>0&&!['destroyed','routed'].includes(u.status));
 const unit=units.find(u=>u.id===(selectedUnitId||localUnitId));
 const checkedUnits=new Set((battle.ledger||[]).filter(entry=>entry.kind==='deploy').map(entry=>entry.command?.unitId));
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
 if(!deploying&&!unit)return null;
 return h('section',{className:'tenka-tactical-doctrine'+(deploying?' tenka-deployment':''),'aria-label':deploying?'部隊と陣・柵の自由配置':'部隊の陣形と伏兵'},
  deploying&&h(React.Fragment,null,
   h('div',{className:'tenka-deployment-heading'},h('strong',null,'プレイヤーの布陣'),h('small',null,(side==='defender'?'籠城戦':battle.mode==='siege'?'攻城戦':'野戦')+' ／ 開戦前に自由配置')),
   (battle.layout?.landscape?.profile?.label||battle.armyDeployment)&&h('p',{className:'tenka-army-deployment'},battle.layout?.landscape?.profile?.label&&h('span',null,'戦場：'+battle.layout.landscape.profile.label),battle.armyDeployment?.[side]&&h('span',null,'自軍の初期陣：'+battle.armyDeployment[side].name),battle.armyDeployment?.[side==='attacker'?'defender':'attacker']&&h('span',null,'敵軍の布陣：'+battle.armyDeployment[side==='attacker'?'defender':'attacker'].name)),
   h('div',{className:'tenka-placement-tools',role:'group','aria-label':'戦場に配置するもの'},[['unit','部隊'],['camp','本陣'],['palisade','木柵']].map(([id,name])=>h('button',{type:'button',key:id,'aria-pressed':tool===id,onClick:()=>selectTool(id)},name))),
   h('p',{className:'tenka-placement-help'},tool==='unit'?'① 部隊を選ぶ → ② 地形を見て地面をクリック／ドラッグ、または座標を入力 → ③ 陣形と陣・柵を整える。':selected?'選択した'+(selected.kind==='camp'?'本陣':'木柵')+'を地面のクリック／タップで移設。向き・座標も変更できます。':'戦場の地面をクリック／タップして'+(tool==='camp'?'本陣':'木柵')+'を設置。既設の陣・柵は選択して移設・撤去できます。'),
   h('div',{className:'tenka-placement-budget','aria-label':'設営できる数'},budget&&h('span',null,'本陣 '+budget.camp.used+' / '+budget.camp.limit+'　木柵 '+budget.palisade.used+' / '+budget.palisade.limit),h('small',null,'配置範囲　東西 '+Math.ceil(zone.xMin)+'～'+Math.floor(zone.xMax)+' ／ 南北 '+Math.ceil(zone.zMin)+'～'+Math.floor(zone.zMax))),
   tool==='unit'&&h('div',{className:'tenka-player-deployment'},
    h('div',{className:'tenka-deployment-progress'},h('strong',null,'配置確認 '+checkedCount+' / '+units.length+' 部隊'),h('small',null,checkedCount===units.length&&units.length>0?'全隊の位置を確認しました。陣形と本陣・木柵を整えたら戦闘開始へ。':checkedCount>0?'未確認の部隊は初期案の位置にいます。全隊の配置を見渡して開戦してください。':'現在の配置は初期案です。確認していない部隊も、その位置で開戦できます。')),
    h('label',{className:'tenka-deployment-unit-picker'},h('span',null,'配置する部隊'),h('select',{'aria-label':'配置する部隊',value:unit?.id||'',onChange:e=>selectUnit(e.target.value)},h('option',{value:'',disabled:true},'部隊を選んで布陣を決める'),units.map((entry,index)=>h('option',{key:entry.id,value:entry.id},'第'+(index+1)+'部隊 ／ '+(entry.commanderName||'組頭')+' · '+(unitNames[entry.type]||'部隊')+' '+format(entry.troops)+'人 ／ '+(checkedUnits.has(entry.id)?'配置確認済':'仮配置・未確認'))))),
    unit&&h(React.Fragment,null,
     h('form',{className:'tenka-unit-coordinates',onSubmit:deployUnit},h('label',null,'東西 X',h('input',{type:'number',step:'any',min:zone.xMin,max:zone.xMax,'aria-label':'部隊の東西座標',value:unitX,onChange:e=>unitCoordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'any',min:zone.zMin,max:zone.zMax,'aria-label':'部隊の南北座標',value:unitZ,onChange:e=>unitCoordinate('z',e.target.value)})),h('button',{type:'submit'},'この位置へ配置')),
     h('small',{className:'tenka-unit-position'},(checkedUnits.has(unit.id)?'配置確認済':'仮配置・未確認')+' ／ 現在地：'+(nearFeatures.length?nearFeatures.join('・'):'開けた地形')+'　東西 '+Math.round(unit.x*10)/10+'・南北 '+Math.round(unit.z*10)/10))),
   features.length>0&&h('details',{className:'tenka-terrain-guide'},h('summary',null,'戦場の地形と陣取り（'+features.length+'か所）'),h('p',null,'山・谷・川、田畑や町村を目印に、射界・退路・味方との間隔を見ながら配置を決めてください。'),h('ul',null,features.map((feature,index)=>h('li',{key:feature.id||index},h('strong',null,feature.name||terrainNames[feature.type]||'地形'),h('span',null,(terrainNames[feature.type]||'地形')+' ／ 東西 '+Math.round(feature.x)+'・南北 '+Math.round(feature.z)),h('small',null,terrainAdvice[feature.type]||'戦場を見ながら位置を確認'))))),
   tool!=='unit'&&h('div',{className:'tenka-fieldworks-editor'},
    h('p',{className:'tenka-fieldworks-effect'},tactics.fortificationTypes?.[kind]?.description||''),
    h('label',{className:'tenka-fieldworks-picker'},h('span',null,'設営済みの陣・柵'),h('select',{'aria-label':'編集する陣・柵',value:selected?.id||'',onChange:e=>selectWork(e.target.value)},h('option',{value:''},'新しく設置する'),works.map((work,index)=>h('option',{key:work.id,value:work.id},(work.kind==='camp'?'本陣':'木柵')+' '+(index+1)+' ／ 東西 '+work.x+'・南北 '+work.z)))),
    h('form',{className:'tenka-fieldworks-coordinates',onSubmit:place},h('label',null,'東西 X',h('input',{type:'number',step:'any',min:zone.xMin,max:zone.xMax,'aria-label':'陣・柵の東西座標',value:x,onChange:e=>coordinate('x',e.target.value)})),h('label',null,'南北 Z',h('input',{type:'number',step:'any',min:zone.zMin,max:zone.zMax,'aria-label':'陣・柵の南北座標',value:z,onChange:e=>coordinate('z',e.target.value)})),h('label',null,'向き',h('select',{'aria-label':'陣・柵の向き',value:rotation,onChange:e=>rotate(e.target.value)},[0,30,45,60,90,120,135,150,180,210,225,240,270,300,315,330].map(angle=>h('option',{key:angle,value:angle},angle+'°')))),h('button',{type:'submit',disabled:!selected&&budget?.[kind]?.remaining===0},selected?'この座標へ移設':'この座標に設置'),selected&&h('button',{type:'button',className:'tenka-remove-work',onClick:remove},'撤去する')),
    h('small',null,'水面・城郭・部隊と重なる場所には設営できません。城壁や城門など既存の城の施設は移設できません。'))),
  unit&&h('div',{className:'tenka-unit-doctrine'},h('strong',null,(unit.commanderName||'組頭')+'隊 · '+(unitNames[unit.type]||'部隊')),h('label',null,'陣形 ',h('select',{'aria-label':'部隊の陣形',value:unit.formation||'line',onChange:e=>formation(e.target.value)},[['line','横陣'],['wedge','魚鱗'],['defensive','方円'],['loose','散開']].map(([id,label])=>h('option',{value:id,key:id},label)))),h('button',{type:'button',onClick:ambush,disabled:!deploying},unit.ambush?'伏兵を解除':'伏兵を配置')),
  h('small',{className:'tenka-placement-status',role:'status','aria-live':'polite'},message||(deploying?'配置を終えたら「戦闘開始」を押してください。':unit?'森林・丘陵での伏兵は初撃を強化。陣形により移動と攻防が変化します。':'')),
  battle.supply&&h('small',{className:'tenka-supply-note'},'自軍の兵糧：'+format(Math.max(0,battle.supply[side].initial-battle.supply[side].consumed))+' 石 ／ 合戦中の消費 '+format(battle.supply[side].consumed)+' 石'));
}

return {Council,Tactics,Portrait,BattleAftermath};
}
global.TenkaUI={create,era,battleAftermathView};
})(typeof window==='undefined'?globalThis:window);
