'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function setup() {
  const env = runtime();
  if (!env.context.TenkaOrders) vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-orders.js'), 'utf8'), env.context);
  const Orders = env.context.TenkaOrders, Game = env.Game;
  if (!Game.newGame().tenka?.castleOrders) {
    Object.assign(Game, Orders.install({ ...Game, migrate: Game.migrate, chooseClan: env.Systems.chooseClan }));
  }
  return { ...env, Orders };
}
function campaign(env) {
  const { Game, Orders } = env;
  let state = Game.newGame();
  const a = state.castles.find(item => item.clan === state.playerClan);
  let b = state.castles.find(item => item.clan === state.playerClan && item.id !== a.id);
  if (!b) {
    b = state.castles.find(item => item.id !== a.id);
    for (const person of state.officers.filter(item => item.castleId === b.id)) {
      person.castleId = state.castles.find(item => item.clan === person.clan && item.id !== b.id)?.id || null;
    }
    b.clan = state.playerClan; b.clanName = a.clanName; b.color = a.color;
    state.armies[b.id].commanderId = null;
    state.tenka.castleOrders.castles[b.id] = { clan: state.playerClan, remaining: 3 };
  }
  state.gold = 1000000; state.food = 1000000;
  state.alliances = [...new Set(state.castles.map(item => item.clan))].filter(id => id !== state.playerClan);
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 4]));
  for (const id of state.alliances) state.relations[id] = 75;
  const model = state.officers.find(item => item.clan === state.playerClan && item.status === 'active');
  for (let index = 0; index < 6; index++) state.officers.push({ ...clone(model), id: `orders-delegate-${index}`, name: `命令試験${index}`, castleId: a.id, birth: 1530, isKin: false });
  state.selectedCastleId = a.id; state = Orders.sync(state);
  return { state, a: a.id, b: b.id };
}
function use(env, state, type, castleId, options) {
  const result = env.Game.action(state, type, castleId, options);
  assert.equal(result.ok, true, result.message);
  return result.state;
}
function finish(env, battle) {
  battle = env.Game.startBattle(battle);
  for (let batch = 0; battle.phase === 'fighting' && batch < 500; batch++) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) env.Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished');
  return battle;
}

test('each castle has three native commands, with no refill from selection or compatibility actionPoints', () => {
  const env = setup(), { Orders, Game } = env;
  let { state, a, b } = campaign(env), original = JSON.stringify(state);
  for (let count = 0; count < 3; count++) state = use(env, state, 'develop', a);
  assert.equal(Orders.remaining(state, a), 0);
  assert.equal(Orders.remaining(state, b), 3);
  assert.equal(Game.action(state, 'develop', a).ok, false);
  const selected = Orders.sync({ ...state, selectedCastleId: b });
  assert.equal(selected.actionPoints, 3);
  assert.equal(Orders.remaining(Orders.sync({ ...selected, selectedCastleId: a, actionPoints: 3 }), a), 0);
  for (let count = 0; count < 3; count++) state = use(env, state, 'develop', b);
  assert.equal(Orders.remaining(state, b), 0);
  assert.equal(Game.action(state, 'develop', b).ok, false);
  assert.ok(JSON.parse(original).castles.find(item => item.id === a).kokudaka < state.castles.find(item => item.id === a).kokudaka);
});

test('save/load and legacy migration preserve spent commands; next season refreshes every castle once', () => {
  const env = setup(), { Game, Orders } = env;
  let { state, a, b } = campaign(env);
  delete state.tenka.castleOrders; state.actionPoints = 1;
  state = Game.migrate(state);
  assert.equal(Orders.remaining(state, a), 1); assert.equal(Orders.remaining(state, b), 1);
  state = use(env, state, 'develop', a);
  state.selectedCastleId = b;
  assert.equal(Game.save(state), true);
  const loaded = Game.load();
  assert.ok(loaded); assert.equal(loaded.actionPoints, 1);
  assert.equal(Orders.remaining(loaded, a), 0); assert.equal(Orders.remaining(loaded, b), 1);
  const next = Game.season(loaded).state;
  assert.equal(next.turn, loaded.turn + 1);
  for (const item of next.castles.filter(item => item.clan === next.playerClan)) assert.equal(Orders.remaining(next, item.id), 3);
  const spent = use(env, next, 'develop', b);
  assert.equal(Orders.remaining(Game.migrate(Game.migrate(spent)), b), 2, 'migration is not a new season');
  assert.equal(Game.validate(spent), true);
});

test('native training and castle repair charge the commanded castle and rejected commands spend nothing', () => {
  const env = setup(), { Orders, Game } = env;
  let { state, a, b } = campaign(env);
  state.castles.find(item => item.id === a).defense = 40;
  state = use(env, state, 'train', a);
  state = use(env, state, 'repair', a);
  assert.equal(Orders.remaining(state, a), 1); assert.equal(Orders.remaining(state, b), 3);
  const poor = { ...state, gold: 0 }, refused = Game.action(poor, 'develop', b);
  assert.equal(refused.ok, false); assert.equal(refused.state, poor);
  assert.equal(Orders.remaining(refused.state, b), 3);
});

test('council administration and diplomacy debit a chosen own castle, never the enemy target', () => {
  const env = setup(), { Orders, Systems } = env;
  let { state, a, b } = campaign(env);
  for (let count = 0; count < 3; count++) {
    const result = Systems.act(state, { type: 'reclaim', castleId: a, orderCastleId: a, officerId: `orders-delegate-${count}` });
    assert.equal(result.ok, true, result.message); state = result.state;
  }
  assert.equal(Orders.remaining(state, a), 0); assert.equal(Orders.remaining(state, b), 3);
  const borrowed = Systems.act(state, { type: 'reclaim', castleId: a, orderCastleId: b, officerId: 'orders-delegate-3' });
  assert.equal(borrowed.ok, false, 'another castle cannot lend commands to repeat work in an exhausted castle');
  const enemy = state.castles.find(item => item.clan !== state.playerClan);
  state.alliances = state.alliances.filter(id => id !== enemy.clan);
  const denied = Systems.act(state, { type: 'negotiation', castleId: enemy.id, orderCastleId: enemy.id, officerId: 'orders-delegate-3' });
  assert.equal(denied.ok, false);
  const result = Systems.act(state, { type: 'negotiation', castleId: enemy.id, orderCastleId: b, officerId: 'orders-delegate-3' });
  assert.equal(result.ok, true, result.message);
  assert.equal(Orders.remaining(result.state, a), 0); assert.equal(Orders.remaining(result.state, b), 2);
});

test('automatic strategic attacks charge their own source even when a different castle is exhausted', () => {
  const env = setup(), { Game, Orders } = env;
  let { state, a, b } = campaign(env);
  state.tenka.castleOrders.castles[a].remaining = 0; state = Orders.sync(state, a);
  const source = state.castles.find(item => item.id === b);
  const target = state.castles.find(item => source.neighbors.includes(item.id) && item.clan !== state.playerClan);
  assert.ok(target);
  state.alliances = state.alliances.filter(id => id !== target.clan);
  source.troops = 6000; target.troops = 300;
  state.armies[b].units = { ashigaru: 6000, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  state.armies[target.id].units = { ashigaru: 300, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  const result = Game.action(state, 'attack', target.id, { sourceId: b, mode: 'field' });
  assert.equal(result.ok, true, result.message);
  assert.equal(Orders.remaining(result.state, a), 0); assert.equal(Orders.remaining(result.state, b), 2);
});

test('a forced defense remains playable with no castle commands and spends no seasonal action', () => {
  const env = setup(), { Game, Orders, Tactics } = env;
  let state = Game.newGame();
  for (const entry of Object.values(state.tenka.castleOrders.castles)) if (entry.clan === state.playerClan) entry.remaining = 0;
  state = Orders.sync(state);
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' };
  const battle = finish(env, Tactics.createDefense(state));
  const result = Game.settle(state, battle);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.state.pendingDefense, null);
  assert.equal(Orders.total(result.state), 0);
  assert.equal(Game.settle(result.state, battle).ok, false);
});

test('recruitment uses the selected castle budget while free household decisions remain free', () => {
  const env = setup(), { Orders, Dynasty } = env;
  let { state, a, b } = campaign(env);
  state.tenka.castleOrders.castles[a].remaining = 0; state = Orders.sync(state, a);
  const candidate = Dynasty.getView(state).recruits.find(item => item.commandCost === 1);
  assert.ok(candidate);
  assert.equal(Dynasty.act(state, { type: 'recruit', candidateId: candidate.id, orderCastleId: a }).ok, false);
  const result = Dynasty.act(state, { type: 'recruit', candidateId: candidate.id, orderCastleId: b });
  assert.equal(result.ok, true, result.message);
  assert.equal(Orders.remaining(result.state, a), 0); assert.equal(Orders.remaining(result.state, b), 2);
  const hired = result.state.officers.find(item => item.id === candidate.officerId)
    || result.state.officers.find(item => item.clan === state.playerClan && !state.officers.some(before => before.id === item.id));
  assert.equal(hired.castleId, b, 'the selected command castle receives the hired officer');
  const heir = Dynasty.getView(result.state).eligibleHeirs[0];
  if (heir) {
    const appointed = Dynasty.act(result.state, { type: 'appointHeir', targetOfficerId: heir.id, orderCastleId: a });
    assert.equal(appointed.ok, true, appointed.message);
    assert.equal(Orders.remaining(appointed.state, a), 0); assert.equal(Orders.remaining(appointed.state, b), 2);
  }
});

test('tactical creation reserves no command, settlement charges only its source, and replay cannot spend twice', () => {
  const env = setup(), { Orders, Game } = env;
  let state = Game.newGame();
  state.gold = 1000000; state.food = 1000000;
  state.tenka.castleOrders.castles.kiyosu.remaining = 0;
  state.selectedCastleId = 'kiyosu'; state = Orders.sync(state);
  assert.equal(state.actionPoints, 0, 'the selected castle has exhausted its commands');
  const source = state.castles.find(item => item.id === 'inuyama'), target = state.castles.find(item => item.id === 'inabayama');
  source.troops = 4000; target.troops = 800;
  state.armies[source.id].units = { ashigaru: 4000, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  state.armies[target.id].units = { ashigaru: 800, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  const before = clone(state), created = Game.createBattle({ state, sourceId: source.id, targetId: target.id, mode: 'field' });
  assert.deepEqual(clone(state), before);
  assert.equal(Orders.remaining(state, source.id), 3);
  const battle = finish(env, created), result = Game.settle(state, battle);
  assert.equal(result.ok, true, result.message);
  assert.equal(Orders.remaining(result.state, source.id), 2);
  assert.equal(Orders.remaining(result.state, 'kiyosu'), 0);
  assert.equal(Game.settle(result.state, battle).ok, false);
  const changed = clone(state); changed.tenka.castleOrders.castles[source.id].remaining--;
  assert.equal(Game.settle(changed, battle).ok, false, 'changing the castle ledger invalidates its battle stamp');
});

test('castle ownership transfer cannot refill orders before the next season, and malformed ledgers fail validation', () => {
  const env = setup(), { Orders, Game } = env;
  let { state, a } = campaign(env);
  state.tenka.castleOrders.castles[a].remaining = 0;
  const other = state.castles.find(item => item.clan !== state.playerClan).clan;
  const captured = clone(state); captured.castles.find(item => item.id === a).clan = other;
  const lost = Orders.sync(captured);
  lost.castles.find(item => item.id === a).clan = state.playerClan;
  const retaken = Orders.sync(lost);
  assert.equal(Orders.remaining(retaken, a), 0);
  const advanced = clone(retaken); advanced.turn++; advanced.season++;
  assert.equal(Orders.remaining(Orders.sync(advanced), a), 3);
  for (const malformed of [4, -1, 1.5, '3']) {
    const invalid = clone(state); invalid.tenka.castleOrders.castles[a].remaining = malformed;
    assert.equal(Game.validate(invalid), false);
    assert.equal(Game.save(invalid), false);
  }
  const future = clone(state); future.tenka.castleOrders.turn++;
  assert.equal(Game.validate(future), false);
});
