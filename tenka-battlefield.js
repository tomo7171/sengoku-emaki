(function (root) {
  "use strict";

  // The castle's surveyed game plan stays at its original coordinates. The
  // surrounding countryside is a deterministic extension, not a scaled castle.
  const VERSION = 2;
  const LEGACY_BOUNDS = Object.freeze({ minX: -88, maxX: 88, minZ: -100, maxZ: 84, xMin: -88, xMax: 88, zMin: -100, zMax: 84 });
  const CORE = Object.freeze({ minX: -44, maxX: 44, minZ: -50, maxZ: 42 });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rect = (x, z, w, d) => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2]];
  const copy = value => JSON.parse(JSON.stringify(value));
  function inside(x, z, polygon = []) {
    let result = false;
    for (let i = 0, last = polygon.length - 1; i < polygon.length; last = i++) {
      const [a, b] = polygon[i], [c, d] = polygon[last];
      if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) result = !result;
    }
    return result;
  }
  function inFootprint(item, x, z, padding = 0) {
    const angle = item.rotation || 0, c = Math.cos(angle), s = Math.sin(angle), dx = x - item.x, dz = z - item.z;
    return Math.abs(dx * c + dz * s) <= (item.w ?? item.width) / 2 + padding && Math.abs(-dx * s + dz * c) <= (item.d ?? item.depth) / 2 + padding;
  }
  function gaussian(item, x, z) { return item.height * Math.exp(-(((x - item.x) / item.sx) ** 2 + ((z - item.z) / item.sz) ** 2)); }
  function elevationDelta(layout, x, z) {
    const landscape = layout?.landscape;
    if (!landscape) return 0;
    // An exact zero inside the old map preserves gate thresholds, terraces,
    // movement and battle replays. Outside it, the transition is continuous.
    const distance = Math.max(CORE.minX - x, x - CORE.maxX, CORE.minZ - z, z - CORE.maxZ, 0);
    if (!distance) return 0;
    const blend = clamp(distance / 12, 0, 1), smooth = blend * blend * (3 - 2 * blend);
    return smooth * [...landscape.peaks, ...landscape.valleys].reduce((height, item) => height + gaussian(item, x, z), 0);
  }
  function settlement(id, name, kind, x, z, columns, rows) {
    const houses = [];
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const hx = x + (column - (columns - 1) / 2) * 7, hz = z + (row - (rows - 1) / 2) * 8;
      houses.push({ id: `${id}-house-${houses.length}`, x: hx, z: hz, w: 3.7 + column % 2 * .5, d: 3.1 + row % 2 * .4, height: kind === "town" ? 3.2 : 2.7, rotation: row % 2 ? Math.PI : 0, roof: kind === "town" && column % 3 === 0 ? "wood" : "thatch" });
    }
    return { id, name, kind, x, z, w: columns * 7, d: rows * 8, houses };
  }
  function legacyPlan(battle) {
    const prefix = battle.targetId || battle.layout.id || "battle";
    const coastal = battle.layout.water.some(item => item.type === "sea");
    const peaks = [
      { id: "northwest-ridge", name: "北西の山稜", x: -71, z: -76, height: 22, sx: 17, sz: 22 },
      { id: "northeast-ridge", name: "北東の山稜", x: 72, z: -79, height: 18, sx: 18, sz: 20 },
      { id: "west-hill", name: "西の丘", x: -79, z: 48, height: 9, sx: 10, sz: 16 },
      { id: "south-ridge", name: "南東の丘陵", x: 78, z: 79, height: 7, sx: 15, sz: 12 },
    ];
    const valleys = [
      { id: "west-valley", name: "西の谷筋", x: -66, z: -25, height: -4.5, sx: 12, sz: 20 },
      { id: "east-valley", name: "東の谷筋", x: 51, z: -58, height: -3.5, sx: 12, sz: 16 },
    ];
    if (coastal) {
      Object.assign(peaks[0], { x: -4, z: -79, sx: 20, sz: 13 });
      Object.assign(peaks[2], { x: -23, z: 50, sx: 7, sz: 14 });
      Object.assign(valleys[0], { x: -18, z: -61, sx: 10, sz: 14 });
    }
    const seas = battle.layout.water.filter(item => item.type === "sea").map(item => {
      const shore = Math.max(...item.polygon.map(point => point[0]));
      return { ...copy(item), landscapeExpanded: true, polygon: [[LEGACY_BOUNDS.minX - 6, LEGACY_BOUNDS.minZ - 6], [shore, LEGACY_BOUNDS.minZ - 6], [shore, LEGACY_BOUNDS.maxZ + 6], [LEGACY_BOUNDS.minX - 6, LEGACY_BOUNDS.maxZ + 6]] };
    });
    const rivers = [{ id: `${prefix}-country-river`, type: "river", kind: "river", name: "城下の川", landscape: true, polygon: [[59, -100], [66, -100], [64, -70], [69, -40], [65, -10], [68, 20], [64, 48], [69, 84], [62, 84], [57, 48], [61, 20], [58, -10], [62, -40], [57, -70]] }];
    const crossings = [-72, -28, 24, 66].map((z, i) => ({ id: `${prefix}-country-crossing-${i}`, name: i % 2 ? "街道の橋" : "川の浅瀬", type: i % 2 ? "bridge" : "ford", x: 63, z, w: 22, d: i % 2 ? 9 : 12, rotation: 0 }));
    const roads = [
      { id: "western-highway", name: "西の街道", points: coastal ? [[26, 76], [26, 42], [20, 24], [20, 8]] : [[-51, -94], [-51, -45], [-51, 8], [-51, 72], [0, 76]], width: 3.2 },
      { id: "southern-highway", name: "城下の街道", points: coastal ? [[-26, 24], [0, 24], [52, 24], [68, 24], [68, 54]] : [[-82, 24], [-51, 24], [0, 24], [52, 24], [68, 24], [68, 54]], width: 3.4 },
      ...crossings.map((crossing, i) => ({ id: `river-crossing-road-${i}`, name: crossing.name, points: [[47, crossing.z], [79, crossing.z]], width: 2.6 })),
      { id: "town-lane", name: "城下町の小路", points: coastal ? [[20, 8], [51, 8]] : [[-82, 8], [-51, 8]], width: 1.7 },
      { id: "village-lane", name: "田畑の小路", points: coastal ? [[26, 75], [-3, 75]] : [[-51, 60], [-68.5, 60], [-68.5, 68]], width: 1.4 },
    ];
    const settlements = [
      settlement(`${prefix}-town`, "城下町", "town", coastal ? 35 : -66, 8, 4, 2),
      settlement(`${prefix}-west-village`, "街道の村", "village", coastal ? 9 : -65, coastal ? 75 : 68, 3, 2),
      settlement(`${prefix}-east-village`, "川向こうの村", "village", 76, 43, 2, 3),
    ];
    const fields = [];
    for (const group of [{ x: coastal ? 0 : -60, z: coastal ? 53 : 37, columns: 2, rows: 3 }, { x: 43, z: 57, columns: 3, rows: 3 }]) {
      for (let row = 0; row < group.rows; row++) for (let column = 0; column < group.columns; column++) fields.push({ id: `${prefix}-field-${fields.length}`, name: (row + column) % 3 ? "水田" : "畑", kind: (row + column) % 3 ? "paddy" : "dry", x: group.x + (column - (group.columns - 1) / 2) * 7, z: group.z + (row - (group.rows - 1) / 2) * 9, w: 6, d: 8, rows: 8, rotation: 0, crop: "rice" });
    }
    // Forest footprints are also exported as the combat's concealment areas.
    const forests = [
      { id: "southwest-wood", name: "南西の林", x: coastal ? -21 : -27, z: 22, w: 18, d: 18, radius: 9, kind: "mixed", density: .7 },
      { id: "northeast-wood", name: "北東の林", x: 25, z: -25, w: 18, d: 18, radius: 9, kind: "mixed", density: .7 },
      { id: "western-wood", name: "西の山林", x: coastal ? -14 : -74, z: coastal ? -78 : -69, w: 25, d: 32, radius: 12, kind: "cedar", density: .85 },
      { id: "eastern-wood", name: "東の山林", x: 77, z: -60, w: 18, d: 28, radius: 9, kind: "cedar", density: .8 },
    ];
    return { version: 1, coastal, bounds: { ...LEGACY_BOUNDS }, coreBounds: { ...CORE }, peaks, valleys, seas, rivers, crossings, roads, fields, settlements, forests, note: "城郭を囲む山谷・河川・街道・田畑・集落を表すゲーム用地形です。" };
  }
  function legacyApply(battle) {
    if (battle.battlefieldVersion === 1) return battle;
    const layout = battle.layout, landscape = legacyPlan(battle);
    layout.bounds = { ...LEGACY_BOUNDS };
    layout.landscape = landscape;
    layout.water = layout.water.map(item => item.type === "sea" ? copy(landscape.seas.find(sea => sea.id === item.id)) : item);
    layout.water.push(...copy(landscape.rivers));
    // Bridges/ford footprints are the same passable surfaces used by the core
    // engine and the countryside route planner. They are never objectives.
    for (const crossing of landscape.crossings) {
      const bridge = { ...copy(crossing), kind: "bridge", type: "bridge", style: crossing.type, width: crossing.w, depth: crossing.d, height: .28, h: .28, hp: 0, maxHp: 0, passable: true, landscape: true, polygon: rect(crossing.x, crossing.z, crossing.w, crossing.d) };
      layout.structures.push(copy(bridge));
      battle.structures.push(bridge);
    }
    layout.paths.push(...copy(landscape.roads));
    layout.deployment = {
      attacker: { xMin: -87, xMax: 87, zMin: 10, zMax: 83 },
      defender: { xMin: -87, xMax: 87, zMin: -99, zMax: -5 },
    };
    const features = battle.terrainFeatures || [];
    battle.terrainFeatures = [
      ...features.filter(item => item.type !== "forest"),
      ...landscape.forests.map(item => ({ type: "forest", ...copy(item) })),
      ...peaksAndValleys(landscape),
      ...landscape.settlements.map(item => ({ type: item.kind, name: item.name, x: item.x, z: item.z, radius: Math.max(item.w, item.d) / 2 })),
      { type: "river", name: "城下の川と橋・浅瀬", x: 63, z: 24, radius: 5 },
      { type: "field", name: "城下の田畑", x: 43, z: 57, radius: 13 },
    ];
    battle.battlefieldVersion = 1;
    return battle;
  }
  function peaksAndValleys(landscape) {
    return [...landscape.peaks.map(item => ({ type: "mountain", ...copy(item), radius: Math.max(item.sx, item.sz) })), ...landscape.valleys.map(item => ({ type: "valley", ...copy(item), radius: Math.max(item.sx, item.sz) }))];
  }
  const AREA = 176 * 184 * 10;
  const PROFILES = Object.freeze({
    plain: Object.freeze({ id: "plain", palette: { ground: "#9aa478", soil: "#b4a078" }, label: "沖積平野と水田の戦場", aspect: 1.2, relief: 10, forestDensity: .48, paddyShare: .85, treeKind: "mixed", riverWidth: 16, riverBend: 28 }),
    basin: Object.freeze({ id: "basin", palette: { ground: "#9aa478", soil: "#b4a078" }, label: "山に囲まれた盆地の戦場", aspect: .9, relief: 34, forestDensity: .68, paddyShare: .65, treeKind: "cedar", riverWidth: 11, riverBend: 18 }),
    mountain: Object.freeze({ id: "mountain", palette: { ground: "#899475", soil: "#8e8b75" }, label: "尾根と深い谷の山岳戦場", aspect: .82, relief: 46, forestDensity: .86, paddyShare: .35, treeKind: "cedar", riverWidth: 8, riverBend: 42 }),
    hill: Object.freeze({ id: "hill", palette: { ground: "#9aa478", soil: "#b4a078" }, label: "丘陵と街道の戦場", aspect: 1.1, relief: 25, forestDensity: .65, paddyShare: .55, treeKind: "mixed", riverWidth: 12, riverBend: 24 }),
    coast: Object.freeze({ id: "coast", palette: { ground: "#a6ab85", soil: "#bbb08e" }, label: "海岸・河口と港町の戦場", aspect: 1.28, relief: 20, forestDensity: .55, paddyShare: .5, treeKind: "pine", riverWidth: 17, riverBend: 32 }),
    "northern-coast": Object.freeze({ id: "northern-coast", palette: { ground: "#8d9c89", soil: "#969c8e" }, label: "北国の海岸と険しい山地の戦場", aspect: .85, relief: 32, forestDensity: .82, paddyShare: .45, treeKind: "cedar", riverWidth: 12, riverBend: 36 }),
    ryukyu: Object.freeze({ id: "ryukyu", palette: { ground: "#a3b57d", soil: "#c1b59b" }, label: "琉球の海岸と石灰岩丘陵の戦場", aspect: 1.4, relief: 24, forestDensity: .72, paddyShare: .15, treeKind: "broadleaf", riverWidth: 7, riverBend: 20 }),
  });
  function boundsFor(profile) {
    const width = Math.sqrt(AREA * profile.aspect), depth = AREA / width;
    return { minX: -width / 2, maxX: width / 2, minZ: -depth / 2 - 8, maxZ: depth / 2 - 8, xMin: -width / 2, xMax: width / 2, zMin: -depth / 2 - 8, zMax: depth / 2 - 8 };
  }
  function profileFor(battle) {
    const castle = battle.targetCastle || {}, region = castle.region || "", terrain = castle.terrain || "plain";
    const coastal = !!castle.coastal || battle.layout.water.some(item => item.type === "sea");
    const id = region === "琉球" ? "ryukyu" : coastal ? ["東北", "北陸", "蝦夷"].includes(region) ? "northern-coast" : "coast" : terrain === "mountain" ? "mountain" : ["甲信", "東山", "奥羽"].includes(region) || ["甲斐", "信濃", "飛騨"].includes(castle.province) ? "basin" : terrain === "hill" ? "hill" : "plain";
    return { ...PROFILES[id], region, province: castle.province || "", terrain };
  }
  function seedFor(value) {
    let seed = 2166136261;
    for (const character of value) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    return () => { seed = Math.imul(seed ^ seed >>> 15, 2246822519) >>> 0; seed = Math.imul(seed ^ seed >>> 13, 3266489917) >>> 0; return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
  }
  function footprintCorners(item, padding = 0) {
    const a = item.rotation || 0, c = Math.cos(a), s = Math.sin(a), w = item.w / 2 + padding, d = item.d / 2 + padding;
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [item.x + x * c - z * s, item.z + x * s + z * c]);
  }
  function segmentCrosses(a, b, c, d) {
    const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  }
  function wetFootprint(item, waters, padding = .9) {
    const corners = footprintCorners(item, padding);
    return waters.some(water => corners.some(([x, z]) => inside(x, z, water.polygon)) || water.polygon.some(([x, z]) => inFootprint(item, x, z, padding)) || corners.some((a, i) => water.polygon.some((c, j) => segmentCrosses(a, corners[(i + 1) % 4], c, water.polygon[(j + 1) % water.polygon.length]))));
  }
  function roadHitsHouse(road, house) {
    const corners = footprintCorners(house, road.width / 2 + .6);
    return road.points.slice(1).some((b, i) => {
      const a = road.points[i];
      return inside(a[0], a[1], corners) || inside(b[0], b[1], corners) || corners.some((c, j) => segmentCrosses(a, b, c, corners[(j + 1) % corners.length]));
    });
  }
  function regionalPlan(battle) {
    const world = legacyPlan(battle), profile = profileFor(battle), box = boundsFor(profile), prefix = battle.targetId || battle.layout.id || "battle", random = seedFor(`${prefix}:${profile.id}`);
    world.version = VERSION; world.bounds = box; world.profile = profile;
    world.coastal = !!battle.targetCastle?.coastal || world.coastal;
    // A few native castle plans end inland even though their province has a
    // coast. Place that sea beyond the old map rather than altering its core.
    if (world.coastal && !world.seas.length) world.seas.push({ id: `${prefix}-outer-sea`, type: "sea", name: "地域の海岸", landscape: true, landscapeExpanded: true, polygon: [[box.minX - 6, box.minZ - 6], [-105, box.minZ - 6], [-105, box.maxZ + 6], [box.minX - 6, box.maxZ + 6]] });
    // Different regions have a genuinely different battlefield footprint,
    // relief and river course. The historic castle itself is never stretched.
    world.peaks = world.peaks.map((peak, index) => ({ ...peak, height: peak.height * (.45 + profile.relief / 28), sx: peak.sx * (profile.id === "mountain" ? .9 : 1.35), sz: peak.sz * 1.2, x: peak.x + (random() - .5) * 12 }));
    world.valleys = world.valleys.map(valley => ({ ...valley, height: valley.height * (.6 + profile.relief / 40) }));
    const width = box.maxX - box.minX, depth = box.maxZ - box.minZ;
    for (let i = 0; i < 10; i++) {
      const angle = i / 10 * Math.PI * 2 + (random() - .5) * .3;
      let x = Math.cos(angle) * width * (.3 + random() * .12), z = -8 + Math.sin(angle) * depth * (.28 + random() * .13);
      if (world.coastal) x = Math.max(x, 12 + random() * 65);
      world.peaks.push({ id: `regional-ridge-${i}`, name: profile.id === "plain" ? "平野を縁どる丘" : "地域の山稜", x, z, height: profile.relief * (.55 + random() * .65), sx: width * (.04 + random() * .055), sz: depth * (.045 + random() * .07) });
      if (i % 2) world.valleys.push({ id: `regional-valley-${i}`, name: "山あいの谷", x: x - 20, z: z + 23, height: -profile.relief * .2, sx: 20 + random() * 16, sz: 32 + random() * 24 });
    }
    // Preserve the original coastal line at the castle, then let the outer
    // shoreline form headlands and coves instead of a uniform sea rectangle.
    world.seas = world.seas.map(sea => {
      const shore = Math.max(...sea.polygon.map(point => point[0])), bank = [];
      for (let z = box.minZ - 6; z <= box.maxZ + 6.001; z += (depth + 12) / 30) {
        const fade = clamp(Math.max(-100 - z, z - 84, 0) / 45, 0, 1);
        bank.push([shore + fade * Math.sin((z + 37) / 62) * (profile.id === "ryukyu" ? 28 : 18), z]);
      }
      bank.push([shore + Math.sin((box.maxZ + 43) / 62) * (profile.id === "ryukyu" ? 28 : 18), box.maxZ + 6]);
      return { ...sea, polygon: [[box.minX - 6, box.minZ - 6], ...bank, [box.minX - 6, box.maxZ + 6]] };
    });
    // The four near-castle crossings remain in place. Outside that approach,
    // each region's river bends, narrows into gorges or broadens into flats.
    const inner = [[62.5, -100, 7], [60.5, -70, 7], [65.5, -40, 7], [61.5, -10, 7], [64.5, 20, 7], [60.5, 48, 7], [65.5, 84, 7]];
    const riverPoints = [];
    for (let z = box.minZ; z < -100; z += 26) riverPoints.push([63 + Math.sin((z + 19) / 57) * profile.riverBend, z, profile.riverWidth]);
    riverPoints.push(...inner);
    for (let z = 110; z < box.maxZ; z += 26) riverPoints.push([63 + Math.sin((z + 19) / 57) * profile.riverBend, z, profile.riverWidth]);
    riverPoints.push([63 + Math.sin((box.maxZ + 19) / 57) * profile.riverBend, box.maxZ, profile.riverWidth]);
    const polygon = [...riverPoints.map(([x, z, w]) => [x - w / 2, z]), ...riverPoints.slice().reverse().map(([x, z, w]) => [x + w / 2, z])];
    world.rivers = [{ ...world.rivers[0], name: profile.id === "mountain" ? "山あいの渓流" : world.coastal ? "港へ注ぐ川" : "平野を流れる川", polygon }];
    const outerCrossings = [riverPoints[2], riverPoints[riverPoints.length - 3]].map(([x, z, w], index) => ({ id: `${prefix}-outer-crossing-${index}`, name: index ? "上流の橋" : "街道の渡し", type: index ? "bridge" : "ford", x, z, w: w + 12, d: index ? 10 : 13, rotation: 0 }));
    world.crossings.push(...outerCrossings);
    for (const crossing of outerCrossings) world.roads.push({ id: `${crossing.id}-road`, name: crossing.name, points: [[crossing.x - 30, crossing.z], [crossing.x + 30, crossing.z]], width: 3 });
    const waters = [...battle.layout.water.filter(item => item.type !== "sea"), ...world.seas, ...world.rivers];
    const safe = item => !wetFootprint(item, waters) && footprintCorners(item, 2).every(([x, z]) => x > box.minX + 4 && x < box.maxX - 4 && z > box.minZ + 4 && z < box.maxZ - 4);
    // All houses are physical obstacles. Build a clear lane through each
    // settlement and omit a candidate rather than putting it into the water.
    for (let i = 0; i < 4; i++) {
      let accepted = null;
      for (let attempt = 0; attempt < 20 && !accepted; attempt++) {
        const side = i % 2 ? 1 : -1, x = world.coastal ? 125 + random() * (box.maxX - 160) : side * (115 + random() * (width * .35 - 115));
        const z = (i < 2 ? -1 : 1) * (135 + random() * (depth * .37 - 135)) - 8;
        const town = settlement(`${prefix}-outer-village-${i}`, world.coastal && i === 0 ? "港の集落" : profile.id === "mountain" || profile.id === "basin" ? "谷あいの村" : "街道沿いの村", "village", x, z, 3, 2);
        const lane = { points: [[town.x - 16, town.z], [town.x + 16, town.z]], width: 2.5 }, previousHouses = world.settlements.flatMap(item => item.houses);
        if (town.houses.every(safe)
          && Math.abs(elevationDelta({ landscape: world }, x, z)) < profile.relief * .65
          && !world.settlements.some(other => Math.abs(other.x - town.x) < 45 && Math.abs(other.z - town.z) < 35)
          && !town.houses.some(house => world.roads.some(road => roadHitsHouse(road, house)))
          && !previousHouses.some(house => roadHitsHouse(lane, house))) accepted = town;
      }
      if (accepted) {
        world.settlements.push(accepted);
        world.roads.push({ id: `${accepted.id}-lane`, name: "集落の通り", points: [[accepted.x - 16, accepted.z], [accepted.x + 16, accepted.z]], width: 2.5 });
      }
    }
    const fieldCount = profile.id === "plain" ? 45 : profile.id === "mountain" ? 24 : 33;
    for (let i = 0, attempts = 0; i < fieldCount && attempts++ < fieldCount * 12;) {
      const x = world.coastal ? 14 + random() * (box.maxX - 34) : box.minX + 24 + random() * (width - 48), z = box.minZ + 24 + random() * (depth - 48);
      if (Math.abs(x) < 96 && z > -110 && z < 100) continue;
      const kind = random() < profile.paddyShare ? "paddy" : "dry", field = { id: `${prefix}-outer-field-${i}`, name: kind === "paddy" ? "地域の水田" : "地域の畑", kind, x, z, w: 7, d: 10, rows: 8, rotation: 0, crop: kind === "paddy" ? "rice" : "millet" };
      if (!safe(field) || Math.abs(elevationDelta({ landscape: world }, x, z)) > (kind === "paddy" ? 4 : 9)) continue;
      if (world.settlements.some(town => inFootprint(town, x, z, 13)) || world.fields.some(other => Math.abs(other.x - x) < 10 && Math.abs(other.z - z) < 13)) continue;
      world.fields.push(field); i++;
    }
    for (let i = 0; i < 14; i++) {
      let x = box.minX + 25 + random() * (width - 50), z = box.minZ + 25 + random() * (depth - 50);
      if (world.coastal) x = Math.max(x, 18 + random() * 45);
      if (Math.abs(x) < 66 && z > -70 && z < 65) z = box.minZ + 32;
      if (waters.some(water => inside(x, z, water.polygon))) continue;
      world.forests.push({ id: `regional-wood-${i}`, name: profile.treeKind === "cedar" ? "杉の山林" : profile.treeKind === "pine" ? "海岸の松林" : "地域の雑木林", x, z, w: 25 + random() * 28, d: 30 + random() * 30, radius: 16 + random() * 7, kind: profile.treeKind, density: profile.forestDensity });
    }
    const lateral = Math.round((random() - .5) * 14);
    world.deploymentPlan = { attacker: { x: lateral, z: 34, frontage: profile.id === "mountain" ? 28 : 42 }, defender: { x: -lateral, z: -30, frontage: profile.id === "plain" ? 46 : 32 } };
    world.note = `${profile.province}・${profile.label}。城郭の周辺をゲームの縮尺で構成した創作地形です。`;
    return world;
  }
  function plan(battle, version = VERSION) { return version === 1 ? legacyPlan(battle) : regionalPlan(battle); }
  function apply(battle, version = VERSION) {
    if (version === 0 || battle.layout.landscape) return battle;
    if (version === 1) return legacyApply(battle);
    const world = regionalPlan(battle), layout = battle.layout;
    layout.bounds = { ...world.bounds }; layout.landscape = world;
    layout.water = layout.water.map(item => item.type === "sea" ? copy(world.seas.find(sea => sea.id === item.id)) : item);
    layout.water.push(...copy(world.seas.filter(sea => !layout.water.some(item => item.id === sea.id))));
    layout.water.push(...copy(world.rivers));
    for (const crossing of world.crossings) {
      const bridge = { ...copy(crossing), kind: "bridge", type: "bridge", style: crossing.type, width: crossing.w, depth: crossing.d, height: .28, h: .28, hp: 0, maxHp: 0, passable: true, landscape: true, polygon: rect(crossing.x, crossing.z, crossing.w, crossing.d) };
      layout.structures.push(copy(bridge)); battle.structures.push(bridge);
    }
    layout.paths.push(...copy(world.roads));
    layout.deployment = { attacker: { xMin: world.bounds.minX + 1, xMax: world.bounds.maxX - 1, zMin: 10, zMax: world.bounds.maxZ - 1 }, defender: { xMin: world.bounds.minX + 1, xMax: world.bounds.maxX - 1, zMin: world.bounds.minZ + 1, zMax: -5 } };
    battle.terrainFeatures = [...(battle.terrainFeatures || []).filter(item => item.type !== "forest"), ...world.forests.map(item => ({ type: "forest", ...copy(item) })), ...peaksAndValleys(world), ...world.settlements.map(item => ({ type: item.kind, name: item.name, x: item.x, z: item.z, radius: Math.max(item.w, item.d) / 2 })), ...world.rivers.map(item => ({ type: "river", name: item.name, x: 63, z: 24, radius: profileFor(battle).riverWidth / 2 })), { type: "field", name: "地域の田畑", x: 43, z: 57, radius: 13 }];
    battle.battlefieldVersion = VERSION;
    return battle;
  }
  const houseCache = new WeakMap();
  function houses(layout) {
    if (!layout?.landscape) return [];
    if (!houseCache.has(layout)) houseCache.set(layout, layout.landscape.settlements.flatMap(item => item.houses));
    return houseCache.get(layout);
  }
  function blocked(layout, x, z, padding = .55) {
    if (!layout?.landscape) return false;
    if (houses(layout).some(item => inFootprint(item, x, z, padding))) return true;
    if (layout.landscape.seas.some(sea => inside(x, z, sea.polygon))) return true;
    const touchesRiver = layout.landscape.rivers.some(river => [[0, 0], [padding, 0], [-padding, 0], [0, padding], [0, -padding]].some(([dx, dz]) => inside(x + dx, z + dz, river.polygon)));
    return touchesRiver && !layout.landscape.crossings.some(item => inFootprint(item, x, z, -padding));
  }
  function buildingAt(layout, x, z, padding = .55) { return houses(layout).find(item => inFootprint(item, x, z, padding)) || null; }
  function movementFactor(layout, unit) {
    if (!layout?.landscape || unit.type === "navy") return 1;
    const field = layout.landscape.fields.find(item => inFootprint(item, unit.x, unit.z));
    if (field) return field.kind === "paddy" ? unit.type === "cavalry" ? .62 : .78 : unit.type === "cavalry" ? .85 : .92;
    if (layout.landscape.rivers.some(item => inside(unit.x, unit.z, item.polygon)) && layout.landscape.crossings.some(item => item.type === "ford" && inFootprint(item, unit.x, unit.z))) return .75;
    return 1;
  }
  function coverFactor(layout, target, ranged) {
    if (!ranged || !layout?.landscape || target.type === "navy") return 1;
    return layout.landscape.settlements.some(item => inFootprint(item, target.x, target.z, 1)) ? .9 : 1;
  }
  function segmentBlocked(layout, x, z, targetX, targetZ) {
    const minX = Math.min(x, targetX) - .7, maxX = Math.max(x, targetX) + .7, minZ = Math.min(z, targetZ) - .7, maxZ = Math.max(z, targetZ) + .7;
    const overlaps = (left, right, top, bottom) => maxX >= left && minX <= right && maxZ >= top && minZ <= bottom;
    const nearBuilding = houses(layout).some(item => overlaps(item.x - item.w / 2, item.x + item.w / 2, item.z - item.d / 2, item.z + item.d / 2));
    const nearWater = [...layout.landscape.rivers, ...layout.landscape.seas].some(item => overlaps(Math.min(...item.polygon.map(point => point[0])), Math.max(...item.polygon.map(point => point[0])), Math.min(...item.polygon.map(point => point[1])), Math.max(...item.polygon.map(point => point[1]))));
    if (!nearBuilding && !nearWater) return false;
    const distance = Math.hypot(targetX - x, targetZ - z), count = Math.max(1, Math.ceil(distance / .4));
    for (let i = 1; i <= count; i++) if (blocked(layout, x + (targetX - x) * i / count, z + (targetZ - z) * i / count)) return true;
    return false;
  }
  // A small, deterministic A* planner only handles the new countryside. The
  // original narrow castle passages remain under the established path follower.
  function legacyRoute(layout, fromX, fromZ, targetX, targetZ) {
    const grid = 2, box = layout.bounds, minX = box.minX + 1, minZ = box.minZ + 1;
    const columns = Math.floor((box.maxX - box.minX - 2) / grid) + 1, rows = Math.floor((box.maxZ - box.minZ - 2) / grid) + 1;
    const point = id => [minX + id % columns * grid, minZ + Math.floor(id / columns) * grid];
    const node = (x, z) => clamp(Math.round((z - minZ) / grid), 0, rows - 1) * columns + clamp(Math.round((x - minX) / grid), 0, columns - 1);
    let start = node(fromX, fromZ), goal = node(targetX, targetZ);
    const traversable = id => { const [x, z] = point(id); return !blocked(layout, x, z, .7); };
    // A clicking target immediately beside a house must resolve to nearby land,
    // rather than making an otherwise reachable river crossing impossible.
    const nearestOpen = (id, x, z) => {
      if (traversable(id)) return id;
      let nearest = null, distance = Infinity;
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const cx = id % columns + dx, cz = Math.floor(id / columns) + dz;
        if (cx < 0 || cx >= columns || cz < 0 || cz >= rows) continue;
        const candidate = cz * columns + cx, p = point(candidate), d = Math.hypot(p[0] - x, p[1] - z);
        if (traversable(candidate) && d < distance) { nearest = candidate; distance = d; }
      }
      return nearest;
    };
    start = nearestOpen(start, fromX, fromZ); goal = nearestOpen(goal, targetX, targetZ);
    if (start == null || goal == null) return [];
    const open = new Set([start]), previous = new Map(), cost = new Map([[start, 0]]), score = new Map();
    const heuristic = id => { const a = point(id), b = point(goal); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    score.set(start, heuristic(start));
    let iterations = 0;
    while (open.size && iterations++ < columns * rows) {
      let current = null, best = Infinity;
      for (const id of open) if (score.get(id) < best) { best = score.get(id); current = id; }
      if (current === goal) {
        const result = [];
        for (let at = current; at !== start; at = previous.get(at)) result.push(point(at));
        result.reverse();
        if (!blocked(layout, targetX, targetZ)) result.push([targetX, targetZ]);
        return result;
      }
      open.delete(current);
      const cx = current % columns, cz = Math.floor(current / columns);
      for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= columns || nz < 0 || nz >= rows) continue;
        const next = nz * columns + nx;
        if (!traversable(next) || (dx && dz && (!traversable(cz * columns + nx) || !traversable(nz * columns + cx)))) continue;
        const value = cost.get(current) + Math.hypot(dx, dz) * grid;
        if (value >= (cost.get(next) ?? Infinity)) continue;
        previous.set(next, current); cost.set(next, value); score.set(next, value + heuristic(next)); open.add(next);
      }
    }
    return [];
  }
  function legacyNavigationTarget(battle, unit, x, z) {
    const layout = battle.layout;
    if (!layout.landscape || unit.type === "navy") return { x, z };
    if (!segmentBlocked(layout, unit.x, unit.z, x, z)) { delete unit.landscapeRoute; return { x, z }; }
    let saved = unit.landscapeRoute;
    if (!saved || Math.hypot(saved.goalX - x, saved.goalZ - z) > 5 || !saved.points.length) {
      saved = { goalX: x, goalZ: z, points: legacyRoute(layout, unit.x, unit.z, x, z) };
      unit.landscapeRoute = saved;
    }
    while (saved.points.length && Math.hypot(saved.points[0][0] - unit.x, saved.points[0][1] - unit.z) < 1) saved.points.shift();
    if (!saved.points.length) return { x, z };
    // Skip visible waypoints, which smooths a grid route without cutting a
    // corner through a house, river bank or the edge of a bridge.
    while (saved.points.length > 1 && !segmentBlocked(layout, unit.x, unit.z, saved.points[1][0], saved.points[1][1])) saved.points.shift();
    return { x: saved.points[0][0], z: saved.points[0][1] };
  }
  const navigationCache = new WeakMap();
  function regionalSegmentBlocked(layout, x, z, targetX, targetZ) {
    if (houses(layout).some(house => {
      const a = house.rotation || 0, c = Math.cos(a), s = Math.sin(a), local = (px, pz) => [(px - house.x) * c + (pz - house.z) * s, -(px - house.x) * s + (pz - house.z) * c];
      const from = local(x, z), to = local(targetX, targetZ), half = [house.w / 2 + .6, house.d / 2 + .6];
      let enter = 0, exit = 1;
      for (let axis = 0; axis < 2; axis++) {
        const delta = to[axis] - from[axis];
        if (Math.abs(delta) < 1e-9) { if (Math.abs(from[axis]) > half[axis]) return false; }
        else { const a = (-half[axis] - from[axis]) / delta, b = (half[axis] - from[axis]) / delta; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); if (enter > exit) return false; }
      }
      return true;
    })) return true;
    // Split the segment at polygon edges, so a 500-unit march costs the same
    // as a short one. Crossings split the wet intervals into traversable parts.
    const dx = targetX - x, dz = targetZ - z, cuts = [0, 1], world = layout.landscape;
    const polygons = [...world.rivers, ...world.seas].map(item => item.polygon);
    for (const crossing of world.crossings) polygons.push(footprintCorners(crossing, -.7));
    for (const polygon of polygons) for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], ex = b[0] - a[0], ez = b[1] - a[1], denominator = dx * ez - dz * ex;
      if (Math.abs(denominator) < 1e-9) continue;
      const t = ((a[0] - x) * ez - (a[1] - z) * ex) / denominator, u = ((a[0] - x) * dz - (a[1] - z) * dx) / denominator;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    const wet = (px, pz) => world.seas.some(sea => inside(px, pz, sea.polygon)) || world.rivers.some(river => inside(px, pz, river.polygon)) && !world.crossings.some(crossing => inFootprint(crossing, px, pz, -.7));
    if (wet(x, z) || wet(targetX, targetZ)) return true;
    for (let i = 1; i < cuts.length; i++) { const t = (cuts[i - 1] + cuts[i]) / 2; if (wet(x + dx * t, z + dz * t)) return true; }
    return false;
  }
  function route(layout, fromX, fromZ, targetX, targetZ, options = {}) {
    if ((layout.landscape?.version || 0) < 2) return legacyRoute(layout, fromX, fromZ, targetX, targetZ);
    if (!regionalSegmentBlocked(layout, fromX, fromZ, targetX, targetZ) && !options.blocked?.(targetX, targetZ, .7) && !options.segmentBlocked?.(fromX, fromZ, targetX, targetZ, .7)) return [[targetX, targetZ]];
    const grid = 2, box = layout.bounds, minX = box.minX + 1, minZ = box.minZ + 1;
    const columns = Math.floor((box.maxX - box.minX - 2) / grid) + 1, rows = Math.floor((box.maxZ - box.minZ - 2) / grid) + 1;
    if (!navigationCache.has(layout)) navigationCache.set(layout, new Int8Array(columns * rows));
    const occupancy = navigationCache.get(layout), point = id => [minX + id % columns * grid, minZ + Math.floor(id / columns) * grid];
    const node = (x, z) => clamp(Math.round((z - minZ) / grid), 0, rows - 1) * columns + clamp(Math.round((x - minX) / grid), 0, columns - 1);
    const traversable = id => {
      const [x, z] = point(id);
      if (!occupancy[id]) occupancy[id] = blocked(layout, x, z, .7) ? -1 : 1;
      return occupancy[id] > 0 && !options.blocked?.(x, z, .7);
    };
    const nearestOpen = (id, x, z) => {
      if (traversable(id)) return id;
      let nearest = null, distance = Infinity;
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const cx = id % columns + dx, cz = Math.floor(id / columns) + dz;
        if (cx < 0 || cx >= columns || cz < 0 || cz >= rows) continue;
        const candidate = cz * columns + cx, p = point(candidate), d = Math.hypot(p[0] - x, p[1] - z);
        if (traversable(candidate) && d < distance) { nearest = candidate; distance = d; }
      }
      return nearest;
    };
    const start = nearestOpen(node(fromX, fromZ), fromX, fromZ), goal = nearestOpen(node(targetX, targetZ), targetX, targetZ);
    if (start == null || goal == null) return [];
    const previous = new Int32Array(columns * rows).fill(-1), cost = new Float64Array(columns * rows).fill(Infinity), closed = new Uint8Array(columns * rows), heap = [];
    const end = point(goal), heuristic = id => { const p = point(id); return Math.hypot(p[0] - end[0], p[1] - end[1]); };
    const push = (id, score) => { let i = heap.length; heap.push({ id, score }); while (i) { const parent = (i - 1) >> 1; if (heap[parent].score <= score) break; heap[i] = heap[parent]; i = parent; } heap[i] = { id, score }; };
    const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++; if (heap[child].score >= last.score) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first.id; };
    cost[start] = 0; push(start, heuristic(start));
    while (heap.length) {
      const current = pop(); if (closed[current]) continue;
      if (current === goal) {
        const result = []; for (let at = current; at !== start; at = previous[at]) result.push(point(at)); result.reverse();
        if (!blocked(layout, targetX, targetZ) && !options.blocked?.(targetX, targetZ, .7)) result.push([targetX, targetZ]);
        return result;
      }
      closed[current] = 1;
      const cx = current % columns, cz = Math.floor(current / columns);
      for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nx >= columns || nz < 0 || nz >= rows) continue;
        const next = nz * columns + nx;
        if (closed[next] || !traversable(next) || dx && dz && (!traversable(cz * columns + nx) || !traversable(nz * columns + cx))) continue;
        const a = point(current), b = point(next);
        if (options.segmentBlocked?.(a[0], a[1], b[0], b[1], .7)) continue;
        const value = cost[current] + Math.hypot(dx, dz) * grid;
        if (value >= cost[next]) continue;
        previous[next] = current; cost[next] = value; push(next, value + heuristic(next));
      }
    }
    return [];
  }
  function navigationTarget(battle, unit, x, z, options = {}) {
    if ((battle.layout.landscape?.version || 0) < 2) return legacyNavigationTarget(battle, unit, x, z);
    if (unit.type === "navy") return { x, z };
    const layout = battle.layout;
    if (!regionalSegmentBlocked(layout, unit.x, unit.z, x, z) && !options.blocked?.(x, z, .7) && !options.segmentBlocked?.(unit.x, unit.z, x, z, .7)) { delete unit.landscapeRoute; return { x, z }; }
    let saved = unit.landscapeRoute;
    if (!saved || saved.obstacleKey !== options.key || Math.hypot(saved.goalX - x, saved.goalZ - z) > 5 || !saved.points.length) unit.landscapeRoute = saved = { goalX: x, goalZ: z, obstacleKey: options.key, points: route(layout, unit.x, unit.z, x, z, options) };
    while (saved.points.length && Math.hypot(saved.points[0][0] - unit.x, saved.points[0][1] - unit.z) < 1) saved.points.shift();
    if (!saved.points.length) return { x: unit.x, z: unit.z };
    while (saved.points.length > 1 && !options.blocked?.(saved.points[1][0], saved.points[1][1], .7) && !options.segmentBlocked?.(unit.x, unit.z, saved.points[1][0], saved.points[1][1], .7) && !regionalSegmentBlocked(layout, unit.x, unit.z, saved.points[1][0], saved.points[1][1])) saved.points.shift();
    return { x: saved.points[0][0], z: saved.points[0][1] };
  }
  root.TenkaBattlefield = Object.freeze({ version: VERSION, bounds: boundsFor(PROFILES.plain), legacyBounds: LEGACY_BOUNDS, coreBounds: CORE, profiles: PROFILES, plan, apply, elevationDelta, inside, inFootprint, buildingAt, movementFactor, coverFactor, blocked, route, navigationTarget });
})(typeof window !== "undefined" ? window : globalThis);
