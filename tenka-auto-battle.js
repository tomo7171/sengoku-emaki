(function (root) {
  "use strict";
  // Standing orders are a UI preference, never a second simulation or a trusted
  // battle record. Each call emits the same legal orders and single turn that a
  // player can issue manually, so the existing replay/settlement checks apply.
  const ACTIONS = new Set(["attack", "move", "wait", "defend", "retreat"]);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const live = unit => unit.troops > 0 && !["routed", "destroyed"].includes(unit.status);
  const side = battle => battle.playerSide || "attacker";
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const boxFor = battle => {
    const box = battle.layout.bounds;
    return { minX: box.minX ?? box.xMin, maxX: box.maxX ?? box.xMax, minZ: box.minZ ?? box.zMin, maxZ: box.maxZ ?? box.zMax };
  };
  function inside(x, z, points = []) {
    let answer = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a, b] = points[i], [c, d] = points[j];
      if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) answer = !answer;
    }
    return answer;
  }
  function contains(item, x, z, padding = .6) {
    const angle = (item.rotation || 0) * Math.PI / 180, dx = x - item.x, dz = z - item.z;
    return Math.abs(dx * Math.cos(angle) + dz * Math.sin(angle)) <= (item.w ?? item.width ?? 0) / 2 + padding
      && Math.abs(-dx * Math.sin(angle) + dz * Math.cos(angle)) <= (item.d ?? item.depth ?? 0) / 2 + padding;
  }
  function impassable(battle, unit, x, z, padding = .6) {
    const box = boxFor(battle);
    if (x < box.minX + 1 || x > box.maxX - 1 || z < box.minZ + 1 || z > box.maxZ - 1) return true;
    const sea = battle.layout.water.some(item => item.type === "sea" && inside(x, z, item.polygon));
    if (unit.type === "navy") return !sea;
    if (root.TenkaBattlefield?.blocked(battle.layout, x, z, padding)) return true;
    if (battle.layout.water.some(item => inside(x, z, item.polygon))
      && !battle.structures.some(item => (item.kind || item.type) === "bridge" && contains(item, x, z, .8))) return true;
    if ((battle.fortifications || []).some(item => item.kind === "palisade" && item.hp > 0 && contains(item, x, z, padding))) return true;
    return battle.structures.some(item => {
      const kind = item.kind || item.type;
      if (item.hp <= 0 || item.passable || !["wall", "palisade", "gate", "hall"].includes(kind)) return false;
      if (kind === "gate" && battle.defending && unit.side === "defender") return false;
      return contains(item, x, z, kind === "hall" ? .2 : padding);
    });
  }
  function segmentOpen(battle, unit, from, to, padding = .6) {
    const steps = Math.max(1, Math.ceil(distance(from, to) / .45));
    for (let i = 1; i <= steps; i++) if (impassable(battle, unit,
      from.x + (to.x - from.x) * i / steps, from.z + (to.z - from.z) * i / steps, padding)) return false;
    return true;
  }
  function castleRoute(battle, unit, goal) {
    if (battle.mode !== "siege" || unit.type === "navy") return [];
    // Exact historical approach/gate centers keep the planner on narrow
    // switchback passages that a world-sized coarse grid can miss.
    const points = [[unit.x, unit.z], [goal.x, goal.z], ...(battle.layout.paths[0]?.points || [])];
    for (const gate of battle.structures.filter(item => (item.kind || item.type) === "gate" && item.hp <= 0)) {
      points.push([gate.x, gate.z - 1.8], [gate.x, gate.z], [gate.x, gate.z + 1.8]);
    }
    for (const hall of battle.structures.filter(item => (item.kind || item.type) === "hall" && item.hp > 0)) {
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) points.push([hall.x + dx * ((hall.w ?? hall.width) / 2 + 1.2), hall.z + dz * ((hall.d ?? hall.depth) / 2 + 1.2)]);
    }
    const costs = Array(points.length).fill(Infinity), previous = Array(points.length).fill(-1), closed = new Set();
    costs[0] = 0;
    for (let count = 0; count < points.length; count++) {
      let current = -1;
      for (let id = 0; id < points.length; id++) if (!closed.has(id) && (current < 0 || costs[id] < costs[current])) current = id;
      if (current < 0 || !Number.isFinite(costs[current])) return [];
      if (current === 1) {
        const result = [];
        for (let at = current; at !== 0; at = previous[at]) result.unshift(points[at]);
        return result;
      }
      closed.add(current);
      const from = { x: points[current][0], z: points[current][1] };
      for (let id = 1; id < points.length; id++) {
        if (closed.has(id)) continue;
        const to = { x: points[id][0], z: points[id][1] }, cost = costs[current] + distance(from, to);
        if (cost >= costs[id] || !segmentOpen(battle, unit, from, to)) continue;
        costs[id] = cost; previous[id] = current;
      }
    }
    return [];
  }
  function gridRoute(battle, unit, goal, search) {
    // Bound the search independently of the ten-times-larger battle map. A
    // blocked destination must never freeze the UI trying every world cell.
    const box = boxFor(battle), grid = unit.type === "navy" ? 3 : 2;
    const columns = Math.ceil((box.maxX - box.minX - 2) / grid) + 1, rows = Math.ceil((box.maxZ - box.minZ - 2) / grid) + 1;
    const point = id => ({ x: Math.min(box.maxX - 1, box.minX + 1 + id % columns * grid), z: Math.min(box.maxZ - 1, box.minZ + 1 + Math.floor(id / columns) * grid) });
    const node = p => Math.max(0, Math.min(rows - 1, Math.round((p.z - box.minZ - 1) / grid))) * columns
      + Math.max(0, Math.min(columns - 1, Math.round((p.x - box.minX - 1) / grid)));
    const occupancy = new Map();
    const open = id => {
      if (!occupancy.has(id)) { const p = point(id); occupancy.set(id, !impassable(battle, unit, p.x, p.z)); }
      return occupancy.get(id);
    };
    const nearest = p => {
      const id = node(p), x = id % columns, z = Math.floor(id / columns);
      let best = null, score = Infinity;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue;
        const candidate = (z + dz) * columns + x + dx, q = point(candidate), d = distance(p, q);
        if (d < score && open(candidate) && segmentOpen(battle, unit, p, q)) { best = candidate; score = d; }
      }
      return best;
    };
    const start = nearest(unit), end = nearest(goal);
    if (start === null || end === null) return [];
    const heap = [], previous = new Map([[start, null]]), costs = new Map([[start, 0]]), closed = new Set();
    const push = (id, score) => { let index = heap.length; heap.push({ id, score }); while (index) { const parent = (index - 1) >> 1; if (heap[parent].score <= score) break; heap[index] = heap[parent]; index = parent; } heap[index] = { id, score }; };
    const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let index = 0; while (index * 2 + 1 < heap.length) { let child = index * 2 + 1; if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++; if (heap[child].score >= last.score) break; heap[index] = heap[child]; index = child; } heap[index] = last; } return first.id; };
    push(start, distance(unit, goal));
    while (heap.length && closed.size < 1600 && search.remaining > 0) {
      const current = pop();
      if (closed.has(current)) continue;
      if (current === end) {
        const result = [[goal.x, goal.z]];
        for (let at = current; at !== null; at = previous.get(at)) { const p = point(at); result.unshift([p.x, p.z]); }
        return result;
      }
      closed.add(current); search.remaining--;
      const x = current % columns, z = Math.floor(current / columns), from = point(current);
      for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (x + dx < 0 || x + dx >= columns || z + dz < 0 || z + dz >= rows) continue;
        const next = (z + dz) * columns + x + dx, cost = costs.get(current) + Math.hypot(dx, dz) * grid;
        if (closed.has(next) || cost >= (costs.get(next) ?? Infinity) || !open(next) || !segmentOpen(battle, unit, from, point(next))) continue;
        previous.set(next, current); costs.set(next, cost); push(next, cost + distance(point(next), goal));
      }
    }
    return [];
  }
  function route(battle, unit, goal, search) {
    if (segmentOpen(battle, unit, unit, goal)) return [[goal.x, goal.z]];
    const castlePath = castleRoute(battle, unit, goal);
    return castlePath.length ? castlePath : gridRoute(battle, unit, goal, search);
  }
  function stepToward(battle, unit, goal, budget, search) {
    const path = route(battle, unit, goal, search);
    let answer = null;
    // Select the farthest visible waypoint the troop's actual turn budget can
    // reach. The native engine enforces collision and total movement again.
    for (const [x, z] of path) {
      const waypoint = { x, z }, length = distance(unit, waypoint);
      const candidate = length > budget ? { x: unit.x + (x - unit.x) * budget / length, z: unit.z + (z - unit.z) * budget / length } : waypoint;
      if (segmentOpen(battle, unit, unit, candidate) && distance(unit, candidate) > .12) answer = candidate;
      else if (answer) break;
      if (length > budget) break;
    }
    return answer;
  }
  function reachFor(unit, target) {
    return unit.range + (Number.isFinite(target.troops) ? 0 : Math.max(target.w ?? target.width ?? 0, target.d ?? target.depth ?? 0) / 2);
  }
  function attackGoals(battle, unit, target) {
    const reach = reachFor(unit, target), angle = Math.atan2(unit.z - target.z, unit.x - target.x), goals = [];
    for (const offset of [0, .35, -.35, .7, -.7, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const radius = Math.max(.3, reach - .7), point = { x: target.x + Math.cos(angle + offset) * radius, z: target.z + Math.sin(angle + offset) * radius };
      if (!impassable(battle, unit, point.x, point.z)) goals.push(point);
    }
    return goals;
  }
  function captureDestination(battle, unit) {
    const area = battle.captureZone, points = [];
    for (let dz = -area.depth / 2 + 1; dz <= area.depth / 2 - 1; dz += 2) for (let dx = -area.width / 2 + 1; dx <= area.width / 2 - 1; dx += 2) {
      const point = { x: area.x + dx, z: area.z + dz };
      if (!impassable(battle, unit, point.x, point.z)) points.push(point);
    }
    points.sort((a, b) => distance(unit, a) - distance(unit, b));
    return points[0] || null;
  }
  function targetFor(battle, unit, instruction) {
    if (instruction.targetId === "capture") {
      // This broad, explicitly selected objective includes clearing the castle
      // defenders. A named enemy/gate order below never chooses a substitute.
      const enemies = battle.units.filter(item => item.side !== unit.side && live(item));
      const immediate = enemies.filter(item => distance(unit, item) <= unit.range).sort((a, b) => distance(unit, a) - distance(unit, b));
      return immediate[0] || battle.structures.filter(item => (item.kind || item.type) === "gate" && item.hp > 0)
        .sort((a, b) => b.z - a.z || distance(unit, a) - distance(unit, b))[0]
        || enemies.sort((a, b) => distance(unit, a) - distance(unit, b))[0] || null;
    }
    return battle.units.find(item => item.id === instruction.targetId && item.side !== unit.side && live(item))
      || (unit.side === "attacker" && battle.structures.find(item => item.id === instruction.targetId && item.hp > 0))
      || (battle.fortifications || []).find(item => item.id === instruction.targetId && item.side !== unit.side && item.hp > 0) || null;
  }
  function invalid(battle, orders, message) { return { ok: false, battle, orders, message, notices: [] }; }
  function normalize(battle, orders) {
    if (!orders || typeof orders !== "object" || Array.isArray(orders)) return "部隊ごとの自動命令を指定してください。";
    for (const [id, instruction] of Object.entries(orders)) {
      const unit = battle.units.find(item => item.id === id && item.side === side(battle));
      if (!unit || !instruction || typeof instruction !== "object" || !ACTIONS.has(instruction.action)) return "自軍の部隊と有効な自動命令を指定してください。";
      if (!live(unit)) continue;
      if (instruction.action === "move" && (![instruction.x, instruction.z].every(Number.isFinite)
        || impassable(battle, unit, instruction.x, instruction.z))) return "自動移動の目的地は、部隊が通れる戦場内の場所を指定してください。";
      if (instruction.action === "attack") {
        if (instruction.targetId === "capture") {
          if (battle.mode !== "siege" || unit.side !== "attacker" || unit.type === "navy") return "本丸制圧は攻城側の陸上部隊に指定してください。";
        } else {
          if (typeof instruction.targetId !== "string" || !instruction.targetId) return "自動攻撃の目標を選んでください。";
          const target = battle.units.find(item => item.id === instruction.targetId)
            || battle.structures.find(item => item.id === instruction.targetId)
            || (battle.fortifications || []).find(item => item.id === instruction.targetId);
          if (!target || target.side === unit.side || (own(target, "hp") && battle.structures.includes(target) && unit.side !== "attacker")) return "攻撃できる敵部隊・城門・敵の施設を選んでください。";
        }
      }
    }
    return null;
  }
  function advance(battle, standingOrders = {}) {
    if (!battle || battle.controlMode !== "turns" || battle.phase !== "fighting") return invalid(battle, standingOrders, "全隊の指揮官と配置を確認して開戦してから、自動進行を始めてください。");
    const tactics = root.TenkaTactics;
    if (!tactics?.order || !tactics.endTurn) return invalid(battle, standingOrders, "ターン制の合戦機関を読み込めませんでした。");
    const error = normalize(battle, standingOrders);
    if (error) return invalid(battle, standingOrders, error);
    const orders = {}, notices = [];
    let next = battle;
    const notify = (unit, message) => notices.push({ unitId: unit.id, message: `${unit.commanderName}隊：${message}` });
    const issue = command => {
      const answer = tactics.order(next, command);
      if (answer.ok) next = answer.battle;
      return answer;
    };
    for (const unit of battle.units.filter(item => item.side === side(battle))) {
      const given = own(standingOrders, unit.id) ? standingOrders[unit.id] : { action: "wait" };
      orders[unit.id] = given.action === "move" ? { action: "move", x: given.x, z: given.z }
        : given.action === "attack" ? { action: "attack", targetId: given.targetId } : { action: given.action };
      if (!live(unit)) continue;
      const clear = issue({ unitId: unit.id, order: "wait" });
      if (!clear.ok) return invalid(battle, standingOrders, clear.message);
      if (["wait", "defend", "retreat"].includes(given.action)) {
        if (given.action !== "wait") {
          const answer = issue({ unitId: unit.id, order: given.action });
          if (!answer.ok) return invalid(battle, standingOrders, answer.message);
        }
        continue;
      }
      const target = given.action === "attack" ? targetFor(battle, unit, given) : null;
      if (given.action === "attack" && !target && given.targetId !== "capture") {
        orders[unit.id] = { action: "wait" }; notify(unit, "指定目標が戦線を離れたため待機します。次の目標を選んでください。"); continue;
      }
      if (target && distance(unit, target) <= reachFor(unit, target) - .02) {
        const answer = issue({ unitId: unit.id, order: "attack", targetId: target.id });
        if (!answer.ok) return invalid(battle, standingOrders, answer.message);
        continue;
      }
      const goals = given.action === "move" ? [{ x: given.x, z: given.z }]
        : target ? attackGoals(battle, unit, target) : [captureDestination(battle, unit)].filter(Boolean);
      const budget = tactics.turnView(next, unit.id).selected.movement * .96;
      let destination = null;
      const search = { remaining: 1600 };
      for (const goal of goals) {
        if (given.action === "move" && distance(unit, goal) <= .65) {
          orders[unit.id] = { action: "wait" }; notify(unit, "目的地に到着したため待機します。"); break;
        }
        destination = stepToward(battle, unit, goal, budget, search);
        if (destination) break;
      }
      if (!destination) {
        if (orders[unit.id].action !== "wait") notify(unit, "進路が塞がれています。待機し、次の自動ターンでも同じ目標への経路を確認します。");
        continue;
      }
      const moved = issue({ unitId: unit.id, order: "move", ...destination });
      if (!moved.ok) return invalid(battle, standingOrders, moved.message);
      if (target && distance(destination, target) <= reachFor(unit, target) - .02) {
        const answer = issue({ unitId: unit.id, order: "attack", targetId: target.id });
        if (!answer.ok) return invalid(battle, standingOrders, answer.message);
      }
    }
    const answer = tactics.endTurn(next);
    if (!answer.ok) return invalid(battle, standingOrders, answer.message);
    next = answer.battle;
    for (const [id, instruction] of Object.entries(orders)) {
      const unit = next.units.find(item => item.id === id);
      if (instruction.action === "move" && live(unit) && distance(unit, instruction) <= .65) {
        orders[id] = { action: "wait" }; notify(unit, "目的地に到着したため待機します。");
      } else if (instruction.action === "attack" && instruction.targetId !== "capture" && !targetFor(next, unit, instruction)) {
        orders[id] = { action: "wait" }; notify(unit, "指定目標が戦線を離れたため待機します。次の目標を選んでください。");
      }
    }
    return { ok: true, battle: next, orders, notices, message: next.phase === "finished" ? "合戦の決着がつきました。戦果を確認してください。"
      : notices.length ? notices.map(item => item.message).join(" ") : `自動で一ターン進行しました（第${next.turnNumber}ターン）。` };
  }
  root.TenkaAutoBattle = Object.freeze({ version: 1, advance });
})(typeof window !== "undefined" ? window : globalThis);
