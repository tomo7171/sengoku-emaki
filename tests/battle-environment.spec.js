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
test('weather uses consistent daylight and reflective sky while terrain colour noise remains continuous', () => {
  const clear = Environment.atmosphere('晴'), rain = Environment.atmosphere('雨');
  assert.ok(clear.sunIntensity > rain.sunIntensity, 'overcast weather reduces direct sunlight');
  assert.ok(rain.shadowRadius > clear.shadowRadius, 'overcast light softens shadows');
  assert.notDeepEqual(clear.sky, rain.sky);
  assert.notEqual(clear.haze, rain.haze);
  assert.ok([clear, rain].every(light => light.exposure > .7 && light.exposure < 1.3 && light.reflectedIntensity > 0));
  for (const x of [-299.999, -32, -.001, 0, 1, 54.5, 400]) for (const z of [-300, -.001, 0, 29.99, 400]) {
    const value = Environment.surfaceNoise(x, z);
    assert.ok(value >= 0 && value <= 1);
    assert.equal(value, Environment.surfaceNoise(x, z), 'the same ground has stable colour across views');
    assert.ok(Math.abs(value - Environment.surfaceNoise(x + .0001, z - .0001)) < .001, 'no grid seam appears at a terrain sample boundary');
  }
  assert.equal(Environment.createTexture({}, 'sky'), null, 'headless consumers need no canvas');
});
function makeBattle(id, legacy = false, version = 1) {
  const state = Game.newGame(), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => target.neighbors.includes(castle.id) && castle.clan !== target.clan) || state.castles.find(castle => castle.id === target.neighbors[0]);
  if (source.clan === target.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  source.coastal = true; source.troops = 6000;
  state.armies[source.id].units = { ashigaru: 4000, navy: 2000, archer: 0, cavalry: 0, firearm: 0 };
  state.alliances = [];
  state.playerClan = source.clan;
  const battle = Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege', battlefieldVersion: legacy ? 0 : version });
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
  assert.ok(plan.ridges.length > 0);
  for (const ridge of plan.ridges) for (const point of ridge.points) assert.ok(point.x < plan.bounds.minX || point.x > plan.bounds.maxX || point.z < plan.bounds.minZ || point.z > plan.bounds.maxZ, 'the distant mountain range cannot cover expanded playable land');
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
    assert.ok(object.isInstancedMesh || object.name.startsWith('terrain-following-') || object.userData.decorativeOffMap, 'details are instanced or batched by surface');
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
    if (object.userData.decorativeOffMap) for (let index = 0; index < positions.count; index++) {
      const bounds = battle.layout.bounds, x = positions.getX(index), z = positions.getZ(index);
      assert.ok(x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ, 'decorative ranges never intrude into the authoritative battlefield');
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

test('regional woodland stays spread across near and far terrain without multiplying scene cost by map area', () => {
  const battle = makeBattle('inabayama'), world = battle.layout.landscape;
  world.version = 2;
  world.profile = { id: 'mountain', label: '山間の城', treeKind: 'cedar', forestDensity: .9 };
  battle.layout.bounds = { minX: -270, maxX: 270, minZ: -310, maxZ: 290 };
  for (const [index, [x, z]] of [[-170, -210], [190, -170], [-180, 180], [170, 200]].entries()) {
    world.forests.push({ id: `outer-wood-${index}`, kind: index % 2 ? 'cedar' : 'mixed', x, z, w: 85, d: 100 });
  }
  const before = JSON.stringify(battle), heightAt = (x, z) => 3 + Math.sin(x / 40) * 4 + Math.cos(z / 70) * 3;
  const plan = Environment.plan({ battle, heightAt }), repeat = Environment.plan({ battle, heightAt });
  assert.equal(JSON.stringify(plan), JSON.stringify(repeat));
  assert.equal(JSON.stringify(battle), before);
  assert.ok(plan.trees.length >= 220 && plan.trees.length <= 280, 'a larger map uses a fixed mobile-friendly tree budget');
  assert.ok(plan.trees.some(tree => Math.hypot(tree.x, tree.z) < 90), 'castle-side woodland remains visible');
  for (const [x, z] of [[-170, -210], [190, -170], [-180, 180], [170, 200]]) {
    assert.ok(plan.trees.some(tree => Math.abs(tree.x - x) < 43 && Math.abs(tree.z - z) < 51), 'each outer woodland receives its own cluster');
  }
  assert.ok(plan.trees.filter(tree => tree.distant).length > plan.trees.length / 2, 'most wide-area trees use reduced branch and crown detail');
  for (const item of [...plan.trees, ...plan.rocks, ...plan.grasses]) {
    assert.equal(item.y, heightAt(item.x, item.z), 'decorations follow regional slopes instead of a common flat surface');
    assert.equal(battle.layout.water.some(water => inside(item.x, item.z, water.polygon)), false);
  }
  assert.ok(plan.ridges.length > 0);
  for (const ridge of plan.ridges) for (const point of ridge.points) assert.ok(point.x < plan.bounds.minX || point.x > plan.bounds.maxX || point.z < plan.bounds.minZ || point.z > plan.bounds.maxZ);
});

test('coastal pines and Ryukyu broadleaves have different actual silhouettes and visible regional stone colours', () => {
  const source = makeBattle('inabayama'), before = JSON.stringify(source);
  const results = [];
  for (const profile of [{ id: 'coast', label: '沿岸', treeKind: 'pine', forestDensity: .6 }, { id: 'ryukyu', label: '琉球', treeKind: 'broadleaf', forestDensity: .6 }]) {
    const battle = clone(source); battle.layout.landscape.version = 2; battle.layout.landscape.profile = profile;
    const plan = Environment.plan({ battle });
    assert.ok(plan.trees.some(tree => tree.kind === profile.treeKind), `${profile.id} keeps its local tree type`);
    const scene = new Three.Group(), environment = Environment.create(Three, { battle, scene });
    assert.equal(environment.group.userData.regionalLandscape.id, profile.id);
    assert.equal(environment.stats.regionalProfile, profile.id);
    const crowns = environment.meshes.find(mesh => mesh.name === (profile.id === 'coast' ? 'spreading-japanese-pine-branches' : 'five-lobed-broadleaf-crowns'));
    const rocks = environment.meshes.find(mesh => mesh.name === 'weathered-rocks-at-woodland-edge');
    const matrix = crowns.instanceMatrix.array;
    const sx = Math.hypot(...matrix.slice(0, 3)), sy = Math.hypot(...matrix.slice(4, 7));
    results.push({ colour: [...rocks.instanceColor.array.slice(0, 3)], crownRatio: sy / sx });
    assert.ok(environment.stats.drawCalls <= 24);
    environment.dispose(); assert.equal(scene.children.length, 0);
  }
  assert.notDeepEqual(results[0].colour, results[1].colour, 'shared mesh batches carry different visible coastal and limestone-style tints');
  assert.ok(results[0].crownRatio < results[1].crownRatio * .7, 'spreading pine crowns are flatter than broadleaf crowns');
  assert.equal(JSON.stringify(source), before);
});

test('live regional battle plans render their own terrain, cultivated area and settlements without changing collision geometry', () => {
  const profiles = new Set(), fieldCounts = new Set();
  for (const id of ['kiyosu', 'inabayama', 'odawara', 'wakimoto', 'shuri']) {
    const battle = makeBattle(id, false, 2), before = JSON.stringify(battle), world = battle.layout.landscape;
    const heightAt = (x, z) => .18 + Battlefield.elevationDelta(battle.layout, x, z);
    const plan = Environment.plan({ battle, heightAt });
    profiles.add(plan.profile.id); fieldCounts.add(plan.fields.length);
    assert.equal(plan.fields.length, world.fields.length);
    assert.equal(plan.settlements.reduce((count, settlement) => count + settlement.houses.length, 0), world.settlements.reduce((count, settlement) => count + settlement.houses.length, 0));
    assert.ok(plan.fields.length > 15 && plan.settlements.length > 3, 'the added playable land contains inhabited and cultivated districts');
    assert.ok(plan.trees.some(tree => tree.x < -88 || tree.x > 88 || tree.z < -100 || tree.z > 84), 'woodland reaches the newly expanded battlefield');
    for (const tree of plan.trees) {
      assert.equal(tree.y, heightAt(tree.x, tree.z));
      assert.equal(Battlefield.blocked(battle.layout, tree.x, tree.z, tree.size * 1.8), false, 'real water and house footprints stay free of vegetation');
    }
    assert.equal(JSON.stringify(battle), before);
  }
  assert.ok(profiles.size >= 4, 'real castles have distinct plains, mountains, coasts and Ryukyu scenery');
  assert.ok(fieldCounts.size >= 3, 'regional farming patterns are not the same fixed set of parcels');
});
