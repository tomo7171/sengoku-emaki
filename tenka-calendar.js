/* 天下布武: a campaign turn is one month, with save-safe quarterly migration. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TenkaCalendar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SEASONS = ['春', '夏', '秋', '冬'];
  const START_MONTHS = [3, 6, 9, 12];
  const clone = value => JSON.parse(JSON.stringify(value));
  const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  const monthly = state => integer(state?.month, 1, 12);
  const season = month => month >= 3 && month <= 5 ? 0 : month >= 6 && month <= 8 ? 1 : month >= 9 && month <= 11 ? 2 : 3;
  const inferredMonth = state => monthly(state) ? state.month : START_MONTHS[integer(state?.season, 0, 3) ? state.season : 0];
  const point = state => state.year * 12 + inferredMonth(state) - 1;
  const period = state => monthly(state) ? 12 : 4;

  function get(state) {
    const month = inferredMonth(state);
    return { year: state.year, month, season: season(month), turn: state.turn };
  }
  function date(state) {
    const current = get(state);
    return `${current.year}年${current.month}月（${SEASONS[current.season]}）`;
  }
  function nextDate(state) {
    const current = get(state), month = current.month % 12 + 1;
    return { year: current.year + (month === 1 ? 1 : 0), month, season: season(month), turn: current.turn + 1 };
  }
  function validLegacy(state) {
    return integer(state?.year, 1560, 1900) && integer(state.season, 0, 3) && integer(state.turn, 1, 1364)
      && state.year === 1560 + Math.floor((state.turn - 1) / 4) && state.season === (state.turn - 1) % 4;
  }
  function validDate(state) {
    if (!state || typeof state !== 'object') return false;
    if (state.month === undefined) return state.tenka?.calendar == null && validLegacy(state);
    if (!monthly(state) || !integer(state.year, 1560, 1900) || !integer(state.turn, 1, 4092) || state.season !== season(state.month)) return false;
    const anchor = state.tenka?.calendar;
    if (!anchor || anchor.version !== 1 || !integer(anchor.baseTurn, 1, state.turn)
      || !integer(anchor.baseYear, 1560, state.year) || !integer(anchor.baseMonth, 1, 12)) return false;
    return point(state) === anchor.baseYear * 12 + anchor.baseMonth - 1 + state.turn - anchor.baseTurn;
  }
  function migrate(input) {
    const state = clone(input);
    if (!state || typeof state !== 'object') return state;
    const legacy = state.month === undefined;
    // Never turn an invalid date into a plausible new campaign date.
    if (legacy && !validLegacy(state) || !legacy && !monthly(state)) return state;
    if (legacy) state.month = START_MONTHS[state.season];
    state.tenka ||= {};
    if (!state.tenka || typeof state.tenka !== 'object' || Array.isArray(state.tenka)) return state;
    if (state.tenka.calendar === undefined) {
      state.tenka.calendar = { version: 1, baseTurn: state.turn, baseYear: state.year, baseMonth: state.month };
      // One old turn was three months. Keep the remaining diplomatic duration,
      // but do not change the current turn, assignments or spent castle orders.
      if (legacy && state.allianceExpires && typeof state.allianceExpires === 'object') {
        for (const [id, expiry] of Object.entries(state.allianceExpires)) {
          if (Number.isSafeInteger(expiry) && expiry > state.turn) state.allianceExpires[id] = state.turn + (expiry - state.turn) * 3;
        }
      }
    }
    return state;
  }
  function advance(input) {
    const state = migrate(input);
    Object.assign(state, nextDate(state));
    return state;
  }
  return { version: 1, seasons: SEASONS.slice(), startMonths: START_MONTHS.slice(), monthly, season, get, point, period, date, format: date, nextDate, validDate, migrate, initialize: migrate, advance };
});
