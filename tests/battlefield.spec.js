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
function create(mode = 'field', version = 1) {
  const state = Game.newGame();
  if (mode === 'defense') {
    state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' };
    return { state, battle: Tactics.createDefense(state, state.pendingDefense, { battlefieldVersion: version }) };
  }
  return { state, battle: Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode, battlefieldVersion: version }) };
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
  const battle = Game.createBattle({ state, sourceId: source.id, targetId: target.id, mode: 'siege', battlefieldVersion: 1 });
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
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', battlefieldVersion: 1 });
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

function regionalBattle(id, version = 2) {
  const state = Game.newGame(), target = state.castles.find(item => item.id === id), source = state.castles.find(item => item.id === target.neighbors[0]);
  state.playerClan = source.clan; state.alliances = [];
  if (source.clan === target.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  source.troops = 6000; source.coastal = true;
  state.armies[source.id].units = { ashigaru: 4000, navy: 2000, archer: 0, cavalry: 0, firearm: 0 };
  return { state, battle: Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege', battlefieldVersion: version }) };
}

test('every regional battlefield has ten times the previous playable area while castle masonry and capture grounds stay unchanged', () => {
  for (const castle of Game.castles) {
    const { battle } = regionalBattle(castle.id), old = regionalBattle(castle.id, 1).battle;
    assert.equal(battle.battlefieldVersion, 2);
    const box = battle.layout.bounds, oldBox = old.layout.bounds;
    const area = (box.maxX - box.minX) * (box.maxZ - box.minZ), oldArea = (oldBox.maxX - oldBox.minX) * (oldBox.maxZ - oldBox.minZ);
    assert.ok(Math.abs(area / oldArea - 10) < 1e-10, `${castle.id}: expand the current battlefield tenfold`);
    assert.deepEqual(clone(battle.structures.filter(item => !item.landscape)), clone(old.structures.filter(item => !item.landscape)));
    assert.deepEqual(clone(battle.captureZone), clone(old.captureZone));
    assert.deepEqual(clone(battle.layout.baileys), clone(old.layout.baileys));
    assert.equal(Battlefield.elevationDelta(battle.layout, -44, -50), 0);
    assert.equal(Battlefield.elevationDelta(battle.layout, 44, 42), 0);
    assert.equal(battle.layout.landscape.profile.province, castle.province);
    assert.equal(battle.layout.landscape.profile.region, castle.region);
  }
});

test('plains, mountain valleys, basins, northern coasts and Ryukyu have different terrain rather than one enlarged template', () => {
  const ids = ['kiyosu', 'inabayama', 'tsutsujigasaki', 'odawara', 'wakimoto', 'shuri'];
  const worlds = ids.map(id => regionalBattle(id).battle.layout.landscape);
  assert.equal(new Set(worlds.map(world => world.profile.id)).size, ids.length);
  assert.equal(new Set(worlds.map(world => (world.bounds.maxX - world.bounds.minX) / (world.bounds.maxZ - world.bounds.minZ))).size, ids.length, 'the battlefield footprints have different aspect ratios');
  assert.equal(new Set(worlds.map(world => JSON.stringify(world.rivers))).size, ids.length, 'river courses differ by region');
  assert.equal(new Set(worlds.map(world => JSON.stringify(world.peaks))).size, ids.length, 'ridges and valleys differ by region');
  assert.ok(worlds[0].fields.length > worlds[1].fields.length, 'plain country has more cultivated ground than a mountain region');
  const paddies = world => world.fields.filter(field => field.kind === 'paddy').length / world.fields.length;
  assert.ok(paddies(worlds[0]) > paddies(worlds[5]), 'Ryukyu is not filled with the same rice paddies as the alluvial plain');
  assert.notEqual(worlds[3].seas[0].polygon.length, 4, 'headlands and coves replace the old uniform coastline rectangle');
  for (const id of ids) {
    const first = regionalBattle(id).battle, repeated = regionalBattle(id).battle;
    assert.deepEqual(clone(first.layout.landscape), clone(repeated.layout.landscape), 'terrain generation is deterministic for saved-game replay');
    const before = JSON.stringify(first); Battlefield.apply(first, 2);
    assert.equal(JSON.stringify(first), before, 'reopening preparation cannot duplicate countryside geometry');
  }
});

for (const mode of ['field', 'siege', 'defense']) {
  test(`regional ${mode}: players can place troops far outside the previous field without crossing the enemy deployment zone`, () => {
    const { battle } = create(mode, 2), unit = battle.units.find(item => item.side === battle.playerSide && item.type === 'ashigaru');
    const zone = Tactics.deploymentZone(battle), z = mode === 'defense' ? -180 : 180;
    let x = -180;
    while (Battlefield.blocked(battle.layout, x, z) && x < -100) x += 4;
    assert.ok(x < -100, 'a far-country deployment exists');
    const answer = Tactics.deploy(battle, { unitId: unit.id, x, z });
    assert.equal(answer.ok, true, answer.message);
    assert.equal(answer.battle.units.find(item => item.id === unit.id).x, x);
    assert.equal(Tactics.deploy(battle, { unitId: unit.id, x: zone.xMax + 2, z }).ok, false);
    assert.equal(Tactics.deploy(battle, { unitId: unit.id, x, z: mode === 'defense' ? 180 : -180 }).ok, false);
    const started = Game.startBattle(answer.battle);
    assert.equal(Tactics.order(started, { unitId: unit.id, order: 'move', x, z }).ok, true);
  });
}

test('land troops really march over the new outer river crossings from both banks without walking through water', () => {
  for (const id of ['inabayama', 'kiyosu', 'wakimoto']) for (const direction of [-1, 1]) {
    const { battle } = regionalBattle(id), crossing = battle.layout.landscape.crossings.at(-1), core = Tactics.install({});
    const unit = battle.units.find(item => item.type === 'ashigaru');
    Object.assign(unit, { x: crossing.x - 28 * direction, z: crossing.z + 18, order: 'move', status: 'active' });
    const target = { x: crossing.x + 28 * direction, z: crossing.z + 18 };
    assert.equal(Battlefield.blocked(battle.layout, unit.x, unit.z), false);
    assert.equal(Battlefield.blocked(battle.layout, target.x, target.z), false);
    let steps = 0, crossedWater = false;
    while (Math.hypot(unit.x - target.x, unit.z - target.z) > .9 && steps++ < 800) {
      core.move(battle, unit, target.x, target.z);
      const world = battle.layout.landscape;
      if (world.rivers.some(river => Battlefield.inside(unit.x, unit.z, river.polygon))) {
        crossedWater = true;
        assert.ok(world.crossings.some(item => Battlefield.inFootprint(item, unit.x, unit.z)), `${id}: every wet step lies on a bridge or ford`);
      }
      assert.equal(!!Battlefield.buildingAt(battle.layout, unit.x, unit.z), false);
    }
    assert.ok(steps < 800, `${id}: outer bank target is reachable, stopped at ${unit.x},${unit.z}`);
    assert.ok(crossedWater, 'the test crosses a new outer reach of the river');
  }
});

test('wide routes remain finite and navigable over the complete tenfold field', () => {
  const { battle } = create('field', 2), layout = battle.layout;
  const from = [-180, 180], target = [180, -180], route = Battlefield.route(layout, ...from, ...target);
  assert.ok(route.length > 100, 'the test plans a journey across the expanded country');
  assert.deepEqual(clone(route.at(-1)), target);
  let previous = from;
  for (const point of route) {
    assert.ok(point.every(Number.isFinite));
    const length = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    for (let part = 1; part <= Math.max(1, Math.ceil(length / .5)); part++) {
      const t = part / Math.max(1, Math.ceil(length / .5));
      assert.equal(Battlefield.blocked(layout, previous[0] + (point[0] - previous[0]) * t, previous[1] + (point[1] - previous[1]) * t, 0), false);
    }
    previous = point;
  }
  assert.deepEqual(clone(Battlefield.route(layout, ...from, ...target)), clone(route), 'cached navigation stays deterministic');
});

test('a coastal native castle with an inland core gains a usable outer sea without flooding its castle plan', () => {
  const { battle } = regionalBattle('sunpu'), previous = regionalBattle('sunpu', 1).battle;
  assert.equal(previous.layout.water.some(water => water.type === 'sea'), false, 'exercise the native inland-core coastal case');
  assert.equal(battle.layout.landscape.profile.id, 'coast');
  assert.ok(battle.layout.water.some(water => water.type === 'sea'));
  const location = { x: battle.layout.bounds.minX + 20, z: 180 };
  const navy = battle.units.find(unit => unit.side === 'attacker' && unit.type === 'navy'), foot = battle.units.find(unit => unit.side === 'attacker' && unit.type === 'ashigaru');
  assert.ok(navy && foot);
  assert.equal(Tactics.deploy(battle, { unitId: navy.id, ...location }).ok, true, 'naval units have real sea space');
  assert.equal(Tactics.deploy(battle, { unitId: foot.id, ...location }).ok, false);
  for (let z = -50; z <= 42; z += 4) for (let x = -44; x <= 44; x += 4) assert.equal(battle.layout.landscape.seas.some(sea => Battlefield.inside(x, z, sea.polygon)), false, 'the added coast never floods original gates or terraces');
});

test('country routes exclude additional solid fortification waypoints and invalidate their cache when fences change', () => {
  const { battle } = create('field', 2), unit = battle.units.find(item => item.type === 'ashigaru');
  Object.assign(unit, { x: -180, z: 180 });
  Battlefield.navigationTarget(battle, unit, 180, -180);
  const original = unit.landscapeRoute.points;
  const center = original[Math.floor(original.length / 3)], obstacle = (x, z, padding = 0) => Math.abs(x - center[0]) < 3 + padding && Math.abs(z - center[1]) < 1 + padding;
  assert.ok(original.some(([x, z]) => obstacle(x, z, .7)), 'the newly built fence obstructs an existing waypoint');
  Battlefield.navigationTarget(battle, unit, 180, -180, { key: 'intact-fence-1', blocked: obstacle });
  assert.equal(unit.landscapeRoute.obstacleKey, 'intact-fence-1');
  assert.ok(unit.landscapeRoute.points.length > 0);
  assert.ok(unit.landscapeRoute.points.every(([x, z]) => !obstacle(x, z, .7)), 'the planner never hands a waypoint inside the physical fence to local collision handling');
  Battlefield.navigationTarget(battle, unit, 180, -180, { key: 'destroyed-fence-1', blocked: () => false });
  assert.equal(unit.landscapeRoute.obstacleKey, 'destroyed-fence-1');
});

test('a saved version-one battle keeps its original countryside, movement ledger and settlement behavior', () => {
  const { state } = create();
  garrison(state, 'kiyosu', 9000); garrison(state, 'inabayama', 300);
  const battle = finish(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', battlefieldVersion: 1 }));
  assert.equal(battle.battlefieldVersion, 1);
  assert.equal(battle.layout.landscape.version, 1);
  assert.equal(battle.layout.landscape.profile, undefined);
  assert.ok(Tactics.verify(state, battle), 'v1 replays use the unchanged v1 terrain and route planner');
  assert.equal(Game.settle(state, battle).ok, true);
});
