/* Earth-cut precincts and hand-laid retaining masonry for the live battlefield.
 * The skin follows the existing terrain: it adds no new platform, collision,
 * route or objective. Named stone accents are creative game reconstructions,
 * never a claim that surviving stonework was all present in 1560.
 */
(function (root) {
  "use strict";
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const distanceToLine = (x, z, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
  };
  function intersects(a, b, c, d) {
    const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const ab1 = cross(a, b, c), ab2 = cross(a, b, d), cd1 = cross(c, d, a), cd2 = cross(c, d, b);
    return ab1 * ab2 <= 0 && cd1 * cd2 <= 0
      && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + 1e-8
      && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + 1e-8;
  }
  function linesDistance(a, b, c, d) {
    return intersects(a, b, c, d) ? 0 : Math.min(distanceToLine(...a, c, d), distanceToLine(...b, c, d), distanceToLine(...c, a, b), distanceToLine(...d, a, b));
  }
  function polygonFor(bailey) {
    if (Array.isArray(bailey.polygon) && bailey.polygon.length >= 3) return bailey.polygon.map(point => [Number(point[0]), Number(point[1])]);
    const x = Number(bailey.x) || 0, z = Number(bailey.z) || 0;
    const width = Number(bailey.width ?? bailey.w) || 12, depth = Number(bailey.depth ?? bailey.d) || 10;
    return [[x - width / 2, z - depth / 2], [x + width / 2, z - depth / 2], [x + width / 2, z + depth / 2], [x - width / 2, z + depth / 2]];
  }
  function inside(x, z, polygon) {
    let result = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
      const a = polygon[index], b = polygon[previous];
      if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  }
  function labelsFor(layout, battle, heightAt) {
    const source = layout.baileys || [], core = battle.captureZone || layout.captureZone || source.at(-1) || { x: 0, z: -25 };
    const approach = (layout.paths || []).flatMap(path => path.points || []);
    const score = bailey => {
      const distance = Math.hypot(bailey.x - core.x, bailey.z - core.z);
      const path = approach.length ? Math.min(...approach.map(point => Math.hypot(bailey.x - point[0], bailey.z - point[1]))) : 0;
      return distance * 1.4 + path * .35 - (Number(bailey.elevation) || 0) * .65;
    };
    const main = source.filter(bailey => !/[支袖出帯腰]/.test(String(bailey.id || bailey.name || ""))).slice().sort((a, b) => score(a) - score(b));
    return source.map((bailey, index) => {
      const rank = main.indexOf(bailey), originalName = String(bailey.name || bailey.id || `曲輪${index + 1}`);
      const role = rank === 0 ? "honmaru" : rank === 1 ? "ninomaru" : rank === 2 ? "sannomaru" : "support";
      const name = rank === 0 ? "本丸" : rank === 1 ? "二の丸" : rank === 2 ? "三の丸" : originalName;
      return { name, x: Number(bailey.x) || 0, z: Number(bailey.z) || 0, y: heightAt(Number(bailey.x) || 0, Number(bailey.z) || 0), originalName, role, baileyId: bailey.id || `bailey-${index}`, elevation: Number(bailey.elevation) || 0, width: Number(bailey.width ?? bailey.w) || 12, depth: Number(bailey.depth ?? bailey.d) || 10 };
    });
  }
  function create(THREE, options = {}) {
    if (!THREE?.Group || !THREE.Mesh || !THREE.BufferGeometry || !THREE.Float32BufferAttribute) return null;
    const battle = options.battle || {}, layout = options.layout || battle.layout || {};
    const source = options.materials || {}, materials = { earth: source.earth || source.stone, stone: source.stone || source.earth, dark: source.darkWood || source.earth || source.stone };
    if (!materials.earth || !materials.stone) return null;
    const sampleHeight = typeof options.heightAt === "function" ? options.heightAt : () => 0;
    const heightAt = (x, z) => Number(sampleHeight(x, z)) || 0;
    const group = new THREE.Group(); group.name = "castle-precinct-earthworks";
    const labels = labelsFor(layout, battle, heightAt);
    const stats = { meshes: 0, triangles: 0, earthSegments: 0, stoneSegments: 0, cornerStones: 0, clearance: 1.5, labels: labels.length };
    const profile = battle.profile || layout.profile || battle.targetCastle?.profile || {};
    const castleId = String(battle.targetId || battle.targetCastle?.id || layout.id || "castle");
    const paths = layout.paths || [];
    const gates = (battle.structures || layout.structures || []).filter(item => (item.kind || item.type) === "gate");
    const waters = layout.water || [];
    const allBaileys = (layout.baileys || []).map(bailey => ({ bailey, polygon: polygonFor(bailey) }));
    let seed = 2166136261;
    for (const character of castleId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    // Reject the whole projected face, not just its center. The expanded route
    // corridor remains empty even where a path crosses diagonally or turns.
    function clear(points, current) {
      const xs = points.map(point => point[0]), zs = points.map(point => point[2]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const rectangle = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
      const contains = point => point[0] >= minX && point[0] <= maxX && point[1] >= minZ && point[1] <= maxZ;
      for (const path of paths) for (let index = 1; index < (path.points || []).length; index++) {
        const a = path.points[index - 1], b = path.points[index], radius = (path.width || 2) / 2 + stats.clearance;
        if (contains(a) || contains(b)) return false;
        for (let edge = 0; edge < 4; edge++) if (linesDistance(a, b, rectangle[edge], rectangle[(edge + 1) % 4]) < radius) return false;
      }
      for (const gate of gates) {
        const angle = gate.rotation || 0, ca = Math.cos(angle), sa = Math.sin(angle);
        const halfWidth = (gate.w ?? gate.width ?? 3) / 2 + .9, halfDepth = (gate.d ?? gate.depth ?? 1) / 2 + 1.2;
        if (rectangle.some(([x, z]) => Math.abs((x - gate.x) * ca + (z - gate.z) * sa) < halfWidth && Math.abs(-(x - gate.x) * sa + (z - gate.z) * ca) < halfDepth)) return false;
        if (contains([gate.x, gate.z])) return false;
      }
      if (waters.some(water => rectangle.some(point => inside(...point, water.polygon || [])))) return false;
      // Overlapping historic baileys share a cut face. Never lay an ornamental
      // cliff through the walkable interior of its neighboring precinct.
      if (allBaileys.some(item => item.bailey !== current && rectangle.some(point => inside(...point, item.polygon)))) return false;
      return true;
    }
    function surface(name, points, indices, material, metadata = {}) {
      if (stats.triangles + indices.length / 3 > 54000 || stats.meshes >= 2600 || points.some(point => !point.every(Number.isFinite))) return null;
      const geometry = new THREE.BufferGeometry(), vertices = [], uv = [];
      for (const point of points) { vertices.push(...point); uv.push(point[0] * .55 + point[2] * .13, point[1] * .6 + point[2] * .1); }
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
      options.trackGeometry?.(geometry);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.precinct = metadata; group.add(mesh);
      stats.meshes++; stats.triangles += indices.length / 3; return mesh;
    }
    function slab(name, front, material, depth, metadata) {
      // A shallow irregular stone, thick enough for actual mortar shadows but
      // embedded in the underlying terrain rather than hovering above a skirt.
      const back = front.map(point => [point[0], point[1] - depth, point[2]]), count = front.length, points = [...front, ...back], indices = [];
      const crossY = (front[1][2] - front[0][2]) * (front[2][0] - front[0][0]) - (front[1][0] - front[0][0]) * (front[2][2] - front[0][2]);
      for (let index = 1; index < count - 1; index++) {
        if (crossY >= 0) { indices.push(0, index, index + 1); indices.push(count, count + index + 1, count + index); }
        else { indices.push(0, index + 1, index); indices.push(count, count + index, count + index + 1); }
      }
      for (let index = 0; index < count; index++) { const next = (index + 1) % count; indices.push(index, next, next + count, index, next + count, index + count); }
      return surface(name, points, indices, material, metadata);
    }
    for (const { bailey, polygon } of allBaileys) {
      const cx = Number(bailey.x) || polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
      const cz = Number(bailey.z) || polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length;
      const label = labels.find(item => item.baileyId === bailey.id) || labels[allBaileys.findIndex(item => item.bailey === bailey)];
      const stone = profile.wall === "stone", mixed = profile.wall === "mixed";
      const namedAccent = /nanao/.test(castleId) && ["honmaru", "ninomaru"].includes(label?.role)
        || /inabayama/.test(castleId) && label?.role === "honmaru";
      for (let edge = 0; edge < polygon.length; edge++) {
        const a = polygon[edge], b = polygon[(edge + 1) % polygon.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const count = Math.max(1, Math.ceil(length / 2.35));
        const at = (u, v, lift = .035) => {
          const scale = .90 + .28 * v, x = cx + (a[0] + (b[0] - a[0]) * u - cx) * scale, z = cz + (a[1] + (b[1] - a[1]) * u - cz) * scale;
          return [x, heightAt(x, z) + lift, z];
        };
        for (let segment = 0; segment < count; segment++) {
          const u0 = segment / count, u1 = (segment + 1) / count;
          const corners = [at(u0, 0), at(u1, 0), at(u1, 1), at(u0, 1)];
          if (!clear(corners, bailey)) continue;
          const points = [], indices = [];
          for (let row = 0; row <= 6; row++) { points.push(at(u0, row / 6), at(u1, row / 6)); if (row < 6) indices.push(row * 2, row * 2 + 1, row * 2 + 2, row * 2 + 1, row * 2 + 3, row * 2 + 2); }
          surface("precinct-earth-slope", points, indices, materials.earth, { baileyId: label?.baileyId, role: label?.role, groundSkin: true }); stats.earthSegments++;
          const exposedHeight = Math.max(Math.abs(corners[0][1] - corners[3][1]), Math.abs(corners[1][1] - corners[2][1]));
          const rows = Math.max(2, Math.min(6, Math.ceil(exposedHeight / .65)));
          // Earth castles retain their broad earthen upper slope. Only a low
          // dry-laid toe is used there; selected named main precincts gain
          // substantial retaining accents without becoming all-stone castles.
          const lowerRow = stone ? 0 : mixed || namedAccent ? Math.floor(rows * .35) : rows - 1;
          for (let row = lowerRow; row < rows; row++) {
            if (!stone && !mixed && !namedAccent && exposedHeight < .65) continue;
            const stoneCount = row % 2 ? 3 : 2, v0 = (row + .055) / rows, v1 = (row + .93) / rows;
            for (let column = 0; column < stoneCount; column++) {
              const center = (column + .5) / stoneCount, jitter = (random() - .5) * .14;
              const p0 = u0 + (u1 - u0) * clamp(center - .46 / stoneCount + jitter, .015, .985);
              const p1 = u0 + (u1 - u0) * clamp(center + .46 / stoneCount + jitter, .015, .985);
              if (p1 <= p0) continue;
              const lift = .07 + random() * .055;
              const face = [at(p0, v0 + random() * .025, lift), at(p1, v0, lift), at(p1, v1 - random() * .02, lift), at((p0 + p1) / 2, v1 + .015, lift), at(p0, v1 - random() * .02, lift)];
              if (!clear(face, bailey)) continue;
              if (slab("precinct-stone-facing", face, materials.stone, .10 + random() * .08, { baileyId: label?.baileyId, role: label?.role, course: row, retainingAccent: !stone })) stats.stoneSegments++;
            }
          }
          // Close the stone crown in short irregular lengths; earth crowns
          // stay exposed so timber/plaster walls still read as earth-and-wood.
          if (stone && exposedHeight > .5) {
            const cap = [at(u0 + .014, 0, .065), at(u1 - .014, 0, .065), at(u1 - .014, .065, .065), at(u0 + .014, .065, .065)];
            if (clear(cap, bailey)) slab("precinct-capstone", cap, materials.stone, .11, { baileyId: label?.baileyId, role: label?.role });
          }
        }
        // Long/short corner courses alternate around the return, producing
        // actual interlocked silhouettes rather than a texture on one cliff.
        if (!stone && !mixed && !namedAccent) continue;
        const next = polygon[(edge + 2) % polygon.length];
        const dx = next[0] - b[0], dz = next[1] - b[1], nextLength = Math.hypot(dx, dz) || 1;
        const height = Math.abs(at(1, 0)[1] - at(1, 1)[1]);
        const courses = Math.max(2, Math.min(6, Math.ceil(height / .65)));
        for (let row = stone ? 0 : Math.floor(courses * .35); row < courses; row++) {
          const v0 = (row + .045) / courses, v1 = (row + .93) / courses;
          const first = at(1 - Math.min(.8, row % 2 ? 1.25 : .7) / Math.max(1, length), v0, .14), corner = at(1, v0, .14);
          const radial = .90 + .28 * v0, returnLength = row % 2 ? .7 : 1.25;
          const end = [corner[0] + dx / nextLength * returnLength * radial, 0, corner[2] + dz / nextLength * returnLength * radial]; end[1] = heightAt(end[0], end[2]) + .14;
          const firstTop = at(1 - Math.min(.8, row % 2 ? 1.25 : .7) / Math.max(1, length), v1, .14), cornerTop = at(1, v1, .14);
          const topScale = .90 + .28 * v1, endTop = [cornerTop[0] + dx / nextLength * returnLength * topScale, 0, cornerTop[2] + dz / nextLength * returnLength * topScale]; endTop[1] = heightAt(endTop[0], endTop[2]) + .14;
          for (const face of [[first, corner, cornerTop, firstTop], [corner, end, endTop, cornerTop]]) if (clear(face, bailey) && slab("precinct-corner-quoin", face, materials.stone, .19, { baileyId: label?.baileyId, role: label?.role, course: row, longReturn: row % 2 === 0 })) stats.cornerStones++;
        }
      }
    }
    group.userData.precincts = { ...stats, reconstruction: "creative-ground-following", labels };
    return { group, baileys: labels, labels, stats };
  }
  function describe(battle = {}) {
    const layout = battle.layout || {};
    return labelsFor(layout, battle, () => 0);
  }
  root.TenkaCastlePrecincts = Object.freeze({ create, describe });
})(typeof window === "object" ? window : globalThis);
