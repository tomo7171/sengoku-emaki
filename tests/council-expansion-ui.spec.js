'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {runtime,clone}=require('./helpers/game-runtime.cjs');
function setup(){
 const env=runtime();
 if(!env.context.TenkaDiplomacy)vm.runInContext(fs.readFileSync(path.join(__dirname,'../tenka-diplomacy.js'),'utf8'),env.context);
 const Diplomacy=env.context.TenkaDiplomacy;
 if(!env.Game.diplomacy)Object.assign(env.Game,Diplomacy.install({...env.Game}),{diplomacy:Diplomacy});
 return {...env,Diplomacy,Orders:env.context.TenkaOrders};
}
function flatten(node){return Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...flatten(node.props?.children||[])]:[];}
function content(node){return Array.isArray(node)?node.map(content).join(''):node&&typeof node==='object'?content(node.props?.children||[]):node==null||typeof node==='boolean'?'':String(node);}
function control(tree,type,label){const node=flatten(tree).find(n=>n.type===type&&(n.props['aria-label']===label||content(n)===label));assert.ok(node,`${type} ${label} exists`);return node;}
function renderer(env,name,props){
 const values=[];let cursor=0;
 const React={Fragment:'fragment',createElement:(type,attributes,...children)=>({type,props:{...attributes,children}}),useState:initial=>{const key=cursor++;if(!(key in values))values[key]=initial;return[values[key],value=>{values[key]=typeof value==='function'?value(values[key]):value;}];}};
 const Component=env.context.TenkaUI.create(React)[name];assert.equal(typeof Component,'function');
 props.onState=state=>{props.state=state;};props.onBattle=battle=>{props.battle=battle;};
 return {render(){cursor=0;return Component(props);}};
}
function campaign(env,year=1560){
 let state=env.Game.newGame();state.year=year;state.month=3;state.turn=(year-1560)*12+1;state.season=0;state.gold=100000;state.food=1000000;state.prestige=90;state=env.Game.migrate(state);
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:state.turn+12};state.relations.matsudaira=85;
 return env.Diplomacy.initialize(state);
}

test('marriage form explains the real coming of age instead of fabricating an adult princess',()=>{
 const env=setup(),props={state:campaign(env),orderCastleId:'inuyama'},before=clone(props.state),screen=renderer(env,'MarriageDiplomacy',props),tree=screen.render();
 assert.equal(control(tree,'button','婚姻を結ぶ').props.disabled,true);
 assert.match(content(tree),/1577年/);assert.match(content(tree),/十八歳|18歳/);
 assert.equal(control(tree,'select','婚姻する相手の武将を選ぶ').props.disabled,true);
 assert.deepEqual(clone(props.state),before,'displaying eligibility does not change births or marriages');
});

test('allied marriage lets the player select an actual spouse and spends the selected castle order',()=>{
 const env=setup(),props={state:campaign(env,1577),orderCastleId:'inuyama',targetClan:'matsudaira'},screen=renderer(env,'MarriageDiplomacy',props),before=clone(props.state);
 let tree=screen.render();const clan=env.Diplomacy.getView(props.state,{princessId:'oda_tokuhime'}).marriageClans.find(c=>c.id==='matsudaira');
 assert.ok(clan.spouses.length>=2);assert.equal(control(tree,'select','婚姻を申し込む家を選ぶ').props.value,'matsudaira');
 const choice=clan.spouses.at(-1);control(tree,'select','婚姻する相手の武将を選ぶ').props.onChange({target:{value:choice.id}});
 tree=screen.render();assert.equal(control(tree,'select','婚姻する相手の武将を選ぶ').props.value,choice.id);assert.equal(control(tree,'button','婚姻を結ぶ').props.disabled,false);
 assert.match(content(tree),/金 300 貫 ／ 犬山城の命令 1/);control(tree,'button','婚姻を結ぶ').props.onClick();
 assert.equal(props.state.officers.find(o=>o.id==='oda_tokuhime').marriedTo,choice.id);assert.equal(props.state.officers.find(o=>o.id===choice.id).marriedTo,'oda_tokuhime');
 assert.equal(props.state.gold,before.gold-300);assert.equal(env.Orders.remaining(props.state,'inuyama'),2);assert.equal(env.Orders.remaining(props.state,'kiyosu'),3);
 assert.equal(control(screen.render(),'button','婚姻を結ぶ').props.disabled,true);
});

test('spouse choices are recalculated for the selected princess and exclude her relatives',()=>{
 const env=setup(),state=campaign(env,1577),options=env.Dynasty.marriageOptions(state,'oda_tokuhime').find(c=>c.id==='matsudaira');
 const related=options.spouses[0].id;state.officers.find(o=>o.id===related).fatherId=state.officers.find(o=>o.id==='oda_tokuhime').fatherId;
 const props={state,orderCastleId:'inuyama',targetClan:'matsudaira'},screen=renderer(env,'MarriageDiplomacy',props),tree=screen.render();
 const choices=flatten(control(tree,'select','婚姻する相手の武将を選ぶ')).filter(n=>n.type==='option').map(n=>n.props.value);
 assert.ok(!choices.includes(related));assert.ok(choices.length>0,'another actual unrelated adult remains available');
});

test('alliance break is a reversible UI review until explicit confirmation applies real penalties',()=>{
 const env=setup(),props={state:campaign(env),orderCastleId:'kiyosu',officerId:'oda_nobunaga',targetClan:'matsudaira'},before=clone(props.state),screen=renderer(env,'DiplomacyManagement',props);
 let tree=screen.render();control(tree,'button','同盟破棄を検討する').props.onClick();tree=screen.render();
 assert.deepEqual(clone(props.state),before);assert.match(content(tree),/友好度40と威信10/);
 control(tree,'button','盟約を維持する').props.onClick();assert.deepEqual(clone(props.state),before);
 tree=screen.render();control(tree,'button','同盟破棄を検討する').props.onClick();tree=screen.render();control(tree,'button','同盟破棄を確定する').props.onClick();
 assert.equal(props.state.alliances.includes('matsudaira'),false);assert.equal(props.state.relations.matsudaira,before.relations.matsudaira-40);assert.equal(props.state.prestige,before.prestige-10);
 assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);assert.equal(env.Diplomacy.isProtectedPair(props.state,'oda','matsudaira'),false);
});

test('submission UI shows preflight reasons for insufficient power and charges an eligible real negotiation',()=>{
 const env=setup(),state=campaign(env),props={state,orderCastleId:'kiyosu',officerId:'oda_nobunaga',targetClan:'saito'},screen=renderer(env,'DiplomacyManagement',props);
 state.prestige=0;let tree=screen.render();assert.equal(control(tree,'button','恭順を求める').props.disabled,true);assert.match(content(tree),/威信/);
 state.prestige=90;for(const castle of state.castles.filter(c=>c.clan==='saito')){castle.troops=300;state.armies[castle.id].units={ashigaru:300,cavalry:0,firearm:0,archer:0,navy:0};}state.relations.saito=100;
 tree=screen.render();assert.equal(control(tree,'button','恭順を求める').props.disabled,false);assert.match(content(tree),/国力比/);assert.match(content(tree),/金 400 貫/);
 const before=clone(state);control(tree,'button','恭順を求める').props.onClick();assert.equal(props.state.gold,before.gold-400);assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);assert.equal(props.state.tenka.assignments.oda_nobunaga.type,'subjugate');
 assert.deepEqual(clone(props.state.castles),before.castles,'submission never secretly annexes or replenishes an estate');
});

test('estate planning shows forecast and real multi-month projects with correct labor and order use',()=>{
 const env=setup(),props={state:campaign(env),castleId:'kiyosu',officerId:'oda_nobunaga'},screen=renderer(env,'EstateManagement',props),before=clone(props.state);
 let tree=screen.render();assert.match(content(tree),/今月の収支/);assert.match(content(tree),/全領国の蓄え/);assert.match(content(tree),/完成まで 9 か月/);assert.match(content(tree),/農作業の効率/);
 assert.equal(control(tree,'button','田畑の開墾に着手').props.disabled,false);control(tree,'button','田畑の開墾に着手').props.onClick();tree=screen.render();
 const project=props.state.tenka.estates.kiyosu.projects.find(p=>p.type==='reclaim');assert.ok(project);assert.equal(project.remaining,9);assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);assert.equal(env.Orders.remaining(props.state,'inuyama'),3);
 assert.equal(props.state.gold,before.gold-300);assert.match(content(tree),/完成まであと 9 \/ 9 か月/);assert.ok(content(tree).includes('工事に従事 '+project.workforce.toLocaleString('ja-JP')+' 人'));
 assert.equal(control(tree,'button','田畑の開墾に着手').props.disabled,true);assert.match(content(tree),/同じ種類の工事が進行中/);
});

test('tax policy is a deliberate selected change with a one-month guard',()=>{
 const env=setup(),props={state:campaign(env),castleId:'kiyosu',officerId:'oda_nobunaga'},screen=renderer(env,'EstateManagement',props);
 let tree=screen.render();assert.equal(control(tree,'button','税の方針を改める').props.disabled,true);
 control(tree,'select','年貢と税の方針').props.onChange({target:{value:'low'}});tree=screen.render();assert.equal(control(tree,'button','税の方針を改める').props.disabled,false);
 control(tree,'button','税の方針を改める').props.onClick();tree=screen.render();assert.equal(props.state.tenka.estates.kiyosu.taxPolicy,'low');assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);
 assert.equal(control(tree,'select','年貢と税の方針').props.disabled,true);assert.match(content(tree),/今月変更済み/);
});

test('grain sale protects the actual two-month reserve and demobilization requires an explicit valid integer',()=>{
 const env=setup(),state=campaign(env),forecast=env.Systems.getView(state).economy;state.food=1200+forecast.totals.foodUpkeep*2-1;
 const props={state,castleId:'kiyosu',officerId:'oda_nobunaga'},screen=renderer(env,'EstateManagement',props);let tree=screen.render();
 assert.equal(control(tree,'button','兵糧を売却する').props.disabled,true);assert.match(content(tree),/兵糧が足りないため売却できません/);
 assert.equal(control(tree,'button','指定人数を解兵する').props.disabled,true);control(tree,'input','解兵する人数').props.onChange({target:{value:'400.5'}});assert.equal(control(screen.render(),'button','指定人数を解兵する').props.disabled,true);
 control(screen.render(),'input','解兵する人数').props.onChange({target:{value:'400'}});tree=screen.render();assert.equal(control(tree,'button','指定人数を解兵する').props.disabled,false);
 const before=state.castles.find(c=>c.id==='kiyosu').troops;control(tree,'button','指定人数を解兵する').props.onClick();assert.equal(props.state.castles.find(c=>c.id==='kiyosu').troops,before-400);assert.equal(env.Orders.remaining(props.state,'kiyosu'),2);
});

test('estate commands disable when the selected castle has no orders or an aid decision blocks progress',()=>{
 const env=setup(),state=campaign(env),props={state,castleId:'kiyosu',officerId:'oda_nobunaga'},screen=renderer(env,'EstateManagement',props);state.tenka.castleOrders.castles.kiyosu.remaining=0;
 let tree=screen.render();assert.equal(control(tree,'button','田畑の開墾に着手').props.disabled,true);assert.match(content(tree),/この城の今月の命令がありません/);
 state.tenka.castleOrders.castles.kiyosu.remaining=3;state.pendingDefense={sourceId:'inabayama',targetId:'kiyosu',mode:'siege'};tree=screen.render();assert.equal(control(tree,'button','兵糧を買い入れる').props.disabled,true);assert.match(content(tree),/先に合戦・援軍への対応/);
});

test('tactical status displays real readiness and issues rest or brace to the selected player unit',()=>{
 const env=setup(),state=campaign(env),battle=env.Game.createBattle({state,sourceId:'kiyosu',targetId:'inabayama',mode:'field'}),unit=battle.units.find(u=>u.side==='attacker');
 const props={battle,selectedUnitId:unit.id},screen=renderer(env,'TacticalCommandStatus',props);let tree=screen.render();assert.match(content(tree),/戦闘態勢/);assert.match(content(tree),/疲労/);assert.match(content(tree),/隊列/);assert.match(content(tree),/制圧/);
 const initial=clone(battle);control(tree,'button','休息').props.onClick();assert.notDeepEqual(clone(props.battle),initial);assert.deepEqual(clone(battle),initial,'the displayed command does not mutate the old frame');
 assert.equal(env.Tactics.tacticalView(props.battle,unit.id).selected.stance,'rest');tree=screen.render();assert.equal(control(tree,'button','休息').props['aria-pressed'],true);
 control(tree,'button','迎撃').props.onClick();assert.equal(env.Tactics.tacticalView(props.battle,unit.id).selected.stance,'brace');
 const enemy=props.battle.units.find(u=>u.side==='defender');props.selectedUnitId=enemy.id;tree=screen.render();assert.equal(control(tree,'button','休息').props.disabled,true,'enemy stance cannot be ordered through the HUD');
});
