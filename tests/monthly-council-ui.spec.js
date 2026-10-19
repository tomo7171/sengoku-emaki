'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime,clone}=require('./helpers/game-runtime.cjs');
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null||typeof node==='boolean'?'':String(node);}
function control(tree,type,label){const result=flatten(tree).find(node=>node.type===type&&(node.props['aria-label']===label||content(node)===label));assert.ok(result,`${type} ${label} exists`);return result;}
function renderer(env,name,props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=typeof initial==='function'?initial():initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=env.context.TenkaUI.create(React)[name];
 props.onState=state=>{props.state=state;};props.onBattle=battle=>{props.battle=battle;};
 return {render(){cursor=0;return Component(props);}};
}
function campaign(env){const state=env.Game.newGame();state.gold=100000;state.food=100000;return state;}
function options(node){return flatten(node).filter(entry=>entry.type==='option'&&entry.props.value);}

test('council identifies monthly castle orders and advances only through the explicit next-month button',()=>{
 const env=runtime(),props={state:campaign(env)},before=clone(props.state);let advances=0;props.onNextSeason=()=>advances++;
 const screen=renderer(env,'Council',props),tree=screen.render();
 assert.match(content(tree),/各城は毎月3回/);assert.match(content(tree),/今月の命令/);assert.match(content(tree),/1560年\s*3月/);
 assert.doesNotMatch(content(tree),/今季|一季|次の季節/);assert.equal(advances,0);assert.deepEqual(clone(props.state),before);
 control(tree,'button','次の月へ →').props.onClick();assert.equal(advances,1);
});

test('castle rosters expose every adult retainer grouped by home castle and filter by name without moving anyone',()=>{
 const env=runtime(),props={state:campaign(env)},before=clone(props.state),screen=renderer(env,'RetainerStations',props);let tree=screen.render();
 const roster=env.context.TenkaRetainers.getView(props.state),rows=flatten(tree).filter(n=>n.props['data-officer-id']);
 assert.equal(rows.length,roster.officers.length);assert.ok(control(tree,'select','武将の所属城で絞り込む'));
 assert.ok(flatten(tree).some(n=>n.props['aria-label']==='清洲城の家臣一覧'));assert.ok(flatten(tree).some(n=>n.props['aria-label']==='犬山城の家臣一覧'));
 assert.match(content(tree),/統率 .*武勇 .*知略 .*政治/);
 control(tree,'select','武将の所属城で絞り込む').props.onChange({target:{value:'inuyama'}});tree=screen.render();
 assert.ok(flatten(tree).filter(n=>n.props['data-officer-id']).every(n=>roster.officers.find(o=>o.id===n.props['data-officer-id']).castleId==='inuyama'));
 control(tree,'select','武将の所属城で絞り込む').props.onChange({target:{value:'all'}});tree=screen.render();
 control(tree,'input','配置する武将を検索').props.onChange({target:{value:'織田信長'}});tree=screen.render();
 assert.deepEqual(flatten(tree).filter(n=>n.props['data-officer-id']).map(n=>n.props['data-officer-id']),['oda_nobunaga']);
 assert.deepEqual(clone(props.state),before,'search, grouping and sorting leave canonical officer locations unchanged');
});

test('unassigned retainers stay discoverable and common destinations also support individual placement',()=>{
 const env=runtime(),props={state:campaign(env)},person=props.state.officers.find(o=>o.id==='maeda_toshiie');person.castleId=null;
 const screen=renderer(env,'RetainerStations',props);let tree=screen.render();
 control(tree,'select','武将の所属城で絞り込む').props.onChange({target:{value:'unassigned'}});tree=screen.render();
 assert.deepEqual(flatten(tree).filter(n=>n.props['data-officer-id']).map(n=>n.props['data-officer-id']),['maeda_toshiie']);
 control(tree,'select','選んだ武将の共通配置先').props.onChange({target:{value:'inuyama'}});tree=screen.render();
 assert.equal(control(tree,'select','前田利家の配置先の城').props.value,'inuyama');assert.equal(control(tree,'button','前田利家を城に配置').props.disabled,false);
 control(tree,'button','前田利家を城に配置').props.onClick();
 assert.equal(props.state.officers.find(o=>o.id==='maeda_toshiie').castleId,'inuyama');assert.equal(env.context.TenkaOrders.remaining(props.state,'kiyosu'),2);
});

test('bulk stationing debits each source command sequentially and preserves failed selections when orders run out',()=>{
 const env=runtime(),props={state:campaign(env)};props.state.tenka.castleOrders.castles.kiyosu.remaining=2;
 const people=env.context.TenkaRetainers.getView(props.state).officers.filter(o=>o.castleId==='kiyosu').slice(0,4),before=clone(props.state);
 const screen=renderer(env,'RetainerStations',props);let tree=screen.render();
 control(tree,'select','選んだ武将の共通配置先').props.onChange({target:{value:'inuyama'}});
 for(const person of people){tree=screen.render();control(tree,'input',person.name+'をまとめ配置に選ぶ').props.onChange({target:{checked:true}});}
 tree=screen.render();assert.match(content(tree),/4 人を選択/);control(tree,'button','選んだ武将をまとめて配置').props.onClick();tree=screen.render();
 assert.equal(env.context.TenkaOrders.remaining(props.state,'kiyosu'),0);assert.equal(env.context.TenkaOrders.remaining(props.state,'inuyama'),3);
 assert.equal(people.filter(person=>props.state.officers.find(o=>o.id===person.id).castleId==='inuyama').length,2);
 assert.match(content(tree),/2 人を配置しました/);assert.match(content(tree),/配置できなかった 2 人は選択を残しています/);
 assert.equal(people.filter(person=>control(tree,'input',person.name+'をまとめ配置に選ぶ').props.checked).length,2);
 assert.equal(flatten(tree).filter(n=>n.type==='li'&&n.props.className==='failure').length,2);
 assert.deepEqual(before.officers.filter(o=>!people.some(p=>p.id===o.id)).map(o=>[o.id,o.castleId]),clone(props.state).officers.filter(o=>!people.some(p=>p.id===o.id)).map(o=>[o.id,o.castleId]));
});

test('estate budget shows harvest loss, monthly military wages, climate risks and actual regional incidents',()=>{
 const env=runtime(),state=campaign(env),estate=state.tenka.estates.kiyosu;
 Object.assign(estate,{waterControl:18,cropDamage:42,famine:30,epidemic:27,unrest:84,uprising:{kind:'peasant',label:'農民一揆',strength:38,startedTurn:state.turn}});
 state.tenka.disasters.unshift({id:'ui-flood',type:'flood',title:'大雨による洪水',text:'堤防が決壊し、田畑が水没しました。',turn:state.turn,year:state.year,month:state.month,season:state.season,kind:'simulation',castleId:'kiyosu'});
 const before=clone(state),tree=renderer(env,'EstateManagement',{state,castleId:'kiyosu',officerId:'oda_nobunaga'}).render(),forecast=env.Systems.getView(state).castles.find(c=>c.id==='kiyosu').economy.forecast;
 for(const label of ['今月の収支','田畑の被害','民心','治水','飢饉 30 / 100','疫病 27 / 100','農民一揆が発生中','兵科ごとの毎月の軍給・兵糧支給','大雨による洪水','堤防が決壊し'])assert.ok(content(tree).includes(label),label);
 assert.match(content(tree),/減収 [\d,]+ 石/);assert.match(content(tree),/％ \/ 月/);assert.match(content(tree),/月額合計：軍給/);
 assert.ok(content(tree).includes(forecast.monthlyWages.toLocaleString('ja-JP')+' 貫'));assert.deepEqual(clone(state),before,'showing risks and events never rolls additional disasters or spends funds');
});

test('grain sale controls protect the same six-month reserve required by the economy engine',()=>{
 const env=runtime(),state=campaign(env),foodUpkeep=env.Systems.getView(state).economy.totals.foodUpkeep;
 state.food=1200+foodUpkeep*4;
 const screen=renderer(env,'EstateManagement',{state,castleId:'kiyosu',officerId:'oda_nobunaga'});let tree=screen.render();
 assert.equal(control(tree,'button','兵糧を売却する').props.disabled,true);assert.match(content(tree),/6か月分の備蓄/);assert.match(content(tree),/兵糧が足りないため売却できません/);
 state.food=1200+foodUpkeep*6;tree=screen.render();assert.equal(control(tree,'button','兵糧を売却する').props.disabled,false);
});

test('waterworks and sanitation buttons perform their real selected-castle orders and respect busy assignments',()=>{
 for(const [type,label,stat] of [['waterworks','堤防と用水路を整備する','waterControl'],['sanitation','衛生と医療を整える','epidemic']]){
  const env=runtime(),props={state:campaign(env),castleId:'kiyosu',officerId:'oda_nobunaga'};props.state.tenka.estates.kiyosu.waterControl=20;props.state.tenka.estates.kiyosu.epidemic=45;
  const before=clone(props.state),screen=renderer(env,'EstateManagement',props),tree=screen.render();assert.equal(control(tree,'button',label).props.disabled,false);
  control(tree,'button',label).props.onClick();assert.equal(env.context.TenkaOrders.remaining(props.state,'kiyosu'),2);assert.equal(env.context.TenkaOrders.remaining(props.state,'inuyama'),3);
  assert.equal(props.state.gold,before.gold-env.Systems.ACTIONS[type].gold);assert.equal(props.state.food,before.food-env.Systems.ACTIONS[type].food);
  assert.ok(type==='waterworks'?props.state.tenka.estates.kiyosu[stat]>before.tenka.estates.kiyosu[stat]:props.state.tenka.estates.kiyosu[stat]<before.tenka.estates.kiyosu[stat]);
  assert.equal(control(screen.render(),'button',label).props.disabled,true,'the same officer cannot take another task in the month');
 }
});

test('turn-controlled field, siege and defense deployment requires real distinct officers and explicit placement for every own unit',()=>{
 for(const mode of ['field','siege','defense']){
  const env=runtime(),state=campaign(env);
  if(mode==='defense')state.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:'saito'};
  const battle=mode==='defense'?env.Tactics.createDefense(state,state.pendingDefense,{controlMode:'turns'}):env.Game.createBattle({state,sourceId:'kiyosu',targetId:'inabayama',mode,controlMode:'turns'}),props={battle},screen=renderer(env,'Tactics',props);
  let tree=screen.render();assert.match(content(tree),/各兵科を指揮する武将/);assert.doesNotMatch(content(tree),/その位置で開戦できます/);assert.equal(env.Tactics.deploymentStatus(battle).ready,false);
  const status=env.Tactics.deploymentStatus(battle),before=clone(battle),unit=status.units.find(u=>!u.foreignSupport),type={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'}[unit.type];
  const picker=control(tree,'select',type+'部隊の指揮武将');assert.equal(picker.props.value,'');
  assert.ok(options(picker).every(option=>status.officers.some(officer=>officer.id===option.props.value)));
  assert.deepEqual(clone(battle),before,'opening the deployment controls cannot choose officers or positions');
  picker.props.onChange({target:{value:status.officers[0].id}});assert.equal(props.battle.units.find(u=>u.id===unit.id).deployedConfirmed,false);
  tree=screen.render();control(tree,'button',type+'部隊の現在位置を確定').props.onClick();assert.equal(props.battle.units.find(u=>u.id===unit.id).deployedConfirmed,true);
  tree=screen.render();assert.match(content(tree),/配置確認 1 \/ /);
  const other=status.units.find(u=>!u.foreignSupport&&u.id!==unit.id);if(other){const otherType={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'}[other.type],otherPicker=control(tree,'select',otherType+'部隊の指揮武将');assert.equal(options(otherPicker).find(option=>option.props.value===status.officers[0].id).props.disabled,true);}
 }
});

test('an attacked castle with one retainer can explicitly reserve surplus troop types and still start defense',()=>{
 const env=runtime(),state=campaign(env);state.pendingDefense={sourceId:'inabayama',targetId:'inuyama',mode:'siege',clan:'saito'};
 const battle=env.Tactics.createDefense(state,state.pendingDefense,{controlMode:'turns'}),props={battle},screen=renderer(env,'Tactics',props),side=battle.playerSide||'defender';
 const initial=env.Tactics.deploymentStatus(battle),before=clone(battle);assert.equal(initial.officers.length,1);assert.ok(initial.units.length>1);
 const fieldNames={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'},retained=initial.units.find(unit=>unit.type==='ashigaru'),reserves=initial.units.filter(unit=>unit.id!==retained.id);
 let tree=screen.render();assert.match(content(tree),/武将が足りない場合/);assert.match(content(tree),/予備兵は城に残り、失われません/);assert.deepEqual(clone(battle),before);
 for(const entry of reserves){tree=screen.render();control(tree,'button',fieldNames[entry.type]+'部隊を予備へ戻す').props.onClick();}
 tree=screen.render();assert.equal(props.battle.units.filter(unit=>unit.side===side&&unit.troops>0).length,1);
 for(const entry of reserves){const actual=props.battle.units.find(unit=>unit.id===entry.id);assert.equal(actual.troops,0);assert.equal(actual.commanderId,null);assert.ok(control(tree,'button',fieldNames[entry.type]+'部隊を出陣へ戻す'));}
 assert.equal(flatten(tree).filter(node=>node.props['data-deployment-unit-id']).length,initial.units.length,'zero-troop types remain in the roster as a restoration entry point');
 const restore=reserves[0];control(tree,'button',fieldNames[restore.type]+'部隊を出陣へ戻す').props.onClick();tree=screen.render();assert.equal(props.battle.units.find(unit=>unit.id===restore.id).troops,restore.troops);
 control(tree,'button',fieldNames[restore.type]+'部隊を予備へ戻す').props.onClick();tree=screen.render();
 control(tree,'select',fieldNames[retained.type]+'部隊の指揮武将').props.onChange({target:{value:initial.officers[0].id}});tree=screen.render();control(tree,'button',fieldNames[retained.type]+'部隊の現在位置を確定').props.onClick();
 assert.equal(env.Tactics.deploymentStatus(props.battle).ready,true);const started=env.Game.startBattle(props.battle);assert.equal(started.phase,'fighting');assert.deepEqual(clone(state.pendingDefense),{sourceId:'inabayama',targetId:'inuyama',mode:'siege',clan:'saito'});
 assert.deepEqual(clone(props.battle.availableUnits),before.availableUnits,'reserving types never destroys or creates the castle’s available soldiers');
});
