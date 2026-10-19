'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Dynasty = require('../tenka-dynasty.js');

function person(id, name, extra = {}) {
  return { id, name, clan: 'oda', castleId: 'kiyosu', status: 'active', birth: 1534,
    leadership: 75, valor: 72, intelligence: 70, politics: 80,
    aptitudes: { ashigaru: 3, cavalry: 3, firearm: 3, archer: 3, navy: 3 }, ...extra };
}
function game() {
  return { year: 1560, month: 3, season: 0, turn: 1, playerClan: 'oda', gold: 10000, food: 10000, actionPoints: 3,
    castles: [{ id: 'kiyosu', clan: 'oda', clanName: '織田家' }, { id: 'okazaki', clan: 'matsudaira', clanName: '松平家' }],
    officers: [person('oda_nobunaga', '織田信長'), person('shibata_katsuie', '柴田勝家'),
      person('matsudaira_motoyasu', '松平元康', { clan: 'matsudaira', castleId: 'okazaki', birth: 1543 })],
    armies: {}, alliances: [], allianceExpires: {}, relations: {}, logs: [], nextLogId: 1, gameOver: false };
}
function move(state, year, month) {
  const season = month >= 3 && month <= 5 ? 0 : month <= 8 && month >= 6 ? 1 : month >= 9 && month <= 11 ? 2 : 3;
  return { ...structuredClone(state), year, month, season, turn: (year - 1560) * 12 + month - 2 };
}

test('recruit names remain unique kanji names after the former small name pool is exhausted', () => {
  let state = Dynasty.initialize(game());
  const surnames = ['庄田', '岩村', '中島', '稲葉', '村井', '山岡', '三田', '大沢', '河村', '小坂'];
  const givens = ['宗直', '景久', '義綱', '清成', '盛忠', '信重', '晴綱', '忠俊', '景長', '正継'];
  for (const surname of surnames) for (const given of givens) state.officers.push(person(`occupied-${surname}-${given}`, surname + given, { origin: 'fictional' }));
  const allNames = new Set(state.officers.map(o => o.name));
  for (let month = 3; month <= 12; month++) {
    state = move(state, 1560, month);
    const recruits = Dynasty.getView(state).recruits.filter(o => o.id.startsWith('dyn-recruit-'));
    assert.equal(recruits.length, 8);
    for (const recruit of recruits) {
      assert.match(recruit.name, /^[\p{Script=Han}]+$/u);
      assert.equal(allNames.has(recruit.name), false, recruit.name);
      allNames.add(recruit.name);
      state.officers.push({ ...recruit, status: 'active' });
    }
  }
});

test('numbered old-save people migrate by identity and update reports without changing family or military references', () => {
  const state = Dynasty.initialize(game());
  const id = 'dyn-recruit-oda-1-6';
  const numbered = person(id, '庄田宗直（１-７）', { origin: 'fictional', marriedTo: 'princess-test', fatherId: 'oda_nobunaga', naturalDeathAge: 70, naturalDeathSeason: 3, custom: 'preserved' });
  state.officers.push(numbered, person('princess-test', '織田雪姫（2）', { origin: 'fictional', gender: 'female', marriedTo: id, fatherId: 'oda_nobunaga' }),
    person('dead-generated', '在地武将123', { origin: 'fictional', status: 'dead', deathYear: 1559, diedAtAge: 25, deathCause: 'battle', castleId: null }),
    person('kanji-original', '山内一豊'), person('kanji-second', '井伊直政'));
  state.armies.kiyosu = { commanderId: id, units: { ashigaru: 250 } };
  state.tenka.assignments[id] = { turn: state.turn, type: 'reclaim' };
  state.tenka.dynasty.families.oda.heirId = id;
  state.tenka.dynasty.families.oda.heirDesignated = true;
  state.tenka.dynasty.deaths = [{ officerId: 'dead-generated', name: '在地武将123', cause: 'battle' }];
  state.tenka.casualties = [{ officerId: id, name: numbered.name, cause: 'captured' }];
  state.lastBattle = { id: 'past-battle', officerOutcomes: [{ officerId: id, name: numbered.name, outcome: 'survived' }], tacticalRecord: { name: numbered.name, ledger: [1, 2, 3] } };
  state.logs = [{ id: 'historic-entry', title: '家臣の報告', text: numbered.name + 'が帰還。' }];
  const before = structuredClone(state), result = Dynasty.reconcile(state);
  assert.deepEqual(state, before, 'migration is immutable');
  const migrated = result.officers.find(o => o.id === id);
  assert.equal(migrated.name, '庄田宗直');
  const ignored = new Set(['name', 'currentYear', 'gender', 'sex']);
  for (const [key, value] of Object.entries(numbered)) if (!ignored.has(key)) assert.deepEqual(migrated[key], value, key);
  assert.equal(result.armies.kiyosu.commanderId, id);
  assert.deepEqual(result.tenka.assignments[id], before.tenka.assignments[id]);
  assert.equal(result.tenka.dynasty.families.oda.heirId, id);
  assert.equal(result.officers.find(o => o.id === 'princess-test').marriedTo, id);
  assert.equal(result.officers.find(o => o.id === 'dead-generated').status, 'dead');
  assert.equal(result.officers.find(o => o.id === 'kanji-original').name, '山内一豊');
  assert.equal(result.tenka.casualties[0].name, migrated.name);
  assert.equal(result.lastBattle.officerOutcomes[0].name, migrated.name);
  assert.deepEqual(result.lastBattle.tacticalRecord, before.lastBattle.tacticalRecord, 'signed tactical record remains unchanged');
  assert.equal(result.logs[0].text, migrated.name + 'が帰還。');
  assert.ok(result.officers.every(o => !/[0-9０-９]/.test(o.name)));
  assert.deepEqual(Dynasty.reconcile(result), result, 'loading again does not draw different names');
});

test('known historical names recover canonical spelling while kanji numerals in proper names stay intact', () => {
  Dynasty.configure({ officers: [person('canonical-name', '山内一豊')] });
  try {
    const state = game();
    state.officers[0].name = '織田信長（123）';
    state.officers.push(person('canonical-name', '山内一豊8'), person('unknown-historical', '伊東義祐'));
    const result = Dynasty.initialize(state);
    assert.equal(result.officers.find(o => o.id === 'canonical-name').name, '山内一豊');
    assert.equal(result.officers.find(o => o.id === 'unknown-historical').name, '伊東義祐');
    assert.equal(result.officers.find(o => o.id === 'oda_nobunaga').name, '織田信長');
  } finally { Dynasty.configure(); }
});

test('placeholder parent names migrate before their children even when the child ID sorts first', () => {
  const state = game();
  state.officers.push(person('z-parent', '12武将', { origin: 'fictional' }),
    person('a-child', '姫7', { origin: 'fictional', gender: 'female', fatherId: 'z-parent', birth: 1555 }));
  const result = Dynasty.initialize(state), parent = result.officers.find(o => o.id === 'z-parent'), child = result.officers.find(o => o.id === 'a-child');
  assert.match(parent.name, /^[\p{Script=Han}]+$/u);
  assert.match(child.name, /^[\p{Script=Han}]+$/u);
  assert.ok(child.name.startsWith(parent.name.slice(0, 2)), parent.name + ' / ' + child.name);
  assert.equal(child.fatherId, parent.id);
  assert.deepEqual(Dynasty.reconcile(result), result);
});

test('monthly recruitment is reserved for its turn and cannot reroll or exceed two ordinary hires', () => {
  let state = Dynasty.initialize(game());
  const candidates = Dynasty.getView(state).recruits;
  assert.deepEqual(Dynasty.getView(state).recruits, candidates);
  let result = Dynasty.act(state, { type: 'recruit', candidateId: candidates[6].id });
  assert.equal(result.ok, true, result.message); state = result.state;
  assert.deepEqual(Dynasty.getView(state).recruits, candidates.filter(o => o.id !== candidates[6].id));
  result = Dynasty.act(state, { type: 'recruit', candidateId: candidates[3].id });
  assert.equal(result.ok, true, result.message); state = result.state;
  result = Dynasty.act(state, { type: 'recruit', candidateId: candidates[0].id });
  assert.equal(result.ok, false); assert.match(result.message, /今月.*翌月/);
  const next = move(state, 1560, 4); next.actionPoints = 3;
  const newCandidates = Dynasty.getView(next).recruits;
  assert.ok(newCandidates.every(o => candidates.every(old => old.id !== o.id)));
  assert.equal(Dynasty.act(next, { type: 'recruit', candidateId: newCandidates[0].id }).ok, true);
  assert.deepEqual(Dynasty.getView(JSON.parse(JSON.stringify(state))).recruits, Dynasty.getView(state).recruits);
});

test('spring has at most one procedural birth per head per year, including old spring saves resumed in April', () => {
  let state = Dynasty.initialize(game());
  const family = state.tenka.dynasty.families.oda;
  family.birthSchedules.oda_nobunaga = { nextYear: 1560, born: 0 };
  state.officers.push(person('occupied-boy-a', '織田義成'), person('occupied-boy-b', '織田景成'), person('occupied-boy-c', '織田信継'), person('occupied-boy-d', '織田晴継'),
    person('occupied-girl-a', '織田春姫', { gender: 'female' }), person('occupied-girl-b', '織田菊姫', { gender: 'female' }), person('occupied-girl-c', '織田月姫', { gender: 'female' }), person('occupied-girl-d', '織田雪姫', { gender: 'female' }));
  state = Dynasty.advance(move(state, 1560, 4));
  const children = state.officers.filter(o => o.id.startsWith('dyn-child-') && o.fatherId === 'oda_nobunaga');
  assert.equal(children.length, 1);
  assert.match(children[0].name, /^織田[\p{Script=Han}]+$/u);
  assert.equal(state.officers.filter(o => o.name === children[0].name).length, 1);
  assert.equal(state.tenka.dynasty.families.oda.birthSchedules.oda_nobunaga.lastBirthYear, 1560);
  const repeated = Dynasty.advance(state);
  assert.deepEqual(repeated, state);
  // A damaged legacy nextYear cannot cause another child in the same spring.
  state.tenka.dynasty.families.oda.birthSchedules.oda_nobunaga.nextYear = 1560;
  state = Dynasty.advance(move(state, 1560, 5));
  assert.equal(state.officers.filter(o => o.id.startsWith('dyn-child-') && o.fatherId === 'oda_nobunaga').length, 1);
});

test('monthly mortality uses a calendar month and fires only once when that month arrives', () => {
  let state = Dynasty.initialize(game());
  const head = state.officers.find(o => o.id === 'oda_nobunaga');
  head.naturalDeathAge = 45; head.naturalDeathSeason = 1; head.naturalDeathMonth = 6;
  state = Dynasty.advance(move(state, 1579, 5));
  assert.equal(state.officers.find(o => o.id === head.id).status, 'active');
  state = Dynasty.advance(move(state, 1579, 6));
  const deceased = state.officers.find(o => o.id === head.id);
  assert.equal(deceased.status, 'dead'); assert.equal(deceased.deathYear, 1579); assert.equal(deceased.deathMonth, 6); assert.equal(deceased.diedAtAge, 45);
  state = Dynasty.advance(move(state, 1579, 7));
  assert.equal(state.tenka.dynasty.deaths.filter(o => o.officerId === head.id).length, 1);
});

test('descendants retain the complete surname, including legitimate kanji numerals and three-character local surnames', () => {
  for (const [familyName, headName] of [['二階堂', '二階堂盛義'], ['小笠原', '小笠原長時'], ['野々村', '野々村宗直']]) {
    let state = game();
    const head = state.officers[0]; head.id = 'dyn-test-head'; head.name = headName; head.origin = 'fictional';
    state = Dynasty.initialize(state);
    state.tenka.dynasty.families.oda.birthSchedules[head.id] = { nextYear: 1560, born: 0 };
    state = Dynasty.advance(move(state, 1560, 4));
    const child = state.officers.find(o => o.fatherId === head.id && o.origin === 'fictional');
    assert.ok(child, headName);
    assert.ok(child.name.startsWith(familyName), child.name);
    assert.equal(state.officers.find(o => o.id === head.id).name, headName);
    assert.equal(/[0-9０-９]/.test(child.name), false);
  }
});

test('a living marriage renews one year of monthly protection rather than expiring after four months', () => {
  let state = Dynasty.initialize(move(game(), 1577, 3));
  const view = Dynasty.getView(state), princess = view.princesses.find(o => o.id === 'oda_tokuhime');
  const target = view.marriageClans.find(o => o.id === 'matsudaira');
  const result = Dynasty.act(state, { type: 'marry', princessId: princess.id, targetClan: target.id, spouseId: target.spouseId });
  assert.equal(result.ok, true, result.message);
  state = result.state; assert.equal(state.allianceExpires.matsudaira, state.turn + 12);
  state = Dynasty.advance(move(state, 1577, 4));
  assert.equal(state.allianceExpires.matsudaira, state.turn + 12);
});
