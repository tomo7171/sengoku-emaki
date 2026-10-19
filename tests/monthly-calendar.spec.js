'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Calendar = require('../tenka-calendar.js');
const Orders = require('../tenka-orders.js');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function oldDate(turn = 1) {
  return { year: 1560 + Math.floor((turn - 1) / 4), season: (turn - 1) % 4, turn,
    playerClan: 'oda', selectedCastleId: 'kiyosu', actionPoints: 1,
    castles: [{ id: 'kiyosu', name: '清洲城', clan: 'oda' }, { id: 'inuyama', name: '犬山城', clan: 'oda' }],
    allianceExpires: { tokugawa: turn + 4 }, tenka: { assignments: { envoy: { turn, action: 'negotiation' } },
      castleOrders: { version: 1, turn, castles: { kiyosu: { clan: 'oda', remaining: 1 }, inuyama: { clan: 'oda', remaining: 0 } } } } };
}

test('the calendar begins in March and advances exactly one month through all seasonal boundaries', () => {
  let state = Calendar.migrate(oldDate());
  assert.equal(Calendar.date(state), '1560年3月（春）');
  assert.equal(Calendar.format(state), Calendar.date(state));
  assert.equal(Calendar.period(state), 12);
  const expected = [[4, 0, 1560], [5, 0, 1560], [6, 1, 1560], [7, 1, 1560], [8, 1, 1560], [9, 2, 1560],
    [10, 2, 1560], [11, 2, 1560], [12, 3, 1560], [1, 3, 1561], [2, 3, 1561], [3, 0, 1561]];
  for (let index = 0; index < expected.length; index++) {
    const next = Calendar.nextDate(state);
    assert.deepEqual([next.month, next.season, next.year], expected[index]);
    assert.equal(next.turn, index + 2);
    assert.equal(state.turn, index + 1, 'reading the next date never mutates the current month');
    state = Calendar.advance(state);
    assert.equal(Calendar.validDate(state), true);
  }
});

test('old quarterly saves migrate at their existing date without restoring orders or changing active task turns', () => {
  for (const turn of [1, 2, 3, 4, 37, 40]) {
    const saved = oldDate(turn), before = clone(saved), migrated = Calendar.migrate(saved);
    assert.equal(Calendar.period(saved), 4);
    assert.equal(Calendar.validDate(saved), true);
    assert.equal(migrated.month, [3, 6, 9, 12][saved.season]);
    assert.deepEqual([migrated.year, migrated.season, migrated.turn, migrated.actionPoints], [saved.year, saved.season, saved.turn, saved.actionPoints]);
    assert.deepEqual(migrated.tenka.assignments, saved.tenka.assignments);
    assert.deepEqual(migrated.tenka.castleOrders, saved.tenka.castleOrders);
    assert.equal(migrated.allianceExpires.tokugawa, turn + 12);
    assert.equal(Orders.remaining(migrated, 'kiyosu'), 1);
    assert.equal(Orders.remaining(migrated, 'inuyama'), 0);
    assert.equal(Calendar.validDate(migrated), true);
    assert.deepEqual(Calendar.migrate(Calendar.migrate(migrated)), migrated, 'repeated migration never extends an alliance again');
    assert.deepEqual(saved, before, 'migration leaves the loaded object available for rollback');
    assert.equal(Calendar.validDate(Calendar.advance(migrated)), true);
  }
});

test('each castle restores its three orders next month even when the season stays the same', () => {
  let state = Calendar.migrate(oldDate());
  state.tenka.castleOrders.castles.kiyosu.remaining = 0;
  state = Orders.sync(state);
  assert.equal(Orders.remaining(state, 'kiyosu'), 0);
  assert.equal(Orders.remaining(state, 'inuyama'), 0);
  assert.equal(Orders.remaining(Orders.sync(Calendar.migrate(state)), 'kiyosu'), 0, 'migration is not a new month');
  const next = Orders.sync(Calendar.advance(state));
  assert.deepEqual([state.month, next.month, state.season, next.season], [3, 4, 0, 0]);
  assert.equal(Orders.remaining(next, 'kiyosu'), 3);
  assert.equal(Orders.remaining(next, 'inuyama'), 3);
  next.tenka.castleOrders.castles.kiyosu.remaining = 1;
  assert.equal(Orders.remaining(Orders.sync(next), 'kiyosu'), 1, 'selection and repeated sync cannot reset the monthly allowance');
});

test('date validation rejects skipped turns, invalid month-season pairs and corrupt migration anchors', () => {
  const state = Calendar.migrate(oldDate(13));
  for (const patch of [{ month: 0 }, { month: 13 }, { month: 3.5 }, { season: 3 }, { turn: state.turn + 1 }, { year: 1901 }]) {
    const invalid = { ...clone(state), ...patch };
    assert.equal(Calendar.validDate(invalid), false, JSON.stringify(patch));
  }
  for (const patch of [{ baseTurn: state.turn + 1 }, { baseTurn: 0 }, { baseMonth: 13 }, { baseYear: 1561 }, { version: 2 }]) {
    const invalid = clone(state); Object.assign(invalid.tenka.calendar, patch);
    assert.equal(Calendar.validDate(invalid), false, JSON.stringify(patch));
  }
  const legacy = oldDate(13); legacy.year++;
  assert.equal(Calendar.validDate(legacy), false);
  assert.equal(Calendar.migrate(legacy).month, undefined, 'invalid old dates are not silently repaired');
  const missing = clone(state); delete missing.month;
  assert.equal(Calendar.validDate(missing), false, 'monthly saves cannot revert to quarterly validation by removing the month');
});

test('native new game, monthly orders and save/load keep dates and spent commands together', () => {
  const { Game } = runtime();
  let state = Game.newGame();
  assert.deepEqual([state.year, state.month, state.season, state.turn], [1560, 3, 0, 1]);
  state.gold = 1000000; state.food = 1000000;
  state.alliances = [...new Set(state.castles.map(item => item.clan))].filter(id => id !== state.playerClan);
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 12]));
  for (const item of state.castles.filter(item => item.clan === state.playerClan)) state.tenka.castleOrders.castles[item.id].remaining = 0;
  state = Orders.sync(state);
  assert.equal(Game.save(state), true);
  const loaded = Game.load();
  assert.ok(loaded);
  assert.equal(Orders.total(loaded), 0);
  assert.equal(loaded.month, 3);
  const next = Game.season(loaded).state;
  assert.deepEqual([next.year, next.month, next.season, next.turn], [1560, 4, 0, 2]);
  for (const item of next.castles.filter(item => item.clan === next.playerClan)) assert.equal(Orders.remaining(next, item.id), 3);
  assert.equal(Game.validate(next), true);
  assert.equal(Game.save(next), true);
  assert.equal(Game.load().month, 4);
  const invalid = clone(next); invalid.month = 7;
  assert.equal(Game.validate(invalid), false);
  assert.equal(Game.save(invalid), false);
});

test('native legacy saves retain exhausted castles, officer task locks and remaining alliance duration', () => {
  const { Game, values } = runtime();
  let state = Game.newGame();
  delete state.month; delete state.tenka.calendar;
  state.year = 1560; state.season = 2; state.turn = 3;
  state.tenka.castleOrders.turn = state.turn;
  for (const item of state.castles.filter(item => item.clan === state.playerClan)) state.tenka.castleOrders.castles[item.id].remaining = 0;
  state.actionPoints = 0;
  state.alliances = ['matsudaira']; state.allianceExpires = { matsudaira: state.turn + 2 };
  const person = state.officers.find(item => item.clan === state.playerClan && item.status === 'active');
  state.tenka.assignments[person.id] = { turn: state.turn, type: 'reclaim', targetId: 'kiyosu' };
  assert.equal(Game.validate(state), true);
  const migrated = Game.migrate(state);
  assert.deepEqual([migrated.year, migrated.month, migrated.season, migrated.turn], [1560, 9, 2, 3]);
  assert.equal(migrated.allianceExpires.matsudaira, 9);
  assert.equal(migrated.tenka.assignments[person.id].turn, 3);
  assert.equal(Orders.total(migrated), 0);
  assert.equal(Game.validate(migrated), true);
  assert.equal(Game.save(migrated), true);
  const loaded = Game.load();
  assert.ok(loaded);
  assert.equal(loaded.allianceExpires.matsudaira, 9);
  assert.equal(Orders.total(loaded), 0);
  // A browser upgrading from the old release reads the original JSON directly,
  // before any caller explicitly invokes Game.migrate.
  const storageKey = [...values.keys()][0];
  assert.ok(storageKey);
  values.set(storageKey, JSON.stringify(state));
  const upgraded = Game.load();
  assert.ok(upgraded);
  assert.equal(upgraded.month, 9);
  assert.equal(upgraded.allianceExpires.matsudaira, 9);
  assert.equal(Orders.total(upgraded), 0);
  assert.equal(upgraded.tenka.assignments[person.id].turn, 3);
  assert.equal(Game.validate(upgraded), true);
});
