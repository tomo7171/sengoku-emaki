/* 天下布武: each castle issues three commands in a season. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaOrders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const LIMIT = 3;
  const clone = value => JSON.parse(JSON.stringify(value));
  const points = value => Number.isInteger(value) ? Math.max(0, Math.min(LIMIT, value)) : 0;
  const castle = (state, id) => state.castles?.find(item => item.id === id);
  const own = (state, item) => !!item && item.clan === state.playerClan;

  function defaultCastle(state, requestedId) {
    if (requestedId != null) {
      const requested = castle(state, requestedId);
      return own(state, requested) ? requested : null;
    }
    const selected = castle(state, state.selectedCastleId);
    if (own(state, selected)) return selected;
    const headId = state.tenka?.dynasty?.families?.[state.playerClan]?.headId;
    const home = castle(state, state.officers?.find(item => item.id === headId)?.castleId);
    return own(state, home) ? home : state.castles?.find(item => own(state, item)) || null;
  }
  function remaining(state, castleId) {
    const target = defaultCastle(state, castleId);
    if (!target) return 0;
    const ledger = state.tenka?.castleOrders;
    if (!ledger) return points(state.actionPoints);
    if (ledger.turn < state.turn) return LIMIT;
    if (ledger.turn !== state.turn) return 0;
    const entry = ledger.castles?.[target.id];
    return entry?.clan === target.clan ? points(entry.remaining) : 0;
  }
  function total(state) {
    return (state.castles || []).filter(item => own(state, item)).reduce((sum, item) => sum + remaining(state, item.id), 0);
  }
  function valid(state) {
    const ledger = state?.tenka?.castleOrders;
    if (ledger == null) return true; // Original saves are migrated on first use.
    if (!ledger || ledger.version !== 1 || !Number.isInteger(ledger.turn) || ledger.turn < 1 || ledger.turn > state.turn
      || !ledger.castles || typeof ledger.castles !== 'object' || Array.isArray(ledger.castles)) return false;
    const ids = (state.castles || []).map(item => item.id);
    if (Object.keys(ledger.castles).length !== ids.length || Object.keys(ledger.castles).some(id => !ids.includes(id))) return false;
    const clans = new Set([...(state.castles || []), ...(state.officers || [])].map(item => item.clan));
    for (const entry of Object.values(ledger.castles)) if (!entry || !clans.has(entry.clan) || !Number.isInteger(entry.remaining) || entry.remaining < 0 || entry.remaining > LIMIT) return false;
    return true;
  }
  function sync(input, castleId) {
    const state = clone(input), prior = state.tenka?.castleOrders;
    state.tenka ||= {};
    const refresh = !!prior && Number.isInteger(prior.turn) && prior.turn < state.turn;
    const entries = {};
    for (const item of state.castles || []) {
      const previous = prior?.castles?.[item.id];
      // A captured castle has spent this season restoring its command chain.
      // Retaking it cannot refill commands; every castle refreshes next season.
      const value = refresh ? LIMIT : !prior ? (item.clan === state.playerClan ? points(state.actionPoints) : LIMIT)
        : previous?.clan === item.clan && prior.turn === state.turn ? points(previous.remaining) : 0;
      entries[item.id] = { clan: item.clan, remaining: value };
    }
    state.tenka.castleOrders = { version: 1, turn: state.turn, castles: entries };
    state.actionPoints = remaining(state, castleId);
    return state;
  }
  function failure(state, message) { return { ok: false, state, message }; }

  function install(core) {
    let inCommand = 0;
    const original = { ...core };
    for (const key of ['newGame', 'validate', 'load', 'save', 'season', 'action', 'createBattle', 'settle', 'migrate']) {
      if (typeof original[key] !== 'function') throw Error(`城ごとの命令機関の ${key} がありません。`);
    }
    function perform(input, sourceId, invoke, options = {}) {
      const source = defaultCastle(input, sourceId);
      if (!source && !options.free) return failure(input, '命令を出す自領の城を選んでください。');
      const state = options.preserveStamp ? clone(input) : sync(input, source?.id);
      const before = state.actionPoints;
      let result;
      inCommand++;
      try { result = invoke(state); } finally { inCommand--; }
      if (!result?.ok) {
        if (result && source && remaining(input, source.id) === 0 && /命令|行動力/.test(result.message || '')) {
          return failure(input, `${source.name || source.id}の今季の行動力は残り0／3です。他の城を選ぶか、次の季節へ進めてください。`);
        }
        return result ? { ...result, state: input } : result;
      }
      const used = options.free ? 0 : Math.max(0, before - result.state.actionPoints);
      const next = sync(result.state, source?.id);
      if (source && used) {
        const entry = next.tenka.castleOrders.castles[source.id];
        if (entry?.clan === source.clan) entry.remaining = Math.max(0, remaining(state, source.id) - used);
      }
      next.actionPoints = remaining(next, source?.id);
      return { ...result, state: next };
    }
    const hooks = {
      newGame: () => sync(original.newGame()),
      validate: state => valid(state) && original.validate(state),
      save: state => valid(state) && original.save(sync(state)),
      load: () => { const state = original.load(); return state && valid(state) ? sync(state) : null; },
      // Internal Dynasty wrappers also call migrate before an action returns.
      // Preserve that transient debit until perform records it in the ledger.
      migrate: state => { const next = original.migrate(state); return inCommand ? next : sync(next); },
      season: state => {
        const result = original.season(sync(state));
        return result?.state ? { ...result, state: sync(result.state) } : result;
      },
      action: (state, type, targetId = state.selectedCastleId, options = {}) => {
        const explicit = options.orderCastleId ?? options.sourceId;
        const source = ['develop', 'train', 'repair'].includes(type) ? targetId : explicit;
        return perform(state, source, next => original.action(next, type, targetId,
          type === 'attack' ? { ...options, sourceId: defaultCastle(next, source)?.id } : options));
      },
      createBattle: options => {
        const source = defaultCastle(options?.state || {}, options?.sourceId);
        if (!source) throw Error('出陣元となる自領の城を選んでください。');
        return original.createBattle({ ...options, sourceId: source.id, state: sync(options.state, source.id) });
      },
      settle: (state, battle) => perform(state, battle?.defending ? battle.targetId : battle?.sourceId,
        next => original.settle(next, battle), { free: !!battle?.defending, preserveStamp: !!battle?.defending }),
    };
    const chooseClan = original.chooseClan || root.TenkaSystems?.chooseClan;
    if (chooseClan) {
      hooks.chooseClan = (state, clanId) => {
        if ((state.castles || []).some(item => own(state, item) && remaining(state, item.id) !== LIMIT)) {
          return failure(state, '城の命令を出した後は勢力を変更できません。新しいゲームから大名を選んでください。');
        }
        const result = chooseClan(state, clanId);
        return result.ok ? { ...result, state: sync(result.state) } : result;
      };
      if (root.TenkaSystems) root.TenkaSystems.chooseClan = hooks.chooseClan;
    }
    if (root.TenkaSystems?.act) {
      const act = root.TenkaSystems.act;
      root.TenkaSystems.act = (state, action = {}) => {
        const domestic = ['reclaim', 'commercial', 'levy', 'tax', 'relief', 'buyGrain', 'sellGrain', 'demobilize'].includes(action.type);
        const target = action.castleId || state.selectedCastleId;
        const explicit = action.orderCastleId ?? action.sourceId;
        if (domestic && explicit != null && explicit !== target) return failure(state, '内政・徴兵は対象の城自身の行動力で命じてください。');
        const source = domestic ? target : explicit;
        return perform(state, source, next => act(next, action));
      };
    }
    if (root.TenkaDynasty?.act) {
      const act = root.TenkaDynasty.act;
      root.TenkaDynasty.act = (state, action = {}) => perform(state, action.orderCastleId ?? action.sourceId,
        next => act(next, action), { free: action.type !== 'recruit' });
    }
    return hooks;
  }
  return { version: 1, limit: LIMIT, defaultCastle, remaining, total, valid, sync, initialize: sync, install };
});
