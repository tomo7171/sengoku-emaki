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
    if ((battle.units || []).some(unit => Math.hypot(x - unit.x, z - unit.z) < radius + 3.4)) return false;
    return true;
  }

  function plan({ battle = {}, layout = battle.layout || {}, heightAt = () => 0, waterAt } = {}) {
    const bounds = boundsOf(layout), random = randomFor(`${layout.id || battle.targetId || "battle"}:landscape-v2`);
    const mountain = ["mountain", "hill"].includes(layout.biome || battle.targetCastle?.terrain);
    const trees = [], rocks = [], grasses = [], ridges = [];
    const treeLimit = mountain ? 118 : 86;
    for (let index = 0; index < 1600 && trees.length < treeLimit; index++) {
      const x = bounds.minX + 3 + random() * (bounds.maxX - bounds.minX - 6);
      const z = bounds.minZ + 2 + random() * (bounds.maxZ - bounds.minZ - 4);
      // Preserve the broad central view of the castle, as well as the actual
      // footpaths. Trees frame the flanks and rear instead of hiding the gates.
      if (Math.abs(x) < 18 || (z > 4 && Math.abs(x) < 26)) continue;
      const size = .72 + random() * .63, radius = 1.8 * size;
      if (!clearOfFeatures(layout, battle, x, z, radius, waterAt)) continue;
      if (trees.some(tree => Math.hypot(x - tree.x, z - tree.z) < (tree.size + size) * 1.5)) continue;
      const y = heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      trees.push({ x, y, z, size, angle: random() * Math.PI * 2, tint: random(), kind: random() < (mountain ? .55 : .24) ? "cedar" : "broadleaf" });
    }
    for (let index = 0; index < 380 && rocks.length < 56; index++) {
      const x = bounds.minX + 2 + random() * (bounds.maxX - bounds.minX - 4), z = bounds.minZ + 2 + random() * (bounds.maxZ - bounds.minZ - 4);
      if (Math.abs(x) < 19 || !clearOfFeatures(layout, battle, x, z, .65, waterAt)) continue;
      const y = heightAt(x, z);
      if (Number.isFinite(y)) rocks.push({ x, y, z, size: .28 + random() * .62, angle: random() * Math.PI * 2, tint: random() });
    }
    for (const tree of trees) for (let index = 0; index < 3; index++) {
      const angle = random() * Math.PI * 2, radius = 1 + random() * 2;
      const x = tree.x + Math.cos(angle) * radius, z = tree.z + Math.sin(angle) * radius;
      if (!clearOfFeatures(layout, battle, x, z, .3, waterAt)) continue;
      const y = heightAt(x, z);
      if (Number.isFinite(y)) grasses.push({ x, y, z, size: .32 + random() * .6, angle, tint: random() });
    }
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
    return { trees, rocks, grasses, ridges, bounds };
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
      for (let index = 0; index < 3; index++) {
        const direction = angle + index * Math.PI * 2 / 3;
        roots.push({ x: x + Math.sin(direction) * size * .19, y: y + .2 * size, z: z + Math.cos(direction) * size * .19, angle: direction, rx: .72, sx: .13 * size, sy: .85 * size, sz: .12 * size });
      }
      if (cedar) {
        for (let level = 0; level < 5; level++) {
          const width = (1.52 - level * .26) * size;
          cedarWhorls.push({ x, y: y + (1.8 + level * .64) * size, z, angle: angle + level * .73, sx: width, sy: (1.1 - level * .07) * size, sz: width, color: tinted("#314c35", "#69805a", tree.tint * .65 + level * .055) });
        }
      } else {
        for (let index = 0; index < 5; index++) {
          const direction = angle + index * Math.PI * 2 / 5, offset = (index === 4 ? .16 : .76) * size;
          const top = y + height * (index === 4 ? 1.1 : .83 + (index % 2) * .17);
          crowns.push({ x: x + Math.sin(direction) * offset, y: top, z: z + Math.cos(direction) * offset, angle: direction, sx: (1.12 + (index % 2) * .16) * size, sy: (1 + (index % 3) * .17) * size, sz: 1.04 * size, color: tinted("#405a35", "#84915b", clamp(tree.tint * .6 + index * .065, 0, 1)) });
          if (index < 3) branches.push({ x: x + Math.sin(direction) * .34 * size, y: y + height * .68, z: z + Math.cos(direction) * .34 * size, angle: direction, rx: .68, sx: .11 * size, sy: 1.5 * size, sz: .11 * size });
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
      stats: { trees: landscape.trees.length, rocks: landscape.rocks.length, grassClumps: landscape.grasses.length, drawCalls: meshes.length, decorativeOnly: true },
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
