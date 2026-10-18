/* 天下布武: move actual soldiers between neighboring player castles. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaTransfers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
  const labels = { ashigaru: '足軽', archer: '弓隊', cavalry: '騎馬', firearm: '鉄砲', navy: '水軍' };
  const castle = (state, id) => state?.castles?.find(item => item.id === id);
  const total = units => TYPES.reduce((sum, type) => sum + (units[type] || 0), 0);
  const clone = value => JSON.parse(JSON.stringify(value));
  const failure = (state, message) => ({ ok: false, state, message });
  function blocked(state) {
    if (state.gameOver) return 'この年代記は決着しました。';
    if (state.pendingDefense || root.TenkaAllies?.hasPendingEngagement?.(state)) return '合戦・援軍要請への対応を終えてから集兵してください。';
    return '';
  }
  function unitsAt(state, source) {
    const stored = state.armies?.[source?.id]?.units || {};
    return Object.fromEntries(TYPES.map(type => [type, Number.isInteger(stored[type]) && stored[type] > 0 ? stored[type] : 0]));
  }
  function capacity(destination) {
    return root.TenkaSystems?.mobilizationLimit?.(destination)
      ?? Math.max(0, Math.floor(Math.min(destination.population * .12, destination.kokudaka * .085)));
  }
  function foodCost(troops, route) { return Math.ceil(troops * (route === 'sea' ? .18 : .1)); }
  function split(units, count) {
    const amount = total(units), moved = Object.fromEntries(TYPES.map(type => [type, 0]));
    if (!amount || count < 1) return moved;
    let remainder = count;
    const fractions = TYPES.map((type, index) => {
      const exact = units[type] * count / amount;
      moved[type] = Math.floor(exact); remainder -= moved[type];
      return { type, value: exact - moved[type], index };
    }).sort((a, b) => b.value - a.value || a.index - b.index);
    for (const { type } of fractions) if (remainder && moved[type] < units[type]) { moved[type]++; remainder--; }
    return moved;
  }
  function preview(state, action = {}) {
    const source = castle(state, action.sourceId), destination = castle(state, action.targetId || action.castleId);
    let reason = blocked(state);
    const route = source?.routes?.[destination?.id] === 'sea' ? 'sea' : 'land';
    const remaining = root.TenkaOrders?.remaining?.(state, source?.id) ?? 0;
    const guard = source ? Math.max(150, Math.floor(source.troops * .2)) : 150;
    const destinationCapacity = destination ? capacity(destination) : 0;
    const space = Math.max(0, destinationCapacity - (destination?.troops || 0));
    const units = source ? unitsAt(state, source) : Object.fromEntries(TYPES.map(type => [type, 0]));
    const available = { ...units };
    // Boats cannot be carried along a land road. Sea transfer keeps the five
    // real troop types and uses the source navy's transport capacity.
    if (route === 'land') available.navy = 0;
    const rate = route === 'sea' ? .18 : .1;
    let maxTroops = Math.max(0, Math.min(total(available), (source?.troops || 0) - guard, space,
      route === 'sea' ? units.navy * 10 : Infinity, Math.floor((state.food || 0) / rate)));
    while (maxTroops > 0 && foodCost(maxTroops, route) > state.food) maxTroops--;
    if (!reason && (!source || !destination || source.clan !== state.playerClan || destination.clan !== state.playerClan)) reason = '出発元と集結先には自領の城を選んでください。';
    if (!reason && (source.id === destination.id || !source.neighbors?.includes(destination.id))) reason = '街道・海路で直接つながる周辺の自領から集兵してください。';
    if (!reason && route === 'sea' && (!source.coastal || !destination.coastal || units.navy < 100)) reason = '海路での集兵には両城の港と、出発元の水軍100人以上が必要です。';
    if (!reason && remaining < 1) reason = `${source.name}の今季の行動力がありません。`;
    if (!reason && space < 1) reason = `${destination.name}は石高・人口に応じた収容上限です。開墾するか、兵を他城へ移してください。`;
    if (!reason && maxTroops < 1) reason = '守備兵・輸送兵糧を確保できる集兵人数がありません。';
    const troops = action.troops;
    if (!reason && troops != null && (!Number.isSafeInteger(troops) || troops < 1 || troops > maxTroops)) reason = `移動人数を1～${maxTroops.toLocaleString('ja-JP')}人の整数で指定してください。`;
    const movedUnits = Number.isSafeInteger(troops) && troops > 0 && troops <= maxTroops ? split(available, troops) : Object.fromEntries(TYPES.map(type => [type, 0]));
    return { ok: !reason, reason, sourceId: source?.id || null, sourceName: source?.name || '', targetId: destination?.id || null,
      targetName: destination?.name || '', route, routeLabel: route === 'sea' ? '海路' : '陸路', maxTroops, minimumGarrison: guard,
      sourceTroops: source?.troops || 0, targetTroops: destination?.troops || 0, destinationCapacity, space, remaining,
      food: Number.isSafeInteger(troops) && troops > 0 ? foodCost(troops, route) : 0, orderCost: 1, units: movedUnits, unitLabels: labels };
  }
  function getView(state, targetId = state.selectedCastleId) {
    const destination = castle(state, targetId);
    return { targetId, targetName: destination?.name || '', own: destination?.clan === state.playerClan, message: blocked(state),
      capacity: destination ? capacity(destination) : 0, troops: destination?.troops || 0,
      sources: (state.castles || []).filter(source => source.clan === state.playerClan && source.id !== targetId && source.neighbors?.includes(targetId))
        .map(source => preview(state, { sourceId: source.id, targetId })) };
  }
  function act(input, action = {}) {
    const view = preview(input, action);
    if (!view.ok) return failure(input, view.reason);
    if (!Number.isSafeInteger(action.troops) || action.troops < 1) return failure(input, '移動する兵の人数を指定してください。');
    if (!root.TenkaOrders?.sync) return failure(input, '城ごとの行動力設定を確認してください。');
    const state = root.TenkaOrders.sync(input), source = castle(state, view.sourceId), destination = castle(state, view.targetId);
    const fromArmy = state.armies[source.id], toArmy = state.armies[destination.id];
    if (!fromArmy || !toArmy) return failure(input, '城の軍団編制を確認してください。');
    for (const type of TYPES) {
      fromArmy.units[type] = (fromArmy.units[type] || 0) - view.units[type];
      toArmy.units[type] = (toArmy.units[type] || 0) + view.units[type];
    }
    source.troops -= action.troops; destination.troops += action.troops;
    state.food -= view.food;
    state.tenka.castleOrders.castles[source.id].remaining--;
    const message = `${source.name}から${destination.name}へ${action.troops.toLocaleString('ja-JP')}人を${view.routeLabel}で集兵しました。兵糧${view.food}石、${source.name}の行動力1回を使用。武将の所属は変わりません。`;
    state.nextLogId = Math.max(1, Number(state.nextLogId) || 1);
    state.logs = [{ id: `transfer-${state.nextLogId++}`, type: 'military', title: '周辺の城から集兵', text: message,
      date: `${state.year}年 ${['春', '夏', '秋', '冬'][state.season || 0]}` }, ...(state.logs || [])].slice(0, 80);
    return { ok: true, state: root.TenkaOrders.sync(state), message, movedUnits: clone(view.units) };
  }
  return { version: 1, preview, getView, act, foodCost };
});
