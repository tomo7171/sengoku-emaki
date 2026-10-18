'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, context } = runtime();
const Supplies = context.TenkaSupplies;
const war = { sourceId: 'kiyosu', targetId: 'inabayama', mode: 'field' };

test('supply forecast matches the real deployed army, leaves guards at home and reserves the fixed expedition cost', () => {
  const state = Game.newGame(), before = clone(state), view = Supplies.preview(state, war);
  const battle = Game.createBattle({ state, ...war, carriedSupply: view.selected });
  const deployed = battle.units.filter(unit => unit.side === battle.playerSide).reduce((sum, unit) => sum + unit.troops, 0);
  assert.equal(view.troops, deployed);
  assert.ok(view.troops < state.castles.find(c => c.id === war.sourceId).troops);
  assert.equal(view.maximum, state.food - 600);
  assert.equal(view.recommended, Math.min(view.maximum, Math.ceil(deployed * .1 * 30)));
  assert.equal(battle.supply.attacker.initial, view.selected);
  assert.equal(view.reserve + view.selected + view.fixedCost, state.food);
  assert.deepEqual(clone(state), before, 'preparing supplies spends no resources before the battle');
});

test('player supply input rejects missing or fractional quantities while deliberate zero and defense inventory bounds are explicit', () => {
  const state = Game.newGame();
  for (const value of ['', '200', -1, .5, Infinity, state.food - 599]) {
    assert.equal(Supplies.preview(state, { ...war, carriedSupply: value }).ok, false, String(value));
  }
  assert.equal(Supplies.preview(state, { ...war, carriedSupply: 0 }).ok, true);
  const defense = { sourceId: 'inabayama', targetId: 'kiyosu', mode: 'siege', defending: true };
  const plan = Supplies.preview(state, { ...defense, carriedSupply: state.food });
  assert.equal(plan.ok, true); assert.equal(plan.fixedCost, 0); assert.equal(plan.reserve, 0);
  assert.equal(plan.troops, state.castles.find(c => c.id === 'kiyosu').troops);
  assert.equal(Supplies.preview({ ...state, food: 599 }, war).ok, false);
  assert.equal(Supplies.preview({ ...state, food: 599 }, { ...defense, carriedSupply: 599 }).ok, true);
});

test('real allied contingents are included in the player ration forecast without becoming player soldiers', () => {
  let state = Game.newGame();
  state.alliances = ['matsudaira']; state.allianceExpires = { matsudaira: state.turn + 4 }; state.relations.matsudaira = 90;
  const baseline = Supplies.preview(state, war);
  const support = context.TenkaAllies.requestSupport(state, { ...war, supportCastleId: 'okazaki', troops: 700 });
  assert.equal(support.ok, true, support.message); state = support.state;
  const plan = Supplies.preview(state, war);
  assert.equal(plan.troops, baseline.troops + 700); assert.equal(plan.alliedTroops, 700);
  const battle = Game.createBattle({ state, ...war, carriedSupply: plan.selected });
  assert.equal(plan.troops, battle.units.filter(unit => unit.side === battle.playerSide).reduce((sum, unit) => sum + unit.troops, 0));
  assert.equal(battle.units.filter(unit => unit.foreignSupport).reduce((sum, unit) => sum + unit.troops, 0), 700);
});

test('legacy development commands use the same construction and staffing rules instead of bypassing estate management', () => {
  const state = Game.newGame(), before = clone(state);
  const first = Game.action(state, 'develop', 'kiyosu');
  assert.equal(first.ok, true, first.message);
  assert.equal(first.state.tenka.estates.kiyosu.projects.length, 1);
  assert.ok(first.state.castles.find(c => c.id === 'kiyosu').kokudaka - state.castles.find(c => c.id === 'kiyosu').kokudaka < 3000);
  const current = clone(first.state), second = Game.action(first.state, 'develop', 'kiyosu');
  assert.equal(second.ok, false); assert.deepEqual(clone(second.state), current);
  assert.deepEqual(clone(state), before);
  assert.equal(Game.validate(first.state), true);
});
