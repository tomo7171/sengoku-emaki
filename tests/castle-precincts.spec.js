'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
const { Game, Three, context } = runtime({ three: true });
const Precincts = context.TenkaCastlePrecincts;
const initial = Game.newGame();
const materials = Object.fromEntries(['wood', 'darkWood', 'stone', 'earth', 'plaster', 'roof', 'iron']
  .map(name => [name, new Three.MeshStandardMaterial({ color: '#928366' })]));
const heightAt = (x, z) => .2 + x * .02 - z * .01;

function battleFor(id, mode = 'siege') {
  const state = clone(initial), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => castle.id === target.neighbors[0]);
  state.playerClan = source.clan; state.alliances = [];
  if (source.clan === target.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  source.troops = 6000; source.coastal = true;
  state.armies[source.id].units = { ashigaru: 4000, navy: 2000, archer: 0, cavalry: 0, firearm: 0 };
  return Game.createBattle({ state, sourceId: source.id, targetId: id, mode });
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t);
}
const orientation = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentDistance(a, b, c, d) {
  if (orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}
function inTriangle(point, a, b, c) {
  if (Math.abs(orientation(a, b, c)) < 1e-8) return false;
  const signs = [orientation(a, b, point), orientation(b, c, point), orientation(c, a, point)];
  return signs.every(value => value >= 0) || signs.every(value => value <= 0);
}
function pathSegments(layout) {
  return layout.paths.flatMap(path => path.points.slice(1).map((point, index) => ({ a: path.points[index], b: point, radius: path.width / 2 - .12, id: path.id })));
}
function assertTriangleClearsPaths(vertices, paths, name) {
  const points = vertices.map(point => [point.x, point.z]);
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
  const minZ = Math.min(...points.map(point => point[1])), maxZ = Math.max(...points.map(point => point[1]));
  for (const path of paths) {
    if (maxX < Math.min(path.a[0], path.b[0]) - path.radius || minX > Math.max(path.a[0], path.b[0]) + path.radius
      || maxZ < Math.min(path.a[1], path.b[1]) - path.radius || minZ > Math.max(path.a[1], path.b[1]) + path.radius) continue;
    const distance = Math.min(...points.map((point, index) => segmentDistance(point, points[(index + 1) % 3], path.a, path.b)));
    assert.ok(distance >= path.radius - 1e-5 && !inTriangle(path.a, ...points) && !inTriangle(path.b, ...points),
      `${name}: a solid precinct face must not cover the ${path.id} movement corridor (clearance ${distance})`);
  }
}

test('all 95 castles have finite textured precincts whose actual triangles leave every approach route open', () => {
  let totalTriangles = 0, stoneCastles = 0;
  for (const castle of Game.castles) {
    const battle = battleFor(castle.id), before = JSON.stringify(battle), geometries = new Set();
    const result = Precincts.create(Three, { battle, materials, heightAt, trackGeometry: geometry => geometries.add(geometry) });
    assert.ok(result?.group.isGroup, `${castle.id}: precinct construction succeeds`);
    const paths = pathSegments(battle.layout);
    let triangles = 0, meshes = 0;
    result.group.updateMatrixWorld(true);
    result.group.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      const geometry = object.geometry, position = geometry.attributes.position;
      assert.ok(geometries.has(geometry), 'every precinct geometry is owned by the parent renderer');
      for (const [name, attribute] of Object.entries(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), `${castle.id}: finite ${name}`);
      assert.ok(position.count > 0);
      assert.equal(geometry.attributes.normal?.count, position.count);
      assert.equal(geometry.attributes.uv?.count, position.count, 'masonry and earth keep complete texture coordinates');
      geometry.computeBoundingSphere(); assert.ok(Number.isFinite(geometry.boundingSphere.radius));
      const points = Array.from({ length: position.count }, (_, index) => object.localToWorld(new Three.Vector3(position.getX(index), position.getY(index), position.getZ(index))));
      const indices = geometry.index?.array || Array.from({ length: points.length }, (_, index) => index);
      triangles += indices.length / 3;
      for (let index = 0; index < indices.length; index += 3) {
        assertTriangleClearsPaths([points[indices[index]], points[indices[index + 1]], points[indices[index + 2]]], paths, `${castle.id}/${object.name}`);
      }
    });
    assert.equal(meshes, result.stats.meshes);
    assert.equal(triangles, result.stats.triangles);
    assert.ok(meshes > 0, `${castle.id}: visible precinct surfaces exist`);
    assert.ok(meshes <= 2600 && triangles <= 54000, `${castle.id}: precinct detail stays within its separate geometry budget`);
    assert.equal(result.stats.labels, result.labels.length);
    assert.ok(result.labels.length > 0 && result.labels.length <= battle.layout.baileys.length, `${castle.id}: labels describe existing baileys only`);
    assert.equal(new Set(result.labels.map(label => label.baileyId)).size, result.labels.length, `${castle.id}: each real precinct has at most one label`);
    assert.equal(new Set(result.labels.map(label => label.name)).size, result.labels.length, `${castle.id}: displayed labels are distinct`);
    for (const label of result.labels) {
      assert.ok([label.x, label.y, label.z].every(Number.isFinite));
      assert.ok(battle.layout.baileys.some(bailey => bailey.id === label.baileyId), `${castle.id}: label references a real castle precinct`);
    }
    if (castle.profile.wall === 'stone') {
      stoneCastles++;
      assert.ok(result.stats.stoneSegments > 0, `${castle.id}: its stone-walled profile produces masonry`);
    }
    assert.equal(JSON.stringify(battle), before, `${castle.id}: decoration cannot change paths, gates, HP, troops or capture zones`);
    totalTriangles += triangles;
    for (const geometry of geometries) geometry.dispose();
  }
  assert.ok(totalTriangles > 1000 && stoneCastles > 0, 'exercise substantial earth and masonry geometry');
});

test('precincts follow the ground instead of adding floating platforms, and label only existing unique baileys', () => {
  for (const id of ['nanao', 'inabayama', 'odawara', 'kiyosu', 'shuri']) {
    const battle = battleFor(id), before = JSON.stringify(battle), geometries = new Set();
    const result = Precincts.create(Three, { battle, materials, heightAt, trackGeometry: geometry => geometries.add(geometry) });
    result.group.updateMatrixWorld(true);
    let groundedSlopes = 0;
    result.group.traverse(object => {
      if (object.name !== 'precinct-earth-slope') return;
      const position = object.geometry.attributes.position;
      let contact = Infinity;
      for (let index = 0; index < position.count; index++) {
        const point = object.localToWorld(new Three.Vector3(position.getX(index), position.getY(index), position.getZ(index)));
        contact = Math.min(contact, Math.abs(point.y - heightAt(point.x, point.z) - .035));
      }
      assert.ok(contact < 1e-4, `${id}: the lower edge touches its real terrain`);
      groundedSlopes++;
    });
    assert.ok(groundedSlopes > 0, `${id}: sloped earth foundations remain visible`);
    assert.ok(result.labels.length > 0 && result.labels.length <= battle.layout.baileys.length);
    assert.equal(new Set(result.labels.map(label => label.name)).size, result.labels.length, `${id}: labels are not repeated`);
    assert.equal(new Set(result.labels.map(label => label.baileyId)).size, result.labels.length, `${id}: each label identifies a different real bailey`);
    for (const label of result.labels) {
      assert.ok([label.x, label.y, label.z].every(Number.isFinite));
      const original = battle.layout.baileys.find(bailey => (bailey.id || bailey.name) === label.baileyId);
      assert.ok(original, `${id}: the named bailey exists in the real movement layout`);
      assert.equal(label.originalName, original.name || original.id);
    }
    assert.ok(result.labels.some(label => label.name.includes('本丸')), `${id}: the principal bailey is identifiable`);
    assert.equal(JSON.stringify(battle), before, 'label construction preserves the siege');
    for (const geometry of geometries) geometry.dispose();
  }
});

test('breached production castle gates stay visually open when precinct masonry is present', () => {
  for (const id of ['nanao', 'kiyosu', 'odawara']) {
    const battle = battleFor(id), geometries = new Set(), scene = new Three.Group();
    const precincts = Precincts.create(Three, { battle, materials, heightAt: () => 0, trackGeometry: geometry => geometries.add(geometry) });
    scene.add(precincts.group);
    for (const structure of battle.structures.filter(item => item.kind === 'gate')) {
      structure.hp = 0;
      const model = context.TenkaCastleModels.createStructure(Three, { structure, battle, materials, heightAt: () => 0, trackGeometry: geometry => geometries.add(geometry) });
      model.group.position.set(structure.x, 0, structure.z); model.group.rotation.y = -structure.rotation;
      model.door.rotation.x = -1.45; scene.add(model.group); scene.updateMatrixWorld(true);
      for (const x of [-.6, 0, .6]) {
        const from = model.group.localToWorld(new Three.Vector3(x, 1, -1.8));
        const to = model.group.localToWorld(new Three.Vector3(x, 1, 1.8));
        const direction = to.clone().sub(from).normalize();
        const ray = new Three.Raycaster(from, direction, 0, 3.6);
        assert.equal(ray.intersectObjects([precincts.group, model.group], true).length, 0, `${id}/${structure.id}: masonry cannot reseal a breached gate`);
      }
      scene.remove(model.group);
    }
    for (const geometry of geometries) geometry.dispose();
  }
});
