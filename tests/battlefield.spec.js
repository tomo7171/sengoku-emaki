'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

const env = runtime();
if (!env.context.TenkaBattlefield) vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-battlefield.js'), 'utf8'), env.context);
const { Game, Tactics } = env, Battlefield = env.context.TenkaBattlefield;
function create(mode = 'field') {
  const state = Game.newGame();
  if (mode === 'defense') {
    state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' };
    return { state, battle: Tactics.createDefense(state) };
  }
  return { state, battle: Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode }) };
}
function finish(battle) {
  battle = Game.startBattle(battle);
  for (let batches = 0; battle.phase === 'fighting' && batches < 450; batches++) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished', 'the expanded battlefield must reach a result');
  return battle;
}
function garrison(state, id, count) {
  state.castles.find(item => item.id === id).troops = count;
  state.armies[id].units = { ashigaru: count, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
}

test('the larger battlefield preserves castle coordinates, water and capture rules while exposing actual countryside', () => {
  const { state, battle } = create('siege');
  const legacy = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'siege', battlefieldVersion: 0 });
  assert.equal(battle.battlefieldVersion, 1);
  assert.deepEqual(clone(battle.structures.filter(item => !item.landscape)), clone(legacy.structures));
  assert.deepEqual(clone(battle.captureZone), clone(legacy.captureZone));
  assert.deepEqual(clone(battle.layout.baileys), clone(legacy.layout.baileys));
  const oldArea = (legacy.layout.bounds.maxX - legacy.layout.bounds.minX) * (legacy.layout.bounds.maxZ - legacy.layout.bounds.minZ);
  const box = battle.layout.bounds;
  assert.equal((box.maxX - box.minX) * (box.maxZ - box.minZ), oldArea * 4);
  assert.ok(battle.layout.landscape.fields.length >= 12);
  assert.ok(battle.layout.landscape.settlements.some(item => item.kind === 'town'));
  assert.ok(battle.layout.landscape.settlements.filter(item => item.kind === 'village').length >= 2);
  assert.equal(battle.layout.landscape.crossings.length, 4);
  assert.ok(battle.layout.water.some(item => item.landscape && item.type === 'river'));
  assert.equal(battle.structures.filter(item => item.landscape).every(item => item.passable && item.hp === 0 && item.kind === 'bridge'), true);
  for (let z = -50; z <= 42; z += 2) for (let x = -44; x <= 44; x += 2) assert.equal(Battlefield.elevationDelta(battle.layout, x, z), 0, 'the original castle ground stays exactly the same');
  assert.ok(Battlefield.elevationDelta(battle.layout, -71, -76) > 20);
  assert.ok(Battlefield.elevationDelta(battle.layout, -66, -25) < -3);
  for (const feature of battle.layout.landscape.forests) assert.ok(battle.terrainFeatures.some(item => item.type === 'forest' && item.id === feature.id && item.x === feature.x && item.radius === feature.radius));
  const snapshot = JSON.stringify(battle);
  Battlefield.apply(battle);
  assert.equal(JSON.stringify(battle), snapshot, 'preparing a battle twice cannot duplicate rivers, bridges or settlements');
});

for (const mode of ['field', 'siege', 'defense']) {
  test(`${mode}: the player can deploy across the extended home ground, with bounds, river and house checks`, () => {
    const { battle } = create(mode), side = battle.playerSide;
    const unit = battle.units.find(item => item.side === side && item.type !== 'navy');
    const zone = Tactics.deploymentZone(battle);
    assert.equal(zone.xMin, -87); assert.equal(zone.xMax, 87);
    const location = mode === 'defense' ? { x: -82, z: -87 } : { x: 82, z: 76 };
    let answer = Tactics.deploy(battle, { unitId: unit.id, ...location });
    assert.equal(answer.ok, true, answer.message);
    assert.equal(answer.battle.units.find(item => item.id === unit.id).x, location.x);
    assert.equal(Tactics.deploy(battle, { unitId: unit.id, x: 89, z: location.z }).ok, false);
    const river = mode === 'defense' ? { x: 65, z: -48 } : { x: 64, z: 15 };
    assert.equal(Tactics.deploy(battle, { unitId: unit.id, ...river }).ok, false, 'uncrossable river is not valid deployment land');
    if (mode !== 'defense') {
      const house = battle.layout.landscape.settlements[0].houses[0];
      // The town spans both sides of z=10; select one in the attacker half.
      const ownHouse = battle.layout.landscape.settlements[0].houses.find(item => item.z >= 10);
      assert.ok(house && ownHouse);
      assert.equal(Tactics.deploy(battle, { unitId: unit.id, x: ownHouse.x, z: ownHouse.z }).ok, false, 'troops cannot stand inside village houses');
      assert.equal(Tactics.placeFortification(battle, { kind: 'camp', x: ownHouse.x, z: ownHouse.z }).ok, false);
    }
    const started = Game.startBattle(answer.battle);
    assert.equal(Tactics.deploy(started, { unitId: unit.id, ...location }).ok, false, 'deployment still ends only at the explicit start');
    assert.equal(Tactics.order(started, { unitId: unit.id, order: 'move', ...location }).ok, true, 'orders can target the full extended battlefield');
    assert.equal(Tactics.order(started, { unitId: unit.id, order: 'move', ...river }).ok, false, 'movement cannot target impassable river water');
  });
}

test('actual troops route across bridges and fords from both river banks without entering deep water', () => {
  for (const [from, to] of [[{ x: 46, z: 12 }, { x: 79, z: 12 }], [{ x: 79, z: -45 }, { x: 45, z: -45 }]]) {
    let { battle } = create();
    const unit = battle.units.find(item => item.side === 'attacker' && item.type === 'ashigaru');
    Object.assign(unit, { ...from, order: 'move', targetX: to.x, targetZ: to.z });
    const core = Tactics.install({});
    let ticks = 0, usedCrossing = false;
    while (Math.hypot(unit.x - to.x, unit.z - to.z) > .9 && ticks++ < 700) {
      core.move(battle, unit, to.x, to.z);
      if (battle.layout.landscape.rivers.some(item => Battlefield.inside(unit.x, unit.z, item.polygon))) {
        assert.ok(battle.layout.landscape.crossings.some(item => Battlefield.inFootprint(item, unit.x, unit.z, 0)), 'river movement uses a bridge or ford footprint');
        usedCrossing = true;
      }
      assert.equal(!!Battlefield.buildingAt(battle.layout, unit.x, unit.z), false);
    }
    assert.ok(ticks < 700, `reachable target on opposite bank, stopped at ${unit.x},${unit.z}`);
    assert.ok(usedCrossing, 'the test really crosses the water rather than staying on one bank');
  }
});

test('town houses remain solid while land troops find the open street around them', () => {
  const { battle } = create(), core = Tactics.install({});
  const unit = battle.units.find(item => item.side === 'attacker' && item.type === 'ashigaru');
  Object.assign(unit, { x: -82, z: 4, order: 'move' });
  let steps = 0, detoured = false;
  while (Math.hypot(unit.x + 50, unit.z - 4) > .9 && steps++ < 300) {
    core.move(battle, unit, -50, 4);
    assert.equal(!!Battlefield.buildingAt(battle.layout, unit.x, unit.z, 0), false);
    if (Math.abs(unit.z - 4) > 1.6) detoured = true;
  }
  assert.ok(steps < 300, 'a road through a settlement remains reachable');
  assert.ok(detoured, 'marchers actually avoid the solid houses');
});

test('coastal countryside shares one expanded sea polygon with land and naval deployment rules', () => {
  const state = Game.newGame(), target = state.castles.find(item => item.id === 'odawara'), source = state.castles.find(item => item.id === target.neighbors[0]);
  state.playerClan = source.clan; state.alliances = [];
  if (target.clan === source.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  source.coastal = true; source.troops = 6000;
  state.armies[source.id].units = { ashigaru: 4000, archer: 0, cavalry: 0, firearm: 0, navy: 2000 };
  const battle = Game.createBattle({ state, sourceId: source.id, targetId: target.id, mode: 'siege' });
  assert.equal(battle.layout.landscape.coastal, true);
  const sea = battle.layout.water.find(item => item.type === 'sea');
  assert.ok(Battlefield.inside(-82, 76, sea.polygon));
  assert.equal(Math.max(...sea.polygon.map(point => point[0])), -32, 'the historic game coast stays in place');
  const foot = battle.units.find(item => item.side === 'attacker' && item.type === 'ashigaru'), navy = battle.units.find(item => item.side === 'attacker' && item.type === 'navy');
  assert.ok(foot && navy);
  assert.equal(Tactics.deploy(battle, { unitId: foot.id, x: -82, z: 76 }).ok, false, 'the newly visible sea is also impassable to land troops');
  assert.equal(Tactics.deploy(battle, { unitId: navy.id, x: -82, z: 76 }).ok, true, 'the expanded sea is actually available to naval units');
  for (const town of battle.layout.landscape.settlements) for (const house of town.houses) assert.equal(Battlefield.inside(house.x, house.z, sea.polygon), false);
  for (const field of battle.layout.landscape.fields) assert.equal(Battlefield.inside(field.x, field.z, sea.polygon), false);
});

test('a far-bank player deployment resolves an actual battle, verifies its ledger and settles supplies once', () => {
  const { state } = create();
  garrison(state, 'kiyosu', 12000); garrison(state, 'inabayama', 300);
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  const own = battle.units.filter(item => item.side === 'attacker');
  for (let i = 0; i < own.length; i++) {
    const answer = Tactics.deploy(battle, { unitId: own[i].id, x: 78 + i % 2 * 5, z: 13 + Math.floor(i / 2) * 2 });
    assert.equal(answer.ok, true, answer.message); battle = answer.battle;
  }
  battle = finish(battle);
  assert.equal(battle.winner, 'attacker', 'automatic pursuit crosses the river instead of stalling on its bank');
  assert.ok(Tactics.verify(state, battle), 'landscape routing replays deterministically');
  const answer = Game.settle(state, battle), report = Game.report(battle);
  assert.equal(answer.ok, true, answer.message);
  assert.equal(answer.state.food, state.food - 600 - report.supplyConsumed);
  const altered = clone(battle); altered.layout.landscape.crossings[0].w += 1;
  assert.equal(Tactics.verify(state, altered), null, 'landscape geometry cannot be altered to forge settlement');
});

test('a completed pre-expansion battle keeps its old map and remains verifiable', () => {
  const { state } = create();
  const battle = finish(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', battlefieldVersion: 0 }));
  assert.equal(battle.battlefieldVersion, undefined);
  assert.equal(battle.layout.landscape, undefined);
  assert.ok(Tactics.verify(state, battle));
  assert.equal(Game.settle(state, battle).ok, true);
});

test('wet paddies slow actual marching troops and village cover reduces ranged fire', () => {
  const { battle } = create(), core = Tactics.install({}), open = clone(battle);
  const field = battle.layout.landscape.fields.find(item => item.kind === 'paddy');
  const unit = battle.units.find(item => item.side === 'attacker' && item.type === 'ashigaru'), other = open.units.find(item => item.id === unit.id);
  Object.assign(unit, { x: field.x, z: field.z }); Object.assign(other, { x: field.x, z: field.z });
  open.layout.landscape.fields = [];
  core.move(battle, unit, field.x, field.z + 4); core.move(open, other, field.x, field.z + 4);
  const distance = Math.hypot(unit.x - field.x, unit.z - field.z), normal = Math.hypot(other.x - field.x, other.z - field.z);
  assert.ok(Math.abs(distance / normal - .78) < 1e-8, 'paddy movement penalty applies to the shipped simulation');
  const attacker = battle.units.find(item => item.side === 'attacker'), defender = battle.units.find(item => item.side === 'defender');
  Object.assign(attacker, { type: 'archer', x: -50, z: 8 }); Object.assign(defender, { x: -66, z: 8 });
  const normalBattle = clone(battle); normalBattle.layout.landscape.settlements = [];
  const protectedDamage = core.damage(battle, attacker, defender, false), normalDamage = core.damage(normalBattle, attacker, defender, false);
  assert.ok(Math.abs(protectedDamage / normalDamage - .9) < 1e-8, 'town streets provide ten percent ranged cover');
});
