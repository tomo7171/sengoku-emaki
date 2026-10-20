'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const Auto = context.TenkaAutoBattle;
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
const live = unit => unit.troops > 0 && !['routed', 'destroyed'].includes(unit.status);
const ours = battle => battle.units.filter(unit => unit.side === battle.playerSide && live(unit));
const theirs = battle => battle.units.filter(unit => unit.side !== battle.playerSide);
const list = (targets, after = []) => ({ action: 'attack', targetId: targets[0],
  sequence: targets.map((targetId, index) => ({ targetId, after: after[index] || 'next' })),
  sequenceIndex: 0, sequencePaused: false });
function fixture(mode = 'field', defending = false, options = {}) {
  const state = Game.newGame(), sourceId = mode === 'siege' ? 'hinoe' : 'kiyosu';
  const targetId = mode === 'siege' ? 'muranaka' : 'inabayama';
  const castle = id => state.castles.find(item => item.id === id);
  state.playerClan = castle(defending ? targetId : sourceId).clan;
  for (const [id, numbers] of [[sourceId, defending ? options.enemy || { ashigaru: 400, archer: 400, cavalry: 400 }
    : options.friendly || { firearm: 12000 }], [targetId, defending ? options.friendly || { firearm: 12000 }
    : options.enemy || { ashigaru: 40, archer: 40, cavalry: 40 }]]) {
    state.armies[id].units = Object.fromEntries(TYPES.map(type => [type, numbers[type] || 0]));
    castle(id).troops = Object.values(state.armies[id].units).reduce((sum, count) => sum + count, 0);
  }
  let battle = defending ? Tactics.createDefense(state, { sourceId, targetId, mode }, { controlMode: 'turns' })
    : Game.createBattle({ state, sourceId, targetId, mode, controlMode: 'turns' });
  for (const [index, unit] of Tactics.deploymentStatus(battle).units.entries()) {
    if (!unit.foreignSupport) {
      const assigned = Tactics.assignCommander(battle, unit.id, battle.friendlyOfficers[index].id);
      assert.equal(assigned.ok, true, assigned.message); battle = assigned.battle;
    }
    const placed = Tactics.confirmDeployment(battle, unit.id);
    assert.equal(placed.ok, true, placed.message); battle = placed.battle;
  }
  battle = Game.startBattle(battle);
  assert.equal(battle.phase, 'fighting', battle.deploymentError);
  return { state, battle };
}
function advance(battle, orders) {
  const before = clone(battle), beforeOrders = clone(orders);
  const answer = Auto.advance(battle, orders);
  assert.equal(answer.ok, true, answer.message);
  assert.deepEqual(clone(battle), before, 'battle input stays immutable');
  assert.deepEqual(clone(orders), beforeOrders, 'sequence input stays immutable');
  assert.equal(answer.battle.turnNumber, battle.turnNumber + 1);
  assert.equal(answer.battle.ledger.filter(item => item.kind === 'turn-end').length,
    battle.ledger.filter(item => item.kind === 'turn-end').length + 1, 'one legal native turn only');
  return answer;
}
function runUntil(battle, orders, predicate, limit = 120) {
  let answer;
  for (let turn = 0; turn < limit && battle.phase === 'fighting' && !predicate(battle, orders); turn++) {
    answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  }
  assert.ok(predicate(battle, orders), 'the explicitly configured sequence reaches the expected state');
  return { battle, orders, answer };
}
function finish(state, battle) {
  if (battle.phase !== 'finished') {
    const withdrawn = Tactics.withdrawBattle(battle);
    assert.equal(withdrawn.ok, true, withdrawn.message); battle = withdrawn.battle;
  }
  assert.ok(Tactics.verify(state, battle), 'normal native replay accepts the entire battle');
  return battle;
}

test('all sequence slots and progress are validated before any unit spends a turn or food', () => {
  const { battle } = fixture('field', false, { friendly: { firearm: 12000, archer: 1000 } });
  const [first, second] = ours(battle), targets = theirs(battle).map(unit => unit.id), valid = list(targets);
  const malformed = [
    { ...valid, sequence: [] }, { ...valid, sequence: [...valid.sequence, valid.sequence[0]] },
    { ...valid, sequence: [valid.sequence[0], null] }, { ...valid, sequence: [{ targetId: targets[0], after: 'charge' }] },
    { ...valid, sequence: [{ targetId: targets[0], after: 'next' }, { targetId: 'unknown-enemy', after: 'next' }] },
    { ...valid, sequence: [{ targetId: targets[0], after: 'next' }, { targetId: first.id, after: 'wait' }] },
    { ...valid, sequence: [{ targetId: targets[0], after: 'next' }, { targetId: 'capture', after: 'wait' }] },
    { ...valid, sequence: [valid.sequence[0], valid.sequence[0]] },
    { ...valid, sequenceIndex: -1 }, { ...valid, sequenceIndex: 4 }, { ...valid, sequenceIndex: .5 },
    { ...valid, sequenceIndex: undefined }, { ...valid, sequencePaused: 'false' },
    { ...valid, sequencePaused: true }, { ...valid, sequenceIndex: 1 },
    { ...valid, action: 'wait', targetId: undefined },
    { ...valid, action: 'retreat', targetId: undefined, sequenceIndex: 1 },
    { ...valid, action: 'wait', targetId: undefined, sequenceIndex: 3, sequencePaused: true },
    { ...valid, action: 'defend', targetId: undefined, sequenceIndex: 3 },
    { ...valid, action: 'wait', targetId: undefined, sequenceIndex: 1, sequencePaused: true,
      sequence: [{ targetId: targets[0], after: 'wait' }, { targetId: targets[1], after: 'next' },
        { targetId: 'missing-later-target', after: 'wait' }] },
    { ...valid, action: 'wait', targetId: undefined, sequenceIndex: 3,
      sequence: [{ targetId: targets[0], after: 'next' }, { targetId: targets[1], after: 'next' },
        { targetId: 'missing-completed-target', after: 'wait' }] },
    { action: 'attack', targetId: targets[0], sequenceIndex: 0, sequencePaused: false }
  ];
  const before = clone(battle);
  for (const instruction of malformed) {
    const orders = { [first.id]: { action: 'defend' }, [second.id]: instruction };
    const answer = Auto.advance(battle, orders);
    assert.equal(answer.ok, false, JSON.stringify(instruction));
    assert.equal(answer.battle, battle); assert.equal(answer.orders, orders);
    assert.deepEqual(clone(battle), before);
  }
});

for (const [mode, defending] of [['field', false], ['siege', true]]) {
  test(`${defending ? 'defensive siege' : 'field'} follows three explicit enemies, one native turn at a time`, async () => {
    let { state, battle } = fixture(mode, defending);
    const unit = ours(battle)[0], targets = theirs(battle).map(item => item.id);
    let orders = { [unit.id]: list(targets, ['next', 'next', 'wait']) }, previousIndex = 0;
    const transitionTurns = [];
    for (let turn = 0; turn < 150 && battle.phase === 'fighting'; turn++) {
      const before = battle, answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
      const progress = orders[unit.id];
      if (progress.sequenceIndex > previousIndex) {
        transitionTurns.push(battle.turnNumber);
        const commands = battle.ledger.slice(before.ledger.length).filter(item => item.kind === 'turn-order'
          && item.command.unitId === unit.id && item.command.order === 'attack');
        assert.ok(commands.length <= 1, 'completing an objective never issues another attack in the same turn');
        assert.ok(commands.every(item => item.command.targetId === targets[previousIndex]));
      }
      previousIndex = progress.sequenceIndex;
    }
    assert.equal(battle.phase, 'finished'); assert.equal(battle.winner, battle.playerSide);
    assert.equal(orders[unit.id].sequenceIndex, 3); assert.equal(orders[unit.id].sequencePaused, false);
    assert.equal(orders[unit.id].action, 'wait'); assert.equal(orders[unit.id].targetId, undefined);
    assert.equal(new Set(transitionTurns).size, 3);
    assert.deepEqual(clone(orders[unit.id].sequence), clone(list(targets, ['next', 'next', 'wait']).sequence));
    assert.ok(Tactics.verify(state, battle)); assert.ok(await Tactics.verifyAsync(state, battle));
    const report = Game.report(battle);
    assert.equal(report.supplyConsumed, Math.ceil(battle.supply[battle.playerSide].consumed));
    const settled = Game.settle(state, battle);
    assert.equal(settled.ok, true, settled.message); assert.equal(Game.validate(settled.state), true);
    assert.equal(Game.save(settled.state), true); assert.ok(Game.load());
    assert.equal(Game.settle(settled.state, battle).ok, false);
    const altered = clone(battle); altered.units.find(item => item.id === unit.id).troops++;
    assert.equal(Tactics.verify(state, altered), null);
    assert.ok(battle.ledger.every(item => ['deploy', 'start', 'turn-order', 'turn-end'].includes(item.kind)));
  });
}

test('attacking siege sequences a real gate, defending troops and the explicit castle capture goal', () => {
  let { state, battle } = fixture('siege');
  const unit = ours(battle)[0], gate = battle.structures.find(item => item.kind === 'gate');
  const target = theirs(battle)[0], targets = [gate.id, target.id, 'capture'];
  let orders = { [unit.id]: list(targets, ['next', 'next', 'next']) };
  ({ battle, orders } = runUntil(battle, orders, current => current.phase === 'finished'));
  assert.equal(battle.winner, 'attacker'); assert.equal(battle.structures.find(item => item.id === gate.id).hp, 0);
  assert.equal(orders[unit.id].sequenceIndex, 3); assert.equal(orders[unit.id].action, 'wait');
  assert.equal(orders[unit.id].sequencePaused, false);
  finish(state, battle);
  const settled = Game.settle(state, battle);
  assert.equal(settled.ok, true, settled.message); assert.equal(Game.validate(settled.state), true);
});

test('wait after the first objective stays paused until that unit explicitly resumes its next target', () => {
  let { state, battle } = fixture();
  const unit = ours(battle)[0], targets = theirs(battle).map(item => item.id);
  let orders = { [unit.id]: list(targets, ['wait', 'next', 'defend']) };
  ({ battle, orders } = runUntil(battle, orders, (_, current) => current[unit.id].sequencePaused));
  assert.equal(orders[unit.id].sequenceIndex, 1); assert.equal(orders[unit.id].action, 'wait');
  const position = clone(battle.units.find(item => item.id === unit.id));
  for (let turn = 0; turn < 3; turn++) {
    const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    const waiting = battle.units.find(item => item.id === unit.id);
    assert.equal(waiting.x, position.x); assert.equal(waiting.z, position.z);
    assert.equal(orders[unit.id].sequenceIndex, 1); assert.equal(orders[unit.id].sequencePaused, true);
    assert.equal(waiting.stance, 'rest');
  }
  orders = { ...orders, [unit.id]: { ...orders[unit.id], sequencePaused: false,
    action: 'attack', targetId: targets[1] } };
  ({ battle, orders } = runUntil(battle, orders, (_, current) => current[unit.id].sequenceIndex === 3));
  assert.equal(orders[unit.id].action, 'defend'); assert.equal(orders[unit.id].sequencePaused, false);
  assert.equal(orders[unit.id].sequence.length, 3); finish(state, battle);
});

test('a defensive break holds position, then retreat after the second goal never resumes the third', () => {
  let { state, battle } = fixture();
  const unit = ours(battle)[0], targets = theirs(battle).map(item => item.id);
  let orders = { [unit.id]: list(targets, ['defend', 'retreat', 'next']) };
  ({ battle, orders } = runUntil(battle, orders, (_, current) => current[unit.id].sequencePaused));
  const position = clone(battle.units.find(item => item.id === unit.id));
  for (let turn = 0; turn < 2; turn++) {
    const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    const waiting = battle.units.find(item => item.id === unit.id);
    assert.equal(waiting.stance, 'brace'); assert.equal(waiting.x, position.x); assert.equal(waiting.z, position.z);
    assert.equal(orders[unit.id].sequenceIndex, 1);
  }
  orders = { ...orders, [unit.id]: { ...orders[unit.id], action: 'attack', targetId: targets[1], sequencePaused: false } };
  ({ battle, orders } = runUntil(battle, orders, (_, current) => current[unit.id].action === 'retreat'));
  assert.equal(orders[unit.id].sequenceIndex, 2); assert.equal(orders[unit.id].sequencePaused, false);
  for (let turn = 0; turn < 4 && battle.phase === 'fighting'; turn++) {
    const answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
    assert.equal(orders[unit.id].action, 'retreat'); assert.equal(orders[unit.id].sequenceIndex, 2);
  }
  assert.ok(live(battle.units.find(item => item.id === targets[2])));
  finish(state, battle);
});

test('a goal defeated by another unit is acknowledged before issuing only one attack at the next target', () => {
  let { state, battle } = fixture('field', false, { friendly: { firearm: 12000, archer: 1000 } });
  const gun = ours(battle).find(item => item.type === 'firearm'), bow = ours(battle).find(item => item.type === 'archer');
  const targets = theirs(battle).map(item => item.id);
  let orders = { [gun.id]: { action: 'attack', targetId: targets[0] } };
  ({ battle, orders } = runUntil(battle, orders, current => !live(current.units.find(item => item.id === targets[0]))));
  orders = { [gun.id]: { action: 'wait' }, [bow.id]: list(targets) };
  const before = battle, answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  assert.equal(orders[bow.id].sequenceIndex, 1); assert.equal(orders[bow.id].targetId, targets[1]);
  const attacks = battle.ledger.slice(before.ledger.length).filter(item => item.kind === 'turn-order'
    && item.command.unitId === bow.id && item.command.order === 'attack');
  assert.ok(attacks.length <= 1); assert.ok(attacks.every(item => item.command.targetId === targets[1]));
  assert.equal(orders[gun.id].sequence, undefined); assert.equal(orders[gun.id].action, 'wait');
  finish(state, battle);
});

test('completed plans retain progress safely, while a simple replacement clears the sequence', () => {
  let { state, battle } = fixture('field', false, { enemy: { ashigaru: 40, archer: 40, cavalry: 40, firearm: 3000 } });
  const unit = ours(battle)[0], targets = theirs(battle).filter(item => item.type !== 'firearm').map(item => item.id);
  let orders = { [unit.id]: list(targets, ['next', 'next', 'next']) };
  ({ battle, orders } = runUntil(battle, orders, (_, current) => current[unit.id].sequenceIndex === 3));
  assert.equal(battle.phase, 'fighting'); assert.equal(orders[unit.id].action, 'wait');
  const completed = clone(orders[unit.id]);
  let answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  assert.deepEqual(clone(orders[unit.id]), completed); assert.equal(answer.notices.length, 0);
  answer = advance(battle, { [unit.id]: list(targets) }); battle = answer.battle; orders = answer.orders;
  assert.equal(orders[unit.id].sequenceIndex, 3); assert.equal(orders[unit.id].action, 'wait');
  answer = advance(battle, { [unit.id]: list(targets, ['wait', 'next', 'next']) }); battle = answer.battle; orders = answer.orders;
  assert.equal(orders[unit.id].sequenceIndex, 1, 'a wait break stops even when several subsequent goals are already defeated');
  assert.equal(orders[unit.id].sequencePaused, true);
  answer = advance(battle, orders); battle = answer.battle; orders = answer.orders;
  assert.equal(orders[unit.id].sequenceIndex, 1, 'global auto advancement cannot resume the waiting sequence');
  orders = { ...orders, [unit.id]: { ...orders[unit.id], action: 'attack', targetId: targets[1], sequencePaused: false } };
  answer = advance(battle, orders); battle = answer.battle;
  assert.equal(answer.orders[unit.id].sequenceIndex, 3, 'explicit resume acknowledges the two already completed remaining goals');
  answer = advance(battle, { [unit.id]: { action: 'defend' } }); battle = answer.battle;
  assert.deepEqual(clone(answer.orders[unit.id]), { action: 'defend' });
  assert.equal(battle.units.find(item => item.id === unit.id).stance, 'brace');
  finish(state, battle);
});

test('routed goals count as complete, but invalid later goals on inactive units still reject the whole turn', () => {
  let { battle } = fixture();
  const unit = ours(battle)[0], targets = theirs(battle).map(item => item.id);
  // Read-only planning fixture: the actual native replay cases above produce
  // defeats through legal combat. Here distinguish routed status from zero hp.
  battle = clone(battle); battle.units.find(item => item.id === targets[0]).status = 'routed';
  const answer = advance(battle, { [unit.id]: list(targets, ['wait', 'next', 'next']) });
  assert.equal(answer.orders[unit.id].sequenceIndex, 1); assert.equal(answer.orders[unit.id].sequencePaused, true);
  const inactive = clone(battle); inactive.units.find(item => item.id === unit.id).status = 'routed';
  const invalid = list([targets[0], 'missing-target']);
  const denied = Auto.advance(inactive, { [unit.id]: invalid });
  assert.equal(denied.ok, false); assert.equal(denied.battle, inactive);
});

test('defending units reject an unattainable later castle-capture or friendly gate goal before planning', () => {
  const { battle } = fixture('siege', true), unit = ours(battle)[0], enemy = theirs(battle)[0];
  const gate = battle.structures.find(item => item.kind === 'gate');
  for (const targetId of ['capture', gate.id]) {
    const orders = { [unit.id]: list([enemy.id, targetId]) }, before = clone(battle);
    const answer = Auto.advance(battle, orders);
    assert.equal(answer.ok, false); assert.equal(answer.battle, battle); assert.equal(answer.orders, orders);
    assert.deepEqual(clone(battle), before);
  }
});
