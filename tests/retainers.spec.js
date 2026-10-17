'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function setup() {
  const env = runtime();
  if (!env.context.TenkaRetainers) vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-retainers.js'), 'utf8'), env.context);
  return { ...env, Retainers: env.context.TenkaRetainers, Orders: env.context.TenkaOrders };
}
function campaign(env) {
  const state = env.Game.newGame();
  // Prevent unrelated strategic attacks in tests of native army organization.
  state.alliances = [...new Set(state.castles.map(item => item.clan))].filter(id => id !== state.playerClan);
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 4]));
  state.gold = 100000; state.food = 1000000;
  return state;
}
const station = (env, state, officerId = 'oda_nobunaga', castleId = 'inuyama') => env.Retainers.act(state, { type: 'station', officerId, castleId });

test('player stationing changes the canonical location, clears old command, and preserves the destination commander', () => {
  const env = setup(), state = campaign(env), before = clone(state);
  const destinationCommander = state.armies.inuyama.commanderId;
  const result = station(env, state);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(clone(state), before, 'the submitted campaign is immutable');
  assert.equal(result.state.officers.find(item => item.id === 'oda_nobunaga').castleId, 'inuyama');
  assert.equal(result.state.armies.kiyosu.commanderId, null);
  assert.equal(result.state.armies.inuyama.commanderId, destinationCommander);
  assert.deepEqual(clone(result.state.armies.kiyosu.units), before.armies.kiyosu.units, 'troops are not teleported with an officer');
  assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 2);
  assert.equal(env.Orders.remaining(result.state, 'inuyama'), 3);
  assert.equal(result.state.logs[0].title, '武将の城配置');
  assert.equal(env.Game.validate(result.state), true);
});

test('multiple officers may share a castle; all commands debit their actual source and cannot borrow another castle budget', () => {
  const env = setup(); let state = campaign(env);
  for (const id of ['oda_nobunaga', 'shibata_katsuie', 'niwa_nagahide']) {
    const result = station(env, state, id); assert.equal(result.ok, true, result.message); state = result.state;
  }
  assert.equal(env.Orders.remaining(state, 'kiyosu'), 0);
  assert.equal(env.Orders.remaining(state, 'inuyama'), 3);
  assert.equal(state.officers.filter(item => ['oda_nobunaga', 'shibata_katsuie', 'niwa_nagahide'].includes(item.id) && item.castleId === 'inuyama').length, 3);
  const forgedCompatibility = { ...state, actionPoints: 3, selectedCastleId: 'inuyama' };
  const refused = station(env, forgedCompatibility, 'kinoshita_tokichiro');
  assert.equal(refused.ok, false); assert.match(refused.message, /清洲城.*0／3/);
  assert.equal(refused.state, forgedCompatibility);
  const returned = station(env, state, 'oda_nobunaga', 'kiyosu');
  assert.equal(returned.ok, true, returned.message);
  assert.equal(env.Orders.remaining(returned.state, 'inuyama'), 2);
  assert.equal(env.Orders.remaining(returned.state, 'kiyosu'), 0, 'the former castle never refills by moving officers');
});

test('same-castle, foreign, missing, captive, dead, unborn and underage assignments fail without mutation or cost', () => {
  const env = setup(), original = campaign(env);
  const cases = [
    [original, { officerId: 'oda_nobunaga', castleId: 'kiyosu' }],
    [original, { officerId: 'oda_nobunaga', castleId: 'inabayama' }],
    [original, { officerId: 'oda_nobunaga', castleId: 'unknown' }],
    [original, { officerId: 'unknown', castleId: 'inuyama' }],
    [original, { officerId: original.officers.find(item => item.clan !== original.playerClan && item.status === 'active').id, castleId: 'inuyama' }],
    [original, { officerId: 'oda_nobutada', castleId: 'inuyama' }],
    [original, { officerId: 'oda_tokuhime', castleId: 'inuyama' }]
  ];
  for (const extra of [{ status: 'captive', capturedBy: 'saito' }, { status: 'dead' }, { status: 'unborn' }, { birth: 1550 }, { birth: null }, { capturedBy: 'saito' }]) {
    const state = clone(original); Object.assign(state.officers.find(item => item.id === 'oda_nobunaga'), extra);
    cases.push([state, { officerId: 'oda_nobunaga', castleId: 'inuyama' }]);
  }
  for (const [state, action] of cases) {
    const before = clone(state), result = env.Retainers.act(state, { type: 'station', ...action });
    assert.equal(result.ok, false, JSON.stringify(action)); assert.equal(result.state, state);
    assert.deepEqual(clone(state), before);
  }
});

test('a seasonal assignment prevents moving its officer; after the season expires stationing remains usable for government', () => {
  const env = setup(); let state = campaign(env);
  state.tenka.assignments.oda_nobunaga = { turn: state.turn, type: 'reclaim', target: 'kiyosu' };
  assert.equal(station(env, state).ok, false);
  const view = env.Retainers.getView(state).officers.find(item => item.id === 'oda_nobunaga');
  assert.equal(view.busy, true); assert.equal(view.available, false); assert.match(view.reason, /任務中/);
  state.turn++; state.season++;
  const moved = station(env, state); assert.equal(moved.ok, true, moved.message);
  assert.equal(env.Retainers.getView(moved.state).officers.find(item => item.id === 'oda_nobunaga').available, true, 'stationing alone does not lock an entire season');
  const domestic = env.Systems.act(moved.state, { type: 'reclaim', castleId: 'inuyama', officerId: 'oda_nobunaga' });
  assert.equal(domestic.ok, true, domestic.message);
  assert.equal(env.Orders.remaining(domestic.state, 'kiyosu'), 2);
  assert.equal(env.Orders.remaining(domestic.state, 'inuyama'), 2);
});

test('pending invasion and reinforcement decisions block changes that would invalidate the armies', () => {
  const env = setup(), base = campaign(env);
  for (const variant of ['defense', 'support', 'custom']) {
    const state = clone(base);
    if (variant === 'defense') state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' };
    if (variant === 'support') state.tenka.allies = { version: 1, pending: [{ id: 'ally-war' }] };
    if (variant === 'custom') env.Retainers.configure({ movementBlocker: () => '合戦の準備中です。' });
    const before = clone(state), result = station(env, state);
    assert.equal(result.ok, false); assert.equal(result.state, state); assert.deepEqual(clone(state), before);
    const view = env.Retainers.getView(state); assert.equal(view.blocked, true); assert.equal(view.officers.some(item => item.available), false);
    env.Retainers.configure({});
  }
});

test('the roster lists current locations and every owned destination without changing anyone automatically', () => {
  const env = setup(), state = campaign(env), before = clone(state);
  const view = env.Retainers.getView(state);
  assert.equal(view.cost, 1); assert.equal(view.blocked, false);
  assert.deepEqual(clone(view.castles.map(item => item.id)).sort(), clone(state.castles.filter(item => item.clan === state.playerClan).map(item => item.id)).sort());
  const head = view.officers.find(item => item.id === 'oda_nobunaga');
  assert.equal(head.castleName, '清洲城'); assert.equal(head.sourceCastleId, 'kiyosu'); assert.equal(head.remaining, 3);
  assert.equal(view.officers.some(item => ['oda_nobutada', 'oda_tokuhime'].includes(item.id)), false);
  assert.deepEqual(clone(state), before);
  assert.deepEqual(clone(env.Retainers.initialize(state).officers), before.officers, 'initialization never redistributes retainers');
});

test('saved positions and source order costs survive load and legacy initialization; a stationed officer can explicitly command the new army', () => {
  const env = setup(); let state = campaign(env);
  const moved = station(env, state); assert.equal(moved.ok, true, moved.message); state = moved.state;
  assert.equal(env.Game.save(state), true);
  const loaded = env.Game.load(); assert.ok(loaded);
  assert.equal(loaded.officers.find(item => item.id === 'oda_nobunaga').castleId, 'inuyama');
  assert.equal(loaded.armies.kiyosu.commanderId, null); assert.equal(env.Orders.remaining(loaded, 'kiyosu'), 2);
  const arranged = env.Game.arrange(loaded, 'inuyama', { ...clone(loaded.armies.inuyama), commanderId: 'oda_nobunaga' });
  assert.equal(arranged.ok, true, arranged.message); assert.equal(arranged.state.armies.inuyama.commanderId, 'oda_nobunaga');
  assert.equal(env.Game.validate(arranged.state), true);
  const legacy = clone(state); delete legacy.tenka.castleOrders; legacy.actionPoints = 1;
  const initialized = env.Retainers.initialize(legacy);
  assert.equal(initialized.officers.find(item => item.id === 'oda_nobunaga').castleId, 'inuyama');
  assert.equal(env.Orders.remaining(initialized, 'kiyosu'), 1);
  assert.equal(env.Orders.remaining(initialized, 'inuyama'), 1);
});

test('an adult recruit without an assigned castle is stationed at the selected own command castle without borrowing foreign commands', () => {
  const env = setup(), state = campaign(env);
  state.officers.find(item => item.id === 'shibata_katsuie').castleId = null;
  state.selectedCastleId = 'inuyama';
  const result = station(env, state, 'shibata_katsuie', 'kiyosu');
  assert.equal(result.ok, true, result.message);
  assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 3);
  assert.equal(env.Orders.remaining(result.state, 'inuyama'), 2);
  assert.equal(result.state.officers.find(item => item.id === 'shibata_katsuie').castleId, 'kiyosu');
});
