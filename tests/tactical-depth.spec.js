'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics } = runtime();
const engine = Tactics.install({});
const types = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const total = units => types.reduce((sum, type) => sum + (units[type] || 0), 0);
const baselineState = Game.newGame();
const baselineBattle = Game.createBattle({ state: baselineState, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', battlefieldVersion: 0 });

// Isolate two actual production squads on unobstructed ground. These fixtures
// exercise the live damage, movement, routing and supply engine, without a
// castle's unrelated fortifications obscuring the tactical comparison.
function squad(type, side, x, z) {
  return { ...clone(baselineBattle.units.find(unit => unit.side === side)), id: `${side}-${type}-${x}-${z}`, type, side,
    x, z, targetX: x, targetZ: z, targetId: null, order: 'hold', status: 'fighting', troops: 600, maxTroops: 600,
    morale: 85, initialMorale: 85, formation: 'line', stance: 'balanced', fatigue: 0, cohesion: 100, suppression: 0,
    steadyTime: 2, chargeMomentum: 0, facingX: 0, facingZ: side === 'attacker' ? -1 : 1,
    range: { ashigaru: 2.5, archer: 18, cavalry: 3.5, firearm: 22, navy: 24 }[type], receivedRemainder: 0 };
}
function arena(units) {
  const battle = clone(baselineBattle);
  battle.units = units; battle.phase = 'fighting'; battle.structures = [];
  battle.layout.water = []; battle.layout.landscape = null;
  battle.supply = { attacker: { initial: 100000, consumed: 0, exhausted: false }, defender: { initial: 100000, consumed: 0, exhausted: false } };
  return battle;
}
function advance(battle, count) {
  for (let index = 0; index < count && battle.phase === 'fighting'; index++) Game.simulateTick(battle);
  return battle;
}
function finish(input) {
  const battle = Game.startBattle(input);
  for (let count = 0; count < 2400 && battle.phase === 'fighting'; count++) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished');
  return battle;
}
function garrison(state, id, units) {
  state.castles.find(castle => castle.id === id).troops = total(units);
  state.armies[id].units = { ...units };
}

test('the same combined arms force inflicts greater losses when the player opens its fire lane and braces its screen', () => {
  function fight(wellLed) {
    const gun = squad('firearm', 'attacker', wellLed ? 8 : 0, 8), screen = squad('ashigaru', 'attacker', 0, 1), enemy = squad('ashigaru', 'defender', 0, -8);
    if (wellLed) { gun.stance = 'brace'; screen.stance = 'brace'; screen.formation = 'defensive'; }
    return advance(arena([gun, screen, enemy]), 32);
  }
  const poor = fight(false), good = fight(true);
  assert.equal(total({ firearm: 600, ashigaru: 600 }), 1200, 'both plans use the same soldiers and weapons');
  assert.ok(good.units[2].troops < poor.units[2].troops * .75, `opening the actual shot lane changes casualties: well-led enemy ${good.units[2].troops}, poorly-led enemy ${poor.units[2].troops}`);
  assert.ok(600 - good.units[1].troops < (600 - poor.units[1].troops) * .5, 'the prepared screen suffers less than half the infantry losses');
  const poorView = Tactics.tacticalView(poor, poor.units[0].id).selected;
  const goodView = Tactics.tacticalView(good, good.units[0].id).selected;
  assert.equal(poorView.fireLane, '味方が射線上');
  assert.equal(goodView.fireLane, '射界良好');
});

test('cavalry must choose its approach: braced spears resist a frontal charge while a flank remains vulnerable', () => {
  const horse = squad('cavalry', 'attacker', 0, 2), spear = squad('ashigaru', 'defender', 0, 0);
  spear.stance = 'brace'; horse.stance = 'charge'; horse.chargeMomentum = 1;
  const battle = arena([horse, spear]);
  const frontal = engine.damage(battle, horse, spear, false);
  horse.x = 2; horse.z = 0;
  const flank = engine.damage(battle, horse, spear, false);
  assert.ok(flank > frontal * 1.4, 'the approach direction and brace have a material effect with identical troop counts');
  spear.formation = 'defensive';
  assert.ok(engine.damage(battle, horse, spear, false) < flank, 'a circular spear formation is a real counter to the flank');
});

test('forced movement covers more ground but costs fatigue and cohesion; withdrawing reserves to rest restores them', () => {
  function march(stance) {
    const unit = squad('ashigaru', 'attacker', 0, 30); unit.stance = stance; unit.order = 'move'; unit.targetX = 35;
    return advance(arena([unit, squad('ashigaru', 'defender', 0, -40)]), 20);
  }
  const ordinary = march('balanced'), forced = march('charge');
  assert.ok(forced.units[0].x > ordinary.units[0].x + 2);
  assert.ok(forced.units[0].fatigue > ordinary.units[0].fatigue + 5);
  assert.ok(forced.units[0].cohesion < ordinary.units[0].cohesion);
  const battle = arena([squad('ashigaru', 'attacker', 0, 30), squad('ashigaru', 'defender', 0, -40)]);
  Object.assign(battle.units[0], { fatigue: 85, cohesion: 40, suppression: 60 });
  const rested = Tactics.stance(battle, battle.units[0].id, 'rest');
  assert.equal(rested.ok, true); advance(rested.battle, 40);
  assert.ok(rested.battle.units[0].fatigue < 60);
  assert.ok(rested.battle.units[0].cohesion > 60);
  assert.ok(rested.battle.units[0].suppression < 30);
  assert.equal(rested.battle.units[0].x, 0);
  assert.equal(rested.battle.units[0].z, 30);
});

test('resting on the front line neither attacks nor offers the recovery of an unengaged reserve', () => {
  const unit = squad('ashigaru', 'attacker', 0, 1), enemy = squad('ashigaru', 'defender', 0, 0);
  unit.stance = 'rest'; unit.fatigue = 80;
  const battle = advance(arena([unit, enemy]), 16);
  assert.equal(enemy.troops, 600, 'rest stops attacks');
  assert.ok(unit.troops < 600, 'an exposed resting unit remains attackable');
  assert.equal(unit.fatigue, 80, 'being engaged prevents the safe reserve recovery');
});

test('a broken resting or braced unit can still rout instead of being frozen by its former stance', () => {
  for (const stance of ['rest', 'brace']) {
    const unit = squad('ashigaru', 'attacker', 0, 30); unit.stance = stance; unit.morale = 10;
    const battle = advance(arena([unit, squad('ashigaru', 'defender', 0, -40)]), 1);
    assert.equal(unit.order, 'retreat');
    assert.equal(unit.stance, 'balanced');
    assert.ok(unit.z > 30, 'the original retreat path must remain usable');
  }
});

test('sustained fire suppresses a formed target, and dispersing reduces both suppression and casualties', () => {
  function underFire(formation) {
    const gun = squad('firearm', 'attacker', 0, 9), target = squad('archer', 'defender', 0, -9);
    target.formation = formation; target.stance = 'brace';
    return advance(arena([gun, target]), 16).units[1];
  }
  const line = underFire('line'), loose = underFire('loose');
  assert.ok(line.suppression > 0);
  assert.ok(loose.suppression < line.suppression);
  assert.ok(loose.troops > line.troops);
});

test('cohesion discourages instant formation switching and the view describes tactical danger without modifying combat state', () => {
  let battle = arena([squad('ashigaru', 'attacker', 0, 1), squad('ashigaru', 'defender', 0, 0)]);
  for (const value of ['wedge', 'loose', 'defensive']) {
    const changed = Tactics.formation(battle, battle.units[0].id, value); assert.equal(changed.ok, true); battle = changed.battle;
  }
  assert.equal(battle.units[0].cohesion, 64);
  const unchanged = Tactics.formation(battle, battle.units[0].id, 'defensive');
  assert.equal(unchanged.battle.units[0].cohesion, 64, 'repeating the current formation costs no cohesion');
  const snapshot = clone(battle), view = Tactics.tacticalView(battle, battle.units[0].id);
  assert.ok(view.selected.advice.some(text => text.includes('隊列')));
  assert.ok(view.selected.readiness < 100);
  assert.deepEqual(clone(battle), snapshot, 'reading the HUD cannot change readiness or fight results');
  assert.equal(Tactics.stance(battle, battle.units[1].id, 'rest').ok, false);
  assert.equal(Tactics.stance(battle, battle.units[0].id, 'invented').ok, false);
});

test('enemy units also rest exhausted reserves and resume under threat, rather than receiving a player-only fatigue rule', () => {
  const unit = squad('ashigaru', 'defender', 0, -40), enemy = squad('ashigaru', 'attacker', 0, 30);
  unit.fatigue = 85; const battle = arena([enemy, unit]);
  advance(battle, 16); assert.equal(unit.stance, 'rest'); assert.ok(unit.fatigue < 85);
  enemy.z = -35; advance(battle, 1);
  assert.equal(unit.stance, 'balanced'); assert.equal(unit.aiRestOrder, undefined);
});

test('an explicitly carried supply budget is finite: starvation worsens morale and combat, and more soldiers consume more', () => {
  function demand(troops, food) {
    const unit = squad('ashigaru', 'attacker', 0, 30); unit.troops = troops; unit.maxTroops = troops;
    const battle = arena([unit, squad('ashigaru', 'defender', 0, -40)]); battle.supply.attacker.initial = food;
    return advance(battle, 40);
  }
  const small = demand(300, 100), large = demand(600, 100), hungry = demand(600, 0);
  assert.equal(large.supply.attacker.consumed, small.supply.attacker.consumed * 2);
  assert.equal(hungry.supply.attacker.exhausted, true);
  assert.ok(hungry.units[0].morale < large.units[0].morale);
  assert.ok(hungry.units[0].fatigue > large.units[0].fatigue);
  const target = squad('ashigaru', 'defender', 0, 0);
  assert.ok(engine.damage(hungry, hungry.units[0], target, false) < engine.damage(large, large.units[0], target, false));
  const state = Game.newGame(), max = Math.max(0, state.food - 600);
  for (const carriedSupply of [-1, .5, max + 1, NaN, Infinity]) assert.throws(() => Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', carriedSupply }), /兵糧/);
  const empty = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', carriedSupply: 0 });
  assert.equal(empty.supply.attacker.initial, 0);
  assert.equal(empty.carriedSupply, 0);
});

test('real stance orders and a selected supply quantity replay, settle once, survive save/load, and reject forged readiness or stores', () => {
  const state = Game.newGame(), snapshot = clone(state);
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', carriedSupply: 80 });
  const unit = battle.units.find(unit => unit.side === 'attacker');
  let changed = Tactics.stance(battle, unit.id, 'charge'); assert.equal(changed.ok, true); battle = Game.startBattle(changed.battle);
  advance(battle, 8); battle.ledger.push({ kind: 'tick', steps: 8 });
  changed = Tactics.order(battle, { unitId: unit.id, order: 'rest' }); assert.equal(changed.ok, true); battle = changed.battle;
  advance(battle, 8); battle.ledger.push({ kind: 'tick', steps: 8 });
  changed = Tactics.order(battle, { unitId: unit.id, order: 'attack' }); assert.equal(changed.ok, true); battle = finish(changed.battle);
  assert.equal(battle.units.find(item => item.id === unit.id).stance, 'balanced');
  const report = Tactics.verify(state, battle); assert.ok(report);
  assert.equal(report.carriedSupply, 80); assert.ok(report.supplyConsumed <= 80);
  assert.equal(report.supplyRemaining + report.supplyConsumed, 80);
  const settled = Game.settle(state, battle); assert.equal(settled.ok, true, settled.message);
  assert.equal(settled.state.food, state.food - 600 - report.supplyConsumed);
  assert.equal(Game.validate(settled.state), true); assert.equal(Game.save(settled.state), true); assert.ok(Game.load());
  assert.deepEqual(clone(state), snapshot);
  for (const change of [value => value.units[0].fatigue = value.units[0].fatigue > 50 ? 0 : 100, value => value.units[0].cohesion = value.units[0].cohesion > 50 ? 0 : 100,
    value => value.carriedSupply++, value => value.supply.attacker.initial++,
    value => value.ledger.find(record => record.kind === 'stance').command.stance = 'rest']) {
    const forged = clone(battle); change(forged); assert.equal(Tactics.verify(state, forged), null);
  }
});

test('selected zero and nonzero defensive stores preserve the garrison budget and debit only food actually carried and consumed', () => {
  const state = Game.newGame();
  garrison(state, 'kiyosu', { ashigaru: 3000, archer: 1000, cavalry: 0, firearm: 2500, navy: 0 });
  garrison(state, 'inabayama', { ashigaru: 1000, archer: 300, cavalry: 100, firearm: 200, navy: 0 });
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', clan: 'saito' };
  assert.throws(() => Tactics.createDefense(state, state.pendingDefense, { carriedSupply: state.food + 1 }), /兵糧/);
  for (const carriedSupply of [0, 100]) {
    const battle = finish(Tactics.createDefense(state, state.pendingDefense, { carriedSupply }));
    assert.equal(battle.supply.defender.initial, carriedSupply);
    const report = Tactics.verify(state, battle); assert.ok(report);
    const settled = Game.settle(state, battle); assert.equal(settled.ok, true, settled.message);
    assert.equal(settled.state.food, state.food - report.supplyConsumed);
    assert.equal(settled.state.actionPoints, state.actionPoints);
    assert.ok(report.supplyConsumed <= carriedSupply); assert.equal(Game.validate(settled.state), true);
  }
});
