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
const regionalExamples = ['kiyosu','inabayama','tsutsujigasaki','odawara','wakimoto','shuri','sannohe'];
const materials = Object.fromEntries(['wood', 'darkWood', 'stone', 'earth', 'plaster', 'roof', 'iron']
  .map(name => [name, new Three.MeshStandardMaterial({ color: '#9b8a73' })]));

// Keep published v1 geometry fixtures explicit while the live default moves to
// v2; regional tests opt in below so both generations remain covered.
function battleFor(id, battlefieldVersion = 1) {
  const state = clone(initial), target = state.castles.find(castle => castle.id === id);
  const source = state.castles.find(castle => castle.id === target.neighbors[0]);
  state.playerClan = source.clan; state.alliances = [];
  if (source.clan === target.clan) target.clan = source.clan === 'oda' ? 'saito' : 'oda';
  // Supply every real neighbor route, including sea routes, without changing
  // the target's production terrain, profile, castle layout or collision data.
  source.troops = 6000; source.coastal = true;
  state.armies[source.id].units = { ashigaru: 4000, navy: 2000, archer: 0, cavalry: 0, firearm: 0 };
  return Game.createBattle({ state, sourceId: source.id, targetId: id, mode: 'siege', battlefieldVersion });
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

const flatCross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function flatPointDistance(point,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dz);
}
const flatSegmentDistance = (a,b,c,d) => flatCross(a,b,c)*flatCross(a,b,d)<0 && flatCross(c,d,a)*flatCross(c,d,b)<0 ? 0
  : Math.min(flatPointDistance(a,c,d),flatPointDistance(b,c,d),flatPointDistance(c,a,b),flatPointDistance(d,a,b));
function flatInside(point,polygon) {
  let result=false;
  for(let index=0,previous=polygon.length-1;index<polygon.length;previous=index++) {
    const a=polygon[index],b=polygon[previous];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
function assertDryFootprint(corners,waters,label) {
  const edges=corners.map((point,index)=>[point,corners[(index+1)%corners.length]]);
  const samples=[...corners,...edges.map(([a,b])=>[(a[0]+b[0])/2,(a[1]+b[1])/2])];
  for(const water of waters) {
    assert.ok(!samples.some(point=>flatInside(point,water.polygon))&&!water.polygon.some(point=>flatInside(point,corners)),`${label}: corners and edge midpoints stay out of ${water.id||water.type}`);
    for(const [a,b] of edges) for(let edge=0;edge<water.polygon.length;edge++) {
      const c=water.polygon[edge],d=water.polygon[(edge+1)%water.polygon.length];
      assert.ok(flatSegmentDistance(a,b,c,d)>1e-5,`${label}: a water bank cannot cut through the footprint`);
    }
  }
}
function assertRoadClearance(corners,paths,label) {
  const edges=corners.map((point,index)=>[point,corners[(index+1)%corners.length]]);
  for(const path of paths) for(let part=1;part<path.points.length;part++) {
    const a=path.points[part-1],b=path.points[part];
    const separation=Math.min(...edges.map(([c,d])=>flatSegmentDistance(a,b,c,d)));
    assert.ok(separation>=path.width/2-.01&&!flatInside(a,corners)&&!flatInside(b,corners),`${label}: solid house walls must leave the ${path.id} road corridor open (${separation})`);
  }
}

test('all 95 real castle layouts build finite textured architecture within a bounded geometry budget, preserving battle rules', () => {
  assert.equal(Game.castles.length, 95);
  const terrains = new Set(), kinds = new Set();
  for (const castle of Game.castles) {
    const battle = battleFor(castle.id), before = JSON.stringify(battle), geometries = new Set();
    let meshes = 0, countrysideMeshes = 0, triangles = 0, principalBuildings = 0;
    terrains.add(castle.terrain);
    for (const structure of battle.structures) {
      kinds.add(structure.kind);
      const model = Models.createStructure(Three, { structure, battle, materials, heightAt: (x, z) => .18 + .02 * x - .01 * z,
        trackGeometry: geometry => geometries.add(geometry) });
      assert.ok(model?.group.isGroup, `${castle.id}/${structure.id}: architecture is created`);
      const architecture = model.group.userData;
      if (architecture.castleModel.principal) {
        principalBuildings++;
        const roofs = [];
        model.group.traverse(object => { if (object.name === 'castle-curved-roof') roofs.push(object); });
        assert.ok(architecture.storeys === 2 || architecture.storeys === 3, `${castle.id}: the main residence has two or three substantial levels`);
        assert.equal(roofs.length, architecture.storeys, `${castle.id}: every visible storey has a real roof surface`);
        const ridgeHeights = roofs.map(roof => {
          const positions = roof.geometry.attributes.position;
          return Math.max(...Array.from({length:positions.count}, (_, index) => positions.getY(index)));
        }).sort((left,right) => left-right);
        assert.ok(ridgeHeights.every((value,index) => index === 0 || value-ridgeHeights[index-1] > .8), `${castle.id}: upper roofs are vertically distinct`);
      }
      if (structure.kind === 'watchtower') assert.equal(architecture.architecture, 'enclosed-double-turret');
      if (structure.kind === 'gate') assert.equal(architecture.architecture, 'fortified-yagura-gate');
      model.group.updateMatrixWorld(true);
      model.group.traverse(object => {
        assert.ok(object.matrixWorld.elements.every(Number.isFinite), `${structure.id}: finite placement`);
        if (object.isMesh) {
          meshes++; triangles += geometryIsFinite(object.geometry, `${castle.id}/${structure.id}`);
          if (structure.landscape) countrysideMeshes++;
          assert.ok(geometries.has(object.geometry), 'the parent renderer can dispose every geometry');
        }
      });
    }
    // Raw meshes are batched by material by the renderer; bound geometric work
    // here so decorative masonry cannot silently balloon into millions of faces.
    assert.ok(meshes-countrysideMeshes > 20 && meshes-countrysideMeshes < 4500, `${castle.id}: bounded castle source meshes (${meshes-countrysideMeshes})`);
    assert.ok(countrysideMeshes < 400, `${castle.id}: the four countryside crossings have a separate bounded geometry cost (${countrysideMeshes})`);
    assert.ok(triangles < 60000, `${castle.id}: bounded castle triangles (${triangles})`);
    assert.ok(principalBuildings > 0 && principalBuildings <= 2, `${castle.id}: a defined principal residence anchors the castle`);
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
  assert.ok(sloped.group.children.length > 10, 'thick defensive wall has independently grounded segments');
  for (const segment of sloped.group.children) {
    const base = segment.children[0], points = base.geometry.attributes.position, bottom = new Three.Vector3();
    for (let index = 0; index < 4; index++) bottom.add(new Three.Vector3(points.getX(index), points.getY(index), points.getZ(index)));
    bottom.multiplyScalar(.25); base.localToWorld(bottom);
    assert.ok(Math.abs(bottom.y - heightAt(bottom.x, bottom.z)) < 1e-5, 'rotating a wall retains ground contact rather than floating or sinking');
  }
  for (const group of [model.group, sloped.group]) group.traverse(object => object.geometry?.dispose());
});

test('legacy, wide and regional landscapes keep finite textured batches within their separate budgets and release owned graphics once', () => {
  for (const battlefieldVersion of [0, 1, 2]) for (const id of battlefieldVersion===2?regionalExamples:['nanao', 'inabayama', 'odawara', 'kiyosu', 'wakimoto']) {
    const battle = battleFor(id, battlefieldVersion), before = JSON.stringify(battle), scene = new Three.Group(), sentinel = new Three.Group();
    scene.add(sentinel);
    const landscape = Environment.create(Three, { battle, scene, heightAt: (x, z) => .18 + Math.sin(x * .1) + Math.cos(z * .1) });
    const geometries = new Set(), surfaces = new Set(), instances = [], disposals = new Map();
    let draws = 0, triangles = 0;
    landscape.group.traverse(object => {
      if (!object.isMesh) return;
      draws++; geometries.add(object.geometry); surfaces.add(object.material);
      const textured = object.name.startsWith('terrain-following-') || object.name.includes('house-walls')
        || object.name.includes('earth-plaster-walls') || object.name.includes('-hip-roofs');
      triangles += geometryIsFinite(object.geometry, `${id}/${object.name}`, textured) * (object.isInstancedMesh ? object.count : 1);
      if (object.isInstancedMesh) {
        instances.push(object);
        assert.ok(object.instanceMatrix.array.every(Number.isFinite), 'every tree, rock and grass transform is finite');
        if (object.instanceColor) assert.ok(object.instanceColor.array.every(Number.isFinite));
      }
    });
    assert.equal(draws, landscape.stats.drawCalls);
    const wide = !!battle.layout.landscape?.version;
    assert.equal(wide, battlefieldVersion > 0);
    assert.ok(draws <= (wide ? 24 : 8) && instances.length >= 4, `${id}: countryside detail is batched instead of one draw per tree or house (${draws})`);
    assert.ok(triangles < (wide ? 150000 : 90000), `${id}: ${wide?'wide':'legacy'} landscape triangle budget (${triangles})`);
    if (wide) {
      assert.equal(landscape.stats.fields, battle.layout.landscape.fields.length);
      assert.equal(landscape.stats.houses, battle.layout.landscape.settlements.reduce((sum, settlement) => sum + settlement.houses.length, 0));
    }
    if(battlefieldVersion===2) {
      assert.equal(landscape.stats.regionalProfile,battle.layout.landscape.profile.id,'the rendered environment uses the real castle regional profile');
      assert.equal(landscape.group.userData.regionalLandscape.id,battle.layout.landscape.profile.id);
    }
    for (const item of [...geometries, ...surfaces, ...instances]) {
      disposals.set(item, 0); item.addEventListener('dispose', () => disposals.set(item, disposals.get(item) + 1));
    }
    landscape.dispose(); landscape.dispose();
    assert.equal(scene.children.length, 1); assert.equal(scene.children[0], sentinel);
    assert.ok([...disposals.values()].every(value => value === 1), 'closing a battle releases each owned GPU resource exactly once');
    assert.equal(JSON.stringify(battle), before, 'graphics leave the playable battle intact');
  }
});

test('rendered village walls match their authoritative houses and leave roads, rivers and initial troops clear', () => {
  const distance=flatPointDistance,inside=flatInside;
  for (const battlefieldVersion of [1,2]) for (const id of battlefieldVersion===2?regionalExamples:['nanao','odawara','wakimoto']) {
    const battle=battleFor(id,battlefieldVersion),before=JSON.stringify(battle),scene=new Three.Group();
    const ground=(x,z)=>.18+context.TenkaBattlefield.elevationDelta(battle.layout,x,z);
    const landscape=Environment.create(Three,{battle,scene,heightAt:ground});
    const houses=battle.layout.landscape.settlements.flatMap(settlement=>settlement.houses),seen=new Set();
    scene.updateMatrixWorld(true);
    const foundationMesh=landscape.meshes.find(item=>item.name==='settlement-stone-foundations');
    assert.equal(foundationMesh?.count,houses.length,'every hillside house has a matching foundation');
    foundationMesh.geometry.computeBoundingBox();
    const foundations=Array.from({length:foundationMesh.count},(_,index)=>{
      const matrix=new Three.Object3D().matrix;foundationMesh.getMatrixAt(index,matrix);
      const center=new Three.Vector3().applyMatrix4(matrix).applyMatrix4(foundationMesh.matrixWorld);
      const bottom=new Three.Vector3(0,foundationMesh.geometry.boundingBox.min.y,0).applyMatrix4(matrix).applyMatrix4(foundationMesh.matrixWorld).y;
      const top=new Three.Vector3(0,foundationMesh.geometry.boundingBox.max.y,0).applyMatrix4(matrix).applyMatrix4(foundationMesh.matrixWorld).y;
      return {center,bottom,top};
    });
    for(const mesh of landscape.meshes.filter(item=>['settlement-wooden-house-walls','town-white-earth-plaster-walls'].includes(item.name))) {
      mesh.geometry.computeBoundingBox();
      const bounds=mesh.geometry.boundingBox,matrix=new Three.Object3D().matrix;
      for(let index=0;index<mesh.count;index++) {
        mesh.getMatrixAt(index,matrix);
        const center=new Three.Vector3().applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);
        const house=houses.find(item=>Math.hypot(item.x-center.x,item.z-center.z)<1e-4);
        assert.ok(house,`${id}: every rendered wall has an authoritative house footprint`);
        assert.equal(seen.has(house.id),false,'a house is rendered exactly once');seen.add(house.id);
        const corners=[[bounds.min.x,bounds.min.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z],[bounds.min.x,bounds.max.z]]
          .map(([x,z])=>{const point=new Three.Vector3(x,0,z).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld);return [point.x,point.z]});
        const expected=[[-house.w/2,-house.d/2],[house.w/2,-house.d/2],[house.w/2,house.d/2],[-house.w/2,house.d/2]]
          .map(([x,z])=>[house.x+Math.cos(house.rotation||0)*x-Math.sin(house.rotation||0)*z,house.z+Math.sin(house.rotation||0)*x+Math.cos(house.rotation||0)*z]);
        assert.ok(corners.every(corner=>expected.some(point=>Math.hypot(point[0]-corner[0],point[1]-corner[1])<1e-4)),'rendered wall dimensions and rotation match the movement collider');
        const outer=[[-house.w/2-.13,-house.d/2-.13],[house.w/2+.13,-house.d/2-.13],[house.w/2+.13,house.d/2+.13],[-house.w/2-.13,house.d/2+.13]]
          .map(([x,z])=>[house.x+Math.cos(house.rotation||0)*x-Math.sin(house.rotation||0)*z,house.z+Math.sin(house.rotation||0)*x+Math.cos(house.rotation||0)*z]);
        const terrainSamples=[[house.x,house.z],...expected,...outer].map(([x,z])=>ground(x,z));
        const wallBottom=center.y-house.height/2,terrainMax=Math.max(...terrainSamples);
        assert.ok(wallBottom-terrainMax>.15&&wallBottom-terrainMax<.17,'level walls sit above the highest ground instead of sinking into a hillside');
        const footing=foundations.find(item=>Math.hypot(item.center.x-house.x,item.center.z-house.z)<1e-4);
        assert.ok(footing&&footing.top>=wallBottom-.001&&footing.top<wallBottom+.04,'the stone foundation reaches the level house floor');
        assert.ok(terrainSamples.every(height=>footing.bottom<height&&footing.top>height),'the foundation spans every ground sample rather than floating over lower corners');
        const edges=corners.map((point,edge)=>[point,corners[(edge+1)%corners.length]]);
        assertRoadClearance(corners,battle.layout.paths,`${id}/${house.id}`);
        assertDryFootprint(corners,battle.layout.water,`${id}/${house.id}`);
        for(const unit of battle.units) {
          const point=[unit.x,unit.z];
          assert.ok(!inside(point,corners)&&Math.min(...edges.map(([a,b])=>distance(point,a,b)))>1,`${id}: initial formations cannot spawn inside village walls`);
        }
      }
    }
    assert.equal(seen.size,houses.length,'all real houses have one matching rendered wall body');
    landscape.dispose();
    assert.equal(JSON.stringify(battle),before,'clearance verification and rendering do not move houses or soldiers');
  }
});

test('all 95 countryside plans keep every house and field footprint clear of both original and expanded water', () => {
  let coastal=0,footprints=0;
  for(const castle of Game.castles) {
    const battle=battleFor(castle.id),before=JSON.stringify(battle),world=battle.layout.landscape;
    assert.ok(world?.version,'test the live expanded countryside');
    if(castle.coastal)coastal++;
    for(const item of [...world.fields,...world.settlements.flatMap(settlement=>settlement.houses)]) {
      const w=(item.w??item.width)/2,d=(item.d??item.depth)/2,angle=item.rotation||0;
      const corners=[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>[item.x+Math.cos(angle)*x-Math.sin(angle)*z,item.z+Math.sin(angle)*x+Math.cos(angle)*z]);
      assertDryFootprint(corners,battle.layout.water,`${castle.id}/${item.id}`);
      footprints++;
    }
    assert.equal(JSON.stringify(battle),before);
  }
  assert.ok(coastal>10&&footprints>3000,'cover sea-facing castles and thousands of physical house/field footprints');
});

test('all 95 regional battlefields keep finite physical houses and fields within their own bounds and off every water surface', () => {
  const profiles=new Set();let footprints=0;
  for(const castle of Game.castles) {
    const battle=battleFor(castle.id,2),before=JSON.stringify(battle),world=battle.layout.landscape,box=battle.layout.bounds;
    assert.equal(battle.battlefieldVersion,2);
    assert.equal(world.version,2);
    assert.ok(world.profile?.id,`${castle.id}: its actual terrain has a named regional profile`);
    assert.equal(world.profile.region,castle.region);
    assert.equal(world.profile.province,castle.province);
    profiles.add(world.profile.id);
    const houses=world.settlements.flatMap(settlement=>settlement.houses),houseIds=new Set(houses.map(house=>house.id));
    for(const item of [...world.fields,...houses]) {
      const w=(item.w??item.width)/2,d=(item.d??item.depth)/2,angle=item.rotation||0;
      assert.ok([item.x,item.z,w,d,angle].every(Number.isFinite)&&w>0&&d>0,`${castle.id}/${item.id}: finite usable dimensions`);
      const corners=[[-w,-d],[w,-d],[w,d],[-w,d]].map(([x,z])=>[item.x+Math.cos(angle)*x-Math.sin(angle)*z,item.z+Math.sin(angle)*x+Math.cos(angle)*z]);
      assert.ok(corners.every(([x,z])=>x>=box.minX&&x<=box.maxX&&z>=box.minZ&&z<=box.maxZ),`${castle.id}/${item.id}: physical footprint lies inside the regional battlefield`);
      assertDryFootprint(corners,battle.layout.water,`regional ${castle.id}/${item.id}`);
      if(houseIds.has(item.id))assertRoadClearance(corners,battle.layout.paths,`regional ${castle.id}/${item.id}`);
      footprints++;
    }
    assert.equal(JSON.stringify(battle),before,'geometry checks never rewrite the regional battle');
  }
  assert.deepEqual([...profiles].sort(),['basin','coast','hill','mountain','northern-coast','plain','ryukyu']);
  assert.ok(footprints>5000,'validate thousands of added physical country houses and fields across every profile');
});
