'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime,clone}=require('./helpers/game-runtime.cjs');
function persist(Game,state){
 assert.equal(Game.validate(state),true,'actual save schema accepts the state');
 assert.equal(Game.save(state),true,'actual game writes the save');
 const loaded=Game.load();assert.ok(loaded,'actual loader restores the save');return loaded;
}
function clearCommands(state,id){for(const army of Object.values(state.armies))if(army.commanderId===id)army.commanderId=null;}
function peace(state){
 const clans=[...new Set(state.castles.map(c=>c.clan))];
 state.alliances=clans.filter(c=>c!==state.playerClan);state.allianceExpires=Object.fromEntries(state.alliances.map(c=>[c,state.turn+(Number.isInteger(state.month)?12:4)]));
 state.relations=Object.fromEntries(state.alliances.map(c=>[c,90]));
 state.npcPacts=[];for(let i=0;i<clans.length;i++)for(let j=i+1;j<clans.length;j++)if(clans[i]!==state.playerClan&&clans[j]!==state.playerClan)state.npcPacts.push([clans[i],clans[j]]);
 return state;
}
function toYear(Game,state,year){
 const limit=(year-state.year+1)*12;
 for(let months=0;state.year<year&&months<limit;months++){
  const previousTurn=state.turn,result=Game.season(peace(state));state=result.state;
  assert.ok(state.turn>previousTurn,'calendar must advance: '+result.message);
  assert.equal(Game.validate(state),true,'year '+state.year+' month '+state.month+' turn '+state.turn);
 }
 assert.equal(state.year,year,'historical-year fixture reaches its intended year');return state;
}

test('old saves with no dynasty migrate without reviving dead retainers or losing estate progress',()=>{
 const {Game}=runtime();const old=Game.newGame();
 old.officers=old.officers.filter(o=>Game.officers.some(base=>base.id===o.id));delete old.tenka.dynasty;
 const dead=old.officers.find(o=>o.id==='oda_nobunaga');dead.status='dead';dead.castleId=null;dead.capturedBy=null;clearCommands(old,dead.id);
 old.tenka.estates.kiyosu.commerce=8;old.gold=12345;
 const loaded=persist(Game,old);
 assert.equal(loaded.officers.find(o=>o.id===dead.id).status,'dead');assert.equal(loaded.gold,12345);assert.equal(loaded.tenka.estates.kiyosu.commerce,8);
 assert.ok(loaded.tenka.dynasty.families.oda.headId);assert.notEqual(loaded.tenka.dynasty.families.oda.headId,dead.id);
});

test('a house with no adult retainers can govern, recruit for free, save and assign the new commander',()=>{
 const {Game,Systems,Dynasty}=runtime();let state=Game.newGame();
 for(const o of state.officers.filter(o=>o.clan===state.playerClan)){o.status='dead';o.castleId=null;o.capturedBy=null;clearCommands(state,o.id);}
 state=Game.migrate(state);state.gold=0;state.actionPoints=0;
 for(const castle of state.castles.filter(item=>item.clan===state.playerClan))state.tenka.castleOrders.castles[castle.id].remaining=0;
 const commandsBefore=clone(state.tenka.castleOrders);
 const fallback=Systems.getView(state).administrationFallback;assert.equal(fallback.reason,'no-officers');
 const candidate=Dynasty.getView(state).recruits[0];assert.ok(candidate);
 const hired=Dynasty.act(state,{type:'recruit',candidateId:candidate.id});assert.equal(hired.ok,true,hired.message);state=persist(Game,hired.state);
 const recruit=state.officers.find(o=>o.id===candidate.id);assert.equal(recruit.status,'active');assert.equal(state.gold,0);assert.equal(state.actionPoints,0);
 assert.deepEqual(clone(hired.state.tenka.castleOrders),commandsBefore,'emergency recruitment cannot consume or refill any castle command');
 assert.deepEqual(clone(state.tenka.castleOrders),commandsBefore,'saving and resuming preserve all exhausted castle budgets');
 const army=clone(state.armies.kiyosu);army.commanderId=recruit.id;
 const arranged=Game.arrange(state,'kiyosu',army);assert.equal(arranged.ok,true,arranged.message);persist(Game,arranged.state);
 assert.equal(arranged.state.officers.find(o=>o.id==='oda_nobunaga').status,'dead');
});

test('a designated child inherits, an adult regent commands, and both survive save/reload',()=>{
 const {Game,Dynasty}=runtime();let state=Game.newGame();
 const son=state.officers.find(o=>o.id==='oda_nobutada');assert.equal(son.status,'child');
 let result=Dynasty.act(state,{type:'appointHeir',targetOfficerId:son.id});assert.equal(result.ok,true,result.message);state=result.state;
 result=Dynasty.act(state,{type:'appointRegent',targetOfficerId:'shibata_katsuie'});assert.equal(result.ok,true,result.message);state=result.state;
 const head=state.officers.find(o=>o.id==='oda_nobunaga');head.status='dead';head.castleId=null;clearCommands(state,head.id);
 state=persist(Game,Dynasty.reconcile(state));const family=Dynasty.getView(state).family;
 assert.equal(family.head.id,son.id);assert.equal(family.regent.id,'shibata_katsuie');assert.equal(family.head.status,'child');
 const battle=Game.createBattle({state,sourceId:'kiyosu',targetId:'narumi',mode:'field'});
 assert.ok(battle.eligibleOfficers.some(o=>o.id===family.regent.id));assert.ok(!battle.eligibleOfficers.some(o=>o.id===head.id||o.id===son.id));
});

test('a dynamically recruited officer commands a real battle whose result remains loadable',()=>{
 const {Game,Dynasty}=runtime();let state=Game.newGame();
 const candidate=Dynasty.getView(state).recruits[0],hired=Dynasty.act(state,{type:'recruit',candidateId:candidate.id});assert.equal(hired.ok,true);state=hired.state;
 state.armies.kiyosu.commanderId=candidate.id;state.officers.find(o=>o.id===candidate.id).castleId='kiyosu';
 let battle=Game.startBattle(Game.createBattle({state,sourceId:'kiyosu',targetId:'narumi',mode:'field'}));
 assert.ok(battle.units.some(u=>u.commanderId===candidate.id));
 for(let batch=0;batch<400&&battle.phase==='fighting';batch++){let steps=0;for(;steps<8&&battle.phase==='fighting';steps++)Game.simulateTick(battle);if(steps)battle.ledger.push({kind:'tick',steps});}
 assert.equal(battle.phase,'finished');const settled=Game.settle(state,battle);assert.equal(settled.ok,true,settled.message);
 const loaded=persist(Game,settled.state);assert.equal(loaded.lastBattle.attackerArmy.commanderId,candidate.id);
});

test('historical births, coming of age and both sexes continue through thirty years of real monthly saves',()=>{
 const {Game,Dynasty}=runtime();let state=toYear(Game,Game.newGame(),1577);state=persist(Game,state);
 assert.equal(state.officers.find(o=>o.id==='oda_nobutada').status,'active');
 assert.equal(state.officers.find(o=>o.id==='date_masamune').birth,1567);
 const princess=state.officers.find(o=>o.id==='oda_tokuhime');assert.equal(princess.status,'princess');
 assert.equal(state.year-princess.birth,18);
 let view=Dynasty.getView(state);const partner=view.marriageClans[0];assert.ok(partner);
 let married=Dynasty.act(state,{type:'marry',princessId:princess.id,targetClan:partner.id,spouseId:partner.spouseId});assert.equal(married.ok,true,married.message);
 state=persist(Game,married.state);assert.equal(state.officers.find(o=>o.id===princess.id).marriedTo,partner.spouseId);
 // Remove unrelated peace pacts to verify the marriage itself renews its alliance.
 for(let i=0;i<9;i++){state=Game.season(peace(state)).state;assert.ok(state.alliances.includes(partner.id));assert.equal(state.allianceExpires[partner.id],state.turn+12);state=persist(Game,state);}
 state=toYear(Game,state,1590);state=persist(Game,state);
 const born=state.officers.filter(o=>o.origin==='fictional'&&o.fatherId&&o.clan==='oda');
 assert.ok(born.some(o=>o.gender==='male'));assert.ok(born.some(o=>o.gender==='female'));
 assert.equal(new Set(state.officers.map(o=>o.id)).size,state.officers.length);
 const count=state.officers.length;assert.equal(Game.migrate(state).officers.length,count);
});

test('a legacy campaign two centuries later reloads with finite lifespans and can recruit a new head',()=>{
 const {Game,Dynasty}=runtime();let state=Game.newGame();
 state.year=1770;state.season=0;state.turn=841;state.gold=4321;
 delete state.month;delete state.tenka.calendar;
 state.tenka.estates.kiyosu.commerce=9;
 assert.equal(Game.validate(state),true,'the legacy age problem is accepted by the original save shape');
 state=persist(Game,state);
 assert.equal(state.gold,4321);assert.equal(state.tenka.estates.kiyosu.commerce,9);
 for(const o of state.officers){
   assert.ok(Dynasty.age(state,o)<=100,`${o.name} does not remain centuries old`);
   if(o.status==='dead')assert.equal(o.diedAtAge,o.deathYear-o.birth);
 }
 const head=state.officers.find(o=>o.id==='oda_nobunaga');assert.equal(head.status,'dead');assert.equal(head.deathCause,'natural');
 assert.ok(head.historicalDeath);assert.equal(state.armies.kiyosu.commanderId,null);
 const snapshot=clone(state);state=persist(Game,state);assert.deepEqual(clone(state),snapshot);
 const hired=Dynasty.act(state,{type:'recruit'});assert.equal(hired.ok,true,hired.message);
 state=persist(Game,hired.state);assert.ok(Dynasty.getView(state).family.head);
});

test('real monthly natural mortality preserves designated succession and retainer children through saves',()=>{
 const {Game,Dynasty}=runtime();let state=Game.newGame();
 state.year=1584;state.month=5;state.season=0;state.turn=291;
 state=Game.migrate(state);
 const result=Dynasty.act(state,{type:'appointHeir',targetOfficerId:'oda_nobutada'});assert.equal(result.ok,true);state=result.state;
 const head=state.officers.find(o=>o.id==='oda_nobunaga');head.naturalDeathAge=50;head.naturalDeathSeason=1;head.naturalDeathMonth=6;
 state=Game.season(peace(state)).state;state=persist(Game,state);
 const deceased=state.officers.find(o=>o.id===head.id);assert.equal(deceased.status,'dead');assert.equal(deceased.deathCause,'natural');assert.equal(deceased.diedAtAge,50);
 assert.equal(Dynasty.getView(state).family.head.id,'oda_nobutada');
 const retainerSon=state.officers.find(o=>o.id==='maeda_toshinaga');assert.equal(retainerSon.birth,1562);assert.equal(retainerSon.status,'active');assert.equal(retainerSon.fatherId,'maeda_toshiie');
 assert.equal(state.officers.filter(o=>o.id===retainerSon.id).length,1);
 assert.equal(Game.validate(state),true);
});
