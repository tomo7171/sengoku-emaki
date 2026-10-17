'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const Allies = context.TenkaAllies;
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const total = units => TYPES.reduce((sum, type) => sum + (units[type] || 0), 0);
const holding = (state, id) => state.castles.find(castle => castle.id === id);
const counts = (units, side, field = 'troops') => Object.fromEntries(TYPES.map(type => [type,
  units.filter(unit => unit.side === side && unit.type === type).reduce((sum, unit) => sum + unit[field], 0)]));

function setup() {
  const state = Game.newGame();
  state.alliances = ['matsudaira'];
  state.allianceExpires = { matsudaira: state.turn + 4 };
  state.relations.matsudaira = 90;
  return state;
}
function garrison(state, id, units) {
  holding(state, id).troops = total(units);
  state.armies[id].units = { ...units };
}
function reserve(state, options = {}) {
  const response = Allies.requestSupport(state, { sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field',
    supportCastleId: 'okazaki', troops: 1000, ...options });
  assert.equal(response.ok, true, response.message);
  return response;
}
function finish(input) {
  const battle = Game.startBattle(input);
  let batches = 0;
  while (battle.phase === 'fighting' && batches++ < 700) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished', 'the actual joint army reaches a result');
  return battle;
}
function assertReports(state, battle) {
  const report = Game.report(battle), primary = battle.units.filter(unit => !unit.foreignSupport);
  const attackerInitial = counts(primary, 'attacker', 'maxTroops'), defenderInitial = counts(primary, 'defender', 'maxTroops');
  const attackerSurviving = counts(primary, 'attacker'), defenderSurviving = counts(primary, 'defender');
  assert.deepEqual(clone(report.attackerArmy.units), attackerInitial, 'native attack report owns no allied soldiers');
  assert.deepEqual(clone(report.defenderArmy.units), defenderInitial, 'native defense report owns no allied soldiers');
  assert.deepEqual(clone(report.survivingUnits), attackerSurviving, 'captured garrison can only use principal attackers');
  assert.equal(report.remainingAttackers, total(attackerSurviving));
  assert.equal(report.casualties, total(attackerInitial) - total(attackerSurviving));
  assert.equal(report.enemyCasualties, total(defenderInitial) - total(defenderSurviving));
  for (const type of TYPES) {
    assert.equal(report.casualtyUnits[type], attackerInitial[type] - attackerSurviving[type]);
    assert.equal(report.defenderCasualtyUnits[type], defenderInitial[type] - defenderSurviving[type]);
  }
  assert.equal(report.supportReports.length, 1);
  const support = report.supportReports[0], reservation = battle.supportCommitments[0];
  assert.equal(support.id, reservation.id); assert.equal(support.sourceId, 'okazaki');
  assert.equal(support.clan, 'matsudaira');
  assert.deepEqual(clone(support.committedUnits), clone(reservation.units));
  assert.deepEqual(clone(support.survivingUnits), counts(battle.units.filter(unit => unit.foreignSupport), battle.playerSide));
  for (const type of TYPES) assert.equal(support.casualtyUnits[type] + support.survivingUnits[type], reservation.units[type]);
  assert.equal(support.casualties + support.survivors, reservation.troops);
  assert.ok(Tactics.verify(state, battle), 'production replay reconstructs actual ally commitments and losses');
  return report;
}

test('reserved allied soldiers join the actual field army without inflating player deployment resources', () => {
  const original = setup(), baseline = Game.createBattle({ state: original, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  const { state, support } = reserve(original), snapshot = clone(state);
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  const allied = battle.units.filter(unit => unit.foreignSupport);
  assert.deepEqual(clone(battle.availableUnits), clone(baseline.availableUnits));
  assert.equal(battle.availableTroops, baseline.availableTroops);
  assert.deepEqual(counts(allied, 'attacker'), clone(support.units));
  assert.ok(allied.every(unit => unit.troops <= 600 && unit.commanderId === null
    && unit.supportClan === 'matsudaira' && unit.supportCastleId === 'okazaki' && unit.commanderName.includes('松平家')));
  assert.equal(holding(state, 'okazaki').troops, holding(original, 'okazaki').troops - support.troops);
  const guest = allied[0];
  for (const modification of [{ type: 'navy' }, { troops: guest.troops - 1 }, { commanderId: 'oda_nobunaga' }]) {
    assert.equal(Tactics.deploy(battle, { unitId: guest.id, ...modification }).ok, false, 'foreign unit ownership and roster are immutable');
  }
  let answer = Tactics.deploy(battle, { unitId: guest.id, x: guest.x, z: guest.z });
  assert.equal(answer.ok, true, answer.message); battle = answer.battle;
  const own = battle.units.find(unit => unit.side === 'attacker' && !unit.foreignSupport);
  answer = Tactics.deploy(battle, { unitId: own.id, x: own.x, z: own.z });
  assert.equal(answer.ok, true, answer.message);
  assert.deepEqual(clone(state), snapshot, 'battle planning never changes reserved strategic state');
});

test('joint attack reports real allied casualties separately and returns survivors once through a save round trip', () => {
  const { state } = reserve(setup());
  assert.equal(Game.save(state), true); const loaded = Game.load(); assert.ok(loaded);
  const snapshot = clone(loaded), battle = finish(Game.createBattle({ state: loaded, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' }));
  const report = assertReports(loaded, battle), support = report.supportReports[0];
  assert.ok(support.casualties > 0, 'allied soldiers actually exchange damage rather than applying a strategic bonus');
  const settled = Game.settle(loaded, battle);
  assert.equal(settled.ok, true, settled.message);
  const finalized = Allies.finalizeBattle(settled.state, report);
  assert.equal(finalized.ok, true, finalized.message);
  assert.equal(holding(finalized.state, 'okazaki').troops, holding(loaded, 'okazaki').troops + support.survivors);
  assert.equal(holding(finalized.state, 'kiyosu').troops, holding(loaded, 'kiyosu').troops - report.casualties - (report.garrison || 0));
  assert.deepEqual(clone(Allies.finalizeBattle(finalized.state, report).state), clone(finalized.state), 'reprocessing a report cannot duplicate returning allies');
  assert.equal(Game.validate(finalized.state), true);
  assert.equal(Game.save(finalized.state), true); assert.ok(Game.load());
  assert.deepEqual(clone(loaded), snapshot, 'battle settlement preserves the reserved input save');
  for (const mutate of [value => value.units.find(unit => unit.foreignSupport).troops++,
    value => value.units.find(unit => unit.foreignSupport).supportClan = 'oda',
    value => value.supportCommitments[0].units.ashigaru++, value => delete value.supportVersion]) {
    const forged = clone(battle); mutate(forged);
    assert.equal(Tactics.verify(loaded, forged), null, 'edited ally identities, survivors or reservations cannot forge a settlement');
  }
});

test('a victorious joint siege takes its captured garrison only from the principal army', () => {
  let state = setup();
  garrison(state, 'kiyosu', { ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 });
  garrison(state, 'inabayama', { ashigaru: 250, archer: 100, cavalry: 0, firearm: 50, navy: 0 });
  state = reserve(state, { mode: 'siege' }).state;
  const battle = finish(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'siege' }));
  assert.equal(battle.winner, 'attacker');
  const report = assertReports(state, battle), settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message);
  assert.equal(holding(settled.state, 'inabayama').clan, 'oda');
  const garrisonSize = Math.min(total(report.survivingUnits), Math.max(200, Math.floor(total(report.survivingUnits) * .38)));
  assert.equal(holding(settled.state, 'inabayama').troops, garrisonSize);
  assert.equal(holding(settled.state, 'kiyosu').troops, holding(state, 'kiyosu').troops - report.casualties - garrisonSize);
  assert.equal(holding(settled.state, 'okazaki').troops, holding(state, 'okazaki').troops + report.supportReports[0].survivors);
  assert.equal(Game.validate(settled.state), true);
});

for (const win of [true, false]) test(`allied defenders settle a ${win ? 'successful defense' : 'lost siege'} without transferring guests into the principal garrison`, () => {
  let state = setup();
  garrison(state, 'kiyosu', win ? { ashigaru: 2500, archer: 1000, cavalry: 0, firearm: 2000, navy: 0 }
    : { ashigaru: 150, archer: 30, cavalry: 0, firearm: 20, navy: 0 });
  garrison(state, 'inabayama', win ? { ashigaru: 1000, archer: 300, cavalry: 100, firearm: 200, navy: 0 }
    : { ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 });
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', clan: 'saito' };
  state = reserve(state, { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', defending: true, troops: win ? 1000 : 200 }).state;
  const battle = finish(Tactics.createDefense(state));
  assert.equal(battle.playerWon, win);
  const report = assertReports(state, battle), support = report.supportReports[0];
  assert.equal(report.playerSide, 'defender');
  assert.equal(battle.availableTroops, total(counts(battle.units.filter(unit => !unit.foreignSupport), 'defender', 'maxTroops')));
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message);
  const finalized = Allies.finalizeBattle(settled.state, report);
  assert.equal(finalized.ok, true, finalized.message);
  assert.equal(holding(finalized.state, 'okazaki').troops, holding(state, 'okazaki').troops + support.survivors);
  if (win) assert.equal(holding(finalized.state, 'kiyosu').troops, holding(state, 'kiyosu').troops - report.enemyCasualties);
  else {
    assert.equal(holding(finalized.state, 'kiyosu').clan, 'saito');
    assert.ok(holding(finalized.state, 'kiyosu').troops <= report.remainingAttackers, 'new enemy garrison cannot include player-side allied defenders');
  }
  assert.equal(Game.validate(finalized.state), true);
});

test('a reservation contributes only to its exact active engagement', () => {
  const { state } = reserve(setup());
  assert.equal(Allies.getSupports(state, { sourceId: 'kiyosu', targetId: 'inabayama', mode: 'siege' }).length, 0);
  assert.throws(() => Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'siege' }), /援軍|要請/,
    'a reservation must be cancelled before changing its engagement');
  const differentDefense = clone(state);
  differentDefense.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', clan: 'saito' };
  assert.throws(() => Tactics.createDefense(differentDefense), /援軍|要請/, 'direct defense entry also preserves reservation context');
  const expired = clone(state); expired.allianceExpires.matsudaira = expired.turn;
  assert.equal(Allies.getSupports(expired, { sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' }).length, 0);
  const reconciled = Allies.initialize(expired);
  const without = Game.createBattle({ state: reconciled, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  assert.equal(without.units.some(unit => unit.foreignSupport), false, 'expired alliances never recreate reserved combatants');
});
