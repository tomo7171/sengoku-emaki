'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const castle = (state, id) => state.castles.find(item => item.id === id);
const total = units => Object.values(units).reduce((sum, value) => sum + value, 0);
const large = () => ({ ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 });
const small = () => ({ ashigaru: 250, archer: 100, cavalry: 0, firearm: 50, navy: 0 });
function garrison(state, id, units) {
  castle(state, id).troops = total(units);
  state.armies[id].units = units;
}
function scenario({ defending = false, win = true, mode = 'siege' } = {}) {
  const state = Game.newGame(), source = castle(state, 'kishidake'), target = castle(state, 'muranaka');
  state.playerClan = defending ? target.clan : source.clan;
  state.selectedCastleId = defending ? target.id : source.id;
  state.alliances = []; state.allianceExpires = {};
  state.npcPacts = state.npcPacts.filter(pair => !pair.includes(source.clan) || !pair.includes(target.clan));
  garrison(state, source.id, defending && win ? { ashigaru: 1000, archer: 300, cavalry: 100, firearm: 200, navy: 0 } : large());
  garrison(state, target.id, defending && win ? large() : small());
  if (defending) state.pendingDefense = { sourceId: source.id, targetId: target.id, mode, clan: source.clan };
  return { state, defending, mode };
}
function finish({ state, defending, mode }) {
  const battle = Game.startBattle(defending ? Tactics.createDefense(state) : Game.createBattle({ state, sourceId: 'kishidake', targetId: 'muranaka', mode }));
  while (battle.phase === 'fighting' && battle.fixedSteps < 4000) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished', 'the real battlefield reaches a result');
  return battle;
}
function validSaved(state) {
  assert.equal(Game.validate(state), true, 'the result passes every production save validator');
  assert.equal(Game.save(state), true);
  const loaded = Game.load();
  assert.ok(loaded); assert.equal(Game.validate(loaded), true);
  return loaded;
}
for (const mode of ['siege', 'field']) test(`Muranaka ${mode}: real victory reports, settles once, saves and permits the next season`, async () => {
  const fixture = scenario({ mode }), { state } = fixture, before = clone(state), battle = finish(fixture);
  assert.equal(battle.winner, 'attacker');
  assert.match(battle.events.at(-1).text, mode === 'siege' ? /城を制圧/ : /野戦に勝利/);
  const report = await Tactics.verifyAsync(context.TenkaOrders.sync(state, battle.sourceId), battle);
  assert.ok(report); assert.match(report.message, /村中城.*勝利/);
  const afterFinish = clone(battle);
  Game.simulateTick(battle);
  assert.deepEqual(clone(battle), afterFinish, 'finished battles cannot change after the result banner appears');
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message);
  assert.match(settled.state.lastBattle.message, /村中城.*勝利/);
  if (mode === 'siege') assert.equal(castle(settled.state, 'muranaka').clan, state.playerClan);
  else {
    assert.notEqual(castle(settled.state, 'muranaka').clan, state.playerClan, 'a field victory cannot grant the player a castle; other real NPCs can still invade afterward');
    assert.equal(settled.state.lastBattle.garrison, 0);
  }
  assert.equal(Game.settle(settled.state, battle).ok, false, 'repeating the result cannot spend supplies or transfer soldiers again');
  assert.deepEqual(clone(state), before, 'verification and settlement preserve the strategic input');
  const loaded = validSaved(settled.state), next = Game.season(loaded);
  assert.equal(next.state.turn, loaded.turn + 1, next.message);
  assert.equal(Game.validate(next.state), true);
});
for (const win of [true, false]) test(`Muranaka siege defense: ${win ? 'repelling the attacker' : 'losing the castle'} produces a valid result and clears the invasion`, async () => {
  const fixture = scenario({ defending: true, win }), { state } = fixture, battle = finish(fixture);
  assert.equal(battle.playerWon, win);
  assert.ok(await Tactics.verifyAsync(state, battle));
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message);
  assert.equal(settled.state.pendingDefense, null);
  assert.match(settled.state.lastBattle.message, win ? /村中城.*防衛成功/ : /村中城.*落城/);
  assert.equal(castle(settled.state, 'muranaka').clan, win ? state.playerClan : castle(state, 'kishidake').clan);
  const loaded = validSaved(settled.state);
  if (win) assert.equal(Game.season(loaded).state.turn, loaded.turn + 1);
  else assert.equal(loaded.gameOver, true, 'losing the last castle ends the campaign explicitly rather than leaving a pending siege');
});
test('a lost defensive Muranaka field battle reports defeat without falsely announcing a captured castle', async () => {
  const fixture = scenario({ defending: true, win: false, mode: 'field' }), battle = finish(fixture);
  const report = await Tactics.verifyAsync(fixture.state, battle);
  assert.ok(report); assert.match(report.message, /迎撃野戦は野戦敗北/); assert.doesNotMatch(report.message, /落城/);
  assert.doesNotMatch(battle.events.at(-1).text, /本郭を失い/);
  const settled = Game.settle(fixture.state, battle);
  assert.equal(settled.ok, true, settled.message);
  assert.equal(castle(settled.state, 'muranaka').clan, fixture.state.playerClan);
  assert.equal(settled.state.pendingDefense, null);
  validSaved(settled.state);
});
test('long Muranaka verification yields to the UI, then the exact verified battle can settle without replaying', async () => {
  const fixture = scenario();
  garrison(fixture.state, 'muranaka', { ashigaru: 4000, archer: 2500, cavalry: 1000, firearm: 2000, navy: 0 });
  const battle = finish(fixture), progress = [];
  let otherTaskRan = false;
  setTimeout(() => { otherTaskRan = true; }, 0);
  const state = context.TenkaOrders.sync(fixture.state, battle.sourceId);
  const report = await Tactics.verifyAsync(state, battle, { onProgress: value => progress.push(value) });
  assert.ok(report); assert.equal(otherTaskRan, true);
  assert.ok(progress.length > 3, 'long combat publishes incremental result-verification progress');
  assert.equal(progress[0].percent, 0); assert.equal(progress.at(-1).percent, 100);
  assert.ok(progress.some(value => value.percent > 0 && value.percent < 100));
  report.message = 'forged report';
  assert.notEqual(Tactics.verify(state, battle).message, report.message, 'callers cannot mutate the cached canonical report');
  const alteredState = clone(state); alteredState.gold++;
  assert.equal(Tactics.verify(alteredState, battle), null, 'the cache cannot bypass a changed strategic state');
  battle.units[0].troops++;
  assert.equal(Tactics.verify(state, battle), null, 'the cache cannot bypass a changed survivor record');
  battle.units[0].troops--;
  assert.equal(Game.settle(fixture.state, battle).ok, true);
});
test('cancellation or an input change during async replay never precredits a Muranaka result', async () => {
  const fixture = scenario(), battle = finish(fixture), before = clone(fixture.state);
  const signal = { aborted: false };
  const cancelled = await Tactics.verifyAsync(fixture.state, battle, { signal, onProgress: value => { if (value.percent > 0) signal.aborted = true; } });
  assert.equal(cancelled, null); assert.deepEqual(clone(fixture.state), before);
  let changed = false;
  const altered = await Tactics.verifyAsync(fixture.state, battle, { onProgress: value => { if (value.percent > 0 && !changed) { fixture.state.gold++; changed = true; } } });
  assert.equal(altered, null); assert.equal(changed, true);
  fixture.state.gold--;
  assert.ok(Tactics.verify(fixture.state, battle), 'an aborted verification has not changed the canonical ledger or rules');
  assert.equal(Game.settle(fixture.state, battle).ok, true);
});
