'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-auto-battle.js'), 'utf8'), context, { filename: 'tenka-auto-battle.js' });
const Auto = context.TenkaAutoBattle;
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const castle = (state, id) => state.castles.find(item => item.id === id);
const live = unit => unit.troops > 0 && !['routed', 'destroyed'].includes(unit.status);
const friendly = battle => battle.units.filter(unit => unit.side === battle.playerSide && live(unit));
const total = units => Object.values(units).reduce((sum, value) => sum + value, 0);
function army(state, id, numbers) {
  state.armies[id].units = Object.fromEntries(TYPES.map(type => [type, numbers[type] || 0]));
  castle(state, id).troops = total(state.armies[id].units);
}
function muster(input) {
  let battle = input;
  for (const [index, unit] of Tactics.deploymentStatus(battle).units.entries()) {
    if (!unit.foreignSupport) {
      const answer = Tactics.assignCommander(battle, unit.id, battle.friendlyOfficers[index].id);
      assert.equal(answer.ok, true, answer.message); battle = answer.battle;
    }
    const answer = Tactics.confirmDeployment(battle, unit.id);
    assert.equal(answer.ok, true, answer.message); battle = answer.battle;
  }
  battle = Game.startBattle(battle);
  assert.equal(battle.phase, 'fighting', battle.deploymentError);
  return battle;
}
function fixture(mode = 'field', defending = false, options = {}) {
  const state = Game.newGame(), source = options.source || (mode === 'siege' ? 'hinoe' : 'kiyosu');
  const target = options.target || (mode === 'siege' ? 'muranaka' : 'inabayama');
  state.playerClan = castle(state, defending ? target : source).clan;
  army(state, source, options.attacker || (defending ? { ashigaru: 2000 } : { firearm: 12000 }));
  army(state, target, options.defender || (defending ? { firearm: 12000 } : { ashigaru: 40 }));
  const battle = defending ? Tactics.createDefense(state, { sourceId: source, targetId: target, mode }, { controlMode: 'turns' })
    : Game.createBattle({ state, sourceId: source, targetId: target, mode, controlMode: 'turns' });
  return { state, battle };
}
function advance(battle, orders) {
  const before = clone(battle), commandSnapshot = clone(orders);
  const answer = Auto.advance(battle, orders);
  assert.equal(answer.ok, true, answer.message);
  assert.deepEqual(clone(battle), before, 'planning/advancement does not mutate the caller\'s battle');
  assert.deepEqual(clone(orders), commandSnapshot, 'standing orders are immutable input');
  assert.equal(answer.battle.turnNumber, battle.turnNumber + 1, 'one auto call resolves exactly one native turn');
  assert.equal(answer.battle.ledger.filter(item => item.kind === 'turn-end').length,
    battle.ledger.filter(item => item.kind === 'turn-end').length + 1);
  return answer;
}
function withdrawal(battle) {
  const answer = Tactics.withdrawBattle(battle);
  assert.equal(answer.ok, true, answer.message);
  return answer.battle;
}

test('auto never starts deployment, a real-time legacy battle or an already finished battle', () => {
  const { state, battle } = fixture();
  const orders = {};
  assert.equal(Auto.advance(battle, orders).battle, battle);
  assert.equal(Auto.advance(battle, orders).ok, false);
  const legacy = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  assert.equal(Auto.advance(Game.startBattle(legacy), orders).ok, false);
  const finished = withdrawal(muster(battle));
  const before = clone(finished), rejected = Auto.advance(finished, orders);
  assert.equal(rejected.ok, false); assert.equal(rejected.battle, finished); assert.equal(rejected.orders, orders);
  assert.deepEqual(clone(finished), before);
});

test('invalid orders reject the entire turn without spending food, changing plans or issuing partial orders', () => {
  const state = Game.newGame();
  const battle = muster(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', controlMode: 'turns' }));
  const [first, second] = friendly(battle), enemy = battle.units.find(unit => unit.side !== battle.playerSide);
  assert.ok(first && second);
  const bad = [null, [], { bad: { action: 'wait' } }, { [enemy.id]: { action: 'wait' } },
    { [first.id]: { action: 'attack' } }, { [first.id]: { action: 'attack', targetId: second.id } },
    { [first.id]: { action: 'attack', targetId: 'capture' } },
    { [first.id]: { action: 'defend' }, [second.id]: { action: 'move', x: Infinity, z: 0 } },
    { [first.id]: { action: 'defend' }, [second.id]: { action: 'move', x: 9999, z: 0 } }];
  const before = clone(battle);
  for (const orders of bad) {
    const answer = Auto.advance(battle, orders);
    assert.equal(answer.ok, false); assert.equal(answer.battle, battle); assert.equal(answer.orders, orders);
    assert.deepEqual(clone(battle), before);
  }
});

test('player waiting units stay still while the ordinary enemy moves and attacks and supplies are consumed', () => {
  let { state, battle } = fixture('field', false, { defender: { ashigaru: 3000 } });
  battle = muster(battle);
  const initial = clone(battle), unit = friendly(battle)[0], enemy = battle.units.find(item => item.side !== unit.side);
  let orders = { [unit.id]: { action: 'wait' } };
  for (let turn = 0; turn < 10 && battle.phase === 'fighting'; turn++) {
    const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  }
  const after = battle.units.find(item => item.id === unit.id), opposing = battle.units.find(item => item.id === enemy.id);
  assert.equal(after.x, unit.x); assert.equal(after.z, unit.z);
  assert.ok(Math.hypot(opposing.x - enemy.x, opposing.z - enemy.z) > 10, 'waiting does not freeze enemy AI');
  assert.ok(after.troops < unit.troops, 'the enemy can hit waiting troops');
  assert.equal(opposing.troops, enemy.troops, 'a waiting army never substitutes an automatic counterattack');
  assert.ok(battle.supply.attacker.consumed > initial.supply.attacker.consumed);
  const idle = clone(battle);
  for (let i = 0; i < 20; i++) Game.simulateTick(battle);
  assert.deepEqual(clone(battle), idle, 'not calling Auto.advance pauses all real tactical state');
  const finished = withdrawal(battle);
  assert.ok(Tactics.verify(state, finished));
});

test('a unit can switch attack to wait, defend and movement mid-battle; arrival becomes persistent wait', () => {
  let { state, battle } = fixture('field', false, { defender: { firearm: 3000 } });
  battle = muster(battle);
  const unit = friendly(battle)[0], enemy = battle.units.find(item => item.side !== unit.side);
  let result = advance(battle, { [unit.id]: { action: 'attack', targetId: enemy.id } }); battle = result.battle;
  const approaching = battle.units.find(item => item.id === unit.id);
  assert.ok(Math.hypot(approaching.x - unit.x, approaching.z - unit.z) > 0);
  result = advance(battle, { [unit.id]: { action: 'wait' } }); battle = result.battle;
  const waiting = battle.units.find(item => item.id === unit.id);
  assert.equal(waiting.x, approaching.x); assert.equal(waiting.z, approaching.z);
  result = advance(battle, { [unit.id]: { action: 'defend' } }); battle = result.battle;
  assert.equal(battle.units.find(item => item.id === unit.id).stance, 'brace');
  const destination = { x: waiting.x + 1, z: waiting.z + 1 };
  let orders = { [unit.id]: { action: 'move', ...destination } };
  for (let turn = 0; turn < 5 && orders[unit.id].action !== 'wait'; turn++) {
    result = advance(battle, orders); battle = result.battle; orders = result.orders;
  }
  assert.equal(orders[unit.id].action, 'wait');
  assert.ok(result.notices.some(item => item.unitId === unit.id));
  const arrived = clone(battle.units.find(item => item.id === unit.id));
  result = advance(battle, orders); battle = result.battle;
  assert.equal(battle.units.find(item => item.id === unit.id).x, arrived.x);
  assert.equal(battle.units.find(item => item.id === unit.id).z, arrived.z);
  assert.ok(Tactics.verify(state, withdrawal(battle)));
});

test('a named enemy destroyed during auto combat changes that order to wait rather than choosing another enemy', () => {
  let { state, battle } = fixture('field', false, { defender: { ashigaru: 40, archer: 500 } });
  battle = muster(battle);
  const unit = friendly(battle)[0], enemy = battle.units.find(item => item.side !== unit.side && item.type === 'ashigaru');
  let orders = { [unit.id]: { action: 'attack', targetId: enemy.id } }, answer;
  for (let turn = 0; turn < 20 && orders[unit.id].action !== 'wait' && battle.phase === 'fighting'; turn++) {
    answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  }
  assert.equal(orders[unit.id].action, 'wait');
  assert.ok(answer.notices.some(item => /指定目標/.test(item.message)));
  assert.ok(battle.units.some(item => item.side !== unit.side && live(item)), 'other enemy units remain');
  const position = clone(battle.units.find(item => item.id === unit.id));
  answer = advance(battle, orders); battle = answer.battle;
  assert.equal(battle.units.find(item => item.id === unit.id).x, position.x);
  assert.equal(battle.units.find(item => item.id === unit.id).z, position.z);
  assert.ok(Tactics.verify(state, withdrawal(battle)));
});

for (const mode of ['field', 'siege']) for (const defending of [false, true]) {
  test(`auto ${defending ? 'defensive' : 'attacking'} ${mode} keeps native replay, food, settlement and save/load rules`, async () => {
    let { state, battle } = fixture(mode, defending);
    battle = muster(battle);
    const before = clone(state);
    const target = battle.units.find(item => item.side !== battle.playerSide);
    let orders = Object.fromEntries(friendly(battle).map(unit => [unit.id, { action: 'attack', targetId: mode === 'siege' && !defending ? 'capture' : target.id }]));
    for (let turn = 0; turn < 180 && battle.phase === 'fighting'; turn++) {
      const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    }
    assert.equal(battle.phase, 'finished'); assert.equal(battle.winner, battle.playerSide);
    assert.ok(Tactics.verify(state, battle)); assert.ok(await Tactics.verifyAsync(state, battle));
    assert.ok(battle.ledger.filter(item => item.kind === 'turn-order').length);
    assert.ok(battle.ledger.every(item => ['deploy', 'start', 'turn-order', 'turn-end'].includes(item.kind)), 'no privileged auto/realtime records bypass validation');
    const report = Game.report(battle);
    assert.equal(report.supplyConsumed, Math.ceil(battle.supply[battle.playerSide].consumed));
    const settled = Game.settle(state, battle);
    assert.equal(settled.ok, true, settled.message); assert.equal(Game.validate(settled.state), true);
    assert.equal(Game.validate(clone(settled.state)), true);
    assert.equal(Game.settle(settled.state, battle).ok, false);
    assert.deepEqual(clone(state), before);
    const altered = clone(battle); altered.units.find(item => item.side === battle.playerSide).troops++;
    assert.equal(Tactics.verify(state, altered), null);
    if (mode === 'siege' && !defending) assert.ok(battle.structures.filter(item => item.kind === 'gate').every(item => item.hp === 0));
  });
}

test('auto march detours around a rotated palisade and never exceeds troop movement budgets', () => {
  let { state, battle } = fixture('field', false, { defender: { firearm: 3000 } });
  const unit = Tactics.deploymentStatus(battle).units[0];
  const placed = Tactics.placeFortification(battle, { kind: 'palisade', x: unit.x, z: unit.z - 4, rotation: 15 });
  assert.equal(placed.ok, true, placed.message);
  battle = muster(placed.battle);
  const destination = { x: unit.x, z: unit.z - 11 };
  let orders = { [unit.id]: { action: 'move', ...destination } };
  for (let turn = 0; turn < 20 && orders[unit.id].action !== 'wait'; turn++) {
    const before = battle.units.find(item => item.id === unit.id), budget = Tactics.turnView(battle, unit.id).selected.movement;
    const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    const after = battle.units.find(item => item.id === unit.id);
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) <= budget + .01);
    assert.equal(Tactics.fortificationContains(battle.fortifications[0], after.x, after.z, .4), false);
  }
  assert.equal(orders[unit.id].action, 'wait', 'the route goes around stakes rather than stalling on them');
  assert.ok(Tactics.verify(state, withdrawal(battle)));
});

test('naval standing orders cannot march onto land and legal sea movement conserves its troops', () => {
  let { state, battle } = fixture('field', false, { source: 'sunpu', target: 'odawara', attacker: { navy: 3000 }, defender: { ashigaru: 1000 } });
  battle = muster(battle);
  const unit = friendly(battle)[0], before = clone(battle), box = battle.layout.bounds;
  assert.equal(unit.type, 'navy');
  const denied = Auto.advance(battle, { [unit.id]: { action: 'move', x: 0, z: 20 } });
  assert.equal(denied.ok, false); assert.equal(denied.battle, battle); assert.deepEqual(clone(battle), before);
  let answer;
  for (const dz of [3, -3, 1, -1]) {
    const z = Math.max(box.minZ + 1, Math.min(box.maxZ - 1, unit.z + dz));
    answer = Auto.advance(battle, { [unit.id]: { action: 'move', x: unit.x, z } });
    if (answer.ok) break;
  }
  assert.equal(answer.ok, true, answer.message);
  assert.equal(answer.battle.units.find(item => item.id === unit.id).troops, unit.troops);
  assert.ok(Tactics.verify(state, withdrawal(answer.battle)));
});

for (const [source, target] of [['toyama', 'nanao'], ['kiyosu', 'kannonji'], ['sunpu', 'odawara']]) {
  test(`capture follows ${target}'s own approaches and clears every gate without a range-edge stall`, () => {
    let { state, battle } = fixture('siege', false, { source, target });
    battle = muster(battle);
    let orders = Object.fromEntries(friendly(battle).map(unit => [unit.id, { action: 'attack', targetId: 'capture' }]));
    for (let turn = 0; turn < 60 && battle.phase === 'fighting'; turn++) {
      const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    }
    assert.equal(battle.phase, 'finished'); assert.equal(battle.winner, 'attacker');
    assert.ok(battle.structures.filter(item => item.kind === 'gate').every(item => item.hp === 0));
    assert.ok(Tactics.verify(state, battle));
  });
}

test('inactive troops are skipped and inherited map entries cannot issue unvalidated commands', () => {
  let { state, battle } = fixture(); battle = muster(battle);
  const unit = friendly(battle)[0];
  const inherited = Object.create({ [unit.id]: { action: 'retreat' } });
  const answer = Auto.advance(battle, inherited);
  assert.equal(answer.ok, true); assert.equal(answer.orders[unit.id].action, 'wait');
  assert.equal(answer.battle.units.find(item => item.id === unit.id).x, unit.x);
  const inactive = clone(battle), retired = inactive.units.find(item => item.id === unit.id);
  retired.status = 'routed'; retired.troops = 0;
  const skipped = Auto.advance(inactive, { [unit.id]: { action: 'wait' } });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.battle.ledger.filter(item => item.kind === 'turn-order').length, inactive.ledger.filter(item => item.kind === 'turn-order').length);
  assert.equal(skipped.battle.units.find(item => item.id === unit.id).troops, 0);
  assert.ok(Tactics.verify(state, withdrawal(answer.battle)));
});
