/* 天下布武: strategy rules. Economic values and officer abilities are game models. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaSystems = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SEASONS = ['春', '夏', '秋', '冬'];
  const UNITS = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const sum = (v) => UNITS.reduce((n, k) => n + (v?.[k] || 0), 0);
  const hash = (v) => { let h = 2166136261; for (const c of String(v)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const date = (s) => `${s.year}年 ${SEASONS[s.season]}`;
  const point = (s) => s.year * 4 + s.season;
  const owned = (s, clan = s.playerClan) => s.castles.filter(c => c.clan === clan);
  const getOfficer = (s, id) => s.officers.find(o => o.id === id);
  const getCastle = (s, id) => s.castles.find(c => c.id === id);
  const alive = (o) => !!o && o.status !== 'dead';
  const adult = (s, o) => o.birth == null || s.year - o.birth >= 15;
  const active = (s, o) => !!o && o.status === 'active' && adult(s, o);
  const number = (v, fallback) => Number.isFinite(v) ? v : fallback;
  const append = (s, type, title, text) => {
    s.nextLogId = Math.max(1, number(s.nextLogId, 1));
    s.logs = [{ id: `chronicle-${s.nextLogId++}`, type, title, text, date: date(s) }, ...(s.logs || [])].slice(0, 80);
  };
  const SOURCES = [
    { id: 'teppokan', title: '西之表市・種子島開発総合センター（鉄砲館）', url: 'https://www.city.nishinoomote.lg.jp/', verification: 'reference; official website fetch blocked by network proxy' },
    { id: 'shinshiro', title: '新城市・設楽原歴史資料館／長篠城址史跡保存館', url: 'https://www.city.shinshiro.lg.jp/kanko/', verification: 'reference; official website fetch blocked by network proxy' },
    { id: 'azuchi', title: '滋賀県立安土城考古博物館', url: 'https://azuchi-museum.or.jp/', verification: 'reference; not fetched in this session' },
    { id: 'kyoto', title: '京都市歴史資料館', url: 'https://www.city.kyoto.lg.jp/bunshi/soshiki/1-3-0-0-0_13.html', verification: 'reference; not fetched in this session' },
    { id: 'odawara', title: '小田原城公式サイト', url: 'https://odawaracastle.com/', verification: 'reference; not fetched in this session' }
  ];
  const EVENTS = [
    { id: '1543-firearms', year: 1543, season: 2, title: '鉄砲伝来', text: '天文十二年、種子島に火縄銃が伝来したと伝わる。島内での製造から各地へ生産・運用が広まった。1560年開始の本作では伝来済みとして扱う。', source: 'teppokan', effect: 'firearms' },
    { id: '1549-xavier', year: 1549, season: 1, title: 'ザビエル来日', text: 'フランシスコ・ザビエルが鹿児島に上陸。南蛮貿易とキリスト教の伝来が戦国の外交・交易に新たなつながりを生んだ。', source: 'teppokan', effect: 'chronicle' },
    { id: '1560-okehazama', year: 1560, season: 1, title: '桶狭間の戦い', text: '史実では永禄三年五月、織田信長が今川義元を破った。人物の討死や領土の移動は本作では実際の合戦結果に従う。', source: 'shinshiro', clans: ['oda', 'imagawa'], officers: ['oda_nobunaga', 'imagawa_yoshimoto'], effect: 'resolve' },
    { id: '1561-kawanakajima', year: 1561, season: 2, title: '第四次川中島の戦い', text: '史実では武田信玄と上杉政虎が川中島で激戦を交えた。双方の勢力が残る場合、国境の緊張が高まる。', source: 'shinshiro', clans: ['takeda', 'uesugi'], effect: 'rivalry' },
    { id: '1562-kiyosu', year: 1562, season: 0, title: '清洲同盟', text: '史実では織田信長と松平元康が結んだ同盟が両家の基盤を固めた。両家が健在なら友好が上昇し、同盟そのものは外交交渉で結ぶ。', source: 'shinshiro', clans: ['oda', 'matsudaira'], officers: ['oda_nobunaga'], effect: 'friendship' },
    { id: '1567-rakuichi', year: 1567, season: 2, title: '楽市・楽座の展開', text: '史実では信長が美濃を制して岐阜に本拠を移し、楽市の制札を掲げた。商業施策を進めた城では交易収入が伸びる。', source: 'azuchi', effect: 'markets' },
    { id: '1568-kyoto', year: 1568, season: 2, title: '信長の上洛', text: '史実では織田信長が足利義昭を奉じて上洛した。本作では山城の領有と信長の生存・在籍が揃った場合のみ威信が上昇する。', source: 'kyoto', clans: ['oda'], officers: ['oda_nobunaga'], province: '山城', effect: 'prestige' },
    { id: '1571-hieizan', year: 1571, season: 2, title: '比叡山焼き討ち', text: '史実では信長の軍勢が比叡山を焼き討ちにした。多数の犠牲を伴う事件であり、本作では年代記として紹介し、焼き討ちを自動実行しない。', source: 'kyoto', effect: 'chronicle' },
    { id: '1573-bakufu', year: 1573, season: 1, title: '足利義昭の京都退去', text: '史実では義昭が信長により京都を追われ、室町幕府が事実上終焉を迎えた。独自に変化した本作の支配関係は維持される。', source: 'kyoto', effect: 'chronicle' },
    { id: '1575-nagashino', year: 1575, season: 1, title: '長篠・設楽原の戦い', text: '史実では織田・徳川連合軍と武田軍が激突した。鉄砲・馬防柵・地形を組み合わせた戦術の知見が広まる。「三段撃ち」の細部には議論がある。', source: 'shinshiro', clans: ['oda', 'takeda'], effect: 'drill' },
    { id: '1576-azuchi', year: 1576, season: 0, title: '安土城の築城開始', text: '史実では近江に安土城の築城が始まった。信長が健在で織田家が近江を支配していれば、その領内の城の改修技術が向上する。', source: 'azuchi', clans: ['oda'], officers: ['oda_nobunaga'], province: '近江', effect: 'fortification' },
    { id: '1582-honnoji', year: 1582, season: 1, title: '本能寺の変', text: '史実では明智光秀の謀反により信長が本能寺で最期を迎えた。本作は家臣の忠誠・在籍・戦況に従うため、信長の死や家の滅亡を強制しない。', source: 'kyoto', clans: ['oda'], officers: ['oda_nobunaga'], effect: 'unrest' },
    { id: '1588-katanagari', year: 1588, season: 1, title: '刀狩令', text: '史実では豊臣秀吉が刀狩令を発し、兵農分離を進めた。本作では年代記として紹介し、徴兵数は各領地の石高と人口から算出する。', source: 'azuchi', effect: 'chronicle' },
    { id: '1590-odawara', year: 1590, season: 1, title: '小田原合戦', text: '史実では秀吉の大軍が小田原を包囲し、北条氏が降伏した。本作では城の所有・籠城の結果を変えず、実際の戦況に従う。', source: 'odawara', effect: 'chronicle' }
  ];
  const ACTIONS = {
    reclaim: { label: '開墾・治水', gold: 300, food: 0, stat: 'politics', description: '担当武将の政治に応じて石高を増やし、収穫と動員上限を高める。' },
    commercial: { label: '商業・港整備', gold: 350, food: 0, stat: 'politics', description: '城ごとの商業段階を上げ、季節ごとの金収入を増やす。沿岸は交易に有利。' },
    levy: { label: '石高に応じた徴兵', gold: 250, food: 350, stat: 'leadership', description: '石高・人口・地形が定める上限内で足軽を募る。' },
    reward: { label: '家臣への恩賞', gold: 200, food: 0, stat: 'politics', description: '対象の自家武将の忠誠を高め、敵の調略を防ぐ。' },
    negotiation: { label: '外交使節', gold: 300, food: 0, stat: 'politics', description: '政治・知略で友好を上げ、75以上で四季の同盟を結ぶ。' },
    infiltrate: { label: '内応工作', gold: 420, food: 0, stat: 'intelligence', description: '敵武将の忠誠を削り、疲弊し忠誠の低い武将を引き抜く。発覚すると関係が悪化。' },
    enlist: { label: '捕虜を召し抱える', gold: 220, food: 0, stat: 'politics', description: '自家の捕虜を説得し、新たな家臣にする。成功率は忠誠と使者の能力次第。' },
    release: { label: '捕虜を解放', gold: 0, food: 0, stat: 'politics', description: '捕虜を旧主へ返す。旧主が滅亡していれば浪人となる。' },
    execute: { label: '捕虜を処断', gold: 0, food: 0, stat: 'leadership', description: '捕虜を処断する。友好・威信・家臣の忠誠が低下する。' }
  };
  const ADMINISTRATION_ID = 'local-administration';
  const ADMINISTRATION_ACTIONS = ['reclaim', 'commercial', 'levy', 'reward', 'release'];

  function mobilizationLimit(c) {
    const terrain = { mountain: 0.82, hill: 0.94, plain: 1, coast: 1 }[c.terrain] || 1;
    return Math.max(0, Math.floor(Math.min(c.population * 0.12, c.kokudaka * 0.085 * terrain)));
  }
  function initialize(input) {
    const s = clone(input), prior = s.tenka && typeof s.tenka === 'object' && !Array.isArray(s.tenka) ? s.tenka : {};
    s.tenka = {
      schema: 1, loyalty: {}, assignments: {}, estates: {}, chronicle: [], events: [], processedBattles: [],
      casualties: [], turnReports: [], marketReform: false, firearmDoctrine: 0,
      ...prior
    };
    const t = s.tenka;
    for (const key of ['loyalty', 'assignments', 'estates']) if (!t[key] || typeof t[key] !== 'object' || Array.isArray(t[key])) t[key] = {};
    for (const key of ['chronicle', 'events', 'processedBattles', 'casualties', 'turnReports', 'pendingCaptures']) if (!Array.isArray(t[key])) t[key] = [];
    // A seasonal task expires with its turn. Invalid/future save entries must
    // never lock an officer later or create a task that cannot be completed.
    for (const [id, task] of Object.entries(t.assignments)) {
      if (!task || !Number.isSafeInteger(task.turn) || task.turn < 1 || task.turn > s.turn || id === ADMINISTRATION_ID) delete t.assignments[id];
    }
    for (const o of s.officers || []) t.loyalty[o.id] = clamp(number(t.loyalty[o.id], 72 + hash(o.id) % 24), 0, 100);
    for (const c of s.castles || []) {
      const estate = t.estates[c.id] || {};
      t.estates[c.id] = { ...estate, commerce: clamp(Math.floor(number(estate.commerce, 0)), 0, 10), reclaimed: Math.max(0, number(estate.reclaimed, 0)), devastation: clamp(number(estate.devastation, 0), 0, 100) };
    }
    for (const event of EVENTS) {
      if (event.year * 4 + event.season < 1560 * 4 && !t.events.includes(event.id)) {
        t.events.push(event.id);
        t.chronicle.push({ ...event, status: 'past', date: `${event.year}年 ${SEASONS[event.season]}`, result: '開始前の史実。既に伝来・発生済みとして扱う。' });
      }
    }
    return s;
  }
  function isOfficerAvailable(s, o) {
    return active(s, o) && s.tenka?.assignments?.[o.id]?.turn !== s.turn;
  }
  function officerAvailability(s) {
    const roster = s.officers.filter(o => o.clan === s.playerClan && o.status === 'active');
    const adults = roster.filter(o => adult(s, o)), available = adults.filter(o => isOfficerAvailable(s, o));
    const reason = available.length ? null : adults.length ? 'all-busy' : roster.length ? 'underage' : 'no-officers';
    const message = reason === 'all-busy' ? '成人武将は全員今季の任務中です。奉行衆に政務を任せるか、登用・次の季節で家臣の手を空けられます。'
      : reason === 'underage' ? '出仕できる成人武将がいません。十五歳未満の一門は元服を待ち、奉行衆の政務と武将の登用で領国を支えられます。'
        : reason === 'no-officers' ? '出仕中の自家武将がいません。奉行衆の政務と武将の登用で家臣団を立て直せます。' : '';
    return { available: available.length, totalAdults: adults.length, minors: roster.length - adults.length, reason, message };
  }
  function administrationFallback(s, availability = officerAvailability(s)) {
    if (!availability.reason || s.gameOver&&s.winner!==s.playerClan || !owned(s).length) return null;
    return { id: ADMINISTRATION_ID, name: '奉行衆', clan: s.playerClan, status: 'active',
      politics: 35, intelligence: 30, leadership: 30, available: true, administrative: true,
      allowedActions: [...ADMINISTRATION_ACTIONS], reason: availability.reason };
  }
  function clearCommand(s, id) {
    for (const army of Object.values(s.armies || {})) if (army.commanderId === id) army.commanderId = null;
  }
  // Core captures run before the whole AI round is settled. Preserve each
  // garrison's transition now, so a later fall of its retreat destination does
  // not turn the earlier retreat into a capture in the wrong battle report.
  function recordCapture(s, { targetId, defenderClan, winnerClan, before }) {
    s.tenka ||= {};
    const snapshot = o => ({ id:o.id, name:o.name, clan:o.clan, castleId:o.castleId,
      status:o.status, capturedBy:o.capturedBy ?? null });
    const officers = (before || []).filter(o => o.status === 'active' && o.clan === defenderClan && o.castleId === targetId);
    const event = { targetId, defenderClan, winnerClan, turn:s.turn, round:s.aiRound || 0,
      before:officers.map(snapshot), after:officers.map(o => snapshot(getOfficer(s,o.id) || o)) };
    const pending = Array.isArray(s.tenka.pendingCaptures) ? s.tenka.pendingCaptures : [];
    s.tenka.pendingCaptures = [...pending, event].slice(-20);
  }
  function recordDeath(s, officer, cause) {
    if (globalThis.TenkaDynasty?.recordDeath) return globalThis.TenkaDynasty.recordDeath(s, officer, { cause });
    officer.historicalDeath ??= officer.death;
    Object.assign(officer, { status:'dead', castleId:null, capturedBy:null, deathYear:s.year,
      deathSeason:s.season, death:s.year, diedAtAge:officer.birth==null?null:Math.max(0,s.year-officer.birth), deathCause:cause });
    clearCommand(s, officer.id); delete s.tenka.assignments[officer.id];
    return officer;
  }
  function changeEmployer(s, o, clan, castleId) {
    clearCommand(s, o.id);
    o.clan = clan; o.castleId = castleId; o.status = 'active'; o.capturedBy = null;
    s.tenka.loyalty[o.id] = 58;
  }
  function levy(s, c, troops) {
    s.armies[c.id] ||= { commanderId: null, units: Object.fromEntries(UNITS.map(k => [k, 0])) };
    s.armies[c.id].units.ashigaru += troops; c.troops += troops;
  }
  function loseTroops(s, c, count) {
    const remove = Math.min(c.troops, Math.max(0, Math.round(count))), a = s.armies[c.id];
    c.troops -= remove;
    if (a && sum(a.units) > c.troops) {
      const total = sum(a.units), next = {};
      for (const k of UNITS) next[k] = Math.floor(a.units[k] * c.troops / total);
      let remaining = c.troops - sum(next);
      for (const k of UNITS) if (remaining > 0 && a.units[k] > next[k]) { next[k]++; remaining--; }
      a.units = next;
    }
  }
  function act(input, action) {
    if (!action || !ACTIONS[action.type]) return { ok: false, state: input, message: 'この命令は存在しません。' };
    if (input.gameOver && !(input.winner===input.playerClan&&['enlist','release','execute'].includes(action.type))) return { ok: false, state: input, message: 'この年代記は決着しました。' };
    const s = initialize(input), t = s.tenka, rule = ACTIONS[action.type];
    const postVictory = s.gameOver && s.winner===s.playerClan && ['enlist','release','execute'].includes(action.type);
    const fail = message => ({ ok: false, state: input, message });
    if (s.actionPoints < 1 && !postVictory) return fail('今季の命令を使い切りました。次の季節へ進めてください。');
    const c = getCastle(s, action.castleId || s.selectedCastleId);
    const availability = officerAvailability(s), fallback = administrationFallback(s, availability);
    const administrative = action.officerId === ADMINISTRATION_ID;
    const delegate = administrative ? fallback : getOfficer(s, action.officerId);
    if (administrative && !ADMINISTRATION_ACTIONS.includes(action.type)) return fail('奉行衆は開墾・商業・徴兵・恩賞・捕虜解放を担います。外交・調略・捕虜説得・処断には成人武将が必要です。');
    if (administrative && !delegate) return fail('未任務の成人武将がいるため、その武将を担当に選んでください。');
    if (!delegate || delegate.clan !== s.playerClan || delegate.status !== 'active') return fail(availability.message || '活動中の自家武将を担当に選んでください。');
    if (!administrative && !adult(s, delegate)) return fail(`${delegate.name}は十五歳未満で、まだ任務に出仕できません。成人武将を選ぶか、奉行衆に政務を任せてください。`);
    if (!administrative && !postVictory && !isOfficerAvailable(s, delegate)) return fail(`${delegate.name}は今季の任務中です。未任務の武将を選ぶか、全員任務中なら奉行衆に政務を任せてください。次の季節には任務が解除されます。`);
    const target = getOfficer(s, action.targetOfficerId);
    const domestic = ['reclaim', 'commercial', 'levy'].includes(action.type);
    if (domestic && (!c || c.clan !== s.playerClan)) return fail('自領の城を指定してください。');
    if (s.gold < rule.gold || s.food < rule.food) return fail(`金${rule.gold}貫・兵糧${rule.food}石が必要です。`);
    const power = Math.round((delegate[rule.stat] || 40) * 0.72 + (delegate.intelligence || 40) * 0.28);
    let message = '', outcome = 'success';
    let targetClan = action.targetClan || (c && c.clan);
    if (action.type === 'commercial' && t.estates[c.id].commerce >= 10) return fail('この城の商業は最大の十段階です。');
    if (action.type === 'levy' && c.troops >= mobilizationLimit(c)) return fail(`石高による動員上限 ${mobilizationLimit(c).toLocaleString('ja-JP')} 人に達しています。開墾が必要です。`);
    if (action.type === 'reward' && (!target || !active(s, target) || target.clan !== s.playerClan)) return fail('恩賞を与える自家の活動中の武将を選んでください。');
    if (action.type === 'reward' && t.loyalty[target.id] >= 100) return fail('その武将の忠誠は既に最大です。');
    if (action.type === 'negotiation' && (!targetClan || targetClan === s.playerClan || !owned(s, targetClan).length)) return fail('健在な他家の城を指定してください。');
    if (action.type === 'negotiation' && s.alliances.includes(targetClan)) return fail('その家とは既に同盟を結んでいます。');
    if (action.type === 'infiltrate' && (!target || !active(s, target) || target.clan === s.playerClan || s.alliances.includes(target.clan))) return fail('同盟中ではない敵家の活動中の武将を選んでください。');
    if (['enlist', 'release', 'execute'].includes(action.type) && (!target || target.status !== 'captive' || target.capturedBy !== s.playerClan)) return fail('自家が捕らえている武将を選んでください。');
    const roll = hash(`${s.turn}:${s.actionPoints}:${action.type}:${delegate.id}:${target?.id || c?.id || targetClan}`) % 100;
    if (action.type === 'reclaim') {
      const increase = 1000 + power * 25;
      c.kokudaka += increase; c.population += Math.round(increase * 0.3); c.morale = clamp(c.morale + 4, 10, 100);
      t.estates[c.id].reclaimed += increase; t.estates[c.id].devastation = Math.max(0, t.estates[c.id].devastation - 15);
      message = `${delegate.name}が${c.name}の開墾と治水を指揮。石高 +${increase.toLocaleString('ja-JP')} 石。秋の収穫と動員上限が増えました。`;
    } else if (action.type === 'commercial') {
      const estate = t.estates[c.id]; estate.commerce++;
      const income = commerceIncome(c, estate, t);
      message = `${delegate.name}が${c.name}の${c.coastal ? '港と市' : '街道と市'}を整備。商業 ${estate.commerce}/10。季節の追加収入は金 ${income} 貫です。`;
    } else if (action.type === 'levy') {
      const count = Math.min(350 + power * 5, mobilizationLimit(c) - c.troops);
      levy(s, c, count); c.morale = clamp(c.morale + 3, 10, 100);
      message = `${delegate.name}が${c.name}で足軽 ${count} 人を募りました。石高動員上限 ${mobilizationLimit(c)} 人。維持兵糧は兵数に比例します。`;
    } else if (action.type === 'reward') {
      const gain = 15 + Math.floor(power / 7);
      t.loyalty[target.id] = clamp(t.loyalty[target.id] + gain, 0, 100);
      message = `${delegate.name}が${target.name}に恩賞を伝達。忠誠は ${t.loyalty[target.id]} です。`;
    } else if (action.type === 'negotiation') {
      const gain = 14 + Math.floor(power / 5);
      s.relations[targetClan] = clamp((s.relations[targetClan] || 0) + gain, -100, 100);
      const clanName = owned(s, targetClan)[0].clanName;
      if (s.relations[targetClan] >= 75) { s.alliances.push(targetClan); s.allianceExpires[targetClan] = s.turn + 4; s.prestige = clamp(s.prestige + 5, 0, 100); }
      message = `${delegate.name}が${clanName}と交渉。友好 ${s.relations[targetClan]}。${s.alliances.includes(targetClan) ? '四季の同盟が成立しました。' : '友好75以上で同盟が成立します。'}`;
    } else if (action.type === 'infiltrate') {
      const tc = getCastle(s, target.castleId), loyal = t.loyalty[target.id], exhausted = tc && (tc.morale < 50 || tc.troops < mobilizationLimit(tc) * 0.4);
      const chance = clamp(20 + power * 0.48 - target.intelligence * 0.23 + (100 - loyal) * 0.4 + (exhausted ? 17 : 0), 8, 88);
      if (roll < chance) {
        const reduction = 15 + Math.floor(power / 7); t.loyalty[target.id] = Math.max(0, loyal - reduction);
        if (t.loyalty[target.id] <= 35 && (tc?.morale < 65 || !tc)) {
          const home = owned(s)[0]; changeEmployer(s, target, s.playerClan, home.id);
          message = `${delegate.name}の内応工作が成功。${target.name}が自家に寝返り、${home.name}に出仕しました。`;
        } else {
          if (tc) { tc.morale = clamp(tc.morale - 7, 10, 100); tc.defense = clamp(tc.defense - 3, 0, 100); }
          message = `${delegate.name}の工作が浸透。${target.name}の忠誠 ${t.loyalty[target.id]}。守備側の士気と防備も低下しました。`;
        }
      } else { outcome = 'failure'; s.relations[target.clan] = clamp((s.relations[target.clan] || 0) - 12, -100, 100); message = `${delegate.name}の工作が${target.name}に見破られました。費用と命令を消費し、相手との友好が低下しました。`; }
    } else if (action.type === 'enlist') {
      const chance = clamp(25 + power * 0.55 - t.loyalty[target.id] * 0.4 + s.prestige * 0.18 + (!owned(s, target.clan).length ? 18 : 0), 12, 90);
      if (roll < chance) {
        const home = owned(s)[0]; changeEmployer(s, target, s.playerClan, home.id);
        message = `${delegate.name}が捕虜を説得。${target.name}を召し抱え、${home.name}に配属しました。`;
      } else { outcome = 'failure'; t.loyalty[target.id] = Math.max(0, t.loyalty[target.id] - 12); message = `${target.name}は旧主への忠義を守り、仕官を断りました。説得を続ければ心が揺らぐことがあります。`; }
    } else if (action.type === 'release') {
      const home = owned(s, target.clan)[0];
      target.status = home ? 'active' : 'ronin'; target.capturedBy = null; target.castleId = home?.id || null;
      s.relations[target.clan] = clamp((s.relations[target.clan] || 0) + 20, -100, 100); s.prestige = clamp(s.prestige + 2, 0, 100);
      message = `${delegate.name}が${target.name}を解放。${home ? `${home.name}へ帰還しました。旧主との友好 +20。` : '旧主が領地を失っているため浪人となりました。'}`;
    } else if (action.type === 'execute') {
      recordDeath(s, target, 'execution');
      t.casualties.unshift({ officerId: target.id, name: target.name, cause: 'execution', date: date(s), turn: s.turn });
      s.relations[target.clan] = -100; s.prestige = Math.max(0, s.prestige - 5);
      for (const o of s.officers.filter(o => o.clan === s.playerClan && o.status === 'active')) t.loyalty[o.id] = Math.max(0, t.loyalty[o.id] - 3);
      message = `${target.name}を処断しました。相手の家との友好は -100、威信 -5。家臣の忠誠も低下しました。`;
    }
    s.gold -= rule.gold; s.food -= rule.food; if(!postVictory)s.actionPoints--;
    // The magistrates are an administrative body, not a generated officer or
    // war commander. They can cover remaining orders at their lower abilities.
    if (!administrative) t.assignments[delegate.id] = { turn: s.turn, type: action.type, outcome, target: target?.id || c?.id || targetClan };
    if (['enlist','release','execute'].includes(action.type)) {
      t.prisonerDecisions ||= [];
      const capture = t.casualties.find(entry=>entry.officerId===target.id&&entry.cause==='captured');
      t.prisonerDecisions.unshift({ officerId:target.id, name:target.name,
        battleId:capture?.battleId || s.lastBattle?.officerOutcomes?.find(entry=>entry.officerId===target.id&&entry.outcome==='captured')&&s.lastBattle.id || null,
        type:action.type, outcome, turn:s.turn, year:s.year, season:s.season, message });
      t.prisonerDecisions = t.prisonerDecisions.slice(0, 1000);
    }
    append(s, ['negotiation', 'release'].includes(action.type) ? 'diplomacy' : action.type === 'levy' ? 'military' : 'domestic', rule.label, message);
    return { ok: true, state: s, message };
  }
  function commerceIncome(c, estate, t) {
    return Math.round((estate?.commerce || 0) * (90 + c.kokudaka * 0.0012) * (c.coastal ? 1.25 : 1) * (t.marketReform ? 1.15 : 1) * (1 - (estate?.devastation || 0) / 200));
  }
  function eventConditions(s, e) {
    if (e.clans?.some(clan => !owned(s, clan).length)) return false;
    if (e.officers?.some(id => { const o = getOfficer(s, id); return !alive(o) || !active(s, o) || (e.clans && !e.clans.includes(o.clan)); })) return false;
    if (e.province && !s.castles.some(c => c.province === e.province && c.clan === (e.clans?.[0] || s.playerClan))) return false;
    return true;
  }
  function applyEvent(s, e) {
    const t = s.tenka;
    if (!eventConditions(s, e)) return '史実と異なる生存・所属・領土のため、年代記のみ掲載。人物や支配関係は変更しません。';
    if (e.effect === 'markets') { t.marketReform = true; return '楽市の知見が普及。整備済みの市の追加収入が15%上昇。'; }
    if (e.effect === 'drill') {
      t.firearmDoctrine = Math.max(1, t.firearmDoctrine);
      let count = 0;
      for (const o of s.officers) if (active(s, o) && o.aptitudes?.firearm < 5) { o.aptitudes.firearm++; count++; }
      return `鉄砲運用の知見が広まり、活動中の武将 ${count} 人の鉄砲適性が1上昇。`;
    }
    if (e.effect === 'friendship') {
      const [a, b] = e.clans;
      if (s.playerClan === a || s.playerClan === b) {
        const other = s.playerClan === a ? b : a; s.relations[other] = clamp((s.relations[other] || 0) + 20, -100, 100);
        return '清洲同盟に関わる両家の友好が20上昇。同盟の成立には使者を送ってください。';
      }
    }
    if (e.effect === 'rivalry') {
      if (e.clans.includes(s.playerClan)) {
        const other = e.clans.find(c => c !== s.playerClan); s.relations[other] = clamp((s.relations[other] || 0) - 15, -100, 100);
        return '北信濃を巡る緊張で当事家との友好が15低下。';
      }
    }
    if (e.effect === 'prestige' && s.playerClan === 'oda') { s.prestige = clamp(s.prestige + 10, 0, 100); return '山城の支配を背景に織田家の威信が10上昇。'; }
    if (e.effect === 'fortification') {
      for (const c of s.castles.filter(c => c.province === '近江' && c.clan === 'oda')) c.defense = clamp(c.defense + 6, 0, 100);
      return '近江の織田領で築城技術が向上。該当城の防御 +6。後世の天守を全城へ自動建設することはありません。';
    }
    if (e.effect === 'unrest') {
      const akechi = getOfficer(s, 'akechi_mitsuhide');
      if (active(s, akechi) && akechi.clan === 'oda') {
        t.loyalty[akechi.id] = Math.max(0, t.loyalty[akechi.id] - 18);
        return '明智光秀の忠誠が18低下。恩賞や配置で不満に対処できます。信長の死は強制しません。';
      }
    }
    return '史実の出来事を年代記へ追加。現在の人物と領地の行方はプレイヤーの采配と合戦に従います。';
  }
  function advance(input, previousState) {
    const s = initialize(input), t = s.tenka;
    if (s.gameOver || t.lastAdvancedTurn === s.turn) return s;
    t.lastAdvancedTurn = s.turn; t.turnReports = [];
    let commerce = 0;
    for (const c of s.castles) {
      const estate = t.estates[c.id], income = commerceIncome(c, estate, t);
      if (c.clan === s.playerClan) commerce += income; else c.gold += income;
      estate.devastation = Math.max(0, estate.devastation - 6);
    }
    s.gold += commerce;
    if (commerce) t.turnReports.push(`商業・港の追加収入 金 ${commerce} 貫。基本の年貢・秋の収穫・軍維持費は領国収支に計上済みです。`);
    for (const o of s.officers) {
      if (!active(s, o)) continue;
      const c = getCastle(s, o.castleId), shortage = o.clan === s.playerClan ? s.food < 1000 : c?.food < 500;
      const change = shortage ? -7 : c?.morale < 45 ? -4 : 1;
      t.loyalty[o.id] = clamp(t.loyalty[o.id] + change, 0, 100);
    }
    for (const c of owned(s)) {
      const weak = c.troops < mobilizationLimit(c) * 0.45 || c.morale < 50 || s.food < 1000;
      if (!weak) continue;
      const enemy = (c.neighbors || []).map(id => getCastle(s, id)).filter(n => n && n.clan !== s.playerClan && !s.alliances.includes(n.clan)).sort((a, b) => b.troops - a.troops)[0];
      if (!enemy) continue;
      const mark = hash(`infiltration:${s.turn}:${c.id}`) % 100;
      if (mark >= 44) continue;
      const target = s.officers.filter(o => o.clan === s.playerClan && active(s, o) && o.castleId === c.id).sort((a, b) => t.loyalty[a.id] - t.loyalty[b.id])[0];
      if (!target) continue;
      const enemyAgent = s.officers.filter(o => o.clan === enemy.clan && active(s, o)).sort((a, b) => b.intelligence - a.intelligence)[0];
      const loss = 7 + Math.floor((enemyAgent?.intelligence || 45) / 12);
      t.loyalty[target.id] = Math.max(0, t.loyalty[target.id] - loss); c.morale = clamp(c.morale - 5, 10, 100);
      if (t.loyalty[target.id] <= 25 && mark < 22) {
        changeEmployer(s, target, enemy.clan, enemy.id);
        t.turnReports.push(`${enemy.clanName}の調略で${target.name}が離反。${enemy.name}へ出奔しました。疲弊と忠誠低下が原因です。`);
      } else t.turnReports.push(`${enemy.clanName}が疲弊した${c.name}へ調略。${target.name}の忠誠 -${loss}、城の士気 -5。`);
    }
    for (const e of EVENTS) {
      if (t.events.includes(e.id) || e.year * 4 + e.season > point(s)) continue;
      const isCurrent = e.year * 4 + e.season === point(s);
      const result = isCurrent ? applyEvent(s, e) : '過去の出来事を年表に補完。過去の効果を遡って適用しません。';
      t.events.push(e.id);
      t.chronicle.push({ ...e, status: isCurrent ? 'occurred' : 'past', date: `${e.year}年 ${SEASONS[e.season]}`, result });
      if (isCurrent) append(s, 'history', e.title, `${e.text} ${result}`);
    }
    if (t.turnReports.length) append(s, 'domestic', '領国・家臣団からの報告', t.turnReports.join(' '));
    return s;
  }
  function campaignFood(troops, mode = 'field') {
    return 600 + Math.round(Math.max(0, troops) * 0.12 * (mode === 'siege' ? 2 : 1));
  }
  function consume(s, clan, castle, amount, label) {
    const holder = clan === s.playerClan ? s : castle;
    if (!holder) return;
    const deficit = Math.max(0, amount - holder.food);
    holder.food = Math.max(0, holder.food - amount);
    if (deficit && castle) { castle.morale = Math.max(10, castle.morale - 8); loseTroops(s, castle, Math.round(castle.troops * 0.015)); }
    if (clan === s.playerClan) append(s, 'military', '合戦の兵站', `${label}の追加兵糧 ${amount} 石を消費。${deficit ? `不足 ${deficit} 石により士気と兵数が低下しました。` : '出陣の基本兵糧600石は合戦処理時に計上済みです。'}`);
  }
  function afterBattle(input, previousState) {
    const s = initialize(input), t = s.tenka;
    const captures = t.pendingCaptures, usedCaptures = new Set();
    const previousIds = new Set([previousState?.lastBattle, ...(previousState?.aiBattles || [])].filter(Boolean).map(b => b.id));
    const battles = [...(s.aiBattles || []), s.lastBattle].filter(Boolean);
    const unique = new Map(battles.map(b => [b.id, b]));
    for (const b of unique.values()) {
      if (!b.id || t.processedBattles.includes(b.id) || previousIds.has(b.id)) continue;
      t.processedBattles.push(b.id);
      const captureIndex = b.won && b.mode === 'siege' ? captures.findIndex((event,index) =>
        !usedCaptures.has(index) && event.turn === s.turn && event.targetId === b.targetId
          && event.defenderClan === b.defenderClan && event.winnerClan === b.attackerClan) : -1;
      const capture = captureIndex < 0 ? null : captures[captureIndex];
      if (capture) usedCaptures.add(captureIndex);
      const captureBefore = new Map((capture?.before || []).map(o => [o.id,o]));
      const captureAfter = new Map((capture?.after || []).map(o => [o.id,o]));
      const source = getCastle(s, b.sourceId), target = getCastle(s, b.targetId);
      const attackerTroops = b.attackerArmy?.troops || 0, defenderTroops = b.defenderArmy?.troops || 0;
      if (b.tacticsVersion === 1) {
        // Tactical settlement already debits both sides' elapsed, soldier-scaled use.
        // Its supplyConsumed describes the player's side, including during defense.
        if (b.attackerClan === s.playerClan || b.defenderClan === s.playerClan) {
          append(s, 'military', '合戦の兵站', `${b.defending ? '籠城軍' : '出陣軍'}の実戦兵糧 ${Math.max(0, Math.round(b.supplyConsumed || 0))} 石を合戦精算で消費。${b.defending ? '守備側のため出陣の基本兵糧は不要です。' : '出陣の基本兵糧600石は別途計上済みです。'}`);
        }
      } else {
        consume(s, b.attackerClan, source, campaignFood(attackerTroops, b.mode) - 600, `${b.attacker || source?.name || '出陣軍'}・${attackerTroops}人の${b.mode === 'siege' ? '攻城' : '野戦'}`);
        consume(s, b.defenderClan, target?.clan === b.defenderClan ? target : owned(s, b.defenderClan)[0], Math.round(defenderTroops * 0.08 * (b.mode === 'siege' ? 2 : 1)), `${b.defender || '守備軍'}・${defenderTroops}人の防衛`);
      }
      if (target) t.estates[target.id].devastation = clamp(t.estates[target.id].devastation + (b.mode === 'siege' ? 18 : 9), 0, 100);
      if (source) t.estates[source.id].devastation = clamp(t.estates[source.id].devastation + 4, 0, 100);
      const winner = b.won ? b.attackerClan : b.defenderClan;
      const loser = b.won ? b.defenderClan : b.attackerClan;
      const commander = b.won ? b.defenderArmy?.commanderId : b.attackerArmy?.commanderId;
      const defeated = getOfficer(s, commander), oldOfficer = previousState && getOfficer(previousState, commander);
      const killedHere = new Set(), capturedHere = new Set();
      const foughtLater = capture && captures.some((event,index) => index > captureIndex
        && event.turn === s.turn && event.before?.some(o => o.id === commander));
      if (defeated && !['dead','captive'].includes(defeated.status) && defeated.clan === loser
          && !foughtLater && (!oldOfficer || oldOfficer.status === 'active') && (b.won ? defenderTroops : attackerTroops) > 0) {
        const ratio = b.won ? b.enemyCasualties / Math.max(1, defenderTroops) : b.casualties / Math.max(1, attackerTroops);
        const roll = hash(`fate:${b.id}:${defeated.id}`) % 10000;
        const fatalRisk = ratio >= 0.75 ? 100 : ratio >= 0.5 ? 50 : 0;
        const captureRisk = ratio >= 0.3 ? (b.mode === 'siege' ? 800 : 500) : 0;
        if (roll < fatalRisk) { recordDeath(s, defeated, 'battle'); killedHere.add(defeated.id); }
        else if (roll < fatalRisk + captureRisk) {
          Object.assign(defeated, {status:'captive',castleId:null,capturedBy:winner});
          capturedHere.add(defeated.id);
          clearCommand(s, defeated.id); delete t.assignments[defeated.id];
        }
      }
      const participants = new Map();
      const before = previousState || s;
      const addParticipant = (id, side) => {
        const person = side === 'defender' && captureBefore.has(id) ? captureBefore.get(id) : getOfficer(before, id) || getOfficer(s, id);
        if (!person || ['dead','unborn','captive','ronin'].includes(person.status)) return;
        if (person.status!=='active' && getOfficer(s,id)?.status!=='captive') return;
        participants.set(person.id, {person,side});
      };
      addParticipant(b.attackerArmy?.commanderId, 'attacker');
      addParticipant(b.defenderArmy?.commanderId, 'defender');
      for (const person of before.officers || []) {
        if (person.castleId===b.sourceId && person.clan===b.attackerClan) addParticipant(person.id,'attacker');
        if (!capture && person.castleId===b.targetId && person.clan===b.defenderClan) addParticipant(person.id,'defender');
      }
      for (const person of captureBefore.values()) addParticipant(person.id,'defender');
      for (const entry of b.deployedCommanders || []) {
        const id = typeof entry==='string' ? entry : entry.officerId || entry.commanderId || entry.id;
        const person = getOfficer(before,id);
        if (person) addParticipant(id, entry.side || (person.clan===b.attackerClan?'attacker':'defender'));
      }
      b.year=s.year; b.season=s.season; b.turn=s.turn;
      b.officerOutcomes = [...participants.values()].map(({person,side})=>{
        const current = getOfficer(s,person.id), clan = side==='attacker'?b.attackerClan:b.defenderClan;
        const otherCapture = capture ? null : captures.find(event => event.after?.some(o => o.id===person.id && o.status==='captive'));
        const atBattle = capturedHere.has(person.id) ? current : side==='defender' && captureAfter.get(person.id)
          || otherCapture?.before.find(o => o.id===person.id) || current;
        let outcome = clan===loser?'retreated':'survived';
        if (killedHere.has(person.id)) outcome='killed';
        else if (atBattle?.status==='dead') outcome='unrecorded';
        else if (atBattle?.status==='captive' && atBattle.capturedBy!==person.capturedBy) outcome='captured';
        const entry={officerId:person.id,name:person.name,clan,side,outcome,capturedBy:outcome==='captured'?atBattle.capturedBy:null};
        if (outcome==='killed'||outcome==='captured') {
          const cause=outcome==='killed'?'killed':'captured';
          if (!t.casualties.some(c=>c.officerId===person.id&&c.battleId===b.id&&c.cause===cause)) {
            t.casualties.unshift({officerId:person.id,name:person.name,cause,turn:s.turn,date:date(s),battleId:b.id,capturedBy:entry.capturedBy});
            append(s,'battle',cause==='killed'?'武将、討死':'武将を捕縛',`${person.name}が${b.defender || target?.name || '戦場'}で${cause==='killed'?'討死しました。':'捕らえられました。戦後の処遇から召し抱え・解放・処断を選べます。'}`);
          }
        }
        return entry;
      });
      for (const duplicate of battles) if(duplicate!==b&&duplicate.id===b.id) {
        duplicate.officerOutcomes=clone(b.officerOutcomes);
        duplicate.year=b.year; duplicate.season=b.season; duplicate.turn=b.turn;
      }

    }
    t.pendingCaptures = captures.filter((event,index) => !usedCaptures.has(index) && event.turn === s.turn);
    t.processedBattles = t.processedBattles.slice(-2000); t.casualties = t.casualties.slice(0, 500);
    return s;
  }
  function getView(input) {
    const s = initialize(input), t = s.tenka;
    const availability = officerAvailability(s);
    return {
      availability, administrationFallback: administrationFallback(s, availability),
      officers: s.officers.filter(o => o.clan === s.playerClan && o.status === 'active' && adult(s, o)).map(o => ({ ...o, loyalty: t.loyalty[o.id], busy: t.assignments[o.id]?.turn === s.turn, available: isOfficerAvailable(s, o), assignment: t.assignments[o.id] || null })),
      enemies: s.officers.filter(o => o.clan !== s.playerClan && active(s, o)).map(o => ({ ...o, loyalty: t.loyalty[o.id] })),
      castles: s.castles.map(c => ({ ...c, capacity: mobilizationLimit(c), agriculture: t.estates[c.id].reclaimed, commerce: t.estates[c.id].commerce, order: 100 - t.estates[c.id].devastation, income: commerceIncome(c, t.estates[c.id], t) })),
      prisoners: s.officers.filter(o => o.status === 'captive' && o.capturedBy === s.playerClan).map(o => ({ ...o, loyalty: t.loyalty[o.id] })),
      casualties: t.casualties,
      chronicle: t.chronicle.map(e => ({ ...e, kind: e.status === 'past' ? 'past' : 'history', source: SOURCES.find(source => source.id === e.source) })).sort((a, b) => b.year - a.year || b.season - a.season),
      upcomingEvents: EVENTS.filter(e => !t.events.includes(e.id)).slice(0, 3),
      relations: Object.entries(s.relations || {}).map(([clan, value]) => ({ clan, clanName: owned(s, clan)[0]?.clanName || clan, value, allied: s.alliances.includes(clan), expires: s.allianceExpires[clan] || null, castles: owned(s, clan).length })),
      reports: t.turnReports, actions: ACTIONS,
      totals: { commerce: owned(s).reduce((n, c) => n + commerceIncome(c, t.estates[c.id], t), 0), capacity: owned(s).reduce((n, c) => n + mobilizationLimit(c), 0) }
    };
  }
  function chooseClan(input, clanId) {
    if (input.turn !== 1 || input.actionPoints !== 3 || (input.aiRound || 0) > 0 || Object.values(input.tenka?.assignments || {}).length) return { ok: false, state: input, message: '勢力の選択は開始直後のみ行えます。' };
    const s = initialize(input), castles = owned(s, clanId);
    if (!castles.length || !s.officers.some(o => o.clan === clanId && active(s, o))) return { ok: false, state: input, message: '活動中の武将と領地がある勢力を選んでください。' };
    s.playerClan = clanId; s.selectedCastleId = [...castles].sort((a, b) => b.kokudaka - a.kokudaka)[0].id;
    s.gold = Math.max(1800, Math.min(10000, Math.round(castles.reduce((n, c) => n + c.kokudaka, 0) * 0.035)));
    s.food = Math.max(12000, Math.round(castles.reduce((n, c) => n + c.kokudaka, 0) * 0.24));
    s.alliances = []; s.allianceExpires = {}; s.relations = {};
    for (const other of new Set(s.castles.map(c => c.clan))) if (other !== clanId) s.relations[other] = 0;
    for (const pair of s.npcPacts || []) if (pair.includes(clanId)) {
      const other = pair.find(c => c !== clanId);
      if (other) { s.alliances.push(other); s.allianceExpires[other] = s.turn + 4; s.relations[other] = 75; }
    }
    append(s, 'scenario', '天下への旗を掲げる', `${castles[0].clanName}の領国経営を開始。家臣に命令を託し、内政・外交・合戦で天下統一を目指します。`);
    return { ok: true, state: s, message: `${castles[0].clanName}で開始しました。` };
  }
  return { version: '1.0.0', initialize, act, advance, afterBattle, recordCapture, getView, chooseClan, mobilizationLimit, campaignFood, isOfficerAvailable, ACTIONS, EVENTS, SOURCES };
});
