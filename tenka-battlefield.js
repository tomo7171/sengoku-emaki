(function (root) {
  "use strict";

  // The castle's surveyed game plan stays at its original coordinates. The
  // surrounding countryside is a deterministic extension, not a scaled castle.
  const VERSION = 1;
  const BOUNDS = Object.freeze({ minX: -88, maxX: 88, minZ: -100, maxZ: 84, xMin: -88, xMax: 88, zMin: -100, zMax: 84 });
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
  function plan(battle) {
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
      return { ...copy(item), landscapeExpanded: true, polygon: [[BOUNDS.minX - 6, BOUNDS.minZ - 6], [shore, BOUNDS.minZ - 6], [shore, BOUNDS.maxZ + 6], [BOUNDS.minX - 6, BOUNDS.maxZ + 6]] };
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
    return { version: VERSION, coastal, bounds: { ...BOUNDS }, coreBounds: { ...CORE }, peaks, valleys, seas, rivers, crossings, roads, fields, settlements, forests, note: "城郭を囲む山谷・河川・街道・田畑・集落を表すゲーム用地形です。" };
  }
  function apply(battle) {
    if (battle.battlefieldVersion === VERSION) return battle;
    const layout = battle.layout, landscape = plan(battle);
    layout.bounds = { ...BOUNDS };
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
    battle.battlefieldVersion = VERSION;
    return battle;
  }
  function peaksAndValleys(landscape) {
    return [...landscape.peaks.map(item => ({ type: "mountain", ...copy(item), radius: Math.max(item.sx, item.sz) })), ...landscape.valleys.map(item => ({ type: "valley", ...copy(item), radius: Math.max(item.sx, item.sz) }))];
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
  function route(layout, fromX, fromZ, targetX, targetZ) {
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
  function navigationTarget(battle, unit, x, z) {
    const layout = battle.layout;
    if (!layout.landscape || unit.type === "navy") return { x, z };
    if (!segmentBlocked(layout, unit.x, unit.z, x, z)) { delete unit.landscapeRoute; return { x, z }; }
    let saved = unit.landscapeRoute;
    if (!saved || Math.hypot(saved.goalX - x, saved.goalZ - z) > 5 || !saved.points.length) {
      saved = { goalX: x, goalZ: z, points: route(layout, unit.x, unit.z, x, z) };
      unit.landscapeRoute = saved;
    }
    while (saved.points.length && Math.hypot(saved.points[0][0] - unit.x, saved.points[0][1] - unit.z) < 1) saved.points.shift();
    if (!saved.points.length) return { x, z };
    // Skip visible waypoints, which smooths a grid route without cutting a
    // corner through a house, river bank or the edge of a bridge.
    while (saved.points.length > 1 && !segmentBlocked(layout, unit.x, unit.z, saved.points[1][0], saved.points[1][1])) saved.points.shift();
    return { x: saved.points[0][0], z: saved.points[0][1] };
  }
  root.TenkaBattlefield = Object.freeze({ version: VERSION, bounds: BOUNDS, coreBounds: CORE, plan, apply, elevationDelta, inside, inFootprint, buildingAt, movementFactor, coverFactor, blocked, route, navigationTarget });
})(typeof window !== "undefined" ? window : globalThis);
