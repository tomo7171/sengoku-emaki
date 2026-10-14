'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Systems = require('../tenka-systems.js');

function officer(id, clan, castleId, extra = {}) {
  return { id, name: id, clan, castleId, status: 'active', capturedBy: null,
    birth: 1530, death: 1600, leadership: 80, politics: 80, intelligence: 80, valor: 80,
    aptitudes: { ashigaru: 3, archer: 3, cavalry: 3, firearm: 3, navy: 3 }, ...extra };
}
function castle(id, clan, extra = {}) {
  return { id, name: id, clan, clanName: clan, province: '尾張', kokudaka: 48000,
    population: 52000, troops: 3200, food: 10000, gold: 3000, defense: 60, morale: 80,
    terrain: 'plain', coastal: false, neighbors: ['a', 'b'], ...extra };
}
function units(count) { return { ashigaru: count, archer: 0, cavalry: 0, firearm: 0, navy: 0 }; }
function game() {
  return { version: 2, year: 1560, season: 0, turn: 1, playerClan: 'oda',
    selectedCastleId: 'a', actionPoints: 3, gold: 9000, food: 24000, prestige: 30,
    castles: [castle('a', 'oda'), castle('b', 'imagawa')],
    officers: [officer('oda_nobunaga', 'oda', 'a'), officer('delegate', 'oda', 'a'),
      officer('imagawa_yoshimoto', 'imagawa', 'b'), officer('child', 'oda', 'a', { birth: 1550 })],
    armies: { a: { commanderId: 'oda_nobunaga', units: units(3200) },
      b: { commanderId: 'imagawa_yoshimoto', units: units(3200) } },
    alliances: [], allianceExpires: {}, relations: { imagawa: -30 }, npcPacts: [],
    logs: [], nextLogId: 1, lastBattle: null, aiBattles: [], gameOver: false };
}
function command(state, type, extra = {}) {
  return Systems.act(state, { type, officerId: 'delegate', castleId: 'a', ...extra });
}
function prisoner() {
  const state = Systems.initialize(game());
  Object.assign(state.officers[2], { status: 'captive', castleId: null, capturedBy: 'oda' });
  state.armies.b.commanderId = null;
  state.tenka.loyalty.imagawa_yoshimoto = 0;
  return state;
}
function battle(extra = {}) {
  return { id: 'newbattle', sourceId: 'a', targetId: 'b', attacker: 'a', defender: 'b',
    attackerClan: 'oda', defenderClan: 'imagawa', won: false, mode: 'siege',
    attackerArmy: { troops: 3000, commanderId: 'oda_nobunaga' },
    defenderArmy: { troops: 3200, commanderId: 'imagawa_yoshimoto' },
    casualties: 1500, enemyCasualties: 400, ...extra };
}

test('legacy state initializes immutably and delegation respects age, task and action resources', () => {
  const original = game(), snapshot = structuredClone(original);
  const state = Systems.initialize(original);
  assert.deepEqual(original, snapshot);
  assert.equal(Systems.getView(state).officers.length, 2);
  assert.equal(command(state, 'reclaim', { officerId: 'child' }).ok, false);
  assert.equal(command(state, 'reclaim', { castleId: 'b' }).ok, false);
  const result = command(state, 'reclaim');
  assert.equal(result.ok, true);
  assert.ok(result.state.castles[0].kokudaka > state.castles[0].kokudaka);
  assert.ok(Systems.mobilizationLimit(result.state.castles[0]) > Systems.mobilizationLimit(state.castles[0]));
  assert.equal(result.state.actionPoints, state.actionPoints - 1);
  assert.ok(result.state.gold < state.gold);
  assert.equal(command(result.state, 'commercial').ok, false, 'one named officer cannot perform two seasonal tasks');
  const poor = { ...state, gold: 0 };
  const refused = command(poor, 'reclaim');
  assert.equal(refused.ok, false);
  assert.equal(refused.state, poor);
  assert.deepEqual(original, snapshot);
});

test('recruitment fills only available koku-based slots and synchronizes army composition', () => {
  const state = game(), c = state.castles[0];
  const limit = Systems.mobilizationLimit(c);
  c.troops = limit - 5; state.armies.a.units = units(c.troops);
  const result = command(state, 'levy');
  assert.equal(result.ok, true);
  assert.equal(result.state.castles[0].troops, limit);
  assert.equal(result.state.armies.a.units.ashigaru, limit);
  const full = Systems.initialize(result.state); full.actionPoints = 3; full.turn++;
  assert.equal(command(full, 'levy').ok, false);
  assert.ok(Systems.mobilizationLimit({ ...c, kokudaka: c.kokudaka / 2 }) < limit);
});

test('commercial investment produces repeatable seasonal income without charging core upkeep again', () => {
  const result = command(game(), 'commercial');
  assert.equal(result.ok, true);
  const nextSeason = structuredClone(result.state); nextSeason.turn++; nextSeason.season++;
  const next = Systems.advance(nextSeason, result.state);
  assert.ok(next.gold > nextSeason.gold);
  assert.equal(next.food, nextSeason.food, 'base game already settles seasonal military food');
  assert.equal(Systems.advance(next, nextSeason).gold, next.gold);
  assert.ok(next.tenka.turnReports.some(report => report.includes('追加収入')));
  assert.equal(Systems.getView(next).officers.find(o => o.id === 'delegate').available, true);
});

test('diplomacy creates a finite alliance and failed intrigue still spends its command', () => {
  const state = Systems.initialize(game()); state.relations.imagawa = 65;
  const result = command(state, 'negotiation', { castleId: 'b' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.alliances, ['imagawa']);
  assert.equal(result.state.allianceExpires.imagawa, state.turn + 4);
  assert.equal(command(result.state, 'infiltrate', { officerId: 'oda_nobunaga', targetOfficerId: 'imagawa_yoshimoto' }).ok, false);
  const attempt = command(game(), 'infiltrate', { targetOfficerId: 'imagawa_yoshimoto' });
  assert.equal(attempt.ok, true, 'a completed attempt has a result even when discovered');
  assert.equal(attempt.state.actionPoints, 2);
  assert.ok(attempt.state.gold < game().gold);
  assert.deepEqual(command(game(), 'infiltrate', { targetOfficerId: 'imagawa_yoshimoto' }), attempt, 'reloading the same state does not reroll');
});

test('prisoner decisions change employment and fate without reviving dead or displaced officers', () => {
  const captive = prisoner();
  const freed = command(captive, 'release', { targetOfficerId: 'imagawa_yoshimoto' });
  assert.equal(freed.state.officers[2].status, 'active');
  assert.equal(freed.state.officers[2].castleId, 'b');
  const fallen = prisoner(); fallen.castles[1].clan = 'oda';
  const ronin = command(fallen, 'release', { targetOfficerId: 'imagawa_yoshimoto' });
  assert.equal(ronin.state.officers[2].status, 'ronin');
  assert.equal(ronin.state.officers[2].castleId, null);
  const executed = command(captive, 'execute', { targetOfficerId: 'imagawa_yoshimoto' });
  assert.equal(executed.state.officers[2].status, 'dead');
  assert.equal(executed.state.relations.imagawa, -100);
  assert.ok(executed.state.prestige < captive.prestige);
  assert.equal(command(executed.state, 'enlist', { officerId: 'oda_nobunaga', targetOfficerId: 'imagawa_yoshimoto' }).ok, false);
  let hired;
  for (let turn = 1; turn <= 15 && !hired; turn++) {
    const state = prisoner(); state.turn = turn;
    const result = command(state, 'enlist', { targetOfficerId: 'imagawa_yoshimoto' });
    if (result.state.officers[2].clan === 'oda') hired = result.state.officers[2];
  }
  assert.ok(hired, 'persuasion can enlist a willing captive');
  assert.equal(hired.status, 'active'); assert.equal(hired.castleId, 'a'); assert.equal(hired.capturedBy, null);
});

test('history records firearms before the scenario and never forces a historical death', () => {
  const state = Systems.initialize(game());
  assert.equal(state.tenka.chronicle.find(e => e.id === '1543-firearms').status, 'past');
  const summer = structuredClone(state); summer.turn++; summer.season++;
  const next = Systems.advance(summer, state);
  assert.equal(next.tenka.events.filter(id => id === '1560-okehazama').length, 1);
  assert.equal(next.officers[2].status, 'active', 'Okehazama does not kill Yoshimoto outside combat');
  assert.equal(Systems.advance(next, summer).tenka.chronicle.length, next.tenka.chronicle.length);
  const changed = Systems.initialize(game()); changed.officers[0].status = 'dead'; changed.turn = 35; changed.year = 1568; changed.season = 2;
  changed.castles[0].province = '山城';
  const alternate = Systems.advance(changed);
  assert.equal(alternate.prestige, changed.prestige, 'Kyoto prestige requires a living Nobunaga');
  assert.ok(alternate.tenka.chronicle.find(e => e.id === '1568-kyoto').result.includes('年代記のみ'));
});

test('modeled battle provisions scale with troop counts, resolve shortages and settle only once', () => {
  const before = game(), state = game(); state.lastBattle = battle();
  const result = Systems.afterBattle(state, before);
  assert.ok(result.food < state.food);
  assert.ok(result.castles[1].food < state.castles[1].food);
  assert.equal(Systems.afterBattle(result, before).food, result.food);
  assert.equal(Systems.afterBattle(state, state).food, state.food, 'existing battle on a loaded state is not replayed');
  const larger = game(); larger.lastBattle = battle({ attackerArmy: { troops: 6000 } });
  assert.ok(Systems.afterBattle(larger, before).food < result.food);
  const shortage = game(); shortage.food = 1; shortage.lastBattle = battle({ id: 'shortage' });
  const depleted = Systems.afterBattle(shortage, before);
  assert.equal(depleted.food, 0);
  assert.ok(depleted.castles[0].morale < shortage.castles[0].morale);
  assert.ok(depleted.castles[0].troops < shortage.castles[0].troops);
  assert.ok(Object.values(depleted.armies.a.units).reduce((n, v) => n + v, 0) <= depleted.castles[0].troops);
});

test('tactical settlement never repeats already debited real-time provisions on either side', () => {
  for (const defending of [false, true]) {
    const state = game(); state.lastBattle = battle({ id: `tactical-${defending}`, tacticsVersion: 1, supplyConsumed: 135, defending });
    const result = Systems.afterBattle(state, game());
    assert.equal(result.food, state.food);
    assert.equal(result.castles[1].food, state.castles[1].food);
    assert.ok(result.logs.some(log => log.text.includes('135 石')));
  }
});

test('new faction selection uses its own territory and cannot reset a campaign in progress', () => {
  const state = game(), result = Systems.chooseClan(state, 'imagawa');
  assert.equal(result.ok, true); assert.equal(result.state.playerClan, 'imagawa'); assert.equal(result.state.selectedCastleId, 'b');
  assert.equal(state.playerClan, 'oda');
  assert.equal(Systems.chooseClan(command(state, 'reclaim').state, 'imagawa').ok, false);
  assert.equal(Systems.chooseClan({ ...state, aiRound: 1 }, 'imagawa').ok, false);
});

test('a depleted frontier and disloyal retainer invite enemy intrigue while an alliance protects them', () => {
  const state = Systems.initialize(game());
  Object.assign(state, { turn: 6, year: 1561, season: 1, food: 100 });
  Object.assign(state.castles[0], { troops: 200, morale: 30 });
  state.armies.a.units = units(200);
  state.tenka.loyalty.delegate = 20;
  const protectedState = structuredClone(state); protectedState.alliances = ['imagawa'];
  const exposed = Systems.advance(state), protectedResult = Systems.advance(protectedState);
  assert.equal(exposed.officers.find(o => o.id === 'delegate').clan, 'imagawa');
  assert.equal(exposed.officers.find(o => o.id === 'delegate').castleId, 'b');
  assert.ok(exposed.tenka.turnReports.some(report => report.includes('離反')));
  assert.equal(protectedResult.officers.find(o => o.id === 'delegate').clan, 'oda');
  assert.ok(!protectedResult.tenka.turnReports.some(report => report.includes('調略')));
});

test('unavailable delegates explain the actual cause and saved tasks expire safely', () => {
  const state = Systems.initialize(game());
  const busy = command(state, 'reclaim').state;
  assert.match(command(busy, 'commercial').message, /任務中/);
  assert.match(command(state, 'reclaim', { officerId: 'child' }).message, /十五歳未満/);
  const corrupt = structuredClone(state);
  corrupt.tenka.assignments = { delegate: { turn: state.turn + 4 }, child: { turn: -1 }, oda_nobunaga: { turn: '1' } };
  const normalized = Systems.initialize(corrupt);
  assert.deepEqual(normalized.tenka.assignments, {});
  assert.equal(Systems.isOfficerAvailable(normalized, normalized.officers[1]), true);
  assert.equal(corrupt.tenka.assignments.delegate.turn, state.turn + 4, 'save repair is immutable');
  const next = { ...busy, turn: busy.turn + 1 };
  assert.equal(command(next, 'commercial').ok, true, 'seasonal tasks last only their recorded turn');
});

test('when every adult is busy, collective magistrates keep domestic orders moving at normal costs', () => {
  const state = Systems.initialize(game());
  for (const o of state.officers.filter(o => o.clan === 'oda' && o.birth <= 1545)) state.tenka.assignments[o.id] = { turn: state.turn, type: 'reclaim' };
  const view = Systems.getView(state), fallback = view.administrationFallback;
  assert.equal(view.availability.reason, 'all-busy');
  assert.equal(fallback.name, '奉行衆');
  assert.equal(view.officers.every(o => !o.available), true);
  const first = command(state, 'reclaim', { officerId: fallback.id });
  assert.equal(first.ok, true);
  assert.equal(first.state.gold, state.gold - Systems.ACTIONS.reclaim.gold);
  assert.equal(first.state.actionPoints, state.actionPoints - 1);
  assert.ok(first.state.castles[0].kokudaka - state.castles[0].kokudaka < command(game(), 'reclaim').state.castles[0].kokudaka - game().castles[0].kokudaka);
  const second = command(first.state, 'commercial', { officerId: fallback.id });
  assert.equal(second.ok, true, 'the collective can use remaining seasonal orders');
  assert.equal(second.state.actionPoints, 1);
  assert.deepEqual(second.state.officers, state.officers, 'no fake individual enters the officer roster');
  assert.equal(second.state.tenka.assignments[fallback.id], undefined);
  assert.equal(command(state, 'negotiation', { officerId: fallback.id, castleId: 'b' }).ok, false);
  assert.equal(command(state, 'infiltrate', { officerId: fallback.id, targetOfficerId: 'imagawa_yoshimoto' }).ok, false);
  assert.equal(command(game(), 'reclaim', { officerId: fallback.id }).ok, false, 'free real officers take precedence');
});

test('underage-only and lost-retainer saves retain a domestic path without reviving dead officers', () => {
  const state = Systems.initialize(game());
  state.officers[0].status = 'dead'; state.officers[1].status = 'dead';
  assert.equal(Systems.getView(state).availability.reason, 'underage');
  const result = command(state, 'levy', { officerId: 'local-administration' });
  assert.equal(result.ok, true);
  assert.equal(result.state.officers[0].status, 'dead');
  assert.equal(result.state.officers[1].status, 'dead');
  assert.ok(result.state.castles[0].troops > state.castles[0].troops);
  const noRetainers = structuredClone(state); noRetainers.officers[3].status = 'dead';
  assert.equal(Systems.getView(noRetainers).availability.reason, 'no-officers');
  assert.equal(command(noRetainers, 'commercial', { officerId: 'local-administration' }).ok, true);
  const captive = prisoner();
  captive.officers[0].status = 'dead'; captive.officers[1].status = 'dead';
  assert.equal(command(captive, 'release', { officerId: 'local-administration', targetOfficerId: 'imagawa_yoshimoto' }).ok, true);
  assert.equal(command(captive, 'execute', { officerId: 'local-administration', targetOfficerId: 'imagawa_yoshimoto' }).ok, false);
});

test('defeated commanders usually retreat, ordinary losses never kill, and fate settles once', () => {
  const before = game();
  let deaths = 0, captures = 0, deathState;
  for (let index = 0; index < 2000; index++) {
    const state = game(); state.lastBattle = battle({ id: `fate-sample-${index}`, casualties: 2400 });
    const result = Systems.afterBattle(state, before), commander = result.officers[0];
    if (commander.status === 'dead') { deaths++; deathState ||= result; }
    if (commander.status === 'captive') captures++;
    assert.equal(result.officers[1].status, 'active', 'a retainer who did not command never suffers this battle fate');
    const ordinary = game(); ordinary.lastBattle = battle({ id: `ordinary-${index}`, casualties: 1200 });
    assert.notEqual(Systems.afterBattle(ordinary, before).officers[0].status, 'dead');
  }
  assert.ok(deaths >= 5 && deaths <= 40, `catastrophic deaths should remain around 1%, got ${deaths}/2000`);
  assert.ok(captures >= 90 && captures <= 240, `siege captures should remain around 8%, got ${captures}/2000`);
  assert.ok(deaths + captures < 300, 'at least 85% of defeated commanders escape even catastrophic defeat');
  const repeated = Systems.afterBattle(deathState, before);
  assert.equal(repeated.tenka.casualties.length, 1);
  assert.equal(repeated.officers[0].status, 'dead');
  const duplicate = game(); duplicate.lastBattle = battle({ id: deathState.lastBattle.id, casualties: 2400 }); duplicate.aiBattles = [duplicate.lastBattle];
  assert.equal(Systems.afterBattle(duplicate, before).tenka.casualties.length, 1, 'lastBattle and aiBattles cannot duplicate a fate');
  const alreadyDead = game(); alreadyDead.officers[0].status = 'dead'; alreadyDead.lastBattle = battle({ id: deathState.lastBattle.id, casualties: 2400 });
  assert.equal(Systems.afterBattle(alreadyDead, before).tenka.casualties.length, 0);
  const neverDeployed = game(); neverDeployed.lastBattle = battle({ id: deathState.lastBattle.id, casualties: 2400, attackerArmy: { troops: 0, commanderId: 'oda_nobunaga' } });
  assert.equal(Systems.afterBattle(neverDeployed, before).officers[0].status, 'active');
});
