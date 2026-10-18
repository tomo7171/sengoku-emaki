'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { runtime, clone } = require('./helpers/game-runtime.cjs');

function setup() {
  const env = runtime();
  if (!env.context.TenkaDiplomacy) vm.runInContext(fs.readFileSync(path.join(__dirname, '../tenka-diplomacy.js'), 'utf8'), env.context);
  const Diplomacy = env.context.TenkaDiplomacy;
  if (!env.Game.diplomacy) Object.assign(env.Game, Diplomacy.install({ ...env.Game }), { diplomacy: Diplomacy });
  return { ...env, Diplomacy, Orders: env.context.TenkaOrders };
}
function campaign(env, year = 1560) {
  let state = env.Game.newGame();
  state.year = year; state.season = 0; state.turn = (year - 1560) * 4 + 1;
  state.gold = 100000; state.food = 1000000; state.prestige = 90;
  state = env.Game.migrate(state);
  // Test diplomatic choices without unrelated wars. The engine still runs its
  // actual seasonal income, dynasty, native validation and save/load routines.
  const clans = [...new Set(state.castles.map(item => item.clan))];
  state.npcPacts = clans.flatMap((first, index) => clans.slice(index + 1).map(second => [first, second]));
  state.alliances = ['matsudaira']; state.allianceExpires = { matsudaira: state.turn + 4 }; state.relations.matsudaira = 85;
  return env.Diplomacy.initialize(state);
}
function marriageAction(env, state, princessId = 'oda_tokuhime') {
  const target = env.Dynasty.marriageOptions(state, princessId).find(item => item.id === 'matsudaira');
  assert.ok(target, 'actual 18+ historical spouse exists in Matsudaira household');
  return { type: 'marry', princessId, spouseId: target.spouseId, targetClan: target.id, orderCastleId: 'inuyama' };
}
function weakNeighbor(env) {
  const state = campaign(env);
  state.alliances = []; state.allianceExpires = {};
  for (const home of state.castles.filter(item => item.clan === 'saito')) {
    home.troops = 300; state.armies[home.id].units = { ashigaru: 300, archer: 0, cavalry: 0, firearm: 0, navy: 0 };
  }
  state.relations.saito = 100;
  const possible = env.Diplomacy.getView(state).delegates.filter(item => item.available);
  for (const delegate of possible) {
    const action = { type: 'subjugate', targetClan: 'saito', officerId: delegate.id, orderCastleId: 'kiyosu' };
    const check = env.Diplomacy.preview(state, action); assert.equal(check.ok, true, check.message);
    const result = env.Diplomacy.act(state, action);
    if (result.ok && result.outcome === 'success') return { state, action, result };
  }
  throw Error('No deterministic successful historical envoy in fixture');
}

test('diplomacy marriage lists only actual adults and filters spouses for the selected princess', () => {
  const env = setup(), start = campaign(env), initial = clone(start);
  const view = env.Diplomacy.getView(start);
  assert.equal(view.princesses.some(item => item.eligible), false);
  assert.match(view.noMarriageMessage, /1577年.*十八歳/);
  assert.equal(view.marriageClans.length, 0);
  assert.deepEqual(clone(start), initial, 'showing candidates cannot birth or marry anyone');
  const grown = campaign(env, 1577), options = env.Diplomacy.getView(grown, { princessId: 'oda_tokuhime' });
  assert.equal(options.princesses.find(item => item.id === 'oda_tokuhime').age, 18);
  assert.equal(options.princesses.find(item => item.id === 'oda_tokuhime').eligible, true);
  const clan = options.marriageClans.find(item => item.id === 'matsudaira'); assert.ok(clan);
  assert.ok(clan.spouses.length >= 2, 'player may select the historical adult head or heir');
  for (const spouse of clan.spouses) assert.ok(spouse.age >= 18);
  const kin = clone(grown), related = kin.officers.find(item => item.id === clan.spouseId);
  related.fatherId = kin.officers.find(item => item.id === 'oda_tokuhime').fatherId;
  const filtered = env.Dynasty.marriageOptions(kin, 'oda_tokuhime').find(item => item.id === 'matsudaira');
  assert.equal(filtered?.spouses.some(item => item.id === related.id) || false, false, 'one suggested relative must not hide another valid spouse');
});

test('allied political marriage spends only the selected castle order, saves both spouses, and cannot repeat', () => {
  const env = setup(), state = campaign(env, 1577), initial = clone(state), action = marriageAction(env, state);
  const result = env.Diplomacy.act(state, action);
  assert.equal(result.ok, true, result.message); assert.deepEqual(clone(state), initial);
  assert.equal(result.state.gold, state.gold - 300);
  assert.equal(env.Orders.remaining(result.state, 'inuyama'), 2); assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 3);
  assert.equal(result.state.officers.find(item => item.id === action.princessId).marriedTo, action.spouseId);
  assert.equal(result.state.officers.find(item => item.id === action.spouseId).marriedTo, action.princessId);
  assert.equal(env.Game.validate(result.state), true); assert.equal(env.Game.save(result.state), true);
  const loaded = env.Game.load(); assert.equal(loaded.officers.find(item => item.id === action.princessId).marriedTo, action.spouseId);
  const repeat = env.Diplomacy.act(loaded, action); assert.equal(repeat.ok, false); assert.equal(repeat.state, loaded);
  assert.equal(loaded.gold, result.state.gold); assert.equal(env.Orders.remaining(loaded, 'inuyama'), 2);
});

test('family-tab marriage uses the same diplomacy eligibility and castle cost rather than bypassing it', () => {
  const env = setup(), state = campaign(env, 1577), action = marriageAction(env, state);
  const result = env.Dynasty.act(state, action); assert.equal(result.ok, true, result.message);
  assert.equal(result.state.gold, state.gold - 300); assert.equal(env.Orders.remaining(result.state, 'inuyama'), 2);
  const missingSpouse = env.Dynasty.act(state, { ...action, spouseId: null }); assert.equal(missingSpouse.ok, false);
  assert.equal(missingSpouse.state, state);
});

test('alliance breaking requires confirmation, updates real war protection, and marriage does not silently restore it', () => {
  const env = setup(), source = campaign(env, 1577), married = env.Diplomacy.act(source, marriageAction(env, source)).state;
  const action = { type: 'breakAlliance', targetClan: 'matsudaira', orderCastleId: 'kiyosu' };
  assert.equal(env.Diplomacy.preview(married, action).willEndMarriageAlliance, true);
  const noConfirm = env.Diplomacy.act(married, action); assert.equal(noConfirm.ok, false); assert.equal(noConfirm.state, married);
  const result = env.Diplomacy.act(married, { ...action, confirm: true }); assert.equal(result.ok, true, result.message);
  assert.equal(result.state.relations.matsudaira, married.relations.matsudaira - 40); assert.equal(result.state.prestige, married.prestige - 10);
  assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 2); assert.equal(result.state.alliances.includes('matsudaira'), false);
  const next = env.Game.season(result.state).state;
  assert.equal(next.alliances.includes('matsudaira'), false, 'seasonal Dynasty.renewMarriages must respect broken protection');
  assert.equal(next.tenka.dynasty.marriages[0].active, true, 'diplomacy does not erase the actual family marriage');
  assert.equal(next.tenka.dynasty.marriages[0].allianceBroken, true);
  assert.equal(env.Diplomacy.isProtectedPair(next, 'oda', 'matsudaira'), false);
  assert.equal(env.Game.save(next), true); assert.equal(env.Game.load().alliances.includes('matsudaira'), false);
  const repeat = env.Diplomacy.act(result.state, { ...action, confirm: true }); assert.equal(repeat.ok, false);
});

test('submission retains real castle and family ownership, prevents both war directions, and does not award conquest', () => {
  const env = setup(), { state, action, result } = weakNeighbor(env), before = clone(state);
  assert.equal(result.state.gold, state.gold - 400); assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 2);
  assert.equal(result.state.tenka.assignments[action.officerId].turn, state.turn);
  assert.equal(result.state.tenka.diplomacy.vassals.saito.overlord, 'oda');
  assert.deepEqual(clone(result.state.castles), before.castles, 'submission does not annex or replenish a castle');
  assert.deepEqual(clone(result.state.officers), before.officers, 'retainers are not forcibly transferred');
  assert.equal(result.state.gameOver, false); assert.equal(result.state.winner, null);
  assert.equal(env.Diplomacy.isProtectedPair(result.state, 'oda', 'saito'), true);
  assert.equal(env.Diplomacy.isProtectedPair(result.state, 'saito', 'oda'), true);
  const refused = env.Game.action(result.state, 'attack', 'inabayama', { sourceId: 'inuyama' });
  assert.equal(refused.ok, false); assert.equal(refused.state, result.state);
  assert.throws(() => env.Game.createBattle({ state: result.state, sourceId: 'inuyama', targetId: 'inabayama', mode: 'siege' }), /同盟|恭順/);
  assert.equal(env.Game.validate(result.state), true); assert.equal(env.Game.save(result.state), true);
  const loaded = env.Game.load(); assert.equal(loaded.tenka.diplomacy.vassals.saito.active, true);
  assert.equal(env.Diplomacy.act(loaded, action).ok, false); assert.deepEqual(clone(state), before);
});

test('native map targets and NPC invasion use current diplomatic protection in both directions', () => {
  const env = setup(), { result } = weakNeighbor(env), protectedState = clone(result.state);
  const source = protectedState.castles.find(item => item.id === 'inabayama');
  source.troops = 20000; source.gold = 10000; source.food = 100000;
  protectedState.armies[source.id].units = { ashigaru: 12000, archer: 3000, cavalry: 3000, firearm: 2000, navy: 0 };
  for (const home of protectedState.castles) if (home.clan !== 'oda' && home.id !== source.id) home.gold = 0;
  assert.equal(env.Game.targets(protectedState, 'inuyama').some(item => item.id === 'inabayama'), false);
  env.Game.runAI(protectedState);
  assert.equal(protectedState.pendingDefense || null, null, 'subordinate army cannot launch an automatic invasion of its liege');
  const released = env.Diplomacy.act(protectedState, { type: 'breakAlliance', targetClan: 'saito', orderCastleId: 'inuyama', confirm: true });
  assert.equal(released.ok, true, released.message);
  assert.equal(env.Game.targets(released.state, 'inuyama').some(item => item.id === 'inabayama'), true, 'breaking the pact reopens the actual route');
  env.Game.runAI(released.state);
  assert.ok(released.state.pendingDefense, 'a released enemy uses its real superiority to invade again');
  assert.equal(released.state.castles.find(item => item.id === released.state.pendingDefense.sourceId).clan, 'saito');
});

test('vassal tribute transfers actual stores once a season, survives reload, and stops when the pact is ended', () => {
  const env = setup(), { result } = weakNeighbor(env), initial = result.state;
  const same = env.Diplomacy.advance(initial); assert.equal(same.gold, initial.gold); assert.equal(same.food, initial.food);
  const due = clone(initial); due.turn++; due.season = 1;
  const stores = state => ['gold', 'food'].map(key => state[key] + state.castles.reduce((sum, home) => sum + home[key], 0));
  const conserved = env.Diplomacy.advance(due);
  assert.deepEqual(stores(conserved), stores(due), 'tribute transfers existing resources instead of creating income');
  const next = env.Game.season(initial).state, record = next.tenka.diplomacy.vassals.saito;
  assert.equal(record.lastTributeTurn, next.turn); assert.ok(record.tributeGold > 0); assert.ok(record.tributeFood > 0);
  assert.equal(next.logs.filter(item => item.title === '恭順国からの貢納').length, 1);
  const again = env.Diplomacy.advance(next); assert.equal(again.gold, next.gold); assert.equal(again.food, next.food);
  assert.equal(env.Game.save(next), true); const loaded = env.Game.load();
  assert.equal(env.Diplomacy.advance(loaded).gold, loaded.gold, 'save/load cannot collect the same season twice');
  const released = env.Diplomacy.act(loaded, { type: 'breakAlliance', targetClan: 'saito', orderCastleId: 'kiyosu', confirm: true });
  assert.equal(released.ok, true, released.message); assert.equal(released.state.tenka.diplomacy.vassals.saito.active, false);
  assert.equal(env.Diplomacy.isProtectedPair(released.state, 'oda', 'saito'), false);
  const after = env.Game.season(released.state).state;
  assert.equal(after.tenka.diplomacy.vassals.saito.tributeGold, record.tributeGold);
  assert.equal(after.alliances.includes('saito'), false);
});

test('a refused submission spends the real envoy budget once and cannot be retried by changing delegates', () => {
  const env = setup(), { state } = weakNeighbor(env); state.relations.saito = -100; state.prestige = 40;
  let rejected;
  for (const delegate of env.Diplomacy.getView(state).delegates.filter(item => item.available)) {
    const action = { type: 'subjugate', targetClan: 'saito', officerId: delegate.id, orderCastleId: 'inuyama' };
    const attempt = env.Diplomacy.act(state, action);
    if (attempt.ok && attempt.outcome === 'refused') { rejected = { attempt, action }; break; }
  }
  assert.ok(rejected, 'deterministic actual envoy refusal exists');
  const { attempt, action } = rejected;
  assert.equal(attempt.state.gold, state.gold - 400); assert.equal(env.Orders.remaining(attempt.state, 'inuyama'), 2);
  assert.equal(env.Orders.remaining(attempt.state, 'kiyosu'), 3);
  assert.equal(attempt.state.tenka.assignments[action.officerId].outcome, 'refused');
  assert.equal(attempt.state.tenka.diplomacy.vassals.saito, undefined);
  const other = env.Diplomacy.getView(attempt.state).delegates.find(item => item.available);
  const repeat = env.Diplomacy.act(attempt.state, { ...action, officerId: other.id });
  assert.equal(repeat.ok, false); assert.match(repeat.message, /今季すでに/); assert.equal(repeat.state, attempt.state);
  assert.equal(env.Game.validate(attempt.state), true); assert.equal(env.Game.save(attempt.state), true);
  assert.equal(env.Diplomacy.act(env.Game.load(), { ...action, officerId: other.id }).ok, false);
});

test('invalid, unaffordable, underage, closely-related, busy and war-pending actions roll back without resources or orders', () => {
  const env = setup(), grown = campaign(env, 1577), marry = marriageAction(env, grown);
  const variants = [
    [grown, { ...marry, spouseId: 'oda_nobunaga' }], [grown, { ...marry, orderCastleId: 'inabayama' }],
    [campaign(env), { ...marry }], [grown, { ...marry, princessId: 'missing' }],
    [{ ...clone(grown), gold: 299 }, marry], [{ ...clone(grown), gameOver: true }, marry],
    [{ ...clone(grown), pendingDefense: { sourceId: 'inabayama', targetId: 'kiyosu' } }, marry],
    [campaign(env), { type: 'subjugate', targetClan: 'saito', officerId: 'oda_nobutada', orderCastleId: 'kiyosu' }]
  ];
  const exhausted = clone(grown); exhausted.tenka.castleOrders.castles.inuyama.remaining = 0; variants.push([exhausted, marry]);
  const pending = clone(grown); pending.tenka.allies.committed = [{}]; variants.push([pending, marry]);
  const busy = clone(grown); busy.tenka.assignments.oda_nobunaga = { turn: busy.turn, type: 'negotiation' };
  variants.push([busy, { type: 'subjugate', targetClan: 'matsudaira', officerId: 'oda_nobunaga', orderCastleId: 'kiyosu' }]);
  for (const [state, action] of variants) {
    const before = clone(state), result = env.Diplomacy.act(state, action);
    assert.equal(result.ok, false, JSON.stringify(action)); assert.equal(result.state, state); assert.deepEqual(clone(state), before);
  }
});

test('vassal ledger validation rejects forged cycles and tribute clocks while accepting old campaigns', () => {
  const env = setup(), { result } = weakNeighbor(env), original = result.state;
  const old = clone(original); delete old.tenka.diplomacy; assert.equal(env.Game.validate(old), true);
  for (const change of [
    state => { state.tenka.diplomacy.vassals.saito.overlord = 'saito'; },
    state => { state.tenka.diplomacy.vassals.saito.lastTributeTurn = state.turn + 1; },
    state => { state.tenka.diplomacy.vassals.saito.tributeGold = -1; },
    state => { state.tenka.diplomacy.vassals.oda = { ...state.tenka.diplomacy.vassals.saito, overlord: 'saito' }; }
  ]) {
    const forged = clone(original); change(forged); assert.equal(env.Game.validate(forged), false); assert.equal(env.Game.save(forged), false);
  }
});

test('an old protected invasion alert migrates once without charging either army and does not lock the campaign', () => {
  const env = setup(), state = campaign(env);
  const clans = [...new Set(state.castles.map(item => item.clan))];
  state.alliances = clans.filter(id => id !== state.playerClan);
  state.allianceExpires = Object.fromEntries(state.alliances.map(id => [id, state.turn + 4]));
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'inuyama', mode: 'siege', clan: 'saito' };
  state.threats = [{ sourceId: 'inabayama', targetId: 'inuyama', text: '旧セーブの急報' }];
  delete state.tenka.diplomacy;
  assert.equal(env.Game.validate(state), true, 'this was an accepted older save');
  assert.throws(() => env.Tactics.createDefense(state), /同盟|恭順/);
  const before = clone(state), migrated = env.Game.migrate(state);
  assert.equal(migrated.pendingDefense, null); assert.equal(migrated.threats.length, 0);
  assert.equal(migrated.logs.filter(item => item.title === '外交で侵攻を解除').length, 1);
  assert.deepEqual(clone(migrated.castles), before.castles); assert.deepEqual(clone(migrated.armies), before.armies);
  assert.equal(migrated.gold, before.gold); assert.equal(migrated.food, before.food); assert.equal(migrated.actionPoints, before.actionPoints);
  assert.deepEqual(clone(migrated.tenka.castleOrders), before.tenka.castleOrders);
  assert.equal(env.Game.migrate(migrated).logs.filter(item => item.title === '外交で侵攻を解除').length, 1);
  // Write the accepted old JSON directly into the actual storage key: save()
  // itself already migrates, so going through it would hide a load-only bug.
  assert.equal(env.Game.save(env.Game.newGame()), true);
  env.values.set([...env.values.keys()][0], JSON.stringify(state));
  const loaded = env.Game.load(); assert.ok(loaded); assert.equal(loaded.pendingDefense, null);
  assert.equal(loaded.logs.filter(item => item.title === '外交で侵攻を解除').length, 1);
  assert.equal(env.Game.save(loaded), true); assert.equal(env.Game.load().pendingDefense, null);
  assert.equal(env.Game.season(loaded).state.turn, loaded.turn + 1, 'campaign commands no longer remain locked by the stale alert');
  assert.deepEqual(clone(state), before, 'migration never mutates the submitted old campaign');
});

test('a legal foreign siege still creates, replays and settles despite unrelated NPC pacts', () => {
  const env = setup(), state = campaign(env);
  // campaign() includes all NPC pairs, even the original player pair. These
  // records must not become the temporary attacker's player-alliance list.
  state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', clan: 'saito' };
  const units = { ashigaru: 3000, archer: 1000, cavalry: 0, firearm: 2500, navy: 0 };
  state.castles.find(item => item.id === 'kiyosu').troops = Object.values(units).reduce((sum, n) => sum + n, 0);
  state.armies.kiyosu.units = units;
  assert.equal(env.Game.diplomacy.isProtectedPair(state, 'oda', 'saito'), false);
  assert.ok(env.Game.migrate(state).pendingDefense, 'valid enemy invasion is preserved');
  const battle = env.Game.startBattle(env.Tactics.createDefense(state, state.pendingDefense, { carriedSupply: 100, battlefieldVersion: 0 }));
  let batches = 0;
  while (battle.phase === 'fighting' && batches++ < 700) {
    let steps = 0;
    for (; steps < 8 && battle.phase === 'fighting'; steps++) env.Game.simulateTick(battle);
    if (steps) battle.ledger.push({ kind: 'tick', steps });
  }
  assert.equal(battle.phase, 'finished');
  const report = env.Tactics.verify(state, battle); assert.ok(report, 'production replay accepts the original diplomatic context');
  const result = env.Game.settle(state, battle); assert.equal(result.ok, true, result.message);
  assert.equal(result.state.pendingDefense, null); assert.equal(result.state.food, state.food - report.supplyConsumed);
  assert.equal(env.Game.validate(result.state), true); assert.equal(env.Game.save(result.state), true);
});
