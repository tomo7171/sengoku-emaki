'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

const engine = runtime();
const { Game, Systems, Dynasty } = engine;
const person = (state, id) => state.officers.find(o => o.id === id);
const fate = (state, id) => state.lastBattle.officerOutcomes.find(o => o.officerId === id);

function persist(state) {
  assert.equal(Game.validate(state), true, 'the shipped save validator accepts the aftermath');
  assert.equal(Game.save(state), true, 'the shipped save writer stores the aftermath');
  const loaded = Game.load();
  assert.ok(loaded, 'the shipped loader restores the aftermath');
  return loaded;
}

function finish(battle) {
  battle = Game.startBattle(battle);
  for (let batch = 0; batch < 400 && battle.phase === 'fighting'; batch++) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished', 'the real tactical simulation reaches a result');
  return battle;
}

function finalHolding() {
  const state = Game.newGame();
  // Concentrate the remaining Imagawa retainers in their final stronghold.
  // Clearing their former army commands keeps this a valid campaign fixture.
  for (const castle of state.castles.filter(c => c.clan === 'imagawa' && c.id !== 'narumi')) {
    castle.clan = 'oda'; castle.clanName = Game.clans.oda.name; castle.color = Game.clans.oda.color;
    state.armies[castle.id].commanderId = null;
    for (const officer of state.officers.filter(o => o.castleId === castle.id)) officer.castleId = 'narumi';
  }
  const target = state.castles.find(c => c.id === 'narumi');
  Object.assign(target, { troops: 100, defense: 10, morale: 10 });
  state.armies.narumi.units = { ashigaru: 100, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  state.castles.find(c => c.id === 'kiyosu').troops = 8000;
  state.armies.kiyosu.units = { ashigaru: 2000, archer: 1000, cavalry: 1000, firearm: 4000, navy: 0 };
  // Keep unrelated AI wars from obscuring the battle under examination.
  const clans = [...new Set(state.castles.map(c => c.clan))];
  state.alliances = clans.filter(id => !['oda', 'imagawa'].includes(id));
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 4]));
  state.npcPacts = [];
  for (let i = 0; i < clans.length; i++) for (let j = i + 1; j < clans.length; j++) {
    if (clans[i] !== 'oda' && clans[j] !== 'oda') state.npcPacts.push([clans[i], clans[j]]);
  }
  assert.equal(Game.validate(state), true, 'the pre-battle fixture is a valid campaign');
  return state;
}

function captureCampaign() {
  const before = finalHolding();
  const battle = finish(Game.createBattle({ state: before, sourceId: 'kiyosu', targetId: 'narumi', mode: 'siege' }));
  assert.equal(Game.report(battle).won, true, 'the overwhelming force wins the siege');
  const settled = Game.settle(before, battle);
  assert.equal(settled.ok, true, settled.message);
  return { before, state: settled.state };
}

function hash(text) {
  let value = 2166136261;
  for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
  return value;
}

function battleIdFor(officerId, min, max) {
  // Search only the deterministic fate seed, never rerun combat to obtain a death.
  for (let n = 0; n < 100000; n++) {
    const id = 'aftermath-' + n, roll = hash(`fate:${id}:${officerId}`) % 10000;
    if (roll >= min && roll < max) return id;
  }
  assert.fail('a deterministic fate seed must exist');
}

test('a real last-holding siege records every core-captured retainer and persists the personnel report once', () => {
  const { before, state } = captureCampaign();
  const defenders = before.officers.filter(o => o.clan === 'imagawa' && o.castleId === 'narumi' && o.status === 'active');
  assert.ok(defenders.length > 1, 'test the whole garrison rather than only its commander');
  for (const defender of defenders) {
    const current = person(state, defender.id), recorded = fate(state, defender.id);
    assert.equal(current.status, 'captive', defender.name + ' was captured by the core siege settlement');
    assert.equal(current.capturedBy, 'oda');
    assert.equal(recorded.outcome, 'captured', defender.name + ' has an individual battle fate');
    assert.equal(recorded.side, 'defender');
    assert.equal(recorded.capturedBy, 'oda');
    assert.equal(state.tenka.casualties.filter(c => c.officerId === defender.id && c.battleId === state.lastBattle.id && c.cause === 'captured').length, 1);
    assert.ok(Object.values(state.armies).every(a => a.commanderId !== defender.id), 'captives cannot remain army commanders');
  }
  assert.equal(fate(state, 'oda_nobunaga').outcome, 'survived');
  assert.equal(new Set(state.lastBattle.officerOutcomes.map(o => o.officerId)).size, state.lastBattle.officerOutcomes.length);
  const loaded = persist(state), recorded = clone(loaded.lastBattle.officerOutcomes);
  assert.deepEqual(clone(loaded.lastBattle.officerOutcomes), clone(state.lastBattle.officerOutcomes));
  const repeated = Systems.afterBattle(loaded, before);
  assert.deepEqual(clone(repeated.lastBattle.officerOutcomes), recorded, 'reprocessing never rerolls an individual fate');
  assert.deepEqual(clone(repeated.tenka.casualties), clone(loaded.tenka.casualties), 'reprocessing never duplicates captures');
  assert.equal(repeated.food, loaded.food, 'reprocessing never charges battle supplies again');
  assert.deepEqual(clone(state.tenka.pendingCaptures), [], 'the actual core capture snapshot is consumed during settlement');
});

test('successive AI sieges attribute a retreating garrison to its actual later capture and preserve treatment links', () => {
  const rules = require('../tenka-systems.js');
  const castle = (id, clan) => ({ id,name:id,clan,clanName:clan,terrain:'plain',population:10000,
    kokudaka:10000,troops:1000,morale:80,food:10000,gold:1000 });
  const officer = (id,clan,castleId) => ({ id,name:id,clan,castleId,status:'active',capturedBy:null,
    birth:1530,leadership:80,intelligence:80,politics:80 });
  const before = rules.initialize({ year:1560,season:0,turn:1,aiRound:0,playerClan:'mori',selectedCastleId:'source-a',
    actionPoints:3,gold:4000,food:10000,prestige:40,gameOver:false,logs:[],nextLogId:1,
    castles:[castle('source-a','mori'),castle('source-b','mori'),castle('a','amago'),castle('b','amago')],
    officers:[officer('mori-a','mori','source-a'),officer('mori-b','mori','source-b'),
      officer('retreating-a','amago','a'),officer('defender-b','amago','b')],
    armies:{},alliances:[],allianceExpires:{},relations:{amago:-30},npcPacts:[] });
  const input = clone(before);
  input.aiRound = 1;
  const report = (id,sourceId,targetId,commanderId) => ({ id,sourceId,targetId,attackerClan:'mori',defenderClan:'amago',
    won:true,mode:'siege',attackerArmy:{troops:1000,commanderId:sourceId==='source-a'?'mori-a':'mori-b'},
    defenderArmy:{troops:1000,commanderId},casualties:100,enemyCasualties:900 });
  // The core moves A's defenders to surviving B before the second independent
  // attack. Both battle reports are only processed after the whole AI round.
  const firstGarrison = clone(input.officers.filter(o => o.castleId === 'a'));
  person(input,'retreating-a').castleId = 'b';
  input.castles.find(c => c.id === 'a').clan = 'mori';
  rules.recordCapture(input,{targetId:'a',defenderClan:'amago',winnerClan:'mori',before:firstGarrison});
  const secondGarrison = clone(input.officers.filter(o => o.castleId === 'b'));
  for (const o of input.officers.filter(o => o.castleId === 'b')) Object.assign(o,{status:'captive',castleId:null,capturedBy:'mori'});
  input.castles.find(c => c.id === 'b').clan = 'mori';
  rules.recordCapture(input,{targetId:'b',defenderClan:'amago',winnerClan:'mori',before:secondGarrison});
  input.aiBattles = [report('fall-a','source-a','a','retreating-a'),report('fall-b','source-b','b','defender-b')];
  input.lastBattle = clone(input.aiBattles[1]);
  const sourceSnapshot = clone(input);
  const result = rules.afterBattle(input,before);
  assert.deepEqual(clone(input),sourceSnapshot,'battle settlement leaves its input and pending snapshots unchanged');
  const first = result.aiBattles.find(b => b.id === 'fall-a'), second = result.aiBattles.find(b => b.id === 'fall-b');
  assert.equal(first.officerOutcomes.find(o => o.officerId === 'retreating-a').outcome,'retreated');
  assert.equal(second.officerOutcomes.find(o => o.officerId === 'retreating-a').outcome,'captured');
  assert.equal(second.officerOutcomes.find(o => o.officerId === 'defender-b').outcome,'captured');
  assert.deepEqual(clone(result.lastBattle.officerOutcomes),clone(second.officerOutcomes),'duplicate lastBattle retains the same local report');
  assert.deepEqual(result.tenka.casualties.filter(o => o.officerId === 'retreating-a').map(o => o.battleId),['fall-b']);
  assert.deepEqual(clone(result.tenka.pendingCaptures),[]);
  const repeated = rules.afterBattle(JSON.parse(JSON.stringify(result)),before);
  assert.deepEqual(clone(repeated.tenka.casualties),clone(result.tenka.casualties),'a reload and reprocessing cannot reassign the capture');
  assert.deepEqual(clone(repeated.aiBattles),clone(result.aiBattles));
  const released = rules.act(result,{type:'release',officerId:'mori-a',targetOfficerId:'retreating-a'});
  assert.equal(released.ok,true,released.message);
  assert.equal(released.state.tenka.prisonerDecisions[0].battleId,'fall-b','treatment links to the actual capture, not the earlier retreat');
});

test('a field victory or failed player siege cannot claim a later third-party AI capture', () => {
  const rules = require('../tenka-systems.js');
  const castle = (id,clan) => ({id,name:id,clan,clanName:clan,terrain:'plain',population:10000,kokudaka:10000,troops:1000,morale:80,food:10000});
  const officer = (id,clan,castleId) => ({id,name:id,clan,castleId,status:'active',capturedBy:null,birth:1530,leadership:80,intelligence:80,politics:80});
  for (const [mode,won,outcome] of [['field',true,'retreated'],['siege',false,'survived']]) {
    const before = rules.initialize({year:1560,season:0,turn:1,aiRound:0,playerClan:'mori',selectedCastleId:'player',
      actionPoints:3,gold:4000,food:10000,prestige:40,gameOver:false,logs:[],nextLogId:1,
      castles:[castle('player','mori'),castle('third-party','hojo'),castle('target','amago')],
      officers:[officer('player-lord','mori','player'),officer('third-party-lord','hojo','third-party'),officer('defender','amago','target')],
      armies:{},alliances:[],allianceExpires:{},relations:{amago:-30},npcPacts:[]});
    const input = clone(before), defendingGarrison = clone(input.officers.filter(o=>o.castleId==='target'));
    input.aiRound=1;
    Object.assign(person(input,'defender'),{status:'captive',castleId:null,capturedBy:'hojo'});
    input.castles.find(c=>c.id==='target').clan='hojo';
    rules.recordCapture(input,{targetId:'target',defenderClan:'amago',winnerClan:'hojo',before:defendingGarrison});
    const report = (id,sourceId,attackerClan,commanderId,reportMode,reportWon) => ({id,sourceId,targetId:'target',attackerClan,defenderClan:'amago',
      won:reportWon,mode:reportMode,attackerArmy:{troops:1000,commanderId},defenderArmy:{troops:1000,commanderId:'defender'},casualties:100,enemyCasualties:100});
    input.lastBattle=report('player-'+mode,'player','mori','player-lord',mode,won);
    input.aiBattles=[report('later-ai-capture','third-party','hojo','third-party-lord','siege',true)];
    const result=rules.afterBattle(input,before);
    assert.equal(result.lastBattle.officerOutcomes.find(o=>o.officerId==='defender').outcome,outcome,mode+': original field or failed siege fate is preserved');
    assert.equal(result.aiBattles[0].officerOutcomes.find(o=>o.officerId==='defender').outcome,'captured');
    assert.equal(result.aiBattles[0].officerOutcomes.find(o=>o.officerId==='defender').capturedBy,'hojo');
    assert.deepEqual(result.tenka.casualties.filter(o=>o.officerId==='defender').map(o=>o.battleId),['later-ai-capture']);
    const repeated=rules.afterBattle(JSON.parse(JSON.stringify(result)),before);
    assert.deepEqual(clone(repeated.lastBattle),clone(result.lastBattle));
    assert.deepEqual(clone(repeated.tenka.casualties),clone(result.tenka.casualties));
  }
});

test('deterministic commander death and capture record distinct fates, clear commands and tasks, and remain idempotent', () => {
  const source = captureCampaign();
  for (const [outcome, min, max] of [['killed', 0, 100], ['captured', 100, 900]]) {
    const before = finalHolding(), input = clone(before), officerId = 'okabe_motonobu';
    const report = clone(source.state.lastBattle);
    report.id = battleIdFor(officerId, min, max);
    report.enemyCasualties = 90; report.remainingDefenders = 10;
    input.lastBattle = report; input.aiBattles = [];
    input.tenka.assignments[officerId] = { turn: input.turn, type: 'reclaim' };
    // Include a deployed commander who was not stationed in either battle castle.
    report.deployedCommanders = [{ officerId: 'oda_nobukiyo', side: 'attacker' }];
    const after = Systems.afterBattle(input, before), current = person(after, officerId);
    assert.equal(fate(after, officerId).outcome, outcome);
    assert.equal(current.status, outcome === 'killed' ? 'dead' : 'captive');
    assert.equal(current.castleId, null);
    assert.equal(current.capturedBy, outcome === 'captured' ? 'oda' : null);
    assert.ok(Object.values(after.armies).every(a => a.commanderId !== officerId));
    assert.equal(after.tenka.assignments[officerId], undefined);
    assert.equal(fate(after, 'oda_nobukiyo').outcome, 'survived', 'deployed commanders outside the source garrison appear in the report');
    assert.equal(after.tenka.casualties.filter(c => c.officerId === officerId && c.battleId === report.id).length, 1);
    if (outcome === 'killed') {
      assert.equal(current.deathYear, before.year);
      assert.equal(current.diedAtAge, before.year - current.birth);
      assert.equal(current.deathCause, 'battle');
      assert.equal(after.tenka.dynasty.deaths.filter(d => d.officerId === officerId).length, 1);
    }
    const again = Systems.afterBattle(after, before);
    assert.deepEqual(clone(again.tenka.casualties), clone(after.tenka.casualties));
    assert.deepEqual(clone(again.lastBattle.officerOutcomes), clone(after.lastBattle.officerOutcomes));
    persist(after);
  }
});

test('releasing a captive changes current employment while preserving the battle fate and decision through reload', () => {
  const { state } = captureCampaign(), snapshot = clone(state.lastBattle.officerOutcomes);
  const result = Systems.act(state, { type: 'release', officerId: 'shibata_katsuie', targetOfficerId: 'okabe_motonobu' });
  assert.equal(result.ok, true, result.message);
  const loaded = persist(result.state), released = person(loaded, 'okabe_motonobu');
  assert.equal(released.status, 'ronin', 'a captive whose old house has no land becomes a ronin');
  assert.equal(released.castleId, null); assert.equal(released.capturedBy, null);
  assert.deepEqual(clone(loaded.lastBattle.officerOutcomes), snapshot, 'treatment does not rewrite who was captured in battle');
  const decision = loaded.tenka.prisonerDecisions.find(d => d.officerId === released.id);
  assert.equal(decision.battleId, state.lastBattle.id);
  assert.equal(decision.type, 'release'); assert.equal(decision.outcome, 'success');
  assert.equal(decision.year, state.year); assert.equal(decision.season, state.season);
  assert.equal(decision.message, result.message);
  const repeated = Systems.act(loaded, { type: 'release', officerId: 'niwa_nagahide', targetOfficerId: released.id });
  assert.equal(repeated.ok, false, 'a former captive cannot be released twice');
  assert.equal(repeated.state, loaded);
});

test('successful and refused recruitment both persist a battle-linked treatment result', () => {
  const { state } = captureCampaign();
  for (const expected of ['success', 'failure']) {
    const input = clone(state), delegate = person(input, 'shibata_katsuie');
    input.prestige = expected === 'success' ? 100 : 0;
    delegate.politics = delegate.intelligence = expected === 'success' ? 100 : 20;
    input.tenka.loyalty.okabe_motonobu = expected === 'success' ? 0 : 100;
    const result = Systems.act(input, { type: 'enlist', officerId: delegate.id, targetOfficerId: 'okabe_motonobu' });
    assert.equal(result.ok, true, result.message);
    const loaded = persist(result.state), prisoner = person(loaded, 'okabe_motonobu');
    const decision = loaded.tenka.prisonerDecisions.find(d => d.officerId === prisoner.id);
    assert.equal(decision.type, 'enlist'); assert.equal(decision.outcome, expected);
    assert.equal(decision.battleId, state.lastBattle.id);
    assert.equal(fate(loaded, prisoner.id).outcome, 'captured');
    assert.equal(prisoner.status, expected === 'success' ? 'active' : 'captive');
    assert.equal(prisoner.clan, expected === 'success' ? 'oda' : 'imagawa');
  }
});

test('execution records the actual death year and fixed age rather than aging the deceased in later saves', () => {
  const { state } = captureCampaign(), targetId = 'okabe_motonobu';
  const result = Systems.act(state, { type: 'execute', officerId: 'shibata_katsuie', targetOfficerId: targetId });
  assert.equal(result.ok, true, result.message);
  const dead = person(result.state, targetId), ageAtDeath = state.year - dead.birth;
  assert.equal(dead.status, 'dead'); assert.equal(dead.deathYear, state.year);
  assert.equal(dead.death, state.year); assert.equal(dead.deathSeason, state.season);
  assert.equal(dead.diedAtAge, ageAtDeath); assert.equal(dead.deathCause, 'execution');
  assert.equal(fate(result.state, targetId).outcome, 'captured', 'execution remains a treatment after the capture');
  assert.equal(result.state.tenka.prisonerDecisions[0].type, 'execute');
  const later = clone(result.state);
  later.year += 30; later.turn += 360;
  later.allianceExpires = Object.fromEntries(later.alliances.map(id => [id, later.turn + 12]));
  const loaded = persist(Game.migrate(later));
  assert.equal(Dynasty.age(loaded, person(loaded, targetId)), ageAtDeath);
  assert.equal(person(loaded, targetId).deathYear, state.year);
  assert.equal(loaded.tenka.dynasty.deaths.filter(d => d.officerId === targetId).length, 1);
  assert.equal(fate(loaded, targetId).outcome, 'captured');
});

test('final victory permits all prisoner treatments with zero commands and a busy delegate; defeat blocks them', () => {
  const { state } = captureCampaign();
  for (const type of ['release', 'enlist', 'execute']) {
    const input = clone(state);
    input.gameOver = true; input.winner = input.playerClan; input.actionPoints = 0;
    for (const castle of input.castles.filter(item => item.clan === input.playerClan)) {
      input.tenka.castleOrders.castles[castle.id].remaining = 0;
    }
    const commandsBefore = clone(input.tenka.castleOrders);
    input.tenka.assignments.shibata_katsuie = { turn: input.turn, type: 'reclaim' };
    const result = Systems.act(input, { type, officerId: 'shibata_katsuie', targetOfficerId: 'okabe_motonobu' });
    assert.equal(result.ok, true, type + ': ' + result.message);
    assert.equal(result.state.actionPoints, 0, 'post-victory treatment cannot consume a nonexistent command');
    assert.deepEqual(clone(result.state.tenka.castleOrders), commandsBefore, 'free post-victory treatment leaves every castle command budget unchanged');
    assert.equal(result.state.tenka.prisonerDecisions[0].type, type);
    const defeated = clone(input); defeated.winner = 'imagawa';
    const rejected = Systems.act(defeated, { type, officerId: 'shibata_katsuie', targetOfficerId: 'okabe_motonobu' });
    assert.equal(rejected.ok, false, 'a defeated campaign cannot decide enemy prisoners\' treatment');
    assert.equal(rejected.state, defeated, 'defeat rejection preserves the campaign');
  }
});
