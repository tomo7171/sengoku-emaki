/* 天下布武: player-selected expedition rations, shared by field and castle defense. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaSupplies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  let adapter = {};
  const format = n => Math.round(n || 0).toLocaleString('ja-JP');
  const total = units => Object.values(units || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
  function configure(options = {}) { adapter = { ...adapter, ...options }; }
  function preview(state, options = {}) {
    const source = state.castles?.find(c => c.id === options.sourceId);
    const target = state.castles?.find(c => c.id === options.targetId);
    const defending = options.defending === true;
    const own = defending ? target : source;
    const fixedCost = defending ? 0 : 600;
    const maximum = Math.max(0, Math.floor((state.food || 0) - fixedCost));
    let troops = own?.troops || 0;
    if (!defending && source && target) {
      const native = adapter.previewBattle?.(state, source, target, options.mode || 'siege');
      if (native && Number.isFinite(native.deployedTroops)) troops = native.deployedTroops;
      else {
        const units = { ...state.armies?.[source.id]?.units };
        const sea = source.routes?.[target.id] === 'sea';
        if (!target.coastal && !sea) units.navy = 0;
        troops = Math.min(total(units), Math.max(0, source.troops - Math.max(150, Math.min(800, Math.floor(source.troops * .2)))));
        if (sea) troops = Math.min(troops, (units.navy || 0) * 10);
      }
    }
    const supports = root.TenkaAllies?.getSupports?.(state, { sourceId: options.sourceId, targetId: options.targetId, mode: options.mode || 'siege', defending }) || [];
    const alliedTroops = supports.reduce((sum, support) => sum + support.troops, 0);
    troops += alliedTroops;
    const rate = troops * .1;
    const recommended = Math.min(maximum, Math.ceil(rate * 30));
    const selected = options.carriedSupply == null ? recommended : options.carriedSupply;
    let message = !source || !target || !own || own.clan !== state.playerClan ? '自家が参加する戦場を選んでください。'
      : !defending && (state.food || 0) < fixedCost ? '出陣準備の兵糧600石が不足しています。'
        : !Number.isSafeInteger(selected) || selected < 0 || selected > maximum ? `持込兵糧は0〜${format(maximum)}石の整数で指定してください。` : '';
    return { ok: !message, message, defending, troops, alliedTroops, fixedCost, maximum, recommended, selected,
      rate, minutes: rate > 0 ? selected / rate : 0, reserve: maximum - (Number.isFinite(selected) ? selected : 0),
      choices: [15, 30, 60].map(minutes => ({ minutes, amount: Math.ceil(rate * minutes), available: Math.ceil(rate * minutes) <= maximum })) };
  }
  function create(React) {
    const h = React.createElement;
    function SupplyPlan({ state, war, value, onChange }) {
      const view = preview(state, { ...war, carriedSupply: value });
      return h('section', { className: 'tenka-supply-plan', 'aria-label': '合戦に持ち込む兵糧' },
        h('h4', null, war?.defending ? '籠城の兵糧を用意する' : '出陣の兵糧を用意する'),
        h('p', null, '持ち込む兵糧を指定してください。兵数が多いほど消費が増え、枯渇すると士気・攻撃力・行軍に影響します。合戦中に領国の備蓄から自動補充はしません。'),
        h('div', { className: 'tenka-supply-facts' },
          h('span', null, '参加兵力 ', h('strong', null, format(view.troops) + ' 人'), view.alliedTroops ? '（同盟援軍 ' + format(view.alliedTroops) + ' 人を含む）' : ''),
          h('span', null, '消費の目安 ', h('strong', null, format(view.rate) + ' 石 / 戦場1分')),
          h('span', null, '用意できる量 ', h('strong', null, format(view.maximum) + ' 石'), view.fixedCost ? '（出陣準備600石は別途）' : '')),
        h('label', null, h('span', null, '持込兵糧（石）'), h('input', { type: 'number', inputMode: 'numeric', min: 0, max: view.maximum, step: 1, value: value == null ? view.recommended : value, 'aria-label': '合戦に持ち込む兵糧の数量', onChange: e => onChange(e.target.value === '' ? '' : Number(e.target.value)) })),
        h('div', { className: 'tenka-supply-presets' }, view.choices.map(choice => h('button', { key: choice.minutes, type: 'button', disabled: !choice.available, onClick: () => onChange(choice.amount) }, choice.minutes + '分の備え ／ ' + format(choice.amount) + '石'))),
        !view.ok ? h('p', { className: 'tenka-supply-warning', role: 'status' }, view.message)
          : h('p', { className: view.selected === 0 || view.minutes < 15 ? 'tenka-supply-warning' : 'tenka-supply-estimate', role: 'status' }, view.selected === 0 ? '兵糧なしで開戦します。直ちに補給不足の影響を受けます。' : '現在の兵数なら約' + (view.minutes < 1 ? Math.floor(view.minutes * 60) + '秒' : Math.floor(view.minutes) + '分') + 'の備え。領国に残す兵糧 ' + format(view.reserve) + '石。'),
        h('small', null, '実際に消費した分だけ戦後に精算し、未使用分は備蓄に戻ります。兵が減ると消費も減り、長期戦では兵糧切れに注意が必要です。'));
    }
    return { SupplyPlan };
  }
  return { configure, preview, create };
});
