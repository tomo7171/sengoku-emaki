'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped rules, data, integrations and save validator. Only the
// final React render is removed: rules tests require neither a DOM nor packages.
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).sort((left, right) => right.length - left.length)[0];
const render = [...script.matchAll(/\(0,\s*zv\.createRoot\)/g)].at(-1);
assert.ok(render, 'find the application render without replacing game rules');
script = script.slice(0, render.index) + '})();';
const context = vm.createContext({ console, setTimeout, clearTimeout, performance, URL });
context.window = context;
for (const filename of ['tenka-portraits.js', 'tenka-systems.js', 'tenka-dynasty.js', 'tenka-tactics.js', 'tenka-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
}
vm.runInContext(script, context, { filename: 'index.inline.js' });
const Game = context.TenkaGame;
const Tactics = context.TenkaTactics;
const Systems = context.TenkaSystems;
const clone = value => JSON.parse(JSON.stringify(value));
const castle = (state, id) => state.castles.find(item => item.id === id);
const total = units => Object.values(units).reduce((sum, number) => sum + number, 0);

function finish(input) {
  const battle = Game.startBattle(input);
  let batches = 0;
  while (battle.phase === 'fighting' && batches++ < 400) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished', 'a battle must reach a result');
  return battle;
}

function valid(state) {
  assert.equal(Game.validate(state), true, 'settled game remains accepted by the production save validator');
  for (const holding of state.castles) {
    assert.ok(holding.troops >= 0, holding.id + ' has nonnegative troops');
    const army = state.armies[holding.id];
    if (army) assert.ok(total(army.units) <= holding.troops, holding.id + ' does not duplicate soldiers');
  }
}

function garrison(state, id, units) {
  castle(state, id).troops = total(units);
  state.armies[id].units = { ...units };
}

function defenseState(largeGarrison) {
  const state = Game.newGame();
  garrison(state, 'inabayama', largeGarrison
    ? { ashigaru: 1000, archer: 300, cavalry: 100, firearm: 200, navy: 0 }
    : { ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 });
  garrison(state, 'kiyosu', largeGarrison
    ? { ashigaru: 3000, archer: 1500, cavalry: 0, firearm: 2000, navy: 0 }
    : { ashigaru: 250, archer: 100, cavalry: 0, firearm: 50, navy: 0 });
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', clan: castle(state, 'inabayama').clan };
  return state;
}

test('actual field battle replays formations and triggered ambushes, rejects altered records, and charges supplies once', () => {
  const state = Game.newGame(), snapshot = clone(state);
  let battle = Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' });
  const unit = battle.units.find(item => item.side === 'attacker' && item.type === 'ashigaru');
  let response = Tactics.formation(battle, unit.id, 'defensive');
  assert.equal(response.ok, true); battle = response.battle;
  response = Tactics.deploy(battle, { unitId: unit.id, x: -27, z: 22 });
  assert.equal(response.ok, true); battle = response.battle;
  response = Tactics.ambush(battle, unit.id);
  assert.equal(response.ok, true); battle = finish(response.battle);
  assert.ok(battle.events.some(event => event.text.includes('伏兵')));
  assert.ok(Tactics.verify(state, battle), 'valid ledger reconstructs the actual battle');
  const altered = clone(battle); altered.units[0].troops++;
  assert.equal(Tactics.verify(state, altered), null, 'editing survivors cannot create soldiers');
  const report = Game.report(battle);
  assert.ok(report.supplyConsumed > 0);
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); valid(settled.state);
  assert.equal(settled.state.food, state.food - 600 - report.supplyConsumed, 'base march cost and measured combat food are charged once');
  assert.equal(Systems.afterBattle(settled.state, state).food, settled.state.food, 'reprocessing the report cannot spend food again');
  assert.deepEqual(clone(state), snapshot, 'battle settlement preserves its input');
});

test('siege troops cross both breached Inabayama gates and capture the inner bailey', () => {
  const state = Game.newGame();
  garrison(state, 'kiyosu', { ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 });
  garrison(state, 'inabayama', { ashigaru: 250, archer: 100, cavalry: 0, firearm: 50, navy: 0 });
  const battle = finish(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'siege' }));
  assert.equal(battle.winner, 'attacker', 'do not stall against the intact palisade beside a breached gate');
  const gates = battle.structures.filter(item => item.kind === 'gate');
  assert.equal(gates.length, 2);
  assert.ok(gates.every(gate => gate.hp === 0));
  assert.ok(Tactics.verify(state, battle));
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); valid(settled.state);
  assert.equal(castle(settled.state, 'inabayama').clan, state.playerClan);
  assert.ok(castle(settled.state, 'inabayama').troops > 0);
});

for (const force of ['mixed', 'firearms']) {
  test(`Nanao's overlapping baileys remain traversable after breaching all three gates (${force})`, () => {
    const state = Game.newGame();
    state.playerClan = 'jinbo';
    garrison(state, 'toyama', force === 'mixed'
      ? { ashigaru: 5000, archer: 2000, cavalry: 1000, firearm: 4000, navy: 0 }
      : { ashigaru: 0, archer: 0, cavalry: 0, firearm: 12000, navy: 0 });
    garrison(state, 'nanao', { ashigaru: 250, archer: 100, cavalry: 0, firearm: 50, navy: 0 });
    const snapshot = clone(state);
    const battle = Game.startBattle(Game.createBattle({ state, sourceId: 'toyama', targetId: 'nanao', mode: 'siege' }));
    let contestedHonmaru = false, defeatedBeforeOccupation = false, steps = 0;
    const occupied = () => battle.units.some(unit => unit.side === 'attacker' && unit.troops > 0
      && !['routed', 'destroyed', 'retreating'].includes(unit.status)
      && Math.abs(unit.x - battle.captureZone.x) <= battle.captureZone.width / 2
      && Math.abs(unit.z - battle.captureZone.z) <= battle.captureZone.depth / 2);
    while (battle.phase === 'fighting' && steps++ < 720) {
      Game.simulateTick(battle);
      battle.ledger.push({ kind: 'tick', steps: 1 });
      const fightingDefenders = battle.units.some(unit => unit.side === 'defender' && unit.troops > 0
        && !['routed', 'destroyed', 'retreating'].includes(unit.status) && unit.order !== 'retreat');
      if (occupied() && fightingDefenders) {
        contestedHonmaru = true;
        assert.equal(battle.phase, 'fighting', 'entering a defended bailey cannot grant an automatic victory');
      }
      if (!fightingDefenders && !occupied()) {
        defeatedBeforeOccupation = true;
        assert.equal(battle.phase, 'fighting', 'defeating the garrison still requires entering the main bailey');
      }
    }
    assert.equal(battle.phase, 'finished');
    assert.equal(battle.winner, 'attacker', 'do not time out at the overlapping rear palisade beside the second gate');
    assert.ok(battle.time < 180, 'the army physically reaches the objective before the siege time limit');
    const gates = battle.structures.filter(item => item.kind === 'gate');
    assert.equal(gates.length, 3);
    assert.ok(gates.every(gate => gate.hp === 0));
    assert.ok(occupied());
    if (force === 'mixed') assert.ok(contestedHonmaru, 'exercise a living garrison contesting the main bailey');
    else assert.ok(defeatedBeforeOccupation, 'exercise an annihilated garrison before the attackers enter the main bailey');
    assert.ok(Tactics.verify(state, battle), 'the repaired path reproduces exactly through the production command ledger');
    const altered = clone(battle); altered.units[0].x++;
    assert.equal(Tactics.verify(state, altered), null, 'moving a survivor in the finished record invalidates settlement');
    const settled = Game.settle(state, battle);
    assert.equal(settled.ok, true, settled.message); valid(settled.state);
    assert.equal(castle(settled.state, 'nanao').clan, state.playerClan);
    assert.ok(castle(settled.state, 'nanao').troops > 0);
    assert.deepEqual(clone(state), snapshot, 'settlement leaves the prebattle state untouched');
  });
}

test('player garrison obeys hold, replays a combat formation change and retains its castle on defensive victory', () => {
  const state = defenseState(true);
  let battle = Game.startBattle(Tactics.createDefense(state));
  assert.equal(battle.playerSide, 'defender');
  const unit = battle.units.find(item => item.side === 'defender');
  const position = { x: unit.x, z: unit.z };
  Game.simulateTick(battle); battle.ledger.push({ kind: 'tick', steps: 1 });
  assert.equal(unit.x, position.x); assert.equal(unit.z, position.z);
  const changed = Tactics.formation(battle, unit.id, 'defensive');
  assert.equal(changed.ok, true); battle = finish(changed.battle);
  assert.equal(battle.winner, 'defender');
  assert.ok(Tactics.verify(state, battle));
  const report = Game.report(battle), settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); valid(settled.state);
  assert.equal(settled.state.pendingDefense, null);
  assert.equal(settled.state.actionPoints, state.actionPoints, 'defense needs no discretionary action point');
  assert.equal(settled.state.food, state.food - report.supplyConsumed, 'a defending army pays measured combat food without an attack fee');
  assert.equal(castle(settled.state, 'kiyosu').clan, state.playerClan);
});

test('a lost player siege transfers actual ownership and a surviving garrison and clears the invasion', () => {
  const state = defenseState(false), originalClan = castle(state, 'kiyosu').clan;
  const battle = finish(Tactics.createDefense(state));
  assert.equal(battle.winner, 'attacker');
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); valid(settled.state);
  assert.equal(castle(settled.state, 'kiyosu').clan, castle(state, 'inabayama').clan);
  assert.ok(castle(settled.state, 'kiyosu').troops > 0);
  assert.equal(castle(state, 'kiyosu').clan, originalClan);
  assert.equal(settled.state.pendingDefense, null);
  assert.equal(settled.state.lastBattle.playerWon, false);
});

test('enemy strategic AI queues a playable siege and preserves it while domestic actions and time are blocked', () => {
  const state = Game.newGame();
  garrison(state, 'inabayama', { ashigaru: 3500, archer: 1000, cavalry: 500, firearm: 1000, navy: 0 });
  garrison(state, 'kiyosu', { ashigaru: 2500, archer: 1000, cavalry: 0, firearm: 1000, navy: 0 });
  Game.runAI(state);
  assert.ok(state.pendingDefense);
  valid(state);
  assert.equal(castle(state, state.pendingDefense.targetId).clan, state.playerClan, 'AI does not resolve player defense automatically');
  const pending = JSON.stringify(state.pendingDefense);
  Game.runAI(state);
  assert.equal(JSON.stringify(state.pendingDefense), pending);
  assert.equal(Game.action(state, 'develop', { castleId: 'kiyosu' }).ok, false);
  assert.equal(Game.season(state).state.turn, state.turn);
  const battle = Tactics.createDefense(state), unit = battle.units.find(item => item.side === 'defender');
  assert.equal(Tactics.deploy(battle, { unitId: unit.id, x: 0, z: 20 }).ok, false, 'defenders cannot deploy in the enemy home zone');
  assert.equal(Tactics.deploy(battle, { unitId: unit.id, x: unit.x, z: unit.z }).ok, true, 'the existing castle position is deployable');
});

test('combat supply exhaustion lowers morale and settles without negative food', () => {
  const state = Game.newGame(); state.food = 650;
  const battle = finish(Game.createBattle({ state, sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' }));
  assert.equal(battle.supply.attacker.exhausted, true);
  assert.ok(battle.events.some(event => event.text.includes('兵糧が尽き')));
  assert.ok(Game.report(battle).supplyConsumed > 50);
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); valid(settled.state);
  assert.equal(settled.state.food, 0);
});
