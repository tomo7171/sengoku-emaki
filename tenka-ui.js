/* 天下布武 — council and tactical controls. No external runtime dependencies. */
(function(global){
'use strict';
const format=n=>Math.round(n||0).toLocaleString('ja-JP');
const unitNames={ashigaru:'足軽',cavalry:'騎馬',firearm:'鉄砲',archer:'弓',navy:'水軍'};
const seasons=['春','夏','秋','冬'];
const labels={reclaim:'開墾を命じる',commercial:'商業を振興する',levy:'領民を動員する',reward:'家臣を加増する',negotiation:'使者を派遣する',infiltrate:'内応を働きかける',enlist:'召し抱える',release:'解放する',execute:'処断する'};
function era(year){return year>=1615?'元和'+(year-1614)+'年':year>=1596?'慶長'+(year-1595)+'年':year>=1592?'文禄'+(year-1591)+'年':year>=1573?'天正'+(year-1572)+'年':year>=1570?'元亀'+(year-1569)+'年':'永禄'+(year-1557)+'年';}
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
   const result=systems.act(state,{type,castleId:['negotiation','infiltrate'].includes(type)?target?.id:castle?.id,targetCastleId:target?.id,targetClan:target?.clan,officerId:chosen?.id,targetOfficerId:extra.targetOfficerId||targetOfficerId||opposition[0]?.id,...extra});
   report(result);
 };
 const dynastyAct=(type,extra={})=>{if(dynasty)report(dynasty.act(state,{type,...extra}));};
 const field=(title,child)=>h('label',{className:'tenka-field'},h('span',null,title),child);
 const selector=(value,onChange,options,aria)=>h('select',{'aria-label':aria,value,disabled:!options.some(o=>!o.disabled),onChange:e=>onChange(e.target.value)},options.length?options.map(o=>h('option',{key:o.id,value:o.id,disabled:!!o.disabled},o.label)):h('option',{value:''},'選択できる人物がいません'));
 const actions=(type,title,text)=>h('button',{key:type,className:'tenka-action',disabled:state.actionPoints<1||!!state.pendingDefense||!canAssign(type),onClick:()=>act(type)},h('strong',null,title),h('span',null,text),h('small',null,'金 '+format(systems.ACTIONS[type]?.gold)+' 貫 ／ 兵糧 '+format(systems.ACTIONS[type]?.food)+' 石 ・ 命令1 →'));
 const metric=(title,value,note)=>h('div',{className:'tenka-metric',key:title},h('small',null,title),h('strong',null,value),h('span',null,note));
 const economy=(view.castles||[]).find(c=>c.id===castle?.id)||castle;
 const loyalty=officer=>officer.loyalty??state.tenka?.loyalty?.[officer.id]??70;
 const age=officer=>officer.age??(officer.birth==null?null:state.year-officer.birth);
 const ageLabel=officer=>age(officer)==null?'年齢不詳':age(officer)+'歳';
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
   return h('button',{className:compact?'tenka-primary-button':'',disabled:full||!!state.pendingDefense||state.actionPoints<orderCost||(state.gold||0)<cost,onClick:()=>dynastyAct('recruit',{candidateId:candidate.id})},full?'今季の登用は終了':compact?'家臣を登用する':'登用する',h('small',null,full?'次の季節に新たな人材を探す':'金 '+format(cost)+' 貫'+(orderCost?' ・ 命令1':' ・ 命令不要')));
 };
 return h('div',{className:'tenka-council'},
  h('div',{className:'tenka-council-intro'},h('div',null,h('span',{className:'tenka-kicker'},'TENKA FUBU / 評定'),h('h3',null,'国を富ませ、人を用い、時を読む。'),h('p',null,'武将に役目を与え、領国の力を天下へつなぐ。担当武将は一季に一つの任務を務め、次の季節に再び働けます。')),h('div',{className:'tenka-season-control'},h('div',{className:'tenka-orders'},h('strong',null,state.actionPoints),h('span',null,'今季の命令')),onNextSeason&&h('button',{className:'tenka-next-season',disabled:!!state.pendingDefense,onClick:nextSeason},'次の季節へ →'),h('small',null,state.pendingDefense?'先に敵襲への対応を決めてください':state.year+'年 '+seasons[state.season]+' ／ 任務・命令を回復'))),
  h('nav',{className:'tenka-tabs','aria-label':'評定の項目'},['政務','外交','調略','家臣','一門・継承','軍学','年代記'].map(name=>h('button',{key:name,'aria-pressed':name===tab,onClick:()=>{setTab(name);setFeedback(null);}},name))),
  feedback&&h('p',{className:'tenka-feedback '+(feedback.ok?'success':'failure'),role:'status'},feedback.text),
  !available.length&&['政務','外交','調略','家臣'].includes(tab)&&h('aside',{className:'tenka-availability',role:'status'},h('div',null,h('strong',null,delegates.length?'成人武将は今季の任務に就いています。':'登用や元服で家臣団を整えましょう。'),h('p',null,fallback?'奉行衆が開墾・商業・動員・褒賞・捕虜の解放を代行します。外交・調略・出陣には成人武将が必要です。':'次の季節へ進むと任務が完了します。成人武将がいない場合も、在地の人材を登用して再起できます。')),h('div',{className:'tenka-inline-actions'},recruits[0]&&recruitButton(recruits[0],true),h('button',{onClick:()=>setTab('家臣')},'人材を確認する'))),
  ['政務','外交','調略','家臣'].includes(tab)&&h('div',{className:'tenka-assignment'},
   field('担当武将',selector(chosen?.id||'',setOfficer,[...(!chosen?[{id:'',label:'任務可能な成人武将がいません',disabled:true}]:[]),...delegates.map(o=>({id:o.id,label:o.name+' ／ 政'+o.politics+'・知'+o.intelligence+(o.busy?'・任務中（次季に復帰）':''),disabled:!!o.busy})),...(fallback?[{id:fallback.id,label:'奉行衆 ／ 政務を代行'}]:[])],'評定の担当武将')),
   tab==='政務'&&field('領地',selector(castle?.id||'',setCastle,owned.map(c=>({id:c.id,label:c.name+' ／ '+c.province})),'政務を行う領地')),
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
   h('div',{className:'tenka-section-heading'},h('h4',null,'新たな家臣の登用'),h('span',null,'担当武将がいなくても登用できます')),
   h('p',{className:'tenka-note'},'各地の在地人材と仕官を求める浪人を登用します。史実の人物は生年に応じて誕生・元服し、この年代記で生まれる子や在地人材は創作の人物として区別します。成人武将が一人もいない場合、最初の登用は金・命令を消費しません。'),
   recruits.length?h('div',{className:'tenka-officer-grid'},recruits.map(o=>h('article',{className:'tenka-officer tenka-recruit',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)),h('small',null,'統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),o.description&&h('small',null,o.description),recruitButton(o))))):h('p',{className:'tenka-note'},'今季の仕官希望者はいません。次の季節に新たな在地人材を探せます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'家臣団'),h('span',null,'武将ごとに異なる創作肖像・能力・忠誠')),
   roster.some(o=>o.status==='active')?h('div',{className:'tenka-officer-grid'},roster.filter(o=>o.status==='active').map(o=>h('article',{className:'tenka-officer',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('span',{className:'tenka-person-tag'},originLabel(o)+' ／ '+ageLabel(o)+(o.busy?' ／ 今季は任務中':'')),h('small',null,'忠誠 '+loyalty(o)+' ／ 統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),h('button',{disabled:state.actionPoints<1||!!state.pendingDefense||!canAssign('reward'),onClick:()=>act('reward',{targetOfficerId:o.id})},'加増・褒賞'))))):h('p',{className:'tenka-note'},'成人の家臣がいません。上の「新たな家臣の登用」から人材を迎えてください。領国の政務は奉行衆が支えます。'),
   h('div',{className:'tenka-section-heading'},h('h4',null,'捕らえた武将'),h('span',null,prisoners.length+' 人')),
   prisoners.length?h('div',{className:'tenka-officer-grid'},prisoners.map(o=>h('article',{className:'tenka-officer prisoner',key:o.id},h(Portrait,{officer:o,year:state.year,size:70}),h('div',null,h('strong',null,o.name),h('small',null,'統'+o.leadership+' 武'+o.valor+' 知'+o.intelligence+' 政'+o.politics),h('div',{className:'tenka-prisoner-actions'},['enlist','release','execute'].map(type=>h('button',{key:type,disabled:state.actionPoints<1||!!state.pendingDefense||!canAssign(type),onClick:()=>act(type,{targetOfficerId:o.id})},labels[type]))))))):h('p',{className:'tenka-note'},'捕虜はいません。落城・敗走時には武将の捕縛、討ち死に、逃亡が発生します。'),
   h('p',{className:'tenka-note'},'史実に登場する人物を収録しています。合戦後の生死・離反・登用は、この年代記での分岐です。')),
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
function Tactics({battle,onBattle,selectedUnitId}){
 const side=battle.playerSide||'attacker';const unit=battle.units.find(u=>u.id===selectedUnitId&&u.side===side);
 const [message,setMessage]=React.useState('');
 if(!unit)return null;
 const formation=(key)=>{const result=global.TenkaTactics.formation(battle,unit.id,key);if(result?.ok===false)setMessage(result.message);else{onBattle(result.battle||result);setMessage('陣形を変更しました。');}};
 const ambush=()=>{const result=global.TenkaTactics.ambush(battle,unit.id);if(result?.ok===false)setMessage(result.message);else{onBattle(result.battle||result);setMessage(result.message||'伏兵を配置しました。');}};
 return h('div',{className:'tenka-tactical-doctrine'},h('span',null,battle.playerSide==='defender'?'籠城軍の配置':'陣形と伏兵'),h('label',null,'陣形 ',h('select',{'aria-label':'部隊の陣形',value:unit.formation||'line',onChange:e=>formation(e.target.value)},[['line','横陣'],['wedge','魚鱗'],['defensive','方円'],['loose','散開']].map(([id,label])=>h('option',{value:id,key:id},label)))),h('button',{onClick:ambush,disabled:battle.phase!=='deployment'},unit.ambush?'伏兵を解除':'伏兵を配置'),h('small',{role:'status'},message||'森林・丘陵での伏兵は初撃を強化。陣形により移動と攻防が変化します。'),battle.supply&&h('small',null,'自軍の兵糧：'+format(Math.max(0,battle.supply[side].initial-battle.supply[side].consumed))+' 石 ／ 合戦中の消費 '+format(battle.supply[side].consumed)+' 石'));
}
return {Council,Tactics,Portrait};
}
global.TenkaUI={create,era};
})(typeof window==='undefined'?globalThis:window);
