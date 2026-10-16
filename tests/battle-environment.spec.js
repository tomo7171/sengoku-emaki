'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game } = runtime();
const context = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../tenka-battle-environment.js'), 'utf8'), context);
const Environment = context.TenkaBattleEnvironment;
function makeBattle(id) {
  const state = Game.newGame(), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => target.neighbors.includes(castle.id) && castle.clan !== target.clan);
  state.playerClan = source.clan;
  return Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege' });
}
function distance(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}
function inside(x, z, polygon) {
  let result = false;
  for (let index = 0, last = polygon.length - 1; index < polygon.length; last = index++) {
    const [a, b] = polygon[index], [c, d] = polygon[last];
    if ((b > z) !== (d > z) && x < ((c - a) * (z - b)) / (d - b) + a) result = !result;
  }
  return result;
}

test('landscape plans are deterministic decorations and preserve the production battle and movement geometry', () => {
  const battle = makeBattle('inabayama'), before = JSON.stringify(battle);
  const options = { battle, heightAt: (x, z) => .2 + Math.sin(x * .1) + Math.cos(z * .2) };
  const first = Environment.plan(options), second = Environment.plan(options);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(battle), before);
  assert.ok(first.trees.length > 30 && first.trees.length <= 118);
  assert.ok(first.trees.some(tree => tree.kind === 'cedar'));
  assert.ok(first.trees.some(tree => tree.kind === 'broadleaf'));
  assert.ok(first.rocks.length <= 56);
  assert.ok(first.grasses.length <= first.trees.length * 3);
  for (const item of [...first.trees, ...first.rocks, ...first.grasses]) {
    assert.ok([item.x, item.y, item.z, item.size, item.angle].every(Number.isFinite));
    assert.ok(Math.abs(item.x) >= 18, 'castle and gate sightlines stay open');
    assert.ok(item.x > first.bounds.minX && item.x < first.bounds.maxX);
    assert.ok(item.z > first.bounds.minZ && item.z < first.bounds.maxZ);
  }
  assert.equal(Environment.create({}, options), null, 'a consumer without Three needs no graphics initialization');
});

test('tree crowns clear real paths, castle baileys, water banks, starting units and fieldworks', () => {
  for (const id of ['inabayama', 'nanao', 'odawara', 'kiyosu']) {
    const battle = makeBattle(id);
    battle.fortifications = [{ id: 'fieldwork-1', kind: 'camp', x: 31, z: 23, w: 5, d: 4, rotation: 90 }];
    const before = clone(battle), landscape = Environment.plan({ battle, heightAt: () => .18 });
    for (const tree of landscape.trees) {
      const radius = tree.size * 1.8;
      for (const path of battle.layout.paths) for (let index = 1; index < path.points.length; index++) {
        assert.ok(distance(tree.x, tree.z, path.points[index - 1], path.points[index]) >= path.width / 2 + radius + 1.1);
      }
      for (const water of battle.layout.water) {
        for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) assert.equal(inside(tree.x + dx, tree.z + dz, water.polygon), false);
      }
      for (const bailey of battle.layout.baileys) assert.equal(inside(tree.x, tree.z, bailey.polygon), false);
      for (const unit of battle.units) assert.ok(Math.hypot(tree.x - unit.x, tree.z - unit.z) >= radius + 3.4);
      assert.ok(Math.abs(tree.x - 31) >= 2 + radius + 1.3 || Math.abs(tree.z - 23) >= 2.5 + radius + 1.3);
    }
    assert.deepEqual(clone(battle), before);
  }
});

test('horizon meshes remain outside the playable bounds and coastal ridges stay inland', () => {
  for (const id of ['inabayama', 'nanao', 'odawara', 'kiyosu']) {
    const battle = makeBattle(id), result = Environment.plan({ battle });
    assert.equal(result.ridges.length, 1);
    assert.equal(result.ridges[0].reconstruction, 'distant-heightfield');
    assert.ok(Math.max(...result.ridges[0].points.map(point => point.y)) < 14, 'distant rounded hills never overshadow the castle');
    assert.equal(result.ridges[0].points.length, result.ridges[0].rows * result.ridges[0].columns);
    for (const ridge of result.ridges) for (const point of ridge.points) {
      assert.ok(point.x < result.bounds.minX || point.x > result.bounds.maxX || point.z < result.bounds.minZ || point.z > result.bounds.maxZ);
    }
  }
  const layout = { id: 'coastal-test', bounds: { minX: -44, maxX: 44, minZ: -50, maxZ: 42 }, water: [{ type: 'sea', polygon: [[-100, -100], [-22, -100], [-22, 100], [-100, 100]] }] };
  const result = Environment.plan({ layout });
  assert.ok(result.ridges.every(ridge => ridge.axis === 'x' && ridge.inland === 1 && ridge.points.every(point => point.x > 44)));
  assert.ok(result.trees.every(tree => tree.x > -22 + tree.size * 1.8));
});

test('distant hills join the ground outer edge with real depth and a low smooth silhouette', () => {
  const heightAt = (x, z) => .2 + Math.sin(x * .01) * .1 + Math.cos(z * .01) * .1;
  const battle = makeBattle('inabayama'), result = Environment.plan({ battle, heightAt });
  const ridge = result.ridges[0];
  assert.equal(ridge.points[0].z, result.bounds.minZ - 5);
  assert.equal(ridge.points.at(-1).z, result.bounds.minZ - 185);
  for (let column = 0; column < ridge.columns; column++) {
    const point = ridge.points[column];
    assert.ok(Math.abs(point.y - heightAt(point.x, point.z)) < 1e-12, 'foreground meets the original ground surface');
  }
  for (let row = 0; row < ridge.rows; row++) for (let column = 0; column < ridge.columns - 1; column++) {
    const a = ridge.points[row * ridge.columns + column], b = ridge.points[row * ridge.columns + column + 1];
    assert.ok(Math.abs(a.y - b.y) / Math.hypot(a.x - b.x, a.z - b.z) < .2, 'smooth hillside has no narrow spikes');
  }
});
