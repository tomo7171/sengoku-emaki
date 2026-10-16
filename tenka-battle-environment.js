(function (root) {
  "use strict";

  // Decoration only. Neither this planner nor the Three scene builder changes
  // terrain heights, collision polygons, routes, or the recorded battle state.
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function randomFor(value) {
    let seed = 2166136261;
    for (const character of String(value)) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  function inside(x, z, polygon = []) {
    let result = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const [a, b] = polygon[index], [c, d] = polygon[previous];
      if ((b > z) !== (d > z) && x < ((c - a) * (z - b)) / (d - b) + a) result = !result;
    }
    return result;
  }
  function distanceToLine(x, z, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
  }
  function boundsOf(layout) {
    const bounds = layout?.bounds || {};
    return { minX: bounds.minX ?? bounds.xMin ?? -44, maxX: bounds.maxX ?? bounds.xMax ?? 44, minZ: bounds.minZ ?? bounds.zMin ?? -50, maxZ: bounds.maxZ ?? bounds.zMax ?? 42 };
  }
  function inRectangle(item, x, z, padding = 0) {
    const angle = item.rotation || 0, dx = x - item.x, dz = z - item.z;
    return Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) < (item.w ?? item.width ?? 0) / 2 + padding
      && Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)) < (item.d ?? item.depth ?? 0) / 2 + padding;
  }
  function localPoint(item, x, z) {
    const angle = item.rotation || 0;
    return [item.x + Math.cos(angle) * x - Math.sin(angle) * z, item.z + Math.sin(angle) * x + Math.cos(angle) * z];
  }
  function clearOfFeatures(layout, battle, x, z, radius, waterAt) {
    if (waterAt?.(x, z) || (layout.water || []).some(water => inside(x, z, water.polygon))) return false;
    // The outer crown must also clear a water bank, not merely its trunk.
    for (const [dx, dz] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      if (waterAt?.(x + dx, z + dz) || (layout.water || []).some(water => inside(x + dx, z + dz, water.polygon))) return false;
    }
    for (const path of layout.paths || []) for (let index = 1; index < (path.points || []).length; index++) {
      if (distanceToLine(x, z, path.points[index - 1], path.points[index]) < (path.width || 2) / 2 + radius + 1.1) return false;
    }
    for (const item of [...(battle.structures || layout.structures || []), ...(battle.fortifications || [])]) {
      const angle = (item.rotation || 0) * (String(item.id || "").startsWith("fieldwork-") ? Math.PI / 180 : 1);
      const dx = x - item.x, dz = z - item.z;
      if (Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) < (item.w ?? item.width ?? 2) / 2 + radius + 1.3
        && Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)) < (item.d ?? item.depth ?? 2) / 2 + radius + 1.3) return false;
      if ((item.kind || item.type) === "gate" && Math.abs(dx) < (item.w ?? item.width ?? 3) / 2 + radius + 3.5 && dz > -3 && dz < 12) return false;
    }
    for (const bailey of layout.baileys || []) {
      if (bailey.polygon ? inside(x, z, bailey.polygon) : Math.abs(x - bailey.x) < bailey.width / 2 + radius && Math.abs(z - bailey.z) < bailey.depth / 2 + radius) return false;
    }
    // Fields and inhabited yards use the authoritative world rectangles. Keep
    // their crops, buildings and access lanes clear of decorative vegetation.
    for (const field of layout.landscape?.fields || []) if (inRectangle(field, x, z, radius + 1)) return false;
    for (const settlement of layout.landscape?.settlements || []) {
      if (inRectangle(settlement, x, z, radius + 1.6)) return false;
      for (const house of settlement.houses || []) if (inRectangle(house, x, z, radius + 1.6)) return false;
    }
    if ((battle.units || []).some(unit => Math.hypot(x - unit.x, z - unit.z) < radius + 3.4)) return false;
    return true;
  }

  function plan({ battle = {}, layout = battle.layout || {}, heightAt = () => 0, waterAt } = {}) {
    const bounds = boundsOf(layout), random = randomFor(`${layout.id || battle.targetId || "battle"}:landscape-v2`);
    const mountain = ["mountain", "hill"].includes(layout.biome || battle.targetCastle?.terrain);
    const trees = [], rocks = [], grasses = [], ridges = [];
    const world = layout.landscape, wide = !!world?.version;
    const fields = (world?.fields || []).map(field => ({ ...field }));
    const settlements = (world?.settlements || []).map(settlement => ({ ...settlement, houses: (settlement.houses || []).map(house => ({ ...house })) }));
    const treeLimit = wide ? (mountain ? 220 : 190) : (mountain ? 118 : 86);
    for (let index = 0; index < (wide ? 4500 : 1600) && trees.length < treeLimit; index++) {
      const x = bounds.minX + 3 + random() * (bounds.maxX - bounds.minX - 6);
      const z = bounds.minZ + 2 + random() * (bounds.maxZ - bounds.minZ - 4);
      // Preserve the broad central view of the castle, as well as the actual
      // footpaths. Trees frame the flanks and rear instead of hiding the gates.
      if ((Math.abs(x) < 18 && (!wide || z > -55 && z < 42)) || (z > 4 && z < 42 && Math.abs(x) < 26)) continue;
      const forest = (world?.forests || []).find(region => region.polygon ? inside(x, z, region.polygon) : inRectangle(region, x, z));
      if (wide && world.forests?.length && !forest && random() > .42) continue;
      const size = .72 + random() * .63, radius = 1.8 * size;
      if (!clearOfFeatures(layout, battle, x, z, radius, waterAt)) continue;
      if (trees.some(tree => Math.hypot(x - tree.x, z - tree.z) < (tree.size + size) * 1.5)) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      trees.push({ x, y, z, size, angle: random() * Math.PI * 2, tint: random(), kind: forest?.kind === "cedar" || random() < (mountain ? .55 : .24) ? "cedar" : "broadleaf", distant: wide && Math.hypot(x, z + 25) > 65 });
    }
    for (let index = 0; index < (wide ? 700 : 380) && rocks.length < (wide ? 90 : 56); index++) {
      const x = bounds.minX + 2 + random() * (bounds.maxX - bounds.minX - 4), z = bounds.minZ + 2 + random() * (bounds.maxZ - bounds.minZ - 4);
      if (Math.abs(x) < 19 || !clearOfFeatures(layout, battle, x, z, .65, waterAt)) continue;
      const y = heightAt(x, z);
      if (Number.isFinite(y)) rocks.push({ x, y, z, size: .28 + random() * .62, angle: random() * Math.PI * 2, tint: random() });
    }
    for (const tree of trees) for (let index = 0; index < (tree.distant ? 2 : 3); index++) {
      const angle = random() * Math.PI * 2, radius = 1 + random() * 2;
      const x = tree.x + Math.cos(angle) * radius, z = tree.z + Math.sin(angle) * radius;
      if (!clearOfFeatures(layout, battle, x, z, .3, waterAt)) continue;
      const y = heightAt(x, z);
      if (Number.isFinite(y)) grasses.push({ x, y, z, size: .32 + random() * .6, angle, tint: random() });
    }
    // Expanded battlefields already provide true playable mountains and valleys.
    // Do not hide them beneath the old, uniform external background surface.
    if (wide) return { trees, rocks, grasses, ridges, fields, settlements, bounds, wide: true };
    // A coast's sea is rendered beyond its collision polygon. Keep the horizon
    // ridge on the opposite, inland side instead of floating over that sea.
    const sea = (layout.water || []).find(water => water.type === "sea");
    const seaCenterX = sea?.polygon?.reduce((sum, point) => sum + point[0], 0) / (sea?.polygon?.length || 1);
    const axis = sea ? "x" : "z", inland = sea ? (seaCenterX < (bounds.minX + bounds.maxX) / 2 ? 1 : -1) : -1;
    const fixed = axis === "z" ? bounds.minZ - 5 : (inland > 0 ? bounds.maxX + 5 : bounds.minX - 5);
    const start = (axis === "z" ? bounds.minX : bounds.minZ) - 6, end = (axis === "z" ? bounds.maxX : bounds.maxZ) + 6;
    const columns = 49, rows = 29, depth = 180, points = [];
    const hills = [{ along: -58, depth: 98, width: 48, length: 49, height: mountain ? 8 : 4 }, { along: 8, depth: 128, width: 55, length: 43, height: mountain ? 10 : 6 }, { along: 74, depth: 145, width: 57, length: 38, height: mountain ? 7 : 4 }];
    // A continuous, shallow heightfield joins the edge of the existing ground.
    // Rounded hills rise far behind the castle; no billboard or vertical skirt
    // can leave a floating, saw-toothed strip against the sky.
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const distance = row / (rows - 1) * depth, ratio = column / (columns - 1), expansion = distance * .65;
      const along = start - expansion + (end - start + expansion * 2) * ratio;
      const forwardAlong = start + (end - start) * ratio;
      const frontHeight = axis === "z" ? heightAt(forwardAlong, fixed) : heightAt(fixed, forwardAlong);
      const front = Number.isFinite(frontHeight) ? frontHeight : .18;
      const fade = (1 - Math.exp(-distance / 25)) * clamp((depth - distance) / 28, 0, 1);
      let height = -.35 + (front + .35) * Math.exp(-distance / 18);
      for (const hill of hills) height += hill.height * Math.exp(-(((along - hill.along) / hill.width) ** 2) - ((distance - hill.depth) / hill.length) ** 2) * fade;
      const outward = fixed + inland * distance;
      points.push(axis === "z" ? { x: along, z: outward, y: height } : { x: outward, z: along, y: height });
    }
    ridges.push({ layer: 0, axis, inland, columns, rows, points, reconstruction: "distant-heightfield" });
    return { trees, rocks, grasses, ridges, fields, settlements, bounds, wide: false };
  }

  function create(THREE, options = {}) {
    const required = ["Group", "Mesh", "InstancedMesh", "Object3D", "CylinderGeometry", "SphereGeometry", "BufferGeometry", "Float32BufferAttribute", "MeshStandardMaterial", "Color"];
    if (!required.every(name => typeof THREE?.[name] === "function") || !options.scene?.add) return null;
    const landscape = plan(options), group = new THREE.Group(), meshes = [], geometries = new Set(), materials = new Set();
    group.name = "tenka-detailed-battle-landscape";
    const geometry = value => { geometries.add(value); options.trackGeometry?.(value); return value; };
    const material = (color, extra = {}) => {
      const value = new THREE.MeshStandardMaterial({ color, roughness: .98, metalness: 0, ...extra });
      materials.add(value); options.trackMaterial?.(value); return value;
    };
    const mappedMaterial = (source, color, extra = {}) => material(color, source ? { map: source.map, bumpMap: source.bumpMap, bumpScale: source.bumpScale || .025, ...extra } : extra);
    const trunkMaterial = material("#61523b"), foliageMaterial = material("#ffffff"), stoneMaterial = material("#ffffff"), grassMaterial = material("#ffffff");
    const dummy = new THREE.Object3D();
    function instances(name, shape, surface, items, castShadow = true) {
      if (!items.length) return null;
      const mesh = new THREE.InstancedMesh(shape, surface, items.length);
      mesh.name = name; mesh.castShadow = castShadow; mesh.receiveShadow = true;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        dummy.position.set(item.x, item.y, item.z);
        dummy.rotation.set(item.rx || 0, item.angle || 0, item.rz || 0);
        dummy.scale.set(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1);
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
        if (item.color) mesh.setColorAt(index, new THREE.Color(item.color));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere?.(); group.add(mesh); meshes.push(mesh); return mesh;
    }
    function tinted(start, end, amount) {
      return new THREE.Color(start).lerp(new THREE.Color(end), amount).getHex();
    }
    const trunk = [], branches = [], crowns = [], cedarWhorls = [], roots = [];
    for (const tree of landscape.trees) {
      const { x, y, z, size, angle } = tree, cedar = tree.kind === "cedar", height = (cedar ? 5.2 : 3.7) * size;
      trunk.push({ x, y: y + height * .43, z, angle, sx: .2 * size, sy: height * .86, sz: .2 * size });
      for (let index = 0; index < (tree.distant ? 0 : 3); index++) {
        const direction = angle + index * Math.PI * 2 / 3;
        roots.push({ x: x + Math.sin(direction) * size * .19, y: y + .2 * size, z: z + Math.cos(direction) * size * .19, angle: direction, rx: .72, sx: .13 * size, sy: .85 * size, sz: .12 * size });
      }
      if (cedar) {
        for (let level = 0; level < (tree.distant ? 3 : 5); level++) {
          const tier = tree.distant ? level * 1.55 : level;
          const width = (1.52 - tier * .26) * size;
          cedarWhorls.push({ x, y: y + (1.8 + tier * .64) * size, z, angle: angle + level * .73, sx: width, sy: (1.1 - tier * .07) * size, sz: width, color: tinted("#314c35", "#69805a", tree.tint * .65 + tier * .055) });
        }
      } else {
        for (let index = 0; index < (tree.distant ? 3 : 5); index++) {
          const direction = angle + index * Math.PI * 2 / 5, offset = (index === 4 ? .16 : .76) * size;
          const top = y + height * (index === 4 ? 1.1 : .83 + (index % 2) * .17);
          crowns.push({ x: x + Math.sin(direction) * offset, y: top, z: z + Math.cos(direction) * offset, angle: direction, sx: (1.12 + (index % 2) * .16) * size, sy: (1 + (index % 3) * .17) * size, sz: 1.04 * size, color: tinted("#405a35", "#84915b", clamp(tree.tint * .6 + index * .065, 0, 1)) });
          if (index < 3 && !tree.distant) branches.push({ x: x + Math.sin(direction) * .34 * size, y: y + height * .68, z: z + Math.cos(direction) * .34 * size, angle: direction, rx: .68, sx: .11 * size, sy: 1.5 * size, sz: .11 * size });
        }
      }
    }
    const cylinder = geometry(new THREE.CylinderGeometry(.68, 1, 1, 7));
    instances("tree-trunks-and-visible-branches", cylinder, trunkMaterial, [...trunk, ...branches, ...roots]);
    // Irregular, smooth lobes replace the perfectly round or single-cone trees.
    const leafShape = geometry(new THREE.SphereGeometry(1, 9, 6));
    const leafPosition = leafShape.attributes.position;
    for (let index = 0; index < leafPosition.count; index++) {
      const x = leafPosition.getX(index), y = leafPosition.getY(index), z = leafPosition.getZ(index);
      const radial = 1 + Math.sin(x * 17.13 + z * 9.73 + y * 4.91) * .12 + Math.cos(z * 21.3 - y * 15.1) * .055;
      leafPosition.setXYZ(index, x * radial, y * radial, z * radial);
    }
    leafShape.computeVertexNormals();
    instances("five-lobed-broadleaf-crowns", leafShape, foliageMaterial, crowns);
    const needleVertices = [], needleIndices = [];
    for (let ring = 0; ring < 3; ring++) {
      const radius = ring === 0 ? .07 : ring === 1 ? 1 : .68, height = ring === 0 ? .85 : ring === 1 ? -.12 : -.25;
      for (let index = 0; index < 14; index++) {
        const angle = index / 14 * Math.PI * 2, ragged = index % 2 ? .78 : 1.04;
        needleVertices.push(Math.cos(angle) * radius * ragged, height + (index % 3) * .026, Math.sin(angle) * radius * ragged);
      }
    }
    for (let ring = 0; ring < 2; ring++) for (let index = 0; index < 14; index++) {
      const a = ring * 14 + index, b = ring * 14 + (index + 1) % 14;
      needleIndices.push(a, b, a + 14, b, b + 14, a + 14);
    }
    const needleShape = geometry(new THREE.BufferGeometry());
    needleShape.setAttribute("position", new THREE.Float32BufferAttribute(needleVertices, 3));
    needleShape.setIndex(needleIndices); needleShape.computeVertexNormals();
    instances("layered-japanese-cedar-branches", needleShape, foliageMaterial, cedarWhorls);
    const rockShape = geometry(new THREE.SphereGeometry(1, 6, 4)), rockPosition = rockShape.attributes.position;
    for (let index = 0; index < rockPosition.count; index++) {
      const x = rockPosition.getX(index), y = rockPosition.getY(index), z = rockPosition.getZ(index);
      rockPosition.setXYZ(index, x * (1 + Math.sin(y * 8 + z * 6) * .17), y * .67, z * (1 + Math.cos(x * 9 - y * 7) * .15));
    }
    rockShape.computeVertexNormals();
    instances("weathered-rocks-at-woodland-edge", rockShape, stoneMaterial, landscape.rocks.map(rock => ({ ...rock, y: rock.y + rock.size * .15, sx: rock.size, sy: rock.size, sz: rock.size * .8, color: tinted("#676b5d", "#979580", rock.tint) })));
    const blades = [];
    for (let index = 0; index < 4; index++) {
      const angle = index * Math.PI / 4, x = Math.cos(angle) * .2, z = Math.sin(angle) * .2;
      blades.push(-x, 0, -z, x, 0, z, x * .65, .74 + (index % 2) * .2, z * .65);
    }
    const grassShape = geometry(new THREE.BufferGeometry());
    grassShape.setAttribute("position", new THREE.Float32BufferAttribute(blades, 3)); grassShape.computeVertexNormals();
    grassMaterial.side = 2;
    instances("sparse-grasses-under-trees", grassShape, grassMaterial, landscape.grasses.map(grass => ({ ...grass, sx: grass.size, sy: grass.size, sz: grass.size, color: tinted("#68734b", "#9b9b62", grass.tint) })), false);
    const terrainHeight = (x, z) => {
      const height = options.heightAt?.(x, z);
      return Number.isFinite(height) ? height : 0;
    };
    const surfacePatches = { paddy: [], dry: [], bank: [], canal: [] };
    function terrainQuad(field, x0, z0, x1, z1, surface, lift) {
      const points = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => {
        const [worldX, worldZ] = localPoint(field, x, z);
        return { x: worldX, y: terrainHeight(worldX, worldZ) + lift, z: worldZ, u: x / 3, v: z / 3 };
      });
      for (const index of [0, 2, 1, 1, 2, 3]) surface.push(points[index]);
    }
    function terrainStrip(field, x0, z0, x1, z1, surface, lift) {
      const length = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)), segments = Math.max(1, Math.ceil(length / 2));
      for (let index = 0; index < segments; index++) {
        if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) terrainQuad(field, x0 + (x1 - x0) * index / segments, z0, x0 + (x1 - x0) * (index + 1) / segments, z1, surface, lift);
        else terrainQuad(field, x0, z0 + (z1 - z0) * index / segments, x1, z0 + (z1 - z0) * (index + 1) / segments, surface, lift);
      }
    }
    const crops = [];
    for (const field of landscape.fields) {
      const w = field.w ?? field.width, depth = field.d ?? field.depth;
      if (!(w > 0 && depth > 0)) continue;
      const columns = Math.max(2, Math.ceil(w / 2.5)), rows = Math.max(2, Math.ceil(depth / 2.5));
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        terrainQuad(field, -w / 2 + w * column / columns, -depth / 2 + depth * row / rows, -w / 2 + w * (column + 1) / columns, -depth / 2 + depth * (row + 1) / rows, field.kind === "paddy" ? surfacePatches.paddy : surfacePatches.dry, .045);
      }
      for (const sign of [-1, 1]) {
        terrainStrip(field, -w / 2 - .18, sign * depth / 2 - .13, w / 2 + .18, sign * depth / 2 + .13, surfacePatches.bank, .15);
        terrainStrip(field, sign * w / 2 - .13, -depth / 2, sign * w / 2 + .13, depth / 2, surfacePatches.bank, .15);
      }
      // Shallow irrigation channels follow the same terrain as the field banks.
      terrainStrip(field, -w / 2 - .64, -depth / 2, -w / 2 - .3, depth / 2, surfacePatches.canal, .065);
      if (field.kind === "paddy") terrainStrip(field, -w / 2 - .64, depth / 2 + .3, w / 2, depth / 2 + .62, surfacePatches.canal, .065);
      const cropColumns = Math.min(15, Math.max(4, Math.round(w / 1.12))), cropRows = Math.min(15, Math.max(4, Math.round(depth / 1.35)));
      for (let row = 0; row < cropRows; row++) for (let column = 0; column < cropColumns; column++) {
        const lx = -w / 2 + (column + .5) * w / cropColumns, lz = -depth / 2 + (row + .5) * depth / cropRows;
        const [x, z] = localPoint(field, lx, lz), tint = ((row * 7 + column * 3) % 17) / 17;
        const item = { x, y: terrainHeight(x, z) + .055, z, angle: field.rotation || 0, sx: field.kind === "paddy" ? .45 : .48, sy: field.kind === "paddy" ? .68 : .33, sz: .45, color: tinted(field.kind === "paddy" ? "#66883c" : "#586a32", field.kind === "paddy" ? "#c1b65b" : "#9c9e50", tint) };
        crops.push(item);
      }
      if (field.kind !== "paddy") for (let row = 1; row < cropRows; row++) terrainStrip(field, -w / 2 + .35, -depth / 2 + row * depth / cropRows - .1, w / 2 - .35, -depth / 2 + row * depth / cropRows + .1, surfacePatches.bank, .1);
    }
    for (const [kind, points] of Object.entries(surfacePatches)) {
      if (!points.length) continue;
      const shape = geometry(new THREE.BufferGeometry());
      shape.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap(point => [point.x, point.y, point.z]), 3));
      shape.setAttribute("uv", new THREE.Float32BufferAttribute(points.flatMap(point => [point.u, point.v]), 2)); shape.computeVertexNormals();
      const surface = kind === "paddy" ? material("#82936e", { roughness: .3, metalness: .03 }) : kind === "canal" ? material("#668b86", { roughness: .26, metalness: .05 }) : mappedMaterial(options.materials?.earth, kind === "bank" ? "#b2a278" : "#907953");
      const mesh = new THREE.Mesh(shape, surface); mesh.name = `terrain-following-${kind}-fields`; mesh.receiveShadow = true; mesh.castShadow = false;
      group.add(mesh); meshes.push(mesh);
    }
    instances("ordered-rice-and-vegetable-crops", grassShape, grassMaterial, crops, false);
    // One geometry per material covers every house in all settlements. Their
    // footprints and positions come directly from the movement-rule module.
    if (landscape.settlements.length) {
      let box;
      if (typeof THREE.BoxGeometry === "function") box = geometry(new THREE.BoxGeometry(1, 1, 1));
      else {
        box = geometry(new THREE.BufferGeometry());
        const positions = [], uv = [];
        const faces = [[[-.5, -.5, .5], [.5, -.5, .5], [-.5, .5, .5], [.5, .5, .5]], [[.5, -.5, -.5], [-.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5]], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, -.5], [-.5, .5, .5]], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, .5], [.5, .5, -.5]], [[-.5, .5, .5], [.5, .5, .5], [-.5, .5, -.5], [.5, .5, -.5]], [[-.5, -.5, -.5], [.5, -.5, -.5], [-.5, -.5, .5], [.5, -.5, .5]]];
        for (const face of faces) for (const index of [0, 1, 2, 1, 3, 2]) { positions.push(...face[index]); uv.push(index % 2, index < 2 ? 0 : 1); }
        box.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); box.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); box.computeVertexNormals();
      }
      const roof = geometry(new THREE.BufferGeometry()), roofPositions = [], roofUVs = [];
      const roofPoints = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [-.23, 1, 0], [.23, 1, 0]];
      for (const triangle of [[0, 4, 5], [0, 5, 1], [1, 5, 2], [2, 5, 4], [2, 4, 3], [3, 4, 0]]) for (const index of triangle) { const point = roofPoints[index]; roofPositions.push(...point); roofUVs.push(point[0] + .5, point[2] + .5 + point[1] * .3); }
      roof.setAttribute("position", new THREE.Float32BufferAttribute(roofPositions, 3)); roof.setAttribute("uv", new THREE.Float32BufferAttribute(roofUVs, 2)); roof.computeVertexNormals();
      const walls = [], plaster = [], thatch = [], woodRoofs = [], foundations = [], trim = [], openings = [];
      for (const settlement of landscape.settlements) for (const [index, house] of settlement.houses.entries()) {
        const w = house.w ?? house.width, depth = house.d ?? house.depth, h = house.height || 2.4, angle = -(house.rotation || 0);
        if (!(w > 0 && depth > 0)) continue;
        const groundSamples = [terrainHeight(house.x, house.z)];
        for (const padding of [0, .13]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const [x, z] = localPoint(house, sx * (w / 2 + padding), sz * (depth / 2 + padding));
          groundSamples.push(terrainHeight(x, z));
        }
        // A level living floor rests above the highest ground corner. Extend
        // the stone plinth into the lowest corner instead of burying one wall
        // and suspending the other wall on the hill-facing side of a village.
        const y = Math.max(...groundSamples), foundationTop = y + .19;
        const foundationHeight = Math.max(.3, foundationTop - Math.min(...groundSamples) + .08);
        const item = { x: house.x, y: y + h / 2 + .16, z: house.z, angle, sx: w, sy: h, sz: depth, color: tinted("#afa58a", "#ded5b8", (index % 4) / 4) };
        (settlement.kind === "town" && index % 3 === 0 ? plaster : walls).push(item);
        foundations.push({ ...item, y: foundationTop - foundationHeight / 2, sx: w + .26, sy: foundationHeight, sz: depth + .26 });
        const roofHeight = Math.min(w, depth) * (house.roof === "thatch" ? .6 : .38);
        (house.roof === "thatch" ? thatch : woodRoofs).push({ ...item, y: y + h + .12, sx: w + .8, sy: roofHeight, sz: depth + .8, color: tinted(house.roof === "thatch" ? "#9e8c60" : "#6b6b5c", house.roof === "thatch" ? "#c1ad78" : "#949183", (index % 5) / 5) });
        for (const sign of [-1, 1]) for (const lx of [-w / 2 + .12, w / 2 - .12]) {
          const [x, z] = localPoint(house, lx, sign * (depth / 2 + .025));
          trim.push({ x, y: y + h / 2 + .17, z, angle, sx: .13, sy: h, sz: .12 });
        }
        for (const sign of [-1, 1]) {
          const [x, z] = localPoint(house, 0, sign * (depth / 2 + .045));
          trim.push({ x, y: y + h * .24, z, angle, sx: w, sy: .14, sz: .12 });
          const [wx, wz] = localPoint(house, w * .24, sign * (depth / 2 + .075));
          openings.push({ x: wx, y: y + h * .64 + .16, z: wz, angle, sx: Math.min(.8, w * .21), sy: h * .28, sz: .045 });
        }
        const [doorX, doorZ] = localPoint(house, -w * .17, depth / 2 + .08);
        openings.push({ x: doorX, y: y + h * .32 + .16, z: doorZ, angle, sx: Math.min(.95, w * .24), sy: h * .64, sz: .05 });
      }
      instances("settlement-wooden-house-walls", box, mappedMaterial(options.materials?.wood, "#ffffff"), walls);
      instances("town-white-earth-plaster-walls", box, mappedMaterial(options.materials?.plaster, "#ffffff"), plaster);
      instances("settlement-stone-foundations", box, mappedMaterial(options.materials?.stone, "#a6a28f"), foundations);
      instances("settlement-timber-posts-and-rails", box, mappedMaterial(options.materials?.wood, "#6f5b3d"), trim);
      instances("settlement-dark-openings", box, material("#3b3930"), openings, false);
      instances("village-deep-thatched-hip-roofs", roof, mappedMaterial(options.materials?.wood, "#ffffff", { side: 2 }), thatch);
      instances("town-weathered-wooden-hip-roofs", roof, mappedMaterial(options.materials?.roof, "#ffffff", { side: 2 }), woodRoofs);
    }
    for (const ridge of landscape.ridges) {
      const vertices = [], indices = [];
      for (const point of ridge.points) vertices.push(point.x, point.y, point.z);
      for (let row = 0; row < ridge.rows - 1; row++) for (let column = 0; column < ridge.columns - 1; column++) {
        const a = row * ridge.columns + column, b = a + ridge.columns;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const shape = geometry(new THREE.BufferGeometry());
      shape.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); shape.setIndex(indices); shape.computeVertexNormals();
      const mesh = new THREE.Mesh(shape, material("#a1adb0", { side: 2 }));
      mesh.name = "distant-inland-rolling-hills"; mesh.receiveShadow = false; mesh.castShadow = false;
      group.add(mesh); meshes.push(mesh);
    }
    options.scene.add(group);
    let disposed = false;
    return {
      group, meshes,
      stats: { trees: landscape.trees.length, rocks: landscape.rocks.length, grassClumps: landscape.grasses.length, fields: landscape.fields.length, houses: landscape.settlements.reduce((sum, settlement) => sum + settlement.houses.length, 0), drawCalls: meshes.length, decorativeOnly: true },
      dispose() {
        if (disposed) return; disposed = true;
        if (group.removeFromParent) group.removeFromParent(); else options.scene.remove?.(group);
        // The parent renderer owns GPU disposal when its trackers are supplied.
        if (!options.trackGeometry) for (const item of geometries) item.dispose?.();
        if (!options.trackMaterial) for (const item of materials) item.dispose?.();
        if (!options.trackGeometry && !options.trackMaterial) for (const mesh of meshes) if (mesh.isInstancedMesh) mesh.dispose?.();
      },
    };
  }
  root.TenkaBattleEnvironment = Object.freeze({ create, plan });
})(typeof window !== "undefined" ? window : globalThis);
