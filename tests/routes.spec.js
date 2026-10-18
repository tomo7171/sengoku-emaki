'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
function setup() {
  const env = runtime();
  for (const [file, key] of [['tenka-transfers.js', 'TenkaTransfers'], ['tenka-routes.js', 'TenkaRoutes']]) {
    if (!env.context[key]) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), env.context);
  }
  const Routes = env.context.TenkaRoutes;
  // The native battle creator supplies eligibility on the unmodified real
  // campaign graph. Production uses the lighter native forecast adapter.
  Routes.configure({ getTargets: env.Game.targets || ((state, sourceId) => {
    const source = state.castles.find(item => item.id === sourceId);
    return source.neighbors.map(id => {
      try {
        const battle = env.Game.createBattle({ state, sourceId, targetId: id });
        return { id, canAttack: true, deployedTroops: battle.availableTroops };
      } catch (_) { return { id, canAttack: false }; }
    });
  }) });
  return { ...env, Routes };
}
function flatten(node) { return Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props.children || [])] : []; }
function content(node) { return Array.isArray(node) ? node.map(content).join('') : node && typeof node === 'object' ? content(node.props.children || []) : node == null || typeof node === 'boolean' ? '' : String(node); }
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };

test('all graph edges including long roads and every sea route are represented once without invented neighbors', () => {
  const env = setup(), state = env.Game.newGame(), before = clone(state);
  assert.equal(state.castles.length, 95);
  const expected = new Set(state.castles.flatMap(from => from.neighbors.map(id => [from.id, id].sort().join(':'))));
  const segments = env.Routes.getSegments(state, { selectedId: 'kiyosu', showAll: true });
  assert.equal(segments.length, expected.size);
  assert.deepEqual(new Set(segments.map(item => item.id)), expected);
  assert.equal(segments.filter(item => item.route === 'sea').length, new Set(state.castles.flatMap(from => from.neighbors.filter(id => from.routes[id] === 'sea').map(id => [from.id, id].sort().join(':')))).size);
  assert.ok(segments.some(item => Math.hypot(item.from.x - item.to.x, item.from.z - item.to.z) > 14), 'long actual connections remain visible');
  for (const segment of segments) {
    assert.equal(segment.dashed, segment.route === 'sea');
    assert.match(segment.label, /↔/);
  }
  assert.deepEqual(clone(state), before, 'reading map connections never changes the campaign');
});

test('selected castle connection lines remain distinct with nationwide routes hidden', () => {
  const env = setup(), state = env.Game.newGame(), selected = state.castles.find(item => item.id === 'kiyosu');
  const segments = env.Routes.getSegments(state, { selectedId: selected.id, showAll: false });
  assert.deepEqual(Array.from(segments, item => item.targetId).sort(), Array.from(selected.neighbors).sort());
  assert.ok(segments.every(item => item.selected && item.sourceId === selected.id && item.width >= .2 && item.opacity === 1));
  const selectedSea = state.castles.find(item => item.neighbors.some(id => item.routes[id] === 'sea'));
  assert.ok(env.Routes.getSegments(state, { selectedId: selectedSea.id, showAll: false }).some(item => item.dashed && item.color === '#087cb4'));
});

test('connection roster agrees with native attack gates, and enemy selection names the actual own departure castle', () => {
  const env = setup(), state = env.Game.newGame(), own = state.castles.find(item => item.id === 'kiyosu');
  const view = env.Routes.getView(state, own.id);
  assert.deepEqual(Array.from(view.connections, item => item.id).sort(), Array.from(own.neighbors).sort());
  const target = view.connections.find(item => item.id === 'inabayama');
  assert.equal(target.canAttack, true); assert.equal(target.sourceId, own.id); assert.equal(target.targetId, 'inabayama');
  assert.equal(env.Game.createBattle({ state, sourceId: target.sourceId, targetId: target.targetId }).availableTroops, target.deployedTroops);
  const ownNeighbor = view.connections.find(item => item.id === 'inuyama');
  assert.equal(ownNeighbor.canAttack, false); assert.equal(ownNeighbor.relation, 'own'); assert.match(ownNeighbor.reason, /自領/);
  const foreignView = env.Routes.getView(state, 'inabayama').connections.find(item => item.id === 'kiyosu');
  assert.equal(foreignView.canAttack, true); assert.equal(foreignView.sourceId, 'kiyosu'); assert.equal(foreignView.targetId, 'inabayama');
  assert.match(foreignView.directionLabel, /清洲城 → 稲葉山城/);
});

test('road eligibility explains allies, vassals, exhausted sources, missing resources and pending wars', () => {
  const env = setup(), base = env.Game.newGame();
  const view = state => env.Routes.getView(state, 'kiyosu').connections.find(item => item.id === 'inabayama');
  for (const [mutate, expected] of [
    [s => { s.alliances.push('saito'); s.allianceExpires.saito = s.turn + 4; }, /同盟・従属/],
    [s => { s.tenka.castleOrders.castles.kiyosu.remaining = 0; }, /行動力/],
    [s => { s.food = 0; }, /金120.*兵糧600/],
    [s => { s.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' }; }, /侵攻/],
    [s => { s.castles.find(c => c.id === 'kiyosu').troops = 500; s.armies.kiyosu.units = { ashigaru: 500, archer: 0, cavalry: 0, firearm: 0, navy: 0 }; }, /兵800/]
  ]) {
    const state = clone(base); mutate(state); const result = view(state);
    assert.equal(result.canAttack, false); assert.match(result.reason, expected);
  }
  env.context.TenkaDiplomacy = { isProtectedPair: (_s, first, second) => [first, second].includes('saito') };
  assert.equal(view(base).canAttack, false); assert.match(view(base).reason, /同盟・従属/);
  assert.equal(env.Routes.preview(base, base.castles.find(c => c.id === 'kiyosu'), base.castles.find(c => c.id === 'katsuyamakan')).canAttack, false);
});

test('connection controls select the named destination and open exactly that source-to-target battle', () => {
  const env = setup(), state = env.Game.newGame(), calls = [];
  const tree = env.Routes.create(React).RouteConnections({ state, castleId: 'inabayama', onSelect: id => calls.push(['select', id]), onAttack: (a, b) => calls.push(['attack', a, b]), showAllRoutes: false, onToggleRoutes: checked => calls.push(['toggle', checked]) });
  const nodes = flatten(tree);
  assert.match(content(tree), /稲葉山城の接続先/); assert.match(content(tree), /陸路/); assert.match(content(tree), /太線/);
  nodes.find(node => node.type === 'button' && node.props['aria-label'] === '清洲城を地図で確認').props.onClick();
  const row = nodes.find(node => node.type === 'li' && content(node).includes('清洲城'));
  flatten(row).find(node => node.type === 'button' && content(node) === 'この道で出陣').props.onClick();
  nodes.find(node => node.type === 'input').props.onChange({ target: { checked: true } });
  nodes.find(node => node.type === 'button' && content(node) === '接続先を地図で見る').props.onClick();
  assert.deepEqual(calls, [['select', 'kiyosu'], ['attack', 'kiyosu', 'inabayama'], ['toggle', true], ['select', 'inabayama']]);
});
