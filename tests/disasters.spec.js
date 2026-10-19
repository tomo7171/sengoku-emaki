'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Systems=require('../tenka-systems.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const season=month=>month>=3&&month<=5?0:month>=6&&month<=8?1:month>=9&&month<=11?2:3;
function sample(count=1){
 const castles=Array.from({length:count},(_,i)=>({id:`estate-${i}`,name:`試験${i}城`,clan:'oda',clanName:'織田家',province:'尾張',kokudaka:48000,
  population:30000,troops:2400,food:20000,gold:4000,defense:65,morale:80,terrain:'plain',coastal:false,neighbors:[]}));
 return Systems.initialize({version:2,year:1560,month:3,season:0,turn:1,playerClan:'oda',selectedCastleId:castles[0].id,gold:50000,food:100000,
  prestige:35,actionPoints:3,castles,officers:[{id:'lord',name:'領主',clan:'oda',castleId:castles[0].id,status:'active',birth:1530,politics:80,intelligence:80,leadership:80,valor:80}],
  armies:Object.fromEntries(castles.map(c=>[c.id,{commanderId:c.id===castles[0].id?'lord':null,units:{ashigaru:1600,archer:400,cavalry:200,firearm:200,navy:0}}])),
  alliances:[],allianceExpires:{},relations:{},npcPacts:[],logs:[],nextLogId:1,lastBattle:null,aiBattles:[],gameOver:false});
}
function atMonth(input,month,turn=input.turn){const s=clone(input);s.month=month;s.season=season(month);s.turn=turn;return s;}
function settle(input){const s=clone(input);const budget=Systems.settleEconomy(s,input);return {state:s,budget};}
function next(input){const s=clone(input);s.turn++;s.month=s.month%12+1;if(s.month===1)s.year++;s.season=season(s.month);s.actionPoints=3;return settle(s);}
function act(state,type){return Systems.act(state,{type,castleId:state.castles[0].id,officerId:'lord'});}

test('monthly military accounts charge wages and provisions by actual troop type and size',()=>{
 const s=sample(),budget=Systems.economyForecast(s).castles[0];
 assert.equal(budget.periodMonths,1);assert.equal(budget.monthlyWages,43);assert.equal(budget.monthlyFood,149);
 assert.equal(budget.militaryUpkeep,budget.monthlyWages);assert.equal(budget.foodUpkeep,budget.monthlyFood);
 assert.equal(budget.militaryBreakdown.reduce((n,line)=>n+line.troops,0),2400);
 const cavalry=clone(s);cavalry.armies[cavalry.castles[0].id].units={ashigaru:0,archer:0,cavalry:2400,firearm:0,navy:0};
 const mounted=Systems.economyForecast(cavalry).castles[0];
 assert.ok(mounted.monthlyWages>budget.monthlyWages);assert.ok(mounted.monthlyFood>budget.monthlyFood);
 const larger=clone(cavalry);larger.castles[0].troops*=2;larger.armies[larger.castles[0].id].units.cavalry*=2;
 const double=Systems.economyForecast(larger).castles[0];
 assert.equal(double.militaryUpkeep,mounted.militaryUpkeep*2);assert.equal(double.foodUpkeep,mounted.foodUpkeep*2);
 assert.ok(double.netIncome<mounted.netIncome);
});

test('a monthly treasury bill is settled once across save reload and ownership changes',()=>{
 const initial=sample(),{state,budget}=settle(initial);
 assert.equal(state.gold,initial.gold+budget.income-budget.upkeep);assert.equal(state.food,initial.food-budget.foodUpkeep);
 const restored=Systems.initialize(clone(state)),before=clone(restored);
 assert.equal(Systems.settleEconomy(restored,initial).alreadySettled,true);assert.deepEqual(restored,before);
 restored.castles[0].clan='other';const capturedBefore=clone(restored);
 assert.equal(Systems.settleEconomy(restored,initial).alreadySettled,true);assert.deepEqual(restored,capturedBefore);
 const following=next(state);assert.equal(following.state.tenka.economy.ledger.length,2);
 assert.equal(following.state.food,state.food-following.budget.foodUpkeep);
});

test('monthly tax and commerce divide the previous seasonal rate without awarding extra harvests',()=>{
 const s=sample();s.tenka.estates[s.castles[0].id].commerce=4;
 const legacy=clone(s);delete legacy.month;
 const month=Systems.economyForecast(s).totals,quarter=Systems.economyForecast(legacy).totals;
 assert.ok(Math.abs(month.taxIncome*3-quarter.taxIncome)<=1);assert.ok(Math.abs(month.commerceIncome*3-quarter.commerceIncome)<=1);
 assert.equal(month.harvest,quarter.harvest,'annual harvest is not divided into monthly production');
 const august=atMonth(s,8,6),a=settle(august);assert.equal(a.budget.harvest,0);
 const september=next(a.state);assert.ok(september.budget.harvest>0);assert.equal(september.state.month,9);
 const october=next(september.state);assert.equal(october.budget.harvest,0);
 assert.equal(october.state.food,september.state.food-october.budget.foodUpkeep);
});

test('water control and regional exposure change the seasonal disaster risk',()=>{
 const s=atMonth(sample(),7,5),id=s.castles[0].id;s.tenka.estates[id].waterControl=10;
 const low=Systems.getView(s).castles[0].economy;
 s.tenka.estates[id].waterControl=90;const high=Systems.getView(s).castles[0].economy;
 assert.ok(low.risks.flood>high.risks.flood);assert.ok(low.risks.drought>high.risks.drought);
 const inland=atMonth(s,9,7),coast=clone(inland);coast.castles[0].coastal=true;coast.castles[0].province='薩摩';
 assert.ok(Systems.getView(coast).castles[0].economy.risks.typhoon>Systems.getView(inland).castles[0].economy.risks.typhoon);
 const winter=Systems.getView(atMonth(s,1,11)).castles[0].economy.risks;
 assert.deepEqual(winter,{drought:0,pests:0,typhoon:0,flood:0});
});

test('local weather is deterministic, persists in the harvest forecast and does not reroll on viewing or loading',()=>{
 const initial=atMonth(sample(128),7,5),before=clone(initial);
 for(const e of Object.values(initial.tenka.estates))e.waterControl=12;
 const one=settle(initial),two=settle(clone(initial));assert.deepEqual(one.state,two.state);
 assert.ok(one.state.tenka.disasters.some(e=>['flood','drought','pests'].includes(e.type)));
 for(const event of one.state.tenka.disasters){assert.equal(event.kind,'simulation');assert.equal(event.month,7);}
 const damaged=one.state.castles.find(c=>one.state.tenka.estates[c.id].cropDamage>0);
 assert.ok(damaged);const view=Systems.getView(one.state).castles.find(c=>c.id===damaged.id);
 assert.ok(view.economy.forecast.harvestLoss>0);assert.ok(view.economy.events.length);
 const saved=clone(one.state);Systems.getView(one.state);assert.deepEqual(one.state,saved);
 const loaded=Systems.initialize(saved);Systems.settleEconomy(loaded,initial);assert.deepEqual(loaded,saved);
 assert.deepEqual(before.tenka.disasters,[],'pre-event campaign is not mutated');
});

test('war damages the actual battlefield once without spending tactical supplies a second time',()=>{
 const initial=sample(2);initial.castles[1].clan='other';initial.lastBattle={id:'field-at-estate',mode:'field',won:true,sourceId:initial.castles[0].id,targetId:initial.castles[1].id,
  attackerClan:'oda',defenderClan:'other',tacticsVersion:1,supplyConsumed:87,attackerArmy:{troops:2400},defenderArmy:{troops:2400}};
 const before=Systems.economyForecast(initial).castles[1].harvest;
 const after=Systems.afterBattle(initial,{...initial,lastBattle:null});
 const estate=after.tenka.estates[initial.castles[1].id];
 assert.equal(estate.devastation,9);assert.equal(estate.cropDamage,0,'war uses existing devastation instead of adding duplicate crop damage');
 assert.ok(Systems.economyForecast(after).castles[1].harvest<before);assert.equal(after.food,initial.food);
 const repeated=Systems.afterBattle(after,{...initial,lastBattle:null});assert.deepEqual(repeated.tenka.estates,after.tenka.estates);
 assert.equal(repeated.tenka.disasters.filter(e=>e.type==='war-damage').length,1);
});

test('a ruined harvest and empty reserves create famine, disease losses and lower public order',()=>{
 let s=atMonth(sample(),9,7);const id=s.castles[0].id;s.food=0;
 Object.assign(s.tenka.estates[id],{cropDamage:75,devastation:40,famine:30,epidemic:40,unrest:45});
 const population=s.castles[0].population,order=Systems.getView(s).castles[0].economy.publicOrder;
 s=settle(s).state;const e=s.tenka.estates[id],view=Systems.getView(s).castles[0].economy;
 assert.ok(e.famine>30);assert.ok(s.castles[0].population<population);assert.ok(view.publicOrder<order);
 assert.ok(s.tenka.disasters.some(event=>event.type==='famine'));assert.ok(e.lastLedger.populationLoss>0);
 const populations=s.castles[0].population;Systems.settleEconomy(s,s);assert.equal(s.castles[0].population,populations);
});

test('splitting the same population and army among castles cannot disguise a national famine shortage',()=>{
 function country(count){
  const s=atMonth(sample(count),9,7);
  for(const c of s.castles){
   c.population=30000/count;c.kokudaka=48000/count;c.troops=2400/count;
   s.armies[c.id].units={ashigaru:c.troops,archer:0,cavalry:0,firearm:0,navy:0};
   Object.assign(s.tenka.estates[c.id],{baseKokudaka:c.kokudaka,devastation:100,cropDamage:80,waterControl:100});
  }
  // The whole country retains roughly 1,200 stone after the poor harvest:
  // enough for every individual small castle, but below the shared six-month
  // army reserve plus civilian need. Its granary is shared in either layout.
  const forecast=Systems.economyForecast(s).totals;
  s.food=1200-forecast.harvest+forecast.foodUpkeep;
  assert.ok(s.food>=0);
  return settle(s);
 }
 const concentrated=country(1),divided=country(6);
 for(const result of [concentrated,divided]){
  assert.equal(result.budget.foodDeficit,0,'military rations were paid in full');
  assert.ok(result.state.food>1000&&result.state.food<1400);
  assert.ok(result.state.castles.every(c=>result.state.tenka.estates[c.id].famine>0),'all impoverished estates share the national granary shortage');
 }
});

test('famine increases new disease outbreaks and foreign estates obey the same consequences',()=>{
 const s=atMonth(sample(96),6,4);s.food=0;
 for(const [i,c] of s.castles.entries()){
  if(i%2){c.clan='other';c.food=0;}
  Object.assign(s.tenka.estates[c.id],{famine:80,epidemic:0,waterControl:15});
 }
 const before=clone(s),result=settle(s).state;
 const outbreaks=result.tenka.disasters.filter(e=>e.type==='epidemic');assert.ok(outbreaks.length>0);
 assert.ok(result.castles.filter(c=>c.clan==='other').every(c=>result.tenka.estates[c.id].famine>80));
 assert.ok(result.castles.filter(c=>c.clan==='other').every(c=>c.population<before.castles.find(old=>old.id===c.id).population));
 assert.ok(outbreaks.every(e=>e.kind==='simulation'),'disease reports do not masquerade as fixed historical events');
 assert.deepEqual(result,settle(before).state,'loading before a disease outbreak cannot reroll it');
});

test('high dissatisfaction produces peasant uprisings, while Ikko revolts stay in relevant religious regions',()=>{
 let ordinary=sample(64);for(const e of Object.values(ordinary.tenka.estates))e.unrest=98;
 ordinary=settle(ordinary).state;
 assert.ok(ordinary.tenka.disasters.some(e=>e.type==='uprising'));
 assert.ok(ordinary.castles.every(c=>ordinary.tenka.estates[c.id].uprising?.kind==='peasant'));
 let kaga=sample(64);for(const c of kaga.castles)c.province='加賀';for(const e of Object.values(kaga.tenka.estates))e.unrest=98;
 kaga=settle(kaga).state;assert.ok(kaga.castles.some(c=>kaga.tenka.estates[c.id].uprising?.kind==='ikko'));
 const peaceful=settle(sample(64)).state;assert.equal(peaceful.tenka.disasters.filter(e=>e.type==='uprising').length,0);
});

test('relief, sanitation and waterworks provide distinct recoveries with ordinary command and resource costs',()=>{
 const original=sample(),id=original.castles[0].id;Object.assign(original.tenka.estates[id],{waterControl:10,cropDamage:40,famine:60,epidemic:55,unrest:85,uprising:{kind:'peasant',label:'農民一揆',startedTurn:1,strength:45}});
 const water=act(original,'waterworks');assert.equal(water.ok,true);assert.ok(water.state.tenka.estates[id].waterControl>10);assert.ok(water.state.tenka.estates[id].cropDamage<40);
 assert.equal(water.state.gold,original.gold-260);assert.equal(water.state.actionPoints,2);
 const relief=act(original,'relief');assert.equal(relief.ok,true);assert.equal(relief.state.food,original.food-600);
 assert.ok(relief.state.tenka.estates[id].famine<60);assert.ok(relief.state.tenka.estates[id].uprising.strength<45);
 const sanitation=act(original,'sanitation');assert.equal(sanitation.ok,true);assert.equal(sanitation.state.tenka.estates[id].epidemic,25);assert.equal(sanitation.state.food,original.food-120);
 const foreign=clone(original);foreign.castles[0].clan='other';assert.equal(act(foreign,'waterworks').ok,false);
});

test('legacy seasonal projects migrate to months exactly once and retain their progress',()=>{
 const s=sample(),id=s.castles[0].id;
 s.tenka.estates[id].projects=[{id:'old-work',type:'reclaim',label:'開墾・治水',startedTurn:1,remaining:2,total:3,workforce:350,upkeep:45,gain:1200,status:'工事中'}];
 let migrated=Systems.initialize(s),project=migrated.tenka.estates[id].projects[0];
 assert.equal(project.remaining,6);assert.equal(project.total,9);assert.equal(project.upkeep,15);assert.equal(project.periodUnit,'month');
 assert.deepEqual(Systems.initialize(migrated).tenka.estates[id].projects,migrated.tenka.estates[id].projects);
 const kokudaka=migrated.castles[0].kokudaka;
 for(let i=0;i<6;i++)migrated=next(migrated).state;
 assert.equal(migrated.tenka.estates[id].projects.length,0);assert.equal(migrated.castles[0].kokudaka,kokudaka+1200);
});
