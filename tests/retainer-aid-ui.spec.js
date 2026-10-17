'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {runtime,clone}=require('./helpers/game-runtime.cjs');
function setup(){
 const env=runtime();
 for(const [name,key] of [['tenka-retainers.js','TenkaRetainers'],['tenka-allies.js','TenkaAllies']])if(!env.context[key])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),env.context);
 return {...env,Retainers:env.context.TenkaRetainers,Allies:env.context.TenkaAllies,Orders:env.context.TenkaOrders};
}
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null||typeof node==='boolean'?'':String(node);}
function control(tree,type,label){const found=flatten(tree).find(n=>n.type===type&&(n.props['aria-label']===label||content(n)===label));assert.ok(found,`${type} ${label} exists`);return found;}
function renderer(env,name,props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=env.context.TenkaUI.create(React)[name];assert.equal(typeof Component,'function');
 props.onState=state=>{props.state=state;};
 return {render(){cursor=0;return Component(props);}};
}
function incoming(env,side='attacker'){
 let state=env.Allies.initialize(env.Game.newGame());state.gold=100000;state.food=100000;
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:state.turn+4};state.relations.matsudaira=60;
 // This synthetic war starts after the Matsudaira–Imagawa pact has ended.
 // Preserve every unrelated NPC pact and the production queue's diplomacy guard.
 state.npcPacts=state.npcPacts.filter(pair=>!(pair.includes('matsudaira')&&pair.includes('imagawa')));
 assert.equal(env.Allies.queueWar(state,side==='attacker'?'okazaki':'sunpu',side==='attacker'?'sunpu':'okazaki','siege'),true);
 // The integration adapter normally runs the real campaign battle. Here a
 // deterministic result lets the UI test verify the module's own debits and
 // returned survivors without replaying a second combat simulation.
 env.Allies.configure({resolveWar:(next,request,support)=>({ok:true,state:next,battle:{id:'ui-allied-war',won:true},supportLosses:support?Object.fromEntries(Object.entries(support.units).map(([key,count])=>[key,Math.min(count,key==='ashigaru'?40:0)])):undefined})});
 return state;
}

test('castle stationing lists adult own retainers and moves only the explicitly selected officer',()=>{
 const env=setup(),props={state:env.Game.newGame()},screen=renderer(env,'RetainerStations',props),before=clone(props.state);
 let tree=screen.render();const rows=flatten(tree).filter(n=>n.props['data-officer-id']);
 assert.equal(rows.length,env.Retainers.getView(props.state).officers.length);
 assert.ok(rows.every(row=>props.state.officers.find(o=>o.id===row.props['data-officer-id']).clan===props.state.playerClan));
 assert.ok(!rows.some(row=>['oda_nobutada','oda_tokuhime'].includes(row.props['data-officer-id'])));
 assert.deepEqual(clone(props.state),before,'opening the list never redistributes the roster');
 assert.equal(control(tree,'button','織田信長を城に配置').props.disabled,true);
 const picker=control(tree,'select','織田信長の配置先の城');
 assert.deepEqual(flatten(picker).filter(n=>n.type==='option'&&n.props.value).map(n=>n.props.value).sort(),Array.from(props.state.castles.filter(c=>c.clan===props.state.playerClan),c=>c.id).sort());
 picker.props.onChange({target:{value:'inuyama'}});tree=screen.render();
 assert.equal(control(tree,'button','織田信長を城に配置').props.disabled,false);
 control(tree,'button','織田信長を城に配置').props.onClick();tree=screen.render();
 assert.equal(props.state.officers.find(o=>o.id==='oda_nobunaga').castleId,'inuyama');
 assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);assert.equal(env.Orders.remaining(props.state,'inuyama'),3);
 assert.equal(props.state.armies.inuyama.commanderId,before.armies.inuyama.commanderId);
 assert.match(content(tree),/織田信長を清洲城から犬山城へ配属/);
 assert.equal(control(tree,'select','織田信長の配置先の城').props.value,'');
});

test('busy and exhausted officers remain visible with a reason and cannot be stationed',()=>{
 const env=setup();let state=env.Game.newGame();state.tenka.assignments.oda_nobunaga={turn:state.turn,type:'commercial'};
 state=env.Orders.sync(state,'kiyosu');state.tenka.castleOrders.castles.kiyosu.remaining=0;
 const props={state},screen=renderer(env,'RetainerStations',props),tree=screen.render();
 assert.equal(control(tree,'select','織田信長の配置先の城').props.disabled,true);
 assert.equal(control(tree,'button','織田信長を城に配置').props.disabled,true);
 assert.match(content(tree),/今季の任務中/);assert.match(content(tree),/今季の行動力は残り0／3/);
 const before=clone(props.state);
 control(tree,'button','織田信長を城に配置').props.onClick();
 assert.deepEqual(clone(props.state),before);assert.match(content(screen.render()),/今季の任務中/);
});

test('an incoming allied offensive requires the player to choose the source and an integer count before sending',()=>{
 const env=setup(),props={state:incoming(env)},screen=renderer(env,'AidRequests',props),before=clone(props.state);
 let tree=screen.render();assert.match(content(tree),/同盟国の攻勢/);assert.match(content(tree),/岡崎城 → 駿府館/);assert.match(content(tree),/敵：今川家/);
 assert.equal(control(tree,'select','松平家への援軍の出兵元').props.value,'');
 assert.equal(control(tree,'input','松平家への援軍の人数').props.value,'');
 assert.equal(control(tree,'button','援軍を送る').props.disabled,true);assert.deepEqual(clone(props.state),before);
 control(tree,'select','松平家への援軍の出兵元').props.onChange({target:{value:'kiyosu'}});
 tree=screen.render();control(tree,'input','松平家への援軍の人数').props.onChange({target:{value:'600.5'}});
 assert.equal(control(screen.render(),'button','援軍を送る').props.disabled,true);
 control(screen.render(),'input','松平家への援軍の人数').props.onChange({target:{value:'600'}});
 tree=screen.render();assert.equal(control(tree,'button','援軍を送る').props.disabled,false);
 assert.match(content(tree),/兵糧 744 石 ／ 金 120 貫 ／ 清洲城の命令 1/);assert.match(content(tree),/派兵後の守備兵 2,600 人/);
 control(tree,'button','援軍を送る').props.onClick();tree=screen.render();
 assert.equal(props.state.tenka.allies.pending.length,0);assert.equal(props.state.tenka.allies.reports[0].troops,600);
 assert.equal(props.state.castles.find(c=>c.id==='kiyosu').troops,before.castles.find(c=>c.id==='kiyosu').troops-40);
 assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);assert.equal(props.state.food,before.food-744);assert.equal(props.state.relations.matsudaira,65);
 assert.match(content(tree),/派遣 600 人 ／ 損失 40 人 ／ 帰還 560 人/);
});

test('an allied defensive request can be refused without choosing troops and records the friendship penalty',()=>{
 const env=setup(),props={state:incoming(env,'defender')},screen=renderer(env,'AidRequests',props),before=clone(props.state);
 let tree=screen.render();assert.match(content(tree),/同盟国の防衛/);assert.match(content(tree),/駿府館 → 岡崎城/);assert.match(content(tree),/友好度 −15/);
 assert.equal(control(tree,'button','援軍を断る').props.disabled,undefined);control(tree,'button','援軍を断る').props.onClick();tree=screen.render();
 assert.equal(props.state.relations.matsudaira,45);assert.equal(props.state.tenka.allies.pending.length,0);
 assert.deepEqual(clone(props.state.armies),before.armies);assert.equal(props.state.food,before.food);assert.equal(env.Orders.remaining(props.state,'kiyosu'),3);
 assert.match(content(tree),/援軍の回答・戦果の記録（1件）/);assert.match(content(tree),/友好度 -15/);
});

test('insufficient resources explain blocked sending without disabling an explicit refusal',()=>{
 const env=setup(),props={state:incoming(env)},screen=renderer(env,'AidRequests',props);props.state.food=0;
 let tree=screen.render();control(tree,'select','松平家への援軍の出兵元').props.onChange({target:{value:'kiyosu'}});
 tree=screen.render();control(tree,'input','松平家への援軍の人数').props.onChange({target:{value:'700'}});
 tree=screen.render();assert.equal(control(tree,'button','援軍を送る').props.disabled,true);assert.match(content(tree),/金120貫・兵糧768石が必要/);
 assert.equal(control(tree,'button','援軍を断る').props.disabled,undefined);
 const before=clone(props.state);control(tree,'button','援軍を送る').props.onClick();assert.deepEqual(clone(props.state),before);assert.match(content(screen.render()),/派兵には/);
});

test('the player requests an exact allied contingent for either offensive mode or an actual defensive battle',()=>{
 for(const kind of ['field','siege','defense']){
  const env=setup();let state=env.Allies.initialize(env.Game.newGame());
  state.alliances=['matsudaira'];state.allianceExpires={matsudaira:state.turn+4};state.relations.matsudaira=60;
  if(kind==='defense')state.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege',clan:'saito'};
  const war=kind==='defense'?{...state.pendingDefense,defending:true}:{sourceId:'kiyosu',targetId:'inabayama',mode:kind,defending:false};
  const props={state,war},screen=renderer(env,'AidRequestForm',props),before=clone(state);
  let tree=screen.render();assert.match(content(tree),kind==='defense'?/自家の防衛/:/自家の攻勢/);
  assert.equal(control(tree,'select','援軍を頼む同盟国の城').props.value,'');
  assert.equal(control(tree,'input','同盟国に要請する援軍の人数').props.value,'');
  assert.equal(control(tree,'button','この人数で援軍を要請する').props.disabled,true);
  control(tree,'select','援軍を頼む同盟国の城').props.onChange({target:{value:'okazaki'}});
  tree=screen.render();control(tree,'input','同盟国に要請する援軍の人数').props.onChange({target:{value:'600'}});
  tree=screen.render();assert.equal(control(tree,'button','この人数で援軍を要請する').props.disabled,false);
  assert.match(content(tree),new RegExp('同盟国側の負担：兵糧 '+(kind==='field'?672:744)+' 石 ／ 金 120 貫'));
  assert.deepEqual(clone(props.state),before,'selecting a source and number only previews the order');
  control(tree,'button','この人数で援軍を要請する').props.onClick();tree=screen.render();
  assert.equal(props.state.tenka.allies.committed.length,1);assert.equal(props.state.tenka.allies.committed[0].troops,600);
  assert.equal(props.state.castles.find(c=>c.id==='okazaki').troops,before.castles.find(c=>c.id==='okazaki').troops-600);
  assert.equal(props.state.food,before.food);assert.equal(props.state.gold,before.gold);assert.equal(env.Orders.remaining(props.state,'kiyosu'),3);
  assert.match(content(tree),/参戦予定の同盟軍/);assert.match(content(tree),/松平家 ／ 岡崎城 600 人/);
  const paidFood=props.state.castles.find(c=>c.id==='okazaki').food;
  control(tree,'button','岡崎城の援軍要請を取り消す').props.onClick();
  assert.equal(props.state.tenka.allies.committed.length,0);assert.equal(props.state.castles.find(c=>c.id==='okazaki').troops,before.castles.find(c=>c.id==='okazaki').troops);
  assert.equal(props.state.castles.find(c=>c.id==='okazaki').food,paidFood,'cancelling returns troops while retaining already paid campaign food');
 }
});

test('diplomacy lets the player select a real war and always exposes cancellation of an existing request',()=>{
 const env=setup();let state=env.Allies.initialize(env.Game.newGame());
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:state.turn+4};state.relations.matsudaira=60;
 const props={state},screen=renderer(env,'AidRequestForm',props);let tree=screen.render();
 assert.equal(control(tree,'select','援軍を要請する戦場').props.value,'');
 assert.equal(flatten(tree).some(n=>n.props['aria-label']==='援軍を頼む同盟国の城'),false);
 control(tree,'select','援軍を要請する戦場').props.onChange({target:{value:'kiyosu:inabayama:siege:attack'}});
 tree=screen.render();control(tree,'select','援軍を頼む同盟国の城').props.onChange({target:{value:'okazaki'}});
 tree=screen.render();control(tree,'input','同盟国に要請する援軍の人数').props.onChange({target:{value:'500'}});
 control(screen.render(),'button','この人数で援軍を要請する').props.onClick();
 const reopened=renderer(env,'AidRequestForm',props);tree=reopened.render();
 assert.equal(control(tree,'select','援軍を要請する戦場').props.value,'');
 assert.match(content(tree),/戦場：稲葉山城 ／ 自家の攻勢/);
 assert.ok(control(tree,'button','岡崎城の援軍要請を取り消す'),'a fresh diplomacy visit can cancel without rediscovering the reserved context');
});

test('history distinguishes allied soldiers received from troops sent and shows their losses and return',()=>{
 const env=setup(),props={state:incoming(env)};
 props.state.tenka.allies.reports.push({id:'received-report',requestId:'support-report',allyName:'松平家',decision:'received',turn:props.state.turn,troops:500,casualties:100,survivors:400,relationChange:0,date:'1560年 春',message:'岡崎城からの同盟援軍が帰還しました。'});
 const tree=renderer(env,'AidRequests',props).render();
 assert.match(content(tree),/1560年 春 ／ 松平家/);assert.match(content(tree),/同盟援軍 500 人 ／ 損失 100 人 ／ 帰還 400 人/);
});
