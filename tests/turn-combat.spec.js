'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const total = units => Object.values(units).reduce((sum, value) => sum + value, 0);
const holding = (state, id) => state.castles.find(castle => castle.id === id);
function army(state, id, count, type = 'firearm') {
  const units = Object.fromEntries(TYPES.map(name => [name, name === type ? count : 0]));
  holding(state, id).troops = count;
  state.armies[id].units = units;
}
function muster(input) {
  let battle = input;
  const units = Tactics.deploymentStatus(battle).units;
  for (let index = 0; index < units.length; index++) {
    const unit = units[index];
    if (!unit.foreignSupport) {
      const assigned = Tactics.assignCommander(battle, unit.id, battle.friendlyOfficers[index].id);
      assert.equal(assigned.ok, true, assigned.message); battle = assigned.battle;
    }
    const confirmed = Tactics.confirmDeployment(battle, unit.id);
    assert.equal(confirmed.ok, true, confirmed.message); battle = confirmed.battle;
  }
  assert.equal(Tactics.deploymentStatus(battle).ready, true);
  const begun = Game.startBattle(battle);
  assert.equal(begun.phase, 'fighting', begun.deploymentError);
  return begun;
}
function command(battle, order) {
  const answer = Tactics.order(battle, order);
  assert.equal(answer.ok, true, answer.message);
  return answer.battle;
}
function advance(battle) {
  const answer = Tactics.endTurn(battle);
  assert.equal(answer.ok, true, answer.message);
  return answer.battle;
}
function stateFor(mode = 'field', defending = false, target = 'inabayama') {
  const state = Game.newGame();
  const source = target === 'muranaka' ? 'hinoe' : 'kiyosu';
  if (target === 'muranaka') state.playerClan = defending ? 'ryuzoji' : 'arima';
  else if (defending) state.playerClan = holding(state, target).clan;
  army(state, source, defending ? 2000 : 12000, defending ? 'ashigaru' : 'firearm');
  army(state, target, defending ? 12000 : 40, defending ? 'firearm' : 'ashigaru');
  const battle = defending ? Tactics.createDefense(state, { sourceId: source, targetId: target, mode }, { controlMode: 'turns' })
    : Game.createBattle({ state, sourceId: source, targetId: target, mode, controlMode: 'turns' });
  return { state, battle };
}
function finishWithOrders(input) {
  let battle = muster(input);
  const side = battle.playerSide;
  for (let turn = 0; turn < 180 && battle.phase === 'fighting'; turn++) {
    for (const unit of battle.units.filter(item => item.side === side && item.troops > 0 && !['destroyed', 'routed', 'retreating'].includes(item.status))) {
      let target = battle.units.find(enemy => enemy.side !== side && enemy.troops > 0 && !['destroyed', 'routed', 'retreating'].includes(enemy.status));
      if (side === 'attacker' && battle.mode === 'siege') target = battle.structures.find(item => item.kind === 'gate' && item.hp > 0) || target || { ...battle.captureZone, id: 'capture' };
      if (!target) continue;
      const reach = unit.range + (target.side || target.id === 'capture' ? 0 : Math.max(target.w || 0, target.d || 0) / 2);
      if (target.id !== 'capture' && Math.hypot(target.x - unit.x, target.z - unit.z) <= reach) {
        battle = command(battle, { unitId: unit.id, order: 'attack', targetId: target.id });
      } else if (side === 'attacker') {
        let destination = target;
        if (battle.mode === 'siege') {
          const waypoint = battle.layout.paths[0].points.find(point => point[1] < unit.z - 1 && (target.id === 'capture' || point[1] >= target.z - 1));
          if (waypoint) destination = { x: waypoint[0], z: waypoint[1] };
        }
        const distance = Math.hypot(destination.x - unit.x, destination.z - unit.z);
        if (!distance) continue;
        const budget = Tactics.turnView(battle, unit.id).selected.movement * .94;
        for (const factor of [1, .8, .6, .4, .2]) {
          const answer = Tactics.order(battle, { unitId: unit.id, order: 'move',
            x: unit.x + (destination.x - unit.x) / distance * Math.min(distance, budget) * factor,
            z: unit.z + (destination.z - unit.z) / distance * Math.min(distance, budget) * factor });
          if (answer.ok) { battle = answer.battle; break; }
        }
      }
    }
    battle = advance(battle);
  }
  assert.equal(battle.phase, 'finished', 'legal movement and attacks resolve the real battlefield');
  return battle;
}

test('manual muster requires explicit placement and distinct stationed adult commanders in every battle mode', () => {
  for (const mode of ['field', 'siege']) for (const defending of [false, true]) {
    const { battle } = stateFor(mode, defending);
    const status = Tactics.deploymentStatus(battle);
    assert.ok(status.unassigned.length && status.unplaced.length);
    const rejected = Game.startBattle(battle);
    assert.equal(rejected.phase, 'deployment'); assert.ok(rejected.deploymentError);
    const first = status.units[0];
    const assigned = Tactics.assignCommander(battle, first.id, battle.friendlyOfficers[0].id);
    assert.equal(assigned.ok, true);
    assert.equal(assigned.battle.units.find(unit => unit.id === first.id).deployedConfirmed, false, 'choosing a commander does not confirm a suggested position');
    const active = muster(battle);
    assert.ok(active.units.filter(unit => unit.side === active.playerSide && !unit.foreignSupport).every(unit => unit.commanderId && unit.commanderName !== '組頭'));
  }
  const state = Game.newGame();
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', controlMode: 'turns' });
  const units = Tactics.deploymentStatus(battle).units;
  const officer = battle.friendlyOfficers[0];
  battle = Tactics.assignCommander(battle, units[0].id, officer.id).battle;
  assert.equal(Tactics.assignCommander(battle, units[1].id, officer.id).ok, false, 'a retainer cannot command two troop types');
  const foreign = state.officers.find(item => item.clan !== state.playerClan && item.status === 'active');
  assert.equal(Tactics.assignCommander(battle, units[1].id, foreign.id).ok, false);
  assert.ok(battle.friendlyOfficers.every(item => item.castleId === 'kiyosu' && state.year - item.birth >= 15));
});

test('browser ticks and queued orders cannot move units, spend food, or attack between explicit turns', () => {
  const { battle: preview } = stateFor();
  let battle = muster(preview), before = clone(battle);
  for (let index = 0; index < 80; index++) Game.simulateTick(battle);
  assert.deepEqual(clone(battle), before);
  const unit = Tactics.turnView(battle).units[0];
  const soldier = battle.units.find(item => item.id === unit.id);
  battle = command(battle, { unitId: soldier.id, order: 'move', x: soldier.x, z: soldier.z - 2 });
  assert.equal(battle.time, 0); assert.equal(battle.supply.attacker.consumed, 0);
  assert.deepEqual(clone(battle.units.map(item => [item.x, item.z, item.troops])), before.units.map(item => [item.x, item.z, item.troops]));
  battle = advance(battle);
  assert.equal(battle.turnNumber, 2); assert.ok(battle.time > 0); assert.ok(battle.supply.attacker.consumed > 0);
  assert.ok(battle.units.find(item => item.id === soldier.id).z < soldier.z);
  before = clone(battle);
  for (let index = 0; index < 80; index++) Game.simulateTick(battle);
  assert.deepEqual(clone(battle), before);
});

test('troop types have different movement, range, attack and defense; distant moves and attacks are rejected', () => {
  const state = Game.newGame();
  const battle = muster(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', controlMode: 'turns' }));
  const rules = Tactics.turnRules;
  assert.ok(rules.cavalry.movement > rules.ashigaru.movement && rules.ashigaru.movement > rules.firearm.movement);
  assert.ok(rules.firearm.range > rules.archer.range && rules.archer.range > rules.ashigaru.range);
  assert.notEqual(rules.cavalry.attack, rules.archer.attack); assert.notEqual(rules.firearm.defense, rules.ashigaru.defense);
  for (const unit of battle.units.filter(item => item.side === battle.playerSide)) {
    const range = Tactics.turnView(battle, unit.id).selected.movement;
    assert.equal(Tactics.order(battle, { unitId: unit.id, order: 'move', x: unit.x + range + 5, z: unit.z }).ok, false);
    const enemy = battle.units.find(item => item.side !== unit.side);
    assert.equal(Tactics.order(battle, { unitId: unit.id, order: 'attack', targetId: enemy.id }).ok, false);
  }
});

for (const mode of ['field', 'siege']) for (const defending of [false, true]) {
  test(`real ${defending ? 'defensive' : 'attacking'} ${mode} turns resolve, replay, settle once and survive save/load`, async () => {
    const { state, battle: preview } = stateFor(mode, defending, mode === 'siege' ? 'muranaka' : 'inabayama');
    const snapshot = clone(state);
    const battle = finishWithOrders(preview);
    assert.equal(battle.winner, battle.playerSide);
    if (mode === 'siege' && !defending) assert.ok(battle.structures.filter(item => item.kind === 'gate').every(gate => gate.hp === 0));
    assert.ok(Tactics.verify(state, battle));
    assert.ok(await Tactics.verifyAsync(state, battle));
    const settled = Game.settle(state, battle);
    assert.equal(settled.ok, true, settled.message);
    assert.equal(Game.validate(settled.state), true);
    assert.equal(Game.validate(JSON.parse(JSON.stringify(settled.state))), true);
    assert.deepEqual(clone(state), snapshot);
    assert.equal(Game.settle(settled.state, battle).ok, false, 'an already settled battle cannot issue duplicate rewards or casualties');
    const altered = clone(battle); altered.units.find(unit => unit.side === battle.playerSide).troops++;
    assert.equal(Tactics.verify(state, altered), null, 'survivors are derived from orders rather than trusted fields');
    const refilled = clone(battle); refilled.supply[battle.playerSide].initial += 10000;
    assert.equal(Tactics.verify(state, refilled), null, 'a forged food refill cannot be settled');
    const forged = clone(battle); forged.ledger.push({ kind: 'turn-end' });
    assert.equal(Tactics.verify(state, forged), null, 'extra turns after completion are invalid');
  });
}

test('uncommitted soldiers stay at home and a legal full withdrawal conserves their reserves', () => {
  const { state, battle: preview } = stateFor();
  const unit = Tactics.deploymentStatus(preview).units[0];
  const reduced = Tactics.deploy(preview, { unitId: unit.id, troops: 1000, commanderId: preview.friendlyOfficers[0].id });
  assert.equal(reduced.ok, true);
  const battle = muster(reduced.battle);
  assert.equal(battle.initialAttacker.firearm, 1000);
  const withdrawal = Tactics.withdrawBattle(battle);
  assert.equal(withdrawal.ok, true); assert.equal(withdrawal.battle.phase, 'finished');
  assert.ok(Tactics.verify(state, withdrawal.battle));
  const settled = Game.settle(state, withdrawal.battle);
  assert.equal(settled.ok, true, settled.message);
  const casualties = Game.report(withdrawal.battle).casualties;
  assert.equal(holding(settled.state, 'kiyosu').troops, holding(state, 'kiyosu').troops - casualties);
  assert.ok(holding(settled.state, 'kiyosu').troops >= 11000, 'non-deployed soldiers are not deleted by unit merging or retreat');
  assert.equal(Game.validate(settled.state), true);
});

test('turn movement cannot end on a fence and cannot obtain free passage through a friendly palisade', () => {
  const { battle: preview } = stateFor();
  const unit = Tactics.deploymentStatus(preview).units[0];
  const fence = Tactics.placeFortification(preview, { kind: 'palisade', x: unit.x, z: unit.z - 3, rotation: 0 });
  assert.equal(fence.ok, true, fence.message);
  let battle = muster(fence.battle);
  assert.equal(Tactics.order(battle, { unitId: unit.id, order: 'move', x: unit.x, z: unit.z - 3 }).ok, false);
  const view = Tactics.turnView(battle, unit.id).selected;
  const destination = { x: unit.x, z: unit.z - Math.min(6, view.movement) };
  battle = command(battle, { unitId: unit.id, order: 'move', ...destination });
  battle = advance(battle);
  const after = battle.units.find(item => item.id === unit.id);
  assert.ok(Math.hypot(after.x - unit.x, after.z - unit.z) <= view.movement + .01);
  assert.equal(Tactics.fortificationContains(battle.fortifications[0], after.x, after.z, .4), false);
  assert.ok(Math.hypot(after.x - destination.x, after.z - destination.z) > .5, 'the short move cannot teleport straight through a seven-wide fence');
});

test('food use follows surviving soldier counts; empty supply weakens troops only when a turn is executed', () => {
  const make = amount => {
    const { state } = stateFor(); army(state, 'kiyosu', amount);
    let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', controlMode: 'turns', carriedSupply: 0 });
    battle = muster(battle);
    return { battle, after: advance(battle) };
  };
  const small = make(3000), large = make(9000);
  assert.equal(small.battle.supply.attacker.consumed, 0);
  assert.equal(small.battle.supply.attacker.exhausted, false);
  assert.equal(small.after.supply.attacker.exhausted, true);
  assert.ok(small.after.units.find(unit => unit.side === 'attacker').morale < small.battle.units.find(unit => unit.side === 'attacker').morale);
  assert.ok(large.after.supply.attacker.consumed > small.after.supply.attacker.consumed * 2.5);
});

test('both armies receive the same one-attack budget and a waiting player unit never counterattacks automatically', () => {
  // Isolate equal native squads on open ground to distinguish turn budgets
  // from a historical officer's ability, castle cover or regional terrain.
  let battle = clone(muster(stateFor().battle));
  battle.battlefieldVersion = 0; battle.layout.landscape = null; battle.layout.water = []; battle.layout.ground = { base: 0, peaks: [] }; battle.layout.baileys = []; battle.structures = [];
  battle.units = ['attacker', 'defender'].map((side, index) => ({ ...clone(battle.units[index]), id: side + '-equal', side,
    type: 'firearm', x: 0, z: index ? -5 : 5, targetX: 0, targetZ: index ? -5 : 5,
    troops: 600, maxTroops: 600, commanderId: null, morale: 85, initialMorale: 85,
    order: 'hold', targetId: null, status: 'fighting', range: 22, formation: 'line', stance: 'balanced',
    fatigue: 0, cohesion: 100, suppression: 0, steadyTime: 2, chargeMomentum: 0, receivedRemainder: 0,
    facingX: 0, facingZ: index ? 1 : -1, turnPlan: { action: 'wait', move: null, targetId: null } }));
  battle = command(battle, { unitId: 'attacker-equal', order: 'attack', targetId: 'defender-equal' });
  battle = advance(battle);
  const attacker = battle.units.find(unit => unit.side === 'attacker'), defender = battle.units.find(unit => unit.side === 'defender');
  assert.ok(attacker.troops < 600 && defender.troops < 600);
  assert.equal(attacker.troops, defender.troops, 'the enemy cannot fire 32 extra volleys against a player limited to one');
  const enemyBefore = defender.troops;
  battle = advance(battle);
  assert.equal(battle.units.find(unit => unit.side === 'defender').troops, enemyBefore, 'the player must order its next attack explicitly');
  assert.ok(battle.units.find(unit => unit.side === 'attacker').troops < attacker.troops, 'the enemy still chooses its response while the player waits');
});

test('turn-mode allied contingents use real allied officers and preserve reserved troop ownership through retreat', () => {
  const Allies = context.TenkaAllies;
  // Use the same module instance as the shipped engine, whose installation
  // hooks provide strategic normalization and troop conservation.
  const state = Game.newGame();
  state.alliances = ['matsudaira']; state.allianceExpires = { matsudaira: state.turn + 4 }; state.relations.matsudaira = 90;
  const reserved = Allies.requestSupport(state, { sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', supportCastleId: 'okazaki', troops: 1000 });
  assert.equal(reserved.ok, true, reserved.message);
  const supports = reserved.state.tenka.allies.committed;
  let battle = Game.createBattle({ state: reserved.state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field', controlMode: 'turns' });
  const guests = battle.units.filter(unit => unit.foreignSupport);
  assert.ok(guests.length > 0);
  for (const guest of guests) {
    const officer = reserved.state.officers.find(item => item.id === guest.commanderId);
    assert.ok(officer && officer.clan === 'matsudaira' && officer.status === 'active');
    assert.equal(guest.commanderName, officer.name);
    assert.equal(Tactics.deploy(battle, { unitId: guest.id, commanderId: 'oda_nobunaga' }).ok, false);
  }
  battle = muster(battle);
  const withdrawal = Tactics.withdrawBattle(battle);
  assert.equal(withdrawal.ok, true);
  assert.ok(Tactics.verify(reserved.state, withdrawal.battle));
  const report = Game.report(withdrawal.battle), support = report.supportReports[0];
  assert.equal(support.casualties + support.survivors, supports[0].troops);
  assert.equal(report.attackerArmy.units.ashigaru, battle.initialAttacker.ashigaru - guests.filter(unit => unit.type === 'ashigaru').reduce((amount, unit) => amount + unit.maxTroops, 0));
  const settled = Game.settle(reserved.state, withdrawal.battle);
  assert.equal(settled.ok, true, settled.message);
  assert.equal(holding(settled.state, 'okazaki').troops, holding(reserved.state, 'okazaki').troops + support.survivors);
  assert.equal(Game.validate(settled.state), true);
  assert.equal(supports[0].commanderId, null, 'the strategic support commitment contract remains unchanged');
});

for (const outcome of ['victory', 'defeat', 'withdrawal']) test(`a one-retainer Inuyama defense can reserve other troop types and settle ${outcome} without counting reserves as dead`, () => {
  const state = Game.newGame();
  army(state, 'inabayama', outcome === 'victory' ? 2000 : 12000, 'ashigaru');
  const defenders = { ashigaru: 500, archer: 300, cavalry: 200, firearm: outcome === 'defeat' ? 100 : 10000, navy: 0 };
  state.armies.inuyama.units = clone(defenders); holding(state, 'inuyama').troops = total(defenders);
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'inuyama', mode: 'siege', clan: 'saito' };
  let battle = Tactics.createDefense(state, state.pendingDefense, { controlMode: 'turns' });
  assert.equal(battle.friendlyOfficers.length, 1, 'the actual castle has only Oda Nobukiyo');
  assert.equal(Tactics.deploymentStatus(battle).units.length, 4);
  assert.equal(Game.startBattle(battle).phase, 'deployment');
  for (const unit of Tactics.deploymentStatus(battle).units.filter(item => item.type !== 'firearm')) {
    const reserved = Tactics.deploy(battle, { unitId: unit.id, troops: 0 });
    assert.equal(reserved.ok, true, reserved.message); battle = reserved.battle;
  }
  assert.equal(Tactics.deploymentStatus(battle).units.length, 1);
  const initial = clone(state);
  battle = outcome === 'withdrawal' ? Tactics.withdrawBattle(muster(battle)).battle : finishWithOrders(battle);
  assert.equal(battle.phase, 'finished');
  assert.equal(battle.winner === battle.playerSide, outcome === 'victory');
  assert.ok(Tactics.verify(state, battle));
  const report = Game.report(battle);
  assert.equal(report.reserveTroops, 1000);
  for (const type of ['ashigaru', 'archer', 'cavalry']) {
    assert.equal(report.defenderCasualtyUnits[type], 0);
    assert.equal(report.reserveUnits[type], defenders[type]);
  }
  assert.equal(report.reserveDisposition, outcome === 'victory' ? 'garrison' : 'dispersed');
  assert.ok(report.message.includes(outcome === 'victory' ? '城に残っています' : '討死数には含みません'));
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message);
  if (outcome === 'victory') {
    for (const type of ['ashigaru', 'archer', 'cavalry']) assert.equal(settled.state.armies.inuyama.units[type], defenders[type], 'uncommitted defenders remain available after repelling the enemy');
    assert.equal(holding(settled.state, 'inuyama').troops, total(defenders) - report.enemyCasualties);
  } else assert.equal(holding(settled.state, 'inuyama').clan, 'saito');
  assert.equal(Game.validate(settled.state), true);
  assert.equal(Game.save(settled.state), true); assert.ok(Game.load());
  assert.deepEqual(clone(state), initial);
});

test('turn stances cancel movement and attacks when resting or bracing, preserve a charge plan, and replay honestly', () => {
  const { state, battle: preview } = stateFor();
  let battle = muster(preview);
  const id = battle.units.find(unit => unit.side === battle.playerSide).id;
  const selectStance = value => {
    const answer = Tactics.stance(battle, id, value);
    assert.equal(answer.ok, true, answer.message); battle = answer.battle;
  };
  for (const value of ['rest', 'brace']) {
    const before = battle.units.find(unit => unit.id === id);
    battle = command(battle, { unitId: id, order: 'move', x: before.x, z: before.z - 2 });
    selectStance(value);
    const plan = battle.units.find(unit => unit.id === id).turnPlan;
    assert.equal(plan.action, value === 'rest' ? 'wait' : 'defend');
    assert.equal(plan.move, null); assert.equal(plan.targetId, null);
    battle = advance(battle);
    const after = battle.units.find(unit => unit.id === id);
    assert.equal(after.x, before.x); assert.equal(after.z, before.z);
    assert.equal(after.stance, value, 'the selected stance survives turn execution');
  }
  // Allow the real opposing field unit to approach until a legal explicit
  // movement-plus-attack plan is possible; no edited positions enter replay.
  let friendly, enemy;
  for (let count = 0; count < 20; count++) {
    friendly = battle.units.find(unit => unit.id === id);
    enemy = battle.units.find(unit => unit.side !== battle.playerSide && unit.troops > 0);
    if (Math.hypot(friendly.x - enemy.x, friendly.z - enemy.z) < friendly.range - 1) break;
    battle = advance(battle);
  }
  const planAttack = () => {
    const distance = Math.hypot(friendly.x - enemy.x, friendly.z - enemy.z);
    battle = command(battle, { unitId: id, order: 'move', x: friendly.x + (enemy.x - friendly.x) / distance,
      z: friendly.z + (enemy.z - friendly.z) / distance });
    battle = command(battle, { unitId: id, order: 'attack', targetId: enemy.id });
  };
  for (const value of ['rest', 'brace']) {
    planAttack(); selectStance(value);
    const plan = battle.units.find(unit => unit.id === id).turnPlan;
    assert.equal(plan.move, null); assert.equal(plan.targetId, null, 'changing to rest/brace cancels a pending attack too');
  }
  planAttack();
  const planned = clone(battle.units.find(unit => unit.id === id).turnPlan);
  selectStance('balanced');
  assert.deepEqual(clone(battle.units.find(unit => unit.id === id).turnPlan), planned);
  selectStance('charge');
  assert.deepEqual(clone(battle.units.find(unit => unit.id === id).turnPlan), planned);
  const beforeTime = battle.time;
  battle = advance(battle);
  assert.ok(battle.time > beforeTime);
  assert.equal(battle.units.find(unit => unit.id === id).stance, 'charge', 'a planned movement does not overwrite the selected charge');
  assert.equal(battle.phase, 'finished');
  assert.ok(Tactics.verify(state, battle), 'stance ledger records reconstruct the cancellation and preserved charge');
  assert.equal(Game.settle(state, battle).ok, true);
});
