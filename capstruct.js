// capstruct.js: the finance math for the AGE capital structure app.
// Plain functions only. Nothing here touches the page, so every function
// can be checked with Node, for example:
//   node -e "const C=require('./capstruct.js'); console.log(C.roundHalfUp(0.14025*100,2))"

(function (root) {
  'use strict';

  // ---------- Reading CSV text ----------

  // Splits one CSV line, allowing "quoted, fields".
  function splitCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // Turns CSV text into an array of objects keyed by the header row.
  function parseCSV(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
    const header = splitCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCSVLine(line);
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
      return row;
    });
  }

  // A blank cell becomes null, anything else a number.
  function num(s) {
    if (s === null || s === undefined || String(s).trim() === '') return null;
    const v = Number(s);
    if (!Number.isFinite(v)) throw new Error('Not a number: "' + s + '"');
    return v;
  }

  // Turns item,value rows into { item: number }. Works for cdss.csv
  // (section,item,value), assumptions.csv and example_firms.csv.
  function itemMap(rows, keyCol) {
    const m = {};
    rows.forEach(r => { m[r[keyCol || 'item']] = num(r.value); });
    return m;
  }

  // ---------- Rounding and display ----------

  // Round half up on the decimal value. toFixed rounds the binary value,
  // so 14.025 would show as 14.02; toPrecision(12) clears that noise first.
  function roundHalfUp(x, d) {
    const f = Math.pow(10, d);
    const scaled = Number((x * f).toPrecision(12));
    // Half up = away from zero for negatives as well.
    return Math.sign(scaled) * Math.round(Math.abs(scaled)) / f;
  }

  function withCommas(x, d) {
    const r = roundHalfUp(x, d);
    return r.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtDollars(x) {            // nearest dollar
    if (x === null || x === undefined) return 'n/a';
    const r = roundHalfUp(x, 0);
    return (r < 0 ? '−$' : '$') + withCommas(Math.abs(r), 0);
  }
  function fmtCents(x) {              // prices, EPS, dividends
    if (x === null || x === undefined) return 'n/a';
    const r = roundHalfUp(x, 2);
    return (r < 0 ? '−$' : '$') + withCommas(Math.abs(r), 2);
  }
  function fmtPct(x) {                // rates as percents, two decimals
    if (x === null || x === undefined) return 'n/a';
    return withCommas(x * 100, 2) + '%';
  }
  function fmtMultiple(x) {           // TIE, CV, other multiples
    if (x === null || x === undefined) return 'n/a';
    return withCommas(x, 2) + '×';
  }
  function fmtNumber(x, d) {          // share counts (2 decimals), probabilities
    if (x === null || x === undefined) return 'n/a';
    return withCommas(x, d);
  }

  // ---------- Statistics ----------

  // Probability-weighted mean, standard deviation and CV.
  // values: array of numbers (or null); probs: matching probabilities.
  function stats(values, probs) {
    if (values.some(v => v === null || v === undefined)) {
      return { expected: null, sd: null, cv: null };
    }
    const expected = values.reduce((s, v, i) => s + probs[i] * v, 0);
    const variance = values.reduce((s, v, i) => s + probs[i] * Math.pow(v - expected, 2), 0);
    const sd = Math.sqrt(variance);
    return { expected, sd, cv: expected === 0 ? null : sd / expected };
  }

  // ---------- Firm U and Firm L (question c) ----------

  // One firm's partial income statements and ratios.
  // scenarios: [{ probability, sales, operating_costs }]
  function exampleFirm({ totalAssets, debt, interestRate, taxRate, scenarios }) {
    const equity = totalAssets - debt;
    const interest = interestRate * debt;
    const years = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const ebt = ebit - interest;
      const taxes = taxRate * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        assets: totalAssets,
        equity,
        sales: s.sales,
        operatingCosts: s.operating_costs,
        ebit,
        interest,
        ebt,
        taxes,
        netIncome,
        roe: equity > 0 ? netIncome / equity : null,     // no book equity: n/a
        tie: interest > 0 ? ebit / interest : null   // no interest: n/a
      };
    });
    const probs = years.map(y => y.probability);
    const roe = stats(years.map(y => y.roe), probs);
    const tie = stats(years.map(y => y.tie), probs);
    return { debt, equity, interest, years, roe, tie };
  }

  // Debt amounts for the Firm L slider: 0, step, 2×step, … up to max.
  function sliderValues(max, step) {
    const out = [];
    for (let i = 0; i * step <= max + 1e-9; i++) out.push(roundHalfUp(i * step, 6));
    return out;
  }

  // ---------- CDSS ----------

  // Management's stake after a buyback. Management doesn't sell, so its
  // shares stay at mgmtShare × n. If the buyback takes every outside share,
  // the stake is 100%; if it would take more, management would have to sell.
  function managementStake(mgmtShare, n, repurchased) {
    const outside = (1 - mgmtShare) * n;
    const remaining = n - repurchased;
    const tol = 1e-9 * n;
    if (repurchased > outside + tol) return { stake: null, status: 'must_sell' };
    if (Math.abs(repurchased - outside) <= tol) return { stake: 1, status: 'none_left' };
    return { stake: (mgmtShare * n) / remaining, status: 'ok' };
  }

  // Where a button should send the CDSS slider, given the debt each
  // buyback method picks: same amount → go there; different → the case
  // method's amount, flagged so the page can name both.
  function buttonTarget(caseDebt, newDebt) {
    if (caseDebt === null && newDebt === null) return { debt: null, agree: true };
    if (caseDebt === null) return { debt: newDebt, agree: false };
    return { debt: caseDebt, agree: caseDebt === newDebt };
  }

  // EBIT = sales × (1 − variable cost rate) − fixed costs.
  function cdssEBIT(cdss) {
    return cdss.sales * (1 - cdss.variable_cost_rate) - cdss.fixed_costs;
  }

  // Everything at one amount of borrowing, under both buyback methods.
  // cdss: map from cdss.csv; row: { debt, cost_of_debt, cost_of_equity }; T: tax rate.
  function cdssAtDebt(cdss, row, T) {
    const D = row.debt;
    const rd = row.cost_of_debt;          // null at $0
    const rs = row.cost_of_equity;
    const n = cdss.shares_outstanding;
    const P0 = cdss.share_price;
    const A = cdss.total_assets;

    const ebit = cdssEBIT(cdss);
    const interest = D > 0 ? rd * D : 0;
    const netIncome = (ebit - interest) * (1 - T);
    const tie = interest > 0 ? ebit / interest : null;   // n/a with no debt
    const afterTaxRd = D > 0 ? rd * (1 - T) : 0;

    // Case method (d(3), d(4)): buy back at today's price P0.
    const caseRepurchased = D / P0;
    const caseRemaining = n - caseRepurchased;
    const caseEPS = netIncome / caseRemaining;
    const casePrice = caseEPS / rs;
    const waccBook = (D / A) * afterTaxRd + ((A - D) / A) * rs;
    const caseMethod = {
      repurchased: caseRepurchased,
      remaining: caseRemaining,
      eps: caseEPS,
      dps: caseEPS,                      // all earnings paid out
      price: casePrice,
      wacc: waccBook,
      management: managementStake(cdss.management_share, n, caseRepurchased),
      valid: caseRemaining > 0
    };

    // New-price method: buy back at the price after the announcement.
    const S = netIncome / rs;
    const V = S + D;
    const P = V / n;
    const npRepurchased = D / P;
    const npRemaining = n - npRepurchased;
    const npEPS = netIncome / npRemaining;
    const waccMarket = (D / V) * afterTaxRd + (S / V) * rs;
    const newPrice = {
      equityValue: S,
      firmValue: V,
      repurchased: npRepurchased,
      remaining: npRemaining,
      eps: npEPS,
      dps: npEPS,
      price: P,
      wacc: waccMarket,
      management: managementStake(cdss.management_share, n, npRepurchased),
      // Checks from CLAUDE.md: EPS = r_s × P and WACC = EBIT(1 − T) / V.
      epsCheck: Math.abs(npEPS - rs * P) < 1e-9 * Math.max(1, Math.abs(npEPS)),
      waccCheck: Math.abs(waccMarket - ebit * (1 - T) / V) < 1e-12
    };

    return { debt: D, rd, rs, ebit, interest, netIncome, tie, caseMethod, newPrice };
  }

  // Indexes of the best value; ties go to the smaller amount of debt
  // (rows are in schedule order, so the first one found wins).
  function argBest(rows, getter, better) {
    let best = -1;
    rows.forEach((r, i) => {
      const v = getter(r);
      if (v === null || !Number.isFinite(v)) return;
      if (best === -1 || better(v, getter(rows[best]))) best = i;
    });
    return best;
  }

  // The whole schedule plus the summary and the $0 check.
  function cdssSchedule(cdss, schedule, T) {
    const rows = schedule
      .slice()
      .sort((a, b) => a.debt - b.debt)
      .map(r => cdssAtDebt(cdss, r, T));
    const higher = (a, b) => roundHalfUp(a, 10) > roundHalfUp(b, 10);
    const lower = (a, b) => roundHalfUp(a, 12) < roundHalfUp(b, 12);
    const usable = r => r.caseMethod.valid;
    const pick = (get, better) => {
      const i = argBest(rows, r => (usable(r) ? get(r) : null), better);
      return i === -1 ? null : rows[i].debt;
    };
    const summary = {
      bestPriceCase: pick(r => r.caseMethod.price, higher),
      bestPriceNew: pick(r => r.newPrice.price, higher),
      lowestWaccBook: pick(r => r.caseMethod.wacc, lower),
      lowestWaccMarket: pick(r => r.newPrice.wacc, lower),
      highestEpsCase: pick(r => r.caseMethod.eps, higher),
      highestEpsNew: pick(r => r.newPrice.eps, higher)
    };
    const s = summary;
    summary.allAgree =
      s.bestPriceCase === s.bestPriceNew &&
      s.bestPriceNew === s.lowestWaccBook &&
      s.lowestWaccBook === s.lowestWaccMarket;

    // EPS / r_s at $0 debt should equal today's price in cdss.csv.
    const zero = rows.find(r => r.debt === 0);
    const zeroCheck = zero
      ? {
          found: true,
          implied: zero.caseMethod.price,
          stated: cdss.share_price,
          ok: Math.abs(zero.caseMethod.price - cdss.share_price) < 0.005
        }
      : { found: false, ok: false };

    return { ebit: cdssEBIT(cdss), rows, summary, zeroCheck };
  }

  const api = {
    parseCSV, num, itemMap, roundHalfUp,
    fmtDollars, fmtCents, fmtPct, fmtMultiple, fmtNumber,
    stats, exampleFirm, sliderValues, managementStake, buttonTarget, cdssEBIT, cdssAtDebt, cdssSchedule
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof window !== 'undefined' ? window : this);
