'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, clone } = require('./helpers/game-runtime.cjs');
// Use the Three classes in the shipped bundle, not geometry mocks. The helper
// exposes them only inside this Node VM after removing the final React render.
const { Game, Three, context } = runtime({ three: true });
const Models = context.TenkaCastleModels;
const Environment = context.TenkaBattleEnvironment;
const initial = Game.newGame();
const materials = Object.fromEntries(['wood', 'darkWood', 'stone', 'earth', 'plaster', 'roof', 'iron']
  .map(name => [name, new Three.MeshStandardMaterial({ color: '#9b8a73' })]));

function battleFor(id) {
  const state = clone(initial), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => castle.id === target.neighbors[0]);
  state.playerClan = source.clan; state.alliances = [];
  if (source.clan === target.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  // Supply every real neighbor route, including sea routes, without changing
  // the target's production terrain, profile, castle layout or collision data.
  source.troops = 6000; source.coastal = true;
  state.armies[source.id].units = { ashigaru: 4000, navy: 2000, archer: 0, cavalry: 0, firearm: 0 };
  return Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege' });
}

function geometryIsFinite(geometry, label, requireUV = true) {
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  assert.ok(position?.count > 0, `${label}: vertices exist`);
  assert.equal(position.itemSize, 3, label);
  assert.equal(normal?.count, position.count, `${label}: every vertex has a normal`);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    assert.ok(attribute.array.every(Number.isFinite), `${label}: finite ${name}`);
  }
  if (requireUV) {
    assert.equal(geometry.attributes.uv?.count, position.count, `${label}: textured geometry keeps UVs`);
    assert.equal(geometry.attributes.uv.itemSize, 2, label);
  }
  if (geometry.index) assert.ok(geometry.index.array.every(index => index < position.count), `${label}: indices refer to real vertices`);
  geometry.computeBoundingSphere();
  assert.ok(Number.isFinite(geometry.boundingSphere.radius), `${label}: finite culling volume`);
  return (geometry.index?.count || position.count) / 3;
}

test('all 95 real castle layouts build finite textured architecture within a bounded geometry budget, preserving battle rules', () => {
  assert.equal(Game.castles.length, 95);
  const terrains = new Set(), kinds = new Set();
  for (const castle of Game.castles) {
    const battle = battleFor(castle.id), before = JSON.stringify(battle), geometries = new Set();
    let meshes = 0, triangles = 0;
    terrains.add(castle.terrain);
    for (const structure of battle.structures) {
      kinds.add(structure.kind);
      const model = Models.createStructure(Three, { structure, battle, materials, heightAt: (x, z) => .18 + .02 * x - .01 * z,
        trackGeometry: geometry => geometries.add(geometry) });
      assert.ok(model?.group.isGroup, `${castle.id}/${structure.id}: architecture is created`);
      model.group.updateMatrixWorld(true);
      model.group.traverse(object => {
        assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${structure.id}: finite placement`);
        if (object.isMesh) {
          meshes++; triangles += geometryIsFinite(object.geometry, `${castle.id}/${structure.id}`);
          assert.ok(geometries.has(object.geometry), 'the parent renderer can dispose every geometry');
        }
      });
    }
    // Raw meshes are batched by material by the renderer; bound geometric work
    // here so decorative masonry cannot silently balloon into millions of faces.
    assert.ok(meshes > 20 && meshes < 4500, `${castle.id}: bounded source meshes (${meshes})`);
    assert.ok(triangles < 60000, `${castle.id}: bounded castle triangles (${triangles})`);
    assert.equal(JSON.stringify(battle), before, `${castle.id}: visual construction leaves routes, collision, HP and units intact`);
    for (const geometry of geometries) geometry.dispose();
  }
  assert.deepEqual([...terrains].sort(), ['coast', 'hill', 'mountain', 'plain']);
  for (const kind of ['gate', 'hall', 'watchtower', 'palisade', 'wall', 'bridge']) assert.ok(kinds.has(kind), `exercise real ${kind} structures`);
});

test('castle gates have an actual traversable opening when their independently animated doors fall', () => {
  for (const id of ['nanao', 'kiyosu', 'odawara']) {
    const battle = battleFor(id), original = JSON.stringify(battle);
    for (const structure of battle.structures.filter(item => item.kind === 'gate')) {
      const geometries = new Set();
      const { group, door } = Models.createStructure(Three, { structure, battle, materials, trackGeometry: geometry => geometries.add(geometry) });
      assert.ok(door?.isGroup && door.parent === group, `${id}: doors remain independently animated`);
      const children = door.children.length;
      group.updateMatrixWorld(true);
      const ray = new Three.Raycaster(new Three.Vector3(.3, 1, -4), new Three.Vector3(0, 0, 1), 0, 8);
      assert.ok(ray.intersectObject(group, true).some(hit => {
        for (let object = hit.object; object; object = object.parent) if (object === door) return true;
        return false;
      }), `${id}: closed wooden leaves occupy the opening`);
      // This matches the renderer's existing breached-door rotation. The fixed
      // columns and lintel must not contain an invisible full-width box behind it.
      door.rotation.x = -1.45; group.updateMatrixWorld(true);
      for (const x of [-.6, 0, .6]) {
        ray.set(new Three.Vector3(x, 1, -4), new Three.Vector3(0, 0, 1));
        assert.equal(ray.intersectObject(group, true).length, 0, `${id}: a soldier-height ray crosses the breached gate at x=${x}`);
      }
      assert.equal(door.children.length, children, 'destroying the door does not rebuild or alter static architecture');
      assert.equal(JSON.stringify(battle), original, 'door animation does not change siege collision or capture rules');
      for (const geometry of geometries) geometry.dispose();
    }
  }
});

test('roofs have curved lit surfaces and rotated earthwork segments follow the actual ground plane', () => {
  const battle = battleFor('nanao'), hall = battle.structures.find(item => item.kind === 'hall');
  const model = Models.createStructure(Three, { structure: hall, battle, materials });
  const roofs = []; model.group.traverse(object => { if (object.name === 'castle-curved-roof') roofs.push(object); });
  assert.ok(roofs.length > 0);
  for (const roof of roofs) {
    const points = roof.geometry.attributes.position, center = [];
    for (let index = 0; index < points.count; index++) if (Math.abs(points.getX(index)) < 1e-5) center.push([points.getZ(index), points.getY(index)]);
    center.sort((a, b) => a[0] - b[0]);
    assert.ok(center.length > 7, 'roof profile has intermediate vertices');
    const peak = Math.max(...center.map(point => point[1])), eave = center[0][1];
    assert.ok(peak - eave > .5, 'ridge rises above the eaves');
    assert.ok(center.slice(1, 5).some((point, index) => Math.abs(center[index][1] - 2 * point[1] + center[index + 2][1]) > .001),
      'roof slopes curve instead of forming one flat pitched plane');
    assert.ok(roof.geometry.attributes.uv.array.some(value => value > 1), 'surface maps tile at architectural scale');
  }
  const structure = { id: 'rotated-slope', kind: 'palisade', x: 7, z: -14, width: 14, depth: .8, height: 2.2, rotation: Math.PI / 3 };
  const heightAt = (x, z) => .2 + x * .08 - z * .13;
  const sloped = Models.createStructure(Three, { structure, battle, materials, heightAt });
  sloped.group.position.set(structure.x, heightAt(structure.x, structure.z), structure.z);
  sloped.group.rotation.y = -structure.rotation; sloped.group.updateMatrixWorld(true);
  assert.ok(sloped.group.children.length > 20, 'wall has independently grounded segments');
  for (const segment of sloped.group.children) {
    const base = segment.children[0], points = base.geometry.attributes.position, bottom = new Three.Vector3();
    for (let index = 0; index < 4; index++) bottom.add(new Three.Vector3(points.getX(index), points.getY(index), points.getZ(index)));
    bottom.multiplyScalar(.25); base.localToWorld(bottom);
    assert.ok(Math.abs(bottom.y - heightAt(bottom.x, bottom.z)) < 1e-5, 'rotating a wall retains ground contact rather than floating or sinking');
  }
  for (const group of [model.group, sloped.group]) group.traverse(object => object.geometry?.dispose());
});

test('real landscape instances keep finite transforms and eight draw calls, then release their owned graphics once', () => {
  for (const id of ['nanao', 'inabayama', 'odawara', 'kiyosu', 'wakimoto']) {
    const battle = battleFor(id), before = JSON.stringify(battle), scene = new Three.Group(), sentinel = new Three.Group();
    scene.add(sentinel);
    const landscape = Environment.create(Three, { battle, scene, heightAt: (x, z) => .18 + Math.sin(x * .1) + Math.cos(z * .1) });
    const geometries = new Set(), surfaces = new Set(), instances = [], disposals = new Map();
    let draws = 0, triangles = 0;
    landscape.group.traverse(object => {
      if (!object.isMesh) return;
      draws++; geometries.add(object.geometry); surfaces.add(object.material);
      triangles += geometryIsFinite(object.geometry, `${id}/${object.name}`, false) * (object.isInstancedMesh ? object.count : 1);
      if (object.isInstancedMesh) {
        instances.push(object);
        assert.ok(object.instanceMatrix.array.every(Number.isFinite), 'every tree, rock and grass transform is finite');
        if (object.instanceColor) assert.ok(object.instanceColor.array.every(Number.isFinite));
      }
    });
    assert.equal(draws, landscape.stats.drawCalls);
    assert.ok(draws <= 8 && instances.length >= 4, `${id}: forest detail is instanced instead of one draw per tree`);
    assert.ok(triangles < 90000, `${id}: forest triangle budget (${triangles})`);
    for (const item of [...geometries, ...surfaces, ...instances]) {
      disposals.set(item, 0); item.addEventListener('dispose', () => disposals.set(item, disposals.get(item) + 1));
    }
    landscape.dispose(); landscape.dispose();
    assert.equal(scene.children.length, 1); assert.equal(scene.children[0], sentinel);
    assert.ok([...disposals.values()].every(value => value === 1), 'closing a battle releases each owned GPU resource exactly once');
    assert.equal(JSON.stringify(battle), before, 'graphics leave the playable battle intact');
  }
});
