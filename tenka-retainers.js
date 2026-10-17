/* 天下布武: the player assigns retainers to castles. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaRetainers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const castle = (state, id) => state.castles?.find(item => item.id === id);
  const own = (state, item) => !!item && item.clan === state.playerClan;
  const age = (state, officer) => Number.isFinite(officer?.birth) ? state.year - officer.birth : null;
  const female = officer => (officer?.gender || officer?.sex) === 'female';
  const failure = (state, message) => ({ ok: false, state, message });
  let customMovementBlocker = null;

  function configure(options = {}) {
    customMovementBlocker = typeof options.movementBlocker === 'function' ? options.movementBlocker : null;
  }
  function initialize(input) {
    // Stationing needs no parallel roster: the canonical officer location is
    // already saved by the campaign and used by recruitment and battles.
    return root.TenkaOrders?.sync ? root.TenkaOrders.sync(input) : clone(input);
  }
  function movementBlock(state, officer) {
    if (state.pendingDefense) return '敵の侵攻への対応を終えてから、武将の配置を変更してください。';
    if (root.TenkaAllies?.hasPendingEngagement?.(state)
      || (state.tenka?.allies?.pending || []).length) return '援軍要請への対応を終えてから、武将の配置を変更してください。';
    const custom = customMovementBlocker?.(state, officer);
    return custom ? typeof custom === 'string' ? custom : '合戦への対応を終えてから、武将の配置を変更してください。' : '';
  }
  function sourceCastle(state, officer) {
    if (officer?.castleId != null) return castle(state, officer.castleId);
    return root.TenkaOrders?.defaultCastle?.(state)
      || (own(state, castle(state, state.selectedCastleId)) ? castle(state, state.selectedCastleId)
        : state.castles?.find(item => own(state, item)));
  }
  function officerReason(state, officer) {
    if (!officer || officer.clan !== state.playerClan || officer.status !== 'active' || officer.capturedBy)
      return '活動中の自家武将を選んでください。';
    if (female(officer)) return '姫の婚姻と居所は家中の画面で確認してください。';
    if (age(state, officer) == null || age(state, officer) < 15) return '十五歳以上の元服した武将を選んでください。';
    if (state.tenka?.assignments?.[officer.id]?.turn === state.turn) return `${officer.name}は今季の任務中です。次の季節に配置を変更できます。`;
    if (!own(state, sourceCastle(state, officer))) return '命令を出せる自領の所属城がありません。';
    return movementBlock(state, officer);
  }
  function getView(input) {
    const state = initialize(input), blockedMessage = state.gameOver ? 'この年代記は決着しました。' : movementBlock(state);
    const remaining = id => root.TenkaOrders?.remaining?.(state, id) ?? Math.max(0, Number(state.actionPoints) || 0);
    const castles = (state.castles || []).filter(item => own(state, item)).map(item => ({
      id: item.id, name: item.name, province: item.province, remaining: remaining(item.id)
    }));
    const officers = (state.officers || []).filter(item => item.clan === state.playerClan && item.status === 'active'
      && !female(item) && age(state, item) >= 15).map(item => {
      const source = sourceCastle(state, item), location = castle(state, item.castleId);
      let reason = blockedMessage || officerReason(state, item);
      const commands = source ? remaining(source.id) : 0;
      if (!reason && commands < 1) reason = `${source.name}の今季の行動力は残り0／3です。次の季節に配置を変更できます。`;
      return { ...item, age: age(state, item), castleName: location?.name || '未配属',
        sourceCastleId: source?.id || null, sourceCastleName: source?.name || '', remaining: commands,
        busy: state.tenka?.assignments?.[item.id]?.turn === state.turn, available: !reason, reason };
    });
    return { officers, castles, cost: 1, blocked: !!blockedMessage, message: blockedMessage };
  }
  function act(input, action = {}) {
    if (action.type !== 'station') return failure(input, 'この配置命令は存在しません。');
    if (input.gameOver) return failure(input, 'この年代記は決着しました。');
    const person = input.officers?.find(item => item.id === action.officerId);
    const reason = officerReason(input, person);
    if (reason) return failure(input, reason);
    const destination = castle(input, action.castleId);
    if (!own(input, destination)) return failure(input, '配属先には自領の城を選んでください。');
    if (person.castleId === destination.id) return failure(input, `${person.name}は既に${destination.name}に配属されています。`);
    if (!root.TenkaOrders?.sync || !root.TenkaOrders?.remaining) return failure(input, '城ごとの命令設定を確認してください。');
    const source = sourceCastle(input, person);
    if (root.TenkaOrders.remaining(input, source.id) < 1) return failure(input,
      `${source.name}の今季の行動力は残り0／3です。次の季節に配置を変更できます。`);
    const state = root.TenkaOrders.sync(input, source.id), officer = state.officers.find(item => item.id === person.id);
    // Moving a commander must not leave an army at the old castle led from
    // afar. The destination's commander stays until the player changes it in
    // army organization; several officers can share the same castle.
    for (const army of Object.values(state.armies || {})) if (army.commanderId === officer.id) army.commanderId = null;
    officer.castleId = destination.id;
    state.tenka.castleOrders.castles[source.id].remaining--;
    const message = `${officer.name}を${person.castleId == null ? '未配属' : source.name}から${destination.name}へ配属しました。${source.name}の行動力を1回使用しました。`;
    state.nextLogId = Math.max(1, Number(state.nextLogId) || 1);
    state.logs = [{ id: `retainer-${state.nextLogId++}`, type: 'domestic', title: '武将の城配置', text: message,
      date: `${state.year}年 ${['春', '夏', '秋', '冬'][state.season || 0]}` }, ...(state.logs || [])].slice(0, 80);
    return { ok: true, state: root.TenkaOrders.sync(state), message };
  }
  return { version: 1, configure, initialize, getView, act };
});
