(function (root) {
  "use strict";

  // A second renderer for the authoritative tactical state. This module never
  // advances the simulation, changes a troop, or substitutes artwork for terrain.
  const TYPES = { ashigaru: "足軽", cavalry: "騎馬", firearm: "鉄砲", archer: "弓", navy: "水軍" };
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  function boundsOf(layout = {}) {
    const b = layout.bounds || {};
    return { minX: finite(b.minX ?? b.xMin, -44), maxX: finite(b.maxX ?? b.xMax, 44), minZ: finite(b.minZ ?? b.zMin, -50), maxZ: finite(b.maxZ ?? b.zMax, 42) };
  }
  function projection({ width, height, x = 0, z = 0, scale = 1 }) {
    const s = Math.max(.001, finite(scale, 1));
    return {
      toScreen: (wx, wz) => ({ x: width / 2 + (wx - x) * s, y: height / 2 + (wz - z) * s }),
      toWorld: (sx, sy) => ({ x: x + (sx - width / 2) / s, z: z + (sy - height / 2) / s }),
      scale: s,
    };
  }
  function footprint(item, padding = 0) {
    if (item.polygon?.length && !padding) return item.polygon;
    const w = finite(item.w ?? item.width, 1) / 2 + padding, d = finite(item.d ?? item.depth, 1) / 2 + padding;
    const c = Math.cos(item.rotation || 0), s = Math.sin(item.rotation || 0);
    return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([x, z]) => [item.x + x * c - z * s, item.z + x * s + z * c]);
  }
  function contains(item, x, z, padding = 0) {
    const dx = x - item.x, dz = z - item.z, c = Math.cos(item.rotation || 0), s = Math.sin(item.rotation || 0);
    return Math.abs(dx * c + dz * s) <= finite(item.w ?? item.width, 1) / 2 + padding && Math.abs(-dx * s + dz * c) <= finite(item.d ?? item.depth, 1) / 2 + padding;
  }
  function groundHeight(layout, x, z) {
    let y = finite(layout.ground?.base, .18);
    for (const peak of layout.ground?.peaks || []) y += peak.height * Math.exp(-(((x - peak.x) / peak.sx) ** 2 + ((z - peak.z) / peak.sz) ** 2));
    y += root.TenkaBattlefield?.elevationDelta?.(layout, x, z) || 0;
    return y;
  }
  function create(mount, options = {}) {
    const document = mount?.ownerDocument || root.document;
    if (!mount || !document?.createElement) throw new Error("合戦場の表示先がありません。");
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("合戦場の画像表示を初期化できませんでした。");
    canvas.className = "tenka-battle-2d";
    canvas.setAttribute("aria-label", "写実地形の合戦場。部隊を選択し、地面を押して配置・移動。拡大縮小と地図の移動ができます。");
    canvas.setAttribute("role", "img"); canvas.tabIndex = 0;
    Object.assign(canvas.style, { display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "crosshair", outlineOffset: "-3px" });
    mount.appendChild(canvas);
    const backdrop = document.createElement("canvas"), back = backdrop.getContext("2d", { alpha: false });
    let battle = options.battle || {}, layout = options.layout || battle.layout || {}, bounds = boundsOf(layout);
    let width = 1, height = 1, ratio = 1, selected = null, selectedStructure = null, placement = battle.phase === "deployment", tool = "unit", rotation = 0, rangeVisible = true, namesVisible = true;
    let camera = { x: 0, z: -3, scale: 1 }, transform = projection({ width, height, ...camera });
    let disposed = false, frame = 0, backgroundDirty = true, ready = false, pointer = null, mini = null;
    let scenery = null, textures = null, fortress = null, labelRects = [];
    const listeners = [], pointers = new Map();
    function listen(target, name, handler, settings) { target.addEventListener(name, handler, settings); listeners.push(() => target.removeEventListener(name, handler, settings)); }
    function invalidate(terrain = false) {
      if (disposed) return;
      backgroundDirty ||= terrain;
      if (!frame) frame = root.requestAnimationFrame ? root.requestAnimationFrame(draw) : root.setTimeout(draw, 0);
    }
    const Texture = class { constructor(image) { this.image = image; this.repeat = { set() {} }; } dispose() {} };
    const textureAPI = { CanvasTexture: Texture, SRGBColorSpace: "srgb", RepeatWrapping: 1000 };
    try {
      textures = root.TenkaCastles?.createTextures?.(textureAPI, { onLoad: () => invalidate(true) });
      fortress = root.TenkaFortressMaterials?.createTextures?.(textureAPI, { onLoad: () => invalidate(true) });
    } catch (_) { /* Plain textured painting remains available if image decoding fails. */ }
    try { scenery = root.TenkaBattleEnvironment?.plan?.({ battle, layout, heightAt: (x, z) => groundHeight(layout, x, z) }); } catch (_) { scenery = null; }
    function refreshProjection() { transform = projection({ width, height, ...camera }); }
    function fit(items, margin = 15, minimum = 68) {
      const points = items.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
      if (!points.length) return;
      const minX = Math.min(...points.map(p => p.x - finite(p.w ?? p.width, 0) / 2)), maxX = Math.max(...points.map(p => p.x + finite(p.w ?? p.width, 0) / 2));
      const minZ = Math.min(...points.map(p => p.z - finite(p.d ?? p.depth, 0) / 2)), maxZ = Math.max(...points.map(p => p.z + finite(p.d ?? p.depth, 0) / 2));
      camera = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, scale: Math.min(width / Math.max(minimum, maxX - minX + margin * 2), height / Math.max(minimum, maxZ - minZ + margin * 2)) };
      refreshProjection(); invalidate(true);
    }
    function resetView() { fit([...(battle.units || []).filter(u => u.troops > 0), ...(battle.structures || []).filter(s => !s.landscape)], 17, 80); }
    function resize() {
      if (disposed) return;
      const oldW = width, oldH = height;
      width = Math.max(1, mount.clientWidth || 640); height = Math.max(1, mount.clientHeight || 420);
      ratio = clamp(root.devicePixelRatio || 1, 1, 1.5);
      canvas.width = backdrop.width = Math.round(width * ratio); canvas.height = backdrop.height = Math.round(height * ratio);
      if (oldW <= 1 || oldH <= 1) resetView(); else camera.scale *= Math.min(width / oldW, height / oldH);
      refreshProjection(); invalidate(true);
    }
    function path(context, points, close = true, dy = 0) {
      if (!points?.length) return;
      context.beginPath();
      points.forEach(([x, z], i) => { const p = transform.toScreen(x, z); i ? context.lineTo(p.x, p.y + dy) : context.moveTo(p.x, p.y + dy); });
      if (close) context.closePath();
    }
    function fillPoly(context, points, color, line, dy = 0) { path(context, points, true, dy); context.fillStyle = color; context.fill(); if (line) { context.strokeStyle = line; context.lineWidth = .8; context.stroke(); } }
    function label(context, text, x, y, color = "#f9f2da", size = 11, panel = true) {
      context.font = `600 ${size}px sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
      const tw = context.measureText(text).width;
      if (panel) { context.fillStyle = "rgba(27,38,31,.85)"; context.fillRect(x - tw / 2 - 5, y - size / 2 - 4, tw + 10, size + 8); }
      context.fillStyle = color; context.fillText(text, x, y);
    }
    function pattern(context, texture, fallback) {
      const image = texture?.image;
      if (!image) return fallback;
      const paint = context.createPattern(image, "repeat");
      if (paint?.setTransform && root.DOMMatrix) paint.setTransform(new root.DOMMatrix().scale(.32));
      return paint || fallback;
    }
    function terrain() {
      back.setTransform(ratio, 0, 0, ratio, 0, 0);
      back.fillStyle = "#68724c"; back.fillRect(0, 0, width, height);
      // Camera-relative terrain paint is cached until the camera or assets change.
      // Elevation samples are the same map data as tactical movement.
      const step = 7;
      for (let sy = 0; sy < height; sy += step) for (let sx = 0; sx < width; sx += step) {
        const w = transform.toWorld(sx, sy), h = groundHeight(layout, w.x, w.z), slope = groundHeight(layout, w.x - 1.7, w.z - 1.2) - h;
        const noise = root.TenkaBattleEnvironment?.surfaceNoise?.(w.x * .15, w.z * .15) ?? .5;
        const shade = clamp(slope * 8 + noise * 17 + h * .6, -26, 35);
        back.fillStyle = `rgb(${Math.round(107 + shade)},${Math.round(116 + shade)},${Math.round(73 + shade * .8)})`;
        back.fillRect(sx, sy, step + 1, step + 1);
      }
      back.save(); back.globalAlpha = .075; back.fillStyle = pattern(back, textures?.ground, "#8a8968"); back.fillRect(0, 0, width, height); back.restore();
      const world = layout.landscape || {};
      for (const field of world.fields || []) {
        const p = footprint(field); fillPoly(back, p, field.kind === "paddy" ? "#859067" : "#a39964", "#c4b17d");
        back.save(); path(back, p); back.clip(); back.strokeStyle = field.kind === "paddy" ? "#a4b19a" : "#7d784f"; back.lineWidth = Math.max(.4, camera.scale * .12);
        for (let z = field.z - (field.d || field.depth || 10) / 2; z <= field.z + (field.d || field.depth || 10) / 2; z += 1.1) { path(back, [[field.x - 30, z], [field.x + 30, z]], false); back.stroke(); } back.restore();
      }
      for (const road of layout.paths || []) { path(back, road.points, false); back.lineCap = "round"; back.strokeStyle = "#716346"; back.lineWidth = Math.max(1.2, (road.width || 2) * camera.scale + 1.3); back.stroke(); back.strokeStyle = "#b9a17a"; back.lineWidth = Math.max(.8, (road.width || 2) * camera.scale); back.stroke(); }
      for (const water of layout.water || []) {
        const gradient = back.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, "#355b66"); gradient.addColorStop(.55, "#6a989b"); gradient.addColorStop(1, "#416f78");
        fillPoly(back, water.polygon, gradient, "#adab8b"); back.save(); path(back, water.polygon); back.clip(); back.globalAlpha = .22; back.strokeStyle = "#c2d8cc"; back.lineWidth = .6;
        for (let y = 0; y < height; y += 7) { back.beginPath(); back.moveTo(0, y); back.lineTo(width, y - 2); back.stroke(); } back.restore();
      }
      for (const bailey of layout.baileys || []) {
        const points = bailey.polygon || footprint(bailey); fillPoly(back, points, "#827957", "#bba780");
        back.save(); back.globalAlpha = .32; fillPoly(back, points, pattern(back, fortress?.earth || textures?.earth, "#92856b")); back.restore();
      }
      for (const town of world.settlements || []) for (const house of town.houses || []) drawBuilding(back, house, house.roof === "thatch" ? "#8a7450" : "#5c5f57", false);
      for (const tree of scenery?.trees || []) {
        const p = transform.toScreen(tree.x, tree.z), radius = clamp(tree.size * camera.scale * 1.5, 1, 15);
        if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) continue;
        back.fillStyle = "rgba(21,32,21,.22)"; back.beginPath(); back.ellipse(p.x + radius * .45, p.y + radius * .5, radius * 1.05, radius * .7, -.5, 0, Math.PI * 2); back.fill();
        const glow = back.createRadialGradient(p.x - radius * .3, p.y - radius * .3, 0, p.x, p.y, radius); glow.addColorStop(0, "#738452"); glow.addColorStop(.5, tree.kind === "cedar" ? "#3c5840" : "#516b41"); glow.addColorStop(1, "#263f2a"); back.fillStyle = glow;
        // Irregular crowns and small lit leaf clusters replace spherical tokens.
        back.beginPath();
        for (let i = 0; i < 18; i++) { const angle = i / 18 * Math.PI * 2, edge = radius * (.84 + Math.sin(i * 12.7 + tree.x) * .12 + Math.cos(i * 5.2 + tree.z) * .08); const x = p.x + Math.cos(angle) * edge, y = p.y + Math.sin(angle) * edge; i ? back.lineTo(x, y) : back.moveTo(x, y); }
        back.closePath(); back.fill();
        if (radius > 3) for (let leaf = 0; leaf < 15; leaf++) { const angle = leaf * 2.399 + tree.x, distance = Math.sqrt((leaf + .5) / 15) * radius * .75; back.fillStyle = leaf % 3 === 0 ? "rgba(165,179,113,.20)" : "rgba(27,51,28,.18)"; back.beginPath(); back.arc(p.x + Math.cos(angle) * distance, p.y + Math.sin(angle) * distance, Math.max(.5, radius * .15), 0, Math.PI * 2); back.fill(); }
      }
      const corner = transform.toScreen(bounds.minX, bounds.minZ), end = transform.toScreen(bounds.maxX, bounds.maxZ);
      back.strokeStyle = "rgba(227,220,182,.65)"; back.lineWidth = 1; back.strokeRect(corner.x, corner.y, end.x - corner.x, end.y - corner.y);
      backgroundDirty = false;
    }
    function drawBuilding(context, item, color = "#59615b", wall = true) {
      const points = footprint(item), lift = clamp((item.height || 2) * camera.scale * .48, 1, 28);
      context.save(); context.shadowColor = "rgba(20,25,18,.45)"; context.shadowBlur = 4; context.shadowOffsetX = 3; context.shadowOffsetY = 4;
      fillPoly(context, points, wall ? "#b9b5a0" : "#8e8064", "#4d4b3c"); context.restore();
      fillPoly(context, points, color, "#333f37", -lift);
      // Sunlit and shaded roof pitches keep the photographic tile grain while
      // giving the real footprint a restrained height above its wall base.
      const ridgeA = [(points[0][0] + points[3][0]) / 2, (points[0][1] + points[3][1]) / 2], ridgeB = [(points[1][0] + points[2][0]) / 2, (points[1][1] + points[2][1]) / 2];
      fillPoly(context, [points[0], points[1], ridgeB, ridgeA], "rgba(213,215,195,.15)", null, -lift);
      fillPoly(context, [ridgeA, ridgeB, points[2], points[3]], "rgba(10,21,22,.20)", null, -lift);
      context.save(); path(context, points, true, -lift); context.clip(); context.globalAlpha = .24; context.fillStyle = pattern(context, textures?.roof, color); context.fill(); context.restore();
      const first = transform.toScreen(item.x - (item.w || item.width || 2) / 2, item.z), last = transform.toScreen(item.x + (item.w || item.width || 2) / 2, item.z);
      context.beginPath(); context.moveTo(first.x, first.y - lift); context.lineTo(last.x, last.y - lift); context.strokeStyle = "#a8aaa0"; context.lineWidth = Math.max(.6, camera.scale * .11); context.stroke();
    }
    function structure(item) {
      const kind = item.kind || item.type, p = transform.toScreen(item.x, item.z), points = footprint(item);
      const destroyed = item.maxHp > 0 && item.hp <= 0;
      if (kind === "bridge") {
        if (/浅瀬|渡し/.test(item.name || "")) { fillPoly(ctx, points, "rgba(172,160,115,.40)", "rgba(197,184,140,.45)"); return; }
        fillPoly(ctx, points, "#8c795a", "#4c4d3c");
        ctx.save(); path(ctx, points); ctx.clip(); ctx.globalAlpha = .5; ctx.fillStyle = pattern(ctx, textures?.wood, "#968566"); ctx.fill(); ctx.restore();
        const half = finite(item.w ?? item.width, 2) / 2;
        if (camera.scale > 1) for (let x = -half; x < half; x += .8) { const c = Math.cos(item.rotation || 0), s = Math.sin(item.rotation || 0), d = finite(item.d ?? item.depth, 2) / 2; path(ctx, [[item.x + x * c + d * s, item.z + x * s - d * c], [item.x + x * c - d * s, item.z + x * s + d * c]], false); ctx.strokeStyle = "rgba(44,48,35,.45)"; ctx.lineWidth = .65; ctx.stroke(); }
        return;
      }
      if (destroyed) {
        fillPoly(ctx, points, "rgba(57,48,35,.64)", "#afa184");
        if (kind === "gate") { label(ctx, "突破", p.x, p.y, "#d7eab9", 10); }
        return;
      }
      const selectedHere = selectedStructure === item.id;
      if (kind === "gate" || kind === "tower" || kind === "watchtower" || kind === "hall" || kind === "keep" || kind === "camp") drawBuilding(ctx, item, kind === "camp" ? "#7b493b" : "#4d5956");
      else {
        const color = kind === "stone" || kind === "wall" ? "#8b8d7e" : kind === "earthwork" ? "#9a825c" : "#776345";
        ctx.save(); ctx.shadowColor = "rgba(18,25,18,.45)"; ctx.shadowOffsetY = 2.5; ctx.shadowBlur = 2; fillPoly(ctx, points, color, "#3e4637"); ctx.restore();
        ctx.save(); path(ctx, points); ctx.clip(); ctx.globalAlpha = .6; ctx.fillStyle = pattern(ctx, kind === "wall" || kind === "stone" ? fortress?.stone || textures?.stone : textures?.wood, color); ctx.fill(); ctx.restore();
        if (kind === "palisade" && camera.scale > 3) { ctx.strokeStyle = "#b4a687"; ctx.lineWidth = .7; path(ctx, points); ctx.stroke(); }
      }
      if (selectedHere) { path(ctx, footprint(item, .6)); ctx.strokeStyle = "#fff1a9"; ctx.lineWidth = 2; ctx.stroke(); }
      if ((kind === "gate" || selectedHere) && camera.scale > 1.4) {
        const w = clamp((item.w || item.width || 3) * camera.scale, 22, 55), y = p.y - 8 - Math.max(item.d || item.depth || 1, 1) * camera.scale / 2;
        ctx.fillStyle = "#2d332b"; ctx.fillRect(p.x - w / 2, y, w, 4); ctx.fillStyle = "#c6a05b"; ctx.fillRect(p.x - w / 2, y, w * clamp(item.hp / Math.max(1, item.maxHp), 0, 1), 4);
      }
    }
    function unit(item) {
      if (item.troops <= 0) return;
      const p = transform.toScreen(item.x, item.z), chosen = item.id === selected, friendly = item.side === (battle.playerSide || "attacker");
      const color = item.supportColor || (item.side === "attacker" ? battle.sourceCastle?.color || "#c44835" : battle.targetCastle?.color || "#38639a");
      const radius = clamp(camera.scale * 2.0, 5, 17), angle = Math.atan2(item.facingZ || -1, item.facingX || 0) + Math.PI / 2;
      if (chosen && rangeVisible) { ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, item.range || 2.5) * camera.scale, 0, Math.PI * 2); ctx.fillStyle = "rgba(234,211,123,.08)"; ctx.fill(); ctx.strokeStyle = "rgba(255,230,150,.48)"; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }
      if (chosen && item.order !== "hold" && Math.hypot(item.targetX - item.x, item.targetZ - item.z) > 1) { const dest = transform.toScreen(item.targetX, item.targetZ); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(dest.x, dest.y); ctx.strokeStyle = "#f7dda1"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(dest.x, dest.y, 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(angle);
      ctx.fillStyle = "rgba(18,24,19,.35)"; ctx.beginPath(); ctx.ellipse(2, 3, radius, radius * .6, 0, 0, Math.PI * 2); ctx.fill();
      if (item.type === "navy") {
        ctx.beginPath(); ctx.moveTo(0, -radius); ctx.lineTo(radius * .55, -radius * .35); ctx.lineTo(radius * .45, radius * .85); ctx.lineTo(-radius * .45, radius * .85); ctx.lineTo(-radius * .55, -radius * .35); ctx.closePath(); ctx.fillStyle = "#796348"; ctx.fill(); ctx.strokeStyle = "#c2ae87"; ctx.stroke();
        ctx.fillStyle = color; ctx.fillRect(-radius * .3, -radius * .2, radius * .6, radius * .75); ctx.strokeStyle = "#dfd2b3"; ctx.beginPath(); ctx.moveTo(0, -radius * .7); ctx.lineTo(0, radius * .6); ctx.stroke();
      }
      const count = clamp(Math.ceil(item.troops / 45), 3, 24), columns = item.formation === "column" ? 3 : 6;
      const spacing = Math.max(1.8, radius / 3.4);
      for (let i = 0; item.type !== "navy" && i < count; i++) {
        const x = (i % columns - (columns - 1) / 2) * spacing, y = (Math.floor(i / columns) - 1.3) * spacing;
        ctx.fillStyle = item.type === "cavalry" ? "#564434" : "#303b36"; ctx.fillRect(x - 1, y - 1, 2.3, item.type === "cavalry" ? 4 : 2.6);
        ctx.fillStyle = color; ctx.fillRect(x - .8, y - 1, 1.7, 1.4);
        ctx.fillStyle = "#d0bf98"; ctx.beginPath(); ctx.arc(x, y - 1.3, .7, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "#d3c8a7"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -radius - 5); ctx.lineTo(0, -radius + 2); ctx.stroke(); ctx.fillStyle = color; ctx.fillRect(0, -radius - 5, 6, 5); ctx.restore();
      if (chosen) { ctx.beginPath(); ctx.ellipse(p.x, p.y, radius + 4, radius * .7 + 4, 0, 0, Math.PI * 2); ctx.strokeStyle = "#fff2af"; ctx.lineWidth = 2; ctx.stroke(); }
      const barWidth = chosen ? 38 : 22; ctx.fillStyle = "#202b26"; ctx.fillRect(p.x - barWidth / 2, p.y + radius + 3, barWidth, 3); ctx.fillStyle = friendly ? "#a9d19a" : "#e9a58e"; ctx.fillRect(p.x - barWidth / 2, p.y + radius + 3, barWidth * clamp(item.troops / Math.max(1, item.maxTroops), 0, 1), 3);
      if (chosen) label(ctx, `${item.commanderName || TYPES[item.type] || "部隊"} ${item.troops}人`, clamp(p.x, 90, width - 90), clamp(p.y - radius - 20, 52, height - 25), "#fff2cd", 12);
      else if (camera.scale > 4.5) {
        const box = { x: p.x - 15, y: p.y + radius + 8, w: 30, h: 16 };
        if (!labelRects.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y)) { label(ctx, String(item.troops), p.x, p.y + radius + 14, "#f6ecd5", 10); labelRects.push(box); }
      }
    }
    function minimap() {
      const w = clamp(width * .20, 66, 120), h = w * (bounds.maxZ - bounds.minZ) / Math.max(1, bounds.maxX - bounds.minX), mh = Math.min(h, 116);
      mini = { x: width - w - 10, y: height - mh - 10, w, h: mh };
      ctx.fillStyle = "rgba(23,37,30,.9)"; ctx.fillRect(mini.x, mini.y, w, mh); ctx.strokeStyle = "#b1ad88"; ctx.lineWidth = 1; ctx.strokeRect(mini.x, mini.y, w, mh);
      const point = (x, z) => ({ x: mini.x + (x - bounds.minX) / (bounds.maxX - bounds.minX) * w, y: mini.y + (z - bounds.minZ) / (bounds.maxZ - bounds.minZ) * mh });
      for (const water of layout.water || []) { ctx.beginPath(); water.polygon.forEach(([x, z], i) => { const p = point(x, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fillStyle = "#6d969a"; ctx.fill(); }
      for (const item of [...(battle.structures || []).filter(s => s.kind === "gate"), ...(battle.units || []).filter(u => u.troops > 0)]) { const p = point(item.x, item.z); ctx.fillStyle = item.side === "attacker" ? "#f09579" : item.side === "defender" ? "#88b6e3" : "#e5d4a5"; ctx.fillRect(p.x - 1, p.y - 1, 2.5, 2.5); }
      const a = transform.toWorld(0, 0), b = transform.toWorld(width, height), p = point(a.x, a.z), q = point(b.x, b.z); ctx.save(); ctx.beginPath(); ctx.rect(mini.x, mini.y, w, mh); ctx.clip(); ctx.strokeStyle = "#fff3b5"; ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y); ctx.restore();
    }
    function draw() {
      frame = 0; if (disposed) return;
      try {
        if (backgroundDirty && back) terrain();
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); if (back) ctx.drawImage(backdrop, 0, 0, width, height); else { ctx.fillStyle = "#68724c"; ctx.fillRect(0, 0, width, height); }
        if (placement) {
          const zone = layout.deployment?.[battle.playerSide || "attacker"];
          if (zone) { const a = transform.toScreen(zone.xMin, zone.zMin), b = transform.toScreen(zone.xMax, zone.zMax); ctx.fillStyle = "rgba(183,211,135,.08)"; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([7, 6]); ctx.strokeStyle = "rgba(224,235,172,.5)"; ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.setLineDash([]); }
        }
        const objective = battle.captureZone;
        if (objective && battle.mode !== "field") { fillPoly(ctx, footprint(objective), "rgba(226,200,123,.10)", "rgba(255,225,155,.6)"); }
        for (const item of [...(battle.structures || []), ...(battle.fortifications || [])].sort((a, b) => a.z - b.z)) structure(item);
        if (namesVisible && camera.scale > 2) for (const bailey of layout.baileys || []) { const p = transform.toScreen(bailey.x, bailey.z); label(ctx, bailey.name || bailey.id, p.x, p.y, "#f6e5ba", 10); }
        labelRects = [];
        for (const item of [...(battle.units || [])].sort((a, b) => (a.id === selected) - (b.id === selected) || a.z - b.z)) unit(item);
        if (objective && battle.mode !== "field" && camera.scale > 2) { const p = transform.toScreen(objective.x, objective.z - (objective.d || objective.depth || 12) / 2); label(ctx, battle.phase === "finished" ? battle.winner === "attacker" ? "本丸制圧" : "本丸防衛" : "本丸・制圧目標", p.x, p.y - 15, "#ffe7a8", 10); }
        const phase = battle.phase === "deployment" ? "布陣" : battle.phase === "finished" ? battle.winner === (battle.playerSide || "attacker") ? "勝利・戦闘終了" : "敗北・戦闘終了" : "交戦中";
        label(ctx, `${phase} · ${battle.weather || "晴"}`, 72, 20, "#f7ecd1", 11);
        label(ctx, "北 ↑", width - 31, 20, "#e8e8d1", 10, false);
        minimap();
        if (!ready) { ready = true; options.onReady?.(); }
      } catch (error) { options.onError?.(`合戦場の表示を更新できませんでした。部隊一覧からも操作できます。${error?.message || ""}`); }
    }
    function screenPoint(event) { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * width / Math.max(1, r.width), y: (event.clientY - r.top) * height / Math.max(1, r.height) }; }
    function hit(p) {
      const w = transform.toWorld(p.x, p.y), candidates = (battle.units || []).filter(u => u.troops > 0).map(u => ({ unit: u, distance: Math.hypot(u.x - w.x, u.z - w.z) * camera.scale })).sort((a, b) => a.distance - b.distance);
      const unit = candidates[0]?.distance <= clamp(camera.scale * 2.7, 10, 20) ? candidates[0].unit : null;
      const structure = [...(battle.fortifications || []), ...(battle.structures || [])].find(s => s.hp > 0 && contains(s, w.x, w.z, Math.min(1, 3 / camera.scale)));
      return { world: w, unit, structure };
    }
    function ground(p, extra = {}, event = {}) {
      const point = transform.toWorld(p.x, p.y);
      options.onGroundClick?.({ ...point, shiftKey: !!event.shiftKey, placementRotation: rotation, ...extra });
    }
    function pointerDown(event) {
      const p = screenPoint(event); pointers.set(event.pointerId, p);
      if (pointers.size > 1) { pointer = null; return; }
      const found = hit(p), friendly = found.unit?.side === (battle.playerSide || "attacker"), fort = found.structure;
      pointer = { id: event.pointerId, start: p, latest: p, initialCamera: { ...camera }, unit: found.unit, structure: fort, moved: false, pan: event.button > 0 || event.altKey, drag: !event.altKey && event.button === 0 && (placement && fort?.side === (battle.playerSide || "attacker") && fort.hp > 0 || friendly && (placement && tool === "unit" || !placement && selected === found.unit.id)) };
      canvas.setPointerCapture?.(event.pointerId); event.preventDefault?.();
    }
    function pointerMove(event) {
      const p = screenPoint(event), previous = pointers.get(event.pointerId); pointers.set(event.pointerId, p);
      if (pointers.size === 2 && previous) { const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1]; if (other) zoomAt(Math.hypot(p.x - other.x, p.y - other.y) / Math.max(1, Math.hypot(previous.x - other.x, previous.y - other.y)), { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }); return; }
      if (!pointer || pointer.id !== event.pointerId) return;
      pointer.latest = p; pointer.moved ||= Math.hypot(p.x - pointer.start.x, p.y - pointer.start.y) > 5;
      if (pointer.moved && !pointer.drag) { camera.x = pointer.initialCamera.x - (p.x - pointer.start.x) / camera.scale; camera.z = pointer.initialCamera.z - (p.y - pointer.start.y) / camera.scale; refreshProjection(); invalidate(true); }
    }
    function pointerUp(event) {
      const p = screenPoint(event), active = pointer; pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!active || active.id !== event.pointerId) return;
      pointer = null;
      const moved = active.moved || Math.hypot(p.x - active.start.x, p.y - active.start.y) > 5;
      if (active.drag && moved) { ground(p, active.structure ? { draggedStructureId: active.structure.id } : { draggedUnitId: active.unit.id }, event); return; }
      if (moved || active.pan) return;
      if (mini && p.x >= mini.x && p.y >= mini.y && p.x <= mini.x + mini.w && p.y <= mini.y + mini.h) { camera.x = bounds.minX + (p.x - mini.x) / mini.w * (bounds.maxX - bounds.minX); camera.z = bounds.minZ + (p.y - mini.y) / mini.h * (bounds.maxZ - bounds.minZ); refreshProjection(); invalidate(true); return; }
      const found = hit(p);
      if (placement && tool !== "unit") ground(p, {}, event);
      else if (found.unit) options.onSelectUnit?.(found.unit.id);
      else if (found.structure) options.onSelectStructure?.(found.structure.id);
      else ground(p, {}, event);
    }
    function cancel(event) { pointers.delete(event.pointerId); pointer = null; }
    function zoomAt(factor, point = { x: width / 2, y: height / 2 }) {
      const before = transform.toWorld(point.x, point.y), min = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxZ - bounds.minZ)) * .65;
      camera.scale = clamp(camera.scale * factor, min, 22); refreshProjection(); const after = transform.toWorld(point.x, point.y); camera.x += before.x - after.x; camera.z += before.z - after.z; refreshProjection(); invalidate(true);
    }
    listen(canvas, "pointerdown", pointerDown); listen(canvas, "pointermove", pointerMove); listen(canvas, "pointerup", pointerUp); listen(canvas, "pointercancel", cancel);
    listen(canvas, "contextmenu", event => event.preventDefault());
    listen(canvas, "wheel", event => { event.preventDefault(); zoomAt(Math.exp(-clamp(event.deltaY, -120, 120) * .002), screenPoint(event)); }, { passive: false });
    listen(canvas, "keydown", event => { if (["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)) event.preventDefault(); if (event.key === "+" || event.key === "=") zoomAt(1.22); else if (event.key === "-") zoomAt(1 / 1.22); else if (event.key === "Escape") resetView(); else { const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, v = directions[event.key]; if (v) { camera.x += v[0] * 45 / camera.scale; camera.z += v[1] * 45 / camera.scale; refreshProjection(); invalidate(true); } } });
    const observer = typeof root.ResizeObserver === "function" ? new root.ResizeObserver(resize) : null;
    observer?.observe(mount); if (!observer && root.addEventListener) listen(root, "resize", resize);
    resize();
    return {
      update(next, settings = {}) {
        const oldId = battle.id, oldBounds = JSON.stringify(bounds), oldSelected = selected; battle = next || battle; layout = battle.layout || layout; bounds = boundsOf(layout);
        if (settings.selectedUnitId !== undefined) selected = settings.selectedUnitId;
        if (settings.selectedStructureId !== undefined) selectedStructure = settings.selectedStructureId;
        if (settings.deploymentTool !== undefined) tool = settings.deploymentTool;
        if (settings.placementRotation !== undefined) rotation = finite(settings.placementRotation);
        if (settings.placement !== undefined) placement = !!settings.placement;
        if (settings.rangeVisible !== undefined) rangeVisible = !!settings.rangeVisible;
        if (settings.baileyNamesVisible !== undefined) namesVisible = !!settings.baileyNamesVisible;
        if (oldSelected !== selected) {
          const unit = (battle.units || []).find(u => u.id === selected), p = unit && transform.toScreen(unit.x, unit.z);
          if (p && (p.x < 25 || p.x > width - 25 || p.y < 40 || p.y > height - 35)) { camera.x = unit.x; camera.z = unit.z; refreshProjection(); backgroundDirty = true; }
        }
        invalidate(oldId !== battle.id || oldBounds !== JSON.stringify(bounds));
      },
      setSelected(id) { selected = id; invalidate(); },
      setView(view) {
        if (view === "battlefield") fit([{ x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2, w: bounds.maxX - bounds.minX, d: bounds.maxZ - bounds.minZ }], 6, 1);
        else if (view === "castle") fit((battle.structures || []).filter(s => !s.landscape), 10, 60);
        else if (view === "gate") { const gate = (battle.structures || []).filter(s => s.kind === "gate").sort((a, b) => b.z - a.z)[0]; if (gate) fit([gate], 12, 38); }
        else if (view.startsWith("bailey-")) { const labels = root.TenkaCastlePrecincts?.describe?.(battle) || layout.baileys || []; const bailey = labels.find(b => b.role && view === `bailey-${b.role}` || b.id && view === `bailey-${b.id}`); if (bailey) fit([bailey], 10, 40); }
        else if (view === "cinematic" && selected) this.focusUnit(selected);
        else resetView();
      },
      zoom(direction) { zoomAt(direction > 0 ? 1.22 : 1 / 1.22); },
      focusUnit(id) { const item = (battle.units || []).find(u => u.id === id); if (item) { selected = id; fit([item], 16, 56); } },
      resetView,
      setBaileyNames(visible) { namesVisible = !!visible; invalidate(); },
      // Also useful to external accessible controls and deterministic input tests.
      worldToScreen(x, z) { return transform.toScreen(x, z); },
      screenToWorld(x, y) { return transform.toWorld(x, y); },
      dispose() { if (disposed) return; disposed = true; observer?.disconnect(); for (const remove of listeners) remove(); if (frame) { root.cancelAnimationFrame ? root.cancelAnimationFrame(frame) : root.clearTimeout(frame); frame = 0; } textures?.dispose?.(); fortress?.dispose?.(); pointers.clear(); pointer = null; canvas.remove(); backdrop.width = backdrop.height = 1; },
    };
  }
  root.TenkaBattle2D = Object.freeze({ create, projection, boundsOf, footprint, contains, version: 1 });
})(typeof window !== "undefined" ? window : globalThis);
