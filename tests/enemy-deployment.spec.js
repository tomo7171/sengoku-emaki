'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const types = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const totals = (battle, side) => Object.fromEntries(types.map(type => [type, battle.units.filter(unit => unit.side === side && unit.type === type).reduce((amount, unit) => amount + unit.troops, 0)]));
const castle = (state, id) => state.castles.find(item => item.id === id);

function create(state, sourceId, targetId, mode = 'field', battlefieldVersion) {
  state.playerClan = castle(state, sourceId).clan;
  state.alliances = [];
  return Game.createBattle({ state, sourceId, targetId, mode, battlefieldVersion });
}

test('regional armies keep every real soldier and troop type while both sides adopt distinct deployment doctrines', () => {
  const cases = [['kiyosu', 'inabayama'], ['toyama', 'nanao']];
  const state = Game.newGame();
  for (const id of ['tsutsujigasaki', 'sannohe', 'shuri']) {
    const source = castle(state, id);
    if (source) {
      const target = source.neighbors.map(id => castle(state, id)).find(target => target.clan !== source.clan && (source.routes?.[target.id] !== 'sea' || state.armies[source.id].units.navy >= 100));
      if (target) cases.push([source.id, target.id]);
    }
  }
  assert.ok(cases.length >= 4, 'exercise distant historical clans rather than changing a random seed on one army');
  const doctrines = new Set(), rosters = new Set(), positions = new Set();
  for (const [sourceId, targetId] of cases) {
    const before = clone(state), legacy = create(state, sourceId, targetId, 'field', 1), battle = create(state, sourceId, targetId);
    for (const side of ['attacker', 'defender']) {
      assert.deepEqual(totals(battle, side), totals(legacy, side), `${sourceId} ${side} does not invent, remove or reclassify soldiers`);
      assert.deepEqual(clone(battle.armyDeployment[side].units), totals(battle, side));
      assert.ok(battle.units.filter(unit => unit.side === side).every(unit => !['navy'].includes(unit.type) || castle(state, side === 'attacker' ? sourceId : targetId).coastal), 'ships come from actual coastal rosters');
      assert.ok(battle.units.filter(unit => unit.side === side).some(unit => unit.formation !== 'line'), 'the proposal has unit-specific formations');
      doctrines.add(battle.armyDeployment[side].id);
      rosters.add(JSON.stringify(totals(battle, side)));
      positions.add(JSON.stringify(battle.units.filter(unit => unit.side === side).map(unit => [unit.type, unit.x, unit.z])));
    }
    const repeat = create(state, sourceId, targetId);
    assert.deepEqual(clone(repeat.units), clone(battle.units), 'the same historical situation has an exactly reproducible proposal');
    // Only the caller's selection changes; creating either proposal never
    // spends soldiers, food or seasonal commands.
    before.playerClan = state.playerClan; before.alliances = [];
    assert.deepEqual(clone(state), before);
  }
  assert.ok(doctrines.size >= 3);
  assert.ok(rosters.size >= 5);
  assert.ok(positions.size >= 5);
});

test('siege and defensive deployments use the castle baileys and player changes override the proposal', () => {
  const state = Game.newGame();
  const siege = create(state, 'kiyosu', 'inabayama', 'siege');
  for (const unit of siege.units.filter(unit => unit.side === 'defender' && unit.type !== 'navy')) {
    assert.ok(siege.layout.baileys.some(bailey => Math.abs(unit.x - bailey.x) < bailey.width / 2 && Math.abs(unit.z - bailey.z) < bailey.depth / 2), `${unit.id} holds a real bailey`);
  }
  const defense = Tactics.createDefense(state, { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' });
  assert.equal(defense.playerSide, 'defender');
  assert.equal(defense.armyDeployment.attacker.clan, castle(state, 'inabayama').clan);
  assert.equal(defense.armyDeployment.defender.clan, state.playerClan);
  assert.ok(defense.units.filter(unit => unit.side === 'attacker').every(unit => unit.order === 'attack'));
  const unit = defense.units.find(unit => unit.side === 'defender' && unit.type === 'ashigaru');
  let response;
  for (const x of [-20, 20, -40, 40]) {
    response = Tactics.deploy(defense, { unitId: unit.id, x, z: -70 });
    if (response.ok) break;
  }
  assert.equal(response.ok, true, response.message);
  const selected = response.battle.units.find(item => item.id === unit.id);
  assert.equal(selected.z, -70, 'the regional proposal never replaces the player’s later orders');
  assert.deepEqual(clone(Game.startBattle(response.battle).units.find(item => item.id === unit.id)), { ...clone(selected), status: 'fighting' });
});

test('Sunpu’s coastal roster deploys its ships on the added outer sea and retains every type budget', () => {
  const state = Game.newGame(), battle = create(state, 'odawara', 'sunpu', 'siege'), legacy = create(state, 'odawara', 'sunpu', 'siege', 1);
  assert.ok(battle.layout.water.some(water => water.type === 'sea'));
  for (const side of ['attacker', 'defender']) assert.deepEqual(totals(battle, side), totals(legacy, side));
  for (const unit of battle.units.filter(unit => unit.type === 'navy')) assert.ok(battle.layout.water.some(water => water.type === 'sea' && context.TenkaBattlefield.inside(unit.x, unit.z, water.polygon)), `${unit.id} floats on actual navigable water`);
});

function localFence(mode, rotation) {
  const state = Game.newGame();
  let battle = mode === 'defense' ? Tactics.createDefense(state, { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' }) : create(state, 'kiyosu', 'inabayama', mode);
  const own = battle.units.find(unit => unit.side === battle.playerSide && unit.type === 'ashigaru');
  const angle = rotation * Math.PI / 180, normal = { x: -Math.sin(angle), z: Math.cos(angle) };
  let response;
  for (const z of mode === 'defense' ? [-70, -86, -110] : [70, 86, 110]) {
    for (const x of [-20, 20, -40, 40]) {
      const placed = Tactics.placeFortification(battle, { kind: 'palisade', x, z, rotation });
      if (!placed.ok) continue;
      response = Tactics.deploy(placed.battle, { unitId: own.id, x: x + normal.x * 4, z: z + normal.z * 4 });
      if (response.ok) {
        const started = Game.startBattle(response.battle);
        return { state, battle: started, own: started.units.find(item => item.id === own.id), fence: started.fortifications[0], normal };
      }
    }
  }
  assert.fail(`${mode} needs a valid fieldwork and approach`);
}

for (const mode of ['field', 'siege', 'defense']) {
  for (const rotation of [0, 37, 90]) {
    test(`${mode}: intact ${rotation} degree stakes block both sides, friendly troops detour, and only enemies can break them`, () => {
      const { battle, own, fence, normal } = localFence(mode, rotation);
      const hooks = Tactics.install({}), destination = { x: fence.x - normal.x * 5, z: fence.z - normal.z * 5 }, initialHP = fence.hp;
      own.order = 'move';
      assert.equal(Tactics.order(battle, { unitId: own.id, order: 'move', x: fence.x, z: fence.z }).ok, false, 'a player cannot order a move onto an intact fence');
      let maxSideways = 0;
      for (let step = 0; step < 140 && Math.hypot(own.x - destination.x, own.z - destination.z) > .6; step++) {
        const old = { x: own.x, z: own.z };
        hooks.move(battle, own, destination.x, destination.z);
        assert.equal(Tactics.fortificationContains(fence, own.x, own.z, .4), false, 'friendly troops never enter the rotated footprint');
        for (let sample = 1; sample < 8; sample++) assert.equal(Tactics.fortificationContains(fence, old.x + (own.x - old.x) * sample / 8, old.z + (own.z - old.z) * sample / 8, .4), false, 'a long movement step cannot jump across the thin fence');
        maxSideways = Math.max(maxSideways, Math.abs((own.x - fence.x) * Math.cos(rotation * Math.PI / 180) + (own.z - fence.z) * Math.sin(rotation * Math.PI / 180)));
      }
      assert.ok(Math.hypot(own.x - destination.x, own.z - destination.z) < .6, 'friendly troops get around the fence instead of remaining blocked');
      assert.ok(maxSideways > fence.w / 2 + .4, 'the route visibly passes an end of the stakes');
      assert.equal(fence.hp, initialHP, 'friends do not destroy their own defense');
      const enemy = battle.units.find(unit => unit.side !== own.side && unit.type === 'ashigaru');
      Object.assign(enemy, { x: fence.x + normal.x * 1.1, z: fence.z + normal.z * 1.1, order: 'attack' });
      hooks.move(battle, enemy, destination.x, destination.z);
      assert.equal(Tactics.fortificationContains(fence, enemy.x, enemy.z, .4), false, 'the enemy is stopped before the same visible footprint');
      assert.ok(fence.hp < initialHP, 'enemy troops attack the obstruction');
      fence.hp = 0; delete enemy.fieldworkTarget;
      const before = { x: enemy.x, z: enemy.z };
      hooks.move(battle, enemy, destination.x, destination.z);
      assert.ok(Math.hypot(enemy.x - before.x, enemy.z - before.z) > .1, 'broken stakes permit passage');
      assert.equal(Tactics.order(battle, { unitId: own.id, order: 'move', x: fence.x, z: fence.z }).ok, true, 'the destroyed footprint is a valid destination');
    });
  }
}

test('a restored overlapping troop exits through the nearest fence face without crossing the fence or damaging it', () => {
  const { battle, own, fence } = localFence('field', 37), hooks = Tactics.install({});
  Object.assign(own, { x: fence.x, z: fence.z });
  const hp = fence.hp;
  for (let step = 0; step < 6; step++) hooks.move(battle, own, fence.x, fence.z - 10);
  assert.equal(Tactics.fortificationContains(fence, own.x, own.z, .45), false);
  assert.equal(fence.hp, hp);
});

test('camps remain passable by both armies while the same ground occupied by stakes is impassable', () => {
  const state = Game.newGame();
  let battle = create(state, 'kiyosu', 'inabayama');
  const placed = Tactics.placeFortification(battle, { kind: 'camp', x: 0, z: 20, rotation: 37 });
  assert.equal(placed.ok, true);
  battle = Game.startBattle(placed.battle);
  const hooks = Tactics.install({});
  for (const side of ['attacker', 'defender']) {
    const unit = battle.units.find(unit => unit.side === side && unit.type === 'ashigaru');
    Object.assign(unit, { x: 0, z: 24, order: 'move' });
    for (let step = 0; step < 20 && unit.z > 16.1; step++) hooks.move(battle, unit, 0, 16);
    assert.ok(unit.z <= 16.1, `${side} can walk through an encampment`);
  }
  assert.equal(battle.fortifications[0].hp, battle.fortifications[0].maxHp);
});

test('countryside routing combines village obstacles with a friendly fence without choosing a blocked waypoint', () => {
  const state = Game.newGame();
  let battle = create(state, 'kiyosu', 'inabayama');
  const unitId = battle.units.find(unit => unit.side === 'attacker' && unit.type === 'ashigaru').id;
  const placed = Tactics.placeFortification(battle, { kind: 'palisade', x: -65, z: 23, rotation: 0 });
  assert.equal(placed.ok, true, placed.message);
  const deployed = Tactics.deploy(placed.battle, { unitId, x: -65, z: 30 });
  assert.equal(deployed.ok, true, deployed.message);
  battle = Game.startBattle(deployed.battle);
  const own = battle.units.find(unit => unit.id === unitId), fence = battle.fortifications[0], hooks = Tactics.install({});
  own.order = 'move';
  for (let step = 0; step < 240 && Math.hypot(own.x + 65, own.z + 10) > .6; step++) {
    hooks.move(battle, own, -65, -10);
    assert.equal(Tactics.fortificationContains(fence, own.x, own.z, .4), false);
    assert.equal(context.TenkaBattlefield.buildingAt(battle.layout, own.x, own.z, 0), null);
  }
  assert.ok(Math.hypot(own.x + 65, own.z + 10) < .6, 'one route clears the stakes and houses instead of stalling between the planners');
  assert.equal(fence.hp, fence.maxHp);
});

test('legacy zero and one battle proposals retain their original geometry, formation and command replay', () => {
  for (const battlefieldVersion of [0, 1]) {
    const state = Game.newGame();
    let battle = create(state, 'kiyosu', 'inabayama', 'field', battlefieldVersion);
    assert.equal(battle.battlefieldVersion || 0, battlefieldVersion);
    assert.equal(battle.timeLimit, undefined);
    assert.equal(battle.armyDeployment, undefined);
    const first = battle.units[0];
    assert.deepEqual({ x: first.x, z: first.z, formation: first.formation }, { x: -12, z: 29, formation: 'line' });
    battle = Game.startBattle(battle);
    for (let batch = 0; batch < 400 && battle.phase === 'fighting'; batch++) {
      let steps = 0;
      for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
      battle.ledger.push({ kind: 'tick', steps });
    }
    assert.equal(battle.phase, 'finished');
    assert.ok(Tactics.verify(state, battle));
    assert.equal(Game.settle(state, battle).ok, true);
    const altered = clone(battle); altered.battlefieldVersion = 2;
    assert.equal(Tactics.verify(state, altered), null, 'a version label cannot bypass reconstruction');
  }
  assert.equal(context.TenkaBattlefield.version, 2);
});
