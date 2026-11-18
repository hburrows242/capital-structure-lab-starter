// app.js: reads the CSV files in data/ and draws the page.
// All the finance math lives in capstruct.js (window.CapStruct).

(function () {
  'use strict';
  const C = window.CapStruct;
  const $ = id => document.getElementById(id);

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not read ' + path + ' (' + res.status + ')');
    return C.parseCSV(await res.text());
  }

  async function loadData() {
    const [cdssRows, assumptions, schedule, example, scenarios] = await Promise.all([
      loadCSV('data/cdss.csv'),
      loadCSV('data/assumptions.csv'),
      loadCSV('data/banker_schedule.csv'),
      loadCSV('data/example_firms.csv'),
      loadCSV('data/ebit_scenarios.csv')
    ]);
    return {
      cdss: C.itemMap(cdssRows),
      taxRate: C.itemMap(assumptions, 'assumption').tax_rate,
      schedule: schedule.map(r => ({
        debt: C.num(r.debt),
        cost_of_debt: C.num(r.cost_of_debt),
        cost_of_equity: C.num(r.cost_of_equity)
      })),
      example: C.itemMap(example),
      scenarios: scenarios.map(r => ({
        probability: C.num(r.probability),
        sales: C.num(r.sales),
        operating_costs: C.num(r.operating_costs)
      }))
    };
  }

  // ---------- Firm U and Firm L ----------

  const paren = x => (x === 0 ? '(0)' : '(' + C.fmtDollars(x).replace('$', '') + ')');

  function firmTable(title, firm, taxRate) {
    const y = firm.years;
    const row = (label, fn, cls) =>
      '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td>' +
      y.map(fn).join('') + '</tr>';
    const cell = v => '<td>' + v + '</td>';
    // Summary rows: one value, shown in the middle (expected) column like the case.
    const statRow = (label, v) =>
      '<tr class="stat"><td>' + label + '</td><td></td><td>' + v + '</td><td></td></tr>';

    return '<h3>' + title + '</h3>' +
      '<table><thead><tr><th></th>' + y.map(v => '<th>EBIT ' + C.fmtDollars(v.ebit) + '</th>').join('') +'</tr></thead><tbody>' +
      row('Assets', v => cell(C.fmtDollars(v.assets))) +
      row('Equity', v => cell(C.fmtDollars(v.equity))) +
      row('Probability', v => cell(C.fmtNumber(v.probability, 2))) +
      row('Sales', v => cell(C.fmtDollars(v.sales))) +
      row('Oper. costs', v => cell(paren(v.operatingCosts))) +
      row('EBIT', v => cell(C.fmtDollars(v.ebit))) +
      row('Interest', v => cell(paren(v.interest))) +
      row('EBT', v => cell(C.fmtDollars(v.ebt))) +
      row('Taxes (' + C.fmtPct(taxRate).replace('.00', '') + ')', v => cell(paren(v.taxes))) +
      row('Net income', v => cell(C.fmtDollars(v.netIncome))) +
      row('ROE', v => cell(C.fmtPct(v.roe))) +
      row('TIE', v => cell(C.fmtMultiple(v.tie))) +
      statRow('E(ROE)', C.fmtPct(firm.roe.expected)) +
      statRow('σ(ROE)', C.fmtPct(firm.roe.sd)) +
      statRow('CV(ROE)', C.fmtMultiple(firm.roe.cv)) +
      statRow('E(TIE)', C.fmtMultiple(firm.tie.expected)) +
      statRow('σ(TIE)', C.fmtMultiple(firm.tie.sd)) +
      '</tbody></table>';
  }

  function renderExample(d) {
    const ex = d.example;
    const base = { totalAssets: ex.total_assets, interestRate: ex.interest_rate, taxRate: d.taxRate, scenarios: d.scenarios };
    const u = C.exampleFirm(Object.assign({}, base, { debt: 0 }));
    const l = C.exampleFirm(Object.assign({}, base, { debt: ex.firm_l_debt }));
    $('example-note').textContent =
      'Both firms have ' + C.fmtDollars(ex.total_assets) + ' of assets and a ' + C.fmtPct(d.taxRate) +
      ' tax rate. Firm L borrows ' + C.fmtDollars(ex.firm_l_debt) + ' at ' + C.fmtPct(ex.interest_rate) +
      '. Columns are the three EBIT outcomes. Firm U has no interest, so its TIE is n/a.';
    $('firm-u').innerHTML = firmTable('Firm U (no debt)', u, d.taxRate);
    $('firm-l').innerHTML = firmTable('Firm L (' + C.fmtDollars(ex.firm_l_debt) + ' of debt)', l, d.taxRate);
  }

  // ---------- CDSS ----------

  function cdssTable(columns, rows, bestDebt) {
    const head = '<thead><tr>' + columns.map(c => '<th>' + c.label + '</th>').join('') + '</tr></thead>';
    const body = rows.map(r =>
      '<tr' + (r.debt === bestDebt ? ' class="best"' : '') + '>' +
      columns.map(c => '<td data-label="' + c.label.replace(/<sub>(.*?)<\/sub>/g, '_$1') + '">' + c.value(r) + '</td>').join('') +
      '</tr>').join('');
    return '<table class="cards">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function renderCDSS(d) {
    const out = C.cdssSchedule(d.cdss, d.schedule, d.taxRate);
    const s = out.summary;
    const cd = d.cdss;

    $('p0').textContent = C.fmtCents(cd.share_price);
    $('cdss-note').textContent =
      'EBIT = ' + C.fmtDollars(cd.sales) + ' × (1 − ' + C.fmtPct(cd.variable_cost_rate) + ') − ' +
      C.fmtDollars(cd.fixed_costs) + ' = ' + C.fmtDollars(out.ebit) +
      ', the same at every amount of debt. Tax rate ' + C.fmtPct(d.taxRate) + '. ' +
      C.fmtNumber(cd.shares_outstanding, 0) + ' shares at ' + C.fmtCents(cd.share_price) +
      ' today; book assets ' + C.fmtDollars(cd.total_assets) +
      '. CDSS pays out all earnings, so dividends per share = EPS and g = 0. ' +
      'The highlighted row has the highest share price under that method.';

    const zc = out.zeroCheck;
    const zEl = $('zero-check');
    if (zc.ok) {
      zEl.className = 'note ok';
      zEl.textContent = '✓ Check: EPS / r_s at $0 of debt = ' + C.fmtCents(zc.implied) +
        ', which matches today\'s price in cdss.csv.';
    } else {
      zEl.className = 'warning';
      zEl.textContent = zc.found
        ? 'Warning: EPS / r_s at $0 of debt is ' + C.fmtCents(zc.implied) + ', but cdss.csv says the price is ' +
          C.fmtCents(zc.stated) + '. The banker\'s cost of equity at $0 does not fit today\'s price.'
        : 'Warning: the banker\'s schedule has no $0 row, so today\'s price cannot be checked.';
    }

    const debtCol = { label: 'Debt', value: r => C.fmtDollars(r.debt) };
    const rdCol = { label: 'r<sub>d</sub>', value: r => (r.rd === null ? '—' : C.fmtPct(r.rd)) };
    const rsCol = { label: 'r<sub>s</sub>', value: r => C.fmtPct(r.rs) };
    const tieCol = { label: 'TIE', value: r => C.fmtMultiple(r.tie) };
    const niCol = { label: 'Net income', value: r => C.fmtDollars(r.netIncome) };

    $('case-table').innerHTML = cdssTable([
      debtCol, rdCol, rsCol, niCol,
      { label: 'Shares repurchased', value: r => C.fmtNumber(r.caseMethod.repurchased, 2) },
      { label: 'Shares remaining', value: r => C.fmtNumber(r.caseMethod.remaining, 2) },
      { label: 'EPS = DPS', value: r => C.fmtCents(r.caseMethod.eps) },
      tieCol,
      { label: 'Share price', value: r => C.fmtCents(r.caseMethod.price) },
      { label: 'WACC (book)', value: r => C.fmtPct(r.caseMethod.wacc) }
    ], out.rows, s.bestPriceCase);

    $('new-table').innerHTML = cdssTable([
      debtCol, rdCol, rsCol, niCol,
      { label: 'Equity value S', value: r => C.fmtDollars(r.newPrice.equityValue) },
      { label: 'Firm value V', value: r => C.fmtDollars(r.newPrice.firmValue) },
      { label: 'Share price', value: r => C.fmtCents(r.newPrice.price) },
      { label: 'Shares repurchased', value: r => C.fmtNumber(r.newPrice.repurchased, 2) },
      { label: 'Shares remaining', value: r => C.fmtNumber(r.newPrice.remaining, 2) },
      { label: 'EPS = DPS', value: r => C.fmtCents(r.newPrice.eps) },
      tieCol,
      { label: 'WACC (market)', value: r => C.fmtPct(r.newPrice.wacc) }
    ], out.rows, s.bestPriceNew);

    const checksOk = out.rows.every(r => r.newPrice.epsCheck && r.newPrice.waccCheck);
    $('new-checks').innerHTML = checksOk
      ? '<span class="ok">✓ Checks pass at every amount: EPS = r<sub>s</sub> × P, and WACC = EBIT(1 − T) / V.</span>'
      : '<span class="warning">Warning: a new-price check failed (EPS = r_s × P or WACC = EBIT(1 − T) / V).</span>';

    const f = v => (v === null ? 'none' : C.fmtDollars(v));
    const items = [
      'Highest share price, case method ($20 buyback): <strong>' + f(s.bestPriceCase) + '</strong>',
      'Highest share price, new-price method: <strong>' + f(s.bestPriceNew) + '</strong>',
      'Lowest WACC, book weights: <strong>' + f(s.lowestWaccBook) + '</strong>',
      'Lowest WACC, market weights: <strong>' + f(s.lowestWaccMarket) + '</strong>',
      'Highest EPS: <strong>' + f(s.highestEpsCase) + '</strong> (case method), <strong>' +
        f(s.highestEpsNew) + '</strong> (new-price method)'
    ];
    items.push(s.allAgree
      ? 'All four price and WACC measures point to the same amount of debt.'
      : '<span class="warning">The price and WACC measures do not all agree, so the app does not pick one.</span>');
    $('summary').innerHTML = items.map(t => '<li>' + t + '</li>').join('');
  }

  loadData()
    .then(d => { renderExample(d); renderCDSS(d); })
    .catch(err => {
      const el = $('load-error');
      el.hidden = false;
      el.textContent = 'The app could not read its data files: ' + err.message +
        '. If you opened index.html straight from your computer, the browser blocks the files; it works once the site is published.';
      console.error(err);
    });
})();
