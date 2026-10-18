/* 天下布武: the campaign graph, named connections, and gathering soldiers. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaRoutes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  let adapter = {};
  const castle = (state, id) => state.castles?.find(item => item.id === id);
  const number = value => Math.round(value || 0).toLocaleString('ja-JP');
  function configure(value = {}) { adapter = { ...adapter, ...value }; }
  function protectedPair(state, first, second) {
    if (first === second) return true;
    if (typeof root.TenkaDiplomacy?.isProtectedPair === 'function') return !!root.TenkaDiplomacy.isProtectedPair(state, first, second);
    if (first === state.playerClan || second === state.playerClan) return (state.alliances || []).includes(first === state.playerClan ? second : first);
    return (state.npcPacts || []).some(pair => pair.includes(first) && pair.includes(second));
  }
  function relationship(state, target) {
    if (target.clan === state.playerClan) return { relation: 'own', relationLabel: '自領' };
    if (protectedPair(state, state.playerClan, target.clan)) {
      const vassal = root.TenkaDiplomacy?.overlord?.(state, target.clan) === state.playerClan;
      return { relation: 'allied', relationLabel: vassal ? '従属' : '同盟' };
    }
    return { relation: 'foreign', relationLabel: (state.relations?.[target.clan] || 0) < 0 ? '敵対' : '他家' };
  }
  function preview(state, source, target) {
    if (!source || !target || source.clan !== state.playerClan) return { canAttack: false, reason: '出陣元には自領の城が必要です。' };
    if (!source.neighbors?.includes(target.id)) return { canAttack: false, reason: 'この二城を直接つなぐ街道・海路はありません。' };
    if (protectedPair(state, source.clan, target.clan)) return { canAttack: false, reason: source.clan === target.clan ? '自領の城です。周辺から兵を集められます。' : '同盟・従属関係にあるため出陣できません。' };
    const targets = adapter.getTargets?.(state, source.id) || [];
    const native = targets.find(item => item.id === target.id);
    let reason = state.gameOver ? 'この年代記は決着しました。'
      : state.pendingDefense ? '敵の侵攻への対応を終えてください。'
        : root.TenkaAllies?.hasPendingRequests?.(state) ? '同盟国からの援軍要請に返答してください。' : '';
    const committed = state.tenka?.allies?.committed || [];
    if (!reason && committed.length && !committed.some(item => item.sourceId === source.id && item.targetId === target.id && !item.defending)) reason = '合流済みの援軍がいる戦場へ出陣するか、援軍を帰還させてください。';
    if (!reason && (root.TenkaOrders?.remaining?.(state, source.id) ?? state.actionPoints ?? 0) < 1) reason = `${source.name}の今季の行動力がありません。`;
    if (!reason && (state.gold < 120 || state.food < 600)) reason = '出陣には金120貫・兵糧600石以上が必要です。';
    if (!reason && !native?.canAttack) reason = source.routes?.[target.id] === 'sea'
      ? '海路は港・水軍100人以上と輸送できる編制兵600人以上が必要です。'
      : '出陣には兵800人以上と、守備隊を除く編制兵600人以上が必要です。';
    return { ...(native || {}), canAttack: !reason, reason, sourceId: source.id, targetId: target.id };
  }
  function getView(state, castleId = state.selectedCastleId) {
    const selected = castle(state, castleId);
    if (!selected) return { castleId, name: '', own: false, connections: [], message: '地図から城を選ぶと、つながる城と進軍路が表示されます。' };
    const connections = [...new Set(selected.neighbors || [])].map(id => castle(state, id)).filter(Boolean).map(destination => {
      const route = selected.routes?.[destination.id] === 'sea' ? 'sea' : 'land';
      const source = selected.clan === state.playerClan ? selected : destination.clan === state.playerClan ? destination : null;
      const target = source?.id === selected.id ? destination : selected;
      const result = preview(state, source, target);
      const relation = relationship(state, destination);
      return { id: destination.id, name: destination.name, province: destination.province, clan: destination.clan,
        clanName: destination.clanName, color: destination.color, troops: destination.troops, route,
        routeLabel: route === 'sea' ? '海路' : '陸路', ...relation,
        sourceId: source?.id || null, sourceName: source?.name || '', targetId: target?.id || null,
        canAttack: result.canAttack, reason: result.reason, deployedTroops: result.deployedTroops || 0,
        directionLabel: source && target?.clan !== state.playerClan ? `${source.name} → ${target.name}` : `${selected.name} ↔ ${destination.name}` };
    });
    return { castleId: selected.id, name: selected.name, province: selected.province, own: selected.clan === state.playerClan,
      connections, count: connections.length,
      message: connections.length ? '太い線は選択中の城と直接つながる道です。城名を押すと移動先を地図で確認できます。' : 'この城に接続する街道・海路はありません。' };
  }
  function getSegments(input, options = {}) {
    const state = Array.isArray(input) ? { castles: input, playerClan: options.playerClan || 'oda', alliances: options.alliances || [] } : input;
    const selectedId = options.selectedId ?? state.selectedCastleId, seen = new Set(), segments = [];
    for (const from of state.castles || []) for (const id of from.neighbors || []) {
      const to = castle(state, id);
      if (!to || to.id === from.id) continue;
      const key = [from.id, to.id].sort().join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      const selected = from.id === selectedId || to.id === selectedId;
      if (!selected && options.showAll === false) continue;
      const sea = from.routes?.[to.id] === 'sea' || to.routes?.[from.id] === 'sea';
      const start = selected && to.id === selectedId ? to : from, end = start === from ? to : from;
      segments.push({ id: key, sourceId: start.id, targetId: end.id, sourceName: start.name, targetName: end.name,
        from: { x: start.x, z: start.z }, to: { x: end.x, z: end.z }, selected, route: sea ? 'sea' : 'land',
        routeLabel: sea ? '海路' : '陸路', color: sea ? '#087cb4' : '#b75520', dashed: sea,
        width: selected ? .2 : .065, opacity: selected ? 1 : .28,
        label: `${start.name} ↔ ${end.name}（${sea ? '海路' : '陸路'}）`, ...relationship(state, end) });
    }
    return segments;
  }
  function create(React) {
    const h = React.createElement;
    function RouteConnections({ state, castleId = state.selectedCastleId, onSelect, onAttack, showAllRoutes, onToggleRoutes }) {
      const view = getView(state, castleId);
      return h('section', { className: 'tenka-route-panel', 'aria-label': '城の接続先と進軍路' },
        h('div', { className: 'tenka-route-heading' }, h('h3', null, `${view.name || '選択した城'}の接続先`),
          onToggleRoutes && h('label', { className: 'tenka-route-toggle' }, h('input', { type: 'checkbox', checked: !!showAllRoutes,
            onChange: event => onToggleRoutes(event.target.checked) }), '全国の接続線')),
        h('div', { className: 'tenka-route-legend' }, h('span', { className: 'tenka-route-land' }, '━━ 陸路'), h('span', { className: 'tenka-route-sea' }, '┄┄ 海路'), h('span', null, '太線＝選択城の接続')),
        h('p', { className: 'tenka-route-note' }, view.message),
        onSelect && view.name && h('button', { type: 'button', className: 'secondary-button tenka-route-focus', onClick: () => onSelect(view.castleId) }, '接続先を地図で見る'),
        h('ul', { className: 'tenka-route-list' }, view.connections.map(item => h('li', { key: item.id, className: `tenka-route-row tenka-route-${item.relation}` },
          h('div', { className: 'tenka-route-destination' }, h('button', { type: 'button', onClick: () => onSelect?.(item.id),
            'aria-label': `${item.name}を地図で確認` }, item.name, h('small', null, item.province)),
          h('span', { className: 'tenka-route-badges' }, h('span', { className: item.route === 'sea' ? 'tenka-route-sea' : 'tenka-route-land' }, item.routeLabel),
            h('span', null, item.relationLabel), h('span', null, item.clanName))),
          item.canAttack ? h('div', { className: 'tenka-route-entry' }, h('small', null, `${item.directionLabel}・出陣可能 ${number(item.deployedTroops)}人`),
            onAttack && h('button', { type: 'button', className: 'secondary-button', onClick: () => onAttack(item.sourceId, item.targetId) }, 'この道で出陣'))
            : h('small', { className: 'tenka-route-reason' }, item.reason)
        ))));
    }
    function TroopTransfer({ state, castleId = state.selectedCastleId, onState, onNotify }) {
      const [sourceId, setSource] = React.useState(''), [count, setCount] = React.useState('');
      React.useEffect(() => { setSource(''); setCount(''); }, [castleId]);
      const view = root.TenkaTransfers?.getView(state, castleId);
      if (!view?.own) return null;
      const selected = view.sources.find(source => source.sourceId === sourceId);
      const amount = count === '' ? null : Number(count);
      const estimate = selected ? root.TenkaTransfers.preview(state, { sourceId, targetId: castleId, troops: amount }) : null;
      function submit(event) {
        event.preventDefault();
        const result = root.TenkaTransfers.act(state, { sourceId, targetId: castleId, troops: amount });
        onNotify?.(result.message, result.ok ? 'success' : 'warning');
        if (result.ok) { onState?.(result.state); setCount(''); }
      }
      return h('section', { className: 'tenka-transfer-panel', 'aria-label': '周辺の自領から集兵' },
        h('h3', null, '周辺の自領から集兵'),
        h('p', { className: 'tenka-route-note' }, `${view.targetName}：現在${number(view.troops)}人／収容上限${number(view.capacity)}人。直接つながる自領の城から兵科を保って移動します。`),
        view.message && h('p', { role: 'status', className: 'tenka-route-reason' }, view.message),
        !view.sources.length ? h('p', { className: 'tenka-route-note' }, '直接つながる周辺の自領の城がありません。') : h('form', { className: 'tenka-transfer-form', onSubmit: submit },
          h('label', null, '出発元の城', h('select', { value: sourceId, onChange: event => { setSource(event.target.value); setCount(''); }, 'aria-label': '集兵の出発元' },
            h('option', { value: '' }, '城を選んでください'), view.sources.map(source => h('option', { key: source.sourceId, value: source.sourceId }, `${source.sourceName}・${source.routeLabel}・最大${number(source.maxTroops)}人`)))),
          h('label', null, '移動する兵数', h('input', { type: 'number', min: 1, max: selected?.maxTroops || 1, step: 1, inputMode: 'numeric', value: count,
            onChange: event => setCount(event.target.value), placeholder: selected ? `1～${selected.maxTroops}` : '人数を入力', 'aria-label': '集兵人数' })),
          selected && h('p', { className: 'tenka-route-note' }, `${selected.sourceName}に守備兵${number(selected.minimumGarrison)}人以上を残します。出発元の行動力1回・兵糧${number(estimate?.food)}石。${selected.route === 'land' ? '陸路では水軍は移動しません。' : '海路は水軍100人以上・水軍の10倍まで輸送できます。'}`),
          estimate?.reason && h('p', { role: 'status', className: 'tenka-route-reason' }, estimate.reason),
          h('button', { type: 'submit', className: 'secondary-button', disabled: !sourceId || amount == null || !estimate?.ok }, `${view.targetName}へ集兵する`)));
    }
    return { RouteConnections, TroopTransfer };
  }
  return { version: 1, configure, getView, getSegments, preview, create };
});
