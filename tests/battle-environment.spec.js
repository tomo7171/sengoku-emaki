'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Three } = runtime({ three: true });
const context = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../tenka-battle-environment.js'), 'utf8'), context);
const Environment = context.TenkaBattleEnvironment;
vm.runInNewContext(fs.readFileSync(require.resolve('../tenka-battlefield.js'), 'utf8'), context);
const Battlefield = context.TenkaBattlefield;
function makeBattle(id, legacy = false) {
  const state = Game.newGame(), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => target.neighbors.includes(castle.id) && castle.clan !== target.clan);
  state.playerClan = source.clan;
  const battle = Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege' });
  if (legacy && battle.layout.landscape) {
    const world = battle.layout.landscape, roadIds = new Set(world.roads.map(road => road.id));
    battle.layout.bounds = { ...world.coreBounds };
    battle.layout.paths = battle.layout.paths.filter(path => !roadIds.has(path.id));
    battle.layout.water = battle.layout.water.filter(water => !water.landscape);
    battle.layout.structures = battle.layout.structures.filter(structure => !structure.landscape);
    battle.structures = battle.structures.filter(structure => !structure.landscape);
    delete battle.layout.landscape; delete battle.battlefieldVersion;
  }
  return battle;
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
  const battle = makeBattle('inabayama', true), before = JSON.stringify(battle);
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
    const battle = makeBattle(id, true);
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
    const battle = makeBattle(id, true), result = Environment.plan({ battle });
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
  const battle = makeBattle('inabayama', true), result = Environment.plan({ battle, heightAt });
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

test('expanded world decorations use the same fields and house footprints as the live battlefield rules', () => {
  const battle = makeBattle('nanao'); Battlefield.apply(battle);
  const before = JSON.stringify(battle), plan = Environment.plan({ battle, heightAt: (x, z) => .18 + Battlefield.elevationDelta(battle.layout, x, z) });
  assert.equal(plan.ridges.length, 0, 'the old grey background surface cannot cover the expanded playable land');
  assert.equal(plan.fields.length, battle.layout.landscape.fields.length);
  assert.equal(plan.settlements.length, 3);
  assert.equal(plan.settlements.reduce((sum, item) => sum + item.houses.length, 0), 20);
  assert.ok(plan.trees.length >= 150 && plan.trees.length <= 240);
  assert.ok(plan.trees.some(tree => tree.distant), 'far woodland uses the lower cost clustered detail');
  for (const tree of plan.trees) {
    assert.ok(!Battlefield.buildingAt(battle.layout, tree.x, tree.z, tree.size * 1.8 + 1.6));
    for (const field of battle.layout.landscape.fields) assert.equal(Battlefield.inFootprint(field, tree.x, tree.z, tree.size * 1.8 + 1), false, 'woodland cannot grow through the rice rows');
  }
  assert.equal(JSON.stringify(battle), before, 'render planning changes neither routes, water nor the authoritative house positions');
});

test('expanded fields, crops and settlements are finite terrain-following batches under the draw and face budget', () => {
  const battle = makeBattle('inabayama'); Battlefield.apply(battle);
  const before = JSON.stringify(battle), scene = new Three.Group(), owned = new Set(), shared = new Three.MeshStandardMaterial({ color: '#b0a589' });
  let sharedDisposals = 0; shared.addEventListener('dispose', () => sharedDisposals++);
  const heightAt = (x, z) => .18 + Math.sin(x * .05) * .25 + Math.cos(z * .05) * .2 + Battlefield.elevationDelta(battle.layout, x, z);
  const landscape = Environment.create(Three, { battle, scene, heightAt, materials: { wood: shared, stone: shared, plaster: shared, earth: shared, roof: shared } });
  let triangles = 0, draws = 0;
  landscape.group.traverse(object => {
    if (!object.isMesh) return;
    draws++;
    assert.ok(object.isInstancedMesh || object.name.startsWith('terrain-following-'), 'details are instanced or batched by surface');
    const geometry = object.geometry, positions = geometry.attributes.position;
    assert.ok(positions.count > 0 && geometry.attributes.normal.count === positions.count);
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    if (object.isInstancedMesh) assert.ok(object.instanceMatrix.array.every(Number.isFinite));
    triangles += (geometry.index?.count || positions.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    owned.add(geometry); owned.add(object.material); if (object.isInstancedMesh) owned.add(object);
    if (object.name.startsWith('terrain-following-')) {
      for (let index = 0; index < positions.count; index++) {
        const lift = positions.getY(index) - heightAt(positions.getX(index), positions.getZ(index));
        assert.ok(lift > .025 && lift < .17, 'each paddy, bank and canal vertex follows the real uneven ground');
      }
    }
  });
  assert.ok(draws <= 24, `bounded countryside draw calls: ${draws}`);
  assert.ok(triangles < 150000, `bounded countryside faces: ${triangles}`);
  assert.equal(landscape.stats.fields, 15); assert.equal(landscape.stats.houses, 20);
  for (const name of ['terrain-following-paddy-fields', 'terrain-following-dry-fields', 'terrain-following-canal-fields', 'ordered-rice-and-vegetable-crops', 'village-deep-thatched-hip-roofs', 'town-weathered-wooden-hip-roofs']) assert.ok(landscape.meshes.some(mesh => mesh.name === name), name);
  const releases = new Map();
  for (const resource of owned) { releases.set(resource, 0); resource.addEventListener('dispose', () => releases.set(resource, releases.get(resource) + 1)); }
  landscape.dispose(); landscape.dispose();
  assert.ok([...releases.values()].every(count => count === 1));
  assert.equal(sharedDisposals, 0, 'materials supplied by the castle renderer remain owned by that renderer');
  assert.equal(scene.children.length, 0);
  assert.equal(JSON.stringify(battle), before);
});
