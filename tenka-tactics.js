(function (root) {
  "use strict";
  const TYPES = ["ashigaru", "archer", "cavalry", "firearm", "navy"];
  const STEP = 0.25;
  // A battle turn resolves eight tactical seconds. The campaign month is a
  // separate clock: no browser frame or idle timer advances these turns.
  const TURN_STEPS = 32;
  // One deliberate attack/volley is shorter than the full movement turn.
  // Resolving an entire turn as uninterrupted fire made equal armies lose
  // most soldiers before the player could react to the first exchange.
  const TURN_ATTACK_SCALE = 8;
  const TURN_RULES = Object.freeze({
    ashigaru: Object.freeze({ name: "足軽", movement: 10, range: 2.5, attack: 1, defense: 1.15 }),
    archer: Object.freeze({ name: "弓", movement: 9, range: 18, attack: 1, defense: .9 }),
    cavalry: Object.freeze({ name: "騎馬", movement: 18, range: 3.5, attack: 1.2, defense: 1 }),
    firearm: Object.freeze({ name: "鉄砲", movement: 7, range: 22, attack: 1.2, defense: .85 }),
    navy: Object.freeze({ name: "水軍", movement: 15, range: 24, attack: 1.1, defense: 1.1 }),
  });
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
  const STANCES = Object.freeze({
    balanced: Object.freeze({ name: "通常", description: "隊列を保って進撃。移動と戦闘が続くと疲労が蓄積" }),
    brace: Object.freeze({ name: "迎撃", description: "現在地で迎撃。正面の突撃に強く、射撃隊は狙いを定める" }),
    charge: Object.freeze({ name: "強行・突撃", description: "速く前進し、勢いのある接近戦を強化。疲労と隊列の乱れに注意" }),
    rest: Object.freeze({ name: "休息", description: "攻撃と移動を止める。敵から離れると疲労・隊列・制圧を回復" }),
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
  const verifiedBattles = new WeakMap();

  function strategicSignature(state) {
    const { selectedCastleId, lastBattle, threats, aiReports, aiBattles, ...rest } = state;
    return JSON.stringify(rest);
  }
  function stamp(state) {
    let hash = 2166136261;
    for (const character of strategicSignature(state)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
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
  function unitCounts(units, side, field = "maxTroops") {
    return Object.fromEntries(TYPES.map((type) => [type, units.filter((unit) => unit.side === side && unit.type === type).reduce((total, unit) => total + unit[field], 0)]));
  }
  function addAlliedSupport(battle, state, defending = false) {
    const supports = root.TenkaAllies?.getSupports?.(state, { sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode, defending }) || [];
    if (state.tenka?.allies?.committed?.length && !supports.length) throw Error("手配した同盟援軍の合戦を開始するか、要請を取り消してください。");
    if (!supports.length) return battle;
    const side = defending ? "defender" : "attacker", ranges = { ashigaru: 2.5, archer: 18, cavalry: 3.5, firearm: 22, navy: 24 };
    battle.supportVersion = 1;
    battle.supportCommitments = copy(supports);
    for (const support of supports) {
      const name = support.clanName || support.name || state.clans?.find?.((clan) => clan.id === support.clan)?.name || support.sourceName || "同盟軍";
      const morale = clamp(support.morale ?? 75, 0, 100);
      for (const type of TYPES) for (let remaining = support.units[type] || 0, index = 0; remaining > 0; index++) {
        const troops = Math.min(600, remaining); remaining -= troops;
        battle.units.push({
          id: `support-${support.id}-${type}-${index}`, side, type, commanderId: null, commanderName: `${name}援軍`,
          x: 0, z: defending ? -25 : 34, targetX: 0, targetZ: defending ? -25 : 34,
          troops, maxTroops: troops, morale, initialMorale: morale, order: defending ? "hold" : "attack", targetId: null,
          status: "ready", range: ranges[type], cooldown: 0, damageRemainder: 0, receivedRemainder: 0,
          facingX: 0, facingZ: defending ? 1 : -1, pathIndex: 1,
          supportId: support.id, supportClan: support.clan, supportCastleId: support.sourceId, supportName: name, supportColor: support.color,
          foreignSupport: true,
        });
      }
      event(battle, `${name}の援軍 ${sum(support.units).toLocaleString("ja-JP")}人が${defending ? "守備軍" : "攻撃軍"}へ合流しました。`);
    }
    return battle;
  }
  function prepare(battle, options = {}) {
    battle.playerSide = options.defending ? "defender" : battle.playerSide || "attacker";
    battle.defending = battle.playerSide === "defender";
    battle.tacticsVersion = 1;
    battle.tacticalDepthVersion = 1;
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
      unit.stance = unit.stance || "balanced";
      unit.fatigue = unit.fatigue ?? 0;
      unit.cohesion = unit.cohesion ?? 100;
      unit.suppression = unit.suppression ?? 0;
      unit.steadyTime = unit.steadyTime ?? 0;
      unit.chargeMomentum = unit.chargeMomentum ?? 0;
      if (battle.defending && unit.side === "attacker") unit.order = "attack";
    }
    if (battle.defending) {
      battle.availableTroops = battle.units.filter((unit) => unit.side === "defender" && !unit.foreignSupport).reduce((total, unit) => total + unit.maxTroops, 0);
      battle.availableUnits = unitCounts(battle.units.filter((unit) => !unit.foreignSupport), "defender");
      battle.friendlyOfficers = copy(battle.defenderOfficers);
    } else battle.friendlyOfficers = copy(battle.eligibleOfficers);
    if (options.battlefieldVersion !== 0) root.TenkaBattlefield?.apply(battle, options.battlefieldVersion ?? root.TenkaBattlefield.version);
    if (regionalRules(battle)) adaptDeployments(battle);
    return battle;
  }
  function prepareTurns(battle, state) {
    battle.controlMode = "turns";
    battle.turnVersion = 1;
    battle.turnNumber = 1;
    battle.turnHistory = [];
    const side = friendly(battle), home = battle.defending ? battle.targetCastle : battle.sourceCastle;
    battle.friendlyOfficers = battle.friendlyOfficers.filter(officer => officer.status === "active"
      && officer.castleId === home.id && (officer.currentYear ?? state.year) - officer.birth >= 15);
    // Both sides use a whole troop-type contingent, not anonymous six-hundred
    // copies. Identical movement/attack budgets then apply to both armies.
    const groups = new Map();
    for (const unit of battle.units) {
      const key = `${unit.side}:${unit.supportId || "principal"}:${unit.type}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(unit);
    }
    const enemyOfficers = (side === "attacker" ? battle.defenderOfficers : battle.eligibleOfficers)
      .filter(officer => officer.status === "active" && (officer.currentYear ?? state.year) - officer.birth >= 15);
    let enemyIndex = 0;
    battle.units = [...groups.values()].map(same => {
      const unit = copy(same[0]);
      unit.troops = same.reduce((total, item) => total + item.troops, 0);
      unit.maxTroops = unit.troops;
      if (unit.side === side && !unit.foreignSupport) {
        unit.commanderId = null;
        unit.commanderName = "武将未指定";
      } else {
        const officers = unit.foreignSupport ? state.officers.filter(officer => officer.status === "active"
          && officer.clan === unit.supportClan && state.year - officer.birth >= 15) : enemyOfficers;
        const commander = officers[(unit.foreignSupport ? TYPES.indexOf(unit.type) : enemyIndex++) % Math.max(1, officers.length)];
        unit.commanderId = commander?.id || null;
        unit.commanderName = commander?.name || unit.supportName || (unit.side === "attacker" ? battle.sourceCastle.name : battle.targetCastle.name) + "守備軍";
        if (unit.foreignSupport && commander && !battle.eligibleOfficers.some(officer => officer.id === commander.id)
          && !battle.defenderOfficers.some(officer => officer.id === commander.id)) battle.eligibleOfficers.push(copy(commander));
      }
      if (unit.side === side) {
        unit.deployedConfirmed = false;
        unit.order = "hold";
        unit.turnPlan = { action: "wait", move: null, targetId: null };
      }
      return unit;
    });
    event(battle, "各部隊の指揮武将と配置を決めてください。開戦後は命令を計画し、『このターンを実行』で両軍が行動します。");
    return battle;
  }
  function deploymentStatus(battle) {
    const units = battle.units.filter(unit => unit.side === friendly(battle) && unit.troops > 0);
    const officers = battle.friendlyOfficers || [];
    const primary = units.filter(unit => !unit.foreignSupport);
    const unplaced = units.filter(unit => !unit.deployedConfirmed).map(unit => unit.id);
    const unassigned = primary.filter(unit => !officers.some(officer => officer.id === unit.commanderId)).map(unit => unit.id);
    const used = new Set(), duplicate = [];
    for (const unit of primary) if (unit.commanderId) {
      if (used.has(unit.commanderId)) duplicate.push(unit.id);
      used.add(unit.commanderId);
    }
    const ready = units.length > 0 && !unplaced.length && !unassigned.length && !duplicate.length;
    const message = !units.length ? "一部隊以上の兵を出陣させてください。" : unassigned.length || duplicate.length
      ? `各兵科に出陣元の城の武将を一人ずつ指定してください（未指定${unassigned.length}隊）。不足する場合は城へ武将を配属するか、出陣兵科を減らしてください。`
      : unplaced.length ? `全隊を地図上で配置するか、現在の位置を確定してください（未確定${unplaced.length}隊）。` : "全隊の指揮武将と配置を確認しました。開戦できます。";
    return { ready, units, officers, unplaced, unassigned, duplicate, message };
  }
  function assignCommander(battle, unitId, commanderId) {
    return deploy(battle, { unitId, commanderId, confirmPosition: false });
  }
  function confirmDeployment(battle, unitId) {
    return deploy(battle, { unitId, confirmPosition: true });
  }
  function start(battle) {
    if (battle.phase !== "deployment") return battle;
    if (battle.controlMode === "turns") {
      const status = deploymentStatus(battle);
      if (!status.ready) return { ...battle, deploymentError: status.message };
    }
    const next = original.start(battle);
    if (battle.controlMode === "turns") {
      delete next.deploymentError;
      for (const unit of next.units.filter(item => item.side === friendly(next))) {
        unit.order = "hold";
        unit.turnPlan = { action: "wait", move: null, targetId: null };
      }
      event(next, "第一ターンの命令を選んでください。命令のない部隊は待機し、自動で進撃しません。");
    }
    return next;
  }
  function movementBudget(battle, unit) {
    const base = TURN_RULES[unit.type], terrain = root.TenkaBattlefield?.movementFactor(battle.layout, unit) ?? 1;
    return Math.round(base.movement * (FORMATIONS[unit.formation] || FORMATIONS.line).speed
      * terrain * (1 - (unit.fatigue || 0) * .003) * 10) / 10;
  }
  function turnView(battle, unitId = null) {
    const units = battle.units.filter(unit => unit.side === friendly(battle) && active(unit)).map(unit => {
      const base = TURN_RULES[unit.type], movement = movementBudget(battle, unit);
      return { id: unit.id, commanderName: unit.commanderName, type: unit.type, ...base,
        movement: Math.round(movement * 10) / 10, action: unit.turnPlan?.action || "wait",
        plannedMove: unit.turnPlan?.move || null, targetId: unit.turnPlan?.targetId || null,
        plan: copy(unit.turnPlan || { action: "wait", move: null, targetId: null }) };
    });
    return { number: battle.turnNumber || 1, units, selected: units.find(unit => unit.id === unitId) || null,
      secondsPerTurn: TURN_STEPS * STEP, rules: TURN_RULES };
  }
  function turnOrder(battle, command) {
    if (battle.phase !== "fighting") return reject(battle, "命令の計画は開戦後に行ってください。");
    const unit = battle.units.find(item => item.id === command.unitId && item.side === friendly(battle) && active(item));
    const action = command.order === "hold" ? "defend" : command.order;
    if (!unit || !["move", "attack", "defend", "wait", "retreat"].includes(action)) return reject(battle, "自軍部隊を選び、移動・攻撃・防御・待機を指定してください。");
    const plan = copy(unit.turnPlan || { action: "wait", move: null, targetId: null });
    if (action === "move") {
      const { x, z } = command, box = bounds(battle);
      if (![x, z].every(Number.isFinite) || x < box.minX + 1 || x > box.maxX - 1 || z < box.minZ + 1 || z > box.maxZ - 1) return reject(battle, "戦場内の移動先を指定してください。");
      const movement = turnView(battle, unit.id).selected.movement;
      if (Math.hypot(x - unit.x, z - unit.z) > movement + .05) return reject(battle, `この部隊は一ターンに${movement}まで移動できます。近い場所を指定してください。`);
      if (blocked(battle, x, z, unit.type)) return reject(battle, "川・堀・城壁・柵・建物を避けて移動先を指定してください。");
      plan.move = { x, z };
    } else if (action === "attack") {
      const target = battle.units.find(item => item.id === command.targetId && item.side !== unit.side && active(item))
        || (unit.side === "attacker" && battle.structures.find(item => item.id === command.targetId && item.hp > 0))
        || (battle.fortifications || []).find(item => item.id === command.targetId && item.side !== unit.side && item.hp > 0);
      if (!target) return reject(battle, "攻撃する敵部隊・城門・敵の施設を選んでください。");
      const from = plan.move || unit, reach = unit.range + (Number.isFinite(target.troops) ? 0 : Math.max(target.w ?? target.width ?? 0, target.d ?? target.depth ?? 0) / 2);
      if (Math.hypot(from.x - target.x, from.z - target.z) > reach + .1) return reject(battle, `攻撃目標が射程外です。先に移動を計画してください（射程${unit.range}）。`);
      plan.action = "attack"; plan.targetId = target.id;
    } else {
      plan.action = action; plan.targetId = null;
      if (["wait", "defend", "retreat"].includes(action)) plan.move = null;
    }
    const next = copy(battle);
    next.units.find(item => item.id === unit.id).turnPlan = plan;
    next.ledger.push({ kind: "turn-order", command: { unitId: unit.id, order: action, ...(action === "move" ? { x: command.x, z: command.z } : {}), ...(action === "attack" ? { targetId: command.targetId } : {}) } });
    return { ok: true, battle: next, message: "このターンの命令を設定しました。『このターンを実行』まで両軍は動きません。" };
  }
  function endTurn(battle) {
    if (battle.controlMode !== "turns" || battle.phase !== "fighting") return reject(battle, "ターン制の合戦中だけ実行できます。");
    const next = copy(battle), side = friendly(next);
    next._turnExecuting = true;
    for (const unit of next.units.filter(item => item.side === side && active(item))) {
      const plan = unit.turnPlan || { action: "wait", move: null, targetId: null };
      unit._turnMovement = movementBudget(next, unit);
      unit._turnAttackSpent = false;
      unit.order = plan.action === "retreat" ? "retreat" : plan.move ? "move" : "hold";
      unit.targetX = plan.move?.x ?? unit.x; unit.targetZ = plan.move?.z ?? unit.z;
      unit.targetId = plan.action === "attack" ? plan.targetId : null;
      unit.stance = plan.action === "defend" ? "brace" : plan.action === "wait" && !plan.move ? "rest" : unit.stance === "charge" ? "charge" : "balanced";
    }
    for (const unit of next.units.filter(item => item.side !== side && active(item))) {
      unit._turnMovement = movementBudget(next, unit);
      unit._turnAttackSpent = false;
    }
    for (let index = 0; index < TURN_STEPS && next.phase === "fighting"; index++) tick(next);
    delete next._turnExecuting;
    for (const unit of next.units) {
      delete unit._turnMovement; delete unit._turnAttackSpent;
      if (unit.side !== side) continue;
      unit.turnPlan = { action: unit.order === "retreat" || unit.status === "retreating" ? "retreat" : "wait", move: null, targetId: null };
      if (active(unit) && unit.order !== "retreat") { unit.order = "hold"; unit.targetId = null; unit.targetX = unit.x; unit.targetZ = unit.z; }
    }
    next.turnHistory.push({ number: next.turnNumber, time: next.time });
    next.turnNumber++;
    next.ledger.push({ kind: "turn-end" });
    event(next, next.phase === "finished" ? "合戦の決着がつきました。戦果を確認してください。" : `第${next.turnNumber}ターン。命令を選び、全隊の計画を確認してから実行してください。`);
    return { ok: true, battle: next, message: next.phase === "finished" ? "合戦が終了しました。" : `第${next.turnNumber}ターンの命令を設定してください。` };
  }
  function withdrawBattle(battle) {
    if (battle.controlMode !== "turns" || battle.phase !== "fighting") return reject(battle, "合戦中だけ全軍撤退できます。");
    let next = battle;
    for (const unit of battle.units.filter(item => item.side === friendly(battle) && active(item))) {
      const answer = turnOrder(next, { unitId: unit.id, order: "retreat" });
      if (!answer.ok) return answer;
      next = answer.battle;
    }
    // An explicit all-army retreat authorizes its resolution, including the
    // pursuing enemy's response and food use. Every turn is still replayed.
    for (let index = 0; index < 200 && next.phase === "fighting"; index++) {
      const answer = endTurn(next);
      if (!answer.ok) return answer;
      next = answer.battle;
    }
    return { ok: next.phase === "finished", battle: next, message: next.phase === "finished" ? "全軍の撤退を確認しました。戦果と帰還兵を確認してください。" : "撤退中です。次のターンを実行してください。" };
  }
  function create(options) {
    const available = Math.max(0, options.state.food - 600);
    if (options.carriedSupply !== undefined && (!Number.isSafeInteger(options.carriedSupply) || options.carriedSupply < 0 || options.carriedSupply > available)) throw Error("持ち込む兵糧は、出陣費六百を差し引いた在庫以内の整数で指定してください。");
    const battle = original.create(options);
    addAlliedSupport(battle, options.state);
    if (options.carriedSupply !== undefined) battle.carriedSupply = options.carriedSupply;
    const prepared = prepare(battle, { attackerFood: options.carriedSupply ?? available, defenderFood: battle.targetCastle.food || 0, battlefieldVersion: options.battlefieldVersion });
    return options.controlMode === "turns" ? prepareTurns(prepared, options.state) : prepared;
  }
  function createDefense(state, threat = state.pendingDefense, options = {}) {
    if (!original || !threat) throw Error("迎撃する侵攻軍が見つかりません。");
    const source = state.castles.find((castle) => castle.id === threat.sourceId);
    const target = state.castles.find((castle) => castle.id === threat.targetId);
    if (!source || !target || target.clan !== state.playerClan || source.clan === state.playerClan || !source.neighbors.includes(target.id)) throw Error("侵攻先と自領の関係を確認してください。");
    if (root.TenkaDiplomacy?.isProtectedPair?.(state, source.clan, target.clan)) throw Error("同盟・恭順関係にある家の侵攻は外交で解除されています。戦況を更新してください。");
    if (options.carriedSupply !== undefined && (!Number.isSafeInteger(options.carriedSupply) || options.carriedSupply < 0 || options.carriedSupply > Math.max(0, state.food))) throw Error("籠城に確保する兵糧は、在庫以内の整数で指定してください。");
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
    if (options.carriedSupply !== undefined) battle.carriedSupply = options.carriedSupply;
    addAlliedSupport(battle, state, true);
    const prepared = prepare(battle, { defending: true, attackerFood: Math.max(0, (source.food || 0) - 600), defenderFood: options.carriedSupply ?? state.food, battlefieldVersion: options.battlefieldVersion });
    return options.controlMode === "turns" ? prepareTurns(prepared, state) : prepared;
  }
  function deploy(battle, command = {}) {
    if (battle.phase !== "deployment") return reject(battle, "配置を変えられるのは開戦前だけです。");
    const side = friendly(battle), unit = battle.units.find((item) => item.id === command.unitId && item.side === side);
    if (!unit) return reject(battle, "自軍の部隊を選んでください。");
    const x = command.x ?? unit.x, z = command.z ?? unit.z, type = command.type ?? unit.type, troops = command.troops ?? unit.troops;
    if (unit.foreignSupport && (type !== unit.type || troops !== unit.maxTroops || (Object.hasOwn(command, "commanderId") && command.commanderId != null))) return reject(battle, "同盟軍の兵科・兵数・指揮官は変更できません。配置と戦場での命令を指示してください。");
    const zone = deploymentZone(battle, side);
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < zone.xMin || x > zone.xMax || z < zone.zMin || z > zone.zMax) return reject(battle, side === "defender" ? "守備軍は城側（z -5以下）の陸地・曲輪へ配置してください。" : "攻撃軍は手前側（z 10以上）へ配置してください。");
    if (!TYPES.includes(type) || !Number.isInteger(troops) || troops < 0 || (battle.controlMode !== "turns" && troops > 600)) return reject(battle, "一部隊は五兵科から選び、兵数は零から六百の整数にしてください。");
    const home = side === "defender" ? battle.targetCastle : battle.sourceCastle;
    if (type === "navy" && (!home.coastal || !battle.coastal)) return reject(battle, "水軍は沿岸拠点の海上へ配置してください。");
    if (blocked(battle, x, z, type)) return reject(battle, "堀・川・海・城壁・木柵・町や村の家屋を避け、水軍は海上へ配置してください。");
    if (troops > 0 && (battle.fortifications || []).some((item) => item.kind === "palisade" && fortificationContains(item, x, z, 0.8))) return reject(battle, "木柵の上には配置できません。柵の後ろへ部隊を配置してください。");
    const others = battle.units.filter((item) => item.side === side && item.id !== unit.id && !item.foreignSupport);
    if (!unit.foreignSupport && (others.filter((item) => item.type === type).reduce((total, item) => total + item.troops, 0) + troops > battle.availableUnits[type] || others.reduce((total, item) => total + item.troops, 0) + troops > battle.availableTroops)) return reject(battle, "出陣できる兵科別の兵数を超えています。");
    const commanderId = unit.foreignSupport ? unit.commanderId : Object.hasOwn(command, "commanderId") ? command.commanderId : unit.commanderId;
    const officers = battle.friendlyOfficers || (side === "defender" ? battle.defenderOfficers : battle.eligibleOfficers);
    const commander = unit.foreignSupport ? { id: unit.commanderId, name: unit.commanderName } : commanderId ? officers.find((officer) => officer.id === commanderId) : null;
    if (!unit.foreignSupport && commanderId && (!commander || others.some((item) => item.troops > 0 && item.commanderId === commanderId))) return reject(battle, "活動中の自家武将を、一人につき一部隊に配置してください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unit.id);
    const positionRequested = command.confirmPosition !== false && (command.confirmPosition === true || Object.hasOwn(command, "x") || Object.hasOwn(command, "z"));
    const ranges = { ashigaru: 2.5, archer: 18, cavalry: 3.5, firearm: 22, navy: 24 };
    Object.assign(selected, { x, z, targetX: x, targetZ: z, type, troops, maxTroops: troops, commanderId: commanderId || null, commanderName: unit.foreignSupport ? unit.commanderName : commander?.name || (battle.controlMode === "turns" ? "武将未指定" : "組頭"), range: ranges[type] });
    if (battle.controlMode === "turns") {
      selected.deployedConfirmed = troops > 0 && (positionRequested || !!unit.deployedConfirmed);
      if (!troops && !unit.foreignSupport) { selected.commanderId = null; selected.commanderName = "武将未指定"; }
    }
    if (selected.ambush && !canAmbush(result, selected)) { selected.ambush = false; selected.revealed = true; }
    result.ledger.push({ kind: "deploy", command: { unitId: unit.id, x, z, type, troops, commanderId: unit.foreignSupport ? null : commanderId || null, ...(battle.controlMode === "turns" ? { confirmPosition: positionRequested } : {}) } });
    return { battle: result, ok: true, message: "部隊の配置を変更しました。" };
  }
  function order(battle, command = {}) {
    if (battle.controlMode === "turns") return turnOrder(battle, command);
    if (command.order === "ambush") return ambush(battle, command.unitId);
    if (command.order === "rest" || command.order === "charge") return stance(battle, command.unitId, command.order);
    if (battle.phase !== "fighting") return reject(battle, "命令を出せるのは合戦中だけです。");
    const side = friendly(battle), unit = battle.units.find((item) => item.id === command.unitId && item.side === side && active(item));
    if (!unit || !["move", "attack", "hold", "retreat"].includes(command.order)) return reject(battle, "活動中の自軍部隊と有効な命令を選んでください。");
    const x = command.x ?? unit.x, z = command.z ?? unit.z, box = bounds(battle);
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < box.minX + 1 || x > box.maxX - 1 || z < box.minZ + 1 || z > box.maxZ - 1) return reject(battle, "戦場の範囲内を指定してください。");
    if (battle.battlefieldVersion && command.order === "move" && blocked(battle, x, z, unit.type)) return reject(battle, "移動先は通行できる地面・橋・浅瀬を指定し、水軍は海上を選んでください。");
    if (command.targetId && !battle.units.some((item) => item.id === command.targetId && item.side !== side) && !(side === "attacker" && battle.structures.some((item) => item.id === command.targetId)) && !(battle.fortifications || []).some((item) => item.id === command.targetId && item.side !== side && item.hp > 0)) return reject(battle, "敵部隊または攻撃可能な施設を選んでください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unit.id);
    Object.assign(selected, { order: command.order, targetId: command.targetId || null, targetX: x, targetZ: command.order === "retreat" ? side === "attacker" ? box.maxZ - 1 : box.minZ + 1 : z, status: command.order === "retreat" ? "retreating" : "fighting" });
    if (["move", "attack", "retreat"].includes(command.order) && ["brace", "rest"].includes(selected.stance)) selected.stance = "balanced";
    if (command.order === "hold" && selected.stance === "charge") selected.stance = "balanced";
    if (command.order !== "hold") { selected.ambush = false; selected.revealed = true; }
    result.ledger.push({ kind: "order", command: { unitId: unit.id, order: command.order, x, z, targetId: command.targetId || null } });
    return { battle: result, ok: true, message: "部隊へ命令を伝えました。" };
  }
  function formation(battle, unitId, value) {
    if (!["deployment", "fighting"].includes(battle.phase) || !FORMATIONS[value]) return reject(battle, "布陣中または合戦中に陣形を選んでください。");
    const unit = battle.units.find((item) => item.id === unitId && item.side === friendly(battle) && active(item));
    if (!unit) return reject(battle, "自軍の部隊を選んでください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unitId);
    if (battle.phase === "fighting" && selected.formation !== value) {
      selected.cohesion = Math.max(0, (selected.cohesion ?? 100) - 12);
      selected.steadyTime = 0;
    }
    selected.formation = value;
    result.ledger.push({ kind: "formation", command: { unitId, formation: value } });
    return { battle: result, ok: true, message: `${selected.commanderName}隊を${FORMATIONS[value].name}に変更。${FORMATIONS[value].description}。` };
  }
  function stance(battle, unitId, value) {
    if (!["deployment", "fighting"].includes(battle.phase) || !Object.hasOwn(STANCES, value)) return reject(battle, "布陣中または合戦中に、有効な戦闘方針を選んでください。");
    const unit = battle.units.find((item) => item.id === unitId && item.side === friendly(battle) && active(item));
    if (!unit) return reject(battle, "活動中の自軍部隊を選んでください。");
    const result = copy(battle), selected = result.units.find((item) => item.id === unitId);
    selected.stance = value;
    if (battle.controlMode === "turns" && ["brace", "rest"].includes(value)) {
      selected.turnPlan = { action: value === "brace" ? "defend" : "wait", move: null, targetId: null };
    }
    if (["brace", "rest"].includes(value)) {
      selected.order = "hold";
      selected.targetId = null;
      selected.targetX = selected.x;
      selected.targetZ = selected.z;
      selected.chargeMomentum = 0;
    } else if (value === "charge") {
      selected.order = "attack";
      selected.ambush = false;
      selected.revealed = true;
    }
    result.ledger.push({ kind: "stance", command: { unitId, stance: value } });
    return { battle: result, ok: true, message: `${selected.commanderName}隊を${STANCES[value].name}に変更。${STANCES[value].description}。` };
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
  function facingVector(unit) {
    const length = Math.hypot(unit.facingX || 0, unit.facingZ || 0);
    return length ? { x: unit.facingX / length, z: unit.facingZ / length } : { x: 0, z: unit.side === "attacker" ? -1 : 1 };
  }
  function facingDot(unit, other) {
    const dx = other.x - unit.x, dz = other.z - unit.z, length = Math.hypot(dx, dz), facing = facingVector(unit);
    return length ? (dx * facing.x + dz * facing.z) / length : 1;
  }
  function shotLane(battle, unit, target) {
    if (!["firearm", "archer", "navy"].includes(unit.type) || !target) return { factor: 1, label: "射界良好" };
    const structures = battle.structures.filter((item) => item.id !== target.id && item.hp > 0 && ["wall", "gate", "hall"].includes(item.kind || item.type));
    if (structures.some((item) => !contains(item, unit.x, unit.z, .3) && !contains(item, target.x, target.z, .3) && segmentHits({ ...item, w: item.w ?? item.width, d: item.d ?? item.depth }, unit.x, unit.z, target.x, target.z))) return { factor: unit.type === "archer" ? .66 : .24, label: "城壁で遮蔽" };
    const dx = target.x - unit.x, dz = target.z - unit.z, squared = dx * dx + dz * dz;
    const screen = squared > 16 && battle.units.some((ally) => {
      if (ally.id === unit.id || ally.side !== unit.side || !active(ally)) return false;
      const projection = ((ally.x - unit.x) * dx + (ally.z - unit.z) * dz) / squared;
      return projection > .14 && projection < .86 && Math.hypot(ally.x - unit.x - dx * projection, ally.z - unit.z - dz * projection) < 1.65;
    });
    return screen ? { factor: unit.type === "archer" ? .9 : .38, label: "味方が射線上" } : { factor: 1, label: "射界良好" };
  }
  function nearestEnemy(battle, unit) {
    return battle.units.filter((other) => other.side !== unit.side && active(other) && !(other.ambush && !other.revealed)).sort((a, b) => Math.hypot(unit.x - a.x, unit.z - a.z) - Math.hypot(unit.x - b.x, unit.z - b.z))[0];
  }
  function exposure(battle, unit) {
    const enemies = battle.units.filter((other) => other.side !== unit.side && active(other) && !(other.ambush && !other.revealed) && Math.hypot(unit.x - other.x, unit.z - other.z) < 9);
    if (!enemies.length) return "未接敵";
    if (enemies.some((a, index) => enemies.slice(index + 1).some((b) => {
      const ax = a.x - unit.x, az = a.z - unit.z, bx = b.x - unit.x, bz = b.z - unit.z;
      return (ax * bx + az * bz) / Math.max(.1, Math.hypot(ax, az) * Math.hypot(bx, bz)) < -.45;
    }))) return "包囲";
    const dot = Math.min(...enemies.map((enemy) => facingDot(unit, enemy)));
    return dot < -.35 ? "背面" : dot < .5 ? "側面" : "正面";
  }
  function readiness(unit) {
    return clamp(Math.round((100 - (unit.fatigue || 0) * .48) * (.65 + (unit.cohesion ?? 100) * .0035) * (1 - (unit.suppression || 0) * .002)), 0, 100);
  }
  function tacticalView(battle, unitId = null) {
    const units = battle.units.filter(active).map((unit) => {
      const enemy = nearestEnemy(battle, unit), lane = shotLane(battle, unit, enemy), exposed = exposure(battle, unit), advice = [];
      if ((unit.fatigue || 0) >= 55) advice.push("敵から距離を取り、予備隊と交代して休息してください。");
      if ((unit.cohesion ?? 100) < 65) advice.push("陣形変更や強行を控え、停止して隊列を立て直してください。");
      if ((unit.suppression || 0) >= 35) advice.push("射撃で制圧されています。散開・遮蔽物・射手への側面攻撃を使ってください。");
      if (["側面", "背面", "包囲"].includes(exposed)) advice.push("側背面が脅かされています。味方の予備隊か方円・迎撃で支えてください。");
      if (lane.factor < .8) advice.push("鉄砲隊を横へ動かし、味方と城壁を避けて射線を開いてください。");
      return { id: unit.id, side: unit.side, commanderName: unit.commanderName, stance: unit.stance || "balanced", stanceName: (STANCES[unit.stance] || STANCES.balanced).name,
        fatigue: Math.round(unit.fatigue || 0), cohesion: Math.round(unit.cohesion ?? 100), suppression: Math.round(unit.suppression || 0), readiness: readiness(unit), exposure: exposed, fireLane: lane.label, advice };
    });
    return { version: 1, units, selected: units.find((unit) => unit.id === unitId) || null, principles: ["射手の射線を開き、槍隊で守り、騎馬で側背面を突くと有利です。", "強行と陣形変更の連続は隊列を乱します。予備隊を残して交代・休息してください。", "迎撃は正面の突撃に強く、散開は射撃に強い一方、接近戦では崩れやすくなります。"] };
  }
  function damage(battle, attacker, target, structure) {
    if (battle.controlMode === "turns" && (!battle._turnExecuting || attacker._turnAttackSpent)) return 0;
    if (battle.controlMode === "turns" && attacker.side === friendly(battle)) {
      // The native proximity targeting must never turn a wait/move/defend
      // instruction into an autonomous attack, or substitute another target.
      if (!battle._turnExecuting || attacker.turnPlan?.action !== "attack" || attacker._turnAttackSpent
        || attacker.turnPlan.targetId !== target.id) return 0;
    }
    if (attacker.fieldworkTarget) return 0;
    if (attacker.ambush && !attacker.revealed) return 0;
    if (attacker.stance === "rest") return 0;
    if (target.ambush && !target.revealed && Math.hypot(attacker.x - target.x, attacker.z - target.z) > 11) return 0;
    const attackFormation = FORMATIONS[attacker.formation] || FORMATIONS.line;
    const defendFormation = FORMATIONS[target.formation] || FORMATIONS.line;
    const ranged = ["archer", "firearm", "navy"].includes(attacker.type);
    let factor = ranged ? attackFormation.ranged : attackFormation.attack;
    factor *= (1 - (attacker.fatigue || 0) * .0036) * (.72 + (attacker.cohesion ?? 100) * .0028) * (1 - (attacker.suppression || 0) * .0025);
    if (ranged) factor *= (.76 + Math.min(2, attacker.steadyTime || 0) * .12) * shotLane(battle, attacker, target).factor;
    if (attacker.stance === "brace") factor *= ranged ? 1.08 : .92;
    if (attacker.stance === "charge" && !ranged && !structure) factor *= 1 + (attacker.chargeMomentum || 0) * .26;
    if (attacker.side && battle.supply?.[attacker.side]?.exhausted) factor *= .78;
    if (!structure) {
      factor *= MATCHUPS[attacker.type]?.[target.type] || 1;
      factor /= defendFormation.defense;
      if (ranged && target.formation === "loose") factor *= 0.74;
      if (!ranged && target.formation === "loose") factor *= 1.13;
      if (attacker.type === "cavalry" && target.formation === "defensive") factor *= 0.73;
      const facing = facingDot(target, attacker);
      if (facing < -0.35 && target.formation !== "defensive") factor *= 1.3;
      else if (facing < .45 && target.formation !== "defensive") factor *= 1.1;
      if (target.stance === "brace" && facing > .35) factor /= !ranged && attacker.type === "cavalry" ? 1.35 : 1.12;
      if (target.stance === "rest") factor *= 1.18;
      factor /= .85 + (target.cohesion ?? 100) * .0015;
      if (["mountain", "hill", "forest"].includes(battle.terrain) && target.order === "hold") factor *= 0.86;
      if (attacker.ambushUntil > battle.time) factor *= 1.65;
      if (ranged && (battle.terrainFeatures || []).some((feature) => feature.type === "forest" && Math.hypot(target.x - feature.x, target.z - feature.z) <= feature.radius)) factor *= 0.82;
      factor *= root.TenkaBattlefield?.coverFactor(battle.layout, target, ranged) ?? 1;
      if ((battle.fortifications || []).some((item) => item.kind === "camp" && item.side === target.side && item.hp > 0 && Math.hypot(target.x - item.x, target.z - item.z) <= 9)) factor /= 1.12;
      if ((battle.fortifications || []).some((item) => item.kind === "palisade" && item.side === target.side && item.hp > 0 && Math.hypot(target.x - item.x, target.z - item.z) <= 9 && segmentHits(item, attacker.x, attacker.z, target.x, target.z))) factor *= ranged ? 0.68 : 0.82;
    }
    if (battle.controlMode === "turns") {
      factor *= (TURN_RULES[attacker.type]?.attack || 1) / (TURN_RULES[target.type]?.defense || 1);
      factor *= TURN_ATTACK_SCALE;
    }
    const amount = original.damage(battle, attacker, target, structure) * factor;
    if (battle.controlMode === "turns" && amount > 0) attacker._turnAttackSpent = true;
    if (battle._tacticalStep && amount > 0) {
      attacker.lastAttackTime = battle.time;
      if (!structure && ranged) target._incomingPressure = (target._incomingPressure || 0) + amount / Math.max(1, target.maxTroops) * (attacker.type === "firearm" ? 60 : 35) * (target.formation === "loose" ? .65 : 1);
    }
    return amount;
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
    if (battle.controlMode === "turns" && unit.side === friendly(battle)) {
      if (!battle._turnExecuting) return;
      if (unit.order !== "retreat" && (!unit.turnPlan?.move || unit._turnMovement <= 0)) return;
      // A targeted attack does not grant a free pursuit after the planned move.
      if (unit.order !== "retreat") { x = unit.turnPlan.move.x; z = unit.turnPlan.move.z; }
    }
    if (battle.controlMode === "turns" && unit._turnMovement <= 0) return;
    if (unit.fieldworkTarget) return;
    if (unit.order === "retreat") {
      unit.stance = "balanced";
      unit.ambush = false;
      unit.revealed = true;
    }
    if (unit.ambush && !unit.revealed) return;
    if ((unit.order === "hold" && unit.side === friendly(battle)) || ["rest", "brace"].includes(unit.stance)) return;
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
    const factor = (FORMATIONS[unit.formation] || FORMATIONS.line).speed * (root.TenkaBattlefield?.movementFactor(battle.layout, { ...unit, x: oldX, z: oldZ }) ?? 1)
      * (1 - (unit.fatigue || 0) * .003) * (1 - (unit.suppression || 0) * .0015) * (unit.stance === "charge" ? 1.2 : 1);
    if (factor !== 1) {
      const nextX = oldX + (unit.x - oldX) * factor, nextZ = oldZ + (unit.z - oldZ) * factor;
      if (!blocked(battle, nextX, nextZ, unit.type)) { unit.x = nextX; unit.z = nextZ; }
    }
    if (battle.controlMode === "turns") {
      const moved = Math.hypot(unit.x - oldX, unit.z - oldZ), remaining = Math.max(0, unit._turnMovement || 0);
      if (moved > remaining && moved > 0) {
        unit.x = oldX + (unit.x - oldX) * remaining / moved;
        unit.z = oldZ + (unit.z - oldZ) * remaining / moved;
      }
      unit._turnMovement = Math.max(0, remaining - Math.min(moved, remaining));
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
        obstruction.hp = Math.max(0, obstruction.hp - damage(battle, unit, obstruction, true));
        unit.fieldworkTarget = obstruction.id;
      }
    }
  }
  function tick(battle) {
    if (battle.phase !== "fighting" || (battle.controlMode === "turns" && !battle._turnExecuting)) return;
    const before = new Map(battle.units.map((unit) => [unit.id, { x: unit.x, z: unit.z, troops: unit.troops }]));
    battle._tacticalStep = true;
    // The same fatigue rules apply to both armies. Opposing captains preserve
    // a reserve, rest exhausted units out of contact, and brace against cavalry.
    if (battle.fixedSteps % 16 === 0) for (const unit of battle.units) {
      if (unit.side === friendly(battle) || !active(unit) || unit.order === "retreat") continue;
      const enemy = nearestEnemy(battle, unit), distance = enemy ? Math.hypot(enemy.x - unit.x, enemy.z - unit.z) : Infinity;
      if (unit.aiRestOrder && ((unit.fatigue || 0) <= 28 || distance < 12)) {
        unit.order = unit.aiRestOrder;
        unit.stance = "balanced";
        delete unit.aiRestOrder;
      } else if (!unit.aiRestOrder && (unit.fatigue || 0) > 68 && distance > 15) {
        unit.aiRestOrder = unit.order;
        unit.stance = "rest";
        unit.order = "hold";
      }
      if (unit.aiBraceOrder && (!enemy || enemy.type !== "cavalry" || distance > 15)) {
        unit.order = unit.aiBraceOrder;
        unit.stance = "balanced";
        delete unit.aiBraceOrder;
      } else if (!unit.aiRestOrder && !unit.aiBraceOrder && unit.type === "ashigaru" && enemy?.type === "cavalry" && distance < 14) {
        unit.aiBraceOrder = unit.order;
        unit.stance = "brace";
        unit.order = "hold";
      }
    }
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
        fieldworkDamage.set(obstacle.id, (fieldworkDamage.get(obstacle.id) || 0) + damage(battle, unit, obstacle, true));
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
    delete battle._tacticalStep;
    for (const unit of battle.units) {
      const prior = before.get(unit.id);
      const moved = prior ? Math.hypot(unit.x - prior.x, unit.z - prior.z) : 0;
      const enemy = nearestEnemy(battle, unit), distance = enemy ? Math.hypot(enemy.x - unit.x, enemy.z - unit.z) : Infinity;
      const fighting = active(unit) && unit.lastAttackTime === battle.time;
      const inContact = distance < 11;
      const resting = unit.stance === "rest" && !inContact;
      const camp = (battle.fortifications || []).some((item) => item.kind === "camp" && item.side === unit.side && item.hp > 0 && Math.hypot(unit.x - item.x, unit.z - item.z) <= 9);
      const fatigue = moved * (unit.type === "cavalry" ? .22 : .34) * (unit.stance === "charge" ? 1.45 : 1) + (fighting ? .035 : 0) + (unit.stance === "charge" && moved > .05 ? .18 : 0);
      const recovery = battle.supply?.[unit.side]?.exhausted ? 0 : resting ? (camp ? 3.8 : 2.8) * STEP : moved < .05 && !fighting && !inContact ? .65 * STEP : 0;
      unit.fatigue = clamp((unit.fatigue || 0) + fatigue - recovery + (battle.supply?.[unit.side]?.exhausted ? .07 : 0), 0, 100);
      const losses = prior ? Math.max(0, prior.troops - unit.troops) : 0;
      const rally = moved < .05 ? resting ? 2.2 : inContact ? .08 : .7 : 0;
      unit.cohesion = clamp((unit.cohesion ?? 100) + rally * STEP - losses / Math.max(1, unit.maxTroops) * 30 - (unit.stance === "charge" && moved > .05 ? .15 : 0) - ((unit.suppression || 0) > 55 ? .06 : 0), 0, 100);
      unit.suppression = clamp((unit.suppression || 0) + (unit._incomingPressure || 0) - (resting ? 3.5 : camp ? 1.6 : .65) * STEP, 0, 100);
      delete unit._incomingPressure;
      unit.steadyTime = moved > .05 ? 0 : Math.min(2, (unit.steadyTime || 0) + STEP);
      unit.chargeMomentum = unit.stance === "charge" && moved > .15 ? Math.min(1, (unit.chargeMomentum || 0) + .14) : Math.max(0, (unit.chargeMomentum || 0) - .045);
      // A stationary unit can turn to meet a visible threat, but cannot erase a
      // flank instantly. A second attack from the opposite side still exposes it.
      if (enemy && moved < .05 && distance < Math.max(12, unit.range + 3) && !(unit.ambush && !unit.revealed)) {
        const facing = facingVector(unit), angle = Math.atan2(facing.z, facing.x), desired = Math.atan2(enemy.z - unit.z, enemy.x - unit.x);
        const difference = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
        const turn = clamp(difference, -.12, .12);
        unit.facingX = Math.cos(angle + turn);
        unit.facingZ = Math.sin(angle + turn);
      }
    }
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
      else event(battle, battle.mode === "field" ? "野戦で敗れ、残存兵が退きました。城の守備と家臣の行方を評定で確認してください。" : "本郭を失いました。残存兵と家臣の行方を評定で確認してください。");
    }
  }
  function result(battle) {
    // Allied reserves remain their clan's soldiers. The native settlement uses
    // these fields to debit home armies and seed a captured castle's garrison;
    // feed it only each principal army, while combat still uses both forces.
    const primary = battle.units.filter((unit) => !unit.foreignSupport && (battle.controlMode !== "turns" || unit.maxTroops > 0));
    const report = original.result(battle.supportVersion || battle.controlMode === "turns" ? { ...battle, units: primary,
      initialAttacker: unitCounts(primary, "attacker"), initialDefender: unitCounts(primary, "defender") } : battle);
    if (battle.supportVersion) {
      report.supportReports = (battle.supportCommitments || []).map((support) => {
        const units = battle.units.filter((unit) => unit.foreignSupport && unit.supportId === support.id);
        const survivingUnits = unitCounts(units, friendly(battle), "troops"), committedUnits = copy(support.units);
        const casualtyUnits = Object.fromEntries(TYPES.map((type) => [type, committedUnits[type] - survivingUnits[type]]));
        return { id: support.id, supportId: support.id, clan: support.clan, sourceId: support.sourceId, source: support.sourceId,
          sourceName: support.sourceName, clanName: support.clanName || support.name || support.sourceName,
          committedUnits, units: copy(committedUnits), casualtyUnits, survivingUnits,
          troops: sum(committedUnits), casualties: sum(casualtyUnits), survivors: sum(survivingUnits) };
      });
    }
    report.playerSide = friendly(battle);
    report.defending = !!battle.defending;
    report.playerWon = battle.winner === friendly(battle);
    report.supplyConsumed = Math.ceil(battle.supply?.[friendly(battle)]?.consumed || 0);
    report.enemySupplyConsumed = Math.ceil(battle.supply?.[friendly(battle) === "attacker" ? "defender" : "attacker"]?.consumed || 0);
    if (battle.carriedSupply !== undefined) {
      report.carriedSupply = battle.carriedSupply;
      report.supplyConsumed = Math.min(battle.carriedSupply, report.supplyConsumed);
      report.supplyRemaining = Math.max(0, battle.carriedSupply - report.supplyConsumed);
      report.supplyExhausted = !!battle.supply?.[friendly(battle)]?.exhausted;
    }
    report.tacticsVersion = 1;
    if (battle.controlMode === "turns") {
      const committed = unitCounts(primary, friendly(battle));
      report.controlMode = "turns";
      report.turns = (battle.turnHistory || []).length;
      report.reserveUnits = Object.fromEntries(TYPES.map(type => [type, Math.max(0, (battle.availableUnits[type] || 0) - committed[type])]));
      report.reserveTroops = sum(report.reserveUnits);
      report.reserveDisposition = battle.defending && battle.mode === "siege" && !report.playerWon ? "dispersed" : "garrison";
    }
    if (battle.defending) {
      const defeat = battle.mode === "field" ? "野戦敗北" : "落城";
      report.message = `${battle.targetCastle.name}の${battle.mode === "field" ? "迎撃野戦" : "籠城戦"}は${report.playerWon ? "防衛成功" : defeat}。守備軍の損失 ${report.enemyCasualties.toLocaleString("ja-JP")}、敵軍の損失 ${report.casualties.toLocaleString("ja-JP")}。兵糧 ${report.supplyConsumed.toLocaleString("ja-JP")}を消費。`;
      report.phases[0].text = battle.mode === "field" ? "守備軍を野戦に配置し、敵の侵攻を迎え撃ちました。" : "城内の曲輪に守備隊を配置し、籠城を指揮しました。";
      report.phases[2].title = report.playerWon ? "防衛成功" : defeat;
    } else report.message += ` 兵糧 ${report.supplyConsumed.toLocaleString("ja-JP")}を追加消費。`;
    if (report.reserveTroops) report.message += report.reserveDisposition === "dispersed"
      ? ` 未出陣の予備兵 ${report.reserveTroops.toLocaleString("ja-JP")}人は落城により離散しました（討死数には含みません）。`
      : ` 未出陣の予備兵 ${report.reserveTroops.toLocaleString("ja-JP")}人は出陣元の城に残っています。`;
    if (report.supportReports?.length) report.message += ` 同盟援軍の損失 ${report.supportReports.reduce((total, support) => total + support.casualties, 0).toLocaleString("ja-JP")}人、帰還 ${report.supportReports.reduce((total, support) => total + support.survivors, 0).toLocaleString("ja-JP")}人。`;
    return report;
  }
  function* replayBattle(state, battle) {
    if (!battle || battle.phase !== "finished" || battle.stateStamp !== stamp(state) || !Array.isArray(battle.ledger) || battle.ledger.length > 8000) return null;
    const battlefieldVersion = battle.battlefieldVersion ?? 0;
    const controlMode = battle.controlMode === "turns" ? "turns" : undefined;
    if (![0, 1, root.TenkaBattlefield?.version].includes(battlefieldVersion)) return null;
    let replay = battle.defending ? createDefense(state, { sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode }, { battlefieldVersion, carriedSupply: battle.carriedSupply, controlMode }) : create({ state, sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode, battlefieldVersion, carriedSupply: battle.carriedSupply, controlMode });
    for (let index = 0; index < battle.ledger.length; index++) {
      const record = battle.ledger[index];
      if (["deploy", "order", "formation", "stance", "ambush", "fieldwork-place", "fieldwork-move", "fieldwork-remove"].includes(record.kind)) {
        const answer = record.kind === "deploy" ? deploy(replay, record.command) : record.kind === "order" ? order(replay, record.command) : record.kind === "formation" ? formation(replay, record.command.unitId, record.command.formation) : record.kind === "stance" ? stance(replay, record.command.unitId, record.command.stance) : record.kind === "fieldwork-place" ? placeFortification(replay, record.command) : record.kind === "fieldwork-move" ? moveFortification(replay, record.command) : record.kind === "fieldwork-remove" ? removeFortification(replay, record.command.id) : ambush(replay, record.command.unitId);
        if (!answer.ok) return null;
        replay = answer.battle;
      } else if (record.kind === "turn-order" && controlMode === "turns") {
        const answer = turnOrder(replay, record.command);
        if (!answer.ok) return null;
        replay = answer.battle;
      } else if (record.kind === "turn-end" && controlMode === "turns") {
        const answer = endTurn(replay);
        if (!answer.ok) return null;
        replay = answer.battle;
      } else if (record.kind === "start" && replay.phase === "deployment") replay = start(replay);
      else if (record.kind === "tick" && controlMode !== "turns" && replay.phase === "fighting" && Number.isInteger(record.steps) && record.steps > 0 && record.steps <= 8) {
        for (let step = 0; step < record.steps && replay.phase === "fighting"; step++) {
          tick(replay);
          yield { completed: index, total: battle.ledger.length, percent: Math.floor((index + (step + 1) / record.steps) / battle.ledger.length * 100) };
        }
        replay.ledger.push(copy(record));
      } else return null;
      yield { completed: index + 1, total: battle.ledger.length, percent: Math.floor((index + 1) / battle.ledger.length * 100) };
    }
    // Real-time fractional remainders are not part of the command ledger.
    replay.stepRemainder = battle.stepRemainder;
    return replay.phase === "finished" && JSON.stringify(replay) === JSON.stringify(battle) ? result(replay) : null;
  }
  function cachedVerification(state, battle) {
    const cached = battle && verifiedBattles.get(battle);
    return cached && cached.state === strategicSignature(state) && cached.battle === JSON.stringify(battle) ? copy(cached.report) : null;
  }
  function verify(state, battle) {
    try {
      const cached = cachedVerification(state, battle);
      if (cached) return cached;
      const replay = replayBattle(state, battle);
      let step;
      do { step = replay.next(); } while (!step.done);
      return step.value;
    } catch (_) { return null; }
  }
  async function verifyAsync(state, battle, options = {}) {
    try {
      if (options.signal?.aborted) return null;
      const cached = cachedVerification(state, battle);
      if (cached) return cached;
      // Snapshot both inputs before yielding: neither an order issued during
      // verification nor an edited survivor may earn a preverified result.
      const stateSignature = strategicSignature(state), battleSignature = JSON.stringify(battle);
      const replay = replayBattle(copy(state), copy(battle));
      const now = () => root.performance?.now?.() ?? Date.now();
      let deadline = now() + 8, sinceYield = 0, step;
      const notify = progress => { try { options.onProgress?.(progress); } catch (_) { /* Progress observers cannot change verification rules. */ } };
      notify({ completed: 0, total: battle?.ledger?.length || 0, percent: 0 });
      // Give the pending-result banner a paint before reconstructing combat.
      await new Promise(resolve => root.setTimeout(resolve, 0));
      do {
        if (options.signal?.aborted) return null;
        step = replay.next();
        if (!step.done && (++sinceYield >= 4 || now() >= deadline)) {
          notify(step.value);
          await new Promise(resolve => root.setTimeout(resolve, 0));
          sinceYield = 0; deadline = now() + 8;
        }
      } while (!step.done);
      if (!step.value || options.signal?.aborted || strategicSignature(state) !== stateSignature || JSON.stringify(battle) !== battleSignature) return null;
      verifiedBattles.set(battle, { state: stateSignature, battle: battleSignature, report: copy(step.value) });
      notify({ completed: battle.ledger.length, total: battle.ledger.length, percent: 100 });
      return copy(step.value);
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
    installed = { ...core, create, deploy, order, start, damage, move, tick, result, verify };
    return installed;
  }
  root.TenkaTactics = Object.freeze({ version: 2, formations: FORMATIONS, stances: STANCES, matchups: MATCHUPS, fortificationTypes: FORTIFICATIONS, install, prepare, createDefense, start, deploymentStatus, assignCommander, confirmDeployment, turnRules: TURN_RULES, turnView, endTurn, withdrawBattle, settleDefense, deploy, order, formation, stance, tacticalView, ambush, canAmbush, deploymentZone, placeFortification, moveFortification, removeFortification, fortificationBudget, fortificationContains, offsets, verify, verifyAsync, result, stamp });
})(typeof window !== "undefined" ? window : globalThis);
