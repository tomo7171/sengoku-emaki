'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Allies = require('../tenka-allies.js');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const UNITS = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const units = (ashigaru, extra = {}) => ({ ashigaru, archer: 0, cavalry: 0, firearm: 0, navy: 0, ...extra });
const total = value => UNITS.reduce((sum, key) => sum + value[key], 0);
function fixture(side = 'attacker') {
 const state = { version: 2, year: 1560, season: 0, turn: 1, aiRound: 2, playerClan: 'player',
  selectedCastleId: 'home', actionPoints: 3, gold: 10000, food: 30000, relations: { ally: 80, enemy: -50 },
  alliances: ['ally'], allianceExpires: { ally: 5 }, logs: [], nextLogId: 1,
  castles: [
   { id: 'home', name: '自領城', clan: 'player', clanName: '自家', troops: 4000, coastal: false, gold: 1000, food: 30000, morale: 80, neighbors: ['allyHome'] },
   { id: 'allyHome', name: '同盟城', clan: 'ally', clanName: '同盟家', troops: 4000, coastal: false, gold: 1000, food: 30000, morale: 80, neighbors: ['home','enemyHome'] },
   { id: 'enemyHome', name: '敵城', clan: 'enemy', clanName: '敵家', troops: 3000, coastal: false, gold: 1000, food: 30000, morale: 80, neighbors: ['allyHome'] }
  ], officers: [{ id: 'leader', name: '指揮官', clan: 'player', castleId: 'home', status: 'active', birth: 1530 }],
  armies: { home: { commanderId: 'leader', units: units(2000, { archer: 1000, cavalry: 1000 }) },
   allyHome: { commanderId: null, units: units(3000, { archer: 1000 }) }, enemyHome: { commanderId: null, units: units(3000) } },
  aiBattles: [], gameOver: false };
 if (side === 'defender') { state.castles[2].neighbors.push('home'); state.castles[0].neighbors.push('enemyHome'); }
 return Allies.initialize(state);
}
function queue(state, side = 'attacker') {
 assert.equal(Allies.queueWar(state, side === 'attacker' ? 'allyHome' : 'enemyHome', side === 'attacker' ? 'enemyHome' : 'allyHome', 'siege'), true);
 return Allies.getView(state).requests[0];
}
function fakeResolve(state, request, support) {
 const losses = support ? Object.fromEntries(UNITS.map(key => [key, Math.floor(support.units[key] * .2)])) : units(0);
 const battle = { id: `native-${request.id}`, sourceId: request.sourceId, targetId: request.targetId, mode: request.mode,
  won: true, supportLosses: losses, attackerClan: request.sourceClan, defenderClan: request.targetClan };
 state.aiBattles.push(battle); return { ok: true, state, battle, supportLosses: losses };
}
Allies.configure({ resolveWar: fakeResolve });

test('allied attacks and defenses queue a unique persistent decision; neither ally nor player auto-dispatches', () => {
 for (const side of ['attacker', 'defender']) {
  const state = fixture(), initial = clone(state), request = queue(state, side);
  assert.equal(request.side, side); assert.equal(Allies.validate(state), true);
  assert.deepEqual(state.armies, initial.armies); assert.equal(state.food, initial.food);
  assert.equal(Allies.queueWar(state, request.sourceId, request.targetId), false);
  assert.equal(Allies.hasPendingRequests(Allies.initialize(JSON.parse(JSON.stringify(state)))), true);
  const hooks = Allies.install({ season: value => ({ state: { ...value, turn: value.turn + 1 } }), action: value => ({ ok: true, state: value }) });
  assert.equal(hooks.season(state).ok, false); assert.equal(hooks.action(state).ok, false);
 }
 const both = fixture(); both.alliances.push('enemy'); both.allianceExpires.enemy = 5;
 assert.equal(Allies.queueWar(both, 'allyHome','enemyHome'), false);
 const expired = fixture(); expired.allianceExpires.ally = expired.turn;
 assert.equal(Allies.queueWar(expired,'allyHome','enemyHome'), false);
});

test('decline changes friendship once and resolves the actual pending war without spending troops or commands', () => {
 const state = fixture(), request = queue(state), before = clone(state);
 const result = Allies.act(state, { type: 'decline', requestId: request.id });
 assert.equal(result.ok, true); assert.equal(result.state.relations.ally, 65);
 assert.equal(result.state.actionPoints, before.actionPoints); assert.equal(result.state.food,before.food);
 assert.deepEqual(result.state.armies, before.armies); assert.equal(result.state.aiBattles.length, 1);
 assert.equal(Allies.hasPendingRequests(result.state), false);
 assert.equal(Allies.act(result.state,{type:'decline',requestId:request.id}).ok,false);
 assert.deepEqual(state, before, 'all decisions are immutable');
});

test('explicit player aid removes and returns exact composition, preserves garrison, and accounts casualties/resources once', () => {
 const state = fixture(), request = queue(state), before = clone(state), action = { type: 'send', requestId: request.id, sourceId: 'home', troops: 1200 };
 const preview = Allies.preview(state,action); assert.equal(preview.ok,true);
 const result = Allies.act(state,action); assert.equal(result.ok,true,result.message);
 assert.equal(result.report.casualties,240); assert.equal(result.report.survivors,960);
 assert.equal(result.state.castles[0].troops,4000-240);
 assert.deepEqual(result.state.armies.home.units, units(1880,{archer:940,cavalry:940}));
 assert.equal(result.state.food,before.food-preview.foodCost); assert.equal(result.state.gold,before.gold-120);
 assert.equal(result.state.actionPoints,2); assert.equal(result.state.relations.ally,85);
 assert.equal(Allies.act(result.state,action).ok,false); assert.deepEqual(state,before);
});

test('bad counts, hostile sources, blocked routes, no commands or insufficient stores fail without consuming anything', () => {
 const original = fixture(), request = queue(original);
 for (const change of [
  {troops:0},{troops:-1},{troops:1.5},{troops:NaN},{troops:Infinity},{troops:4001},{troops:'1000'},
  {sourceId:'enemyHome'},{sourceId:'missing'}
 ]) {
  const state = clone(original), before = clone(state);
  const result = Allies.act(state,{type:'send',requestId:request.id,sourceId:'home',troops:1000,...change});
  assert.equal(result.ok,false); assert.deepEqual(state,before); assert.equal(result.state,state);
 }
 for (const modify of [s=>s.castles[0].neighbors=[],s=>s.actionPoints=0,s=>s.food=0,s=>s.gold=0]) {
  const state=clone(original);modify(state);const before=clone(state);
  assert.equal(Allies.act(state,{type:'send',requestId:request.id,sourceId:'home',troops:1000}).ok,false);assert.deepEqual(state,before);
 }
});

test('failed battle adapter and invalid losses roll back the entire contingent, supplies and decision', () => {
 const state=fixture(),request=queue(state),before=clone(state),action={type:'send',requestId:request.id,sourceId:'home',troops:1000};
 for(const resolveWar of [()=>({ok:false,message:'blocked'}),()=>{throw Error('failure');},(s,c,a)=>{const r=fakeResolve(s,c,a);r.supportLosses.ashigaru=99999;return r;}]){
  Allies.configure({resolveWar});const result=Allies.act(state,action);assert.equal(result.ok,false);assert.equal(result.state,state);assert.deepEqual(state,before);
 }
 Allies.configure({resolveWar:fakeResolve});
});

test('stale requests cannot send; expiry ends without a friendship penalty and changed wars cannot be replayed', () => {
 const state=fixture(),request=queue(state);state.turn++;state.season++;
 assert.equal(Allies.preview(state,{requestId:request.id,sourceId:'home',troops:500}).ok,false);
 const ended=Allies.act(state,{type:'decline',requestId:request.id});assert.equal(ended.ok,true);assert.equal(ended.state.relations.ally,80);
 const changed=fixture(),other=queue(changed);changed.castles[2].clan='ally';
 const result=Allies.act(changed,{type:'decline',requestId:other.id});assert.equal(result.ok,true);assert.equal(result.state.aiBattles.length,0);
});

function outgoingFixture() {
 const state=fixture();state.castles[0].neighbors.push('enemyHome');state.castles[2].neighbors.push('home');
 return state;
}
function outgoing(state,extra={}) {
 return {sourceId:'home',targetId:'enemyHome',mode:'siege',defending:false,supportCastleId:'allyHome',troops:1000,...extra};
}
function supportReport(state,support,extra={}) {
 const losses=Object.fromEntries(UNITS.map(key=>[key,Math.floor(support.units[key]*.2)]));
 return {id:'supported-tactical-battle',sourceId:'home',targetId:'enemyHome',mode:'siege',defending:false,won:true,
 supportReports:[{id:support.id,clan:support.clan,sourceId:support.sourceId,committedUnits:clone(support.units),
 casualtyUnits:losses,survivingUnits:Object.fromEntries(UNITS.map(key=>[key,support.units[key]-losses[key]])),troops:support.troops,casualties:total(losses),survivors:support.troops-total(losses)}],...extra};
}

test('player requests a chosen allied contingent for a real attack and reserves only that allied castle troops and stores', () => {
 const state=outgoingFixture(),before=clone(state),args=outgoing(state),view=Allies.getSupportView(state,args);
 assert.equal(view.ok,true);assert.equal(view.sources.length,1);assert.equal(view.sources[0].maxTroops,3200);
 const result=Allies.requestSupport(state,args);assert.equal(result.ok,true,result.message);
 assert.equal(result.state.castles[1].troops,3000);assert.equal(result.state.castles[1].food,30000-840);assert.equal(result.state.castles[1].gold,880);
 assert.equal(result.state.food,before.food);assert.equal(result.state.actionPoints,before.actionPoints);assert.deepEqual(result.state.armies.home,before.armies.home);
 assert.equal(Allies.getSupports(result.state,args).length,1);assert.equal(Allies.getSupports(result.state,{...args,targetId:'allyHome'}).length,0);
 assert.equal(Allies.requestSupport(result.state,args).ok,false,'cannot reserve the same contingent twice');assert.deepEqual(state,before);
 assert.equal(Allies.validate(result.state),true);
});

test('allied tactical casualties return exact survivors once and never turn allied reinforcements into conquered garrisons', () => {
 const initial=Allies.requestSupport(outgoingFixture(),outgoing()).state,support=initial.tenka.allies.committed[0],report=supportReport(initial,support);
 const result=Allies.finalizeBattle(initial,report);assert.equal(result.ok,true,result.message);
 assert.equal(result.state.castles[1].troops,3800);assert.deepEqual(result.state.armies.allyHome.units,units(2850,{archer:950}));
 assert.equal(result.state.tenka.allies.committed.length,0);assert.equal(result.state.tenka.allies.reports[0].casualties,200);
 assert.deepEqual(Allies.finalizeBattle(result.state,report).state,result.state,'second settlement cannot duplicate returning troops');
 const forged=clone(report);forged.supportReports[0].survivingUnits.ashigaru++;
 assert.equal(Allies.finalizeBattle(initial,forged).ok,false);assert.equal(initial.castles[1].troops,3000);
});

test('cancellation and season/pact invalidation return reservations once without refunding dispatched provisions', () => {
 for(const trigger of ['cancel','turn','alliance','capture']){
  const reserved=Allies.requestSupport(outgoingFixture(),outgoing()).state,support=reserved.tenka.allies.committed[0],food=reserved.castles[1].food;
  let result;
  if(trigger==='cancel')result=Allies.cancelSupport(reserved,{supportId:support.id}).state;
  else {if(trigger==='turn')reserved.turn++;if(trigger==='alliance')reserved.alliances=[];if(trigger==='capture')reserved.castles[2].clan='player';result=Allies.initialize(reserved);}
  assert.equal(result.tenka.allies.committed.length,0);assert.equal(result.castles[1].troops,4000);assert.equal(result.castles[1].food,food);
  assert.equal(Allies.initialize(result).castles[1].troops,4000);
 }
 const reserved=Allies.requestSupport(outgoingFixture(),outgoing()).state,support=reserved.tenka.allies.committed[0];
 reserved.lastBattle=supportReport(reserved,support);reserved.castles[2].clan='player';
 assert.equal(Allies.initialize(reserved).tenka.allies.committed.length,1,'a completed battle keeps its reservation until its verified losses settle');
});

test('support for defense requires a real pending invasion and both ally and source remain friendly', () => {
 const state=outgoingFixture(),args=outgoing(state,{sourceId:'enemyHome',targetId:'home',defending:true});
 assert.equal(Allies.requestSupport(state,args).ok,false);
 state.pendingDefense={sourceId:'enemyHome',targetId:'home',mode:'siege'};
 const result=Allies.requestSupport(state,args);assert.equal(result.ok,true,result.message);assert.equal(result.support.side,'defender');
 const blocked=clone(state);blocked.alliances.push('enemy');blocked.allianceExpires.enemy=5;
 assert.equal(Allies.requestSupport(blocked,args).ok,false);
});

test('sea routes need real naval capacity and inland troops never include unused naval combatants', () => {
 const state=outgoingFixture();state.castles[0].coastal=true;state.castles[1].coastal=true;state.castles[0].routes={allyHome:'sea'};state.castles[1].routes={home:'sea'};
 state.castles[2].coastal=true;
 assert.equal(Allies.requestSupport(state,outgoing(state)).ok,false);
 state.armies.allyHome.units=units(2500,{navy:1500});
 const result=Allies.requestSupport(state,outgoing(state));assert.equal(result.ok,true,result.message);assert.ok(result.support.units.navy>=100);
 const inland=outgoingFixture();inland.castles[1].coastal=true;inland.armies.allyHome.units=units(2000,{navy:2000});
 const land=Allies.requestSupport(inland,outgoing(inland));assert.equal(land.ok,true);assert.equal(land.support.units.navy,0);
});

test('save ledger rejects duplicate/future decisions and modified reservation/report counts', () => {
 const state=fixture();queue(state);
 for(const change of [s=>s.tenka.allies.pending.push(clone(s.tenka.allies.pending[0])),s=>s.tenka.allies.pending[0].turn++,s=>s.tenka.allies.pending[0].side='bogus',s=>s.tenka.allies.processed.push(s.tenka.allies.pending[0].id)]){
  const changed=clone(state);change(changed);assert.equal(Allies.validate(changed),false);
 }
 const reserved=Allies.requestSupport(outgoingFixture(),outgoing()).state;
 reserved.tenka.allies.committed[0].troops++;
 assert.equal(Allies.validate(reserved),false);
});

function nativeFixture(side='attacker') {
 const env=runtime(),Allies=env.context.TenkaAllies,{Game}=env;let state=Game.newGame();
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:state.turn+4};state.relations.matsudaira=80;state.food=100000;state.gold=100000;
 const source=state.castles.find(c=>c.id===(side==='attacker'?'okazaki':'iwamura'));
 const target=state.castles.find(c=>c.id===(side==='attacker'?'iwamura':'okazaki'));
 source.troops=5000;state.armies[source.id].units=units(3500,{archer:1000,cavalry:500});source.food=100000;source.gold=100000;
 target.troops=2200;state.armies[target.id].units=units(1600,{archer:600});
 state=Game.migrate(state);assert.equal(Game.validate(state),true);
 return {...env,Allies,state,sourceId:source.id,targetId:target.id};
}

test('real native AI pauses an allied invasion before costs or combat, saves it, and explicit refusal resumes that exact war once', () => {
 const env=nativeFixture(),{Game,Allies,sourceId,targetId}=env;let state=env.state;
 for(const c of state.castles)if(c.clan!==state.playerClan&&![sourceId,targetId].includes(c.id)){c.troops=0;state.armies[c.id].units=units(0);}
 const source=state.castles.find(c=>c.id===sourceId),before={gold:source.gold,food:source.food,troops:source.troops};
 Game.runAI(state);
 const request=Allies.getView(state).requests[0];assert.ok(request,'native AI must issue an actual allied request');assert.equal(request.sourceId,sourceId);const engagedTargetId=request.targetId;
 assert.equal(source.gold,before.gold);assert.equal(source.food,before.food);assert.equal(source.troops,before.troops,'native war has not resolved');
 assert.equal(Game.season(state).ok,false);assert.equal(Game.action(state,'develop','kiyosu').ok,false);
 assert.equal(Game.save(state),true);state=Game.load();assert.ok(state);assert.equal(Allies.getView(state).requests[0].id,request.id);
 const targetBefore=clone(state.castles.find(c=>c.id===engagedTargetId));
 const result=Allies.act(state,{type:'decline',requestId:request.id});assert.equal(result.ok,true,result.message);
 const after=result.state.castles.find(c=>c.id===sourceId),native=result.state.aiBattles[0];
 assert.equal(after.gold,before.gold-120+(native.won?Math.round(targetBefore.gold*.3):0));
 assert.equal(after.food,before.food-600-Math.round(native.attackerArmy.troops*.24)+(native.won?Math.round(targetBefore.food*.18):0));
 assert.equal(result.state.aiBattles.length,1);assert.equal(result.state.aiBattles[0].sourceId,sourceId);assert.equal(result.state.aiBattles[0].targetId,engagedTargetId);
 assert.equal(result.state.relations.matsudaira,65);assert.equal(Game.validate(result.state),true);
 const saved=clone(result.state);assert.equal(Allies.act(result.state,{type:'decline',requestId:request.id}).ok,false);assert.deepEqual(clone(result.state),saved);
});

test('real native allied attacks and defenses include player forces in combat power, separately settle losses and keep ownership/garrisons native', () => {
 for(const side of ['attacker','defender']) {
  const env=nativeFixture(side),{Game,Allies,sourceId,targetId}=env,state=env.state;
  assert.equal(Allies.queueWar(state,sourceId,targetId,'siege'),true);const request=Allies.getView(state).requests[0];
  const withoutAid=Allies.act(clone(state),{type:'decline',requestId:request.id});assert.equal(withoutAid.ok,true,withoutAid.message);
  const beforeHome=state.castles.find(c=>c.id==='kiyosu').troops,beforeUnits=clone(state.armies.kiyosu.units),beforeFood=state.food,beforeGold=state.gold;
  const args={type:'send',requestId:request.id,sourceId:'kiyosu',troops:1200},check=Allies.preview(state,args);assert.equal(check.ok,true,check.message);
  const result=Allies.act(state,args);assert.equal(result.ok,true,result.message);const battle=result.battle;
  assert.equal(battle.supportArmy.troops,1200);assert.equal(battle.supportArmy.side,side);assert.equal(battle.supportArmy.clan,state.playerClan);
  assert.ok(side==='attacker'?battle.successChance>withoutAid.battle.successChance:battle.successChance<withoutAid.battle.successChance,'the contingent changes actual native combat power');
  assert.equal(total(battle.supportLosses),battle.supportCasualties);assert.equal(total(battle.supportSurvivors),1200-battle.supportCasualties);
  const home=result.state.castles.find(c=>c.id==='kiyosu');assert.equal(home.troops,beforeHome-battle.supportCasualties);
  for(const key of UNITS)assert.equal(result.state.armies.kiyosu.units[key],beforeUnits[key]-battle.supportLosses[key]);
  assert.equal(result.state.food,beforeFood-check.foodCost);assert.equal(result.state.gold,beforeGold-120);
  assert.equal(Game.orders.remaining(result.state,'kiyosu'),2);assert.equal(result.state.tenka.allies.committed.length,0);
  if(battle.won){assert.equal(result.state.castles.find(c=>c.id===targetId).clan,battle.attackerClan);assert.notEqual(battle.attackerClan,state.playerClan);}
  assert.equal(battle.attackerArmy.troops>0,true);assert.equal(battle.attackerArmy.clan,state.castles.find(c=>c.id===sourceId).clan);
  assert.equal(Game.validate(result.state),true);
  assert.equal(Game.save(result.state),true);const restored=Game.load();assert.ok(restored);assert.equal(restored.tenka.allies.reports[0].casualties,battle.supportCasualties);
 }
});

test('real outgoing reservations persist and retain spent castle orders; stale cancellation returns troops without any command or supply refill', () => {
 const env=runtime(),{Game}=env,Allies=env.context.TenkaAllies;let state=Game.newGame();
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:5};state.relations.matsudaira=80;state.food=100000;state.gold=100000;
 state.tenka.castleOrders.castles.kiyosu.remaining=1;state=Game.migrate(state);
 const args={sourceId:'kiyosu',targetId:'inabayama',supportCastleId:'okazaki',troops:1000,mode:'siege',defending:false};
 const before=state.castles.find(c=>c.id==='okazaki').troops,result=Allies.requestSupport(state,args);assert.equal(result.ok,true,result.message);
 assert.equal(Game.orders.remaining(result.state,'kiyosu'),1);assert.equal(Game.save(result.state),true);const loaded=Game.load();assert.ok(loaded);
 assert.equal(Allies.getSupports(loaded,args).length,1);assert.equal(loaded.castles.find(c=>c.id==='okazaki').troops,before-1000);
 const food=loaded.castles.find(c=>c.id==='okazaki').food,returned=Allies.cancelSupport(loaded,{supportId:result.support.id});assert.equal(returned.ok,true);
 assert.equal(returned.state.castles.find(c=>c.id==='okazaki').troops,before);assert.equal(returned.state.castles.find(c=>c.id==='okazaki').food,food);
 assert.equal(Game.orders.remaining(returned.state,'kiyosu'),1);assert.equal(Game.validate(returned.state),true);
});

test('native automatic attack cannot bypass the tactical battlefield of a committed allied contingent', () => {
 const env=runtime(),{Game}=env,Allies=env.context.TenkaAllies;let state=Game.newGame();
 state.alliances=['matsudaira'];state.allianceExpires={matsudaira:5};state.relations.matsudaira=80;
 const args={sourceId:'kiyosu',targetId:'inabayama',supportCastleId:'okazaki',troops:1000,mode:'siege',defending:false};
 const reserved=Allies.requestSupport(state,args);assert.equal(reserved.ok,true,reserved.message);state=reserved.state;
 const before=JSON.stringify(state),orders=Game.orders.remaining(state,'kiyosu');
 const result=Game.action(state,'attack','inabayama',{sourceId:'kiyosu',mode:'siege'});
 assert.equal(result.ok,false);assert.match(result.message,/戦場で采配する/);assert.equal(result.state,state);
 assert.equal(JSON.stringify(state),before,'a rejected automatic attack cannot spend troops, provisions or allied reservations');
 assert.equal(Game.orders.remaining(state,'kiyosu'),orders);assert.equal(Allies.getSupports(state,args).length,1);
 const battle=Game.createBattle({state,sourceId:'kiyosu',targetId:'inabayama',mode:'siege'});
 assert.equal(battle.phase,'deployment');assert.equal(battle.supportCommitments.length,1,'the real battlefield remains available');
});

test('saved pending wars invalidated by NPC peace or unavailable main forces close freely instead of locking the campaign', () => {
 for(const reason of ['pact','gold','food','forces']) {
  const env=nativeFixture(),{Game,Allies,sourceId,targetId}=env;let state=env.state;
  assert.equal(Allies.queueWar(state,sourceId,targetId,'siege'),true);
  const request=Allies.getView(state).requests[0],source=state.castles.find(c=>c.id===sourceId),target=state.castles.find(c=>c.id===targetId);
  if(reason==='pact')state.npcPacts.push([source.clan,target.clan]);
  if(reason==='gold')source.gold=0;
  if(reason==='food')source.food=0;
  if(reason==='forces'){source.troops=500;state.armies[source.id].units=units(500);}
  assert.equal(Game.validate(state),true,`${reason} is a legitimate campaign state`);
  assert.equal(Game.save(state),true);state=Game.load();assert.ok(state);
  assert.equal(Allies.getView(state).requests[0].canSend,false,`${reason} no longer permits a war`);
  const before=clone(state),sent=Allies.act(state,{type:'send',requestId:request.id,sourceId:'kiyosu',troops:1000});
  assert.equal(sent.ok,false);assert.equal(sent.state,state);assert.deepEqual(clone(state),before);
  const result=Allies.act(state,{type:'decline',requestId:request.id});assert.equal(result.ok,true,result.message);
  assert.equal(Allies.hasPendingRequests(result.state),false);assert.equal(result.state.relations.matsudaira,before.relations.matsudaira);
  assert.deepEqual(clone(result.state.castles),before.castles);assert.deepEqual(clone(result.state.armies),before.armies);
  assert.equal(result.state.food,before.food);assert.equal(result.state.gold,before.gold);assert.equal(result.state.actionPoints,before.actionPoints);
  assert.deepEqual(clone(result.state.tenka.castleOrders),before.tenka.castleOrders);assert.equal(result.state.aiBattles.length,before.aiBattles.length);
  assert.equal(result.report.battleId,null);assert.equal(result.report.relationChange,0);
  assert.equal(Game.validate(result.state),true);assert.equal(Game.save(result.state),true);
  const restored=Game.load();assert.ok(restored);assert.equal(Allies.hasPendingRequests(restored),false);
  const next=Game.season(restored);assert.notEqual(next.ok,false,next.message);assert.equal(next.state.turn,restored.turn+1,'the closed request no longer locks seasonal progress');
 }
});
