/* 天下布武: strategy rules. Economic values and officer abilities are game models. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaSystems = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SEASONS = ['春', '夏', '秋', '冬'];
  const UNITS = ['ashigaru', 'archer', 'cavalry', 'firearm', 'navy'];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const sum = (v) => UNITS.reduce((n, k) => n + (v?.[k] || 0), 0);
  const hash = (v) => { let h = 2166136261; for (const c of String(v)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
  const monthly = (s) => Number.isInteger(s.month) && s.month >= 1 && s.month <= 12;
  const periodMonths = (s) => monthly(s) ? 1 : 3;
  const date = (s) => `${s.year}年 ${monthly(s) ? `${s.month}月` : SEASONS[s.season]}`;
  const point = (s) => s.year * 12 + (monthly(s)?s.month:[3,6,9,12][s.season]);
  const eventPoint = (e) => e.year * 12 + [3,6,9,12][e.season];
  const harvestTime = (s) => monthly(s) ? s.month === 9 : s.season === 2;
  const periodLabel = (s) => monthly(s) ? '月' : '季';
  const owned = (s, clan = s.playerClan) => s.castles.filter(c => c.clan === clan);
  const getOfficer = (s, id) => s.officers.find(o => o.id === id);
  const getCastle = (s, id) => s.castles.find(c => c.id === id);
  const alive = (o) => !!o && o.status !== 'dead';
  const adult = (s, o) => o.birth == null || s.year - o.birth >= 15;
  const active = (s, o) => !!o && o.status === 'active' && adult(s, o);
  const number = (v, fallback) => Number.isFinite(v) ? v : fallback;
  const append = (s, type, title, text) => {
    s.nextLogId = Math.max(1, number(s.nextLogId, 1));
    s.logs = [{ id: `chronicle-${s.nextLogId++}`, type, title, text, date: date(s) }, ...(s.logs || [])].slice(0, 80);
  };
  const SOURCES = [
    { id: 'teppokan', title: '西之表市・種子島開発総合センター（鉄砲館）', url: 'https://www.city.nishinoomote.lg.jp/', verification: 'reference; official website fetch blocked by network proxy' },
    { id: 'shinshiro', title: '新城市・設楽原歴史資料館／長篠城址史跡保存館', url: 'https://www.city.shinshiro.lg.jp/kanko/', verification: 'reference; official website fetch blocked by network proxy' },
    { id: 'azuchi', title: '滋賀県立安土城考古博物館', url: 'https://azuchi-museum.or.jp/', verification: 'reference; not fetched in this session' },
    { id: 'kyoto', title: '京都市歴史資料館', url: 'https://www.city.kyoto.lg.jp/bunshi/soshiki/1-3-0-0-0_13.html', verification: 'reference; not fetched in this session' },
    { id: 'odawara', title: '小田原城公式サイト', url: 'https://odawaracastle.com/', verification: 'reference; not fetched in this session' }
  ];
  const EVENTS = [
    { id: '1543-firearms', year: 1543, season: 2, title: '鉄砲伝来', text: '天文十二年、種子島に火縄銃が伝来したと伝わる。島内での製造から各地へ生産・運用が広まった。1560年開始の本作では伝来済みとして扱う。', source: 'teppokan', effect: 'firearms' },
    { id: '1549-xavier', year: 1549, season: 1, title: 'ザビエル来日', text: 'フランシスコ・ザビエルが鹿児島に上陸。南蛮貿易とキリスト教の伝来が戦国の外交・交易に新たなつながりを生んだ。', source: 'teppokan', effect: 'chronicle' },
    { id: '1560-okehazama', year: 1560, season: 1, title: '桶狭間の戦い', text: '史実では永禄三年五月、織田信長が今川義元を破った。人物の討死や領土の移動は本作では実際の合戦結果に従う。', source: 'shinshiro', clans: ['oda', 'imagawa'], officers: ['oda_nobunaga', 'imagawa_yoshimoto'], effect: 'resolve' },
    { id: '1561-kawanakajima', year: 1561, season: 2, title: '第四次川中島の戦い', text: '史実では武田信玄と上杉政虎が川中島で激戦を交えた。双方の勢力が残る場合、国境の緊張が高まる。', source: 'shinshiro', clans: ['takeda', 'uesugi'], effect: 'rivalry' },
    { id: '1562-kiyosu', year: 1562, season: 0, title: '清洲同盟', text: '史実では織田信長と松平元康が結んだ同盟が両家の基盤を固めた。両家が健在なら友好が上昇し、同盟そのものは外交交渉で結ぶ。', source: 'shinshiro', clans: ['oda', 'matsudaira'], officers: ['oda_nobunaga'], effect: 'friendship' },
    { id: '1567-rakuichi', year: 1567, season: 2, title: '楽市・楽座の展開', text: '史実では信長が美濃を制して岐阜に本拠を移し、楽市の制札を掲げた。商業施策を進めた城では交易収入が伸びる。', source: 'azuchi', effect: 'markets' },
    { id: '1568-kyoto', year: 1568, season: 2, title: '信長の上洛', text: '史実では織田信長が足利義昭を奉じて上洛した。本作では山城の領有と信長の生存・在籍が揃った場合のみ威信が上昇する。', source: 'kyoto', clans: ['oda'], officers: ['oda_nobunaga'], province: '山城', effect: 'prestige' },
    { id: '1571-hieizan', year: 1571, season: 2, title: '比叡山焼き討ち', text: '史実では信長の軍勢が比叡山を焼き討ちにした。多数の犠牲を伴う事件であり、本作では年代記として紹介し、焼き討ちを自動実行しない。', source: 'kyoto', effect: 'chronicle' },
    { id: '1573-bakufu', year: 1573, season: 1, title: '足利義昭の京都退去', text: '史実では義昭が信長により京都を追われ、室町幕府が事実上終焉を迎えた。独自に変化した本作の支配関係は維持される。', source: 'kyoto', effect: 'chronicle' },
    { id: '1575-nagashino', year: 1575, season: 1, title: '長篠・設楽原の戦い', text: '史実では織田・徳川連合軍と武田軍が激突した。鉄砲・馬防柵・地形を組み合わせた戦術の知見が広まる。「三段撃ち」の細部には議論がある。', source: 'shinshiro', clans: ['oda', 'takeda'], effect: 'drill' },
    { id: '1576-azuchi', year: 1576, season: 0, title: '安土城の築城開始', text: '史実では近江に安土城の築城が始まった。信長が健在で織田家が近江を支配していれば、その領内の城の改修技術が向上する。', source: 'azuchi', clans: ['oda'], officers: ['oda_nobunaga'], province: '近江', effect: 'fortification' },
    { id: '1582-honnoji', year: 1582, season: 1, title: '本能寺の変', text: '史実では明智光秀の謀反により信長が本能寺で最期を迎えた。本作は家臣の忠誠・在籍・戦況に従うため、信長の死や家の滅亡を強制しない。', source: 'kyoto', clans: ['oda'], officers: ['oda_nobunaga'], effect: 'unrest' },
    { id: '1588-katanagari', year: 1588, season: 1, title: '刀狩令', text: '史実では豊臣秀吉が刀狩令を発し、兵農分離を進めた。本作では年代記として紹介し、徴兵数は各領地の石高と人口から算出する。', source: 'azuchi', effect: 'chronicle' },
    { id: '1590-odawara', year: 1590, season: 1, title: '小田原合戦', text: '史実では秀吉の大軍が小田原を包囲し、北条氏が降伏した。本作では城の所有・籠城の結果を変えず、実際の戦況に従う。', source: 'odawara', effect: 'chronicle' }
  ];
  const ACTIONS = {
    reclaim: { label: '開墾・治水', gold: 300, food: 0, stat: 'politics', description: '労働力と継続する工事維持費を確保して新田を整備。適地が減るほど費用が増し、成果は小さくなる。' },
    commercial: { label: '商業・港整備', gold: 350, food: 0, stat: 'politics', description: '市・港を段階的に整備。着工直後は仮設市の収入だけで、完成後も設備維持費がかかる。' },
    levy: { label: '石高に応じた徴兵', gold: 250, food: 350, stat: 'leadership', description: '石高・人口・地形が定める上限内で足軽を募る。' },
    reward: { label: '家臣への恩賞', gold: 200, food: 0, stat: 'politics', description: '対象の自家武将の忠誠を高め、敵の調略を防ぐ。' },
    negotiation: { label: '外交使節', gold: 300, food: 0, stat: 'politics', description: '政治・知略で友好を上げ、75以上で四季の同盟を結ぶ。' },
    infiltrate: { label: '内応工作', gold: 420, food: 0, stat: 'intelligence', description: '敵武将の忠誠を削り、疲弊し忠誠の低い武将を引き抜く。発覚すると関係が悪化。' },
    enlist: { label: '捕虜を召し抱える', gold: 220, food: 0, stat: 'politics', description: '自家の捕虜を説得し、新たな家臣にする。成功率は忠誠と使者の能力次第。' },
    release: { label: '捕虜を解放', gold: 0, food: 0, stat: 'politics', description: '捕虜を旧主へ返す。旧主が滅亡していれば浪人となる。' },
    execute: { label: '捕虜を処断', gold: 0, food: 0, stat: 'leadership', description: '捕虜を処断する。友好・威信・家臣の忠誠が低下する。' },
    tax: { label: '年貢方針の変更', gold: 0, food: 0, stat: 'politics', description: '軽税・標準・重税を城別に指定。重税は収入を増すが不満が蓄積し、軽税は秩序回復を助ける。同じ城で一期間に一回。' },
    relief: { label: '領民の救済', gold: 80, food: 600, stat: 'politics', description: '蔵の兵糧を領民へ分配。不満・荒廃を減らし、収穫と取引の回復を助ける。' },
    buyGrain: { label: '兵糧の買い入れ', gold: 400, food: 0, stat: 'politics', description: '金400貫で兵糧1,200石を買い入れる。戦費と収穫前の備蓄を両立させる。' },
    sellGrain: { label: '余剰兵糧の売却', gold: 0, food: 1200, stat: 'politics', description: '兵糧1,200石を金300貫に換える。売却後も全領の二季分の維持兵糧を残す必要がある。' },
    demobilize: { label: '兵を農村へ戻す', gold: 0, food: 0, stat: 'leadership', description: '守備兵150人以上を残して解兵。軍維持費と農作業への負担を減らす。兵科別に均等比率で解兵する。' }
  };
  ACTIONS.waterworks = {label:'堤防・用水の整備',gold:260,food:0,stat:'politics',description:'堤防と用水路を整え治水を改善。洪水と日照りの危険を減らし、荒れた田畑を復旧する。'};
  ACTIONS.sanitation = {label:'衛生・救護の手配',gold:180,food:120,stat:'politics',description:'水場の清掃と病人の救護に資金・兵糧を充て、疫病を抑え領民の不満を和らげる。'};
  const ADMINISTRATION_ID = 'local-administration';
  const ADMINISTRATION_ACTIONS = ['reclaim', 'commercial', 'levy', 'reward', 'release', 'tax', 'relief', 'buyGrain', 'sellGrain', 'demobilize','waterworks','sanitation'];
  const DOMESTIC_ACTIONS = ['reclaim', 'commercial', 'levy', 'tax', 'relief', 'buyGrain', 'sellGrain', 'demobilize','waterworks','sanitation'];
  const TAX_POLICIES = [
    { id: 'low', label: '軽税', cash: 0.78, grain: 0.82, unrest: -7, description: '年貢収入は減るが領民の負担を軽くし、不満の回復を助ける。立て直しと長期安定を優先。' },
    { id: 'standard', label: '標準', cash: 1, grain: 1, unrest: -2, description: '収入と領民の負担の均衡を取り、不満を少しずつ和らげる。' },
    { id: 'high', label: '重税', cash: 1.24, grain: 1.2, unrest: 9, description: '当面の年貢収入が増すが、不満が蓄積。高い不満は収入・収穫を損ない一揆を招く。' }
  ];

  function mobilizationLimit(c) {
    const terrain = { mountain: 0.82, hill: 0.94, plain: 1, coast: 1 }[c.terrain] || 1;
    return Math.max(0, Math.floor(Math.min(c.population * 0.12, c.kokudaka * 0.085 * terrain)));
  }
  function initialize(input) {
    const s = clone(input), prior = s.tenka && typeof s.tenka === 'object' && !Array.isArray(s.tenka) ? s.tenka : {};
    s.tenka = {
      schema: 1, loyalty: {}, assignments: {}, estates: {}, chronicle: [], events: [], processedBattles: [],
      casualties: [], turnReports: [], marketReform: false, firearmDoctrine: 0,
      ...prior
    };
    const t = s.tenka;
    for (const key of ['loyalty', 'assignments', 'estates']) if (!t[key] || typeof t[key] !== 'object' || Array.isArray(t[key])) t[key] = {};
    for (const key of ['chronicle', 'events', 'processedBattles', 'casualties', 'turnReports', 'pendingCaptures','disasters']) if (!Array.isArray(t[key])) t[key] = [];
    t.disasters=t.disasters.filter(e=>e&&e.kind==='simulation'&&typeof e.id==='string').slice(0,240);
    // A seasonal task expires with its turn. Invalid/future save entries must
    // never lock an officer later or create a task that cannot be completed.
    for (const [id, task] of Object.entries(t.assignments)) {
      if (!task || !Number.isSafeInteger(task.turn) || task.turn < 1 || task.turn > s.turn || id === ADMINISTRATION_ID) delete t.assignments[id];
    }
    for (const o of s.officers || []) t.loyalty[o.id] = clamp(number(t.loyalty[o.id], 72 + hash(o.id) % 24), 0, 100);
    for (const c of s.castles || []) {
      const estate = t.estates[c.id] || {};
      const reclaimed = Math.max(0, number(estate.reclaimed, 0));
      const projects = Array.isArray(estate.projects) ? estate.projects.filter(p => p && ['reclaim', 'commercial'].includes(p.type)
        && Number.isInteger(p.remaining) && p.remaining > 0 && p.remaining <= 36
        && Number.isInteger(p.startedTurn) && p.startedTurn <= s.turn && p.startedTurn >= 1
        && [p.gain,p.workforce,p.upkeep].every(n => Number.isFinite(n) && n >= 0 && n <= 1000000)).slice(0,2).map(p=>monthly(s)&&p.periodUnit!=='month'?{...p,remaining:p.remaining*3,total:(p.total||p.remaining)*3,upkeep:Math.max(1,Math.round(p.upkeep/3)),periodUnit:'month'}:p) : [];
      t.estates[c.id] = { ...estate, commerce: clamp(Math.floor(number(estate.commerce, 0)), 0, 10), reclaimed,
        baseKokudaka: Math.max(1000, number(estate.baseKokudaka, c.kokudaka - reclaimed)),
        devastation: clamp(number(estate.devastation, 0), 0, 100),
        unrest: clamp(number(estate.unrest, 0), 0, 100),
        laborDisruption: clamp(number(estate.laborDisruption, 0), 0, 100),
        waterControl:clamp(number(estate.waterControl,({plain:43,coast:38,hill:53,mountain:62}[c.terrain]||45)+(hash(c.id)%15)-7),0,100),
        cropDamage:clamp(number(estate.cropDamage,0),0,80),
        famine:clamp(number(estate.famine,0),0,100),epidemic:clamp(number(estate.epidemic,0),0,100),
        uprising:estate.uprising&&['peasant','ikko'].includes(estate.uprising.kind)?{...estate.uprising,strength:clamp(number(estate.uprising.strength,25),0,100)}:null,
        taxPolicy: TAX_POLICIES.some(p => p.id === estate.taxPolicy) ? estate.taxPolicy : 'standard', projects };
    }
    const economy = t.economy && typeof t.economy === 'object' && !Array.isArray(t.economy) ? t.economy : {};
    t.economy = { ...economy, version:1, ledger:Array.isArray(economy.ledger)?economy.ledger.slice(0,16):[] };
    for (const event of EVENTS) {
      if (event.year * 4 + event.season < 1560 * 4 && !t.events.includes(event.id)) {
        t.events.push(event.id);
        t.chronicle.push({ ...event, status: 'past', date: `${event.year}年 ${SEASONS[event.season]}`, result: '開始前の史実。既に伝来・発生済みとして扱う。' });
      }
    }
    return s;
  }
  const developmentCapacity = (c, estate) => Math.round(estate.baseKokudaka * ({mountain:0.25,hill:0.4,plain:0.65,coast:0.5}[c.terrain] || 0.4));
  function estateWorkforce(c, estate) {
    const workforce = Math.round(c.population * 0.46);
    const military = Math.round(c.troops * 1.45);
    const construction = estate.projects.reduce((n,p) => n+p.workforce,0);
    const available = Math.max(0, workforce - military - construction);
    const efficiency = clamp(1 - (military+construction)/Math.max(1,workforce)*0.58 - estate.laborDisruption/200-estate.epidemic*.002-estate.famine*.001, 0.25, 1);
    return { workforce, military, construction, available, efficiency };
  }
  function developmentCost(s, c, type, power=60) {
    const estate=s.tenka.estates[c.id], labor=estateWorkforce(c,estate), capacity=developmentCapacity(c,estate);
    const completion=capacity?clamp(estate.reclaimed/capacity,0,1):1;
    const workforce = type==='reclaim' ? Math.round(Math.min(2200, Math.max(350,c.population*0.035))) : 400+estate.commerce*90;
    const gold=type==='reclaim' ? 300+Math.floor(estate.reclaimed/2500)*100 : 350+estate.commerce*140;
    const gain=type==='reclaim' ? Math.max(0,Math.min(capacity-estate.reclaimed,Math.round((1000+power*25)*(1-completion*.75)))) : 1;
    const duration=(type==='reclaim'?3:2)*(monthly(s)?3:1), upkeep=Math.round((type==='reclaim'?45+Math.floor(estate.reclaimed/4000)*10:40+estate.commerce*8)*(monthly(s)?1/3:1));
    const reason=estate.projects.some(p=>p.type===type)?'同じ種類の工事が進行中です。完成を待つか、別の城へ投資してください。'
      :type==='reclaim'&&gain<100?'この領地の開墾適地はほぼ整備済みです。'
        :type==='commercial'&&estate.commerce>=10?'この城の商業は最大の十段階です。'
          :labor.available<workforce?'農作業と守備に必要な人手が不足しています。解兵か既存工事の完成で労働力を確保してください。':'';
    return {gold,food:0,workforce,duration,upkeep,gain,available:!reason,reason};
  }
  const WAGES={ashigaru:.015,archer:.018,cavalry:.035,firearm:.025,navy:.028};
  const RATIONS={ashigaru:.06,archer:.06,cavalry:.085,firearm:.06,navy:.07};
  const UNIT_NAMES={ashigaru:'足軽',archer:'弓',cavalry:'騎馬',firearm:'鉄砲',navy:'水軍'};
  function militaryBudget(s,c) {
    const composition=s.armies?.[c.id]?.units,listed=sum(composition),troops=Math.max(0,c.troops||0);
    const breakdown=UNITS.map(type=>({type,label:UNIT_NAMES[type],troops:listed?troops*(composition?.[type]||0)/listed:type==='ashigaru'?troops:0}));
    for(const line of breakdown) {
      line.monthlyWages=Math.round(line.troops*WAGES[line.type]);line.monthlyFood=Math.round(line.troops*RATIONS[line.type]);line.troops=Math.round(line.troops);
    }
    return {monthlyWages:breakdown.reduce((n,u)=>n+u.monthlyWages,0),monthlyFood:breakdown.reduce((n,u)=>n+u.monthlyFood,0),militaryBreakdown:breakdown};
  }
  function estateBudget(s,c) {
    const estate=s.tenka.estates[c.id],policy=TAX_POLICIES.find(p=>p.id===estate.taxPolicy),labor=estateWorkforce(c,estate);
    const commander=getOfficer(s,s.armies?.[c.id]?.commanderId);
    const order=clamp(1-estate.devastation*.005-estate.unrest*.004-(estate.uprising?.strength||0)*.0015,0.2,1);
    const fraction=periodMonths(s)/3,military=militaryBudget(s,c);
    const taxIncome=Math.round((c.kokudaka*.012+c.population*.003)*(.88+(commander?.politics||45)/500)*policy.cash*order*fraction);
    const commerce=Math.round(commerceIncome(c,estate,s.tenka)*fraction);
    const militaryUpkeep=monthly(s)?military.monthlyWages:Math.round(c.troops*.055);
    const maintenance=Math.round((estate.commerce*18+estate.reclaimed*.002)*fraction);
    const projectUpkeep=estate.projects.reduce((n,p)=>n+p.upkeep,0);
    const foodUpkeep=monthly(s)?military.monthlyFood:Math.round(c.troops*.18);
    const baselineHarvest=Math.round(c.kokudaka*.28*policy.grain*labor.efficiency);
    const harvestFactor=order*(1-estate.cropDamage/100);
    const harvest=Math.round(baselineHarvest*harvestFactor);
    return {castleId:c.id,clan:c.clan,taxIncome,commerceIncome:commerce,income:taxIncome+commerce,
      militaryUpkeep,maintenance,projectUpkeep,upkeep:militaryUpkeep+maintenance+projectUpkeep,
      netIncome:taxIncome+commerce-militaryUpkeep-maintenance-projectUpkeep,foodUpkeep,harvest,
      ...military,periodMonths:periodMonths(s),baselineHarvest,harvestFactor,harvestLoss:baselineHarvest-harvest,
      laborAvailable:labor.available,workforce:labor.workforce,laborEfficiency:Math.round(labor.efficiency*100),
      foodReserveMonths:military.monthlyFood?Math.floor((c.clan===s.playerClan?s.food:c.food)/military.monthlyFood*10)/10:null,
      foodReserveSeasons:foodUpkeep?Math.floor((c.clan===s.playerClan?s.food:c.food)/foodUpkeep*(monthly(s)?1/3:1)*10)/10:null};
  }
  function economyForecast(input) {
    const s=initialize(input),castles=s.castles.map(c=>estateBudget(s,c)),mine=castles.filter(c=>c.clan===s.playerClan);
    const totals={};
    for(const key of ['income','taxIncome','commerceIncome','upkeep','militaryUpkeep','maintenance','projectUpkeep','netIncome','foodUpkeep','harvest','baselineHarvest','harvestLoss','monthlyWages','monthlyFood'])totals[key]=mine.reduce((n,c)=>n+c[key],0);
    totals.periodMonths=periodMonths(s);
    totals.foodReserveSeasons=totals.foodUpkeep?Math.floor(s.food/totals.foodUpkeep*(monthly(s)?1/3:1)*10)/10:null;
    totals.foodReserveMonths=totals.monthlyFood?Math.floor(s.food/totals.monthlyFood*10)/10:null;
    const nextMonth=monthly(s)?s.month%12+1:null;
    const nextSeason=monthly(s)?nextMonth>=3&&nextMonth<=5?0:nextMonth>=6&&nextMonth<=8?1:nextMonth>=9&&nextMonth<=11?2:3:(s.season+1)%4;
    totals.nextHarvest=(monthly(s)?nextMonth===9:nextSeason===2)?totals.harvest:0;
    totals.projectedGold=Math.max(0,s.gold+totals.netIncome);
    totals.projectedFood=Math.max(0,s.food+totals.nextHarvest-totals.foodUpkeep);
    return {totals,castles,nextSeason,nextMonth,policies:clone(TAX_POLICIES),ledger:s.tenka.economy.ledger,events:clone(s.tenka.disasters),monthly:monthly(s),
      reserveSeasons:totals.foodReserveSeasons};
  }
  const IKKO_PROVINCES=new Set(['加賀','越前','越中','能登','三河','近江','摂津','河内','紀伊']);
  function climateRisks(s,c,estate=s.tenka.estates[c.id]) {
    const month=monthly(s)?s.month:[4,7,10,1][s.season],water=estate.waterControl/100;
    const south=['薩摩','大隅','日向','肥後','肥前','筑後','豊後','豊前','筑前','土佐','阿波','伊予','讃岐','紀伊'].includes(c.province);
    const terrainRisk=c.terrain==='plain'?1.2:c.terrain==='mountain'?.55:1;
    const factor=periodMonths(s);
    return {drought:[6,7,8].includes(month)?(.018+(1-water)*.045)*factor:0,
      pests:[5,6,7,8,9].includes(month)?.024*factor:0,
      typhoon:[8,9,10].includes(month)?(c.coastal||c.terrain==='coast'?.037:.015)*(south?1.3:1)*factor:0,
      flood:[6,7,9,10].includes(month)?(.007+(1-water)*.065)*terrainRisk*factor:0};
  }
  function estateEvent(s,c,type,title,text,extra={}) {
    const event={id:`estate-${c.id}-${s.turn}-${type}${extra.battleId?`-${extra.battleId}`:''}`,kind:'simulation',type,title,text,castleId:c.id,castleName:c.name,
      turn:s.turn,year:s.year,season:s.season,...(monthly(s)?{month:s.month}:{}),date:date(s),...extra};
    if(s.tenka.disasters.some(e=>e.id===event.id))return;
    s.tenka.disasters.unshift(event);s.tenka.disasters=s.tenka.disasters.slice(0,240);
    if(c.clan===s.playerClan){s.tenka.turnReports.push(`${c.name}：${title}。${text}`);append(s,'domestic',`${c.name}・${title}`,`${text}（ゲーム内の地域・気候シミュレーション）`);}
  }
  function climateProgress(s,c) {
    const e=s.tenka.estates[c.id];if(e.lastClimateTurn===s.turn)return;e.lastClimateTurn=s.turn;
    if(!monthly(s))return;
    const months=periodMonths(s),month=monthly(s)?s.month:[4,7,10,1][s.season];
    // Weather damages remain in the coming harvest; winter/spring recovery
    // restores fields, rather than permanently reducing their assessed kokudaka.
    e.cropDamage=Math.max(0,e.cropDamage-([11,12,1,2,3].includes(month)?4:1)*months);
    e.waterControl=Math.max(0,e.waterControl-.35*months);
    const risks=climateRisks(s,c,e),seed=`${s.year}:${month}:${s.turn}:${c.id}:${e.baseKokudaka}`;
    if(s.turn-number(e.lastWeatherTurn,-100)>=(monthly(s)?2:1)) {
      const candidates=Object.entries(risks).filter(([kind,chance])=>hash(`weather:${seed}:${kind}`)/4294967296<chance);
      // A single local weather event is enough for one period: do not stack
      // four independent disasters into an unmanageable opening month.
      candidates.sort((a,b)=>hash(`pick:${seed}:${a[0]}`)-hash(`pick:${seed}:${b[0]}`));
      if(candidates.length) {
        const type=candidates[0][0],damage=type==='pests'?12+hash(seed)%7:type==='typhoon'?18+hash(seed)%9:type==='flood'?14+hash(seed)%9:15+hash(seed)%8;
        e.lastWeatherTurn=s.turn;e.cropDamage=clamp(e.cropDamage+damage,0,80);e.unrest=clamp(e.unrest+(type==='typhoon'||type==='flood'?7:4),0,100);
        if(type==='flood'||type==='typhoon'){e.laborDisruption=clamp(e.laborDisruption+8,0,100);e.waterControl=Math.max(0,e.waterControl-3);}
        if(type==='flood')e.lastFloodTurn=s.turn;
        const title={drought:'日照りによる水不足',pests:'害虫の発生',typhoon:'台風による農作物被害',flood:'河川の氾濫'}[type];
        estateEvent(s,c,type,title,`田畑の被害 +${damage}。秋の収穫見込が減少し、領民の不満が高まります。${type==='flood'?'堤防・用水整備で再発の危険を下げられます。':''}`,{cropDamage:damage});
      }
    }
    const diseaseRisk=(.006+e.famine*.0009+(s.turn-number(e.lastFloodTurn,-100)<=2?.025:0))*months;
    if(e.epidemic<=5&&hash(`disease:${seed}`)/4294967296<diseaseRisk) {
      e.epidemic=28+hash(`severity:${seed}`)%18;
      estateEvent(s,c,'epidemic','疫病の流行','病により人口と農作業の人手が減少。衛生・救護、領民救済で被害を抑えられます。');
    } else e.epidemic=Math.max(0,e.epidemic-3*months);
  }
  function unrestProgress(s,c) {
    const e=s.tenka.estates[c.id],months=periodMonths(s),policy=TAX_POLICIES.find(p=>p.id===e.taxPolicy);
    e.unrest=clamp(e.unrest+policy.unrest*months/3+(e.devastation>=40?months:0)+e.famine*.025*months+e.epidemic*.018*months,0,100);
    e.laborDisruption=Math.max(0,e.laborDisruption-5*months/3);
    if(e.uprising) {
      e.uprising.strength=clamp(e.uprising.strength+(e.unrest>=75?2:-8)*months+(policy.id==='low'?-3*months:0),0,100);
      c.morale=clamp(c.morale-2*months,10,100);e.laborDisruption=clamp(e.laborDisruption+2*months,0,100);
      if(e.uprising.strength===0||e.unrest<42){estateEvent(s,c,'uprising-resolved','一揆の鎮静','救済と負担の軽減により領内が落ち着きました。');e.uprising=null;}
    } else if(e.unrest>=80&&s.turn-number(e.lastUprisingTurn,-100)>=(monthly(s)?8:3)) {
      const chance=e.unrest>=90?1:monthly(s)?.18:.55;
      if(hash(`uprising:${s.turn}:${c.id}:${s.year}`)/4294967296<chance) {
        const kind=IKKO_PROVINCES.has(c.province)&&s.year>=1488&&s.year<=1605&&hash(`faith:${c.id}:${s.turn}`)%100<48?'ikko':'peasant';
        const label=kind==='ikko'?'一向一揆':'農民一揆';
        e.uprising={kind,label,startedTurn:s.turn,strength:30+Math.round((e.unrest-80)*1.5)};e.lastUprisingTurn=s.turn;
        c.morale=clamp(c.morale-8,10,100);e.devastation=clamp(e.devastation+5,0,100);
        estateEvent(s,c,'uprising',label,`${kind==='ikko'?'寺内・門徒の結びつきも加わり':'年貢と飢えへの不満が募り'}民衆が蜂起。徴税・農作業・工事に支障が出ます。軽税と領民救済で不満を下げてください。`,{uprisingKind:kind});
      }
    }
  }
  function progressEstates(s) {
    if(s.tenka.economy.lastProgressTurn===s.turn)return {};
    s.tenka.economy.lastProgressTurn=s.turn;
    const workCosts={};
    for(const c of s.castles) {
      const estate=s.tenka.estates[c.id];
      climateProgress(s,c);unrestProgress(s,c);
    }
    const budgets=new Map(s.castles.map(c=>[c.id,estateBudget(s,c)]));
    // Player castles share one treasury. Set aside all mandatory army and
    // facility bills once, then allocate the remaining cash to projects.
    // NPC castles retain their separate local treasuries.
    let playerFunds=Math.max(0,s.gold+owned(s).reduce((cash,c)=>{
      const b=budgets.get(c.id);return cash+b.income-b.militaryUpkeep-b.maintenance;
    },0));
    for(const c of [...s.castles].sort((a,b)=>a.id.localeCompare(b.id))) {
      const estate=s.tenka.estates[c.id],beforeBudget=budgets.get(c.id),player=c.clan===s.playerClan;
      let constructionFunds=player?playerFunds:Math.max(0,c.gold+beforeBudget.income-beforeBudget.militaryUpkeep-beforeBudget.maintenance);
      workCosts[c.id]=0;
      for(const p of estate.projects) {
        if(p.startedTurn>=s.turn)continue;
        if(constructionFunds<p.upkeep||estate.uprising||estate.unrest>=85) {
          p.status=constructionFunds<p.upkeep?'資金不足で中断':'一揆・不満のため中断';
          if(c.clan===s.playerClan)s.tenka.turnReports.push(`${c.name}の${p.label}は${p.status}。工事の残り${p.remaining}${periodLabel(s)}。`);
          continue;
        }
        constructionFunds-=p.upkeep;workCosts[c.id]+=p.upkeep;
        p.status='工事中';p.remaining--;
        if(p.remaining===0) {
          if(p.type==='reclaim') {c.kokudaka+=p.gain;c.population+=Math.round(p.gain*.3);estate.reclaimed+=p.gain;estate.waterControl=clamp(estate.waterControl+8,0,100);}
          if(c.clan===s.playerClan)s.tenka.turnReports.push(`${c.name}の${p.label}が完成。${p.type==='reclaim'?`石高 +${p.gain.toLocaleString('ja-JP')}石。`:'仮設市から本格操業へ移り、商業収入が増えました。'}`);
        }
      }
      estate.projects=estate.projects.filter(p=>p.remaining>0);
      if(player)playerFunds=constructionFunds;
    }
    return workCosts;
  }
  // Called by the native season BEFORE its AI round. This replaces that
  // season's basic tax/harvest/upkeep block; advance() must not charge it again.
  function settleEconomy(state, previousState) {
    const normalized=initialize(state);state.tenka=normalized.tenka;
    if(state.tenka.economy.lastSettledTurn===state.turn) {
      const ledger=state.tenka.economy.ledger.find(entry=>entry.turn===state.turn);
      return {...(ledger||economyForecast(state).totals),shortage:(ledger?.foodDeficit||0)>0,alreadySettled:true};
    }
    state.tenka.turnReports=[];
    const workCosts=progressEstates(state);
    const forecast=economyForecast(state),n=forecast.totals;
    // Completed works still pay workers for their final season. They have
    // already left the future forecast, so settle that last bill explicitly.
    for(const budget of forecast.castles) {
      if(!Object.hasOwn(workCosts,budget.castleId))continue;
      const difference=workCosts[budget.castleId]-budget.projectUpkeep;
      budget.projectUpkeep+=difference;budget.upkeep+=difference;budget.netIncome-=difference;
      if(budget.clan===state.playerClan) {n.projectUpkeep+=difference;n.upkeep+=difference;n.netIncome-=difference;}
    }
    const goldBefore=state.gold,foodBefore=state.food;
    const harvest=harvestTime(state)?n.harvest:0;
    const goldDeficit=Math.max(0,n.upkeep-goldBefore-n.income);
    const foodDeficit=Math.max(0,n.foodUpkeep-foodBefore-harvest);
    state.gold=Math.max(0,goldBefore+n.netIncome);state.food=Math.max(0,foodBefore+harvest-n.foodUpkeep);
    // Player estates draw from one national granary. Compare that shared
    // reserve with the whole country's needs, not each castle's small share.
    const nationalReliefReserve=n.monthlyFood*6+owned(state).reduce((total,c)=>total+c.population,0)*.02;
    for(const c of state.castles) {
      const estate=state.tenka.estates[c.id],budget=forecast.castles.find(b=>b.castleId===c.id);
      const player=c.clan===state.playerClan;
      const shortage=player?foodDeficit>0:c.food+(harvestTime(state)?budget.harvest:0)<budget.foodUpkeep;
      const arrears=player?goldDeficit>0:c.gold+budget.income<budget.upkeep;
      if(!player) {c.gold=Math.max(0,c.gold+budget.netIncome);c.food=Math.max(0,c.food+(harvestTime(state)?budget.harvest:0)-budget.foodUpkeep);}
      c.morale=clamp(c.morale+(shortage?-15:arrears?-5:estate.unrest>=60?-3:2),10,100);
      if(shortage) {loseTroops(state,c,Math.floor(c.troops*.08));estate.unrest=clamp(estate.unrest+8,0,100);}
      if(arrears)estate.unrest=clamp(estate.unrest+4,0,100);
      let populationLoss=0;
      if(monthly(state)) {
        const reserve=player?state.food:c.food;
        const requiredReserve=player?nationalReliefReserve:budget.monthlyFood*6+c.population*.02;
        const poorHarvest=harvestTime(state)&&budget.harvestFactor<.7&&reserve<requiredReserve;
        if(shortage||poorHarvest) {
          const before=estate.famine;estate.famine=clamp(estate.famine+(shortage?24:18),0,100);estate.unrest=clamp(estate.unrest+5,0,100);
          if(before<15||poorHarvest)estateEvent(state,c,'famine','凶作と飢饉',`${poorHarvest?'戦禍や天候による減収で':'備蓄の不足により'}領民への食糧が行き渡りません。救済・兵糧購入・解兵で備蓄と働き手を確保してください。`);
        } else estate.famine=Math.max(0,estate.famine-7);
        populationLoss=Math.min(Math.max(0,c.population-300),Math.round(c.population*(estate.famine*.000025+estate.epidemic*.000035)));
        c.population-=populationLoss;
      }
      estate.lastLedger={...budget,turn:state.turn,year:state.year,season:state.season,...(monthly(state)?{month:state.month}:{}),harvest:harvestTime(state)?budget.harvest:0,shortage,arrears,populationLoss,
        events:clone(state.tenka.disasters.filter(e=>e.castleId===c.id&&e.turn===state.turn))};
      // Regional NPC armies obey the same harvest and upkeep rules, then use
      // their own treasury for a small replacement draft, as in the base game.
      const draftGold=monthly(state)?34:100,draftFood=monthly(state)?84:250;
      if(!player&&c.gold>=draftGold&&c.food>=draftFood&&c.troops<mobilizationLimit(c)&&estate.unrest<65&&estate.famine<25&&!estate.uprising) {
        const count=Math.min(monthly(state)?54:160,mobilizationLimit(c)-c.troops);c.gold-=draftGold;c.food-=draftFood;levy(state,c,count);
        estate.laborDisruption=clamp(estate.laborDisruption+count/Math.max(1,c.population)*150,0,100);
      }
    }
    const ledger={turn:state.turn,year:state.year,season:state.season,...(monthly(state)?{month:state.month}:{}),goldBefore,goldAfter:state.gold,foodBefore,foodAfter:state.food,
      ...n,harvest,goldDeficit,foodDeficit,castles:forecast.castles.filter(c=>c.clan===state.playerClan).map(c=>state.tenka.estates[c.castleId].lastLedger),
      events:clone(state.tenka.disasters.filter(e=>e.turn===state.turn&&state.castles.some(c=>c.id===e.castleId&&c.clan===state.playerClan)))};
    state.tenka.economy.ledger=[ledger,...state.tenka.economy.ledger].slice(0,16);
    state.tenka.economy.lastSettledTurn=state.turn;
    state.tenka.turnReports.push(`領国収支（${monthly(state)?'一か月':'三か月'}）：年貢 ${n.taxIncome}貫・商業 ${n.commerceIncome}貫、軍給 ${n.militaryUpkeep}貫・施設維持 ${n.maintenance}貫・工事 ${n.projectUpkeep}貫。差引 ${n.netIncome>=0?'+':''}${n.netIncome}貫。兵糧支給 ${n.foodUpkeep}石${harvest?`、秋の収穫 ${harvest}石`:''}。`);
    if(goldDeficit||foodDeficit)state.tenka.turnReports.push(`不足：金 ${goldDeficit}貫・兵糧 ${foodDeficit}石。軍の士気${foodDeficit?'と兵力':''}が低下。軽税・解兵・兵糧購入で再建できます。`);
    return {...n,harvest,shortage:foodDeficit>0,goldDeficit,foodDeficit,castles:forecast.castles};
  }
  function isOfficerAvailable(s, o) {
    return active(s, o) && s.tenka?.assignments?.[o.id]?.turn !== s.turn;
  }
  function officerAvailability(s) {
    const roster = s.officers.filter(o => o.clan === s.playerClan && o.status === 'active');
    const adults = roster.filter(o => adult(s, o)), available = adults.filter(o => isOfficerAvailable(s, o));
    const reason = available.length ? null : adults.length ? 'all-busy' : roster.length ? 'underage' : 'no-officers';
    const message = reason === 'all-busy' ? `成人武将は全員今${periodLabel(s)}の任務中です。奉行衆に政務を任せるか、登用・次の${monthly(s)?'月':'季節'}で家臣の手を空けられます。`
      : reason === 'underage' ? '出仕できる成人武将がいません。十五歳未満の一門は元服を待ち、奉行衆の政務と武将の登用で領国を支えられます。'
        : reason === 'no-officers' ? '出仕中の自家武将がいません。奉行衆の政務と武将の登用で家臣団を立て直せます。' : '';
    return { available: available.length, totalAdults: adults.length, minors: roster.length - adults.length, reason, message };
  }
  function administrationFallback(s, availability = officerAvailability(s)) {
    if (!availability.reason || s.gameOver&&s.winner!==s.playerClan || !owned(s).length) return null;
    return { id: ADMINISTRATION_ID, name: '奉行衆', clan: s.playerClan, status: 'active',
      politics: 35, intelligence: 30, leadership: 30, available: true, administrative: true,
      allowedActions: [...ADMINISTRATION_ACTIONS], reason: availability.reason };
  }
  function clearCommand(s, id) {
    for (const army of Object.values(s.armies || {})) if (army.commanderId === id) army.commanderId = null;
  }
  // Core captures run before the whole AI round is settled. Preserve each
  // garrison's transition now, so a later fall of its retreat destination does
  // not turn the earlier retreat into a capture in the wrong battle report.
  function recordCapture(s, { targetId, defenderClan, winnerClan, before }) {
    s.tenka ||= {};
    const snapshot = o => ({ id:o.id, name:o.name, clan:o.clan, castleId:o.castleId,
      status:o.status, capturedBy:o.capturedBy ?? null });
    const officers = (before || []).filter(o => o.status === 'active' && o.clan === defenderClan && o.castleId === targetId);
    const event = { targetId, defenderClan, winnerClan, turn:s.turn, round:s.aiRound || 0,
      before:officers.map(snapshot), after:officers.map(o => snapshot(getOfficer(s,o.id) || o)) };
    const pending = Array.isArray(s.tenka.pendingCaptures) ? s.tenka.pendingCaptures : [];
    s.tenka.pendingCaptures = [...pending, event].slice(-20);
  }
  function recordDeath(s, officer, cause) {
    if (globalThis.TenkaDynasty?.recordDeath) return globalThis.TenkaDynasty.recordDeath(s, officer, { cause });
    officer.historicalDeath ??= officer.death;
    Object.assign(officer, { status:'dead', castleId:null, capturedBy:null, deathYear:s.year,
      deathSeason:s.season, death:s.year, diedAtAge:officer.birth==null?null:Math.max(0,s.year-officer.birth), deathCause:cause });
    clearCommand(s, officer.id); delete s.tenka.assignments[officer.id];
    return officer;
  }
  function changeEmployer(s, o, clan, castleId) {
    clearCommand(s, o.id);
    o.clan = clan; o.castleId = castleId; o.status = 'active'; o.capturedBy = null;
    s.tenka.loyalty[o.id] = 58;
  }
  function levy(s, c, troops) {
    s.armies[c.id] ||= { commanderId: null, units: Object.fromEntries(UNITS.map(k => [k, 0])) };
    s.armies[c.id].units.ashigaru += troops; c.troops += troops;
  }
  function loseTroops(s, c, count) {
    const remove = Math.min(c.troops, Math.max(0, Math.round(count))), a = s.armies[c.id];
    c.troops -= remove;
    if (a && sum(a.units) > c.troops) {
      const total = sum(a.units), next = {};
      for (const k of UNITS) next[k] = Math.floor(a.units[k] * c.troops / total);
      let remaining = c.troops - sum(next);
      for (const k of UNITS) if (remaining > 0 && a.units[k] > next[k]) { next[k]++; remaining--; }
      a.units = next;
    }
  }
  function act(input, action) {
    if (!action || !ACTIONS[action.type]) return { ok: false, state: input, message: 'この命令は存在しません。' };
    if (input.gameOver && !(input.winner===input.playerClan&&['enlist','release','execute'].includes(action.type))) return { ok: false, state: input, message: 'この年代記は決着しました。' };
    const s = initialize(input), t = s.tenka, rule = {...ACTIONS[action.type]};
    const postVictory = s.gameOver && s.winner===s.playerClan && ['enlist','release','execute'].includes(action.type);
    const fail = message => ({ ok: false, state: input, message });
    if (s.actionPoints < 1 && !postVictory) return fail(`今${periodLabel(s)}の命令を使い切りました。次の${monthly(s)?'月':'季節'}へ進めてください。`);
    const c = getCastle(s, action.castleId || s.selectedCastleId);
    const availability = officerAvailability(s), fallback = administrationFallback(s, availability);
    const administrative = action.officerId === ADMINISTRATION_ID;
    const delegate = administrative ? fallback : getOfficer(s, action.officerId);
    if (administrative && !ADMINISTRATION_ACTIONS.includes(action.type)) return fail('奉行衆は開墾・商業・徴兵・年貢・救済・兵糧売買・解兵・恩賞・捕虜解放を担います。外交・調略・捕虜説得・処断には成人武将が必要です。');
    if (administrative && !delegate) return fail('未任務の成人武将がいるため、その武将を担当に選んでください。');
    if (!delegate || delegate.clan !== s.playerClan || delegate.status !== 'active') return fail(availability.message || '活動中の自家武将を担当に選んでください。');
    if (!administrative && !adult(s, delegate)) return fail(`${delegate.name}は十五歳未満で、まだ任務に出仕できません。成人武将を選ぶか、奉行衆に政務を任せてください。`);
    if (!administrative && !postVictory && !isOfficerAvailable(s, delegate)) return fail(`${delegate.name}は今${periodLabel(s)}の任務中です。未任務の武将を選ぶか、全員任務中なら奉行衆に政務を任せてください。次の${monthly(s)?'月':'季節'}には任務が解除されます。`);
    const target = getOfficer(s, action.targetOfficerId);
    const domestic = DOMESTIC_ACTIONS.includes(action.type);
    if (domestic && (!c || c.clan !== s.playerClan)) return fail('自領の城を指定してください。');
    const power = Math.round((delegate[rule.stat] || 40) * 0.72 + (delegate.intelligence || 40) * 0.28);
    const projectCost=['reclaim','commercial'].includes(action.type)?developmentCost(s,c,action.type,power):null;
    if(projectCost) {
      if(!projectCost.available)return fail(projectCost.reason);
      rule.gold=projectCost.gold;
    }
    if (s.gold < rule.gold || s.food < rule.food) return fail(`金${rule.gold}貫・兵糧${rule.food}石が必要です。`);
    let message = '', outcome = 'success';
    let targetClan = action.targetClan || (c && c.clan);
    if (action.type === 'commercial' && t.estates[c.id].commerce >= 10) return fail('この城の商業は最大の十段階です。');
    if(action.type==='tax'&&!TAX_POLICIES.some(p=>p.id===action.policy))return fail('軽税・標準・重税のいずれかを指定してください。');
    if(action.type==='tax'&&t.estates[c.id].taxPolicy===action.policy)return fail('この城は既にその年貢方針です。');
    if(action.type==='tax'&&t.estates[c.id].policyTurn===s.turn)return fail(`この城の年貢方針は今${periodLabel(s)}既に変更しました。次の${monthly(s)?'月':'季節'}に見直せます。`);
    if(action.type==='sellGrain'&&s.food-rule.food<economyForecast(s).totals.foodUpkeep*(monthly(s)?6:2))return fail('売却後に六か月分の維持兵糧を残してください。収穫前の飢餓を避ける備蓄が必要です。');
    const demobilized=action.troops??Math.min(500,c?.troops-150);
    if(action.type==='demobilize'&&(!Number.isInteger(demobilized)||demobilized<1||demobilized>c.troops-150))return fail('解兵する人数を整数で指定し、守備兵150人以上を残してください。');
    if (action.type === 'levy' && c.troops >= mobilizationLimit(c)) return fail(`石高による動員上限 ${mobilizationLimit(c).toLocaleString('ja-JP')} 人に達しています。開墾が必要です。`);
    if (action.type === 'reward' && (!target || !active(s, target) || target.clan !== s.playerClan)) return fail('恩賞を与える自家の活動中の武将を選んでください。');
    if (action.type === 'reward' && t.loyalty[target.id] >= 100) return fail('その武将の忠誠は既に最大です。');
    if (action.type === 'negotiation' && (!targetClan || targetClan === s.playerClan || !owned(s, targetClan).length)) return fail('健在な他家の城を指定してください。');
    if (action.type === 'negotiation' && s.alliances.includes(targetClan)) return fail('その家とは既に同盟を結んでいます。');
    if (action.type === 'infiltrate' && (!target || !active(s, target) || target.clan === s.playerClan || s.alliances.includes(target.clan))) return fail('同盟中ではない敵家の活動中の武将を選んでください。');
    if (['enlist', 'release', 'execute'].includes(action.type) && (!target || target.status !== 'captive' || target.capturedBy !== s.playerClan)) return fail('自家が捕らえている武将を選んでください。');
    const roll = hash(`${s.turn}:${s.actionPoints}:${action.type}:${delegate.id}:${target?.id || c?.id || targetClan}`) % 100;
    if (action.type === 'reclaim') {
      const increase = Math.round(projectCost.gain*.15);
      c.kokudaka += increase; c.population += Math.round(increase * 0.3); c.morale = clamp(c.morale + 4, 10, 100);
      t.estates[c.id].reclaimed += increase; t.estates[c.id].devastation = Math.max(0, t.estates[c.id].devastation - 5);
      t.estates[c.id].waterControl=clamp(t.estates[c.id].waterControl+4,0,100);
      t.estates[c.id].projects.push({id:`${c.id}-reclaim-${s.turn}`,type:'reclaim',label:'開墾・治水',startedTurn:s.turn,
        remaining:projectCost.duration,total:projectCost.duration,workforce:projectCost.workforce,upkeep:projectCost.upkeep,gain:projectCost.gain-increase,status:'工事中',periodUnit:monthly(s)?'month':'season'});
      message = `${delegate.name}が${c.name}の開墾と治水に着工。先行整備で石高 +${increase.toLocaleString('ja-JP')}石、残り +${(projectCost.gain-increase).toLocaleString('ja-JP')}石は${projectCost.duration}${periodLabel(s)}後。労働力 ${projectCost.workforce}人、工事費は毎${periodLabel(s)} ${projectCost.upkeep}貫。`;
    } else if (action.type === 'commercial') {
      const estate = t.estates[c.id]; estate.commerce++;
      estate.projects.push({id:`${c.id}-commercial-${s.turn}`,type:'commercial',label:c.coastal?'市・港整備':'市・街道整備',startedTurn:s.turn,
        remaining:projectCost.duration,total:projectCost.duration,workforce:projectCost.workforce,upkeep:projectCost.upkeep,gain:1,status:'工事中',periodUnit:monthly(s)?'month':'season'});
      const income = commerceIncome(c, estate, t);
      message = `${delegate.name}が${c.name}の${c.coastal ? '港と市' : '街道と市'}の整備を開始。商業 ${estate.commerce}/10、完成まで${projectCost.duration}${periodLabel(s)}。工事中の仮設市収入は ${Math.round(income*periodMonths(s)/3)}貫、工事費は毎${periodLabel(s)} ${projectCost.upkeep}貫、労働力 ${projectCost.workforce}人が必要です。`;
    } else if (action.type === 'levy') {
      const count = Math.min(350 + power * 5, mobilizationLimit(c) - c.troops);
      levy(s, c, count); c.morale = clamp(c.morale + 3, 10, 100);
      t.estates[c.id].laborDisruption=clamp(t.estates[c.id].laborDisruption+count/Math.max(1,c.population)*250,0,100);
      message = `${delegate.name}が${c.name}で足軽 ${count} 人を募りました。石高動員上限 ${mobilizationLimit(c)} 人。農村の人手が減り、秋の収穫見込は ${estateBudget(s,c).harvest}石、兵糧支給は毎${periodLabel(s)} ${estateBudget(s,c).foodUpkeep}石です。`;
    } else if(action.type==='tax') {
      const estate=t.estates[c.id],policy=TAX_POLICIES.find(p=>p.id===action.policy);estate.taxPolicy=policy.id;estate.policyTurn=s.turn;
      message=`${delegate.name}が${c.name}の年貢を${policy.label}に変更。${policy.description}`;
    } else if(action.type==='relief') {
      const estate=t.estates[c.id];estate.unrest=Math.max(0,estate.unrest-18);estate.devastation=Math.max(0,estate.devastation-4);c.morale=clamp(c.morale+7,10,100);
      estate.famine=Math.max(0,estate.famine-28);estate.epidemic=Math.max(0,estate.epidemic-8);
      if(estate.uprising)estate.uprising.strength=Math.max(0,estate.uprising.strength-18);
      message=`${c.name}の領民に兵糧600石を分配。領民の不満 -18、飢饉 -28、疫病 -8、荒廃 -4、城の士気 +7。`;
    } else if(action.type==='waterworks') {
      const estate=t.estates[c.id],gain=12+Math.floor(power/12);estate.waterControl=clamp(estate.waterControl+gain,0,100);
      estate.cropDamage=Math.max(0,estate.cropDamage-5);estate.devastation=Math.max(0,estate.devastation-3);
      message=`${delegate.name}が${c.name}の堤防と用水路を整備。治水 +${gain}（${Math.round(estate.waterControl)}/100）、田畑被害 -5。洪水と日照りの危険が下がりました。`;
    } else if(action.type==='sanitation') {
      const estate=t.estates[c.id];estate.epidemic=Math.max(0,estate.epidemic-30);estate.unrest=Math.max(0,estate.unrest-6);estate.famine=Math.max(0,estate.famine-5);
      message=`${delegate.name}が${c.name}の水場清掃と救護を手配。疫病 -30、飢饉 -5、不満 -6。`;
    } else if(action.type==='buyGrain') {
      s.food+=1200;message=`金400貫で兵糧1,200石を買い入れました。領国の備蓄は ${s.food.toLocaleString('ja-JP')}石です。`;
    } else if(action.type==='sellGrain') {
      s.gold+=300;message=`余剰兵糧1,200石を売却し、金300貫を得ました。六か月分以上の維持兵糧を確保しています。`;
    } else if(action.type==='demobilize') {
      loseTroops(s,c,demobilized);t.estates[c.id].laborDisruption=Math.max(0,t.estates[c.id].laborDisruption-12);c.morale=clamp(c.morale+2,10,100);
      message=`${c.name}の兵 ${demobilized}人を解兵し、農村へ戻しました。兵糧支給は毎${periodLabel(s)} ${estateBudget(s,c).foodUpkeep}石、秋の収穫見込 ${estateBudget(s,c).harvest}石。`;
    } else if (action.type === 'reward') {
      const gain = 15 + Math.floor(power / 7);
      t.loyalty[target.id] = clamp(t.loyalty[target.id] + gain, 0, 100);
      message = `${delegate.name}が${target.name}に恩賞を伝達。忠誠は ${t.loyalty[target.id]} です。`;
    } else if (action.type === 'negotiation') {
      const gain = 14 + Math.floor(power / 5);
      s.relations[targetClan] = clamp((s.relations[targetClan] || 0) + gain, -100, 100);
      const clanName = owned(s, targetClan)[0].clanName;
      if (s.relations[targetClan] >= 75) { s.alliances.push(targetClan); s.allianceExpires[targetClan] = s.turn + (monthly(s)?12:4); s.prestige = clamp(s.prestige + 5, 0, 100); }
      message = `${delegate.name}が${clanName}と交渉。友好 ${s.relations[targetClan]}。${s.alliances.includes(targetClan) ? '四季の同盟が成立しました。' : '友好75以上で同盟が成立します。'}`;
    } else if (action.type === 'infiltrate') {
      const tc = getCastle(s, target.castleId), loyal = t.loyalty[target.id], exhausted = tc && (tc.morale < 50 || tc.troops < mobilizationLimit(tc) * 0.4);
      const chance = clamp(20 + power * 0.48 - target.intelligence * 0.23 + (100 - loyal) * 0.4 + (exhausted ? 17 : 0), 8, 88);
      if (roll < chance) {
        const reduction = 15 + Math.floor(power / 7); t.loyalty[target.id] = Math.max(0, loyal - reduction);
        if (t.loyalty[target.id] <= 35 && (tc?.morale < 65 || !tc)) {
          const home = owned(s)[0]; changeEmployer(s, target, s.playerClan, home.id);
          message = `${delegate.name}の内応工作が成功。${target.name}が自家に寝返り、${home.name}に出仕しました。`;
        } else {
          if (tc) { tc.morale = clamp(tc.morale - 7, 10, 100); tc.defense = clamp(tc.defense - 3, 0, 100); }
          message = `${delegate.name}の工作が浸透。${target.name}の忠誠 ${t.loyalty[target.id]}。守備側の士気と防備も低下しました。`;
        }
      } else { outcome = 'failure'; s.relations[target.clan] = clamp((s.relations[target.clan] || 0) - 12, -100, 100); message = `${delegate.name}の工作が${target.name}に見破られました。費用と命令を消費し、相手との友好が低下しました。`; }
    } else if (action.type === 'enlist') {
      const chance = clamp(25 + power * 0.55 - t.loyalty[target.id] * 0.4 + s.prestige * 0.18 + (!owned(s, target.clan).length ? 18 : 0), 12, 90);
      if (roll < chance) {
        const home = owned(s)[0]; changeEmployer(s, target, s.playerClan, home.id);
        message = `${delegate.name}が捕虜を説得。${target.name}を召し抱え、${home.name}に配属しました。`;
      } else { outcome = 'failure'; t.loyalty[target.id] = Math.max(0, t.loyalty[target.id] - 12); message = `${target.name}は旧主への忠義を守り、仕官を断りました。説得を続ければ心が揺らぐことがあります。`; }
    } else if (action.type === 'release') {
      const home = owned(s, target.clan)[0];
      target.status = home ? 'active' : 'ronin'; target.capturedBy = null; target.castleId = home?.id || null;
      s.relations[target.clan] = clamp((s.relations[target.clan] || 0) + 20, -100, 100); s.prestige = clamp(s.prestige + 2, 0, 100);
      message = `${delegate.name}が${target.name}を解放。${home ? `${home.name}へ帰還しました。旧主との友好 +20。` : '旧主が領地を失っているため浪人となりました。'}`;
    } else if (action.type === 'execute') {
      recordDeath(s, target, 'execution');
      t.casualties.unshift({ officerId: target.id, name: target.name, cause: 'execution', date: date(s), turn: s.turn });
      s.relations[target.clan] = -100; s.prestige = Math.max(0, s.prestige - 5);
      for (const o of s.officers.filter(o => o.clan === s.playerClan && o.status === 'active')) t.loyalty[o.id] = Math.max(0, t.loyalty[o.id] - 3);
      message = `${target.name}を処断しました。相手の家との友好は -100、威信 -5。家臣の忠誠も低下しました。`;
    }
    s.gold -= rule.gold; s.food -= rule.food; if(!postVictory)s.actionPoints--;
    // The magistrates are an administrative body, not a generated officer or
    // war commander. They can cover remaining orders at their lower abilities.
    if (!administrative) t.assignments[delegate.id] = { turn: s.turn, type: action.type, outcome, target: target?.id || c?.id || targetClan };
    if (['enlist','release','execute'].includes(action.type)) {
      t.prisonerDecisions ||= [];
      const capture = t.casualties.find(entry=>entry.officerId===target.id&&entry.cause==='captured');
      t.prisonerDecisions.unshift({ officerId:target.id, name:target.name,
        battleId:capture?.battleId || s.lastBattle?.officerOutcomes?.find(entry=>entry.officerId===target.id&&entry.outcome==='captured')&&s.lastBattle.id || null,
        type:action.type, outcome, turn:s.turn, year:s.year, season:s.season, message });
      t.prisonerDecisions = t.prisonerDecisions.slice(0, 1000);
    }
    append(s, ['negotiation', 'release'].includes(action.type) ? 'diplomacy' : action.type === 'levy' ? 'military' : 'domestic', rule.label, message);
    return { ok: true, state: s, message };
  }
  function commerceIncome(c, estate, t) {
    const projects=estate?.projects||[];
    const stages=Math.max(0,(estate?.commerce||0)-(projects.some(p=>p.type==='commercial')?0.7:0));
    return Math.round(stages * (90 + c.kokudaka * 0.0012) * (c.coastal ? 1.25 : 1) * (t.marketReform ? 1.15 : 1)
      * (1 - (estate?.devastation || 0) / 200) * (1 - (estate?.unrest || 0) / 150));
  }
  function eventConditions(s, e) {
    if (e.clans?.some(clan => !owned(s, clan).length)) return false;
    if (e.officers?.some(id => { const o = getOfficer(s, id); return !alive(o) || !active(s, o) || (e.clans && !e.clans.includes(o.clan)); })) return false;
    if (e.province && !s.castles.some(c => c.province === e.province && c.clan === (e.clans?.[0] || s.playerClan))) return false;
    return true;
  }
  function applyEvent(s, e) {
    const t = s.tenka;
    if (!eventConditions(s, e)) return '史実と異なる生存・所属・領土のため、年代記のみ掲載。人物や支配関係は変更しません。';
    if (e.effect === 'markets') { t.marketReform = true; return '楽市の知見が普及。整備済みの市の追加収入が15%上昇。'; }
    if (e.effect === 'drill') {
      t.firearmDoctrine = Math.max(1, t.firearmDoctrine);
      let count = 0;
      for (const o of s.officers) if (active(s, o) && o.aptitudes?.firearm < 5) { o.aptitudes.firearm++; count++; }
      return `鉄砲運用の知見が広まり、活動中の武将 ${count} 人の鉄砲適性が1上昇。`;
    }
    if (e.effect === 'friendship') {
      const [a, b] = e.clans;
      if (s.playerClan === a || s.playerClan === b) {
        const other = s.playerClan === a ? b : a; s.relations[other] = clamp((s.relations[other] || 0) + 20, -100, 100);
        return '清洲同盟に関わる両家の友好が20上昇。同盟の成立には使者を送ってください。';
      }
    }
    if (e.effect === 'rivalry') {
      if (e.clans.includes(s.playerClan)) {
        const other = e.clans.find(c => c !== s.playerClan); s.relations[other] = clamp((s.relations[other] || 0) - 15, -100, 100);
        return '北信濃を巡る緊張で当事家との友好が15低下。';
      }
    }
    if (e.effect === 'prestige' && s.playerClan === 'oda') { s.prestige = clamp(s.prestige + 10, 0, 100); return '山城の支配を背景に織田家の威信が10上昇。'; }
    if (e.effect === 'fortification') {
      for (const c of s.castles.filter(c => c.province === '近江' && c.clan === 'oda')) c.defense = clamp(c.defense + 6, 0, 100);
      return '近江の織田領で築城技術が向上。該当城の防御 +6。後世の天守を全城へ自動建設することはありません。';
    }
    if (e.effect === 'unrest') {
      const akechi = getOfficer(s, 'akechi_mitsuhide');
      if (active(s, akechi) && akechi.clan === 'oda') {
        t.loyalty[akechi.id] = Math.max(0, t.loyalty[akechi.id] - 18);
        return '明智光秀の忠誠が18低下。恩賞や配置で不満に対処できます。信長の死は強制しません。';
      }
    }
    return '史実の出来事を年代記へ追加。現在の人物と領地の行方はプレイヤーの采配と合戦に従います。';
  }
  function advance(input, previousState) {
    const s = initialize(input), t = s.tenka;
    if (s.gameOver || t.lastAdvancedTurn === s.turn) return s;
    t.lastAdvancedTurn = s.turn;
    const economicallySettled=t.economy.lastSettledTurn===s.turn;
    if(!economicallySettled) {t.turnReports=[];progressEstates(s);}
    let commerce = 0;
    for (const c of s.castles) {
      const estate = t.estates[c.id], income = Math.round(commerceIncome(c, estate, t)*periodMonths(s)/3);
      if(!economicallySettled) {if (c.clan === s.playerClan) commerce += income; else c.gold += income;}
      estate.devastation = Math.max(0, estate.devastation - 2*periodMonths(s));
    }
    s.gold += commerce;
    if (commerce) t.turnReports.push(`商業・港の追加収入 金 ${commerce} 貫。基本の年貢・秋の収穫・軍維持費は領国収支に計上済みです。`);
    for (const o of s.officers) {
      if (!active(s, o)) continue;
      const c = getCastle(s, o.castleId), shortage = o.clan === s.playerClan ? s.food < 1000 : c?.food < 500;
      const change = shortage ? -7 : c?.morale < 45 ? -4 : 1;
      t.loyalty[o.id] = clamp(t.loyalty[o.id] + change, 0, 100);
    }
    for (const c of owned(s)) {
      const weak = c.troops < mobilizationLimit(c) * 0.45 || c.morale < 50 || s.food < 1000;
      if (!weak) continue;
      const enemy = (c.neighbors || []).map(id => getCastle(s, id)).filter(n => n && n.clan !== s.playerClan && !s.alliances.includes(n.clan)).sort((a, b) => b.troops - a.troops)[0];
      if (!enemy) continue;
      const mark = hash(`infiltration:${s.turn}:${c.id}`) % 100;
      if (mark >= 44) continue;
      const target = s.officers.filter(o => o.clan === s.playerClan && active(s, o) && o.castleId === c.id).sort((a, b) => t.loyalty[a.id] - t.loyalty[b.id])[0];
      if (!target) continue;
      const enemyAgent = s.officers.filter(o => o.clan === enemy.clan && active(s, o)).sort((a, b) => b.intelligence - a.intelligence)[0];
      const loss = 7 + Math.floor((enemyAgent?.intelligence || 45) / 12);
      t.loyalty[target.id] = Math.max(0, t.loyalty[target.id] - loss); c.morale = clamp(c.morale - 5, 10, 100);
      if (t.loyalty[target.id] <= 25 && mark < 22) {
        changeEmployer(s, target, enemy.clan, enemy.id);
        t.turnReports.push(`${enemy.clanName}の調略で${target.name}が離反。${enemy.name}へ出奔しました。疲弊と忠誠低下が原因です。`);
      } else t.turnReports.push(`${enemy.clanName}が疲弊した${c.name}へ調略。${target.name}の忠誠 -${loss}、城の士気 -5。`);
    }
    for (const e of EVENTS) {
      if (t.events.includes(e.id) || eventPoint(e) > point(s)) continue;
      const isCurrent = eventPoint(e) === point(s);
      const result = isCurrent ? applyEvent(s, e) : '過去の出来事を年表に補完。過去の効果を遡って適用しません。';
      t.events.push(e.id);
      t.chronicle.push({ ...e, status: isCurrent ? 'occurred' : 'past', date: `${e.year}年 ${SEASONS[e.season]}`, result });
      if (isCurrent) append(s, 'history', e.title, `${e.text} ${result}`);
    }
    if (t.turnReports.length) append(s, 'domestic', '領国・家臣団からの報告', t.turnReports.join(' '));
    return s;
  }
  function campaignFood(troops, mode = 'field') {
    return 600 + Math.round(Math.max(0, troops) * 0.12 * (mode === 'siege' ? 2 : 1));
  }
  function consume(s, clan, castle, amount, label) {
    const holder = clan === s.playerClan ? s : castle;
    if (!holder) return;
    const deficit = Math.max(0, amount - holder.food);
    holder.food = Math.max(0, holder.food - amount);
    if (deficit && castle) { castle.morale = Math.max(10, castle.morale - 8); loseTroops(s, castle, Math.round(castle.troops * 0.015)); }
    if (clan === s.playerClan) append(s, 'military', '合戦の兵站', `${label}の追加兵糧 ${amount} 石を消費。${deficit ? `不足 ${deficit} 石により士気と兵数が低下しました。` : '出陣の基本兵糧600石は合戦処理時に計上済みです。'}`);
  }
  function afterBattle(input, previousState) {
    const s = initialize(input), t = s.tenka;
    const captures = t.pendingCaptures, usedCaptures = new Set();
    const previousIds = new Set([previousState?.lastBattle, ...(previousState?.aiBattles || [])].filter(Boolean).map(b => b.id));
    const battles = [...(s.aiBattles || []), s.lastBattle].filter(Boolean);
    const unique = new Map(battles.map(b => [b.id, b]));
    for (const b of unique.values()) {
      if (!b.id || t.processedBattles.includes(b.id) || previousIds.has(b.id)) continue;
      t.processedBattles.push(b.id);
      const captureIndex = b.won && b.mode === 'siege' ? captures.findIndex((event,index) =>
        !usedCaptures.has(index) && event.turn === s.turn && event.targetId === b.targetId
          && event.defenderClan === b.defenderClan && event.winnerClan === b.attackerClan) : -1;
      const capture = captureIndex < 0 ? null : captures[captureIndex];
      if (capture) usedCaptures.add(captureIndex);
      const captureBefore = new Map((capture?.before || []).map(o => [o.id,o]));
      const captureAfter = new Map((capture?.after || []).map(o => [o.id,o]));
      const source = getCastle(s, b.sourceId), target = getCastle(s, b.targetId);
      const attackerTroops = b.attackerArmy?.troops || 0, defenderTroops = b.defenderArmy?.troops || 0;
      if (b.tacticsVersion === 1) {
        // Tactical settlement already debits both sides' elapsed, soldier-scaled use.
        // Its supplyConsumed describes the player's side, including during defense.
        if (b.attackerClan === s.playerClan || b.defenderClan === s.playerClan) {
          append(s, 'military', '合戦の兵站', `${b.defending ? '籠城軍' : '出陣軍'}の実戦兵糧 ${Math.max(0, Math.round(b.supplyConsumed || 0))} 石を合戦精算で消費。${b.defending ? '守備側のため出陣の基本兵糧は不要です。' : '出陣の基本兵糧600石は別途計上済みです。'}`);
        }
      } else {
        consume(s, b.attackerClan, source, campaignFood(attackerTroops, b.mode) - 600, `${b.attacker || source?.name || '出陣軍'}・${attackerTroops}人の${b.mode === 'siege' ? '攻城' : '野戦'}`);
        consume(s, b.defenderClan, target?.clan === b.defenderClan ? target : owned(s, b.defenderClan)[0], Math.round(defenderTroops * 0.08 * (b.mode === 'siege' ? 2 : 1)), `${b.defender || '守備軍'}・${defenderTroops}人の防衛`);
      }
      if (target) {
        const before=estateBudget(s,target).harvest;
        t.estates[target.id].devastation = clamp(t.estates[target.id].devastation + (b.mode === 'siege' ? 18 : 9), 0, 100);
        t.estates[target.id].laborDisruption=clamp(t.estates[target.id].laborDisruption+12,0,100);
        estateEvent(s,target,'war-damage','戦禍による田畑の荒廃',`軍勢の通行と戦闘で農作業が滞り、秋の収穫見込が${Math.max(0,before-estateBudget(s,target).harvest)}石減少。開墾・救済と平穏な月日の経過で回復します。`,{battleId:b.id});
      }
      if (source) {
        t.estates[source.id].devastation = clamp(t.estates[source.id].devastation + 4, 0, 100);
        t.estates[source.id].laborDisruption=clamp(t.estates[source.id].laborDisruption+6,0,100);
      }
      const winner = b.won ? b.attackerClan : b.defenderClan;
      const loser = b.won ? b.defenderClan : b.attackerClan;
      const commander = b.won ? b.defenderArmy?.commanderId : b.attackerArmy?.commanderId;
      const defeated = getOfficer(s, commander), oldOfficer = previousState && getOfficer(previousState, commander);
      const killedHere = new Set(), capturedHere = new Set();
      const foughtLater = capture && captures.some((event,index) => index > captureIndex
        && event.turn === s.turn && event.before?.some(o => o.id === commander));
      if (defeated && !['dead','captive'].includes(defeated.status) && defeated.clan === loser
          && !foughtLater && (!oldOfficer || oldOfficer.status === 'active') && (b.won ? defenderTroops : attackerTroops) > 0) {
        const ratio = b.won ? b.enemyCasualties / Math.max(1, defenderTroops) : b.casualties / Math.max(1, attackerTroops);
        const roll = hash(`fate:${b.id}:${defeated.id}`) % 10000;
        const fatalRisk = ratio >= 0.75 ? 100 : ratio >= 0.5 ? 50 : 0;
        const captureRisk = ratio >= 0.3 ? (b.mode === 'siege' ? 800 : 500) : 0;
        if (roll < fatalRisk) { recordDeath(s, defeated, 'battle'); killedHere.add(defeated.id); }
        else if (roll < fatalRisk + captureRisk) {
          Object.assign(defeated, {status:'captive',castleId:null,capturedBy:winner});
          capturedHere.add(defeated.id);
          clearCommand(s, defeated.id); delete t.assignments[defeated.id];
        }
      }
      const participants = new Map();
      const before = previousState || s;
      const addParticipant = (id, side) => {
        const person = side === 'defender' && captureBefore.has(id) ? captureBefore.get(id) : getOfficer(before, id) || getOfficer(s, id);
        if (!person || ['dead','unborn','captive','ronin'].includes(person.status)) return;
        if (person.status!=='active' && getOfficer(s,id)?.status!=='captive') return;
        participants.set(person.id, {person,side});
      };
      addParticipant(b.attackerArmy?.commanderId, 'attacker');
      addParticipant(b.defenderArmy?.commanderId, 'defender');
      for (const person of before.officers || []) {
        if (person.castleId===b.sourceId && person.clan===b.attackerClan) addParticipant(person.id,'attacker');
        if (!capture && person.castleId===b.targetId && person.clan===b.defenderClan) addParticipant(person.id,'defender');
      }
      for (const person of captureBefore.values()) addParticipant(person.id,'defender');
      for (const entry of b.deployedCommanders || []) {
        const id = typeof entry==='string' ? entry : entry.officerId || entry.commanderId || entry.id;
        const person = getOfficer(before,id);
        if (person) addParticipant(id, entry.side || (person.clan===b.attackerClan?'attacker':'defender'));
      }
      b.year=s.year; b.season=s.season; b.turn=s.turn;
      b.officerOutcomes = [...participants.values()].map(({person,side})=>{
        const current = getOfficer(s,person.id), clan = side==='attacker'?b.attackerClan:b.defenderClan;
        const otherCapture = capture ? null : captures.find(event => event.after?.some(o => o.id===person.id && o.status==='captive'));
        const atBattle = capturedHere.has(person.id) ? current : side==='defender' && captureAfter.get(person.id)
          || otherCapture?.before.find(o => o.id===person.id) || current;
        let outcome = clan===loser?'retreated':'survived';
        if (killedHere.has(person.id)) outcome='killed';
        else if (atBattle?.status==='dead') outcome='unrecorded';
        else if (atBattle?.status==='captive' && atBattle.capturedBy!==person.capturedBy) outcome='captured';
        const entry={officerId:person.id,name:person.name,clan,side,outcome,capturedBy:outcome==='captured'?atBattle.capturedBy:null};
        if (outcome==='killed'||outcome==='captured') {
          const cause=outcome==='killed'?'killed':'captured';
          if (!t.casualties.some(c=>c.officerId===person.id&&c.battleId===b.id&&c.cause===cause)) {
            t.casualties.unshift({officerId:person.id,name:person.name,cause,turn:s.turn,date:date(s),battleId:b.id,capturedBy:entry.capturedBy});
            append(s,'battle',cause==='killed'?'武将、討死':'武将を捕縛',`${person.name}が${b.defender || target?.name || '戦場'}で${cause==='killed'?'討死しました。':'捕らえられました。戦後の処遇から召し抱え・解放・処断を選べます。'}`);
          }
        }
        return entry;
      });
      for (const duplicate of battles) if(duplicate!==b&&duplicate.id===b.id) {
        duplicate.officerOutcomes=clone(b.officerOutcomes);
        duplicate.year=b.year; duplicate.season=b.season; duplicate.turn=b.turn;
      }

    }
    t.pendingCaptures = captures.filter((event,index) => !usedCaptures.has(index) && event.turn === s.turn);
    t.processedBattles = t.processedBattles.slice(-2000); t.casualties = t.casualties.slice(0, 500);
    return s;
  }
  function getView(input) {
    const s = initialize(input), t = s.tenka;
    const availability = officerAvailability(s);
    const economy=economyForecast(s);
    return {
      availability, administrationFallback: administrationFallback(s, availability),
      officers: s.officers.filter(o => o.clan === s.playerClan && o.status === 'active' && adult(s, o)).map(o => ({ ...o, loyalty: t.loyalty[o.id], busy: t.assignments[o.id]?.turn === s.turn, available: isOfficerAvailable(s, o), assignment: t.assignments[o.id] || null })),
      enemies: s.officers.filter(o => o.clan !== s.playerClan && active(s, o)).map(o => ({ ...o, loyalty: t.loyalty[o.id] })),
      castles: s.castles.map(c => {
        const estate=t.estates[c.id],forecast=economy.castles.find(item=>item.castleId===c.id);
        return { ...c, capacity: mobilizationLimit(c), agriculture: estate.reclaimed, commerce: estate.commerce,
          order: 100 - estate.devastation, income: forecast.commerceIncome,
          economy:{taxPolicy:estate.taxPolicy,taxLabel:TAX_POLICIES.find(p=>p.id===estate.taxPolicy).label,unrest:estate.unrest,
            publicOrder:Math.round(100-estate.unrest),waterControl:Math.round(estate.waterControl),devastation:Math.round(estate.devastation),cropDamage:Math.round(estate.cropDamage),
            famine:Math.round(estate.famine),epidemic:Math.round(estate.epidemic),uprising:clone(estate.uprising),
            risks:Object.fromEntries(Object.entries(climateRisks(s,c,estate)).map(([kind,chance])=>[kind,Math.round(chance*1000)/10])),
            events:clone(t.disasters.filter(e=>e.castleId===c.id).slice(0,12)),
            laborEfficiency:forecast.laborEfficiency,laborAvailable:forecast.laborAvailable,workforce:forecast.workforce,
            developmentCapacity:developmentCapacity(c,estate),reclaimed:estate.reclaimed,projects:clone(estate.projects),
            forecast,costs:{reclaim:developmentCost(s,c,'reclaim'),commercial:developmentCost(s,c,'commercial')},lastLedger:estate.lastLedger||null}};
      }),
      prisoners: s.officers.filter(o => o.status === 'captive' && o.capturedBy === s.playerClan).map(o => ({ ...o, loyalty: t.loyalty[o.id] })),
      casualties: t.casualties,
      chronicle: t.chronicle.map(e => ({ ...e, kind: e.status === 'past' ? 'past' : 'history', source: SOURCES.find(source => source.id === e.source) })).sort((a, b) => b.year - a.year || b.season - a.season),
      upcomingEvents: EVENTS.filter(e => !t.events.includes(e.id)).slice(0, 3),
      relations: Object.entries(s.relations || {}).map(([clan, value]) => ({ clan, clanName: owned(s, clan)[0]?.clanName || clan, value, allied: s.alliances.includes(clan), expires: s.allianceExpires[clan] || null, castles: owned(s, clan).length })),
      reports: t.turnReports, actions: ACTIONS, economy,regionalEvents:clone(t.disasters),
      totals: { commerce: economy.totals.commerceIncome, capacity: owned(s).reduce((n, c) => n + mobilizationLimit(c), 0) }
    };
  }
  function chooseClan(input, clanId) {
    if (input.turn !== 1 || input.actionPoints !== 3 || (input.aiRound || 0) > 0 || Object.values(input.tenka?.assignments || {}).length) return { ok: false, state: input, message: '勢力の選択は開始直後のみ行えます。' };
    const s = initialize(input), castles = owned(s, clanId);
    if (!castles.length || !s.officers.some(o => o.clan === clanId && active(s, o))) return { ok: false, state: input, message: '活動中の武将と領地がある勢力を選んでください。' };
    s.playerClan = clanId; s.selectedCastleId = [...castles].sort((a, b) => b.kokudaka - a.kokudaka)[0].id;
    s.gold = Math.max(1800, Math.min(10000, Math.round(castles.reduce((n, c) => n + c.kokudaka, 0) * 0.035)));
    s.food = Math.max(12000, Math.round(castles.reduce((n, c) => n + c.kokudaka, 0) * 0.24));
    s.alliances = []; s.allianceExpires = {}; s.relations = {};
    for (const other of new Set(s.castles.map(c => c.clan))) if (other !== clanId) s.relations[other] = 0;
    for (const pair of s.npcPacts || []) if (pair.includes(clanId)) {
      const other = pair.find(c => c !== clanId);
      if (other) { s.alliances.push(other); s.allianceExpires[other] = s.turn + (monthly(s)?12:4); s.relations[other] = 75; }
    }
    append(s, 'scenario', '天下への旗を掲げる', `${castles[0].clanName}の領国経営を開始。家臣に命令を託し、内政・外交・合戦で天下統一を目指します。`);
    return { ok: true, state: s, message: `${castles[0].clanName}で開始しました。` };
  }
  return { version: '2.0.0', initialize, act, advance, afterBattle, recordCapture, getView, chooseClan, mobilizationLimit, campaignFood,
    isOfficerAvailable, economyForecast, settleEconomy, DOMESTIC_ACTIONS, TAX_POLICIES, ACTIONS, EVENTS, SOURCES };
});
