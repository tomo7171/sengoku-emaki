'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function assertPlayableHouse(Game, Dynasty, state, clanId) {
  assert.equal(state.playerClan, clanId, clanId + ': selected house');
  const castle = state.castles.find(c => c.id === state.selectedCastleId);
  assert.ok(castle, clanId + ': selected castle exists');
  assert.equal(castle.clan, clanId, clanId + ': selected castle belongs to the player');
  const army = state.armies[castle.id];
  assert.ok(army, clanId + ': selected castle has an army');
  const commander = state.officers.find(o => o.id === army.commanderId);
  assert.ok(commander, clanId + ': selected army has a commander');
  assert.equal(commander.clan, clanId, clanId + ': commander belongs to the house');
  assert.equal(commander.castleId, castle.id, clanId + ': commander is stationed in the selected castle');
  assert.equal(commander.status, 'active', clanId + ': commander is active');
  assert.ok(state.year - commander.birth >= 15, clanId + ': commander is an adult');
  const family = Dynasty.getView(state).family;
  assert.ok(family && family.head, clanId + ': house has a head');
  assert.equal(family.head.clan, clanId, clanId + ': head belongs to the selected house');
  assert.ok(['active', 'child'].includes(family.head.status), clanId + ': founding head is alive');
  // Tsutsui Junkei is eleven in 1560; his adult regent governs and commands.
  const ruler = family.head.adult ? family.head : family.regent;
  assert.ok(ruler, clanId + ': a child head has a regent');
  assert.equal(ruler.clan, clanId, clanId + ': governing adult belongs to the house');
  assert.equal(ruler.status, 'active', clanId + ': governing adult is active');
  assert.ok(ruler.adult, clanId + ': an adult governs the founding house');
  assert.equal(Game.validate(state), true, clanId + ': shipped save validator accepts the state');
}

test('all 72 starting daimyo can be chosen, command their own castle, and survive save/reload', () => {
  const { Game, Systems, Dynasty } = runtime();
  const clans = Object.keys(Game.clans);
  assert.equal(clans.length, 72, 'the full original set of starting daimyo remains available');
  for (const clanId of clans) {
    const fresh = Game.newGame(), original = clone(fresh);
    const result = Systems.chooseClan(fresh, clanId);
    assert.equal(result.ok, true, clanId + ': ' + result.message);
    assert.deepEqual(clone(fresh), original, clanId + ': selecting a house does not alter the source game');
    const state = Game.migrate(result.state);
    assertPlayableHouse(Game, Dynasty, state, clanId);
    assert.deepEqual(
      [state.year, state.season, state.turn, state.actionPoints, state.aiRound],
      [fresh.year, fresh.season, fresh.turn, fresh.actionPoints, fresh.aiRound],
      clanId + ': selection consumes neither a season nor a command and does not run the AI'
    );
    assert.equal(Object.keys(state.tenka.assignments).length, 0, clanId + ': all retainers begin without a seasonal task');
    assert.equal(Game.save(state), true, clanId + ': shipped save writer succeeds');
    const loaded = Game.load();
    assert.ok(loaded, clanId + ': shipped loader restores the chosen house');
    assertPlayableHouse(Game, Dynasty, loaded, clanId);
    assert.equal(loaded.selectedCastleId, state.selectedCastleId, clanId + ': selection persists');
    assert.equal(loaded.turn, state.turn, clanId + ': loading does not advance time');
    assert.equal(loaded.actionPoints, state.actionPoints, clanId + ': loading does not consume commands');
  }
});

test('a player can change the starting daimyo before issuing a command', () => {
  const { Game, Systems, Dynasty } = runtime();
  let state = Game.newGame();
  for (const clanId of ['shimazu', 'date', 'mori', 'takeda', 'oda']) {
    const result = Systems.chooseClan(state, clanId);
    assert.equal(result.ok, true, result.message);
    state = Game.migrate(result.state);
    assertPlayableHouse(Game, Dynasty, state, clanId);
    assert.equal(state.turn, 1);
    assert.equal(state.actionPoints, 3);
    assert.equal(state.aiRound, 0);
  }
});

test('changing house is rejected after a real command or season without modifying the campaign', () => {
  const { Game, Systems } = runtime();
  const commanded = Game.action(Game.newGame(), 'develop', 'kiyosu');
  assert.equal(commanded.ok, true, commanded.message);
  const nextSeason = Game.season(Game.newGame());
  for (const progressed of [commanded.state, nextSeason.state]) {
    const original = clone(progressed);
    const result = Systems.chooseClan(progressed, 'shimazu');
    assert.equal(result.ok, false, 'an ongoing campaign cannot switch to another house');
    assert.equal(result.state, progressed, 'rejection preserves the state object');
    assert.deepEqual(clone(result.state), original, 'rejection preserves progress and resources');
  }
});
