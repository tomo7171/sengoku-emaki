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
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const sum = (values) => TYPES.reduce((total, type) => total + (values?.[type] || 0), 0);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const active = (unit) => unit.troops > 0 && !["routed", "destroyed"].includes(unit.status);
  const friendly = (battle) => battle.playerSide || "attacker";
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
  function blocked(battle, x, z, type) {
    if (type === "navy") return !isSea(battle, x, z);
    for (const water of battle.layout.water) {
      if (insidePolygon(x, z, water.polygon) && !battle.structures.some((structure) => (structure.kind || structure.type) === "bridge" && contains(structure, x, z, 0.8))) return true;
    }
    return battle.structures.some((structure) => structure.hp > 0 && !structure.passable && ["wall", "palisade", "gate", "hall"].includes(structure.kind || structure.type) && contains(structure, x, z, (structure.kind || structure.type) === "hall" ? 0.15 : 0.5));
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
    return battle;
  }
  function create(options) {
    const battle = original.create(options);
    return prepare(battle, { attackerFood: Math.max(0, options.state.food - 600), defenderFood: battle.targetCastle.food || 0 });
  }
  function createDefense(state, threat = state.pendingDefense) {
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
    return prepare(battle, { defending: true, attackerFood: Math.max(0, (source.food || 0) - 600), defenderFood: state.food });
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
    if (blocked(battle, x, z, type)) return reject(battle, "堀・海・城壁を避け、水軍は海上へ配置してください。");
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
    if (command.targetId && !battle.units.some((item) => item.id === command.targetId && item.side !== side) && !(side === "attacker" && battle.structures.some((item) => item.id === command.targetId))) return reject(battle, "敵部隊または攻撃可能な城の施設を選んでください。");
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
    }
    return original.damage(battle, attacker, target, structure) * factor;
  }
  function move(battle, unit, x, z) {
    if (unit.ambush && !unit.revealed) return;
    if (battle.defending && unit.side === "defender" && unit.order === "hold") return;
    // The engine chooses a normalized movement vector; scaling its target distance
    // preserves collision handling while changing the step size below.
    const oldX = unit.x, oldZ = unit.z;
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
    original.move(battle, unit, x, z);
    const factor = (FORMATIONS[unit.formation] || FORMATIONS.line).speed;
    if (factor !== 1) {
      const nextX = oldX + (unit.x - oldX) * factor, nextZ = oldZ + (unit.z - oldZ) * factor;
      if (!blocked(battle, nextX, nextZ, unit.type)) { unit.x = nextX; unit.z = nextZ; }
    }
    for (const gate of gates) gate.passable = false;
  }
  function tick(battle) {
    if (battle.phase !== "fighting") return;
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
      let replay = battle.defending ? createDefense(state, { sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode }) : create({ state, sourceId: battle.sourceId, targetId: battle.targetId, mode: battle.mode });
      for (const record of battle.ledger) {
        if (record.kind === "deploy" || record.kind === "order" || record.kind === "formation" || record.kind === "ambush") {
          const answer = record.kind === "deploy" ? deploy(replay, record.command) : record.kind === "order" ? order(replay, record.command) : record.kind === "formation" ? formation(replay, record.command.unitId, record.command.formation) : ambush(replay, record.command.unitId);
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
  root.TenkaTactics = Object.freeze({ version: 1, formations: FORMATIONS, matchups: MATCHUPS, install, prepare, createDefense, settleDefense, deploy, order, formation, ambush, canAmbush, deploymentZone, offsets, verify, result, stamp });
})(typeof window !== "undefined" ? window : globalThis);
