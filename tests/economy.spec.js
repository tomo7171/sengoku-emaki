'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Systems=require('../tenka-systems.js');
const {runtime,clone}=require('./helpers/game-runtime.cjs');

const units=n=>({ashigaru:n,archer:0,cavalry:0,firearm:0,navy:0});
function sample(){
 const castles=[{id:'a',name:'試験城',clan:'oda',clanName:'織田家',province:'尾張',kokudaka:48000,
  population:30000,troops:2400,food:12000,gold:4000,defense:65,morale:80,terrain:'plain',coastal:false,neighbors:['b']},
 {id:'b',name:'他家城',clan:'imagawa',clanName:'今川家',province:'駿河',kokudaka:48000,
  population:30000,troops:2400,food:12000,gold:4000,defense:65,morale:80,terrain:'plain',coastal:false,neighbors:['a']}];
 return Systems.initialize({version:2,year:1560,season:0,turn:1,playerClan:'oda',selectedCastleId:'a',gold:9000,food:20000,
  prestige:35,actionPoints:3,castles,officers:[{id:'lord',name:'領主',clan:'oda',castleId:'a',status:'active',birth:1530,
   politics:80,intelligence:80,leadership:80,valor:80}],armies:{a:{commanderId:'lord',units:units(2400)},b:{commanderId:null,units:units(2400)}},
  alliances:[],allianceExpires:{},relations:{imagawa:0},npcPacts:[],logs:[],nextLogId:1,lastBattle:null,aiBattles:[],gameOver:false});
}
function act(s,type,extra={}){return Systems.act(s,{type,castleId:'a',officerId:'lord',...extra});}
function next(s){
 const state=clone(s);state.turn++;state.season=(state.season+1)%4;if(!state.season)state.year++;state.actionPoints=3;
 const budget=Systems.settleEconomy(state,s);
 return {state:Systems.advance(state,s),budget};
}

test('development commits workforce and cash for several seasons, completes once and cannot stack the same work',()=>{
 const initial=sample(),result=act(initial,'reclaim');assert.equal(result.ok,true);
 let state=result.state;const project=state.tenka.estates.a.projects[0],gain=project.gain;
 const advanceGain=state.castles[0].kokudaka-initial.castles[0].kokudaka;
 assert.ok(advanceGain>0&&advanceGain<gain,'only a small first parcel is usable at commissioning');
 assert.equal(project.remaining,3);assert.equal(state.gold,initial.gold-300);
 assert.ok(Systems.getView(state).castles[0].economy.laborEfficiency<Systems.getView(initial).castles[0].economy.laborEfficiency);
 const another={...state,actionPoints:3,tenka:{...state.tenka,assignments:{}}},before=clone(another);
 const rejected=act(another,'reclaim');assert.equal(rejected.ok,false);assert.equal(rejected.state,another);assert.deepEqual(another,before);
 let billed=0;
 for(let remaining=2;remaining>=0;remaining--){
  const step=next(state);state=step.state;billed+=step.budget.projectUpkeep;
  assert.equal(state.tenka.estates.a.projects[0]?.remaining||0,remaining);
  assert.equal(state.tenka.economy.ledger[0].goldAfter,state.gold);
 }
 assert.equal(billed,project.upkeep*3,'workers are paid for the final construction season as well');
 assert.equal(state.castles[0].kokudaka,initial.castles[0].kokudaka+advanceGain+gain);
 const completed=state.castles[0].kokudaka;state=next(state).state;
 assert.equal(state.castles[0].kokudaka,completed);assert.equal(state.tenka.estates.a.projects.length,0);
 assert.ok(state.tenka.economy.ledger.length>=4);
});

test('commerce starts as a provisional market then funds recurring upkeep after completion',()=>{
 let state=act(sample(),'commercial').state;
 const provisional=Systems.getView(state).castles[0].income;
 assert.ok(provisional>0);assert.equal(state.tenka.estates.a.projects[0].remaining,2);
 state=next(state).state;assert.equal(Systems.getView(state).castles[0].income,provisional);
 state=next(state).state;
 const finished=Systems.getView(state).castles[0];
 assert.ok(finished.income>provisional*2);assert.equal(finished.economy.projects.length,0);
 assert.equal(finished.economy.forecast.maintenance,18);
 const future=act(state,'commercial');assert.equal(future.ok,true);assert.equal(state.gold-future.state.gold,490,'second market is more expensive');
});

test('seasonal ledger accounts for each actual resource exactly once and never repeats native income through advance',()=>{
 const previous=sample(),state=clone(previous);state.turn=2;state.season=1;
 const totals=Systems.economyForecast(state).totals;
 const result=Systems.settleEconomy(state,previous);
 assert.equal(state.gold,previous.gold+result.income-result.upkeep);
 assert.equal(state.food,previous.food-result.foodUpkeep);
 assert.equal(result.income,totals.income);assert.equal(result.harvest,0);
 const report=state.tenka.economy.ledger[0];assert.equal(report.goldBefore,previous.gold);assert.equal(report.foodAfter,state.food);
 const once=clone(state);Systems.settleEconomy(state,previous);assert.deepEqual(state,once);
 const advanced=Systems.advance(state,previous);assert.equal(advanced.gold,state.gold);assert.equal(advanced.food,state.food);
 assert.ok(advanced.tenka.turnReports.some(text=>text.includes('領国収支')));
});

test('drafting increases standing costs and reduces harvest; returning soldiers restores civilian production',()=>{
 const state=sample(),before=Systems.economyForecast(state).totals;
 const draft=act(state,'levy');assert.equal(draft.ok,true);
 const militarized=Systems.economyForecast(draft.state).totals;
 assert.ok(militarized.foodUpkeep>before.foodUpkeep);assert.ok(militarized.militaryUpkeep>before.militaryUpkeep);
 assert.ok(militarized.harvest<before.harvest);
 const fresh=clone(draft.state);fresh.turn++;fresh.actionPoints=3;
 const released=act(fresh,'demobilize',{troops:600});assert.equal(released.ok,true);
 const restored=Systems.economyForecast(released.state).totals;
 assert.ok(restored.harvest>militarized.harvest);assert.ok(restored.foodUpkeep<militarized.foodUpkeep);
 assert.equal(released.state.castles[0].troops,Object.values(released.state.armies.a.units).reduce((n,v)=>n+v,0));
 const invalid=act(state,'demobilize',{troops:state.castles[0].troops});assert.equal(invalid.ok,false);assert.equal(invalid.state,state);
});

test('heavy taxes offer short-term revenue but accumulated unrest harms the estate, while light tax and relief recover it',()=>{
 const initial=sample(),standard=Systems.economyForecast(initial).totals;
 let state=act(initial,'tax',{policy:'high'}).state;
 assert.ok(Systems.economyForecast(state).totals.taxIncome>standard.taxIncome);
 const sameTurn=clone(state);sameTurn.tenka.assignments={};
 assert.equal(act(sameTurn,'tax',{policy:'low'}).ok,false,'one policy revision per estate per season');
 for(let i=0;i<10;i++)state=next(state).state;
 assert.ok(state.tenka.estates.a.unrest>=80);
 assert.ok(state.castles[0].morale<initial.castles[0].morale);
 assert.ok(Systems.economyForecast(state).totals.taxIncome<standard.taxIncome,'unrest eventually outweighs high nominal tax');
 const unrest=state.tenka.estates.a.unrest;state=act(state,'tax',{policy:'low'}).state;state=next(state).state;
 assert.ok(state.tenka.estates.a.unrest<unrest);
 const recovery=act(state,'relief');assert.equal(recovery.ok,true);
 assert.ok(recovery.state.tenka.estates.a.unrest<=state.tenka.estates.a.unrest-18);
 assert.equal(recovery.state.food,state.food-600);assert.equal(recovery.state.gold,state.gold-80);
});

test('buying provisions can recover an exhausted treasury without selling the last two seasons of food',()=>{
 const initial=sample(),poor=clone(initial);poor.food=0;
 const rejected=act(poor,'sellGrain');assert.equal(rejected.ok,false);assert.equal(rejected.state,poor);
 const bought=act(poor,'buyGrain');assert.equal(bought.ok,true);assert.equal(bought.state.food,1200);assert.equal(bought.state.gold,poor.gold-400);
 const safety=clone(initial);safety.food=Systems.economyForecast(safety).totals.foodUpkeep*2+1199;
 assert.equal(act(safety,'sellGrain').ok,false);
 safety.food++;const sold=act(safety,'sellGrain');assert.equal(sold.ok,true);
 assert.equal(sold.state.gold,safety.gold+300);assert.equal(sold.state.food,safety.food-1200);
 const noCash=clone(initial);noCash.gold=399;const before=clone(noCash);
 assert.equal(act(noCash,'buyGrain').ok,false);assert.deepEqual(noCash,before,'unaffordable market orders are atomic');
});

test('terrain limits arable expansion and saturated estates have rising investment cost and diminishing output',()=>{
 const initial=sample(),mature=clone(initial),estate=mature.tenka.estates.a;
 const young=Systems.getView(initial).castles[0].economy;
 estate.reclaimed=young.developmentCapacity*.8;mature.castles[0].kokudaka+=estate.reclaimed;
 const old=Systems.getView(mature).castles[0].economy;
 assert.ok(old.costs.reclaim.gold>young.costs.reclaim.gold);assert.ok(old.costs.reclaim.gain<young.costs.reclaim.gain);
 const mountain=clone(initial);mountain.castles[0].terrain='mountain';
 assert.ok(Systems.getView(mountain).castles[0].economy.developmentCapacity<young.developmentCapacity);
 estate.reclaimed=young.developmentCapacity;
 const full=act(mature,'reclaim');assert.equal(full.ok,false);assert.match(full.message,/適地/);
});

test('scarce workforce prevents construction until the garrison is reduced and saved projects retain progress',()=>{
 const initial=sample();initial.castles[0].population=6000;initial.castles[0].troops=2400;
 assert.equal(act(initial,'reclaim').ok,false);
 let state=act(initial,'demobilize',{troops:1500}).state;
 state.turn++;state.actionPoints=3;const started=act(state,'reclaim');assert.equal(started.ok,true);
 state=next(started.state).state;
 const loaded=Systems.initialize(JSON.parse(JSON.stringify(state)));
 assert.deepEqual(loaded.tenka.estates.a.projects,state.tenka.estates.a.projects);
 assert.deepEqual(loaded.tenka.economy.ledger,state.tenka.economy.ledger);
 assert.equal(next(loaded).state.tenka.estates.a.projects[0].remaining,1);
});

test('a broke estate pauses construction without removing the project and resumes once supplies recover',()=>{
 let state=act(sample(),'reclaim').state;
 state.gold=0;state.castles[0].kokudaka=1000;state.castles[0].population=1000;state.castles[0].troops=6000;state.armies.a.units=units(6000);
 state=next(state).state;assert.equal(state.tenka.estates.a.projects[0].remaining,3);
 assert.match(state.tenka.estates.a.projects[0].status,/中断/);assert.equal(state.gold,0);
 state.gold=5000;state=next(state).state;assert.equal(state.tenka.estates.a.projects[0].remaining,2);
 assert.equal(state.tenka.estates.a.projects[0].status,'工事中');
});

test('the real campaign month uses the detailed ledger, saves project state, and keeps every castle command independent',()=>{
 const {Game,Systems:Live,context}=runtime();let state=Game.newGame();
 // Freeze foreign fronts through actual pacts; the economy test should not
 // make its assertions depend on an opportunistic unrelated native AI war.
 const clans=[...new Set(state.castles.map(c=>c.clan))];state.npcPacts=[];
 for(let a=0;a<clans.length;a++)for(let b=a+1;b<clans.length;b++)if(clans[a]!==state.playerClan&&clans[b]!==state.playerClan)state.npcPacts.push([clans[a],clans[b]]);
 state.alliances=clans.filter(c=>c!==state.playerClan);state.allianceExpires=Object.fromEntries(state.alliances.map(c=>[c,state.turn+12]));
 const home=state.castles.find(c=>c.id===state.selectedCastleId),other=state.castles.find(c=>c.clan===state.playerClan&&c.id!==home.id);
 const person=Live.getView(state).officers.find(o=>o.available);
 const started=Live.act(state,{type:'commercial',castleId:home.id,orderCastleId:home.id,officerId:person.id});
 assert.equal(started.ok,true);state=started.state;
 assert.equal(context.TenkaOrders.remaining(state,home.id),2);
 if(other)assert.equal(context.TenkaOrders.remaining(state,other.id),3);
 assert.equal(Game.save(state),true);state=Game.load();assert.equal(state.tenka.estates[home.id].projects[0].remaining,6);
 for(let i=0;i<6;i++){
  const before=clone(state),result=Game.season(state);state=result.state;
  const ledger=state.tenka.economy.ledger[0];assert.equal(ledger.turn,state.turn);
  assert.equal(state.gold,before.gold+ledger.income-ledger.upkeep);
  assert.equal(state.food,before.food+ledger.harvest-ledger.foodUpkeep);
  assert.equal(ledger.goldAfter,state.gold);assert.equal(ledger.foodAfter,state.food);
  assert.equal(Game.validate(state),true);assert.equal(context.TenkaOrders.remaining(state,home.id),3);
 }
 assert.equal(state.tenka.estates[home.id].projects.length,0);
 assert.equal(Game.save(state),true);const restored=Game.load();assert.deepEqual(clone(restored.tenka.economy.ledger),clone(state.tenka.economy.ledger));
});

test('new estate policies cannot borrow another castle command or secretly debit foreign property',()=>{
 const {Game,Systems:Live,context}=runtime();const state=Game.newGame();
 const castles=state.castles.filter(c=>c.clan===state.playerClan),home=castles[0],other=castles[1];
 assert.ok(other);const officer=Live.getView(state).officers.find(o=>o.available),before=clone(state);
 for(const type of ['tax','relief','buyGrain','sellGrain','demobilize','waterworks','sanitation']){
  const result=Live.act(state,{type,castleId:home.id,orderCastleId:other.id,officerId:officer.id,policy:'low',troops:200});
  assert.equal(result.ok,false,type);assert.equal(result.state,state);assert.equal(context.TenkaOrders.remaining(state,home.id),3);
 }
 const foreign=state.castles.find(c=>c.clan!==state.playerClan);
 const rejected=Live.act(state,{type:'buyGrain',castleId:foreign.id,officerId:officer.id});assert.equal(rejected.ok,false);
 assert.deepEqual(clone(state),before);
});

test('several player castles cannot spend the same shared treasury on unpaid construction',()=>{
 const {Game,Systems:Live}=runtime();let state=Game.newGame();
 const clans=[...new Set(state.castles.map(c=>c.clan))];state.npcPacts=[];
 for(let a=0;a<clans.length;a++)for(let b=a+1;b<clans.length;b++)if(clans[a]!==state.playerClan&&clans[b]!==state.playerClan)state.npcPacts.push([clans[a],clans[b]]);
 state.alliances=clans.filter(c=>c!==state.playerClan);state.allianceExpires=Object.fromEntries(state.alliances.map(c=>[c,state.turn+12]));
 for(const [castleId,officerId] of [['kiyosu','oda_nobunaga'],['inuyama','shibata_katsuie']]){
  const started=Live.act(state,{type:'reclaim',castleId,officerId});assert.equal(started.ok,true);state=started.state;
 }
 state.gold=50;
 for(const id of ['kiyosu','inuyama'])Object.assign(state.tenka.estates[id],{devastation:100,unrest:70,taxPolicy:'low'});
 assert.equal(Game.validate(state),true);
 const result=Game.season(state),nextState=result.state,ledger=nextState.tenka.economy.ledger[0];
 const mandatory=ledger.militaryUpkeep+ledger.maintenance,available=state.gold+ledger.income-mandatory;
 assert.ok(available>=15&&available<30,'the shared treasury can afford exactly one monthly project bill');
 assert.equal(ledger.projectUpkeep,15);assert.equal(ledger.goldDeficit,0);
 assert.equal(nextState.gold,available-ledger.projectUpkeep);
 const projects=['kiyosu','inuyama'].map(id=>nextState.tenka.estates[id].projects[0]);
 assert.deepEqual(projects.map(p=>p.remaining).sort(),[8,9]);
 assert.equal(projects.filter(p=>p.status==='資金不足で中断').length,1);
 assert.equal(Game.validate(nextState),true);
 // Allocation order is stable across a reload or a different castle array
 // order, so a save cannot gain another month of unpaid work.
 const reloaded=clone(state);reloaded.castles.reverse();
 const again=Game.season(reloaded).state;
 for(const id of ['kiyosu','inuyama'])assert.equal(again.tenka.estates[id].projects[0].remaining,nextState.tenka.estates[id].projects[0].remaining);
 assert.equal(again.gold,nextState.gold);
});
