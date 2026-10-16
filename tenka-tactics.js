(function (root) {
  "use strict";
  const TYPES = ["ashigaru", "archer", "cavalry", "firearm", "navy"];
  const STEP = 0.25;
  const FORMATIONS = Object.freeze({
    line: { name: "横陣", attack: 1, ranged: 1.12, defense: 1, speed: 1, description: "射界を広く取り、弓・鉄砲の斉射を重視" },
    wedge: { name: "魚鱗", attack: 1.2, ranged: 0.9, defense: 0.88, speed: 1.12, description: "突破と突撃を重視。側面と射撃に弱い" },
    defensive: { name: "方円", attack: 0.86, ranged: 0.94, defense: 1.3, speed: 0.72, description: "槍を揃え、包囲と騎馬突撃に備える" },
    loose: { name: "散開", attack: 0.9, ranged: 1, defense: 1.04, speed: 1.08, description: "射撃の被害を軽減。接近戦で崩れやすい" },
  });
  const MATCHUPS = Object.freeze({
    ashigaru: { cavalry: 1.35, archer: 0.9, firearm: 0.88 },
    cavalry: { archer: 1.4, firearm: 1.12, ashigaru: 0.77 },
    archer: { ashigaru: 1.15, cavalry: 0.83, firearm: 1.08 },
    firearm: { cavalry: 1.4, ashigaru: 1.24, archer: 0.98 },
    navy: { navy: 1, ashigaru: 1.18, archer: 1.05, cavalry: 1.25 },
  });
  const FORTIFICATIONS = Object.freeze({
    camp: { name: "陣地", limit: 2, w: 5, d: 4, h: 2.8, hp: 500, description: "半径九以内の味方の被害を軽減し、士気をゆっくり回復" },
    palisade: { name: "木柵", limit: 8, w: 7, d: 1, h: 2.2, hp: 800, description: "両軍の通行を遮る。味方は迂回し、敵は攻撃して破壊できる" },
  });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const sum = (values) => TYPES.reduce((total, type) => total + (values?.[type] || 0), 0);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const active = (unit) => unit.troops > 0 && !["routed", "destroyed"].includes(unit.status);
  const friendly = (battle) => battle.playerSide || "attacker";
  const regionalRules = (battle) => battle.battlefieldVersion >= 2;
  let original = null;
  let installed = null;

  function stamp(state) {
    const { selectedCastleId, lastBattle, threats, aiReports, aiBattles, ...rest } = state;
    let hash = 2166136261;
    for (const character of JSON.stringify(rest)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash.toString(16);
  }
  function bounds(battle) {
    const box = battle.layout.bounds;
    return { minX: box.minX ?? box.xMin, maxX: box.maxX ?? box.xMax, minZ: box.minZ ?? box.zMin, maxZ: box.maxZ ?? box.zMax };
  }
  function deploymentZone(battle, side = friendly(battle)) {
    const box = bounds(battle);
    // Leave the full home half available so unusual castle plans remain deployable.
    return { xMin: box.minX + 1, xMax: box.maxX - 1, zMin: side === "attacker" ? 10 : box.minZ + 1, zMax: side === "attacker" ? box.maxZ - 1 : -5 };
  }
  function insidePolygon(x, z, polygon = []) {
    let inside = false;
    for (let index = 0, last = polygon.length - 1; index < polygon.length; last = index++) {
      const [a, b] = polygon[index], [c, d] = polygon[last];
      if ((b > z) !== (d > z) && x < ((c - a) * (z - b)) / (d - b) + a) inside = !inside;
    }
    return inside;
  }
  function isSea(battle, x, z) {
    return battle.layout.water.some((water) => water.type === "sea" && insidePolygon(x, z, water.polygon));
  }
  function contains(structure, x, z, radius = 0) {
    return Math.abs(x - structure.x) <= (structure.w ?? structure.width) / 2 + radius && Math.abs(z - structure.z) <= (structure.d ?? structure.depth) / 2 + radius;
  }
  function fortificationContains(structure, x, z, padding = 0) {
    const angle = (structure.rotation || 0) * Math.PI / 180, dx = x - structure.x, dz = z - structure.z;
    return Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) <= structure.w / 2 + padding
      && Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)) <= structure.d / 2 + padding;
  }
  function footprint(structure, padding = 0) {
    const angle = (structure.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
      const dx = x * (structure.w / 2 + padding), dz = z * (structure.d / 2 + padding);
      return [structure.x + dx * c - dz * s, structure.z + dx * s + dz * c];
    });
  }
  function overlap(left, right) {
    const a = footprint(left, 0.35), b = footprint(right, 0.35);
    for (const polygon of [a, b]) for (let index = 0; index < polygon.length; index++) {
      const next = polygon[(index + 1) % polygon.length], axis = [next[1] - polygon[index][1], polygon[index][0] - next[0]];
      const projections = [a, b].map((points) => points.map(([x, z]) => x * axis[0] + z * axis[1]));
      if (Math.max(...projections[0]) < Math.min(...projections[1]) || Math.max(...projections[1]) < Math.min(...projections[0])) return false;
    }
    return true;
  }
  function fortificationBudget(battle) {
    return Object.fromEntries(Object.entries(FORTIFICATIONS).map(([kind, specification]) => {
      const used = (battle.fortifications || []).filter((item) => item.side === friendly(battle) && item.kind === kind).length;
      return [kind, { limit: specification.limit, used, remaining: Math.max(0, specification.limit - used) }];
    }));
  }
  function fortificationPosition(battle, structure, ignoreId = null) {
    const zone = deploymentZone(battle), points = footprint(structure, 0.5);
    if (points.some(([x, z]) => x < zone.xMin || x > zone.xMax || z < zone.zMin || z > zone.zMax)) return "陣地・木柵の全体を自軍の配置範囲内に収めてください。";
    // Sample the entire footprint, not just its center: a long rotated fence
    // must not span a moat while both endpoints happen to be on dry ground.
    const angle = structure.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (let dx = -structure.w / 2; dx <= structure.w / 2 + 0.01; dx += 0.5) for (let dz = -structure.d / 2; dz <= structure.d / 2 + 0.01; dz += 0.5) {
      const x = structure.x + dx * c - dz * s, z = structure.z + dx * s + dz * c;
      if (battle.layout.water.some((water) => insidePolygon(x, z, water.polygon))) return "堀・川・海を避け、陸地に設置してください。";
      if (root.TenkaBattlefield?.buildingAt(battle.layout, x, z, .5)) return "町や村の家屋を避けて設置してください。";
    }
    if (battle.structures.some((item) => item.hp > 0 && overlap(structure, { ...item, w: item.w ?? item.width, d: item.d ?? item.depth, rotation: 0 }))) return "城門・城壁・建物・橋と重ならない場所へ設置してください。";
    if ((battle.fortifications || []).some((item) => item.id !== ignoreId && overlap(structure, item))) return "陣地・木柵を重ねて設置することはできません。";
    if (battle.units.some((unit) => active(unit) && fortificationContains(structure, unit.x, unit.z, 1.1))) return "部隊と重なっています。部隊か施設を移して間隔を空けてください。";
    return null;
  }
  function placeFortification(battle, command = {}) {
    if (battle.phase !== "deployment") return reject(battle, "陣地と木柵を設置できるのは開戦前だけです。");
    const specification = Object.hasOwn(FORTIFICATIONS, command.kind) ? FORTIFICATIONS[command.kind] : null;
    if (!specification || ![command.x, command.z, command.rotation ?? 0].every(Number.isFinite)) return reject(battle, "陣地または木柵と、有効な座標・角度を指定してください。");
    if (!fortificationBudget(battle)[command.kind].remaining) return reject(battle, `${specification.name}は最大${specification.limit}か所までです。既存の施設を移動・撤去してください。`);
    const rotation = ((command.rotation ?? 0) % 360 + 360) % 360;
    const structure = { id: `fieldwork-${battle.fortificationSerial || 1}`, kind: command.kind, side: friendly(battle), x: command.x, z: command.z, rotation, w: specification.w, d: specification.d, h: specification.h, hp: specification.hp, maxHp: specification.hp };
    const message = fortificationPosition(battle, structure);
    if (message) return reject(battle, message);
    const result = copy(battle);
    result.fortificationSerial = (result.fortificationSerial || 1) + 1;
    result.fortifications.push(structure);
    result.ledger.push({ kind: "fieldwork-place", command: { kind: command.kind, x: structure.x, z: structure.z, rotation } });
    return { battle: result, ok: true, message: `${specification.name}を設置しました。開戦前は移動・回転・撤去できます。`, fortificationId: structure.id };
  }
  function moveFortification(battle, command = {}) {
    if (battle.phase !== "deployment") return reject(battle, "陣地と木柵を移動できるのは開戦前だけです。");
    const selected = (battle.fortifications || []).find((item) => item.id === command.id && item.side === friendly(battle));
    if (!selected) return reject(battle, "自分で設置した陣地または木柵を選んでください。");
    const x = command.x ?? selected.x, z = command.z ?? selected.z, angle = command.rotation ?? selected.rotation;
    if (![x, z, angle].every(Number.isFinite)) return reject(battle, "有効な座標と角度を指定してください。");
    const rotation = (angle % 360 + 360) % 360, structure = { ...selected, x, z, rotation };
    const message = fortificationPosition(battle, structure, selected.id);
    if (message) return reject(battle, message);
    const result = copy(battle);
    Object.assign(result.fortifications.find((item) => item.id === selected.id), { x, z, rotation });
    result.ledger.push({ kind: "fieldwork-move", command: { id: selected.id, x, z, rotation } });
    return { battle: result, ok: true, message: `${FORTIFICATIONS[selected.kind].name}の配置・向きを変更しました。`, fortificationId: selected.id };
  }
  function removeFortification(battle, id) {
    if (battle.phase !== "deployment") return reject(battle, "陣地と木柵を撤去できるのは開戦前だけです。");
    const selected = (battle.fortifications || []).find((item) => item.id === id && item.side === friendly(battle));
    if (!selected) return reject(battle, "自分で設置した陣地または木柵を選んでください。");
    const result = copy(battle);
    result.fortifications = result.fortifications.filter((item) => item.id !== id);
    result.ledger.push({ kind: "fieldwork-remove", command: { id } });
    return { battle: result, ok: true, message: `${FORTIFICATIONS[selected.kind].name}を撤去し、設置枠を戻しました。` };
  }
  function segmentHits(structure, fromX, fromZ, toX, toZ, padding = 0) {
    const angle = (structure.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const local = (x, z) => [(x - structure.x) * c + (z - structure.z) * s, -(x - structure.x) * s + (z - structure.z) * c];
    const a = local(fromX, fromZ), b = local(toX, toZ), half = [structure.w / 2 + padding, structure.d / 2 + padding];
    let min = 0, max = 1;
    for (let axis = 0; axis < 2; axis++) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-9) { if (Math.abs(a[axis]) > half[axis]) return false; }
      else {
        const first = (-half[axis] - a[axis]) / delta, last = (half[axis] - a[axis]) / delta;
        min = Math.max(min, Math.min(first, last)); max = Math.min(max, Math.max(first, last));
        if (min > max) return false;
      }
    }
    return true;
  }
  function blocked(battle, x, z, type) {
    if (type === "navy") return !isSea(battle, x, z);
    if (root.TenkaBattlefield?.buildingAt(battle.layout, x, z)) return true;
    for (const water of battle.layout.water) {
      if (insidePolygon(x, z, water.polygon) && !battle.structures.some((structure) => (structure.kind || structure.type) === "bridge" && contains(structure, x, z, 0.8))) return true;
    }
    if (regionalRules(battle) && (battle.fortifications || []).some((item) => item.kind === "palisade" && item.hp > 0 && fortificationContains(item, x, z, .65))) return true;
    return battle.structures.some((structure) => structure.hp > 0 && !structure.passable && ["wall", "palisade", "gate", "hall"].includes(structure.kind || structure.type) && contains(structure, x, z, (structure.kind || structure.type) === "hall" ? 0.15 : 0.5));
  }
  function seed(value) {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return hash;
  }
  function doctrine(home, battle) {
    const terrain = battle.layout.landscape?.profile?.id || battle.terrain;
    if (["takeda", "uesugi", "nambu", "date"].includes(home.clan)) return { id: "mobile-wings", name: "騎馬の両翼・歩兵の中央", frontage: 1.15 };
    if (["oda", "shimazu", "suzuki", "saika", "otomo"].includes(home.clan) || ["薩摩", "大隅", "紀伊", "近江", "摂津"].includes(home.province)) return { id: "missile-line", name: "射撃隊と槍隊の段陣", frontage: 1.08 };
    if (home.coastal && ["mori", "chosokabe", "ryukyu"].includes(home.clan)) return { id: "coastal-wings", name: "陸上の備えと沿岸の水軍", frontage: 1.1 };
    if (["mountain", "hill"].includes(terrain)) return { id: "terrain-defense", name: "山道を押さえる縦深陣", frontage: .8 };
    return { id: "balanced-lines", name: "歩兵・射撃・騎馬の三段陣", frontage: 1 };
  }
  function adaptDeployments(battle) {
    const landscape = battle.layout.landscape, occupied = [];
    battle.armyDeployment = { version: 2 };
    for (const side of ["attacker", "defender"]) {
      const home = side === "attacker" ? battle.sourceCastle : battle.targetCastle;
      const strategy = doctrine(home, battle), salt = seed(`${home.id}:${home.clan}:${battle.targetId}:${battle.mode}`);
      const anchor = landscape?.deploymentPlan?.[side] || { x: 0, z: side === "attacker" ? 34 : -27, frontage: 38 };
      const forward = side === "attacker" ? -1 : 1, zone = deploymentZone(battle, side);
      const units = battle.units.filter((unit) => unit.side === side), ranks = {};
      battle.armyDeployment[side] = { ...strategy, clan: home.clan, province: home.province, terrain: landscape?.profile?.id || battle.terrain, units: Object.fromEntries(TYPES.map((type) => [type, units.filter((unit) => unit.type === type).reduce((amount, unit) => amount + unit.troops, 0)])) };
      for (const unit of units) {
        const index = ranks[unit.type] || 0; ranks[unit.type] = index + 1;
        const ranged = ["archer", "firearm"].includes(unit.type), cavalry = unit.type === "cavalry";
        unit.formation = cavalry ? ["mountain", "hill"].includes(battle.terrain) ? "loose" : "wedge" : ranged ? "line" : side === "defender" ? "defensive" : strategy.id === "mobile-wings" ? "wedge" : "line";
        if (unit.type === "navy") {
          // The actual regional roster supplies ships. Search only navigable
          // sea; never convert infantry into ships or manufacture soldiers.
          const sea = battle.layout.water.find((water) => water.type === "sea");
          if (sea) {
            const seaMin = Math.min(...sea.polygon.map((point) => point[0])), seaMax = Math.max(...sea.polygon.map((point) => point[0]));
            const z = clamp(anchor.z + (index - 1) * 6, zone.zMin + 2, zone.zMax - 2);
            // A regional shoreline meanders: its global easternmost vertex is
            // not necessarily water at this ship's north/south coordinate.
            for (let x = clamp(seaMax - 7 - index % 3 * 5, seaMin + 3, seaMax - 1); x >= seaMin + 2; x -= 3) {
              if (!blocked(battle, x, z, "navy")) { Object.assign(unit, { x, z, targetX: x, targetZ: z }); break; }
            }
          }
          continue;
        }
        let desiredX, desiredZ;
        const candidates = [];
        if (battle.mode === "siege" && side === "defender") {
          // Each real game's bailey supplies distinct viable defensive ground.
          // Archers cover outer approaches, firearms and reserves cover the
          // inner bailey; the player can replace this proposal before opening.
          const baileys = [...battle.layout.baileys];
          baileys.sort((a, b) => ranged && unit.type === "archer" ? b.z - a.z : a.z - b.z);
          for (const bailey of baileys) {
            const centerX = bailey.x, centerZ = bailey.z;
            for (let row = 0; row < Math.ceil(bailey.depth / 2.7); row++) for (let column = 0; column < Math.ceil(bailey.width / 3); column++) {
              const x = centerX + (column - Math.floor(bailey.width / 3) / 2) * 3, z = centerZ + (row - Math.floor(bailey.depth / 2.7) / 2) * 2.7;
              if (Math.abs(x - centerX) < bailey.width / 2 - 1 && Math.abs(z - centerZ) < bailey.depth / 2 - 1) candidates.push({ x, z, score: Math.hypot(x - centerX, z - centerZ) + candidates.length / 1000 });
            }
          }
          desiredX = unit.x; desiredZ = unit.z;
        } else {
          const spacing = 5.2 * strategy.frontage * (anchor.frontage || 42) / 42, column = index % 5 - 2, row = Math.floor(index / 5);
          const jitter = ((salt >>> (index % 12)) % 5 - 2) * .7;
          desiredX = anchor.x + (cavalry ? (index % 2 ? -1 : 1) * (18 + Math.floor(index / 2) * 4) : column * spacing) + jitter;
          desiredZ = anchor.z - forward * ((ranged ? 9 : cavalry ? 5 : 0) + row * 5) + (strategy.id === "terrain-defense" ? Math.abs(column) * 1.4 : 0);
        }
        // Ranked search keeps the initial proposal on land, clear of masonry,
        // villages and other units, including unusual island castle plans.
        for (let radius = 0; radius <= 24; radius += 2) {
          const offsets = radius ? [[-radius, 0], [radius, 0], [0, -radius], [0, radius], [-radius, -radius], [radius, radius], [-radius, radius], [radius, -radius]] : [[0, 0]];
          for (const [dx, dz] of offsets) candidates.push({ x: desiredX + dx, z: desiredZ + dz, score: 1000 + radius });
        }
        candidates.sort((a, b) => a.score - b.score);
        const position = candidates.find(({ x, z }) => x >= zone.xMin + 1 && x <= zone.xMax - 1 && z >= zone.zMin + 1 && z <= zone.zMax - 1 && !blocked(battle, x, z, unit.type) && !occupied.some((other) => Math.hypot(other.x - x, other.z - z) < 2.5));
        if (position) Object.assign(unit, { x: position.x, z: position.z, targetX: position.x, targetZ: position.z });
        occupied.push({ x: unit.x, z: unit.z });
        if (side !== friendly(battle) && battle.mode === "field" && cavalry) unit.order = "attack";
      }
    }
    // The default lines remain close enough for immediate combat; a player
    // placing units on the outer battlefield still has time to march to battle.
    const box = bounds(battle);
    battle.timeLimit = Math.max(540, Math.ceil(Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) / 1.25 + 180));
  }
  function event(battle, text) {
    battle.events.push({ time: battle.time || 0, text });
    battle.events = battle.events.slice(-40);
  }
  function reject(battle, message) { return { battle, ok: false, message }; }
  function prepare(battle, options = {}) {
    battle.playerSide = options.defending ? "defender" : battle.playerSide || "attacker";
    battle.defending = battle.playerSide === "defender";
    battle.tacticsVersion = 1;
    battle.fortifications = battle.fortifications || [];
    battle.fortificationSerial = battle.fortificationSerial || 1;
    battle.supply = battle.supply || {
      attacker: { initial: Math.max(0, options.attackerFood ?? 100000), consumed: 0, exhausted: false },
      defender: { initial: Math.max(0, options.defenderFood ?? 100000), consumed: 0, exhausted: false },
    };
    battle.terrainFeatures = battle.terrainFeatures || [
      { type: "forest", x: -27, z: 22, radius: 9, name: "南の林" },
      { type: "forest", x: 25, z: -25, radius: 9, name: "北の林" },
    ];
    for (const unit of battle.units) {
      unit.formation = unit.formation || "line";
      if (unit.ambush == null) unit.ambush = false;
      if (unit.revealed == null) unit.revealed = true;
      if (unit.ambushUntil == null) unit.ambushUntil = 0;
      if (battle.defending && unit.side === "attacker") unit.order = "attack";
    }
    if (battle.defending) {
      battle.availableTroops = battle.units.filter((unit) => unit.side === "defender").reduce((total, unit) => total + unit.maxTroops, 0);
      battle.availableUnits = Object.fromEntries(TYPES.map((type) => [type, battle.units.filter((unit) => unit.side === "defender" && unit.type === type).reduce((total, unit) => total + unit.maxTroops, 0)]));
      battle.friendlyOfficers = copy(battle.defenderOfficers);
    } else battle.friendlyOfficers = copy(battle.eligibleOfficers);
    if (options.battlefieldVersion !== 0) root.TenkaBattlefield?.apply(battle, options.battlefieldVersion ?? root.TenkaBattlefield.version);
    if (regionalRules(battle)) adaptDeployments(battle);
    return battle;
  }
  function create(options) {
    const battle = original.create(options);
    return prepare(battle, { attackerFood: Math.max(0, options.state.food - 600), defenderFood: battle.targetCastle.food || 0, battlefieldVersion: options.battlefieldVersion });
  }
  function createDefense(state, threat = state.pendingDefense, options = {}) {
    if (!original || !threat) throw Error("迎撃する侵攻軍が見つかりません。");
    const source = state.castles.find((castle) => castle.id === threat.sourceId);
    const target = state.castles.find((castle) => castle.id === threat.targetId);
    if (!source || !target || target.clan !== state.playerClan || source.clan === state.playerClan || !source.neighbors.includes(target.id)) throw Error("侵攻先と自領の関係を確認してください。");
    const enemyState = copy(state);
    enemyState.playerClan = source.clan;
    enemyState.actionPoints = Math.max(1, enemyState.actionPoints);
    enemyState.gold = Math.max(120, source.gold || 0);
    enemyState.food = Math.max(600, source.food || 0);
    // The enemy's pacts have already been checked by the strategic AI.
    enemyState.alliances = [];
    const battle = original.create({ state: enemyState, sourceId: source.id, targetId: target.id, mode: threat.mode || "siege" });
    battle.stateStamp = stamp(state);
    battle.id = `tactical-defense-${battle.stateStamp}-${source.id}-${target.id}-${battle.mode}`;
    return prepare(battle, { defending: true, attackerFood: Math.max(0, (source.food || 0) - 600), defenderFood: state.food, battlefieldVersion: options.battlefieldVersion });
  }
  function deploy(battle, command = {}) {
    if (battle.phase !== "deployment") return reject(battle, "配置を変えられるのは開戦前だけです。");
    const side = friendly(battle), unit = battle.units.find((item) => item.id === command.unitId && item.side === side);
    if (!unit) return reject(battle, "自軍の部隊を選んでください。");
    const x = command.x ?? unit.x, z = command.z ?? unit.z, type = command.type ?? unit.type, troops = command.troops ?? unit.troops;
    const zone = deploymentZone(battle, side);
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < zone.xMin || x > zone.xMax || z < zone.zMin || z > zone.zMax) return reject(battle, side === "defender" ? "守備軍は城側（z -5以下）の陸地・曲輪へ配置してください。" : "攻撃軍は手前側（z 10以上）へ配置してください。");
    if (!TYPES.includes(type) || !Number.isInteger(troops) || troops < 0 || troops > 600) return reject(battle, "一部隊は五兵科から選び、兵数は零から六百の整数にしてください。");
    const home = side === "defender" ? battle.targetCastle : battle.sourceCastle;
    if (type === "navy" && (!home.coastal || !battle.coastal)) return reject(battle, "水軍は沿岸拠点の海上へ配置してください。");
    if (blocked(battle, x, z, type)) return reject(battle, "堀・川・海・城壁・木柵・町や村の家屋を避け、水軍は海上へ配置してください。");
    if (troops > 0 && (battle.fortifications || []).some((item) => item.kind === "palisade" && fortificationContains(item, x, z, 0.8))) return reject(battle, "木柵の上には配置できません。柵の後ろへ部隊を配置してください。");
    const others = battle.units.filter((item) => item.side === side && item.id !== unit.id);
    if (others.filter((item) => item.type === type).reduce((total, item) => total + item.troops, 0) + troops > battle.availableUnits[type] || others.reduce((total, item) => total + item.troops, 0) + troops > battle.availableTroops) return reject(battle, "出陣できる兵科別の兵数を超えています。");
    const commanderId = Object.hasOwn(command, "commanderId") ? command.commanderId : unit.commanderId;
    const officers = battle.friendlyOfficers || (side === "defender" ? battle.defenderOfficers : battle.eligibleOfficers);
    const commander = commanderId ? officers.find((officer) => officer.id === commanderId) : null;
    if (commanderId && (!commander || others.some((item) => item.commanderId === commanderId))) return reject(battle, "活動中の自家武将を、一人につき一部隊に配置してください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unit.id);
    const ranges = { ashigaru: 2.5, archer: 18, cavalry: 3.5, firearm: 22, navy: 24 };
    Object.assign(selected, { x, z, targetX: x, targetZ: z, type, troops, maxTroops: troops, commanderId: commanderId || null, commanderName: commander?.name || "組頭", range: ranges[type] });
    if (selected.ambush && !canAmbush(result, selected)) { selected.ambush = false; selected.revealed = true; }
    result.ledger.push({ kind: "deploy", command: { unitId: unit.id, x, z, type, troops, commanderId: commanderId || null } });
    return { battle: result, ok: true, message: "部隊の配置を変更しました。" };
  }
  function order(battle, command = {}) {
    if (command.order === "ambush") return ambush(battle, command.unitId);
    if (battle.phase !== "fighting") return reject(battle, "命令を出せるのは合戦中だけです。");
    const side = friendly(battle), unit = battle.units.find((item) => item.id === command.unitId && item.side === side && active(item));
    if (!unit || !["move", "attack", "hold", "retreat"].includes(command.order)) return reject(battle, "活動中の自軍部隊と有効な命令を選んでください。");
    const x = command.x ?? unit.x, z = command.z ?? unit.z, box = bounds(battle);
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < box.minX + 1 || x > box.maxX - 1 || z < box.minZ + 1 || z > box.maxZ - 1) return reject(battle, "戦場の範囲内を指定してください。");
    if (battle.battlefieldVersion && command.order === "move" && blocked(battle, x, z, unit.type)) return reject(battle, "移動先は通行できる地面・橋・浅瀬を指定し、水軍は海上を選んでください。");
    if (command.targetId && !battle.units.some((item) => item.id === command.targetId && item.side !== side) && !(side === "attacker" && battle.structures.some((item) => item.id === command.targetId)) && !(battle.fortifications || []).some((item) => item.id === command.targetId && item.side !== side && item.hp > 0)) return reject(battle, "敵部隊または攻撃可能な施設を選んでください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unit.id);
    Object.assign(selected, { order: command.order, targetId: command.targetId || null, targetX: x, targetZ: command.order === "retreat" ? side === "attacker" ? box.maxZ - 1 : box.minZ + 1 : z, status: command.order === "retreat" ? "retreating" : "fighting" });
    if (command.order !== "hold") { selected.ambush = false; selected.revealed = true; }
    result.ledger.push({ kind: "order", command: { unitId: unit.id, order: command.order, x, z, targetId: command.targetId || null } });
    return { battle: result, ok: true, message: "部隊へ命令を伝えました。" };
  }
  function formation(battle, unitId, value) {
    if (!["deployment", "fighting"].includes(battle.phase) || !FORMATIONS[value]) return reject(battle, "布陣中または合戦中に陣形を選んでください。");
    const unit = battle.units.find((item) => item.id === unitId && item.side === friendly(battle) && active(item));
    if (!unit) return reject(battle, "自軍の部隊を選んでください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unitId);
    selected.formation = value;
    result.ledger.push({ kind: "formation", command: { unitId, formation: value } });
    return { battle: result, ok: true, message: `${selected.commanderName}隊を${FORMATIONS[value].name}に変更。${FORMATIONS[value].description}。` };
  }
  function canAmbush(battle, unit) {
    return unit.type !== "navy" && unit.type !== "cavalry" && (["mountain", "hill", "forest"].includes(battle.terrain) || (battle.terrainFeatures || []).some((feature) => feature.type === "forest" && Math.hypot(unit.x - feature.x, unit.z - feature.z) <= feature.radius));
  }
  function ambush(battle, unitId) {
    if (!["deployment", "fighting"].includes(battle.phase)) return reject(battle, "布陣中または合戦中に伏兵を指定してください。");
    const unit = battle.units.find((item) => item.id === unitId && item.side === friendly(battle) && active(item));
    if (!unit || !canAmbush(battle, unit)) return reject(battle, "足軽・弓・鉄砲を山・丘陵、または南西／北東の林へ配置すると伏兵にできます。");
    if (battle.units.some((enemy) => enemy.side !== unit.side && active(enemy) && Math.hypot(unit.x - enemy.x, unit.z - enemy.z) < 14)) return reject(battle, "敵が近いため身を隠せません。距離を十四以上取ってください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unitId);
    selected.ambush = !selected.ambush;
    selected.revealed = !selected.ambush;
    selected.order = "hold";
    selected.targetId = null;
    selected.ambushUntil = 0;
    result.ledger.push({ kind: "ambush", command: { unitId } });
    return { battle: result, ok: true, message: selected.ambush ? "伏兵を配置。敵が接近すると奇襲し、短時間だけ攻撃と士気崩しが強まります。" : "伏兵を解除しました。" };
  }
  function damage(battle, attacker, target, structure) {
    if (attacker.fieldworkTarget) return 0;
    if (attacker.ambush && !attacker.revealed) return 0;
    if (target.ambush && !target.revealed && Math.hypot(attacker.x - target.x, attacker.z - target.z) > 11) return 0;
    const attackFormation = FORMATIONS[attacker.formation] || FORMATIONS.line;
    const defendFormation = FORMATIONS[target.formation] || FORMATIONS.line;
    const ranged = ["archer", "firearm", "navy"].includes(attacker.type);
    let factor = ranged ? attackFormation.ranged : attackFormation.attack;
    if (!structure) {
      factor *= MATCHUPS[attacker.type]?.[target.type] || 1;
      factor /= defendFormation.defense;
      if (ranged && target.formation === "loose") factor *= 0.74;
      if (!ranged && target.formation === "loose") factor *= 1.13;
      if (attacker.type === "cavalry" && target.formation === "defensive") factor *= 0.73;
      const deltaX = attacker.x - target.x, deltaZ = attacker.z - target.z, distance = Math.hypot(deltaX, deltaZ);
      const facing = distance ? (deltaX * (target.facingX || 0) + deltaZ * (target.facingZ || (target.side === "attacker" ? -1 : 1))) / distance : 1;
      if (facing < -0.35 && target.formation !== "defensive") factor *= 1.3;
      if (["mountain", "hill", "forest"].includes(battle.terrain) && target.order === "hold") factor *= 0.86;
      if (attacker.ambushUntil > battle.time) factor *= 1.65;
      if (ranged && (battle.terrainFeatures || []).some((feature) => feature.type === "forest" && Math.hypot(target.x - feature.x, target.z - feature.z) <= feature.radius)) factor *= 0.82;
      factor *= root.TenkaBattlefield?.coverFactor(battle.layout, target, ranged) ?? 1;
      if ((battle.fortifications || []).some((item) => item.kind === "camp" && item.side === target.side && item.hp > 0 && Math.hypot(target.x - item.x, target.z - item.z) <= 9)) factor /= 1.12;
      if ((battle.fortifications || []).some((item) => item.kind === "palisade" && item.side === target.side && item.hp > 0 && Math.hypot(target.x - item.x, target.z - item.z) <= 9 && segmentHits(item, attacker.x, attacker.z, target.x, target.z))) factor *= ranged ? 0.68 : 0.82;
    }
    return original.damage(battle, attacker, target, structure) * factor;
  }
  function fencePenetration(structure, x, z, padding = .45) {
    const angle = (structure.rotation || 0) * Math.PI / 180, dx = x - structure.x, dz = z - structure.z;
    return Math.min(structure.w / 2 + padding - Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)), structure.d / 2 + padding - Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)));
  }
  function segmentOpen(battle, x, z, targetX, targetZ, fences) {
    if (fences.some((item) => segmentHits(item, x, z, targetX, targetZ, .72))) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(targetX - x, targetZ - z) / .45));
    for (let step = 1; step <= steps; step++) {
      const px = x + (targetX - x) * step / steps, pz = z + (targetZ - z) * step / steps;
      if (blocked(battle, px, pz, "ashigaru") || root.TenkaBattlefield?.blocked(battle.layout, px, pz, .5)) return false;
    }
    return true;
  }
  function fenceNavigationTarget(battle, unit, targetX, targetZ) {
    if (!regionalRules(battle) || unit.type === "navy") return { x: targetX, z: targetZ };
    const fences = (battle.fortifications || []).filter((item) => item.kind === "palisade" && item.hp > 0);
    if (!fences.length) { delete unit.fenceRoute; return { x: targetX, z: targetZ }; }
    const overlapping = fences.find((item) => fortificationContains(item, unit.x, unit.z, .45));
    if (overlapping) {
      // Old or externally restored snapshots may start on a stake. Release
      // them through the nearest face rather than teleporting across the fence.
      const angle = (overlapping.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), dx = unit.x - overlapping.x, dz = unit.z - overlapping.z;
      let lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (overlapping.w / 2 - Math.abs(lx) < overlapping.d / 2 - Math.abs(lz)) lx = (lx < 0 ? -1 : 1) * (overlapping.w / 2 + .9);
      else lz = (lz < 0 ? -1 : 1) * (overlapping.d / 2 + .9);
      return { x: overlapping.x + lx * c - lz * s, z: overlapping.z + lx * s + lz * c };
    }
    // An advancing enemy may deliberately break hostile stakes. Its own
    // fieldworks, and all obstacles during a withdrawal, require a detour.
    const mustAvoid = fences.filter((item) => item.side === unit.side || unit.order === "retreat");
    if (!mustAvoid.some((item) => segmentHits(item, unit.x, unit.z, targetX, targetZ, .72))) { delete unit.fenceRoute; return { x: targetX, z: targetZ }; }
    const signature = fences.map((item) => `${item.id}:${item.x}:${item.z}:${item.rotation}`).join("|");
    let saved = unit.fenceRoute;
    if (!saved || saved.signature !== signature || Math.hypot(saved.goalX - targetX, saved.goalZ - targetZ) > 3 || !saved.points.length) {
      const points = [[unit.x, unit.z], [targetX, targetZ], ...fences.flatMap((item) => footprint(item, 1.05))];
      const distance = Array(points.length).fill(Infinity), previous = Array(points.length).fill(-1), visited = new Set();
      distance[0] = 0;
      while (visited.size < points.length) {
        let current = -1;
        for (let index = 0; index < points.length; index++) if (!visited.has(index) && (current < 0 || distance[index] < distance[current])) current = index;
        if (current < 0 || !Number.isFinite(distance[current]) || current === 1) break;
        visited.add(current);
        for (let index = 1; index < points.length; index++) {
          if (visited.has(index) || !segmentOpen(battle, ...points[current], ...points[index], fences)) continue;
          const nextDistance = distance[current] + Math.hypot(points[index][0] - points[current][0], points[index][1] - points[current][1]);
          if (nextDistance < distance[index]) { distance[index] = nextDistance; previous[index] = current; }
        }
      }
      const route = [];
      if (Number.isFinite(distance[1])) for (let index = 1; index !== 0; index = previous[index]) route.unshift(points[index]);
      saved = unit.fenceRoute = { signature, goalX: targetX, goalZ: targetZ, points: route };
    }
    while (saved.points.length && Math.hypot(saved.points[0][0] - unit.x, saved.points[0][1] - unit.z) < .7) saved.points.shift();
    while (saved.points.length > 1 && segmentOpen(battle, unit.x, unit.z, ...saved.points[1], fences)) saved.points.shift();
    return saved.points.length ? { x: saved.points[0][0], z: saved.points[0][1] } : { x: targetX, z: targetZ };
  }
  function move(battle, unit, x, z) {
    if (unit.fieldworkTarget) return;
    if (unit.ambush && !unit.revealed) return;
    if (battle.defending && unit.side === "defender" && unit.order === "hold") return;
    // The engine chooses a normalized movement vector; scaling its target distance
    // preserves collision handling while changing the step size below.
    const oldX = unit.x, oldZ = unit.z;
    const commandedFieldwork = (battle.fortifications || []).find((item) => item.id === unit.targetId && item.side !== unit.side && item.hp > 0);
    if (commandedFieldwork && unit.order === "attack") { x = commandedFieldwork.x; z = commandedFieldwork.z; }
    if (battle.mode === "siege" && unit.type !== "navy") {
      const direction = Math.sign(z - oldZ);
      // The base path follower advances within two units of a waypoint. At a
      // narrow gate that can turn a troop into the adjacent, intact wall before
      // it has crossed the opening. Finish crossing the gate's center first.
      const passage = battle.structures.filter((structure) => {
        if ((structure.kind || structure.type) !== "gate" || (structure.hp > 0 && !(battle.defending && unit.side === "defender"))) return false;
        const relative = (structure.z - oldZ) * direction;
        return direction && relative >= -1.6 && (z - structure.z) * direction > 1.6 && relative <= Math.abs(z - oldZ) + 0.1;
      }).sort((left, right) => Math.abs(left.z - oldZ) - Math.abs(right.z - oldZ))[0];
      if (passage) { x = passage.x; z = passage.z + direction * 1.8; }
    }
    const gates = battle.defending && unit.side === "defender" ? battle.structures.filter((structure) => (structure.kind || structure.type) === "gate" && !structure.passable) : [];
    // A garrison can use its own gate for a sortie; enemies must break it.
    for (const gate of gates) gate.passable = true;
    const avoidFences = regionalRules(battle) ? (battle.fortifications || []).filter((item) => item.kind === "palisade" && item.hp > 0 && (item.side === unit.side || unit.order === "retreat")) : [];
    const navigation = avoidFences.length ? {
      key: avoidFences.map((item) => `${item.id}:${item.x}:${item.z}:${item.rotation}`).join("|"),
      blocked: (px, pz, padding = .7) => avoidFences.some((item) => fortificationContains(item, px, pz, padding)),
      segmentBlocked: (ax, az, bx, bz, padding = .7) => avoidFences.some((item) => segmentHits(item, ax, az, bx, bz, padding)),
    } : undefined;
    const countrysideTarget = root.TenkaBattlefield?.navigationTarget(battle, unit, x, z, navigation);
    if (countrysideTarget) { x = countrysideTarget.x; z = countrysideTarget.z; }
    const detour = fenceNavigationTarget(battle, unit, x, z);
    x = detour.x; z = detour.z;
    original.move(battle, unit, x, z);
    const factor = (FORMATIONS[unit.formation] || FORMATIONS.line).speed * (root.TenkaBattlefield?.movementFactor(battle.layout, { ...unit, x: oldX, z: oldZ }) ?? 1);
    if (factor !== 1) {
      const nextX = oldX + (unit.x - oldX) * factor, nextZ = oldZ + (unit.z - oldZ) * factor;
      if (!blocked(battle, nextX, nextZ, unit.type)) { unit.x = nextX; unit.z = nextZ; }
    }
    if (root.TenkaBattlefield?.blocked(battle.layout, unit.x, unit.z, 0) && unit.type !== "navy") { unit.x = oldX; unit.z = oldZ; }
    for (const gate of gates) gate.passable = false;
    const obstruction = unit.type !== "navy" && (battle.fortifications || []).find((item) => {
      if (item.hp <= 0 || item.kind !== "palisade" || (!regionalRules(battle) && item.side === unit.side) || !segmentHits(item, oldX, oldZ, unit.x, unit.z, .45)) return false;
      if (regionalRules(battle) && fortificationContains(item, oldX, oldZ, .45) && fencePenetration(item, unit.x, unit.z) < fencePenetration(item, oldX, oldZ) - 1e-8) return false;
      return true;
    });
    if (obstruction) {
      unit.x = oldX; unit.z = oldZ;
      // Even after the garrison is defeated, a surviving fence on the final
      // route to the bailey must be attacked instead of causing a path stall.
      if (unit.order !== "retreat" && obstruction.side !== unit.side) {
        obstruction.hp = Math.max(0, obstruction.hp - original.damage(battle, unit, obstruction, true));
        unit.fieldworkTarget = obstruction.id;
      }
    }
  }
  function tick(battle) {
    if (battle.phase !== "fighting") return;
    const fieldworkDamage = new Map();
    for (const unit of battle.units) {
      if (!active(unit) || unit.order === "retreat" || (unit.ambush && !unit.revealed)) continue;
      if (unit.morale < Math.max(unit.initialMorale, 85) && (battle.fortifications || []).some((item) => item.kind === "camp" && item.side === unit.side && item.hp > 0 && Math.hypot(unit.x - item.x, unit.z - item.z) <= 9)) unit.morale = Math.min(Math.max(unit.initialMorale, 85), unit.morale + 0.025);
      const enemies = battle.units.filter((enemy) => enemy.side !== unit.side && active(enemy));
      const target = enemies.find((enemy) => enemy.id === unit.targetId) || enemies.sort((a, b) => Math.hypot(unit.x - a.x, unit.z - a.z) - Math.hypot(unit.x - b.x, unit.z - b.z))[0] || (battle.mode === "siege" && unit.side === "attacker" ? battle.captureZone : null);
      const obstacles = (battle.fortifications || []).filter((item) => {
        if (item.hp <= 0 || item.side === unit.side || unit.type === "navy") return false;
        const reach = unit.range + Math.max(item.w, item.d) / 2;
        return Math.hypot(unit.x - item.x, unit.z - item.z) <= reach && (unit.targetId === item.id || (item.kind === "palisade" && target && segmentHits(item, unit.x, unit.z, target.x, target.z, 0.45)) || (item.kind === "camp" && Math.hypot(unit.x - item.x, unit.z - item.z) < 5));
      }).sort((a, b) => Math.hypot(unit.x - a.x, unit.z - a.z) - Math.hypot(unit.x - b.x, unit.z - b.z));
      if (obstacles.length) {
        const obstacle = obstacles[0];
        fieldworkDamage.set(obstacle.id, (fieldworkDamage.get(obstacle.id) || 0) + original.damage(battle, unit, obstacle, true));
        // A unit spends this tick attacking the fence, never simultaneously
        // dealing its full attack to the soldiers protected behind it.
        unit.fieldworkTarget = obstacle.id;
      }
    }
    for (const unit of battle.units) {
      if (!active(unit) || !unit.ambush || unit.revealed) continue;
      const nearby = battle.units.filter((enemy) => enemy.side !== unit.side && active(enemy) && Math.hypot(enemy.x - unit.x, enemy.z - unit.z) <= 11);
      if (nearby.length) {
        unit.revealed = true;
        unit.ambushUntil = battle.time + 8;
        unit.order = "attack";
        unit.targetId = nearby[0].id;
        for (const enemy of nearby) enemy.morale = Math.max(0, enemy.morale - 9);
        event(battle, `${unit.commanderName}隊の伏兵が姿を現し、敵の側面を急襲！`);
      }
    }
    for (const side of ["attacker", "defender"]) {
      const supply = battle.supply?.[side];
      if (!supply) continue;
      const troops = battle.units.filter((unit) => unit.side === side && active(unit)).reduce((total, unit) => total + unit.troops, 0);
      // One tactical minute represents a field day: 1,000 troops consume 100 food.
      supply.consumed += (troops * 0.1 * STEP) / 60;
      if (supply.consumed > supply.initial) {
        for (const unit of battle.units) if (unit.side === side && active(unit)) unit.morale = Math.max(0, unit.morale - 0.035);
        if (!supply.exhausted) { supply.exhausted = true; event(battle, `${side === friendly(battle) ? "自軍" : "敵軍"}の兵糧が尽き、士気が低下しています。`); }
      }
    }
    const sorties = [];
    if (battle.defending) for (const unit of battle.units) {
      if (unit.side !== "defender" || unit.order !== "attack" || !active(unit) || (unit.ambush && !unit.revealed)) continue;
      const enemies = battle.units.filter((enemy) => enemy.side !== unit.side && active(enemy));
      const enemy = enemies.find((candidate) => candidate.id === unit.targetId) || enemies.sort((left, right) => Math.hypot(left.x - unit.x, left.z - unit.z) - Math.hypot(right.x - unit.x, right.z - unit.z))[0];
      if (!enemy) continue;
      sorties.push(unit.id);
      unit.order = "move";
      unit.targetX = enemy.x;
      unit.targetZ = enemy.z;
    }
    original.tick(battle);
    for (const unit of battle.units) delete unit.fieldworkTarget;
    for (const structure of battle.fortifications || []) {
      structure.hp = Math.max(0, structure.hp - (fieldworkDamage.get(structure.id) || 0));
      if (!structure.hp && !structure.destroyedLogged) {
        structure.destroyedLogged = true;
        event(battle, `${structure.side === friendly(battle) ? "自軍" : "敵軍"}の${FORTIFICATIONS[structure.kind].name}が破壊されました。`);
      }
    }
    for (const unit of battle.units) if (sorties.includes(unit.id) && active(unit) && unit.order !== "retreat") unit.order = "attack";
    if (battle.defending && battle.phase === "finished") {
      battle.playerWon = battle.winner === "defender";
      if (battle.playerWon) event(battle, "守備軍が敵の侵攻を退けました。城と領民を守り抜きました。");
      else event(battle, "本郭を失いました。残存兵と家臣の行方を評定で確認してください。");
    }
  }
  function result(battle) {
    const report = original.result(battle);
    report.playerSide = friendly(battle);
    report.defending = !!battle.defending;
    report.playerWon = battle.winner === friendly(battle);
    report.supplyConsumed = Math.ceil(battle.supply?.[friendly(battle)]?.consumed || 0);
    report.enemySupplyConsumed = Math.ceil(battle.supply?.[friendly(battle) === "attacker" ? "defender" : "attacker"]?.consumed || 0);
    report.tacticsVersion = 1;
    if (battle.defending) {
      report.message = `${battle.targetCastle.name}の籠城戦は${report.playerWon ? "防衛成功" : "落城"}。守備軍の損失 ${report.enemyCasualties.toLocaleString("ja-JP")}、敵軍の損失 ${report.casualties.toLocaleString("ja-JP")}。兵糧 ${report.supplyConsumed.toLocaleString("ja-JP")}を消費。`;
      report.phases[0].text = "城内の曲輪に守備隊を配置し、籠城を指揮しました。";
      report.phases[2].title = report.playerWon ? "防衛成功" : "落城";
    } else report.message += ` 兵糧 ${report.supplyConsumed.toLocaleString("ja-JP")}を追加消費。`;
    return report;
  }
  function verify(state, battle) {
    try {
      if (!battle || battle.phase !== "finished" || battle.stateStamp !== stamp(state) || !Array.isArray(battle.ledger) || battle.ledger.length > 8000) return null;
      const battlefieldVersion = battle.battlefieldVersion ?? 0;
      if (![0, 1, root.TenkaBattlefield?.version].includes(battlefieldVersion)) return null;
      let replay = battle.defending ? createDefense(state, { sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode }, { battlefieldVersion }) : create({ state, sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode, battlefieldVersion });
      for (const record of battle.ledger) {
        if (["deploy", "order", "formation", "ambush", "fieldwork-place", "fieldwork-move", "fieldwork-remove"].includes(record.kind)) {
          const answer = record.kind === "deploy" ? deploy(replay, record.command) : record.kind === "order" ? order(replay, record.command) : record.kind === "formation" ? formation(replay, record.command.unitId, record.command.formation) : record.kind === "fieldwork-place" ? placeFortification(replay, record.command) : record.kind === "fieldwork-move" ? moveFortification(replay, record.command) : record.kind === "fieldwork-remove" ? removeFortification(replay, record.command.id) : ambush(replay, record.command.unitId);
          if (!answer.ok) return null;
          replay = answer.battle;
        } else if (record.kind === "start" && replay.phase === "deployment") replay = original.start(replay);
        else if (record.kind === "tick" && replay.phase === "fighting" && Number.isInteger(record.steps) && record.steps > 0 && record.steps <= 8) {
          for (let step = 0; step < record.steps && replay.phase === "fighting"; step++) tick(replay);
          replay.ledger.push(copy(record));
        } else return null;
      }
      // Real-time fractional remainders are not part of the command ledger.
      replay.stepRemainder = battle.stepRemainder;
      return replay.phase === "finished" && JSON.stringify(replay) === JSON.stringify(battle) ? result(replay) : null;
    } catch (_) { return null; }
  }
  function distribute(units, count) {
    const total = sum(units), result = Object.fromEntries(TYPES.map((type) => [type, 0]));
    count = clamp(Math.floor(count), 0, total);
    if (!count || !total) return result;
    let rest = count;
    for (const type of TYPES) { result[type] = Math.floor((units[type] || 0) * count / total); rest -= result[type]; }
    for (const type of TYPES) if (rest && result[type] < (units[type] || 0)) { result[type]++; rest--; }
    return result;
  }
  function settleDefense(state, battle, core = {}) {
    const report = verify(state, battle);
    if (!report || !report.defending) return { ok: false, state, message: "籠城戦の記録を検証できません。" };
    const next = copy(state), source = next.castles.find((castle) => castle.id === report.sourceId), target = next.castles.find((castle) => castle.id === report.targetId);
    if (!source || !target || target.clan !== next.playerClan || source.clan === next.playerClan) return { ok: false, state, message: "侵攻時から領有関係が変わっています。" };
    const getArmy = (castle) => {
      if (core.army) return core.army(next, castle.id);
      next.armies ||= {};
      return next.armies[castle.id] ||= { commanderId: null, units: { ashigaru: castle.troops, archer: 0, cavalry: 0, firearm: 0, navy: 0 } };
    };
    const lose = (castle, losses) => {
      const army = getArmy(castle);
      for (const type of TYPES) army.units[type] = Math.max(0, (army.units[type] || 0) - (losses[type] || 0));
      castle.troops = Math.max(0, castle.troops - sum(losses));
      if (sum(army.units) > castle.troops) army.units = distribute(army.units, castle.troops);
      return army;
    };
    const sourceArmy = lose(source, report.casualtyUnits);
    lose(target, report.defenderCasualtyUnits);
    next.food = Math.max(0, next.food - report.supplyConsumed);
    source.gold = Math.max(0, source.gold - 120);
    source.food = Math.max(0, source.food - 600 - report.enemySupplyConsumed);
    if (report.won && report.mode === "siege") {
      if (core.capture) core.capture(next, target, source.clan);
      else {
        const refuge = next.castles.filter((castle) => castle.clan === target.clan && castle.id !== target.id).sort((left, right) => right.troops - left.troops)[0];
        for (const officer of next.officers) if (officer.clan === target.clan && officer.castleId === target.id && !["captive", "dead", "executed"].includes(officer.status)) {
          officer.castleId = refuge?.id || null;
          officer.status = refuge ? "active" : "captive";
          officer.capturedBy = refuge ? null : source.clan;
        }
      }
      const garrison = Math.min(sum(report.survivingUnits), Math.max(200, Math.floor(sum(report.survivingUnits) * 0.38)));
      const garrisonUnits = distribute(report.survivingUnits, garrison);
      for (const type of TYPES) sourceArmy.units[type] = Math.max(0, sourceArmy.units[type] - garrisonUnits[type]);
      source.troops = Math.max(0, source.troops - garrison);
      const commanderId = sourceArmy.commanderId || report.attackerArmy.commanderId || null;
      Object.assign(target, { clan: source.clan, clanName: source.clanName, color: source.color, troops: garrison, defense: Math.max(10, target.defense - 18), morale: 58 });
      next.armies[target.id] = { commanderId, units: garrisonUnits };
      if (commanderId) {
        const officer = next.officers.find((item) => item.id === commanderId);
        if (officer) officer.castleId = target.id;
        sourceArmy.commanderId = null;
      }
      source.gold += Math.round(target.gold * 0.3);
      source.food += Math.round(target.food * 0.18);
      next.prestige = Math.max(0, next.prestige - 6);
      report.garrison = garrison;
    } else {
      target.morale = Math.min(100, target.morale + 5);
      source.morale = Math.max(10, source.morale - 12);
      next.prestige = Math.min(100, next.prestige + 4);
    }
    next.pendingDefense = null;
    next.lastBattle = report;
    next.aiBattles = [...(next.aiBattles || []), report].slice(-10);
    next.aiReports = [...(next.aiReports || []), report.message].slice(-10);
    next.threats = (next.threats || []).filter((threat) => threat.sourceId !== source.id || threat.targetId !== target.id);
    if (core.log) core.log(next, report.playerWon ? "victory" : "battle", report.playerWon ? "籠城、敵軍を退ける" : "落城の報せ", report.message);
    if (core.checkVictory) core.checkVictory(next, source.clan);
    return { ok: true, state: next, message: report.message };
  }
  function offsets(formationId, index, count, type) {
    const cavalry = type === "cavalry", width = cavalry ? 0.9 : 0.74, depth = cavalry ? 1.45 : 0.76;
    if (formationId === "wedge") {
      const row = Math.floor(Math.sqrt(index)), first = row * row, position = index - first;
      return { x: (position - row) * width, z: row * depth - Math.sqrt(count) * depth / 2 };
    }
    if (formationId === "defensive") {
      const angle = index / Math.max(1, count) * Math.PI * 2, radius = Math.max(0.7, Math.sqrt(count) * width / 2);
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }
    const columns = formationId === "loose" ? 4 : cavalry ? 3 : 5;
    const spacing = formationId === "loose" ? 1.65 : 1;
    return { x: ((index % columns) - (Math.min(columns, count) - 1) / 2) * width * spacing, z: (Math.floor(index / columns) - (Math.ceil(count / columns) - 1) / 2) * depth * spacing };
  }
  function install(core) {
    if (installed) return installed;
    for (const name of ["create", "deploy", "order", "start", "damage", "move", "tick", "result", "verify"]) if (typeof core[name] !== "function") throw Error(`合戦機関の ${name} がありません。`);
    original = { ...core };
    installed = { ...core, create, deploy, order, damage, move, tick, result, verify };
    return installed;
  }
  root.TenkaTactics = Object.freeze({ version: 1, formations: FORMATIONS, matchups: MATCHUPS, fortificationTypes: FORTIFICATIONS, install, prepare, createDefense, settleDefense, deploy, order, formation, ambush, canAmbush, deploymentZone, placeFortification, moveFortification, removeFortification, fortificationBudget, fortificationContains, offsets, verify, result, stamp });
})(typeof window !== "undefined" ? window : globalThis);
