/* 天下布武: explicit marriage, submission and alliance withdrawal. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaDiplomacy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const date = state => root.TenkaCalendar?.date?.(state) || (Number.isInteger(state.month) ? `${state.year}年 ${state.month}月` : `${state.year}年 ${['春', '夏', '秋', '冬'][state.season || 0]}`);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const owned = (state, clan = state.playerClan) => (state.castles || []).filter(item => item.clan === clan);
  const person = (state, id) => state.officers?.find(item => item.id === id);
  const castle = (state, id) => state.castles?.find(item => item.id === id);
  const knownClan = (state, clan) => typeof clan === 'string' && (!!root.TenkaGame?.clans?.[clan]
    || (state.castles || []).some(item => item.clan === clan) || (state.officers || []).some(item => item.clan === clan));
  const clanName = (state, clan) => owned(state, clan)[0]?.clanName || root.TenkaGame?.clans?.[clan]?.name || clan;
  const hash = value => { let n = 2166136261; for (const c of String(value)) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0; return n; };
  const failure = (state, message) => ({ ok: false, state, message });
  const age = (state, item) => Number.isInteger(item?.birth) ? state.year - item.birth : null;
  const female = item => (item?.gender || item?.sex) === 'female';
  let marriageEngine;
  function liveAlliance(state, clan) {
    return clan !== state.playerClan && state.alliances?.includes(clan)
      && Number.isInteger(state.allianceExpires?.[clan]) && state.allianceExpires[clan] > state.turn;
  }
  function overlord(state, clan) {
    const item = state.tenka?.diplomacy?.vassals?.[clan];
    return item?.active && owned(state, clan).length && owned(state, item.overlord).length ? item.overlord : null;
  }
  function sovereign(state, clan) {
    const seen = new Set(); let current = clan;
    while (overlord(state, current) && !seen.has(current)) { seen.add(current); current = overlord(state, current); }
    return current;
  }
  function isProtectedPair(state, first, second) {
    if (first === second) return true;
    if (sovereign(state, first) === sovereign(state, second)) return true;
    if (first === state.playerClan) return liveAlliance(state, second);
    if (second === state.playerClan) return liveAlliance(state, first);
    return (state.npcPacts || []).some(pair => pair.includes(first) && pair.includes(second));
  }
  function append(state, title, text, details = {}) {
    state.nextLogId = Math.max(1, state.nextLogId || 1);
    state.logs = [{ id: `diplomacy-${state.nextLogId++}`, type: 'diplomacy', title, text,
      date: date(state) }, ...(state.logs || [])].slice(0, 80);
    const ledger = state.tenka.diplomacy;
    ledger.history.unshift({ turn: state.turn, year: state.year, title, message: text, ...details });
    ledger.history = ledger.history.slice(0, 80);
  }
  function initialize(input) {
    const state = clone(input); state.tenka ||= {};
    state.tenka.diplomacy ||= { version: 1, vassals: {}, attempts: [], history: [] };
    const ledger = state.tenka.diplomacy;
    state.alliances ||= []; state.allianceExpires ||= {}; state.relations ||= {};
    // Expired flags must not protect a castle merely because a stale UI still
    // contains the clan ID. Valid old saves remain readable and are migrated.
    state.alliances = [...new Set(state.alliances)].filter(id => knownClan(state, id) && owned(state, id).length
      && Number.isInteger(state.allianceExpires[id]) && state.allianceExpires[id] > state.turn);
    for (const id of Object.keys(state.allianceExpires)) if (!state.alliances.includes(id)) delete state.allianceExpires[id];
    for (const [id, item] of Object.entries(ledger.vassals)) {
      if (!item.active) continue;
      if (!owned(state, id).length || !owned(state, item.overlord).length) { item.active = false; continue; }
      if ([id, item.overlord].includes(state.playerClan)) {
        const other = id === state.playerClan ? item.overlord : id;
        if (!state.alliances.includes(other)) state.alliances.push(other);
        state.allianceExpires[other] = Math.max(state.allianceExpires[other] || 0, state.turn + (Number.isInteger(state.month) ? 12 : 4));
      }
    }
    ledger.attempts = ledger.attempts.filter(item => item.turn === state.turn);
    const threat = state.pendingDefense, source = castle(state, threat?.sourceId), target = castle(state, threat?.targetId);
    if (source && target && target.clan === state.playerClan && isProtectedPair(state, source.clan, target.clan)) {
      // Old campaigns may retain an alert from before a diplomatic change.
      // Cancel it before the ordinary pending-defense command lock is applied;
      // no army has departed and neither side owes a sortie cost or refund.
      state.pendingDefense = null;
      state.threats = (state.threats || []).filter(item => item.sourceId !== source.id || item.targetId !== target.id);
      append(state, '外交で侵攻を解除', `${clanName(state, source.clan)}との同盟・恭順関係を確認し、${target.name}への古い侵攻の急報を解除しました。兵力・兵糧・命令は消費しません。`, { type: 'cancelProtectedDefense', targetClan: source.clan });
    }
    return state;
  }
  function validate(state) {
    const ledger = state?.tenka?.diplomacy;
    if (ledger == null) return true;
    if (!ledger || ledger.version !== 1 || !ledger.vassals || typeof ledger.vassals !== 'object' || Array.isArray(ledger.vassals)
      || !Array.isArray(ledger.attempts) || ledger.attempts.length > 100 || !Array.isArray(ledger.history) || ledger.history.length > 80) return false;
    for (const [id, item] of Object.entries(ledger.vassals)) {
      if (!knownClan(state, id) || !item || !knownClan(state, item.overlord) || item.overlord === id || typeof item.active !== 'boolean'
        || !Number.isSafeInteger(item.turn) || item.turn < 1 || item.turn > state.turn || !Number.isInteger(item.year) || item.year > state.year
        || !Number.isSafeInteger(item.lastTributeTurn) || item.lastTributeTurn < item.turn || item.lastTributeTurn > state.turn
        || !Number.isSafeInteger(item.tributeGold) || item.tributeGold < 0 || !Number.isSafeInteger(item.tributeFood) || item.tributeFood < 0) return false;
      const seen = new Set([id]); let next = item.active ? item.overlord : null;
      while (next) {
        if (seen.has(next)) return false;
        seen.add(next); const parent = ledger.vassals[next]; next = parent?.active ? parent.overlord : null;
      }
    }
    const attempts = new Set();
    for (const item of ledger.attempts) {
      if (!item || !knownClan(state, item.targetClan) || !Number.isSafeInteger(item.turn) || item.turn < 1 || item.turn > state.turn
        || attempts.has(`${item.turn}:${item.targetClan}`)) return false;
      attempts.add(`${item.turn}:${item.targetClan}`);
    }
    return ledger.history.every(item => item && Number.isSafeInteger(item.turn) && item.turn >= 1 && item.turn <= state.turn
      && typeof item.title === 'string' && typeof item.message === 'string');
  }
  function blockedMessage(state) {
    if (state.gameOver) return 'この年代記は決着しています。';
    if (state.pendingDefense) return '敵の侵攻が迫っています。先に籠城戦を指揮してください。';
    if (root.TenkaAllies?.hasPendingEngagement?.(state)) return '援軍の返答、または手配済みの援軍の出陣・取り消しを先に行ってください。';
    if (!owned(state).length) return '領地のある大名家で外交を行ってください。';
    return '';
  }
  function ownPrincesses(state) {
    return (state.officers || []).filter(item => item.clan === state.playerClan && item.isKin && female(item) && item.status !== 'unborn').map(item => {
      const years = age(state, item);
      const reason = ['dead', 'captive', 'ronin'].includes(item.status) ? '健在で自家に在籍する姫を選んでください。'
        : item.marriedTo ? '既に婚姻を結んでいます。' : years == null ? '生年が確認できません。'
        : years < 18 ? `${item.birth + 18}年に十八歳になります（現在${Math.max(0, years)}歳）。` : '';
      return { ...item, age: years, eligible: !reason, reason };
    });
  }
  function sourceCastle(state, requested) {
    return root.TenkaOrders?.defaultCastle?.(state, requested) || (!requested ? owned(state)[0] : owned(state).find(item => item.id === requested));
  }
  function remaining(state, id) { return root.TenkaOrders?.remaining?.(state, id) ?? state.actionPoints ?? 0; }
  function delegateReason(state, item) {
    if (!item || item.clan !== state.playerClan || item.status !== 'active' || female(item) || item.capturedBy || age(state, item) == null || age(state, item) < 15) return '十五歳以上の活動中の自家武将を使者に選んでください。';
    return state.tenka?.assignments?.[item.id]?.turn === state.turn ? `${item.name}は今月の任務中です。` : '';
  }
  function power(state, clan) { return owned(state, clan).reduce((sum, item) => sum + Math.max(0, item.troops || 0), 0); }
  function preview(input, action = {}) {
    const costs = { marry: 300, subjugate: 400, breakAlliance: 0 };
    const cost = { gold: costs[action.type] ?? 0, food: 0, commands: 1 };
    const failed = message => ({ ok: false, message, cost });
    if (!Object.hasOwn(costs, action.type)) return failed('不明な外交命令です。');
    if (!validate(input)) return failed('保存された外交情報を確認してください。');
    const state = initialize(input), blocked = blockedMessage(state); if (blocked) return failed(blocked);
    const source = sourceCastle(state, action.orderCastleId ?? action.sourceId);
    if (!source || source.clan !== state.playerClan) return failed('命令を出す自領の城を選んでください。');
    if (remaining(state, source.id) < 1) return failed(`${source.name}の今月の行動力は残り0／3です。`);
    if (state.gold < cost.gold) return failed(`金${cost.gold}貫が必要です。`);
    const targetClan = action.targetClan;
    if (!targetClan || targetClan === state.playerClan || !owned(state, targetClan).length) return failed('健在な他家を選んでください。');
    const result = { ok: true, message: '', cost, sourceId: source.id, targetClan };
    if (action.type === 'marry') {
      const princess = ownPrincesses(state).find(item => item.id === action.princessId);
      if (!princess?.eligible) return failed(princess?.reason || '十八歳以上で未婚の自家の姫を選んでください。');
      const matches = root.TenkaDynasty?.marriageOptions?.(state, princess.id) || [];
      const target = matches.find(item => item.id === targetClan);
      if (!target) return failed('相手家に十八歳以上で未婚、かつ近親でない一門の男性がいません。');
      if (!action.spouseId || !target.spouses.some(item => item.id === action.spouseId)) return failed('表示されている相手家の婚姻相手を選んでください。');
      return { ...result, message: `${princess.name}と${target.name}の${target.spouses.find(item => item.id === action.spouseId).name}の婚姻を結びます。` };
    }
    if (action.type === 'breakAlliance') {
      if (!liveAlliance(state, targetClan) && sovereign(state, state.playerClan) !== sovereign(state, targetClan)) return failed('現在同盟中または臣従関係にある他家を選んでください。');
      const marriage = state.tenka?.dynasty?.marriages?.some(item => [item.fromClan, item.toClan].includes(state.playerClan) && [item.fromClan, item.toClan].includes(targetClan) && item.active && !item.allianceBroken);
      return { ...result, willEndMarriageAlliance: !!marriage, releasesVassal: !!overlord(state, targetClan) || !!overlord(state, state.playerClan),
        message: `盟約を破棄します。友好−40・威信−10。${marriage ? '婚姻関係は残りますが、婚姻による同盟保護を停止します。' : ''}${overlord(state, targetClan) === state.playerClan ? '恭順関係と貢納も解消します。' : ''}` };
    }
    const reason = delegateReason(state, person(state, action.officerId)); if (reason) return failed(reason);
    if (overlord(state, targetClan)) return failed('この家は既に他家へ恭順しています。');
    if (overlord(state, state.playerClan)) return failed('他家へ恭順中は、さらに他家を従わせられません。');
    if (state.tenka.diplomacy.attempts.some(item => item.targetClan === targetClan && item.turn === state.turn)) return failed('この家への恭順交渉は今月すでに行いました。');
    const contact = liveAlliance(state, targetClan) || owned(state).some(item => item.neighbors?.some(id => castle(state, id)?.clan === targetClan));
    if (!contact) return failed('国境を接する他家、または同盟国へ恭順を求めてください。');
    const ownPower = power(state, state.playerClan), targetPower = power(state, targetClan), ratio = ownPower / Math.max(1, targetPower);
    if ((state.prestige || 0) < 40 || ratio < 1.35) return failed('恭順を求めるには威信40以上・相手の1.35倍以上の兵力が必要です。');
    const delegate = person(state, action.officerId), headId = state.tenka?.dynasty?.families?.[targetClan]?.headId;
    const resolve = person(state, headId)?.leadership || 60, relation = state.relations[targetClan] || 0;
    const chance = clamp(Math.round(15 + delegate.politics * .35 + delegate.intelligence * .15 + state.prestige * .2 + relation * .18 + Math.log2(ratio) * 14 - resolve * .25), 10, 90);
    return { ...result, chance, powerRatio: ratio, message: `成功見込み${chance}%。相手は領地と家臣を保ち、自家への攻撃を停止して毎月貢納します。城の併合にはなりません。` };
  }
  function debit(state, sourceId, cost) {
    state.gold -= cost.gold;
    if (root.TenkaOrders?.sync) {
      state = root.TenkaOrders.sync(state, sourceId);
      state.tenka.castleOrders.castles[sourceId].remaining = remaining(state, sourceId) - cost.commands;
      state.actionPoints = remaining(state, sourceId);
    } else state.actionPoints -= cost.commands;
    return state;
  }
  function act(input, action = {}) {
    const check = preview(input, action); if (!check.ok) return failure(input, check.message);
    if (action.type === 'breakAlliance' && action.confirm !== true) return failure(input, '同盟破棄による友好と威信の低下を確認してください。');
    let state = initialize(input), outcome = 'success', message;
    const target = action.targetClan, ledger = state.tenka.diplomacy;
    if (action.type === 'marry') {
      const marry = marriageEngine || root.TenkaDynasty?.act;
      if (typeof marry !== 'function') return failure(input, '一門の婚姻機関を確認してください。');
      const result = marry(state, action);
      if (!result?.ok) return failure(input, result?.message || '婚姻を結べませんでした。');
      state = result.state; message = `${result.message} 金300貫・${castle(state, check.sourceId).name}の命令1を使いました。`;
    } else if (action.type === 'breakAlliance') {
      state.alliances = state.alliances.filter(id => id !== target); delete state.allianceExpires[target];
      state.npcPacts = (state.npcPacts || []).filter(pair => !(pair.includes(state.playerClan) && pair.includes(target)));
      for (const item of state.tenka?.dynasty?.marriages || []) if ([item.fromClan, item.toClan].includes(state.playerClan) && [item.fromClan, item.toClan].includes(target)) {
        item.allianceBroken = true; item.allianceBrokenTurn = state.turn;
      }
      if (ledger.vassals[target]?.overlord === state.playerClan) ledger.vassals[target].active = false;
      if (ledger.vassals[state.playerClan]?.overlord === target) ledger.vassals[state.playerClan].active = false;
      state.relations[target] = clamp((state.relations[target] || 0) - 40, -100, 100);
      state.prestige = clamp((state.prestige || 0) - 10, 0, 100);
      message = `${clanName(state, target)}との盟約を破棄しました。友好−40・威信−10。${check.willEndMarriageAlliance ? '婚姻は保持し、同盟の自動更新を停止しました。' : ''}`;
    } else {
      const delegate = person(state, action.officerId), roll = hash(`submission:${state.turn}:${state.playerClan}:${target}:${action.officerId}`) % 100;
      ledger.attempts.push({ targetClan: target, turn: state.turn });
      state.tenka.assignments ||= {};
      if (roll < check.chance) {
        ledger.vassals[target] = { overlord: state.playerClan, active: true, turn: state.turn, year: state.year, lastTributeTurn: state.turn, tributeGold: 0, tributeFood: 0 };
        state.relations[target] = Math.max(60, state.relations[target] || 0); state.prestige = clamp(state.prestige + 4, 0, 100);
        message = `${delegate.name}の交渉で${clanName(state, target)}が恭順しました。領地・家臣は同家が保持し、双方の侵攻を禁止します。翌月から余剰金・兵糧の一部を貢納します。`;
      } else {
        outcome = 'refused'; state.relations[target] = clamp((state.relations[target] || 0) - 10, -100, 100);
        message = `${clanName(state, target)}は恭順の求めを拒否しました（成功見込み${check.chance}%）。友好−10。使者の費用と命令は消費しました。`;
      }
      state.tenka.assignments[delegate.id] = { turn: state.turn, type: 'subjugate', outcome, target };
    }
    state = debit(state, check.sourceId, check.cost);
    append(state, { marry: '外交による婚姻', subjugate: '恭順の交渉', breakAlliance: '盟約の破棄' }[action.type], message, { type: action.type, targetClan: target, outcome });
    return { ok: true, state: initialize(state), message, outcome };
  }
  function advance(input) {
    let state = initialize(input), ledger = state.tenka.diplomacy;
    if (state.gameOver) return state;
    for (const [clan, item] of Object.entries(ledger.vassals)) {
      if (!item.active || item.lastTributeTurn >= state.turn) continue;
      item.lastTributeTurn = state.turn;
      if (item.overlord !== state.playerClan) continue;
      let gold = 0, food = 0;
      for (const home of owned(state, clan)) {
        // The old levy was per season. Monthly campaigns collect one third
        // of that rate, from actual surplus stores, once for each month.
        const months = Number.isInteger(state.month) ? 3 : 1;
        const dueGold = Math.floor(Math.max(0, (home.gold || 0) - 200) * .05 / months), dueFood = Math.floor(Math.max(0, (home.food || 0) - 1000) * .02 / months);
        home.gold -= dueGold; home.food -= dueFood; gold += dueGold; food += dueFood;
      }
      state.gold += gold; state.food += food; item.tributeGold += gold; item.tributeFood += food;
      append(state, '恭順国からの貢納', `${clanName(state, clan)}から金${gold}貫・兵糧${food}石を受領。守備の備蓄を残した余剰分から貢納しました。`, { type: 'tribute', targetClan: clan, gold, food });
    }
    return state;
  }
  function getView(input, options = {}) {
    const state = initialize(input), princesses = ownPrincesses(state), chosen = princesses.find(item => item.id === options.princessId && item.eligible);
    const marriageClans = chosen ? root.TenkaDynasty?.marriageOptions?.(state, chosen.id) || [] : [];
    const targets = [...new Set(state.castles.map(item => item.clan))].filter(id => id !== state.playerClan).map(clan => ({ clan, name: clanName(state, clan),
      relation: state.relations[clan] || 0, allied: liveAlliance(state, clan), expires: state.allianceExpires[clan] || null,
      castles: owned(state, clan).length, troops: power(state, clan), subordinate: overlord(state, clan) === state.playerClan, overlord: overlord(state, clan) }));
    const delegates = (state.officers || []).filter(item => item.clan === state.playerClan && item.status === 'active' && !female(item) && age(state, item) >= 15).map(item => ({ ...item, age: age(state, item), busy: state.tenka?.assignments?.[item.id]?.turn === state.turn, available: !delegateReason(state, item) }));
    const message = blockedMessage(state);
    return { targets, princesses, marriageClans, sourceCastles: owned(state).map(item => ({ id: item.id, name: item.name, remaining: remaining(state, item.id) })), delegates,
      blocked: !!message, message, history: state.tenka.diplomacy.history, noMarriageMessage: princesses.some(item => item.eligible) ? '' : princesses.find(item => !item.marriedTo && !['dead', 'captive', 'ronin'].includes(item.status))?.reason || '十八歳以上で未婚の自家の姫がいません。出生・成長を待つか、別の外交を行ってください。' };
  }
  function install(core) {
    const hooks = { ...core };
    for (const key of ['newGame', 'migrate', 'load']) if (core[key]) hooks[key] = (...args) => {
      const state = core[key](...args); return state && validate(state) ? initialize(state) : null;
    };
    if (core.validate) hooks.validate = state => validate(state) && core.validate(state);
    if (core.save) hooks.save = state => validate(state) && core.save(initialize(state));
    if (core.season) hooks.season = state => {
      const result = core.season(initialize(state));
      return result?.state && result.ok !== false && result.state.turn > state.turn ? { ...result, state: advance(result.state) } : result;
    };
    if (core.action) hooks.action = (state, type, targetId, options = {}) => {
      if (type === 'attack') {
        const source = sourceCastle(state, options.sourceId ?? options.orderCastleId), target = castle(state, targetId);
        if (source && target && isProtectedPair(state, source.clan, target.clan)) return failure(state, '同盟・恭順関係にある家には出陣できません。先に外交で盟約を破棄してください。');
      }
      const result = core.action(initialize(state), type, targetId, options);
      return result?.ok ? { ...result, state: initialize(result.state) } : { ...result, state };
    };
    if (core.createBattle) hooks.createBattle = options => {
      const source = castle(options?.state || {}, options?.sourceId), target = castle(options?.state || {}, options?.targetId);
      if (source && target && isProtectedPair(options.state, source.clan, target.clan)) throw Error('同盟・恭順関係にある家とは合戦できません。');
      return core.createBattle(options);
    };
    if (root.TenkaDynasty?.act) {
      marriageEngine = root.TenkaDynasty.act;
      root.TenkaDynasty.act = (state, action = {}) => action.type === 'marry' ? act(state, action) : marriageEngine(state, action);
    }
    if (root.TenkaSystems?.act) {
      const original = root.TenkaSystems.act;
      root.TenkaSystems.act = (state, action = {}) => {
        const target = person(state, action.targetOfficerId), targetClan = action.targetClan || target?.clan;
        if (action.type === 'infiltrate' && targetClan && isProtectedPair(state, state.playerClan, targetClan)) return failure(state, '同盟・恭順関係にある家への内応工作はできません。');
        const result = original(initialize(state), action);
        return result?.ok ? { ...result, state: initialize(result.state) } : { ...result, state };
      };
    }
    return hooks;
  }
  return { version: 1, initialize, validate, liveAlliance, isProtectedPair, sovereign, overlord, preview, act, advance, getView, install };
});
