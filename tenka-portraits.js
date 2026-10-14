/*
 * 天下布武 — individual officer illustrations.
 * These are fictional historical character illustrations, not authenticated
 * likenesses. Appearance is composed for each complete officer identity, rather
 * than selecting a cell in a shared portrait atlas. All art is local SVG.
 * API: window.TenkaPortraits.uri(officer, {year}), .svg(officer, {year}), .clear().
 */
(function (global) {
  'use strict';
  const cache = new Map();
  const MAJOR = {
    oda_nobunaga: { face: -7, jaw: -6, eye: -5, brow: -5, skin: '#c99b7b', hair: 'topknot', beard: 1, armor: '#242c2c', cord: '#a94a39', turn: -5, accent: '#c7a465' },
    takeda_harunobu: { face: 11, jaw: 9, eye: 1, brow: -7, skin: '#b88d6e', hair: 'shingen', beard: 3, armor: '#803c34', cord: '#cba252', turn: 4, accent: '#d0aa62' },
    nagao_kagetora: { face: -3, jaw: -3, eye: -3, brow: -4, skin: '#dbc2a3', hair: 'cowl', beard: 0, armor: '#263e4b', cord: '#c9b37c', turn: 0, accent: '#d2d7cf' },
    matsudaira_motoyasu: { face: 8, jaw: 8, eye: 2, brow: -1, skin: '#d4ad8c', hair: 'kabuto', beard: 0, armor: '#314d45', cord: '#bd9f51', turn: 3, accent: '#c5a763' },
    kinoshita_tokichiro: { face: -10, jaw: -9, eye: 3, brow: 2, skin: '#b28b63', hair: 'topknot', beard: 0, armor: '#887044', cord: '#263c50', turn: -3, accent: '#ceb485' },
    mori_motonari: { face: -5, jaw: -7, eye: -4, brow: 1, skin: '#c3a181', hair: 'eboshi', beard: 2, armor: '#515347', cord: '#bba47a', turn: -4, accent: '#b8a36c' },
    imagawa_yoshimoto: { face: 11, jaw: 3, eye: -3, brow: 3, skin: '#e3c9ad', hair: 'court', beard: 1, armor: '#654564', cord: '#bc9d67', turn: 1, accent: '#cbb477' },
    hojo_ujimasa: { face: 1, jaw: 2, eye: -2, brow: -3, skin: '#cfac8b', hair: 'kabuto', beard: 0, armor: '#3d5365', cord: '#b4a074', turn: -2, accent: '#d5bc82' },
    otomo_yoshishige: { face: -4, jaw: -2, eye: 2, brow: 1, skin: '#b99074', hair: 'eboshi', beard: 1, armor: '#57473f', cord: '#8eab9b', turn: 4, accent: '#c3b083' },
    shimazu_takahisa: { face: 10, jaw: 8, eye: -5, brow: -6, skin: '#b18d70', hair: 'kabuto', beard: 2, armor: '#43524b', cord: '#9b4939', turn: -5, accent: '#b39a61' },
    date_harumune: { face: 2, jaw: 4, eye: -2, brow: -3, skin: '#c6a688', hair: 'kabuto', beard: 2, armor: '#273d47', cord: '#baaa7b', turn: 5, accent: '#c2ae74' },
    miyoshi_nagayoshi: { face: 3, jaw: 1, eye: -3, brow: -2, skin: '#c6a185', hair: 'eboshi', beard: 1, armor: '#40443d', cord: '#9f7856', turn: -4, accent: '#cbb379' },
    asakura_yoshikage: { face: 0, jaw: -3, eye: 2, brow: 1, skin: '#d6b89a', hair: 'court', beard: 1, armor: '#52675e', cord: '#bfb28b', turn: 1, accent: '#c7b68d' },
    saito_yoshitatsu: { face: 13, jaw: 10, eye: -6, brow: -8, skin: '#ba9271', hair: 'kabuto', beard: 3, armor: '#534744', cord: '#aa773b', turn: 4, accent: '#c0a36b' },
    chosokabe_kunichika: { face: 3, jaw: 4, eye: -4, brow: -5, skin: '#bc9876', hair: 'kabuto', beard: 2, armor: '#454957', cord: '#a67750', turn: -4, accent: '#c2af85' },
    sho_gen: { face: 2, jaw: -3, eye: 2, brow: 0, skin: '#bd926d', hair: 'ryukyu', beard: 1, armor: '#733b32', cord: '#b99a58', turn: 2, accent: '#d4b26b' },
    shibata_katsuie: { face: 12, jaw: 12, eye: -5, brow: -7, skin: '#b98e6c', hair: 'kabuto', beard: 3, armor: '#3b4448', cord: '#a64839', turn: -3 },
    maeda_toshiie: { face: -6, jaw: -2, eye: -3, brow: -4, skin: '#c9a17b', hair: 'topknot', beard: 0, armor: '#773e36', cord: '#c5a45f', turn: 3 },
    takenaka_hanbei: { face: -9, jaw: -8, eye: 2, brow: 1, skin: '#d7bca0', hair: 'topknot', beard: 0, armor: '#577070', cord: '#c5b38f', turn: -1 },
    yamamoto_kansuke: { face: 4, jaw: 7, eye: -6, brow: -7, skin: '#af8667', hair: 'headband', beard: 3, armor: '#5b4842', cord: '#aa834e', turn: 4, scar: true },
    sanada_yukitaka: { face: -3, jaw: 0, eye: -5, brow: -5, skin: '#bf9473', hair: 'kabuto', beard: 2, armor: '#803e35', cord: '#b7a072', turn: -3 },
    hojo_ujiyasu: { face: 5, jaw: 4, eye: -4, brow: -3, skin: '#c3a080', hair: 'eboshi', beard: 2, armor: '#414f59', cord: '#b1aa79', turn: 2 },
  };
  const ALIASES = {
    織田信長: 'oda_nobunaga', 武田晴信: 'takeda_harunobu', 武田信玄: 'takeda_harunobu', 長尾景虎: 'nagao_kagetora', 上杉謙信: 'nagao_kagetora',
    松平元康: 'matsudaira_motoyasu', 徳川家康: 'matsudaira_motoyasu', 木下藤吉郎: 'kinoshita_tokichiro', 羽柴秀吉: 'kinoshita_tokichiro', 豊臣秀吉: 'kinoshita_tokichiro',
    毛利元就: 'mori_motonari', 今川義元: 'imagawa_yoshimoto', 北条氏政: 'hojo_ujimasa', 北条氏康: 'hojo_ujiyasu', 大友義鎮: 'otomo_yoshishige', 大友宗麟: 'otomo_yoshishige',
    島津貴久: 'shimazu_takahisa', 伊達晴宗: 'date_harumune', 三好長慶: 'miyoshi_nagayoshi', 朝倉義景: 'asakura_yoshikage', 斎藤義龍: 'saito_yoshitatsu',
    長宗我部国親: 'chosokabe_kunichika', 尚元王: 'sho_gen', 柴田勝家: 'shibata_katsuie', 前田利家: 'maeda_toshiie', 竹中半兵衛: 'takenaka_hanbei', 山本勘助: 'yamamoto_kansuke', 真田幸隆: 'sanada_yukitaka',
  };
  const PALETTES = [
    ['#263c49', '#b1a07b'], ['#653c35', '#bea272'], ['#374d42', '#a88a58'], ['#494258', '#b9a17d'], ['#69563d', '#9eb0a8'],
    ['#394850', '#b47854'], ['#5f4d46', '#9bafad'], ['#3d555b', '#c2ac7c'], ['#5e5c41', '#9f5d44'], ['#303836', '#a09574'],
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  function hash(value) { let s = 2166136261; for (const c of value) { s ^= c.codePointAt(0); s = Math.imul(s, 16777619); } return s >>> 0; }
  function random(seed) { let a = seed; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function colors(hex, change) { const n = parseInt(hex.slice(1), 16); return '#' + [n >> 16, n >> 8 & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(v + change))).toString(16).padStart(2, '0')).join(''); }
  const p = n => Math.round(n * 10) / 10;
  function appearance(o, options = {}) {
    const year = [options?.year, o.currentYear, o.year, global.TenkaPortraitYear].find(Number.isFinite) ?? 1560;
    const female = ['female', 'f', 'woman', '女', '女子'].includes(String(o.gender || o.sex || '').toLowerCase());
    const seed = hash(String(o.id || o.name || 'unknown') + ':' + String(o.clan || '') + ':' + String(o.birth || ''));
    const years = Number.isFinite(o.birth) ? Math.floor(year - o.birth) : o.status === 'child' ? 8 : 25 + seed % 38;
    const age = Math.max(0, Math.min(100, years));
    const stage = years < 0 || o.status === 'unborn' ? 'unborn' : age < 3 ? 'infant' : age < 15 ? 'child' : 'adult';
    return { year, female, age, stage };
  }
  function familyPortrait(o, identity, seed, profile) {
    const rng = random(seed), range = (a, b) => p(a + rng() * (b - a));
    const female = profile.female, infant = profile.stage === 'infant' || profile.stage === 'unborn', child = profile.stage === 'child';
    const skin = ['#d6b395', '#caa083', '#dfbda3', '#d2ac8b', '#c49c7c'][seed % 5];
    const palette = [
      ['#6b455c', '#b28f6b'], ['#466d69', '#c1a36e'], ['#874e45', '#bda878'],
      ['#4f596f', '#b5a27f'], ['#766040', '#b8a68a'], ['#795e69', '#9cab9b']
    ][hash(String(o.clan || identity)) % 6];
    const cloth = colors(palette[0], range(-9, 9)), trim = colors(palette[1], range(-8, 8));
    const cx = 180 + range(-5, 5), cy = infant ? 167 : 173;
    const fw = (infant ? 50 : child ? 53 : female ? 48 : 54) + range(-4, 4);
    const fh = infant ? 55 : child ? 64 : 77;
    const eyesY = cy + (infant ? 2 : -1) + range(-2, 2), eyesGap = (infant ? 23 : 25) + range(-2, 2);
    const eyeSize = range(child || infant ? 10 : 11, child || infant ? 13 : 15), mouthY = cy + (infant ? 27 : child ? 38 : 45) + range(-2, 2);
    const hair = profile.age >= 60 ? '#45423a' : '#222826', young = infant || child;
    const label = profile.stage === 'unborn' ? '誕生前' : infant ? '幼子' : child ? (female ? '幼い姫' : '一門の若君') : female ? '姫・一門女性' : '一門衆';
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360" role="img" aria-label="${esc(o.name || label)}の個別創作肖像" data-portrait-stage="${profile.stage}" data-portrait-gender="${female ? 'female' : 'male'}"><title>${esc(o.name || label)} — ${label}・${profile.age}歳の創作肖像</title><metadata>tenka-individual-portrait:${esc(identity)}:${seed}</metadata>
      <defs><radialGradient id="family-background" cx="35%" cy="25%" r="95%"><stop stop-color="${colors(cloth, 55)}"/><stop offset=".55" stop-color="${colors(cloth, 3)}"/><stop offset="1" stop-color="#1a2b2d"/></radialGradient>
      <radialGradient id="family-skin" cx="34%" cy="27%" r="80%"><stop stop-color="${colors(skin, 30)}"/><stop offset=".55" stop-color="${skin}"/><stop offset="1" stop-color="${colors(skin, -35)}"/></radialGradient>
      <linearGradient id="family-cloth" x1="0" x2="1" y2="1"><stop stop-color="${colors(cloth, 35)}"/><stop offset=".48" stop-color="${cloth}"/><stop offset="1" stop-color="${colors(cloth, -28)}"/></linearGradient>
      <linearGradient id="family-hair" x1="0" x2="1" y2="1"><stop stop-color="${colors(hair, 22)}"/><stop offset=".6" stop-color="${hair}"/><stop offset="1" stop-color="#111b1d"/></linearGradient>
      <radialGradient id="family-vignette"><stop offset=".57" stop-color="#102027" stop-opacity="0"/><stop offset="1" stop-color="#101b20" stop-opacity=".5"/></radialGradient>
      <filter id="family-shadow" x="-.4" y="-.3" width="1.8" height="1.7"><feDropShadow dx="2" dy="5" stdDeviation="5" flood-color="#122127" flood-opacity=".4"/></filter></defs>
      <rect width="360" height="360" fill="url(#family-background)"/><circle cx="${range(90, 240)}" cy="${range(70, 120)}" r="110" fill="#e5d8b0" opacity=".08"/>
      <path d="M0 280Q65 245 115 261T248 243T360 268V360H0Z" fill="#203638" opacity=".35"/>`;
    for (let i = 0; i < 18; i++) svg += `<circle cx="${range(10, 350)}" cy="${range(10, 350)}" r="${range(.4, 1.1)}" fill="#eddfbb" opacity="${range(.08, .28)}"/>`;
    if (infant) {
      svg += `<g filter="url(#family-shadow)"><path d="M${cx - 47} 196Q${cx - 99} 211 ${cx - 107} 286Q${cx - 100} 338 ${cx - 63} 360H${cx + 72}Q${cx + 111} 321 ${cx + 101} 266Q${cx + 94} 214 ${cx + 46} 196Z" fill="url(#family-cloth)"/>
        <path d="M${cx - 55} 213L${cx + 81} 289L${cx + 67} 325L${cx - 85} 246Z" fill="${trim}" opacity=".6"/>
        <path d="M${cx + 54} 215L${cx - 83} 297L${cx - 63} 333L${cx + 89} 251Z" fill="${colors(cloth, 28)}"/>
        <path d="M${cx - 88} 303Q${cx} 344 ${cx + 94} 295M${cx - 65} 333Q${cx} 351 ${cx + 66} 330" fill="none" stroke="${colors(cloth, -25)}" stroke-width="3" opacity=".45"/></g>`;
    } else {
      // A kosode with crossed collar and sash, rather than military armor or
      // later-period ornate hair ornaments. Children have shorter loose hair.
      if (female) svg += `<path d="M${cx - fw - 6} ${cy - 40}Q${cx - fw - 31} ${cy - 2} ${cx - fw - 26} 308L${cx - fw - 7} 340H${cx + fw + 9}L${cx + fw + 26} 309Q${cx + fw + 27} ${cy - 18} ${cx + fw + 5} ${cy - 47}Z" fill="url(#family-hair)"/>`;
      svg += `<g filter="url(#family-shadow)"><path d="M${cx - 24} 220H${cx + 24}L${cx + 29} 263Q${cx + 97} 268 312 320L335 360H25L48 320Q${cx - 94} 267 ${cx - 28} 263Z" fill="url(#family-cloth)"/>
        <path d="M${cx - 22} 221H${cx + 22}L${cx + 25} 267L${cx} 293L${cx - 25} 266Z" fill="url(#family-skin)"/>
        <path d="M${cx - 31} 259L${cx + 20} 301L${cx + 3} 319L${cx - 48} 274Z" fill="#d9cbb1"/>
        <path d="M${cx + 30} 258L${cx - 24} 309L${cx - 3} 329L${cx + 48} 274Z" fill="${trim}"/>
        <path d="M${cx - 43} 269L${cx + 22} 326L${cx - 3} 349L${cx - 64} 287Z" fill="${colors(cloth, 15)}"/>
        <path d="M${cx + 43} 269L${cx - 37} 346L${cx - 17} 360H${cx + 33}L${cx + 69} 289Z" fill="url(#family-cloth)"/>
        <path d="M68 336Q${cx} 354 292 336L300 360H61Z" fill="${trim}"/>
        <path d="M77 296Q91 327 93 349M281 296Q268 327 266 349" fill="none" stroke="${colors(cloth, -33)}" stroke-width="2.5" opacity=".4"/></g>`;
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
        const x = cx + side * (68 + (i % 2) * 24), y = 295 + i * 12;
        svg += `<path d="M${x - 4} ${y}q4-5 8 0q-4 5-8 0Z" fill="none" stroke="${trim}" stroke-width="1" opacity=".35"/>`;
      }
    }
    svg += `<path d="M${cx - fw + 4} ${cy - 30}Q${cx - fw - 10} ${cy - 59} ${cx} ${cy - fh - 7}Q${cx + fw + 13} ${cy - fh + 1} ${cx + fw - 2} ${cy - 22}Z" fill="url(#family-hair)"/>
      <ellipse cx="${cx - fw + 2}" cy="${cy + 6}" rx="9" ry="16" fill="url(#family-skin)"/><ellipse cx="${cx + fw - 2}" cy="${cy + 6}" rx="9" ry="16" fill="url(#family-skin)"/>
      <path d="M${cx - fw + 3} ${cy - 23}Q${cx - fw + 3} ${cy - fh + 1} ${cx} ${cy - fh + 3}Q${cx + fw - 3} ${cy - fh + 1} ${cx + fw - 3} ${cy - 23}L${cx + fw - 3} ${cy + 20}Q${cx + fw - 8} ${cy + fh - 9} ${cx} ${cy + fh}Q${cx - fw + 9} ${cy + fh - 9} ${cx - fw + 2} ${cy + 21}Z" fill="url(#family-skin)"/>
      <ellipse cx="${cx - 33}" cy="${cy + 21}" rx="14" ry="8" fill="#bb7768" opacity="${young ? '.17' : '.09'}"/><ellipse cx="${cx + 33}" cy="${cy + 21}" rx="14" ry="8" fill="#bb7768" opacity="${young ? '.17' : '.09'}"/>`;
    for (const side of [-1, 1]) {
      const ex = cx + side * eyesGap, ey = eyesY + range(-1, 1), tilt = range(-2, 2);
      svg += `<path d="M${ex - eyeSize} ${ey}Q${ex} ${ey - 6 + tilt} ${ex + eyeSize} ${ey}Q${ex} ${ey + 7} ${ex - eyeSize} ${ey}Z" fill="#ede0c9"/>
        <ellipse cx="${ex}" cy="${ey + 1}" rx="${young ? 4.5 : 4}" ry="${young ? 5.2 : 4.6}" fill="#32352d"/><circle cx="${ex - 1.3}" cy="${ey - 1}" r="1.15" fill="#f5e7d3"/>
        <path d="M${ex - eyeSize} ${ey}Q${ex} ${ey - 6 + tilt} ${ex + eyeSize} ${ey}" fill="none" stroke="#4b3b31" stroke-width="${young ? 1.7 : 2.1}" stroke-linecap="round"/>
        <path d="M${ex - eyeSize + 1} ${ey - 13}Q${ex} ${ey - 18 + range(-2, 2)} ${ex + eyeSize - 1} ${ey - 13}" fill="none" stroke="${hair}" stroke-width="${young || female ? 2.7 : 4}" stroke-linecap="round" opacity=".85"/>`;
    }
    svg += `<path d="M${cx + 1} ${cy + 8}l-3 ${infant ? 10 : 18}q4 4 9 0" fill="none" stroke="${colors(skin, -43)}" stroke-width="1.5" opacity=".55"/>
      <path d="M${cx - (infant ? 10 : 14)} ${mouthY}Q${cx} ${mouthY + range(1, 4)} ${cx + (infant ? 10 : 14)} ${mouthY}" fill="none" stroke="${female ? '#915e55' : '#855e4d'}" stroke-width="${infant ? 2.1 : 2.5}" stroke-linecap="round"/>
      <path d="M${cx - 7} ${mouthY + 5}q8 2 15-1" fill="none" stroke="${colors(skin, 27)}" stroke-width="1.3" opacity=".6"/>`;
    if (infant) {
      for (let i = 0; i < 8; i++) svg += `<path d="M${cx - 25 + i * 7} ${cy - fh + 15}q-3-11 3-15" fill="none" stroke="${hair}" stroke-width="1.8" opacity=".7"/>`;
    } else {
      const fringe = young ? cy - 29 : cy - 48;
      svg += `<path d="M${cx - fw} ${cy - 9}Q${cx - fw - 12} ${cy - fh - 16} ${cx} ${cy - fh - 9}Q${cx + fw + 12} ${cy - fh - 15} ${cx + fw} ${cy - 6}L${cx + fw - 12} ${cy + 7}L${cx + fw - 14} ${fringe + 10}Q${cx + 17} ${fringe - 3} ${cx + 1} ${fringe + 5}Q${cx - 16} ${fringe - 2} ${cx - fw + 14} ${fringe + 12}L${cx - fw + 11} ${cy + 8}Z" fill="url(#family-hair)"/>`;
      for (let i = 0; i < 11; i++) svg += `<path d="M${cx - fw + 9 + i * (fw * 2 - 18) / 10} ${fringe - 3}Q${cx - 30 + i * 6} ${cy - fh - 2} ${cx + (i - 5) * 3} ${cy - fh + 1}" fill="none" stroke="${colors(hair, 33)}" stroke-width=".7" opacity=".4"/>`;
      if (female && !child) svg += `<path d="M${cx - fw - 4} ${cy + 5}Q${cx - fw - 9} 248 ${cx - fw + 8} 287M${cx + fw + 3} ${cy + 6}Q${cx + fw + 12} 247 ${cx + fw - 6} 287" fill="none" stroke="${trim}" stroke-width="2.1" opacity=".7"/>`;
    }
    if (profile.age > 42 && !young) for (const side of [-1, 1]) svg += `<path d="M${cx + side * 20} ${eyesY + 12}q${side * 9} 4 ${side * 16} 0" fill="none" stroke="${colors(skin, -34)}" stroke-width=".8" opacity=".3"/>`;
    svg += `<rect width="360" height="360" fill="url(#family-vignette)"/><path d="M9 27V9h18M333 9h18v18M351 333v18h-18M27 351H9v-18" fill="none" stroke="${trim}" stroke-width="1" opacity=".5"/></svg>`;
    return svg;
  }
  function portrait(officer = {}, options = {}) {
    const o = typeof officer === 'string' ? { name: officer } : (officer || {});
    const identity = String(o.id || o.name || 'unknown') + ':' + String(o.clan || '') + ':' + String(o.birth || '');
    const seed = hash(identity), rng = random(seed), pick = values => values[Math.floor(rng() * values.length)], range = (a, b) => p(a + rng() * (b - a));
    const profile = appearance(o, options);
    if (profile.female || profile.stage !== 'adult') return familyPortrait(o, identity, seed, profile);
    const id = o.id || ALIASES[o.name], preset = MAJOR[id] || {}, [baseArmor, baseCord] = PALETTES[hash(String(o.clan || identity)) % PALETTES.length];
    const age = Math.max(16, Math.min(85, profile.age));
    const f = {
      face: range(-9, 9), jaw: range(-8, 9), eye: range(-4, 4), brow: range(-5, 4), turn: range(-6, 6),
      skin: pick(['#c8a181', '#d2b192', '#bd9474', '#d7b99b', '#b99271', '#cfa988']),
      hair: pick(['topknot', 'kabuto', 'kabuto', 'eboshi', 'headband']),
      beard: age < 25 ? 0 : age < 36 ? pick([0, 0, 1]) : pick([0, 1, 2, 3]),
      armor: colors(baseArmor, range(-9, 9)), cord: colors(baseCord, range(-10, 10)), accent: '#c1a66e', ...preset,
    };
    const cx = 182 + f.turn, faceW = 56 + f.face, foreheadY = 106 + range(-3, 5), chinY = 265 + range(-6, 7), eyeY = 177 + range(-3, 4), noseX = cx + f.turn * 1.4;
    const left = cx - faceW, right = cx + faceW, jaw = 35 + f.jaw, neck = 27 + f.jaw / 3, mouthY = 233 + range(-4, 4), hairColor = age > 58 ? '#3d3d36' : '#202320';
    const skinLight = colors(f.skin, 36), skinDark = colors(f.skin, -53), clothLight = colors(f.armor, 27), eyeGap = 26 + range(-4, 4), eyeWidth = 18 + range(-3, 3), lip = colors(f.skin, -35);
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360" role="img" aria-label="${esc(o.name || '武将')}の個別創作肖像"><title>${esc(o.name || '武将')} — 年齢・時代衣装を参考にした個別創作画</title><metadata>tenka-individual-portrait:${esc(identity)}:${seed}</metadata>
      <defs>
      <radialGradient id="background" cx="35%" cy="28%" r="90%"><stop stop-color="${colors(f.armor, 40)}"/><stop offset=".5" stop-color="${colors(f.armor, -7)}"/><stop offset="1" stop-color="#121c20"/></radialGradient>
      <radialGradient id="skin" cx="33%" cy="31%" r="74%"><stop stop-color="${skinLight}"/><stop offset=".4" stop-color="${f.skin}"/><stop offset=".75" stop-color="${colors(f.skin, -20)}"/><stop offset="1" stop-color="${skinDark}"/></radialGradient>
      <linearGradient id="faceShade"><stop stop-color="${skinDark}" stop-opacity=".05"/><stop offset=".5" stop-color="${f.skin}" stop-opacity="0"/><stop offset="1" stop-color="#332e26" stop-opacity=".48"/></linearGradient>
      <linearGradient id="metal" x1="0" x2=".9" y2="1"><stop stop-color="${colors(f.armor, 48)}"/><stop offset=".28" stop-color="${f.armor}"/><stop offset=".6" stop-color="${colors(f.armor, -12)}"/><stop offset="1" stop-color="#111e24"/></linearGradient>
      <linearGradient id="gold" x1="0" x2="1" y2=".9"><stop stop-color="#edddb0"/><stop offset=".3" stop-color="${f.accent}"/><stop offset=".7" stop-color="#82704b"/><stop offset="1" stop-color="#dfc994"/></linearGradient>
      <linearGradient id="fabric" x1="0" x2="1" y2="1"><stop stop-color="${clothLight}"/><stop offset=".55" stop-color="${f.armor}"/><stop offset="1" stop-color="#14252a"/></linearGradient>
      <linearGradient id="hair" x1="0" x2="1" y2="1"><stop stop-color="${colors(hairColor, 23)}"/><stop offset=".45" stop-color="${hairColor}"/><stop offset="1" stop-color="#101a1d"/></linearGradient>
      <linearGradient id="cowl" x1="0" x2="1" y2=".8"><stop stop-color="#f0e8d1"/><stop offset=".5" stop-color="#cfcabb"/><stop offset="1" stop-color="#777f7b"/></linearGradient>
      <radialGradient id="vignette"><stop offset=".55" stop-color="#0b181d" stop-opacity="0"/><stop offset="1" stop-color="#0a151b" stop-opacity=".57"/></radialGradient>
      <filter id="grain"><feTurbulence baseFrequency=".7" numOctaves="3" seed="${seed % 113}" type="fractalNoise"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".09"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
      <filter id="shadow" x="-.3" y="-.3" width="1.6" height="1.6"><feDropShadow dx="2" dy="5" stdDeviation="5" flood-color="#08151b" flood-opacity=".5"/></filter>
      </defs><rect width="360" height="360" fill="url(#background)"/>
      <circle cx="${range(73, 270)}" cy="${range(70, 132)}" r="${range(80, 114)}" fill="${f.accent}" opacity=".055"/>
      <path d="M0 253L${range(28, 50)} 210L${range(79, 106)} 230L${range(133, 162)} 186L236 226L301 184L360 208V360H0Z" fill="#152c31" opacity=".48"/>
      <path d="M0 286L62 253L116 268L177 232L226 263L302 230L360 251V360H0Z" fill="#12252a" opacity=".42"/>`;
    // Subtle gold-leaf specks and a weathered sashimono provide depth without
    // covering facial features. Their placement is unique to each identity.
    for (let i = 0; i < 22; i++) svg += `<circle cx="${range(5, 355)}" cy="${range(5, 350)}" r="${range(.3, 1.3)}" fill="#e9d6a7" opacity="${range(.08, .3)}"/>`;
    const bannerX = seed % 2 ? 33 : 308;
    svg += `<g opacity=".17"><path d="M${bannerX} 61V302" stroke="#ceb887" stroke-width="3"/><path d="M${bannerX + 2} 65l30 7v114l-30-7Z" fill="${f.cord}"/><circle cx="${bannerX + 16}" cy="103" r="9" fill="none" stroke="#e7dcbb" stroke-width="2"/><path d="M${bannerX + 10} 103h12m-6-6v12" stroke="#e7dcbb" stroke-width="2"/></g>`;
    // Body, lacquered shoulder plates, and the woven undergarment.
    svg += `<g filter="url(#shadow)"><path d="M${cx - neck} 245L${cx + neck} 245L${cx + neck + 6} 280Q287 286 329 323L346 360H16L30 324Q61 292 ${cx - neck - 6} 280Z" fill="url(#fabric)"/>
      <path d="M${cx - neck} 234L${cx + neck} 234L${cx + neck + 4} 286L${cx} 310L${cx - neck - 5} 283Z" fill="url(#skin)"/>
      <path d="M${cx - neck} 249Q${cx} 274 ${cx + neck} 248L${cx + neck} 266Q${cx} 284 ${cx - neck} 269Z" fill="${skinDark}" opacity=".44"/>
      <path d="M${cx - 43} 271L${cx + 8} 319L${cx - 11} 345L${cx - 64} 286Z" fill="#cfbfa0"/><path d="M${cx + 41} 273L${cx - 13} 328L${cx + 9} 351L${cx + 62} 288Z" fill="#afa68f"/>
      <path d="M${cx - 50} 278L${cx + 8} 329L${cx - 10} 353L${cx - 74} 297Z" fill="url(#fabric)"/><path d="M${cx + 49} 278L${cx - 13} 338L${cx + 11} 360H${cx + 45}L${cx + 78} 299Z" fill="url(#fabric)"/>
      <path d="M${cx - 80} 291Q${cx} 325 ${cx + 80} 291L${cx + 90} 360H${cx - 93}Z" fill="url(#metal)" stroke="#142025" stroke-width="2"/>`;
    for (const side of [-1, 1]) {
      svg += `<g transform="translate(${cx} 0) scale(${side} 1)"><path d="M70 283Q104 284 140 311L149 360H76L66 304Z" fill="url(#metal)" stroke="#172329" stroke-width="2"/>`;
      for (let row = 0; row < 5; row++) svg += `<path d="M${72 + row} ${297 + row * 12}Q105 ${297 + row * 12} ${142 + row} ${319 + row * 10}" fill="none" stroke="${row % 2 ? f.cord : colors(f.armor, 40)}" stroke-width="${row % 2 ? 3 : 1.4}" opacity=".88"/>`;
      for (let j = 0; j < 6; j++) svg += `<path d="M${80 + j * 10} ${298 + j * 2}l3 39" stroke="${colors(f.cord, 18)}" stroke-width="1.4" opacity=".5"/>`;
      svg += '</g>';
    }
    for (let row = 0; row < 4; row++) {
      svg += `<path d="M${cx - 77} ${322 + row * 11}Q${cx} ${339 + row * 8} ${cx + 78} ${322 + row * 11}" fill="none" stroke="${f.cord}" stroke-width="3.4"/>`;
      for (let x = -60; x < 70; x += 14) svg += `<path d="M${cx + x} ${323 + row * 10}v6" stroke="${colors(f.cord, 35)}" stroke-width="1.3"/>`;
    }
    svg += `<path d="M${cx - 47} 291Q${cx - 39} 307 ${cx - 37} 324M${cx + 47} 291Q${cx + 39} 307 ${cx + 37} 324" fill="none" stroke="url(#gold)" stroke-width="6"/>
      <circle cx="${cx - 37}" cy="321" r="7" fill="url(#gold)"/><circle cx="${cx + 37}" cy="321" r="7" fill="url(#gold)"/></g>`;
    // Back of hairstyle/helmet, then ears and the individually shaped head.
    if (f.hair === 'kabuto' || f.hair === 'shingen') {
      svg += `<path d="M${left - 10} 133L${left - 28} 214L${left - 2} 244L${left + 10} 182L${right - 10} 183L${right + 4} 242L${right + 29} 214L${right + 10} 130Z" fill="url(#metal)" stroke="#17212a" stroke-width="2"/>`;
      for (let i = 0; i < 4; i++) svg += `<path d="M${left - 16 - i * 2} ${169 + i * 17}L${left - 24 - i} ${184 + i * 16}M${right + 17 + i * 2} ${169 + i * 17}L${right + 24 + i} ${184 + i * 16}" stroke="${f.cord}" stroke-width="4"/>`;
    } else svg += `<path d="M${left - 3} 184Q${left - 21} 104 ${cx - 5} 91Q${right + 23} 87 ${right + 9} 187L${right - 12} 218H${left + 15}Z" fill="url(#hair)"/>`;
    svg += `<path d="M${left + 2} 174C${left - 16} 164 ${left - 14} 207 ${left + 6} 213L${left + 11} 181M${right - 2} 175C${right + 17} 166 ${right + 12} 207 ${right - 5} 212L${right - 10} 182" fill="url(#skin)" stroke="${skinDark}" stroke-width="1.3"/>
      <path d="M${left - 2} 181q-8 6 2 22M${right + 2} 181q8 6-2 21" fill="none" stroke="${skinDark}" stroke-width="2" opacity=".7"/>
      <path d="M${left + 7} ${foreheadY + 22}Q${cx} ${foreheadY - 17} ${right - 7} ${foreheadY + 23}L${right + 1} 178L${right - 5} 220Q${cx + jaw} 250 ${cx + 11} ${chinY}Q${cx} ${chinY + 5} ${cx - 13} ${chinY - 1}Q${cx - jaw} 251 ${left + 5} 220L${left - 1} 178Z" fill="url(#skin)"/>
      <path d="M${left + 7} ${foreheadY + 22}Q${cx} ${foreheadY - 17} ${right - 7} ${foreheadY + 23}L${right + 1} 178L${right - 5} 220Q${cx + jaw} 250 ${cx + 11} ${chinY}Q${cx} ${chinY + 5} ${cx - 13} ${chinY - 1}Q${cx - jaw} 251 ${left + 5} 220L${left - 1} 178Z" fill="url(#faceShade)"/>
      <path d="M${cx - 21} 134Q${cx - 4} 125 ${cx + 12} 136L${cx + 9} 159Q${cx - 5} 155 ${cx - 20} 160Z" fill="${skinLight}" opacity=".18"/>
      <path d="M${left + 7} 194Q${cx - 30} 183 ${cx - 17} 201Q${cx - 34} 216 ${left + 15} 217Z" fill="${colors(f.skin, 16)}" opacity=".37"/>
      <path d="M${right - 7} 194Q${cx + 30} 183 ${cx + 17} 201Q${cx + 34} 216 ${right - 15} 217Z" fill="${skinDark}" opacity=".17"/>`;
    // Eye sockets and eyes: small highlights, upper lid, tear duct, iris.
    for (const side of [-1, 1]) {
      const ex = cx + side * eyeGap + f.turn * .3, ey = eyeY + side * range(-1.5, 1.5), ew = eyeWidth + side * range(-1.5, 1.5), slope = f.eye * side;
      svg += `<path d="M${p(ex - ew - 5)} ${ey - 3}Q${ex} ${ey - 14} ${p(ex + ew + 4)} ${ey - 2}Q${ex} ${ey + 12} ${p(ex - ew - 5)} ${ey - 3}" fill="${skinDark}" opacity=".22"/>
        <path d="M${p(ex - ew)} ${p(ey + 1 - slope / 3)}Q${ex} ${p(ey - 6 + f.eye / 3)} ${p(ex + ew)} ${p(ey + slope / 3)}Q${ex} ${p(ey + 8)} ${p(ex - ew)} ${p(ey + 1 - slope / 3)}Z" fill="#e7d9be"/>
        <ellipse cx="${p(ex + f.turn / 3)}" cy="${ey + 1}" rx="${range(4, 5.1)}" ry="5.5" fill="#39372c"/><ellipse cx="${p(ex + f.turn / 3)}" cy="${ey + 1}" rx="2.4" ry="4.3" fill="#172024"/><circle cx="${p(ex + f.turn / 3 - 1.2)}" cy="${ey - 1}" r="1.1" fill="#f4e5c9" opacity=".8"/>
        <path d="M${p(ex - ew)} ${p(ey + 1 - slope / 3)}Q${ex} ${p(ey - 6 + f.eye / 3)} ${p(ex + ew)} ${p(ey + slope / 3)}" fill="none" stroke="#4a3b30" stroke-width="2.7" stroke-linecap="round"/>
        <path d="M${p(ex - ew + 2)} ${p(ey + 5)}Q${ex} ${p(ey + 10)} ${p(ex + ew - 1)} ${p(ey + 4)}" fill="none" stroke="${skinDark}" stroke-width="1" opacity=".7"/>
        <path d="M${p(ex - ew - 1)} ${p(ey - 13 - side * f.brow / 3)}Q${ex} ${p(ey - 21 + f.brow)} ${p(ex + ew + 1)} ${p(ey - 14 + side * f.brow / 3)}" fill="none" stroke="${hairColor}" stroke-width="${range(4, 6)}" stroke-linecap="round"/>`;
      if (age > 39) svg += `<path d="M${p(ex - 12)} ${ey + 13}Q${ex} ${ey + 17} ${ex + 13} ${ey + 12}M${p(ex + side * (ew + 1))} ${ey + 5}l${side * 6} 3" fill="none" stroke="${skinDark}" stroke-width=".9" opacity=".45"/>`;
    }
    // Nose and mouth are independently varied; broad/narrow jaws do not share
    // a generic facial cell, even among officers of the same clan and age.
    const noseWidth = 11 + range(-2, 4), noseBottom = 214 + range(-4, 3);
    svg += `<path d="M${noseX - 4} ${eyeY + 2}Q${noseX - 5} 197 ${noseX - noseWidth} ${noseBottom - 3}Q${noseX - noseWidth + 1} ${noseBottom + 4} ${noseX} ${noseBottom + 5}Q${noseX + noseWidth} ${noseBottom + 6} ${noseX + noseWidth + 2} ${noseBottom - 1}L${noseX + 5} ${eyeY + 1}" fill="${skinDark}" opacity=".2"/>
      <path d="M${noseX - 4} ${eyeY + 1}Q${noseX - 3} 199 ${noseX - 6} ${noseBottom - 4}Q${noseX + 1} ${noseBottom + 3} ${noseX + 7} ${noseBottom - 2}" fill="none" stroke="${skinLight}" stroke-width="3" opacity=".62" stroke-linecap="round"/>
      <path d="M${noseX - noseWidth} ${noseBottom + 1}q4-3 7 1M${noseX + 3} ${noseBottom + 2}q5-4 8-1" fill="none" stroke="${colors(skinDark, -13)}" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M${cx - 21} ${mouthY}Q${cx - 7} ${mouthY - 4} ${cx} ${mouthY - 2}Q${cx + 11} ${mouthY - 5} ${cx + 23} ${mouthY}Q${cx + 10} ${mouthY + 8} ${cx} ${mouthY + 6}Q${cx - 13} ${mouthY + 6} ${cx - 21} ${mouthY}Z" fill="${lip}" opacity=".6"/>
      <path d="M${cx - 21} ${mouthY}Q${cx - 3} ${mouthY + 2} ${cx} ${mouthY}Q${cx + 11} ${mouthY + 1} ${cx + 23} ${mouthY}" fill="none" stroke="#674d3b" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M${cx - 10} ${mouthY + 6}q10 3 20-1M${cx - 12} ${chinY - 8}q13 5 25-1" fill="none" stroke="${skinLight}" stroke-width="1.3" opacity=".45"/>`;
    if (age > 38) {
      for (let i = 0; i < Math.min(4, Math.floor((age - 30) / 12)); i++) svg += `<path d="M${cx - 25 + i * 2} ${143 + i * 6}Q${cx} ${139 + i * 6} ${cx + 24 - i * 2} ${142 + i * 6}" fill="none" stroke="${skinDark}" stroke-width=".8" opacity=".4"/>`;
      svg += `<path d="M${noseX - 16} 213Q${cx - 28} 224 ${cx - 27} 239M${noseX + 17} 213Q${cx + 28} 224 ${cx + 27} 239" fill="none" stroke="${skinDark}" stroke-width="1.2" opacity=".42"/>`;
    }
    if (f.scar) svg += `<path d="M${cx - 34} 157L${cx - 25} 198" stroke="#945f48" stroke-width="2" opacity=".7"/>`;
    if (f.beard) {
      const beardColor = age > 57 ? '#70695b' : '#38362d';
      svg += `<path d="M${cx - 3} ${mouthY - 10}Q${cx - 17} ${mouthY - 14} ${cx - 28} ${mouthY + (f.beard > 1 ? 2 : -2)}Q${cx - 14} ${mouthY - 4} ${cx - 3} ${mouthY - 7}M${cx + 3} ${mouthY - 10}Q${cx + 17} ${mouthY - 14} ${cx + 28} ${mouthY + (f.beard > 1 ? 2 : -2)}Q${cx + 14} ${mouthY - 4} ${cx + 3} ${mouthY - 7}" fill="${beardColor}" opacity=".95"/>`;
      if (f.beard > 1) svg += `<path d="M${cx - 17} ${chinY - 17}Q${cx} ${chinY - 9} ${cx + 18} ${chinY - 18}L${cx + 12} ${chinY + 3}Q${cx} ${chinY + 13 + f.beard * 2} ${cx - 10} ${chinY + 3}Z" fill="${beardColor}"/>`;
      if (f.beard > 2) svg += `<path d="M${left + 7} 204Q${left + 10} 242 ${cx - 16} ${chinY + 2}L${cx - 22} ${chinY - 13}Q${left + 21} 235 ${left + 7} 204M${right - 7} 204Q${right - 10} 242 ${cx + 16} ${chinY + 2}L${cx + 22} ${chinY - 13}Q${right - 21} 235 ${right - 7} 204" fill="${beardColor}" opacity=".8"/>`;
      for (let i = 0; i < (f.beard > 1 ? 15 : 7); i++) svg += `<path d="M${cx + range(-21, 21)} ${mouthY - range(6, 10)}l${range(-2, 2)} ${range(2, 5)}" stroke="${colors(beardColor, 36)}" stroke-width=".65" opacity=".5"/>`;
      if (f.beard > 1) for (let i = 0; i < 14; i++) svg += `<path d="M${cx + range(-13, 13)} ${chinY - range(4, 13)}l${range(-2, 2)} ${range(6, 12)}" stroke="${colors(beardColor, 38)}" stroke-width=".65" opacity=".55"/>`;
    }
    // Hairstyle changes the entire upper silhouette, not just its color.
    if (f.hair === 'topknot' || f.hair === 'headband') {
      svg += `<path d="M${left - 2} 182Q${left - 12} 105 ${cx - 14} 97Q${cx + 58} 91 ${right + 5} 177L${right - 6} 191L${right - 12} 145Q${cx + 31} 126 ${cx + 4} 130Q${cx - 25} 123 ${left + 14} 144L${left + 6} 192Z" fill="url(#hair)"/>
        <path d="M${cx - 25} 126Q${cx - 16} 106 ${cx - 13} 98Q${cx + 4} 92 ${cx + 18} 100L${cx + 23} 130Z" fill="${f.skin}"/>
        <path d="M${cx - 3} 117Q${cx - 10} 87 ${cx + 5} 76Q${cx + 24} 70 ${cx + 32} 81L${cx + 25} 93L${cx + 10} 94L${cx + 9} 119Z" fill="url(#hair)"/>
        <path d="M${cx + 8} 84l20-1" stroke="#6d6854" stroke-width="2" opacity=".5"/>`;
      for (let i = 0; i < 10; i++) svg += `<path d="M${left + 1 + i * 2} ${145 + i * 2}Q${left + 2 + i * 2} 117 ${cx - 24 + i * 1.1} 107M${right - 1 - i * 2} ${146 + i * 2}Q${right - 1 - i * 2} 113 ${cx + 29 - i} 106" fill="none" stroke="${colors(hairColor, 36)}" stroke-width=".65" opacity=".5"/>`;
      if (f.hair === 'headband') svg += `<path d="M${left - 1} 145Q${cx} 126 ${right + 3} 145L${right + 3} 158Q${cx} 140 ${left - 1} 158Z" fill="#c7c0a9"/><path d="M${right} 147l22 18-7 27-10-30-10-6" fill="#a29f90"/>`;
    } else if (f.hair === 'cowl') {
      svg += `<path d="M${left + 4} 199Q${left - 24} 164 ${left - 14} 111Q${cx - 42} 73 ${cx + 7} 75Q${right + 18} 75 ${right + 18} 144Q${right + 32} 196 ${right - 1} 245L${right - 10} 212Q${right + 2} 169 ${right - 11} 126Q${cx} 104 ${left + 15} 127Q${left + 2} 155 ${left + 11} 191Z" fill="url(#cowl)"/>
        <path d="M${left - 5} 190Q${left - 15} 136 ${left + 1} 112Q${cx} 83 ${cx + 30} 95M${right + 8} 126Q${right + 23} 177 ${right + 1} 224M${left - 7} 162Q${left - 13} 196 ${left + 5} 224" fill="none" stroke="#8e988f" stroke-width="2" opacity=".5"/>`;
    } else if (f.hair === 'eboshi' || f.hair === 'court') {
      const height = f.hair === 'court' ? 49 : 64;
      svg += `<path d="M${left - 3} 142L${left + 10} 93L${cx - 25} ${height}Q${cx - 3} ${height - 16} ${cx + 21} ${height + 3}L${right - 15} 96L${right + 2} 142Q${cx} 122 ${left - 3} 142Z" fill="url(#hair)" stroke="#172024" stroke-width="2"/>
        <path d="M${cx - 20} ${height + 9}L${cx - 24} 125M${cx + 16} ${height + 10}L${cx + 23} 125" stroke="#626256" stroke-width="1" opacity=".5"/>
        <path d="M${left - 4} 140Q${cx} 123 ${right + 4} 140L${right + 3} 150Q${cx} 135 ${left - 3} 150Z" fill="#272e2b"/>
        <path d="M${left + 3} 149L${left + 12} 215Q${cx} 279 ${right - 12} 215L${right - 3} 149" fill="none" stroke="${f.cord}" stroke-width="2.5"/>`;
    } else if (f.hair === 'ryukyu') {
      svg += `<path d="M${left - 7} 141L${left - 3} 89Q${cx} 68 ${right + 3} 90L${right + 8} 142Q${cx} 126 ${left - 7} 141Z" fill="#5f312e"/>
        <path d="M${left - 7} 128Q${cx} 110 ${right + 7} 128v17Q${cx} 128 ${left - 7} 145Z" fill="url(#gold)"/><path d="M${cx - 5} 86V49l26-6 13 10-27 7v25Z" fill="#b39257"/>`;
    } else {
      svg += `<path d="M${left - 14} 137Q${left - 11} 76 ${cx} 69Q${right + 13} 78 ${right + 14} 137L${right + 5} 153Q${cx} 130 ${left - 5} 152Z" fill="url(#metal)" stroke="#17232a" stroke-width="2"/>`;
      for (let i = -3; i <= 3; i++) svg += `<path d="M${cx + i * 4} 77Q${cx + i * 20} 93 ${cx + i * 22} 138" fill="none" stroke="${i % 2 ? '#0f1d24' : colors(f.armor, 45)}" stroke-width="${i % 2 ? 2 : 1}" opacity=".8"/>`;
      svg += `<path d="M${left - 16} 137Q${cx} 122 ${right + 16} 137L${right + 21} 149Q${cx} 137 ${left - 21} 150Z" fill="#283238" stroke="url(#gold)" stroke-width="1.8"/>
        <path d="M${left - 16} 137L${left - 35} 128L${left - 26} 172L${left - 9} 167M${right + 16} 137L${right + 35} 128L${right + 26} 172L${right + 9} 167" fill="url(#metal)" stroke="url(#gold)" stroke-width="1.3"/>
        <path d="M${left + 2} 153Q${left + 11} 222 ${cx - 2} 269Q${right - 11} 223 ${right - 2} 153" fill="none" stroke="${f.cord}" stroke-width="3.5"/>
        <path d="M${cx - 4} 266l-12 16 18-8 11 11-6-17" fill="none" stroke="${f.cord}" stroke-width="3"/>`;
      if (f.hair === 'shingen') {
        svg += `<path d="M${left - 7} 124Q${left - 34} 84 ${left - 14} 65L${left - 26} 68Q${left - 32} 46 ${left - 1} 45L${left - 10} 31Q${cx - 12} 33 ${cx} 62Q${cx + 19} 34 ${right + 12} 31L${right + 4} 47Q${right + 30} 42 ${right + 29} 67L${right + 15} 64Q${right + 34} 91 ${right + 9} 124L${right + 3} 101Q${cx} 84 ${left + 1} 103Z" fill="#d3c7a8"/>
          <path d="M${left + 4} 83Q${cx} 49 ${right - 2} 83L${right + 2} 108Q${cx} 90 ${left - 3} 110Z" fill="url(#metal)"/>
          <path d="M${cx} 102L${cx - 15} 79L${cx} 63L${cx + 15} 79Z" fill="url(#gold)"/>`;
      } else {
        const crestStyle = hash(String(o.clan || identity)) % 5;
        if (crestStyle === 0) svg += `<path d="M${cx - 7} 115Q${cx - 40} 85 ${cx - 38} 56Q${cx - 22} 84 ${cx} 96Q${cx + 24} 84 ${cx + 38} 56Q${cx + 40} 85 ${cx + 7} 115Z" fill="url(#gold)"/>`;
        else if (crestStyle === 1) svg += `<circle cx="${cx}" cy="97" r="20" fill="url(#gold)"/><circle cx="${cx}" cy="95" r="14" fill="none" stroke="#65573c" stroke-width="1.2"/>`;
        else if (crestStyle === 2) svg += `<path d="M${cx} 68L${cx - 22} 108H${cx + 22}Z" fill="url(#gold)"/><path d="M${cx} 82l-8 17h16Z" fill="${f.armor}"/>`;
        else if (crestStyle === 3) svg += `<path d="M${cx} 61Q${cx - 29} 87 ${cx - 14} 104Q${cx} 119 ${cx + 14} 104Q${cx + 29} 87 ${cx} 61Z" fill="url(#gold)"/><path d="M${cx} 72v35" stroke="#62543b" stroke-width="1.3"/>`;
        else svg += `<path d="M${cx - 7} 111L${cx - 13} 65L${cx} 48L${cx + 13} 65L${cx + 7} 111Z" fill="url(#gold)"/><path d="M${cx} 60v44" stroke="#776243" stroke-width="1.5"/>`;
      }
    }
    // A fine photographic grain unifies the layered illustration. The border
    // keeps each portrait readable against both parchment and dark panels.
    svg += `<rect width="360" height="360" fill="url(#vignette)"/><rect width="360" height="360" fill="transparent" filter="url(#grain)" opacity=".65"/><path d="M9 27V9h18M333 9h18v18M351 333v18h-18M27 351H9v-18" fill="none" stroke="${f.accent}" stroke-width="1" opacity=".47"/></svg>`;
    return svg;
  }
  function uri(officer, options = {}) {
    const o = typeof officer === 'string' ? { name: officer } : (officer || {});
    const profile = appearance(o, options);
    const key = `${o.id || o.name || 'unknown'}:${o.name || ''}:${o.clan || ''}:${o.birth || ''}:${profile.age}:${profile.stage}:${profile.female}:${o.status || ''}`;
    if (!cache.has(key)) cache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(portrait(o, options)));
    return cache.get(key);
  }
  global.TenkaPortraits = Object.freeze({ uri, svg: portrait, clear: () => cache.clear(), version: '1.1.0' });
})(typeof window === 'object' ? window : globalThis);
