'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function campaign(env) {
  const state = env.Game.newGame();
  state.gold = 100000;
  state.food = 1000000;
  state.alliances = [...new Set(state.castles.map(castle => castle.clan))].filter(id => id !== state.playerClan);
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 12]));
  return state;
}
function arrange(env, state, castleId, commanderId) {
  return env.Game.arrange(state, castleId, { ...clone(state.armies[castleId]), commanderId });
}
function rejectWithoutChange(env, state, castleId, commanderId) {
  const before = clone(state);
  const result = arrange(env, state, castleId, commanderId);
  assert.equal(result.ok, false, `${commanderId} must not command ${castleId}`);
  assert.equal(result.state, state, 'a rejected appointment returns the submitted campaign');
  assert.deepEqual(clone(state), before, 'rejection preserves officers, armies, resources and every castle order');
  return result;
}
function positions(state) {
  return Object.fromEntries(state.officers.filter(officer => officer.clan === state.playerClan).map(officer => [officer.id, officer.castleId]));
}
function ownArmies(state) {
  return Object.fromEntries(state.castles.filter(castle => castle.clan === state.playerClan).map(castle => [castle.id, clone(state.armies[castle.id])]));
}

test('a commander stationed at another castle cannot be appointed or moved implicitly', () => {
  const env = runtime(), state = campaign(env);
  assert.equal(state.officers.find(officer => officer.id === 'oda_nobunaga').castleId, 'kiyosu');
  const result = rejectWithoutChange(env, state, 'inuyama', 'oda_nobunaga');
  assert.match(result.message, /配置|所属|在城|この城|同じ城/);
  assert.equal(state.armies.kiyosu.commanderId, 'oda_nobunaga', 'the source command remains assigned');
});

test('an unassigned officer must be stationed explicitly before becoming a castle commander', () => {
  const env = runtime(), state = campaign(env);
  state.officers.find(officer => officer.id === 'shibata_katsuie').castleId = null;
  rejectWithoutChange(env, state, 'kiyosu', 'shibata_katsuie');
  assert.equal(state.officers.find(officer => officer.id === 'shibata_katsuie').castleId, null);
});

test('local command candidates must be active adult retainers of the castle owner', () => {
  const env = runtime(), original = campaign(env);
  const variants = [
    { clan: 'saito' },
    { status: 'captive', capturedBy: 'saito' },
    { status: 'dead' },
    { status: 'unborn' },
    { status: 'child' },
    { status: 'princess', gender: 'female', sex: 'female' },
    { status: 'ronin' },
    { birth: original.year - 14 },
    { capturedBy: 'saito' }
  ];
  for (const variant of variants) {
    const state = clone(original);
    Object.assign(state.officers.find(officer => officer.id === 'shibata_katsuie'), variant);
    rejectWithoutChange(env, state, 'kiyosu', 'shibata_katsuie');
  }
  rejectWithoutChange(env, original, 'kiyosu', 'missing-officer');
});

test('a local active retainer becomes eligible at fifteen without moving any retainer or troops', () => {
  const env = runtime(), state = campaign(env);
  state.officers.find(officer => officer.id === 'shibata_katsuie').birth = state.year - 15;
  const before = clone(state), homes = positions(state), armies = ownArmies(state);
  const result = arrange(env, state, 'kiyosu', 'shibata_katsuie');
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(clone(state), before, 'successful appointment also leaves its input immutable');
  assert.equal(result.state.armies.kiyosu.commanderId, 'shibata_katsuie');
  assert.deepEqual(positions(result.state), homes, 'appointing a commander never redistributes retainers');
  assert.deepEqual(clone(result.state.armies.kiyosu.units), armies.kiyosu.units);
  assert.deepEqual(clone(result.state.armies.inuyama), armies.inuyama);
  assert.equal(result.state.gold, before.gold);
  assert.equal(result.state.food, before.food);
  assert.equal(result.state.actionPoints, before.actionPoints);
  assert.equal(env.Game.validate(result.state), true);
});

test('explicit castle stationing clears the former command and permits a separate local appointment', () => {
  const env = runtime(), state = campaign(env);
  const stationed = env.context.TenkaRetainers.act(state, { type: 'station', officerId: 'oda_nobunaga', castleId: 'inuyama' });
  assert.equal(stationed.ok, true, stationed.message);
  assert.equal(stationed.state.officers.find(officer => officer.id === 'oda_nobunaga').castleId, 'inuyama');
  assert.equal(stationed.state.armies.kiyosu.commanderId, null);
  assert.equal(stationed.state.armies.inuyama.commanderId, state.armies.inuyama.commanderId, 'stationing alone does not replace the destination commander');
  assert.equal(env.context.TenkaOrders.remaining(stationed.state, 'kiyosu'), 2);
  const before = clone(stationed.state), result = arrange(env, stationed.state, 'inuyama', 'oda_nobunaga');
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state.armies.inuyama.commanderId, 'oda_nobunaga');
  assert.deepEqual(positions(result.state), positions(before));
  assert.deepEqual(clone(result.state.armies.kiyosu.units), before.armies.kiyosu.units);
  assert.deepEqual(clone(result.state.armies.inuyama.units), before.armies.inuyama.units);
  assert.equal(env.context.TenkaOrders.remaining(result.state, 'kiyosu'), 2);
  assert.equal(env.context.TenkaOrders.remaining(result.state, 'inuyama'), 3);
});

test('army inspection never uses a remote, unassigned or ineligible raw commander and never repairs by moving officers', () => {
  const env = runtime(), original = campaign(env);
  for (const variant of [
    { castleId: 'kiyosu' },
    { castleId: null },
    { castleId: 'inuyama', status: 'dead' },
    { castleId: 'inuyama', status: 'captive', capturedBy: 'saito' },
    { castleId: 'inuyama', birth: original.year - 14 },
    { castleId: 'inuyama', clan: 'saito' }
  ]) {
    const state = clone(original);
    Object.assign(state.officers.find(officer => officer.id === 'shibata_katsuie'), variant);
    state.armies.inuyama.commanderId = 'shibata_katsuie';
    const before = clone(state), army = env.Game.army(state, 'inuyama');
    assert.equal(army.commanderId, null, JSON.stringify(variant));
    assert.equal(army.commander, null);
    assert.equal(army.commanderName, '城代');
    assert.deepEqual(clone(army.units), before.armies.inuyama.units);
    assert.deepEqual(clone(state), before);
  }
});

test('normal saved local appointments survive reload with locations, troops, resources and castle orders intact', () => {
  const env = runtime(), state = campaign(env);
  const stationed = env.context.TenkaRetainers.act(state, { type: 'station', officerId: 'oda_nobunaga', castleId: 'inuyama' });
  assert.equal(stationed.ok, true, stationed.message);
  const appointed = arrange(env, stationed.state, 'inuyama', 'oda_nobunaga');
  assert.equal(appointed.ok, true, appointed.message);
  const before = clone(appointed.state);
  assert.equal(env.Game.save(appointed.state), true);
  const loaded = env.Game.load();
  assert.ok(loaded);
  assert.equal(env.Game.validate(loaded), true);
  assert.deepEqual(positions(loaded), positions(before));
  assert.deepEqual(ownArmies(loaded), ownArmies(before));
  for (const key of ['gold', 'food', 'year', 'month', 'turn', 'actionPoints']) assert.equal(loaded[key], before[key], key);
  for (const castle of loaded.castles.filter(castle => castle.clan === loaded.playerClan)) {
    assert.equal(env.context.TenkaOrders.remaining(loaded, castle.id), env.context.TenkaOrders.remaining(before, castle.id));
    const commanderId = loaded.armies[castle.id].commanderId;
    if (commanderId) assert.equal(loaded.officers.find(officer => officer.id === commanderId).castleId, castle.id);
  }
});

test('a malformed saved cross-castle appointment remains invalid instead of moving the commander during load', () => {
  const env = runtime(), state = campaign(env);
  assert.equal(env.Game.save(state), true);
  const [key, serialized] = [...env.values.entries()].find(([, value]) => {
    try { return JSON.parse(value).datasetId === state.datasetId; } catch { return false; }
  });
  const corrupt = JSON.parse(serialized);
  corrupt.armies.inuyama.commanderId = 'oda_nobunaga';
  const before = clone(corrupt);
  assert.equal(env.Game.validate(corrupt), false);
  assert.deepEqual(clone(corrupt), before, 'validation does not move or reassign a person');
  env.values.set(key, JSON.stringify(corrupt));
  assert.equal(env.Game.load(), null, 'an invalid save does not invent an implicit castle transfer');
  assert.deepEqual(clone(corrupt), before);
});
