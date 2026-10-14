/* 天下布武: household, recruitment and succession rules. Generated people are labelled fictional. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaDynasty = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const UNITS = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
  let configuredClans = {};
  function configure(options = {}) { configuredClans = options.clans || {}; }
  const clone = value => JSON.parse(JSON.stringify(value));
  const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0; return n; };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const age = (s, o) => Number.isFinite(o?.birth) ? s.year - o.birth : 30;
  const point = s => s.year * 4 + (s.season || 0);
  const alive = o => !!o && !['dead', 'unborn'].includes(o.status);
  const adult = (s, o) => alive(o) && age(s, o) >= 15 && o.status === 'active';
  const owned = (s, clan) => (s.castles || []).filter(c => c.clan === clan);
  const officer = (s, id) => (s.officers || []).find(o => o.id === id);
  const female = o => (o?.gender || o?.sex) === 'female';
  const atHome = (s, o, clan) => alive(o) && o.clan === clan && !['captive', 'ronin'].includes(o.status);
  const surnames = ['長宗我部', '龍造寺', '小早川', '小野寺', '上杉', '武田', '北条', '織田', '徳川', '松平', '今川', '島津', '毛利', '伊達', '最上', '佐竹', '里見', '相馬', '蘆名', '南部', '安東', '蠣崎', '浅井', '朝倉', '斎藤', '六角', '三好', '細川', '足利', '大内', '尼子', '大友', '伊東', '相良', '有馬', '大村', '蒲池', '波多野', '長野', '真田', '木曽', '村上', '宇都宮', '小田', '結城', '長尾', '宇喜多', '豊臣', '羽柴', '木下', '前田', '池田', '本多', '酒井', '井伊', '榊原', '石川', '黒田', '鍋島', '立花', '高橋'];
  const surname = o => surnames.find(n => (o?.name || '').startsWith(n)) || (o?.name || '在地').slice(0, 2);
  const CLAN_NAMES = { oda: '織田家', matsudaira: '松平家', takeda: '武田家', uesugi: '上杉家', hojo: '北条家', date: '伊達家', shimazu: '島津家', mori: '毛利家', otomo: '大友家', imagawa: '今川家', ryuzoji: '龍造寺家', chokosabe: '長宗我部家', chosokabe: '長宗我部家' };
  const clanInfo = (s, id) => s.clans?.[id] || configuredClans[id] || root.TenkaGame?.clans?.[id] || {};
  const clanName = (s, id) => clanInfo(s, id).name || CLAN_NAMES[id] || owned(s, id)[0]?.clanName || `${id}家`;
  const log = (s, title, text) => {
    s.nextLogId = Math.max(1, Number(s.nextLogId) || 1);
    s.logs = [{ id: `dynasty-${s.nextLogId++}`, type: 'dynasty', title, text, date: `${s.year}年 ${['春', '夏', '秋', '冬'][s.season || 0]}` }, ...(s.logs || [])].slice(0, 80);
  };
  // Dates are birth years, not forced dates for death, marriage or succession.
  // An unborn historical child appears only if the recorded father remains alive in this house.
  const HISTORICAL = [
    ['oda_nobutada', '織田信忠', 'oda', 'oda_nobunaga', 1557, 'male', [82, 78, 72, 72]],
    ['oda_nobuo', '織田信雄', 'oda', 'oda_nobunaga', 1558, 'male', [57, 53, 48, 63]],
    ['oda_nobutaka', '織田信孝', 'oda', 'oda_nobunaga', 1558, 'male', [73, 77, 64, 58]],
    ['oda_tokuhime', '徳姫', 'oda', 'oda_nobunaga', 1559, 'female', [48, 39, 68, 74]],
    ['oda_fuyuhime', '冬姫', 'oda', 'oda_nobunaga', 1561, 'female', [48, 38, 64, 73]],
    ['matsudaira_nobuyasu', '松平信康', 'matsudaira', 'matsudaira_motoyasu', 1559, 'male', [79, 82, 59, 58]],
    ['tokugawa_kamehime', '亀姫', 'matsudaira', 'matsudaira_motoyasu', 1560, 'female', [51, 42, 72, 75]],
    ['tokugawa_tokuhime', '督姫', 'matsudaira', 'matsudaira_motoyasu', 1565, 'female', [49, 38, 74, 76]],
    ['yuki_hideyasu', '結城秀康', 'matsudaira', 'matsudaira_motoyasu', 1574, 'male', [83, 87, 65, 63]],
    ['tokugawa_hidetada', '徳川秀忠', 'matsudaira', 'matsudaira_motoyasu', 1579, 'male', [76, 65, 74, 86]],
    ['matsudaira_tadayoshi', '松平忠吉', 'matsudaira', 'matsudaira_motoyasu', 1580, 'male', [77, 79, 65, 68]],
    ['tokugawa_yoshinao', '徳川義直', 'matsudaira', 'matsudaira_motoyasu', 1601, 'male', [70, 65, 76, 83]],
    ['tokugawa_yorinobu', '徳川頼宣', 'matsudaira', 'matsudaira_motoyasu', 1602, 'male', [73, 72, 72, 81]],
    ['tokugawa_yorifusa', '徳川頼房', 'matsudaira', 'matsudaira_motoyasu', 1603, 'male', [69, 66, 74, 79]],
    ['date_masamune', '伊達政宗', 'date', 'date_terumune', 1567, 'male', [90, 85, 88, 85]],
    ['date_shigezane', '伊達成実', 'date', 'date_sanemoto', 1568, 'male', [84, 91, 65, 60]],
    ['date_irohahime', '五郎八姫', 'date', 'date_masamune', 1594, 'female', [49, 41, 72, 76]],
    ['takeda_katsuyori', '武田勝頼', 'takeda', 'takeda_harunobu', 1546, 'male', [83, 88, 66, 61]],
    ['takeda_nobukatsu', '武田信勝', 'takeda', 'takeda_katsuyori', 1567, 'male', [75, 77, 67, 64]],
    ['hojo_ujinao', '北条氏直', 'hojo', 'hojo_ujimasa', 1562, 'male', [76, 70, 67, 74]],
    ['shimazu_hisayasu', '島津久保', 'shimazu', 'shimazu_yoshihiro', 1573, 'male', [77, 78, 68, 71]],
    ['shimazu_tadatsune', '島津忠恒', 'shimazu', 'shimazu_yoshihiro', 1576, 'male', [81, 78, 80, 82]],
    ['shimazu_toyohisa', '島津豊久', 'shimazu', 'shimazu_iehisa', 1570, 'male', [81, 88, 60, 53]],
    ['mori_terumoto', '毛利輝元', 'mori', 'mori_takamoto', 1553, 'male', [72, 64, 66, 75]],
    ['otomo_yoshimune', '大友義統', 'otomo', 'otomo_sorin', 1558, 'male', [65, 66, 54, 61]],
    ['chosokabe_nobuchika', '長宗我部信親', 'chosokabe', 'chosokabe_motochika', 1565, 'male', [84, 82, 71, 74]],
    ['chosokabe_morichika', '長宗我部盛親', 'chosokabe', 'chosokabe_motochika', 1575, 'male', [78, 82, 63, 65]],
    ['sanada_nobuyuki', '真田信之', 'sanada', 'sanada_masayuki', 1566, 'male', [84, 78, 86, 86]],
    ['sanada_nobushige', '真田信繁', 'sanada', 'sanada_masayuki', 1567, 'male', [91, 93, 88, 62]],
    ['tokugawa_senhime', '千姫', 'matsudaira', 'tokugawa_hidetada', 1597, 'female', [47, 35, 73, 79]]
  ].map(([id, name, clan, fatherId, birth, gender, stats]) => ({ id, name, clan, fatherId, birth, gender, stats }));
  // Genealogy of people already in the scenario, including sons adopted into other surnames.
  const EXISTING_FATHERS = {
    takeda_yoshinobu: 'takeda_harunobu',
    shimazu_yoshihisa: 'shimazu_takahisa', shimazu_yoshihiro: 'shimazu_takahisa',
    shimazu_toshihisa: 'shimazu_takahisa', shimazu_iehisa: 'shimazu_takahisa',
    date_harumune: 'date_tanemune', date_sanemoto: 'date_tanemune', date_terumune: 'date_harumune',
    mori_takamoto: 'mori_motonari', kikkawa_motoharu: 'mori_motonari', kobayakawa_takakage: 'mori_motonari',
    chosokabe_motochika: 'chosokabe_kunichika', chosokabe_chikasada: 'chosokabe_kunichika', kosokabe_chikayasu: 'chosokabe_kunichika'
  };
  const ALIASES = { takeda_harunobu: ['takeda_shingen'], date_sanemoto: ['date_sanezane'], oda_nobuo: ['oda_nobukatsu'], yuki_hideyasu: ['matsudaira_hideyasu', 'tokugawa_hideyasu'], sanada_nobushige: ['sanada_yukimura'], otomo_sorin: ['otomo_yoshishige'] };
  const historicalPerson = (s, spec) => s.officers.find(o => o.id === spec.id || o.name === spec.name || (ALIASES[spec.id] || []).includes(o.id));
  const fatherOf = (s, spec) => officer(s, spec.fatherId) || s.officers.find(o => (ALIASES[spec.fatherId] || []).includes(o.id));
  function createOfficer(s, details) {
    const seed = hash(details.id), stats = details.stats || [49 + seed % 25, 46 + (seed >>> 4) % 28, 48 + (seed >>> 8) % 26, 51 + (seed >>> 12) % 24];
    const birth = details.birth, gender = details.gender || 'male';
    return {
      id: details.id, name: details.name, clan: details.clan, castleId: details.castleId || null,
      birth, currentYear: s.year, death: null, leadership: stats[0], valor: stats[1], intelligence: stats[2], politics: stats[3],
      aptitudes: Object.fromEntries(UNITS.map((unit, i) => [unit, 2 + (hash(`${details.id}:${i}`) % 3)])),
      status: s.year < birth ? 'unborn' : gender === 'female' ? 'princess' : s.year - birth < 15 ? 'child' : 'active',
      capturedBy: null, gender, sex: gender, origin: details.origin || 'fictional', isKin: !!details.isKin,
      fatherId: details.fatherId || null, motherId: details.motherId || null, marriedTo: null, marriageClan: null,
      biography: details.biography || 'ゲーム内で登場した架空の在地武将。史実の人物とは区別する。',
      ...details, gender, sex: gender
    };
  }
  function touchOfficer(s, o) {
    o.currentYear = s.year;
    o.gender ||= o.sex || (o.status === 'princess' ? 'female' : 'male'); o.sex = o.gender;
    o.origin ||= o.id.startsWith('dyn-') ? 'fictional' : 'historical';
    if (['dead', 'captive', 'ronin'].includes(o.status)) return;
    const years = age(s, o);
    if (years < 0) o.status = 'unborn';
    else if (female(o)) o.status = 'princess';
    else if (years < 15) o.status = 'child';
    else if (['child', 'unborn'].includes(o.status)) {
      o.status = 'active';
      if (s.tenka.dynasty.initialized && o.clan === s.playerClan) log(s, '元服', `${o.name}が十五歳となり元服しました。政務と合戦を任せられます。`);
    }
    const home = owned(s, o.clan)[0];
    if (home && !s.castles.some(c => c.id === o.castleId && c.clan === o.clan)) o.castleId = home.id;
    if (!home && o.status === 'active') { o.status = 'ronin'; o.castleId = null; }
    o.capturedBy = null;
  }
  function prepare(input) {
    const s = clone(input);
    s.officers ||= []; s.castles ||= []; s.tenka ||= {}; s.tenka.loyalty ||= {}; s.tenka.assignments ||= {};
    const old = s.tenka.dynasty || {};
    s.tenka.dynasty = { version: 1, families: {}, events: [], marriages: [], recruitment: {}, ...old };
    const d = s.tenka.dynasty;
    for (const key of ['families', 'recruitment']) if (!d[key] || typeof d[key] !== 'object' || Array.isArray(d[key])) d[key] = {};
    for (const key of ['events', 'marriages']) if (!Array.isArray(d[key])) d[key] = [];
    for (const o of s.officers) touchOfficer(s, o);
    for (const [childId, fatherId] of Object.entries(EXISTING_FATHERS)) {
      const child = officer(s, childId);
      const father = officer(s, fatherId) || s.officers.find(o => (ALIASES[fatherId] || []).includes(o.id));
      if (child && father) { child.fatherId = father.id; child.isKin = true; father.isKin = true; }
    }
    const clans = [...new Set([...s.castles.map(c => c.clan), ...s.officers.map(o => o.clan)])];
    for (const clan of clans) {
      if (!clan) continue;
      if (!d.families[clan]) {
        const people = s.officers.filter(o => atHome(s, o, clan));
        const leaderName = (clanInfo(s, clan).leader || '').replace(/\s/g, '');
        const named = people.find(o => o.name.replace(/\s/g, '') === leaderName);
        const capitalCommander = officer(s, s.armies?.[clanInfo(s, clan).capital]?.commanderId);
        const first = named || (capitalCommander && atHome(s, capitalCommander, clan) ? capitalCommander : null) || people.find(o => adult(s, o)) || people[0] || null;
        d.families[clan] = { headId: first?.id || null, founderId: first?.id || null, heirId: null, regentId: null, kinIds: [], history: [], birthSchedules: {} };
      }
      const f = d.families[clan]; f.kinIds ||= []; f.history ||= []; f.birthSchedules ||= {};
      const founder = officer(s, f.founderId || f.headId), familyName = founder ? surname(founder) : null;
      for (const o of s.officers.filter(o => o.clan === clan)) {
        if (o.id === f.headId || o.isKin || (familyName && o.origin !== 'fictional' && o.name.startsWith(familyName))) {
          o.isKin = true; if (!f.kinIds.includes(o.id)) f.kinIds.push(o.id);
        }
      }
    }
    return s;
  }
  function addHistorical(s) {
    const d = s.tenka.dynasty;
    for (const spec of HISTORICAL) {
      const eventId = `historical-birth:${spec.id}`, existing = historicalPerson(s, spec), father = fatherOf(s, spec);
      const clan = father?.clan || spec.clan;
      if (existing) {
        existing.fatherId ||= father?.id || spec.fatherId; existing.isKin ||= !!father?.isKin;
        existing.gender = spec.gender; existing.sex = spec.gender;
        const f = d.families[existing.clan]; if (f && existing.isKin && !f.kinIds.includes(existing.id)) f.kinIds.push(existing.id);
        if (s.year >= spec.birth && !d.events.includes(eventId)) d.events.push(eventId);
        touchOfficer(s, existing); continue;
      }
      if (s.year < spec.birth || d.events.includes(eventId)) continue;
      d.events.push(eventId);
      if (!father || !alive(father) || father.status === 'captive' || father.status === 'ronin' || !owned(s, clan).length) continue;
      const o = createOfficer(s, { ...spec, clan, fatherId: father.id, castleId: father.castleId || owned(s, clan)[0].id,
        origin: 'historical', isKin: !!father.isKin, biography: `${spec.name}。生年${spec.birth}年を基準に登場する史実人物。親の生存・在籍に応じて出生し、十五歳で元服する。能力はゲーム用の評価。` });
      s.officers.push(o); s.tenka.loyalty[o.id] = 90;
      const f = d.families[clan]; if (f && o.isKin && !f.kinIds.includes(o.id)) f.kinIds.push(o.id);
      if (d.initialized && clan === s.playerClan) log(s, '一門に新しい命', `${o.name}（史実の生年 ${o.birth}年）が誕生しました。${female(o) ? '姫として一門に加わり、成人後に婚姻を結べます。' : '一門の子として育ち、十五歳で政務と合戦を担います。'}`);
    }
  }
  function kinSort(s, a, b) {
    const ah = a.fatherId === s.tenka.dynasty.families[a.clan]?.headId ? 1 : 0;
    const bh = b.fatherId === s.tenka.dynasty.families[b.clan]?.headId ? 1 : 0;
    return bh - ah || (Number(a.birth) || 0) - (Number(b.birth) || 0) || a.id.localeCompare(b.id);
  }
  function validHeir(s, o, clan, headId) { return atHome(s, o, clan) && o.id !== headId && !female(o) && (o.isKin || adult(s, o)); }
  function selectHeir(s, clan, headId) {
    const people = s.officers.filter(o => validHeir(s, o, clan, headId));
    return people.filter(o => o.isKin).sort((a, b) => kinSort(s, a, b))[0] || people.filter(o => adult(s, o)).sort((a, b) => b.politics + b.leadership - a.politics - a.leadership)[0] || null;
  }
  function updateFamilies(s) {
    const d = s.tenka.dynasty;
    for (const [clan, f] of Object.entries(d.families)) {
      if (!owned(s, clan).length) { f.regentId = null; continue; }
      let head = officer(s, f.headId);
      const invalid = !head || head.status === 'dead' || head.status === 'ronin' || head.clan !== clan;
      if (invalid) {
        const previous = head;
        const designated = officer(s, f.heirId);
        head = validHeir(s, designated, clan, f.headId) ? designated : selectHeir(s, clan, f.headId);
        if (head) {
          head.isKin = true; if (!f.kinIds.includes(head.id)) f.kinIds.push(head.id);
          if (!head.fatherId && !head.isFounder) head.adoptedInto = clan;
          f.headId = head.id; f.heirId = null; f.heirDesignated = false;
          f.history.unshift({ turn: s.turn, year: s.year, headId: head.id, previousId: previous?.id || null, reason: previous?.status === 'dead' ? 'death' : 'succession' });
          f.history = f.history.slice(0, 80);
          if (d.initialized && clan === s.playerClan) log(s, '家督の継承', `${previous?.name || clanName(s, clan)}の家督を${head.name}が継ぎました。${age(s, head) < 15 ? '幼君を後見人が支えます。' : '領国と家臣団を引き継ぎます。'}`);
        } else f.headId = null;
      }
      if (!f.heirDesignated || !validHeir(s, officer(s, f.heirId), clan, f.headId)) {
        f.heirId = selectHeir(s, clan, f.headId)?.id || null;
        f.heirDesignated = false;
      }
      const needsRegent = !head || age(s, head) < 15 || head.status === 'captive' || !adult(s, head);
      const regent = officer(s, f.regentId);
      if (needsRegent) {
        if (!regent || regent.clan !== clan || !adult(s, regent) || regent.id === head?.id) {
          f.regentId = s.officers.filter(o => o.clan === clan && adult(s, o) && o.id !== head?.id).sort((a, b) => (b.politics + b.leadership) - (a.politics + a.leadership))[0]?.id || null;
        }
      } else if (!f.regentDesignated || !regent || !adult(s, regent) || regent.clan !== clan || regent.id === head?.id) f.regentId = null;
      for (const o of s.officers.filter(o => o.clan === clan)) {
        o.lineageRole = o.id === f.headId ? 'head' : o.id === f.heirId ? 'heir' : female(o) && o.isKin ? 'daughter' : o.fatherId && o.isKin ? 'son' : o.isKin ? 'kin' : 'retainer';
      }
    }
  }
  function initialize(input) {
    const s = prepare(input); addHistorical(s); updateFamilies(s); s.tenka.dynasty.initialized = true; return s;
  }
  function reconcile(input) { return initialize(input); }
  function proceduralBirths(s) {
    const d = s.tenka.dynasty;
    for (const [clan, f] of Object.entries(d.families)) {
      const head = officer(s, f.headId);
      if (!head || !adult(s, head) || female(head) || age(s, head) < 18 || age(s, head) > 55 || !owned(s, clan).length) continue;
      const key = head.id;
      if (!f.birthSchedules[key]) f.birthSchedules[key] = { nextYear: s.year + 1 + hash(key) % 3, born: 0 };
      const schedule = f.birthSchedules[key];
      if (s.season !== 0 || s.year < schedule.nextYear || schedule.born >= 4) continue;
      const gender = (schedule.born + hash(key)) % 2 ? 'female' : 'male';
      // Parent IDs already contain ancestry for older saves; never nest them into a child's ID.
      const baseId = `dyn-child-${clan.slice(0, 24)}-${hash(head.id).toString(36)}-${s.year}-${schedule.born + 1}`;
      let id = baseId, collision = 0, existing = officer(s, id);
      while (existing && (existing.fatherId !== head.id || existing.birth !== s.year)) {
        id = `${baseId}-${++collision}`; existing = officer(s, id);
      }
      if (!existing) {
        const given = gender === 'female' ? ['春', '菊', '月', '雪'][schedule.born % 4] + '姫' : ['義成', '景成', '信継', '晴継'][hash(id) % 4];
        const name = `${surname(head)}${given}` + (s.officers.some(o => o.name === `${surname(head)}${given}`) ? `（${schedule.born + 1}）` : '');
        const o = createOfficer(s, { id, name, clan, castleId: owned(s, clan)[0].id, birth: s.year, gender, fatherId: head.id, isKin: true,
          biography: `${head.name}の${gender === 'female' ? '娘' : '息子'}としてゲーム内で生まれた架空人物。史実の系譜とは区別する。` });
        s.officers.push(o); s.tenka.loyalty[id] = 95; f.kinIds.push(id);
        if (clan === s.playerClan) log(s, gender === 'female' ? '姫の誕生' : '一門に男子誕生', `${head.name}の家に${name}が誕生しました（架空の子）。${gender === 'female' ? '姫として育ち、十八歳以降は政略結婚を結べます。' : '一門衆に加わり、十五歳で元服します。'}`);
      }
      schedule.born++; schedule.nextYear = s.year + 4;
    }
  }
  function renewMarriages(s) {
    const d = s.tenka.dynasty; s.alliances ||= []; s.allianceExpires ||= {}; s.relations ||= {}; s.npcPacts ||= [];
    for (const m of d.marriages) {
      const a = officer(s, m.princessId), b = officer(s, m.spouseId);
      if (!alive(a) || !alive(b) || !owned(s, m.fromClan).length || !owned(s, m.toClan).length) { m.active = false; continue; }
      m.active = true;
      if ([m.fromClan, m.toClan].includes(s.playerClan)) {
        const other = m.fromClan === s.playerClan ? m.toClan : m.fromClan;
        if (!s.alliances.includes(other)) s.alliances.push(other);
        s.allianceExpires[other] = s.turn + 4; s.relations[other] = Math.max(75, s.relations[other] || 0);
      } else if (!s.npcPacts.some(pair => pair.includes(m.fromClan) && pair.includes(m.toClan))) s.npcPacts.push([m.fromClan, m.toClan]);
    }
  }
  function advance(input, previous) {
    const s = initialize(input), d = s.tenka.dynasty;
    if (s.gameOver || d.lastAdvancedTurn === s.turn) return s;
    d.lastAdvancedTurn = s.turn;
    proceduralBirths(s); updateFamilies(s); renewMarriages(s); return s;
  }
  function candidate(s, clan = s.playerClan) {
    const rec = s.tenka.dynasty.recruitment[clan], sequence = rec?.turn === s.turn ? rec.count || 0 : 0;
    const id = `dyn-recruit-${clan}-${s.turn}-${sequence}`, seed = hash(id), names = ['庄田', '岩村', '中島', '稲葉', '村井', '山岡', '三田', '大沢', '河村', '小坂'];
    const givens = ['宗直', '景久', '義綱', '清成', '盛忠', '信重', '晴綱', '忠俊', '景長', '正継'];
    let name = names[seed % names.length] + givens[(seed >>> 8) % givens.length];
    if (s.officers.some(o => o.name === name)) name += `（${s.turn}-${sequence + 1}）`;
    const emergency = !s.officers.some(o => o.clan === clan && adult(s, o));
    const person = createOfficer(s, { id, name, clan, castleId: owned(s, clan)[0]?.id, birth: s.year - (20 + seed % 20), origin: 'fictional' });
    return { ...person, age: age(s, person), cost: emergency ? 0 : 150, commandCost: emergency ? 0 : 1, emergency,
      description: emergency ? '成人の家臣がいないため、在地の人材が無償で仕官。担当武将・命令は不要。' : '架空の在地人材。必ず登用でき、担当武将は不要。金150貫・命令1。' };
  }
  function recruits(s) {
    const local = candidate(s);
    const ronin = s.officers.filter(o => o.status === 'ronin' && age(s, o) >= 15 && !female(o)).map(o => ({ ...o, age: age(s, o), cost: local.cost, commandCost: local.commandCost, emergency: local.emergency, description: '浪人を新たな家臣として登用。担当武将は不要。' }));
    return [local, ...ronin];
  }
  function related(s, a, b) {
    const ancestors = o => { const ids = new Set([o.id]); let frontier = [o]; for (let i = 0; i < 3; i++) { const next = []; for (const p of frontier) for (const id of [p.fatherId, p.motherId]) { if (id) ids.add(id); const parent = officer(s, id); if (parent) next.push(parent); } frontier = next; } return ids; };
    const first = ancestors(a), second = ancestors(b); return [...first].some(id => second.has(id));
  }
  function marriageTargets(s, princess) {
    return [...new Set(s.castles.map(c => c.clan))].filter(id => id !== s.playerClan).map(id => {
      const f = s.tenka.dynasty.families[id];
      const people = s.officers.filter(o => atHome(s, o, id) && !female(o) && age(s, o) >= 18 && !o.marriedTo && (!princess || !related(s, princess, o)));
      const spouse = people.find(o => o.id === f?.heirId) || people.find(o => o.id === f?.headId) || people.find(o => o.isKin);
      return spouse ? { id, name: clanName(s, id), spouseId: spouse.id, spouseName: spouse.name } : null;
    }).filter(Boolean);
  }
  function act(input, action = {}) {
    const s = initialize(input), d = s.tenka.dynasty, clan = s.playerClan, f = d.families[clan];
    const fail = message => ({ ok: false, state: input, message });
    if (s.gameOver) return fail('この年代記は決着しています。');
    if (!f || !owned(s, clan).length) return fail('領地のある大名家で実行してください。');
    let message;
    if (action.type === 'recruit') {
      const choices = recruits(s), selected = action.candidateId ? choices.find(o => o.id === action.candidateId) : choices[0];
      if (!selected) return fail('登用候補が変わりました。現在の候補を選んでください。');
      const record = d.recruitment[clan];
      if (record?.turn === s.turn && record.count >= 2 && !selected.emergency) return fail('今季の新規登用は二人までです。次の季節に新たな人材が現れます。');
      if ((s.gold || 0) < selected.cost) return fail(`登用には金${selected.cost}貫が必要です。`);
      if ((s.actionPoints || 0) < selected.commandCost) return fail('登用には命令1が必要です。季節を進めると回復します。');
      let person = officer(s, selected.id);
      if (person && person.status !== 'ronin') return fail('その人物は現在登用できません。');
      if (person) Object.assign(person, { clan, castleId: owned(s, clan)[0].id, status: 'active', capturedBy: null, isKin: false });
      else {
        person = createOfficer(s, { id: selected.id, name: selected.name, clan, castleId: owned(s, clan)[0].id, birth: selected.birth, gender: 'male', origin: 'fictional', stats: [selected.leadership, selected.valor, selected.intelligence, selected.politics] });
        s.officers.push(person);
      }
      s.gold -= selected.cost; s.actionPoints -= selected.commandCost; s.tenka.loyalty[person.id] = 82;
      d.recruitment[clan] = { turn: s.turn, count: (record?.turn === s.turn ? record.count || 0 : 0) + 1 };
      message = `${person.name}を登用しました。すぐに政務・合戦を任せられます。${selected.emergency ? '家臣不在のため金・命令は消費しません。' : '金150貫・命令1を使用しました。'}`;
    } else if (action.type === 'appointHeir') {
      const target = officer(s, action.targetOfficerId);
      if (!validHeir(s, target, clan, f.headId)) return fail('自家の一門、または養子に迎える成人の家臣を選んでください。');
      target.isKin = true;
      if (!f.kinIds.includes(target.id)) { f.kinIds.push(target.id); target.adoptedInto = clan; }
      f.heirId = target.id; f.heirDesignated = true;
      message = `${target.name}を世継ぎに定めました。${age(s, target) < 15 ? '幼少の間に家督を継いだ場合は、成人の後見人が支えます。' : '当主が倒れたときに家督を継承します。'}`;
    } else if (action.type === 'appointRegent') {
      const target = officer(s, action.targetOfficerId), head = officer(s, f.headId);
      if (!target || target.clan !== clan || !adult(s, target) || target.id === head?.id) return fail('当主以外の十五歳以上の自家武将を後見人に選んでください。');
      f.regentId = target.id; f.regentDesignated = true;
      message = `${target.name}を後見人に定めました。幼君・捕縛中の当主に代わって家を支えます。`;
    } else if (action.type === 'marry') {
      const princess = officer(s, action.princessId), targetClan = action.targetClan;
      if (!princess || princess.clan !== clan || !female(princess) || !princess.isKin || !atHome(s, princess, clan) || age(s, princess) < 18 || princess.marriedTo) return fail('十八歳以上で未婚の自家の姫を選んでください。');
      if (!targetClan || targetClan === clan || !owned(s, targetClan).length) return fail('婚姻を結ぶ他家を選んでください。');
      const proposed = action.spouseId || marriageTargets(s, princess).find(c => c.id === targetClan)?.spouseId;
      const spouse = officer(s, proposed);
      if (!spouse || !atHome(s, spouse, targetClan) || female(spouse) || age(s, spouse) < 18 || spouse.marriedTo || !spouse.isKin || related(s, princess, spouse)) return fail('相手家の十八歳以上で未婚の一門を選んでください。');
      princess.marriedTo = spouse.id; princess.marriageClan = targetClan; spouse.marriedTo = princess.id; spouse.marriageClan = clan;
      d.marriages.push({ id: `marriage:${princess.id}:${spouse.id}`, princessId: princess.id, spouseId: spouse.id, fromClan: clan, toClan: targetClan, turn: s.turn, year: s.year, active: true });
      renewMarriages(s);
      message = `${princess.name}と${clanName(s, targetClan)}の${spouse.name}が婚姻を結びました。両家と二人が健在な間、婚姻同盟を維持します。`;
    } else return fail('不明な家中の命令です。');
    updateFamilies(s);
    // A designated adult regent remains selectable in advance of an emergency.
    if (action.type === 'appointRegent') f.regentId = action.targetOfficerId;
    log(s, { recruit: '新たな家臣の登用', appointHeir: '世継ぎの指定', appointRegent: '後見人の指定', marry: '両家の婚姻' }[action.type], message);
    return { ok: true, state: s, message };
  }
  function viewOfficer(s, o) {
    if (!o) return null;
    return { ...o, age: age(s, o), marriageable: female(o) && age(s, o) >= 18 && !o.marriedTo && atHome(s, o, s.playerClan), adult: adult(s, o), comingAge: o.birth + 15 };
  }
  function getView(input) {
    const s = initialize(input), d = s.tenka.dynasty, clan = s.playerClan, f = d.families[clan] || {};
    const own = s.officers.filter(o => o.clan === clan), kin = own.filter(o => o.isKin && o.status !== 'unborn');
    const upcoming = [];
    for (const spec of HISTORICAL) {
      const father = fatherOf(s, spec);
      if (spec.birth > s.year && father?.clan === clan && alive(father) && !d.events.includes(`historical-birth:${spec.id}`)) upcoming.push({ id: spec.id, year: spec.birth, title: `${spec.name}の誕生`, text: '史実の生年。親が生存し自家に在籍する場合に登場。', kind: 'birth', origin: 'historical' });
    }
    for (const o of own.filter(o => alive(o) && !female(o) && age(s, o) < 15)) upcoming.push({ id: `coming-age:${o.id}`, year: o.birth + 15, title: `${o.name}の元服`, text: '十五歳から政務・合戦を担当できます。', kind: 'comingAge', origin: o.origin });
    return {
      family: { ...f, head: viewOfficer(s, officer(s, f.headId)), heir: viewOfficer(s, officer(s, f.heirId)), regent: viewOfficer(s, officer(s, f.regentId)) },
      kin: kin.map(o => viewOfficer(s, o)), princesses: kin.filter(female).map(o => viewOfficer(s, o)),
      recruits: owned(s, clan).length ? recruits(s) : [],
      eligibleHeirs: own.filter(o => validHeir(s, o, clan, f.headId)).map(o => viewOfficer(s, o)),
      eligibleRegents: own.filter(o => adult(s, o) && o.id !== f.headId).map(o => viewOfficer(s, o)),
      marriageClans: marriageTargets(s), upcoming: upcoming.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))
    };
  }
  return { configure, initialize, advance, reconcile, act, getView, HISTORICAL };
});
