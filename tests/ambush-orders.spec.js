'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Tactics, context } = runtime();
const Auto = context.TenkaAutoBattle;
const castle = (state, id) => state.castles.find(item => item.id === id);

function hiddenBattle(mode = 'field', defending = false) {
  const state = Game.newGame();
  const sourceId = defending ? 'inabayama' : 'kiyosu', targetId = defending ? 'inuyama' : 'inabayama';
  state.playerClan = castle(state, defending ? targetId : sourceId).clan;
  state.alliances = [];
  for (const id of [sourceId, targetId]) {
    const amount = (id === targetId) === defending ? 5000 : 1500;
    castle(state, id).troops = amount;
    state.armies[id].units = { ashigaru: amount, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  }
  let battle = defending
    ? Tactics.createDefense(state, { sourceId, targetId, mode }, { controlMode: 'turns' })
    : Game.createBattle({ state, sourceId, targetId, mode, controlMode: 'turns' });
  const id = battle.units.find(item => item.side === battle.playerSide).id;
  for (const answer of [() => Tactics.assignCommander(battle, id, battle.friendlyOfficers[0].id),
    () => Tactics.confirmDeployment(battle, id), () => Tactics.ambush(battle, id)]) {
    const result = answer(); assert.equal(result.ok, true, result.message); battle = result.battle;
  }
  battle = Game.startBattle(battle);
  assert.equal(battle.phase, 'fighting', battle.deploymentError);
  assert.ok(battle.units.find(item => item.id === id).ambush);
  return { state, battle, id };
}

function verifyWithdrawal(state, battle) {
  const answer = battle.phase === 'finished' ? { ok: true, battle } : Tactics.withdrawBattle(battle);
  assert.equal(answer.ok, true, answer.message);
  assert.ok(Tactics.verify(state, answer.battle), 'concealment release is derived from replayable orders');
  const settled = answer.battle.defending ? Tactics.settleDefense(state, answer.battle) : Game.settle(state, answer.battle);
  assert.equal(settled.ok, true, settled.message);
  assert.ok(Game.validate(settled.state));
}

for (const [mode, defending, label] of [['field', false, 'field'], ['siege', false, 'siege'], ['siege', true, 'defense']]) {
  test(`${label}: explicit automatic advance releases a hidden ambush and moves instead of spending turns in place`, () => {
    let { state, battle, id } = hiddenBattle(mode, defending);
    const initial = clone(battle), unit = battle.units.find(item => item.id === id);
    const target = battle.units.find(item => item.side !== battle.playerSide);
    const next = Auto.advance(battle, { [id]: { action: 'attack', targetId: target.id } });
    assert.equal(next.ok, true, next.message);
    const moved = next.battle.units.find(item => item.id === id);
    assert.ok(Math.hypot(moved.x - unit.x, moved.z - unit.z) > .1, 'the accepted advance must actually leave the hiding place');
    assert.equal(moved.ambush, false); assert.equal(moved.revealed, true);
    assert.equal(next.battle.turnNumber, battle.turnNumber + 1);
    assert.ok(next.battle.supply[battle.playerSide].consumed > battle.supply[battle.playerSide].consumed);
    assert.deepEqual(clone(battle), initial, 'planning never mutates the input');
    verifyWithdrawal(state, next.battle);
  });
}

test('waiting and defending retain the ambush; rejected moves do not reveal a hidden unit', () => {
  const { battle, id } = hiddenBattle();
  const before = clone(battle);
  for (const order of ['wait', 'defend']) {
    const answer = Tactics.order(battle, { unitId: id, order });
    assert.equal(answer.ok, true, answer.message);
    const unit = answer.battle.units.find(item => item.id === id);
    assert.equal(unit.ambush, true); assert.equal(unit.revealed, false);
    const executed = Tactics.endTurn(answer.battle);
    assert.equal(executed.ok, true);
    const hidden = executed.battle.units.find(item => item.id === id);
    assert.equal(hidden.ambush, true); assert.equal(hidden.revealed, false);
    assert.equal(hidden.x, unit.x); assert.equal(hidden.z, unit.z);
  }
  const original = battle.units.find(item => item.id === id);
  const planned = Tactics.order(battle, { unitId: id, order: 'move', x: original.x + 1, z: original.z });
  assert.equal(planned.ok, true, planned.message);
  assert.equal(planned.battle.units.find(item => item.id === id).ambush, true);
  const cancelled = Tactics.order(planned.battle, { unitId: id, order: 'wait' });
  const stillHidden = Tactics.endTurn(cancelled.battle).battle.units.find(item => item.id === id);
  assert.equal(stillHidden.ambush, true, 'replacing a planned advance with wait preserves concealment');
  assert.equal(stillHidden.x, original.x); assert.equal(stillHidden.z, original.z);
  assert.equal(Tactics.order(battle, { unitId: id, order: 'move', x: 99999, z: 99999 }).ok, false);
  assert.deepEqual(clone(battle), before);
});

test('an explicit withdrawal can leave concealment and replay its surviving troops normally', () => {
  const { state, battle, id } = hiddenBattle();
  const answer = Tactics.order(battle, { unitId: id, order: 'retreat' });
  assert.equal(answer.ok, true, answer.message);
  const unit = answer.battle.units.find(item => item.id === id);
  assert.equal(unit.ambush, true); assert.equal(unit.revealed, false, 'planning alone does not expose an ambush');
  const executed = Tactics.endTurn(answer.battle);
  assert.equal(executed.ok, true, executed.message);
  assert.equal(executed.battle.units.find(item => item.id === id).ambush, false);
  assert.equal(executed.battle.units.find(item => item.id === id).revealed, true);
  verifyWithdrawal(state, executed.battle);
});

test('an ambush that has already sprung retains its earned bonus through the next explicit attack', () => {
  let { state, battle, id } = hiddenBattle('field', true);
  for (let turn = 0; turn < 15 && battle.phase === 'fighting'; turn++) {
    const own = battle.units.find(item => item.id === id);
    if (own.revealed && own.ambushUntil > battle.time) break;
    const waiting = Tactics.order(battle, { unitId: id, order: 'wait' });
    assert.equal(waiting.ok, true, waiting.message);
    const answer = Tactics.endTurn(waiting.battle);
    assert.equal(answer.ok, true, answer.message);
    battle = answer.battle;
  }
  const own = battle.units.find(item => item.id === id);
  const enemy = battle.units.find(item => item.side !== battle.playerSide);
  const expiry = own.ambushUntil, startTime = battle.time, enemyTroops = enemy.troops;
  assert.ok(own.revealed && expiry > startTime, 'the ordinary advancing enemy triggers the real ambush');
  const distance = Math.hypot(enemy.x - own.x, enemy.z - own.z);
  if (distance > own.range) {
    const budget = Tactics.turnView(battle, id).selected.movement;
    const step = Math.min(budget * .94, distance - own.range + .4);
    const move = Tactics.order(battle, { unitId: id, order: 'move',
      x: own.x + (enemy.x - own.x) * step / distance, z: own.z + (enemy.z - own.z) * step / distance });
    assert.equal(move.ok, true, move.message); battle = move.battle;
  }
  const attack = Tactics.order(battle, { unitId: id, order: 'attack', targetId: enemy.id });
  assert.equal(attack.ok, true, attack.message);
  const executed = Tactics.endTurn(attack.battle);
  assert.equal(executed.ok, true, executed.message);
  const after = executed.battle.units.find(item => item.id === id);
  assert.equal(after.ambushUntil, expiry, 'advancing does not erase an already active ambush bonus');
  assert.ok(after.lastAttackTime > startTime && after.lastAttackTime < expiry, 'the real attack occurs inside the earned bonus window');
  assert.ok(executed.battle.units.find(item => item.id === enemy.id).troops < enemyTroops);
  verifyWithdrawal(state, executed.battle);
});
