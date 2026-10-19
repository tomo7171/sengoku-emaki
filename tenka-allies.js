/* 天下布武: allied wars wait for the player's explicit reinforcement decision. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaAllies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const UNITS = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
  const DECLINE_LOSS = 15;
  const clone = value => JSON.parse(JSON.stringify(value));
  const date = state => root.TenkaCalendar?.date?.(state) || (Number.isInteger(state.month) ? `${state.year}年 ${state.month}月` : `${state.year}年 ${['春', '夏', '秋', '冬'][state.season || 0]}`);
  const total = units => UNITS.reduce((sum, key) => sum + (units?.[key] || 0), 0);
  const castle = (state, id) => state.castles?.find(item => item.id === id);
  const clanName = (state, id) => state.castles?.find(item => item.clan === id)?.clanName || id;
  const fail = (state, message) => ({ ok: false, state, message });
  const emptyUnits = () => Object.fromEntries(UNITS.map(key => [key, 0]));
  let adapter = {};

  function configure(value = {}) { adapter = { ...adapter, ...value }; return api; }
  function initialize(input) {
    const state = clone(input);
    state.tenka ||= {};
    state.tenka.allies ||= { version: 1, pending: [], reports: [], processed: [] };
    state.tenka.allies.committed ||= [];
    state.tenka.allies.nextSupportId ||= 1;
    return reconcile(state);
  }
  function ledger(state) {
    state.tenka ||= {};
    return state.tenka.allies ||= { version: 1, pending: [], reports: [], processed: [] };
  }
  function hasPendingRequests(state) { return !!state.tenka?.allies?.pending?.length; }
  function hasPendingEngagement(state) { return hasPendingRequests(state) || !!state.tenka?.allies?.committed?.length; }
  function liveAlliance(state, clan) {
    return clan !== state.playerClan && state.alliances?.includes(clan)
      && Number.isInteger(state.allianceExpires?.[clan]) && state.allianceExpires[clan] > state.turn;
  }
  function npcPact(state, first, second) {
    return (state.npcPacts || []).some(pair => pair.includes(first) && pair.includes(second));
  }
  function warKey(state, sourceId, targetId, mode) {
    return `aid-${state.turn}-${state.aiRound || 0}-${sourceId}-${targetId}-${mode}`;
  }
  function eligibleWar(state, sourceId, targetId, mode) {
    const source = castle(state, sourceId), target = castle(state, targetId);
    if (!source || !target || source.id === target.id || source.clan === target.clan
      || source.clan === state.playerClan || target.clan === state.playerClan
      || npcPact(state, source.clan, target.clan)
      || !['field', 'siege'].includes(mode) || !source.neighbors?.includes(target.id)) return null;
    const attackAlly = liveAlliance(state, source.clan), defendAlly = liveAlliance(state, target.clan);
    // Remain neutral when both belligerents are the player's allies.
    if (attackAlly === defendAlly) return null;
    return { source, target, side: attackAlly ? 'attacker' : 'defender',
      allyClan: attackAlly ? source.clan : target.clan,
      opponentClan: attackAlly ? target.clan : source.clan };
  }
  function queueWar(state, sourceId, targetId, mode = 'siege') {
    if (state.gameOver || state.pendingDefense || hasPendingEngagement(state)) return false;
    const war = eligibleWar(state, sourceId, targetId, mode);
    if (!war) return false;
    const entry = ledger(state), id = warKey(state, sourceId, targetId, mode);
    if (entry.processed.includes(id) || entry.pending.some(item => item.id === id)) return false;
    const request = { id, sourceId, targetId, mode, side: war.side, allyClan: war.allyClan,
      opponentClan: war.opponentClan, turn: state.turn, round: state.aiRound || 0,
      expiresTurn: state.turn, sourceClan: war.source.clan, targetClan: war.target.clan,
      requestedTroops: Math.max(100, Math.min(3000, Math.ceil(war.target.troops * .35 / 100) * 100)) };
    entry.pending.push(request);
    append(state, '同盟国からの援軍要請', `${clanName(state, request.allyClan)}から${war.target.name}の${request.side === 'defender' ? '防衛' : '攻略'}への援軍要請。派兵元と人数を選んで応じるか、拒否してください。判断するまで戦況と月は進みません。`);
    return true;
  }
  function append(state, title, text) {
    state.nextLogId = Math.max(1, state.nextLogId || 1);
    state.logs = [{ id: `allies-${state.nextLogId++}`, type: 'diplomacy', title, text,
      date: date(state) }, ...(state.logs || [])].slice(0, 80);
  }
  function currentWar(state, request) {
    const source = castle(state, request.sourceId), target = castle(state, request.targetId);
    return !!source && !!target && source.clan === request.sourceClan && target.clan === request.targetClan;
  }
  function warExecutable(state, request) {
    if (!currentWar(state, request) || npcPact(state, request.sourceClan, request.targetClan)) return false;
    if (typeof adapter.canResolveWar !== 'function') return true;
    try {
      const result = adapter.canResolveWar(state, { ...request, requestId: request.id });
      return result === true || !!result && typeof result === 'object' && result.ok === true;
    } catch (_) { return false; }
  }
  function activeRequest(state, request) {
    return warExecutable(state, request) && request.turn === state.turn && liveAlliance(state, request.allyClan)
      && !liveAlliance(state, request.opponentClan);
  }
  function unitsAt(state, source) {
    const stored = state.armies?.[source.id]?.units || emptyUnits();
    return Object.fromEntries(UNITS.map(key => [key, !source.coastal && key === 'navy' ? 0 : Math.max(0, stored[key] || 0)]));
  }
  function fightingOnCoast(state, request) {
    const target = castle(state, request.targetId), source = castle(state, request.sourceId);
    return !!target?.coastal || source?.routes?.[target?.id] === 'sea';
  }
  function deployableUnits(state, source, request) {
    const units = unitsAt(state, source);
    if (!fightingOnCoast(state, request)) units.navy = 0;
    return units;
  }
  function split(units, count) {
    const available = total(units), result = emptyUnits();
    if (!available || count <= 0) return result;
    const remainders = [];
    for (const key of UNITS) {
      const amount = units[key] * count / available;
      result[key] = Math.floor(amount); remainders.push({ key, fraction: amount - result[key] });
    }
    remainders.sort((a, b) => b.fraction - a.fraction || UNITS.indexOf(a.key) - UNITS.indexOf(b.key));
    for (let left = count - total(result), i = 0; left > 0; i++, left--) result[remainders[i % remainders.length].key]++;
    return result;
  }
  // Only friendly territory may carry a contingent. Sea edges need the source's
  // real navy; allied ownership alone never teleports soldiers across Japan.
  function routeFor(state, source, request) {
    const destination = request.side === 'attacker' ? request.sourceId : request.targetId;
    const friendly = item => item && (item.clan === state.playerClan || item.clan === request.allyClan);
    const search = allowSea => {
      const queue = [{ id: source.id, path: [source.id], maritime: false }], seen = new Set([source.id]);
      for (let index = 0; index < queue.length; index++) {
        const step = queue[index], from = castle(state, step.id);
        if (step.id === destination) return step;
        for (const id of from?.neighbors || []) {
          const next = castle(state, id), sea = from.routes?.[id] === 'sea';
          if (!friendly(next) || seen.has(id) || sea && (!allowSea || !from.coastal || !next.coastal)) continue;
          seen.add(id); queue.push({ id, path: [...step.path, id], maritime: step.maritime || sea });
        }
      }
      return null;
    };
    return search(false) || (source.coastal && unitsAt(state, source).navy >= 100 ? search(true) : null);
  }
  function minimumGarrison(source) { return Math.max(150, Math.floor(source.troops * .2)); }
  function remainingOrders(state, id) {
    return root.TenkaOrders?.remaining ? root.TenkaOrders.remaining(state, id) : Math.max(0, state.actionPoints || 0);
  }
  function sourceView(state, request, source) {
    const units = deployableUnits(state, source, request), route = routeFor(state, source, request), guard = minimumGarrison(source);
    let maximum = Math.max(0, Math.min(total(units), source.troops - guard));
    if (route?.maritime) maximum = Math.min(maximum, units.navy * 10);
    const commanderId = state.armies?.[source.id]?.commanderId || null;
    const commander = state.officers?.find(item => item.id === commanderId);
    let reason = !route ? '同盟領への陸路・海路がありません。' : !maximum ? '守備兵を残して派兵できる兵がいません。'
      : remainingOrders(state, source.id) < 1 ? 'この城の今月の行動力がありません。' : null;
    return { id: source.id, name: source.name, troops: source.troops, minimumGarrison: guard,
      maxTroops: reason ? 0 : maximum, availableTroops: maximum, units, commanderId,
      commanderName: commander?.name || '援軍奉行', maritime: !!route?.maritime,
      route: route?.path || [], foodCostAtMax: foodCost(maximum, request.mode), reason };
  }
  function foodCost(troops, mode) { return 600 + Math.round(troops * .12 * (mode === 'siege' ? 2 : 1)); }
  function preview(state, action = {}) {
    const request = state.tenka?.allies?.pending?.find(item => item.id === action.requestId);
    const invalid = message => ({ ok: false, message, foodCost: 0, goldCost: 120, orderCost: 1, availableTroops: 0, remainingGarrison: 0 });
    if (!request) return invalid('未決の援軍要請を選んでください。');
    if (!activeRequest(state, request)) return invalid('同盟の失効や戦況の変化で派兵できません。要請を終了してください。');
    const source = castle(state, action.sourceId);
    if (!source || source.clan !== state.playerClan) return invalid('援軍を出す自領の城を選んでください。');
    const info = sourceView(state, request, source);
    const result = { ok: false, message: '', foodCost: Number.isSafeInteger(action.troops) && action.troops > 0 ? foodCost(action.troops, request.mode) : 0,
      goldCost: 120, orderCost: 1, availableTroops: info.maxTroops,
      remainingGarrison: source.troops - (Number.isSafeInteger(action.troops) ? action.troops : 0),
      maritime: info.maritime, route: info.route };
    if (info.reason) result.message = info.reason;
    else if (!Number.isSafeInteger(action.troops) || action.troops < 1 || action.troops > info.maxTroops) result.message = `派兵人数は1人から${info.maxTroops}人までの整数で指定してください。`;
    else if (state.gold < result.goldCost || state.food < result.foodCost) result.message = `派兵には金${result.goldCost}貫・兵糧${result.foodCost}石が必要です。`;
    else {
      const selected = split(info.units, action.troops);
      if (info.maritime && (selected.navy < 100 || action.troops > selected.navy * 10)) result.message = '海上の援軍には水軍100人以上と十分な輸送力が必要です。兵科編制や派兵人数を見直してください。';
      else { result.ok = true; result.units = selected; result.commanderId = info.commanderId; result.commanderName = info.commanderName; }
    }
    return result;
  }
  function getView(state) {
    return { requests: (state.tenka?.allies?.pending || []).map(request => ({ ...request,
      sourceName: castle(state, request.sourceId)?.name || request.sourceId,
      targetName: castle(state, request.targetId)?.name || request.targetId,
      allyName: clanName(state, request.allyClan), opponentName: clanName(state, request.opponentClan),
      active: activeRequest(state, request),
      sources: state.castles.filter(item => item.clan === state.playerClan).map(item => sourceView(state, request, item)),
      canSend: activeRequest(state, request) })), reports: clone(state.tenka?.allies?.reports || []), declineRelationLoss: DECLINE_LOSS };
  }
  function debitOrder(state, id) {
    if (root.TenkaOrders?.sync) {
      const next = root.TenkaOrders.sync(state, id);
      next.tenka.castleOrders.castles[id].remaining--;
      next.actionPoints = root.TenkaOrders.remaining(next, next.selectedCastleId);
      return next;
    }
    state.actionPoints--; return state;
  }
  function validUnits(value, maximum) {
    return !!value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every(key => UNITS.includes(key))
      && UNITS.every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && (!maximum || value[key] <= maximum[key]));
  }
  function act(input, action = {}) {
    if (!['send', 'decline'].includes(action.type)) return fail(input, '派兵または拒否を選んでください。');
    if (!validate(input)) return fail(input, '援軍要請の記録が不正です。');
    const pending = input.tenka?.allies?.pending?.find(item => item.id === action.requestId);
    if (!pending) return fail(input, 'この援軍要請は既に終了しています。');
    let state = initialize(input), request = clone(pending), support = null;
    const allied = activeRequest(state, request), warExists = warExecutable(state, request);
    if (action.type === 'send') {
      const check = preview(state, action);
      if (!check.ok) return fail(input, check.message);
      state = debitOrder(state, action.sourceId);
      const source = castle(state, action.sourceId), army = state.armies[source.id];
      source.troops -= action.troops;
      for (const key of UNITS) army.units[key] -= check.units[key];
      state.gold -= check.goldCost; state.food -= check.foodCost;
      support = { sourceId: source.id, sourceName: source.name, clan: state.playerClan,
        side: request.side, troops: action.troops, units: check.units,
        commanderId: check.commanderId, commanderName: check.commanderName,
        morale: source.morale, color: source.color, route: check.maritime ? 'sea' : 'land',
        foodCost: check.foodCost, goldCost: check.goldCost, orderCost: 1 };
    }
    if (warExists) {
      if (typeof adapter.resolveWar !== 'function') return fail(input, '援軍の戦闘処理を読み込めませんでした。再読み込みしてください。');
      let result;
      try { result = adapter.resolveWar(state, { ...request, requestId: request.id }, support); }
      catch (_) { return fail(input, '戦況を処理できませんでした。派兵の費用と兵は消費していません。'); }
      if (!result?.ok || !result.state || !result.battle) return fail(input, result?.message || '戦況を処理できませんでした。');
      state = result.state;
      if (support) {
        const losses = result.supportLosses || result.battle.supportLosses;
        if (!validUnits(losses, support.units)) return fail(input, '援軍の損失を検証できません。派兵は確定していません。');
        const home = castle(state, support.sourceId), army = state.armies?.[support.sourceId];
        if (!home || home.clan !== state.playerClan || !army) return fail(input, '援軍の帰還先を検証できません。');
        for (const key of UNITS) army.units[key] += support.units[key] - losses[key];
        home.troops += support.troops - total(losses);
        support.losses = clone(losses); support.casualties = total(losses);
      }
      request.battle = result.battle;
    }
    const relationChange = action.type === 'decline' && allied ? -DECLINE_LOSS : action.type === 'send' ? 5 : 0;
    if (relationChange) state.relations[request.allyClan] = Math.max(-100, Math.min(100, (state.relations[request.allyClan] || 0) + relationChange));
    const entry = ledger(state), name = clanName(state, request.allyClan), battle = request.battle;
    const allyWon = battle ? request.side === 'attacker' ? !!battle.won : !battle.won : null;
    const report = { id: `report-${request.id}`, requestId: request.id, allyClan: request.allyClan, allyName: name,
      sourceId: support?.sourceId || null, sourceName: support?.sourceName || null,
      warSourceId: request.sourceId, targetId: request.targetId, targetName: castle(state, request.targetId)?.name || request.targetId,
      side: request.side, decision: action.type, troops: support?.troops || 0,
      casualties: support?.casualties || 0, survivors: support ? support.troops - support.casualties : 0,
      units: support?.units || emptyUnits(), casualtyUnits: support?.losses || emptyUnits(),
      foodCost: support?.foodCost || 0, goldCost: support?.goldCost || 0, orderCost: support ? 1 : 0,
      relationChange, won: allyWon, battleId: battle?.id || null, turn: state.turn,
      date: date(state),
      message: support ? `${support.sourceName}から${support.troops}人を派兵。${name}側は${allyWon ? '勝利' : '敗北'}。援軍の戦死・損失${support.casualties}人、帰還${support.troops - support.casualties}人。友好+5。`
        : allied ? `${name}の援軍要請を拒否。友好-${DECLINE_LOSS}。同盟国は援軍なしで戦いました。`
          : `${name}の失効した援軍要請を終了。${warExists ? '戦闘は援軍なしで決着しました。' : '既に戦況が変化しています。'}友好度の変化はありません。` };
    entry.pending = entry.pending.filter(item => item.id !== request.id);
    entry.processed = [...entry.processed, request.id].slice(-200);
    entry.reports = [report, ...entry.reports].slice(0, 40);
    append(state, support ? '援軍の帰還' : '援軍要請への返答', report.message);
    if (root.TenkaOrders?.sync) state = root.TenkaOrders.sync(state);
    return { ok: true, state, report, battle, message: report.message };
  }
  function warContext(state, options = {}) {
    const source = castle(state, options.sourceId), target = castle(state, options.targetId);
    const defending = !!options.defending, mode = options.mode === 'field' ? 'field' : 'siege';
    if (!source || !target || source.id === target.id || source.clan === target.clan
      || !source.neighbors?.includes(target.id) || state.gameOver) return null;
    if (defending) {
      const pending = state.pendingDefense;
      if (!pending || pending.sourceId !== source.id || pending.targetId !== target.id
        || target.clan !== state.playerClan || source.clan === state.playerClan
        || liveAlliance(state, source.clan) || mode !== (pending.mode || 'siege')) return null;
    } else if (source.clan !== state.playerClan || target.clan === state.playerClan || liveAlliance(state, target.clan)) return null;
    return { sourceId: source.id, targetId: target.id, sourceName: source.name, targetName: target.name,
      mode, defending, side: defending ? 'defender' : 'attacker', opponentClan: defending ? source.clan : target.clan,
      id: `${source.id}:${target.id}:${mode}:${defending ? 'defense' : 'attack'}` };
  }
  function sameContext(support, options) {
    return support.battleSourceId === options.sourceId && support.targetId === options.targetId
      && support.defending === !!options.defending && (!options.mode || support.mode === options.mode);
  }
  function supportRoute(state, source, context) {
    // Reverse the friendly-endpoint convention used by an incoming request.
    return routeFor(state, source, { ...context,
      sourceId: context.defending ? context.sourceId : context.sourceId,
      targetId: context.targetId, side: context.defending ? 'defender' : 'attacker', allyClan: source.clan });
  }
  function supportSourceView(state, source, context) {
    const units = deployableUnits(state, source, context), route = supportRoute(state, source, context), minimum = minimumGarrison(source);
    let maxTroops = Math.max(0, Math.min(total(units), source.troops - minimum));
    if (route?.maritime) maxTroops = Math.min(maxTroops, units.navy * 10);
    const reason = !liveAlliance(state, source.clan) ? '同盟の期限が切れています。'
      : npcPact(state, source.clan, context.opponentClan) ? 'その同盟国は交戦相手とも盟約があるため加勢できません。'
      : (state.relations?.[source.clan] || 0) < 40 ? '友好が低いため同盟国が援軍を承諾しません。'
        : !route ? '友好領を通る進軍路がありません。'
          : !maxTroops ? '守備隊を残すと派兵できる兵がありません。'
            : source.gold < 120 || source.food < foodCost(1, context.mode) ? '同盟国の出陣資金・兵糧が不足しています。' : null;
    return { id: source.id, name: source.name, sourceName: source.name, allyClan: source.clan, allyName: clanName(state, source.clan),
      troops: source.troops, maxTroops: reason ? 0 : maxTroops, minimumGarrison: minimum, units,
      maritime: !!route?.maritime, route: route?.path || [], foodCostAtMax: foodCost(maxTroops, context.mode), reason };
  }
  function getSupports(state, options = {}) {
    return clone((state.tenka?.allies?.committed || []).filter(support => sameContext(support, options)
      && support.turn === state.turn && liveAlliance(state, support.clan)
      && !npcPact(state, support.clan, castle(state, support.defending ? support.battleSourceId : support.targetId)?.clan)
      && !!warContext(state, { sourceId: support.battleSourceId, targetId: support.targetId, mode: support.mode, defending: support.defending })));
  }
  function contexts(state) {
    if (state.pendingDefense) {
      const context = warContext(state, { ...state.pendingDefense, defending: true });
      return context ? [context] : [];
    }
    const result = [];
    for (const source of state.castles || []) if (source.clan === state.playerClan) for (const id of source.neighbors || []) {
      const context = warContext(state, { sourceId: source.id, targetId: id, mode: 'siege' });
      if (context) result.push(context);
    }
    return result;
  }
  function getSupportView(state, options = {}) {
    const context = warContext(state, options), available = contexts(state);
    if (!context) return { ok: false, message: '出陣先または実際に侵攻を受けている城を選んでください。', context: null,
      contexts: available, sources: [], supports: [] };
    const sources = state.castles.filter(item => liveAlliance(state, item.clan) && item.clan !== context.opponentClan)
      .map(item => supportSourceView(state, item, context));
    return { ok: !hasPendingRequests(state), message: hasPendingRequests(state) ? '先に届いている援軍要請に返答してください。' : '',
      context, contexts: available, sources, supports: getSupports(state, context) };
  }
  function previewSupport(state, options = {}) {
    const view = getSupportView(state, options), invalid = message => ({ ok: false, message, foodCost: 0, goldCost: 120, orderCost: 0,
      maxTroops: 0, remainingGarrison: 0 });
    if (!view.ok) return invalid(view.message);
    const source = view.sources.find(item => item.id === options.supportCastleId);
    if (!source || options.allyClan != null && options.allyClan !== source.allyClan) return invalid('援軍を要請する同盟国の城を選んでください。');
    const result = { ok: false, message: '', foodCost: Number.isSafeInteger(options.troops) && options.troops > 0 ? foodCost(options.troops, view.context.mode) : 0,
      goldCost: 120, orderCost: 0, maxTroops: source.maxTroops, remainingGarrison: source.troops - (Number.isSafeInteger(options.troops) ? options.troops : 0),
      maritime: source.maritime, route: source.route, allyClan: source.allyClan };
    if (source.reason) result.message = source.reason;
    else if ((state.tenka?.allies?.committed || []).length) result.message = '既に援軍を手配しています。その合戦を開始するか、要請を取り消してください。';
    else if (!Number.isSafeInteger(options.troops) || options.troops < 1 || options.troops > source.maxTroops) result.message = `援軍は1人から${source.maxTroops}人までの整数で要請してください。`;
    else if (castle(state, source.id).food < result.foodCost) result.message = '同盟国の兵糧が足りません。要請する人数を減らしてください。';
    else {
      const units = split(source.units, options.troops);
      if (source.maritime && (units.navy < 100 || options.troops > units.navy * 10)) result.message = '海上援軍には水軍100人以上と十分な輸送力が必要です。';
      else { result.ok = true; result.units = units; result.context = view.context; }
    }
    return result;
  }
  function requestSupport(input, options = {}) {
    if (!validate(input)) return fail(input, '援軍の記録が不正です。');
    const check = previewSupport(input, options);
    if (!check.ok) return fail(input, check.message);
    const state = initialize(input), entry = ledger(state), source = castle(state, options.supportCastleId), army = state.armies[source.id];
    source.troops -= options.troops; source.gold -= check.goldCost; source.food -= check.foodCost;
    for (const key of UNITS) army.units[key] -= check.units[key];
    entry.nextSupportId ||= 1;
    const support = { id: `support-${state.turn}-${entry.nextSupportId++}`, sourceId: source.id, sourceName: source.name,
      name: `${source.clanName}援軍`, clanName: source.clanName, clan: source.clan, allyClan: source.clan, ownerClan: state.playerClan,
      battleSourceId: check.context.sourceId, targetId: check.context.targetId, mode: check.context.mode,
      defending: check.context.defending, side: check.context.side, troops: options.troops, units: check.units,
      commanderId: null, commanderName: '援軍奉行', morale: source.morale, color: source.color,
      foodCost: check.foodCost, goldCost: check.goldCost, turn: state.turn, maritime: check.maritime, route: check.route };
    entry.committed.push(support);
    const message = `${source.clanName}が${source.name}から${options.troops}人の援軍を承諾。${check.context.targetName}の${support.defending ? '防衛' : '攻略'}に加勢します。同盟国が金${check.goldCost}貫・兵糧${check.foodCost}石を負担しました。`;
    append(state, '同盟国の援軍、出陣', message);
    return { ok: true, state, support: clone(support), message };
  }
  function returnSupport(state, support, survivingUnits) {
    const destination = castle(state, support.sourceId)?.clan === support.clan ? castle(state, support.sourceId)
      : state.castles.find(item => item.clan === support.clan);
    if (!destination) return null;
    state.armies[destination.id] ||= { commanderId: null, units: emptyUnits() };
    const army = state.armies[destination.id];
    for (const key of UNITS) army.units[key] = (army.units[key] || 0) + survivingUnits[key];
    destination.troops += total(survivingUnits);
    return destination;
  }
  function release(state, support, reason) {
    const home = returnSupport(state, support, support.units), entry = ledger(state);
    entry.committed = entry.committed.filter(item => item.id !== support.id);
    entry.processed = [...entry.processed, `cancel-${support.id}`].slice(-200);
    append(state, '援軍手配の終了', `${support.clanName}の援軍${support.troops}人は${home ? home.name + 'へ帰還' : '本国の滅亡により解散'}。${reason}出陣時の費用・兵糧は返還されません。`);
  }
  function cancelSupport(input, options = {}) {
    if (!validate(input)) return fail(input, '援軍の記録が不正です。');
    const support = input.tenka?.allies?.committed?.find(item => item.id === options.supportId);
    if (!support) return fail(input, '取消できる援軍の手配がありません。');
    // Reconcile may have already returned a stale reservation.
    const state = initialize(input), current = state.tenka.allies.committed.find(item => item.id === support.id);
    if (current) release(state, current, 'プレイヤーが要請を取り消しました。');
    return { ok: true, state, message: '援軍の手配を終了しました。出陣した兵は本国へ帰還します。' };
  }
  function matchingUnsettledReport(state, support) {
    return [state.lastBattle, ...(state.aiBattles || [])].filter(Boolean).some(report =>
      report.sourceId === support.battleSourceId && report.targetId === support.targetId
        && report.supportReports?.some(item => item.id === support.id || item.supportId === support.id));
  }
  function reconcile(state) {
    const entry = ledger(state);
    entry.committed ||= []; entry.nextSupportId ||= 1;
    for (const support of [...entry.committed]) {
      if (matchingUnsettledReport(state, support)) continue;
      if (support.turn !== state.turn || !liveAlliance(state, support.clan)
        || npcPact(state, support.clan, castle(state, support.defending ? support.battleSourceId : support.targetId)?.clan)
        || !warContext(state, { sourceId: support.battleSourceId, targetId: support.targetId, mode: support.mode, defending: support.defending })) {
        release(state, support, '同盟期限または戦況の変化により要請が失効しました。');
      }
    }
    return state;
  }
  function finalizeBattle(input, report) {
    const supports = input.tenka?.allies?.committed || [], returned = new Set(input.tenka?.allies?.processed || []);
    const relevant = supports.filter(item => sameContext(item, { sourceId: report?.sourceId, targetId: report?.targetId,
      mode: report?.mode, defending: report?.defending }));
    if (!relevant.length) return { ok: true, state: input, message: '' };
    const items = report?.supportReports;
    if (!Array.isArray(items) || new Set(items.map(item => item.id || item.supportId)).size !== items.length) return fail(input, '援軍の合戦記録がありません。');
    for (const support of relevant) {
      const item = items.find(value => (value.id || value.supportId) === support.id), deployed = item?.committedUnits || item?.units;
      if (!item || item.sourceId !== support.sourceId || item.clan !== support.clan
        || !validUnits(deployed) || !validUnits(item.casualtyUnits, support.units) || !validUnits(item.survivingUnits, support.units)
        || UNITS.some(key => deployed[key] !== support.units[key] || item.casualtyUnits[key] + item.survivingUnits[key] !== support.units[key])
        || item.troops !== support.troops || item.casualties !== total(item.casualtyUnits) || item.survivors !== total(item.survivingUnits)
        || returned.has(`return-${support.id}`)) return fail(input, '援軍の損失・帰還兵を検証できません。');
    }
    const state = clone(input), entry = ledger(state);
    for (const support of relevant) {
      const item = items.find(value => (value.id || value.supportId) === support.id), home = returnSupport(state, support, item.survivingUnits);
      entry.committed = entry.committed.filter(value => value.id !== support.id);
      entry.processed = [...entry.processed, `return-${support.id}`].slice(-200);
      const allyName = clanName(state, support.clan);
      const result = { id: `report-${support.id}`, requestId: support.id, allyClan: support.clan, allyName,
        sourceId: support.sourceId, sourceName: support.sourceName, targetId: support.targetId,
        targetName: castle(state, support.targetId)?.name || support.targetId, side: support.side, decision: 'received',
        troops: support.troops, casualties: item.casualties, survivors: item.survivors,
        units: clone(support.units), casualtyUnits: clone(item.casualtyUnits), foodCost: support.foodCost, goldCost: support.goldCost,
        orderCost: 0, relationChange: 0, won: !!report.won !== !!report.defending, battleId: report.id,
        turn: state.turn, date: date(state),
        message: `${allyName}の援軍${support.troops}人：戦死・損失${item.casualties}人、${item.survivors}人が${home ? home.name + 'へ帰還' : '本国滅亡により解散'}。` };
      entry.reports = [result, ...entry.reports].slice(0, 40); append(state, '同盟軍の戦後報告', result.message);
    }
    return { ok: true, state, message: '同盟軍の損失と帰還を精算しました。' };
  }
  function validateBattleReport(report) {
    if (!report || typeof report !== 'object') return true;
    if (report.supportArmy != null) {
      const support = report.supportArmy;
      if (!support || !['attacker', 'defender'].includes(support.side) || typeof support.sourceId !== 'string'
        || typeof support.clan !== 'string' || !Number.isSafeInteger(support.troops) || support.troops < 1
        || !validUnits(support.units) || total(support.units) !== support.troops
        || !validUnits(report.supportLosses, support.units) || !validUnits(report.supportSurvivors, support.units)
        || UNITS.some(key => report.supportLosses[key] + report.supportSurvivors[key] !== support.units[key])
        || report.supportCasualties !== total(report.supportLosses)) return false;
    }
    if (report.supportReports != null) {
      if (!Array.isArray(report.supportReports) || report.supportReports.length > 1) return false;
      for (const support of report.supportReports) {
        const deployed = support?.committedUnits || support?.units;
        if (!support || typeof (support.id || support.supportId) !== 'string' || typeof support.clan !== 'string'
          || typeof support.sourceId !== 'string' || !validUnits(deployed) || !validUnits(support.casualtyUnits, deployed)
          || !validUnits(support.survivingUnits, deployed) || UNITS.some(key => support.casualtyUnits[key] + support.survivingUnits[key] !== deployed[key])
          || support.troops !== total(deployed) || support.casualties !== total(support.casualtyUnits)
          || support.survivors !== total(support.survivingUnits)) return false;
      }
    }
    return true;
  }
  function validate(state) {
    const entry = state?.tenka?.allies;
    if (entry == null) return true;
    if (!entry || entry.version !== 1 || !Array.isArray(entry.pending) || entry.pending.length > 1
      || !Array.isArray(entry.reports) || entry.reports.length > 40
      || !Array.isArray(entry.processed) || entry.processed.length > 200
      || new Set(entry.processed).size !== entry.processed.length || entry.processed.some(id => typeof id !== 'string')) return false;
    const ids = new Set();
    for (const request of entry.pending) {
      if (!request || typeof request.id !== 'string' || ids.has(request.id) || entry.processed.includes(request.id)
        || !Number.isSafeInteger(request.turn) || request.turn < 1 || request.turn > state.turn
        || !Number.isSafeInteger(request.round) || request.round < 0 || request.round > (state.aiRound || 0)
        || request.id !== `aid-${request.turn}-${request.round}-${request.sourceId}-${request.targetId}-${request.mode}`
        || request.expiresTurn !== request.turn || !['attacker', 'defender'].includes(request.side)
        || !['field', 'siege'].includes(request.mode) || request.sourceId === request.targetId
        || !castle(state, request.sourceId) || !castle(state, request.targetId)
        || request.sourceClan === request.targetClan || request.allyClan === state.playerClan || request.opponentClan === state.playerClan
        || request.allyClan !== (request.side === 'attacker' ? request.sourceClan : request.targetClan)
        || request.opponentClan !== (request.side === 'attacker' ? request.targetClan : request.sourceClan)
        || !Number.isSafeInteger(request.requestedTroops) || request.requestedTroops < 1) return false;
      ids.add(request.id);
    }
    if (entry.committed != null && (!Array.isArray(entry.committed) || entry.committed.length > 1)) return false;
    for (const support of entry.committed || []) {
      if (!support || typeof support.id !== 'string' || !Number.isSafeInteger(support.turn) || support.turn < 1 || support.turn > state.turn
        || support.ownerClan !== state.playerClan || support.clan === state.playerClan || support.clan !== support.allyClan
        || !castle(state, support.sourceId) || !castle(state, support.battleSourceId) || !castle(state, support.targetId)
        || !Number.isSafeInteger(support.troops) || support.troops < 1 || !validUnits(support.units) || total(support.units) !== support.troops
        || !['field', 'siege'].includes(support.mode) || typeof support.defending !== 'boolean'
        || support.side !== (support.defending ? 'defender' : 'attacker') || entry.processed.includes(`return-${support.id}`)
        || entry.processed.includes(`cancel-${support.id}`) || support.commanderId !== null) return false;
    }
    if (entry.nextSupportId != null && (!Number.isSafeInteger(entry.nextSupportId) || entry.nextSupportId < 1)) return false;
    if (![state.lastBattle, ...(state.aiBattles || [])].every(validateBattleReport)) return false;
    return entry.reports.every(report => report && typeof report.id === 'string' && typeof report.requestId === 'string'
      && ['send', 'decline', 'received'].includes(report.decision) && Number.isSafeInteger(report.turn) && report.turn <= state.turn
      && Number.isSafeInteger(report.troops) && report.troops >= 0
      && Number.isSafeInteger(report.casualties) && report.casualties >= 0 && report.casualties <= report.troops
      && report.survivors === report.troops - report.casualties
      && validUnits(report.units) && total(report.units) === report.troops
      && validUnits(report.casualtyUnits, report.units) && total(report.casualtyUnits) === report.casualties);
  }
  function install(core, options = {}) {
    configure(options);
    const hooks = {};
    for (const key of ['newGame', 'migrate', 'load']) if (typeof core[key] === 'function') hooks[key] = (...args) => {
      const state = core[key](...args); return state && validate(state) ? initialize(state) : null;
    };
    if (core.validate) hooks.validate = state => validate(state) && core.validate(state);
    if (core.save) hooks.save = state => validate(state) && core.save(initialize(state));
    for (const key of ['season', 'action', 'arrange']) if (core[key]) hooks[key] = (state, ...args) => {
      if (hasPendingRequests(state)) return fail(state, '同盟国からの援軍要請に、派兵または拒否で返答してください。');
      if (key === 'action' && args[0] === 'attack' && state.tenka?.allies?.committed?.length) {
        return fail(state, '援軍が合流しています。「戦場で采配する」から出陣してください。');
      }
      const result = core[key](state, ...args);
      return result?.state && result.ok !== false ? { ...result, state: initialize(result.state) } : result;
    };
    if (core.settle) hooks.settle = (state, battle) => {
      if (hasPendingRequests(state)) return fail(state, '同盟国からの援軍要請に返答してください。');
      const result = core.settle(state, battle);
      if (!result?.ok) return result;
      const settled = finalizeBattle(result.state, result.battle || result.state.lastBattle);
      return settled.ok ? { ...result, state: settled.state } : fail(state, settled.message);
    };
    if (core.createBattle) hooks.createBattle = options => {
      if (hasPendingRequests(options?.state)) throw Error('先に同盟国の援軍要請へ返答してください。');
      if (options?.state?.tenka?.allies?.committed?.length && !getSupports(options.state, options).length) {
        throw Error('手配した援軍と出陣先・戦い方が異なります。援軍を取り消すか、元の戦場を選んでください。');
      }
      return core.createBattle(options);
    };
    for (const module of [root.TenkaSystems, root.TenkaDynasty]) if (typeof module?.act === 'function') {
      const original = module.act;
      module.act = (state, ...args) => hasPendingRequests(state)
        ? fail(state, '同盟国からの援軍要請に、派兵または拒否で返答してください。') : original(state, ...args);
    }
    return hooks;
  }
  const api = { version: 1, initialize, configure, install, validate, queueWar, hasPendingEngagement, hasPendingRequests,
    getView, preview, act, liveAlliance, minimumGarrison, foodCost, declineRelationLoss: DECLINE_LOSS,
    getSupportView, previewSupport, requestSupport, cancelSupport, getSupports, finalizeBattle, reconcile, validateBattleReport };
  return api;
});
