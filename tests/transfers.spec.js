'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const TYPES = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
function setup() {
  const env = runtime();
  for (const [file, key] of [['tenka-transfers.js', 'TenkaTransfers'], ['tenka-routes.js', 'TenkaRoutes']]) if (!env.context[key]) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), env.context);
  return { ...env, Transfers: env.context.TenkaTransfers, Orders: env.context.TenkaOrders };
}
const act = (env, state, troops = 600, sourceId = 'inuyama', targetId = 'kiyosu') => env.Transfers.act(state, { sourceId, targetId, troops });
const armyTotals = state => Object.fromEntries(TYPES.map(type => [type, Object.values(state.armies).reduce((sum, army) => sum + army.units[type], 0)]));
test('neighboring own castles transfer the actual troop types once, spend donor orders and preserve commanders', () => {
  const env = setup(), state = env.Game.newGame(), before = clone(state), result = act(env, state);
  assert.equal(result.ok, true, result.message); assert.deepEqual(clone(state), before);
  assert.equal(result.state.castles.find(c => c.id === 'kiyosu').troops, 3800);
  assert.equal(result.state.castles.find(c => c.id === 'inuyama').troops, 1200);
  assert.deepEqual(armyTotals(result.state), armyTotals(before));
  for (const id of ['kiyosu', 'inuyama']) assert.equal(result.state.armies[id].commanderId, before.armies[id].commanderId);
  assert.deepEqual(clone(result.state.officers), before.officers);
  assert.equal(env.Orders.remaining(result.state, 'inuyama'), 2); assert.equal(env.Orders.remaining(result.state, 'kiyosu'), 3);
  assert.equal(result.state.food, before.food - 60); assert.equal(result.state.gold, before.gold);
  assert.ok(result.movedUnits.archer > 0 && result.movedUnits.cavalry > 0 && result.movedUnits.firearm > 0);
  assert.equal(env.Game.validate(result.state), true);
  assert.equal(env.Game.save(result.state), true); const loaded = env.Game.load(); assert.ok(loaded);
  assert.deepEqual(armyTotals(loaded), armyTotals(result.state)); assert.equal(loaded.castles.find(c => c.id === 'kiyosu').troops, 3800);
  assert.equal(env.Orders.remaining(loaded, 'inuyama'), 2);
});
test('guard, receiver capacity, exact integer amounts and source command budget are enforced without mutation', () => {
  const env = setup(), base = env.Game.newGame();
  const view = env.Transfers.preview(base, { sourceId: 'inuyama', targetId: 'kiyosu' });
  assert.equal(view.minimumGarrison, 360); assert.equal(view.maxTroops, env.Systems.mobilizationLimit(base.castles.find(c => c.id === 'kiyosu')) - 3200);
  assert.equal(act(env, base, view.maxTroops).ok, true);
  const invalid = [0, -1, .5, 600.5, NaN, Infinity, '600', view.maxTroops + 1];
  for (const count of invalid) { const before = clone(base), result = act(env, base, count); assert.equal(result.ok, false, String(count)); assert.equal(result.state, base); assert.deepEqual(clone(base), before); }
  const full = clone(base); full.castles.find(c => c.id === 'kiyosu').troops = view.destinationCapacity;
  assert.match(act(env, full, 1).message, /収容上限/);
  const exhausted = clone(base); exhausted.tenka.castleOrders.castles.inuyama.remaining = 0; exhausted.actionPoints = 3;
  assert.equal(act(env, exhausted, 1).ok, false); assert.match(act(env, exhausted, 1).message, /行動力/);
  const poor = clone(base); poor.food = 0; assert.equal(act(env, poor, 1).ok, false);
  const spacious = clone(base); Object.assign(spacious.castles.find(c => c.id === 'kiyosu'), { population: 100000, kokudaka: 100000 });
  const guarded = env.Transfers.preview(spacious, { sourceId: 'inuyama', targetId: 'kiyosu' });
  assert.equal(guarded.maxTroops, 1440);
  assert.equal(act(env, spacious, 1441).ok, false);
  assert.equal(act(env, spacious, 1440).state.castles.find(c => c.id === 'inuyama').troops, 360, 'actual donor guard remains after an otherwise unconstrained transfer');
});
test('only directly connected own castles may exchange troops and naval units never move over a land road', () => {
  const env = setup(), state = env.Game.newGame();
  for (const [source, target] of [['kiyosu', 'kiyosu'], ['inabayama', 'kiyosu'], ['kiyosu', 'inabayama'], ['missing', 'kiyosu'], ['kiyosu', 'katsuyamakan']]) assert.equal(act(env, state, 1, source, target).ok, false);
  const from = state.castles.find(c => c.id === 'inuyama'), target = state.castles.find(c => c.id === 'kiyosu');
  from.coastal = true; target.coastal = true;
  state.armies.inuyama.units.ashigaru -= 200; state.armies.inuyama.units.navy = 200;
  const result = act(env, state, 500); assert.equal(result.ok, true, result.message);
  assert.equal(result.state.armies.inuyama.units.navy, 200); assert.equal(result.state.armies.kiyosu.units.navy, state.armies.kiyosu.units.navy);
  assert.deepEqual(armyTotals(result.state), armyTotals(state));
});
test('sea transfers use an existing sea edge, require a navy, respect convoy capacity, and charge transport food', () => {
  const env = setup(); let state = env.Game.newGame();
  const source = state.castles.find(c => c.id === 'noshima'), destination = state.castles.find(c => c.id === 'aokage');
  assert.equal(source.routes[destination.id], 'sea'); assert.equal(source.clan, destination.clan);
  state = env.Systems.chooseClan(state, source.clan).state;
  const from = state.castles.find(c => c.id === source.id), to = state.castles.find(c => c.id === destination.id);
  Object.assign(from, { troops: 4000, population: 100000, kokudaka: 100000 });
  Object.assign(to, { troops: 1000, population: 100000, kokudaka: 100000 });
  state.armies[from.id].units = { ashigaru: 3300, archer: 300, cavalry: 0, firearm: 200, navy: 200 };
  state.armies[to.id].units = { ashigaru: 900, archer: 100, cavalry: 0, firearm: 0, navy: 0 };
  const preview = env.Transfers.preview(state, { sourceId: from.id, targetId: to.id });
  assert.equal(preview.maxTroops, 2000); assert.equal(preview.route, 'sea');
  const result = act(env, state, 1000, from.id, to.id);
  assert.equal(result.ok, true, result.message); assert.equal(result.state.food, state.food - 180);
  assert.ok(result.movedUnits.navy > 0); assert.deepEqual(armyTotals(result.state), armyTotals(state));
  state.armies[from.id].units.navy = 99;
  assert.match(act(env, state, 10, from.id, to.id).message, /水軍100/);
});
test('pending defense and either pending or reserved allied reinforcements block troop movement', () => {
  const env = setup(), base = env.Game.newGame();
  for (const type of ['defense', 'pending', 'committed']) {
    const state = clone(base);
    if (type === 'defense') state.pendingDefense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege' };
    else state.tenka.allies[type] = [{ id: 'engagement' }];
    const result = act(env, state, 100); assert.equal(result.ok, false); assert.equal(result.state, state); assert.match(result.message, /合戦・援軍/);
  }
});
test('gathering UI starts with explicit empty choices and enables only a valid player-chosen integer count', () => {
  const env = setup(), values = []; let cursor = 0;
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useEffect() {},
    useState(initial) { const key = cursor++; if (!(key in values)) values[key] = initial; return [values[key], value => { values[key] = value; }]; } };
  let state = env.Game.newGame();
  const Component = env.context.TenkaRoutes.create(React).TroopTransfer;
  const render = () => { cursor = 0; return Component({ state, castleId: 'kiyosu', onState: next => { state = next; } }); };
  const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props.children || [])] : [];
  const control = (tree, type) => flatten(tree).find(n => n.type === type);
  let tree = render(); assert.equal(control(tree, 'select').props.value, ''); assert.equal(control(tree, 'input').props.value, ''); assert.equal(control(tree, 'button').props.disabled, true);
  control(tree, 'select').props.onChange({ target: { value: 'inuyama' } }); tree = render(); control(tree, 'input').props.onChange({ target: { value: '600.5' } });
  assert.equal(control(render(), 'button').props.disabled, true);
  control(render(), 'input').props.onChange({ target: { value: '600' } }); tree = render(); assert.equal(control(tree, 'button').props.disabled, false);
  control(tree, 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(state.castles.find(c => c.id === 'kiyosu').troops, 3800); assert.equal(control(render(), 'input').props.value, '');
});
