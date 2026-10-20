'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime,clone}=require('./helpers/game-runtime.cjs');
const {Game,Tactics,context}=runtime();
const Auto=context.TenkaAutoBattle;
const types=['ashigaru','archer','cavalry','firearm','navy'];
const live=u=>u.troops>0&&!['routed','destroyed'].includes(u.status);
function fixture(sourceId='hinoe',targetId='muranaka',options={}){
 const state=Game.newGame(),source=state.castles.find(c=>c.id===sourceId),target=state.castles.find(c=>c.id===targetId);
 state.playerClan=source.clan;
 for(const[castle,type,troops]of[[source,options.type||'ashigaru',options.troops||6000],[target,'ashigaru',options.enemies||40]]){
  castle.troops=troops;state.armies[castle.id].units=Object.fromEntries(types.map(t=>[t,t===type?troops:0]));
 }
 let battle=Game.createBattle({state,sourceId,targetId,mode:options.mode||'siege',controlMode:'turns'});
 for(const[index,unit]of Tactics.deploymentStatus(battle).units.entries()){
  const assigned=Tactics.assignCommander(battle,unit.id,battle.friendlyOfficers[index].id);assert.equal(assigned.ok,true,assigned.message);battle=assigned.battle;
  const placed=Tactics.confirmDeployment(battle,unit.id);assert.equal(placed.ok,true,placed.message);battle=placed.battle;
 }
 battle=Game.startBattle(battle);assert.equal(battle.phase,'fighting',battle.deploymentError);return{state,battle};
}
function advance(battle,orders){
 const old=clone(battle),oldOrders=clone(orders),answer=Auto.advance(battle,orders);
 assert.equal(answer.ok,true,answer.message);assert.deepEqual(clone(battle),old,'planning must not open gates in the input battle');assert.deepEqual(clone(orders),oldOrders);
 assert.equal(answer.battle.turnNumber,battle.turnNumber+1);
 assert.equal(answer.battle.ledger.filter(r=>r.kind==='turn-end').length,battle.ledger.filter(r=>r.kind==='turn-end').length+1);
 const attacks=answer.battle.ledger.slice(battle.ledger.length).filter(r=>r.kind==='turn-order'&&r.command.order==='attack');
 const perUnit=new Map();for(const r of attacks)perUnit.set(r.command.unitId,(perUnit.get(r.command.unitId)||0)+1);
 assert.ok([...perUnit.values()].every(n=>n<=1),'opening a route grants no second attack');
 for(const u of battle.units.filter(u=>u.side===battle.playerSide&&live(u))){
  const after=answer.battle.units.find(v=>v.id===u.id),budget=Tactics.turnView(battle,u.id).selected.movement;
  assert.ok(Math.hypot(after.x-u.x,after.z-u.z)<=budget+.15,'native troop movement budget is retained');
 }
 return answer;
}
function withdraw(state,battle){const end=Tactics.withdrawBattle(battle);assert.equal(end.ok,true,end.message);assert.ok(Tactics.verify(state,end.battle),'route clearing remains a replayable legal battle');return end.battle;}

test('a directly selected enemy behind Muranaka\'s intact gate is approached instead of waiting forever',async()=>{
 let{state,battle}=fixture();const unit=battle.units.find(u=>u.side===battle.playerSide),enemy=battle.units.find(u=>u.side!==battle.playerSide);
 const gate=battle.structures.find(s=>s.kind==='gate'),initial={x:unit.x,z:unit.z};let orders={[unit.id]:{action:'attack',targetId:enemy.id}};
 let answer=advance(battle,orders);battle=answer.battle;orders=answer.orders;
 assert.ok(Math.hypot(battle.units.find(u=>u.id===unit.id).x-initial.x,battle.units.find(u=>u.id===unit.id).z-initial.z)>1,'the first automatic turn marches toward the necessary gate');
 assert.equal(orders[unit.id].targetId,enemy.id,'the intended enemy is never replaced by a standing gate order');
 assert.ok(answer.notices.some(n=>/城門|虎口/.test(n.message)));
 for(let turn=0;turn<35&&battle.phase==='fighting'&&orders[unit.id].action==='attack';turn++){answer=advance(battle,orders);battle=answer.battle;orders=answer.orders;}
 assert.equal(battle.structures.find(s=>s.id===gate.id).hp,0);assert.ok(!live(battle.units.find(u=>u.id===enemy.id)));assert.equal(orders[unit.id].action,'wait');
 const attacks=battle.ledger.filter(r=>r.kind==='turn-order'&&r.command.order==='attack').map(r=>r.command.targetId);
 assert.ok(attacks.includes(gate.id)&&attacks.includes(enemy.id));assert.ok(attacks.indexOf(gate.id)<attacks.indexOf(enemy.id));
 assert.ok(battle.supply.attacker.consumed>0);assert.ok(battle.structures.every(s=>!s.passable||s.kind==='bridge'),'temporary path inspection does not leave castle gates open');
 const finished=withdraw(state,battle);assert.ok(await Tactics.verifyAsync(state,finished));const settled=Game.settle(state,finished);assert.equal(settled.ok,true,settled.message);assert.equal(Game.validate(settled.state),true);assert.equal(Game.save(settled.state),true);assert.ok(Game.load());
});

test('Nanao\'s inner gate can be the first explicit sequence goal while prerequisite gates retain its progress',()=>{
 let{state,battle}=fixture('toyama','nanao',{troops:12000});const unit=battle.units.find(u=>u.side===battle.playerSide),enemy=battle.units.find(u=>u.side!==battle.playerSide);
 const gates=battle.structures.filter(s=>s.kind==='gate').sort((a,b)=>b.z-a.z),inner=gates.at(-1);
 const sequence=[{targetId:inner.id,after:'wait'},{targetId:enemy.id,after:'next'},{targetId:'capture',after:'defend'}];
 let orders={[unit.id]:{action:'attack',targetId:inner.id,sequence,sequenceIndex:0,sequencePaused:false}},sawPrerequisite=false;
 for(let turn=0;turn<45&&battle.phase==='fighting'&&!orders[unit.id].sequencePaused;turn++){
  const answer=advance(battle,orders);battle=answer.battle;orders=answer.orders;
  const first=battle.structures.find(s=>s.id===gates[0].id),last=battle.structures.find(s=>s.id===inner.id);
  if(first.hp===0&&last.hp>0){sawPrerequisite=true;assert.equal(orders[unit.id].sequenceIndex,0);assert.equal(orders[unit.id].targetId,inner.id);}
 }
 assert.equal(sawPrerequisite,true);assert.ok(gates.every(g=>battle.structures.find(s=>s.id===g.id).hp===0));assert.equal(orders[unit.id].sequenceIndex,1);assert.equal(orders[unit.id].sequencePaused,true);assert.equal(orders[unit.id].action,'wait');
 const resting=clone(battle.units.find(u=>u.id===unit.id));let answer=advance(battle,orders);battle=answer.battle;orders=answer.orders;assert.equal(battle.units.find(u=>u.id===unit.id).x,resting.x);assert.equal(battle.units.find(u=>u.id===unit.id).z,resting.z);assert.equal(orders[unit.id].sequencePaused,true);
 orders={[unit.id]:{...orders[unit.id],action:'attack',targetId:enemy.id,sequencePaused:false}};
 for(let turn=0;turn<60&&battle.phase==='fighting';turn++){answer=advance(battle,orders);battle=answer.battle;orders=answer.orders;}
 assert.equal(battle.phase,'finished');assert.equal(battle.winner,battle.playerSide);assert.equal(orders[unit.id].sequenceIndex,3);assert.equal(orders[unit.id].action,'defend');assert.ok(Tactics.verify(state,battle));
});

test('an already selected outer gate is attacked directly and unopened inner gates are not substituted',()=>{
 let{state,battle}=fixture('toyama','nanao',{type:'firearm',troops:12000});const unit=battle.units.find(u=>u.side===battle.playerSide),gates=battle.structures.filter(s=>s.kind==='gate').sort((a,b)=>b.z-a.z);let orders={[unit.id]:{action:'attack',targetId:gates[0].id}};
 for(let i=0;i<20&&orders[unit.id].action==='attack';i++){const a=advance(battle,orders);battle=a.battle;orders=a.orders;}
 assert.equal(battle.structures.find(s=>s.id===gates[0].id).hp,0);assert.ok(gates.slice(1).every(g=>battle.structures.find(s=>s.id===g.id).hp===g.hp));
 assert.ok(battle.ledger.filter(r=>r.kind==='turn-order'&&r.command.order==='attack').every(r=>r.command.targetId===gates[0].id));withdraw(state,battle);
});

test('field orders keep approaching their chosen enemy and never invent a castle prerequisite',()=>{
 let{state,battle}=fixture('kiyosu','inabayama',{mode:'field',troops:6000,enemies:3000});const unit=battle.units.find(u=>u.side===battle.playerSide),enemy=battle.units.find(u=>u.side!==battle.playerSide),initial=clone(unit);let orders={[unit.id]:{action:'attack',targetId:enemy.id}};
 for(let i=0;i<3&&battle.phase==='fighting';i++){const a=advance(battle,orders);battle=a.battle;orders=a.orders;assert.ok(a.notices.every(n=>!/城門|虎口/.test(n.message)));}
 const moved=battle.units.find(u=>u.id===unit.id);assert.ok(Math.hypot(moved.x-initial.x,moved.z-initial.z)>10);assert.equal(orders[unit.id].targetId,enemy.id);withdraw(state,battle);
});

test('the Inabayama garrison exits its intact gate using legal waypoints without attacking its own gate',()=>{
 const state=Game.newGame(),source=state.castles.find(c=>c.id==='kiyosu'),target=state.castles.find(c=>c.id==='inabayama');
 state.playerClan=target.clan;state.alliances=[];state.allianceExpires={};
 for(const[castle,n]of[[source,1500],[target,5000]]){castle.troops=n;state.armies[castle.id].units=Object.fromEntries(types.map(type=>[type,type==='ashigaru'?n:0]));}
 let battle=Tactics.createDefense(state,{sourceId:source.id,targetId:target.id,mode:'siege'},{controlMode:'turns'});
 for(const[index,unit]of Tactics.deploymentStatus(battle).units.entries()){
  let a=Tactics.assignCommander(battle,unit.id,battle.friendlyOfficers[index].id);assert.equal(a.ok,true,a.message);battle=a.battle;
  a=Tactics.confirmDeployment(battle,unit.id);assert.equal(a.ok,true,a.message);battle=a.battle;
 }
 battle=Game.startBattle(battle);assert.equal(battle.phase,'fighting');
 const unit=battle.units.find(u=>u.side===battle.playerSide),enemy=battle.units.find(u=>u.side!==battle.playerSide),start=clone(unit),gates=battle.structures.filter(s=>s.kind==='gate');
 let orders={[unit.id]:{action:'attack',targetId:enemy.id}};
 const first=advance(battle,orders);battle=first.battle;orders=first.orders;
 const moved=battle.units.find(u=>u.id===unit.id);assert.ok(Math.hypot(moved.x-start.x,moved.z-start.z)>1);
 assert.ok(battle.ledger.filter(r=>r.kind==='turn-order'&&r.command.order==='attack').every(r=>r.command.targetId===enemy.id),'defenders never clear their own gate by damaging it');
 assert.ok(gates.every(g=>battle.structures.find(s=>s.id===g.id).hp===g.hp));
 withdraw(state,battle);
});
