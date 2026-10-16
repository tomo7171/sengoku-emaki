'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Dynasty = require('../tenka-dynasty.js');

function officer(id, name, clan = 'oda', extra = {}) {
  return { id, name, clan, castleId: clan === 'oda' ? 'kiyosu' : 'okazaki', status: 'active', capturedBy: null,
    birth: 1530, death: 1600, leadership: 80, valor: 75, intelligence: 72, politics: 78,
    aptitudes: { ashigaru: 3, archer: 3, cavalry: 3, firearm: 3, navy: 3 }, ...extra };
}
function game() {
  return { year: 1560, season: 0, turn: 1, playerClan: 'oda', gold: 3600, actionPoints: 3,
    castles: [{ id: 'kiyosu', clan: 'oda', clanName: '織田家' }, { id: 'okazaki', clan: 'matsudaira', clanName: '松平家' }],
    officers: [officer('oda_nobunaga', '織田信長', 'oda', { birth: 1534 }), officer('shibata_katsuie', '柴田勝家'),
      officer('matsudaira_motoyasu', '松平元康', 'matsudaira', { birth: 1543 }), officer('sakai_tadatsugu', '酒井忠次', 'matsudaira')],
    armies: {}, alliances: [], allianceExpires: {}, relations: { matsudaira: 0 }, npcPacts: [],
    logs: [], nextLogId: 1, gameOver: false };
}
function at(state, year, season = 0) {
  return { ...structuredClone(state), year, season, turn: (year - 1560) * 4 + season + 1 };
}

test('old saves gain historical children immutably without duplicate entries or forced historical deaths', () => {
  const source = game(), original = structuredClone(source), state = Dynasty.initialize(source);
  assert.deepEqual(source, original);
  assert.equal(Dynasty.getView(state).family.head.id, 'oda_nobunaga');
  const son = state.officers.find(o => o.id === 'oda_nobutada');
  assert.equal(son.birth, 1557); assert.equal(son.status, 'child'); assert.equal(son.fatherId, 'oda_nobunaga'); assert.equal(son.isKin, true);
  assert.equal(son.origin, 'historical'); assert.equal(son.capturedBy, null);
  const girl = state.officers.find(o => o.id === 'oda_tokuhime');
  assert.equal(girl.status, 'princess'); assert.equal(girl.gender, 'female');
  const again = Dynasty.initialize(state);
  assert.equal(again.officers.length, state.officers.length);
  assert.equal(again.tenka.dynasty.events.length, state.tenka.dynasty.events.length);
  assert.equal(Dynasty.initialize(at(state, 1583)).officers.find(o => o.id === 'oda_nobunaga').status, 'active');
});

test('historical births respect living parents and existing deaths and aliases', () => {
  const source = game(); source.officers[0].status = 'dead';
  const state = Dynasty.initialize(source);
  assert.equal(state.officers.some(o => o.id === 'oda_nobutada'), false);
  const existing = game(); existing.officers.push(officer('oda_nobukatsu', '織田信雄', 'oda', { birth: 1558, status: 'dead' }));
  const migrated = Dynasty.initialize(existing);
  assert.equal(migrated.officers.filter(o => ['oda_nobuo', 'oda_nobukatsu'].includes(o.id)).length, 1);
  assert.equal(migrated.officers.find(o => o.id === 'oda_nobukatsu').status, 'dead');
  const upcoming = Dynasty.initialize(game());
  assert.equal(upcoming.officers.some(o => o.id === 'tokugawa_hidetada'), false);
  const year1579 = Dynasty.advance(at(upcoming, 1579), upcoming);
  assert.equal(year1579.officers.find(o => o.id === 'tokugawa_hidetada').status, 'child');
  const deadFather = structuredClone(upcoming); deadFather.officers.find(o => o.id === 'matsudaira_motoyasu').status = 'dead';
  assert.equal(Dynasty.advance(at(deadFather, 1579), deadFather).officers.some(o => o.id === 'tokugawa_hidetada'), false);
});

test('children become usable at fifteen, while daughters stay princesses', () => {
  const state = Dynasty.initialize(game()), year1572 = Dynasty.advance(at(state, 1572), state);
  const son = year1572.officers.find(o => o.id === 'oda_nobutada');
  assert.equal(son.status, 'active'); assert.equal(son.castleId, 'kiyosu');
  assert.equal(year1572.officers.find(o => o.id === 'oda_tokuhime').status, 'princess');
  assert.equal(Dynasty.getView(year1572).eligibleHeirs.some(o => o.id === son.id), true);
  assert.equal(year1572.logs.filter(l => l.title === '元服' && l.text.includes(son.name)).length, 1);
  const repeated = Dynasty.advance(year1572, state);
  assert.equal(repeated.logs.filter(l => l.title === '元服' && l.text.includes(son.name)).length, 1);
});

test('recruitment is reliable without a delegate and relieves an empty adult roster without resources', () => {
  const source = game(); source.gold = 0; source.actionPoints = 0;
  for (const o of source.officers.filter(o => o.clan === 'oda')) o.status = 'dead';
  const original = structuredClone(source), result = Dynasty.act(source, { type: 'recruit' });
  assert.equal(result.ok, true); assert.deepEqual(source, original);
  const officer = result.state.officers.find(o => o.id.startsWith('dyn-recruit-'));
  assert.equal(officer.status, 'active'); assert.equal(officer.clan, 'oda'); assert.equal(officer.castleId, 'kiyosu');
  assert.equal(officer.origin, 'fictional'); assert.equal(result.state.gold, 0); assert.equal(result.state.actionPoints, 0);
  assert.equal(Dynasty.getView(result.state).family.head.id, officer.id);
  assert.equal(result.state.officers.find(o => o.id === 'oda_nobunaga').status, 'dead');
  assert.equal(Dynasty.act(result.state, { type: 'recruit' }).ok, false);
});

test('recruiting a selected ronin preserves identity, abilities, and unique IDs', () => {
  const source = game(); source.officers.push(officer('ronin_a', '浪人宗成', 'matsudaira', { status: 'ronin', castleId: null }));
  const result = Dynasty.act(source, { type: 'recruit', candidateId: 'ronin_a' });
  assert.equal(result.ok, true);
  const hired = result.state.officers.find(o => o.id === 'ronin_a');
  assert.equal(hired.clan, 'oda'); assert.equal(hired.politics, 78); assert.equal(hired.status, 'active');
  assert.equal(result.state.gold, 3450); assert.equal(result.state.actionPoints, 2);
  const local = Dynasty.act(result.state, { type: 'recruit' });
  assert.equal(local.ok, true);
  assert.equal(new Set(local.state.officers.map(o => o.id)).size, local.state.officers.length);
  assert.equal(Dynasty.act(local.state, { type: 'recruit' }).ok, false, 'ordinary recruitment is limited to two per season');
});

test('designated infant succeeds a fallen head with an adult regent; adulthood ends automatic regency', () => {
  let result = Dynasty.act(game(), { type: 'appointHeir', targetOfficerId: 'oda_nobuo' });
  assert.equal(result.ok, true); assert.equal(result.state.actionPoints, 3);
  result.state.officers.find(o => o.id === 'oda_nobunaga').status = 'dead';
  const next = Dynasty.reconcile(result.state), view = Dynasty.getView(next);
  assert.equal(view.family.head.id, 'oda_nobuo'); assert.equal(view.family.head.status, 'child');
  assert.equal(view.family.regent.id, 'shibata_katsuie');
  assert.equal(next.officers.find(o => o.id === 'oda_nobunaga').status, 'dead');
  const grown = Dynasty.reconcile(at(next, 1573));
  assert.equal(Dynasty.getView(grown).family.head.status, 'active');
  assert.equal(Dynasty.getView(grown).family.regent, null);
});

test('captured heads keep their title with a regent, and defectors cannot remain head or heir', () => {
  const source = Dynasty.initialize(game());
  Object.assign(source.officers.find(o => o.id === 'oda_nobunaga'), { status: 'captive', capturedBy: 'matsudaira', castleId: null });
  const captive = Dynasty.reconcile(source), view = Dynasty.getView(captive);
  assert.equal(view.family.head.id, 'oda_nobunaga'); assert.equal(view.family.regent.id, 'shibata_katsuie');
  const defected = structuredClone(captive);
  Object.assign(defected.officers.find(o => o.id === 'oda_nobunaga'), { clan: 'matsudaira', status: 'active', capturedBy: null, castleId: 'okazaki' });
  assert.notEqual(Dynasty.getView(Dynasty.reconcile(defected)).family.head.id, 'oda_nobunaga');
});

test('adult retainers can be adopted as heirs and preselected regents survive saves', () => {
  const adopted = Dynasty.act(game(), { type: 'appointHeir', targetOfficerId: 'shibata_katsuie' });
  assert.equal(adopted.ok, true); assert.equal(Dynasty.getView(adopted.state).family.heir.id, 'shibata_katsuie');
  assert.equal(adopted.state.officers.find(o => o.id === 'shibata_katsuie').adoptedInto, 'oda');
  const regent = Dynasty.act(game(), { type: 'appointRegent', targetOfficerId: 'shibata_katsuie' });
  assert.equal(regent.ok, true); assert.equal(Dynasty.getView(Dynasty.initialize(regent.state)).family.regent.id, 'shibata_katsuie');
});

test('procedural household births are bounded, marked fictional, and repeatable across reloads', () => {
  let state = Dynasty.initialize(game()), count = 0;
  for (let year = 1561; year <= 1590; year++) {
    const before = state, input = at(state, year);
    state = Dynasty.advance(input, before);
    assert.deepEqual(Dynasty.advance(input, before), state);
    assert.deepEqual(Dynasty.advance(state, before), state);
  }
  const children = state.officers.filter(o => o.id.startsWith('dyn-child-') && o.fatherId === 'oda_nobunaga');
  assert.equal(children.length, 4); assert.equal(children.filter(o => o.gender === 'male').length, 2); assert.equal(children.filter(o => o.gender === 'female').length, 2);
  for (const child of children) { assert.equal(child.origin, 'fictional'); assert.equal(child.isKin, true); assert.ok(child.biography.includes('架空')); count++; }
  assert.equal(count, 4);
});

test('marriage is restricted to unrelated adults and renews a four-season treaty while both spouses live', () => {
  const source = at(game(), 1577), view = Dynasty.getView(source), princess = view.princesses.find(o => o.id === 'oda_tokuhime');
  assert.equal(princess.age, 18); assert.equal(princess.marriageable, true);
  const target = view.marriageClans.find(c => c.id === 'matsudaira'); assert.ok(target);
  const result = Dynasty.act(source, { type: 'marry', princessId: princess.id, targetClan: target.id, spouseId: target.spouseId });
  assert.equal(result.ok, true); assert.ok(result.state.alliances.includes('matsudaira'));
  assert.equal(result.state.allianceExpires.matsudaira, result.state.turn + 4);
  assert.equal(Dynasty.act(result.state, { type: 'marry', princessId: princess.id, targetClan: target.id }).ok, false);
  const future = Dynasty.advance(at(result.state, 1578), result.state);
  assert.equal(future.allianceExpires.matsudaira, future.turn + 4);
  const underage = Dynasty.act(at(game(), 1576), { type: 'marry', princessId: princess.id, targetClan: 'matsudaira' });
  assert.equal(underage.ok, false);
  const died = structuredClone(future); died.officers.find(o => o.id === target.spouseId).status = 'dead';
  const ended = Dynasty.advance(at(died, 1579), died);
  assert.equal(ended.tenka.dynasty.marriages[0].active, false);
});

test('explicit clan leader metadata preserves historical starting heads', () => {
  Dynasty.configure({ clans: { oda: { leader: '柴田勝家', name: '織田家', capital: 'kiyosu' } } });
  assert.equal(Dynasty.getView(game()).family.head.id, 'shibata_katsuie');
  Dynasty.configure({});
});

// Canonical IDs, years, names and home castles copied from the shipped scenario.
test('canonical Takeda and Date family fixtures produce Katsuyori and Shigezane at their recorded years', () => {
  const source = game();
  source.playerClan = 'takeda';
  source.castles = [
    { id: 'tsutsujigasaki', clan: 'takeda', clanName: '武田家' },
    { id: 'yonezawa', clan: 'date', clanName: '伊達家' }
  ];
  source.officers = [
    officer('takeda_harunobu', '武田晴信', 'takeda', { castleId: 'tsutsujigasaki', birth: 1521, death: 1573, leadership: 97, valor: 86, intelligence: 94, politics: 92 }),
    officer('takeda_yoshinobu', '武田義信', 'takeda', { castleId: 'tsutsujigasaki', birth: 1538, death: 1567 }),
    officer('date_harumune', '伊達晴宗', 'date', { castleId: 'yonezawa', birth: 1519, death: 1578 }),
    officer('date_terumune', '伊達輝宗', 'date', { castleId: 'yonezawa', birth: 1544, death: 1585 }),
    officer('date_sanemoto', '伊達実元', 'date', { castleId: 'yonezawa', birth: 1527, death: 1587, leadership: 71, valor: 66, intelligence: 74, politics: 72 })
  ];
  const initial = Dynasty.initialize(source), katsuyori = initial.officers.find(o => o.id === 'takeda_katsuyori');
  assert.ok(katsuyori); assert.equal(katsuyori.fatherId, 'takeda_harunobu');
  assert.equal(katsuyori.status, 'child'); assert.equal(initial.year - katsuyori.birth, 14);
  assert.equal(katsuyori.castleId, 'tsutsujigasaki'); assert.equal(katsuyori.isKin, true);
  const year1561 = Dynasty.advance(at(initial, 1561), initial);
  assert.equal(year1561.officers.find(o => o.id === 'takeda_katsuyori').status, 'active');
  assert.equal(initial.officers.some(o => o.id === 'date_shigezane'), false);
  const year1568 = Dynasty.advance(at(year1561, 1568), year1561);
  const shigezane = year1568.officers.find(o => o.id === 'date_shigezane');
  assert.ok(shigezane); assert.equal(shigezane.fatherId, 'date_sanemoto');
  assert.equal(shigezane.birth, 1568); assert.equal(shigezane.status, 'child');
  assert.equal(shigezane.castleId, 'yonezawa'); assert.equal(shigezane.clan, 'date');
  assert.equal(year1568.officers.filter(o => o.id === 'date_shigezane').length, 1);
});


test('automatic heirs prefer actual sons over elders and preserve a deliberately chosen younger son', () => {
  const source = game(); source.playerClan = 'takeda';
  source.clans = { takeda: { leader: '武田晴信' }, date: { leader: '伊達晴宗' }, mori: { leader: '毛利隆元' }, shimazu: { leader: '島津貴久' }, chosokabe: { leader: '長宗我部国親' } };
  source.castles = [
    { id: 'tsutsujigasaki', clan: 'takeda', clanName: '武田家' },
    { id: 'yonezawa', clan: 'date', clanName: '伊達家' },
    { id: 'koriyama', clan: 'mori', clanName: '毛利家' },
    { id: 'uchijiro', clan: 'shimazu', clanName: '島津家' },
    { id: 'oko', clan: 'chosokabe', clanName: '長宗我部家' }
  ];
  const person = (id, name, clan, castleId, birth) => officer(id, name, clan, { castleId, birth });
  source.officers = [
    person('takeda_harunobu', '武田晴信', 'takeda', 'tsutsujigasaki', 1521),
    person('takeda_yoshinobu', '武田義信', 'takeda', 'tsutsujigasaki', 1538),
    person('date_tanemune', '伊達稙宗', 'date', 'yonezawa', 1488),
    person('date_harumune', '伊達晴宗', 'date', 'yonezawa', 1519),
    person('date_terumune', '伊達輝宗', 'date', 'yonezawa', 1544),
    person('date_sanemoto', '伊達実元', 'date', 'yonezawa', 1527),
    person('mori_motonari', '毛利元就', 'mori', 'koriyama', 1497),
    person('mori_takamoto', '毛利隆元', 'mori', 'koriyama', 1523),
    person('kikkawa_motoharu', '吉川元春', 'mori', 'koriyama', 1530),
    person('kobayakawa_takakage', '小早川隆景', 'mori', 'koriyama', 1533),
    person('shimazu_takahisa', '島津貴久', 'shimazu', 'uchijiro', 1514),
    person('shimazu_yoshihisa', '島津義久', 'shimazu', 'uchijiro', 1533),
    person('shimazu_yoshihiro', '島津義弘', 'shimazu', 'uchijiro', 1535),
    person('shimazu_toshihisa', '島津歳久', 'shimazu', 'uchijiro', 1537),
    person('shimazu_iehisa', '島津家久', 'shimazu', 'uchijiro', 1547),
    person('chosokabe_kunichika', '長宗我部国親', 'chosokabe', 'oko', 1504),
    person('chosokabe_motochika', '長宗我部元親', 'chosokabe', 'oko', 1539),
    person('chosokabe_chikasada', '長宗我部親貞', 'chosokabe', 'oko', 1541),
    person('kosokabe_chikayasu', '香宗我部親泰', 'chosokabe', 'oko', 1543)
  ];
  const initial = Dynasty.initialize(source), families = initial.tenka.dynasty.families;
  assert.equal(families.takeda.heirId, 'takeda_yoshinobu');
  assert.equal(families.date.headId, 'date_harumune');
  assert.equal(families.date.heirId, 'date_terumune');
  assert.equal(families.shimazu.heirId, 'shimazu_yoshihisa');
  assert.equal(families.chosokabe.heirId, 'chosokabe_motochika');
  for (const id of ['kikkawa_motoharu', 'kobayakawa_takakage', 'kosokabe_chikayasu']) assert.equal(initial.officers.find(o => o.id === id).isKin, true);
  assert.equal(initial.officers.find(o => o.id === 'kobayakawa_takakage').fatherId, 'mori_motonari');
  // Migrate prior automatic selections without overriding an actual player decision.
  initial.tenka.dynasty.families.takeda.heirId = 'takeda_katsuyori';
  initial.tenka.dynasty.families.date.heirId = 'date_tanemune';
  assert.equal(Dynasty.reconcile(initial).tenka.dynasty.families.takeda.heirId, 'takeda_yoshinobu');
  assert.equal(Dynasty.reconcile(initial).tenka.dynasty.families.date.heirId, 'date_terumune');
  const chosen = Dynasty.act(initial, { type: 'appointHeir', targetOfficerId: 'takeda_katsuyori' });
  assert.equal(chosen.ok, true); assert.equal(chosen.state.tenka.dynasty.families.takeda.heirDesignated, true);
  assert.equal(Dynasty.reconcile(chosen.state).tenka.dynasty.families.takeda.heirId, 'takeda_katsuyori');
});


test('new child IDs stay bounded across long existing ancestry and eight subsequent generations', () => {
  let state = game();
  const legacyId = ('dyn-child-oda-'.repeat(7) + 'parent').slice(0, 98);
  state.officers[0].id = legacyId;
  state.officers[0].origin = 'fictional';
  state.clans = { oda: { leader: '織田信長' }, matsudaira: { leader: '松平元康' } };
  state = Dynasty.initialize(state);
  let headId = legacyId;
  const seen = new Set(state.officers.map(o => o.id));
  for (let generation = 0; generation < 8; generation++) {
    const f = state.tenka.dynasty.families.oda;
    f.headId = headId; f.heirId = null; f.heirDesignated = false;
    const head = state.officers.find(o => o.id === headId);
    state = at(state, Math.max(state.year + 1, head.birth + 20));
    let child = null;
    for (let wait = 0; wait < 20 && !child; wait++) {
      const input = state, output = Dynasty.advance(input);
      assert.deepEqual(Dynasty.advance(input), output);
      assert.deepEqual(Dynasty.advance(output), output);
      child = output.officers.find(o => o.fatherId === headId && o.origin === 'fictional' && o.gender === 'male');
      state = child ? output : at(output, output.year + 1);
    }
    assert.ok(child, `generation ${generation} produces a son`);
    assert.ok(child.id.length < 100, child.id);
    assert.equal(seen.has(child.id), false, 'a new generation has a unique identity');
    seen.add(child.id);
    assert.equal(new Set(state.officers.map(o => o.id)).size, state.officers.length);
    assert.ok(state.officers.find(o => o.id === legacyId), 'older nested IDs stay unchanged');
    headId = child.id;
  }
});

test('known birth dates migrate from canonical records; unknown dates receive marked adult estimates', () => {
  const source = game();
  source.officers[0].birth = 1360;
  source.officers[1].birth = null;
  Dynasty.configure({ officers: [officer('oda_nobunaga', '織田信長', 'oda', { birth: 1534 })] });
  try {
    const state = Dynasty.initialize(source);
    const head = state.officers.find(o => o.id === 'oda_nobunaga'), retainer = state.officers.find(o => o.id === 'shibata_katsuie');
    assert.equal(head.birth, 1534); assert.equal(Dynasty.age(state, head), 26);
    assert.equal(retainer.birthEstimated, true); assert.ok(Dynasty.age(state, retainer) >= 28 && Dynasty.age(state, retainer) <= 55);
    assert.equal(retainer.status, 'active');
    assert.deepEqual(Dynasty.initialize(state), state, 'migration is stable across reads');
  } finally { Dynasty.configure({}); }
});

test('natural death clears commands, transfers the house to its designated child, and records actual age', () => {
  let state = Dynasty.act(game(), { type: 'appointHeir', targetOfficerId: 'oda_nobuo' }).state;
  const head = state.officers.find(o => o.id === 'oda_nobunaga');
  head.naturalDeathAge = 50; head.naturalDeathSeason = 1;
  state.armies.kiyosu = { commanderId: head.id, units: { ashigaru: 100 } };
  state.tenka.assignments[head.id] = { turn: state.turn, type: 'cultivate' };
  const before = at(state, 1584, 0), notYet = Dynasty.advance(before);
  assert.equal(notYet.officers.find(o => o.id === head.id).status, 'active');
  const after = Dynasty.advance(at(notYet, 1584, 1), notYet), dead = after.officers.find(o => o.id === head.id);
  assert.equal(dead.status, 'dead'); assert.equal(dead.deathCause, 'natural'); assert.equal(dead.deathYear, 1584);
  assert.equal(dead.historicalDeath, 1600); assert.equal(dead.diedAtAge, 50); assert.equal(after.armies.kiyosu.commanderId, null);
  assert.equal(after.tenka.assignments[head.id], undefined);
  assert.equal(Dynasty.getView(after).family.head.id, 'oda_nobuo');
  assert.equal(after.tenka.dynasty.deaths.filter(d => d.officerId === head.id).length, 1);
  assert.deepEqual(Dynasty.advance(after), after, 'no new mortality draw on repeated advance');
  const future = Dynasty.initialize(at(after, 1784));
  assert.equal(Dynasty.age(future, future.officers.find(o => o.id === head.id)), 50, 'deceased ages stop advancing');
});

test('two-hundred-year legacy survivors are retired without reviving deaths or corrupting estate progress', () => {
  const source = Dynasty.initialize(game()); source.year = 1770; source.turn = 841;
  source.gold = 9876; source.officers.find(o => o.id === 'shibata_katsuie').status = 'dead';
  const state = Dynasty.reconcile(source);
  assert.equal(state.gold, 9876);
  assert.equal(state.officers.find(o => o.id === 'shibata_katsuie').status, 'dead');
  for (const o of state.officers) {
    if (o.status === 'dead') assert.ok(Dynasty.age(state, o) <= 100, o.name);
    else if (o.status !== 'unborn') assert.ok(Dynasty.age(state, o) <= 100, o.name);
  }
  const original = structuredClone(state);
  assert.deepEqual(Dynasty.reconcile(state), original);
  const hired = Dynasty.act(state, { type: 'recruit' }); assert.equal(hired.ok, true, hired.message);
  assert.ok(Dynasty.getView(hired.state).family.head);
});

test('retainer children appear in their recorded years, follow the father clan, mature, and never duplicate', () => {
  let state = game();
  state.officers.push(officer('maeda_toshiie', '前田利家', 'oda', { birth: 1538 }),
    officer('honda_masanobu', '本多正信', 'matsudaira', { birth: 1538 }));
  state = Dynasty.initialize(state);
  assert.equal(state.officers.some(o => o.id === 'maeda_toshinaga'), false);
  state = Dynasty.advance(at(state, 1562));
  const son = state.officers.find(o => o.id === 'maeda_toshinaga');
  assert.equal(son.birth, 1562); assert.equal(son.status, 'child'); assert.equal(son.fatherId, 'maeda_toshiie');
  assert.equal(son.isKin, false, 'a retainer child does not become a blood relative of the daimyo');
  state = Dynasty.advance(at(state, 1565));
  assert.equal(state.officers.find(o => o.id === 'honda_masazumi').birth, 1565);
  state = Dynasty.advance(at(state, 1577));
  assert.equal(state.officers.find(o => o.id === son.id).status, 'active');
  assert.equal(Dynasty.reconcile(state).officers.filter(o => o.id === son.id).length, 1);
  let deadParent = game(); deadParent.officers.push(officer('maeda_toshiie', '前田利家', 'oda', { birth: 1538, status: 'dead' }));
  deadParent = Dynasty.advance(at(deadParent, 1562));
  assert.equal(deadParent.officers.some(o => o.id === son.id), false);
});

test('age-based mortality, generation changes and records remain stable over a 240-year campaign', () => {
  let state = Dynasty.initialize(game());
  const initial = new Set(state.officers.map(o => o.id));
  for (let year = 1561; year <= 1800; year++) {
    state = Dynasty.advance(at(state, year));
    for (const o of state.officers.filter(o => !['dead', 'unborn'].includes(o.status))) assert.ok(Dynasty.age(state, o) <= 100, `${o.name}: ${Dynasty.age(state, o)}`);
    if (year % 20 === 0) assert.deepEqual(Dynasty.initialize(state), state, 'saved migration does not redraw lifespan or births');
  }
  assert.equal(state.officers.filter(o => initial.has(o.id) && o.status !== 'dead').length, 0);
  assert.ok(state.tenka.dynasty.families.oda.history.length > 3);
  assert.ok(state.officers.some(o => o.birth > 1700 && o.status === 'active'));
  assert.ok(state.tenka.dynasty.deaths.every(d => d.age <= 100));
});

test('documented natural longevity allows Ieyasu late children while battle deaths still branch genealogy',()=>{
 let state=Dynasty.initialize(game());
 const father=state.officers.find(o=>o.id==='matsudaira_motoyasu');assert.equal(father.naturalDeathAge,73);
 assert.equal(state.officers.find(o=>o.id==='oda_nobunaga').deathYear,undefined,'violent historical dates do not kill the player');
 for(let year=1561;year<=1603;year++)state=Dynasty.advance(at(state,year));
 for(const [id,birth] of [['tokugawa_yoshinao',1601],['tokugawa_yorinobu',1602],['tokugawa_yorifusa',1603]]){
   const child=state.officers.find(o=>o.id===id);assert.ok(child,id);assert.equal(child.birth,birth);assert.equal(child.status,'child');assert.equal(child.fatherId,father.id);
 }
 assert.equal(state.officers.find(o=>o.id===father.id).status,'active');
 let diverged=Dynasty.initialize(game());diverged=at(diverged,1600);
 Dynasty.recordDeath(diverged,father.id,{cause:'battle'});
 diverged=Dynasty.advance(at(diverged,1603));
 assert.equal(diverged.officers.some(o=>o.id==='tokugawa_yorifusa'),false,'historical births do not force a killed parent to survive');
 assert.equal(diverged.officers.find(o=>o.id===father.id).deathCause,'battle');
});

test('seasonal recruitment lists eight stable local candidates and every eligible ronin together', () => {
  const source = game();
  source.officers.push(officer('ronin_list_a', '浪人甲', 'matsudaira', { status: 'ronin', castleId: null }), officer('ronin_list_b', '浪人乙', 'matsudaira', { status: 'ronin', castleId: null }), officer('young_ronin', '幼年浪人', 'matsudaira', { status: 'ronin', birth: 1550, castleId: null }));
  const snapshot = JSON.stringify(source), first = Dynasty.getView(source).recruits;
  assert.equal(first.filter(o => o.id.startsWith('dyn-recruit-')).length, 8);
  assert.equal(first.length, 10);
  assert.equal(first.some(o => o.id === 'young_ronin'), false);
  assert.equal(new Set(first.map(o => o.id)).size, first.length);
  assert.equal(new Set(first.map(o => o.name)).size, first.length);
  assert.deepEqual(Dynasty.getView(JSON.parse(JSON.stringify(source))).recruits, first);
  assert.equal(JSON.stringify(source), snapshot, 'viewing the full list does not mutate the save');
  const selected = first[6], result = Dynasty.act(source, { type: 'recruit', candidateId: selected.id });
  assert.equal(result.ok, true, result.message);
  const hired = result.state.officers.find(o => o.id === selected.id);
  for (const key of ['name', 'birth', 'leadership', 'valor', 'intelligence', 'politics']) assert.equal(hired[key], selected[key], key);
  const remaining = Dynasty.getView(result.state).recruits;
  assert.deepEqual(remaining, first.filter(o => o.id !== selected.id), 'hiring one person leaves the rest of the list unchanged');
  assert.deepEqual(Dynasty.getView(JSON.parse(JSON.stringify(result.state))).recruits, remaining, 'saving retains the identities and order');
  assert.equal(Dynasty.act(result.state, { type: 'recruit', candidateId: selected.id }).ok, false, 'a removed candidate cannot be hired twice');
  const next = Dynasty.getView({ ...result.state, turn: 2, season: 1 }).recruits.filter(o => o.id.startsWith('dyn-recruit-'));
  assert.equal(next.length, 8);
  assert.equal(next.some(o => first.some(old => old.id === o.id)), false, 'the next season has a fresh pool');
});
