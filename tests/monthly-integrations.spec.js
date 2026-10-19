'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
function setup() {
  const env = runtime();
  if (!env.context.TenkaCalendar) vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-calendar.js'), 'utf8'), env.context, { filename: 'tenka-calendar.js' });
  return { ...env, Calendar: env.context.TenkaCalendar, Diplomacy: env.context.TenkaDiplomacy,
    Allies: env.context.TenkaAllies, Orders: env.context.TenkaOrders, Retainers: env.context.TenkaRetainers,
    Transfers: env.context.TenkaTransfers, Routes: env.context.TenkaRoutes };
}
function campaign(env) { return env.Calendar.migrate(env.Game.newGame()); }
function legacy(input) {
  const state = clone(input); delete state.month; delete state.tenka.calendar;
  return state;
}
const troops = state => Object.fromEntries(TYPES.map(type => [type,
  Object.values(state.armies).reduce((sum, army) => sum + army.units[type], 0)]));
function friend(state) {
  state.alliances = ['matsudaira']; state.allianceExpires = { matsudaira: state.turn + 4 };
  state.relations.matsudaira = 90; state.gold = 100000; state.food = 1000000;
  return state;
}

test('legacy diplomatic duration migrates once while current castle budgets and officer tasks remain spent', () => {
  const env = setup(), old = friend(legacy(campaign(env)));
  old.tenka.castleOrders.castles.kiyosu.remaining = 0;
  old.tenka.castleOrders.castles.inuyama.remaining = 2;
  old.tenka.assignments.oda_nobunaga = { turn: old.turn, type: 'reclaim', target: 'kiyosu' };
  const before = clone(old), migrated = env.Game.migrate(old);
  assert.equal(migrated.month, 3); assert.equal(migrated.turn, old.turn);
  assert.equal(migrated.allianceExpires.matsudaira, old.turn + 12);
  assert.deepEqual(clone(migrated.tenka.castleOrders), before.tenka.castleOrders);
  assert.deepEqual(clone(migrated.tenka.assignments), before.tenka.assignments);
  assert.deepEqual(clone(old), before, 'legacy migration cannot mutate the submitted save');
  const repeated = env.Calendar.migrate(migrated);
  assert.equal(repeated.allianceExpires.matsudaira, old.turn + 12);
  const initialized = env.Diplomacy.initialize(repeated);
  assert.equal(env.Orders.remaining(initialized, 'kiyosu'), 0);
  assert.match(env.Retainers.getView(initialized).officers.find(item => item.id === 'oda_nobunaga').reason, /今月.*来月/);
  const beforeExpiry = env.Diplomacy.initialize({ ...clone(initialized), turn: old.turn + 11 });
  assert.equal(env.Diplomacy.liveAlliance(beforeExpiry, 'matsudaira'), true);
  const atExpiry = env.Diplomacy.initialize({ ...clone(initialized), turn: old.turn + 12 });
  assert.equal(env.Diplomacy.liveAlliance(atExpiry, 'matsudaira'), false);
});

test('an unanswered allied request retains its identity, current-month expiry and advance lock through legacy migration', () => {
  const env = setup(), old = friend(legacy(campaign(env)));
  assert.equal(env.Allies.queueWar(old, 'okazaki', 'iwamura', 'siege'), true);
  const request = clone(old.tenka.allies.pending[0]), oldOrders = clone(old.tenka.castleOrders);
  const migrated = env.Game.migrate(old);
  assert.deepEqual(clone(migrated.tenka.allies.pending[0]), request);
  assert.equal(env.Allies.validate(migrated), true);
  assert.equal(migrated.tenka.allies.pending[0].expiresTurn, migrated.turn);
  assert.deepEqual(clone(migrated.tenka.castleOrders), oldOrders);
  let advances = 0;
  const hooked = env.Allies.install({ season: state => { advances++; return { ok: true, state: env.Calendar.advance(state) }; } });
  const denied = hooked.season(migrated);
  assert.equal(denied.ok, false); assert.equal(denied.state, migrated); assert.equal(advances, 0);
  assert.equal(migrated.gold, old.gold); assert.equal(migrated.food, old.food);
  assert.deepEqual(troops(migrated), troops(old));
});

test('reserved allied soldiers survive calendar migration and cancel once without provisions or order refunds', () => {
  const env = setup(), old = friend(legacy(campaign(env)));
  old.tenka.castleOrders.castles.kiyosu.remaining = 1;
  const args = { sourceId: 'kiyosu', targetId: 'inabayama', supportCastleId: 'okazaki', troops: 1000, mode: 'siege', defending: false };
  const before = clone(old), reserved = env.Allies.requestSupport(old, args);
  assert.equal(reserved.ok, true, reserved.message);
  const paid = clone(reserved.state), migrated = env.Game.migrate(paid);
  assert.equal(env.Allies.getSupports(migrated, args).length, 1);
  assert.equal(env.Game.validate(migrated), true);
  assert.equal(env.Game.save(migrated), true);
  const loaded = env.Game.load();
  assert.ok(loaded); assert.deepEqual(troops(loaded), troops(migrated));
  assert.equal(loaded.allianceExpires.matsudaira, migrated.allianceExpires.matsudaira);
  assert.equal(env.Allies.getSupports(loaded, args).length, 1);
  assert.equal(env.Allies.validate(migrated), true);
  assert.equal(env.Orders.remaining(migrated, 'kiyosu'), 1);
  assert.deepEqual(troops(migrated), troops(paid));
  const canceled = env.Allies.cancelSupport(migrated, { supportId: reserved.support.id });
  assert.equal(canceled.ok, true, canceled.message);
  assert.deepEqual(troops(canceled.state), troops(before));
  assert.equal(canceled.state.castles.find(item => item.id === 'okazaki').food, paid.castles.find(item => item.id === 'okazaki').food);
  assert.equal(env.Orders.remaining(canceled.state, 'kiyosu'), 1);
  assert.equal(canceled.state.gold, paid.gold); assert.equal(canceled.state.food, paid.food);
  assert.equal(env.Allies.cancelSupport(canceled.state, { supportId: reserved.support.id }).ok, false);
  assert.deepEqual(troops(env.Allies.initialize(canceled.state)), troops(before));
});

function tributary(env, monthly = true) {
  let state = campaign(env); if (!monthly) state = legacy(state);
  state.tenka.diplomacy.vassals.saito = { overlord: state.playerClan, active: true, turn: state.turn,
    year: state.year, lastTributeTurn: state.turn, tributeGold: 0, tributeFood: 0 };
  for (const home of state.castles.filter(item => item.clan === 'saito')) { home.gold = 6200; home.food = 16000; }
  return env.Diplomacy.initialize(state);
}
const stores = state => ['gold', 'food'].map(key => state[key] + state.castles.reduce((sum, home) => sum + home[key], 0));

test('monthly tribute transfers one third of the old seasonal levy once, including another month in the same season', () => {
  const env = setup(), initial = tributary(env), homes = initial.castles.filter(item => item.clan === 'saito');
  assert.equal(initial.allianceExpires.saito, initial.turn + 12);
  assert.equal(env.Diplomacy.advance(initial).gold, initial.gold, 'submission month is already settled');
  const due = env.Calendar.advance(initial), settled = env.Diplomacy.advance(due);
  assert.equal(due.season, initial.season, 'April remains in spring');
  assert.equal(settled.gold - due.gold, homes.length * 100);
  assert.equal(settled.food - due.food, homes.length * 100);
  assert.deepEqual(stores(settled), stores(due), 'tribute must move real surplus stores');
  assert.match(settled.logs[0].date, /4月/);
  assert.equal(env.Diplomacy.advance(settled).gold, settled.gold);
  const reloaded = JSON.parse(JSON.stringify(settled));
  assert.equal(env.Diplomacy.advance(reloaded).food, reloaded.food, 'reload cannot charge another monthly levy');
  const following = env.Diplomacy.advance(env.Calendar.advance(reloaded));
  assert.ok(following.tenka.diplomacy.vassals.saito.tributeGold > settled.tenka.diplomacy.vassals.saito.tributeGold);
  const ended = clone(reloaded); ended.tenka.diplomacy.vassals.saito.active = false;
  assert.equal(env.Diplomacy.advance(env.Calendar.advance(ended)).gold, ended.gold);
});

test('legacy standalone diplomacy still uses the original seasonal levy before calendar migration', () => {
  const env = setup(), initial = tributary(env, false), due = clone(initial);
  due.turn++; due.season++;
  const homes = due.castles.filter(item => item.clan === 'saito'), settled = env.Diplomacy.advance(due);
  assert.equal(initial.allianceExpires.saito, initial.turn + 4);
  assert.equal(settled.gold - due.gold, homes.length * 300);
  assert.equal(settled.food - due.food, homes.length * 300);
  assert.deepEqual(stores(settled), stores(due));
});

test('stationing and nearby troop transfers use the actual month in logs and retain independent castle budgets', () => {
  const env = setup(), state = campaign(env), stationed = env.Retainers.act(state, { type: 'station', officerId: 'oda_nobunaga', castleId: 'inuyama' });
  assert.equal(stationed.ok, true, stationed.message); assert.match(stationed.state.logs[0].date, /3月/);
  assert.equal(env.Orders.remaining(stationed.state, 'kiyosu'), 2);
  const before = clone(stationed.state), moved = env.Transfers.act(stationed.state, { sourceId: 'inuyama', targetId: 'kiyosu', troops: 600 });
  assert.equal(moved.ok, true, moved.message); assert.match(moved.state.logs[0].date, /3月/);
  assert.equal(env.Orders.remaining(moved.state, 'kiyosu'), 2); assert.equal(env.Orders.remaining(moved.state, 'inuyama'), 2);
  assert.deepEqual(troops(moved.state), troops(before));
  assert.equal(moved.state.food, before.food - env.Transfers.foodCost(600, 'land'));
  assert.equal(moved.state.castles.find(item => item.id === 'inuyama').troops, before.castles.find(item => item.id === 'inuyama').troops - 600);
  const exhausted = clone(moved.state); exhausted.tenka.castleOrders.castles.inuyama.remaining = 0;
  assert.match(env.Transfers.preview(exhausted, { sourceId: 'inuyama', targetId: 'kiyosu', troops: 1 }).reason, /今月/);
  assert.match(env.Routes.preview(exhausted, exhausted.castles.find(item => item.id === 'inuyama'), exhausted.castles.find(item => item.id === 'inabayama')).reason, /今月/);
});
