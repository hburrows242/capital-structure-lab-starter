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
    return out;
  }

  // ---------- Lever: CDSS's debt ----------

  function stakeText(m) {
    if (m.status === 'must_sell') return '<span class="warn-inline">Management would have to sell</span>';
    if (m.status === 'none_left') return C.fmtPct(m.stake) + '<span class="small">no outside shareholders left</span>';
    return C.fmtPct(m.stake);
  }

  function setupCDSSLever(d, out) {
    const rows = out.rows;
    const slider = $('cdss-slider');
    slider.max = rows.length - 1;          // one stop per banker amount
    $('cdss-ticks').innerHTML = rows.map(r =>
      '<span>' + (r.debt >= 1e6 ? '$' + C.fmtNumber(r.debt / 1e6, 0) + 'M' : '$' + C.fmtNumber(r.debt / 1e3, 0) + 'k') + '</span>').join('');

    const s = out.summary;
    const priceTarget = C.buttonTarget(s.bestPriceCase, s.bestPriceNew);
    const epsTarget = C.buttonTarget(s.highestEpsCase, s.highestEpsNew);
    const f = v => (v === null ? 'none' : C.fmtDollars(v));

    // Note under the slider: are the best-price and highest-EPS levels the same?
    const notes = [];
    if (!priceTarget.agree) notes.push('Best price differs by method: ' + f(s.bestPriceCase) +
      ' with the $20 buyback, ' + f(s.bestPriceNew) + ' at the new price. The button goes to the case method\'s amount.');
    if (!epsTarget.agree) notes.push('Highest EPS differs by method: ' + f(s.highestEpsCase) +
      ' with the $20 buyback, ' + f(s.highestEpsNew) + ' at the new price. The button goes to the case method\'s amount.');
    notes.push(priceTarget.debt === epsTarget.debt
      ? 'The best-price level and the highest-EPS level are the same: ' + f(priceTarget.debt) + '.'
      : 'The best-price level (' + f(priceTarget.debt) + ') and the highest-EPS level (' +
        f(epsTarget.debt) + ') are not the same.');
    $('cdss-button-note').textContent = notes.join(' ');

    function show() {
      const r = rows[Number(slider.value)];
      const c = r.caseMethod, n = r.newPrice;
      $('cdss-debt-out').textContent = C.fmtDollars(r.debt);
      $('cdss-rate-out').textContent = r.rd === null
        ? '· no debt, so no interest rate · cost of equity ' + C.fmtPct(r.rs)
        : '· interest rate ' + C.fmtPct(r.rd) + ' · cost of equity ' + C.fmtPct(r.rs);
      slider.setAttribute('aria-valuetext', C.fmtDollars(r.debt));

      const line = (label, a, b) => '<tr><td>' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
      $('cdss-lever-table').innerHTML =
        '<table class="lever-table"><thead><tr><th></th>' +
        '<th>Buyback at ' + C.fmtCents(d.cdss.share_price) + ' (case)</th><th>Buyback at new price</th></tr></thead><tbody>' +
        line('Share price', C.fmtCents(c.price), C.fmtCents(n.price)) +
        line('Shares repurchased', C.fmtNumber(c.repurchased, 2), C.fmtNumber(n.repurchased, 2)) +
        line('Shares remaining', C.fmtNumber(c.remaining, 2), C.fmtNumber(n.remaining, 2)) +
        line('EPS', C.fmtCents(c.eps), C.fmtCents(n.eps)) +
        line('Dividends per share', C.fmtCents(c.dps), C.fmtCents(n.dps)) +
        line('TIE', C.fmtMultiple(r.tie), C.fmtMultiple(r.tie)) +
        line('WACC', C.fmtPct(c.wacc) + '<span class="small">book weights</span>',
          C.fmtPct(n.wacc) + '<span class="small">market weights</span>') +
        line('Management\'s share', stakeText(c.management), stakeText(n.management)) +
        '</tbody></table>';
      $('cdss-lever-foot').textContent =
        'Net income ' + C.fmtDollars(r.netIncome) + ' at either method. All earnings are paid out, so dividends per share = EPS. ' +
        'Management owns ' + C.fmtPct(d.cdss.management_share) + ' today and sells none of its shares.';
    }

    const goTo = debt => {
      const i = rows.findIndex(r => r.debt === debt);
      if (i === -1) return;
      slider.value = i;
      slider.dispatchEvent(new Event('input'));   // same path as dragging
    };
    slider.addEventListener('input', show);
    $('btn-best-price').addEventListener('click', () => goTo(priceTarget.debt));
    $('btn-highest-eps').addEventListener('click', () => goTo(epsTarget.debt));
    show();
  }

  // ---------- Lever: Firm L's debt ----------

  function setupFirmLever(d) {
    const ex = d.example;
    const values = C.sliderValues(ex.slider_max, ex.slider_step);
    const slider = $('firm-slider');
    slider.max = values.length - 1;
    slider.step = 1;
    const base = { totalAssets: ex.total_assets, interestRate: ex.interest_rate, taxRate: d.taxRate, scenarios: d.scenarios };
    const u = C.exampleFirm(Object.assign({}, base, { debt: 0 }));
    const kinds = ['bad', 'average', 'good'];
    const yearName = i => (d.scenarios.length === 3 ? kinds[i] : 'outcome ' + (i + 1));

    $('firm-lever-note').textContent =
      'The interest rate is held at ' + C.fmtPct(ex.interest_rate) + ' at every amount of debt, so the slider shows what debt ' +
      'does to Firm L\'s return and risk, not how lenders would respond. Both firms have ' + C.fmtDollars(ex.total_assets) +
      ' of assets; Firm L\'s book equity = assets − debt.';

    function show() {
      const debt = values[Number(slider.value)];
      const l = C.exampleFirm(Object.assign({}, base, { debt }));
      $('firm-debt-out').textContent = C.fmtDollars(debt) + ' (equity ' + C.fmtDollars(l.equity) + ')';
      slider.setAttribute('aria-valuetext', C.fmtDollars(debt));
      const line = (label, a, b, cls) =>
        '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + '</td><td>' + a + '</td><td>' + b + '</td></tr>';
      let body = '';
      u.years.forEach((yu, i) => {
        body += line('ROE, ' + yearName(i) + ' year<span class="small">prob. ' + C.fmtNumber(yu.probability, 2) +
          ', EBIT ' + C.fmtDollars(yu.ebit) + '</span>', C.fmtPct(yu.roe), C.fmtPct(l.years[i].roe));
      });
      u.years.forEach((yu, i) => {
        body += line('TIE, ' + yearName(i) + ' year', C.fmtMultiple(yu.tie), C.fmtMultiple(l.years[i].tie));
      });
      body += line('Expected ROE', C.fmtPct(u.roe.expected), C.fmtPct(l.roe.expected), 'stat') +
        line('σ(ROE)', C.fmtPct(u.roe.sd), C.fmtPct(l.roe.sd), 'stat') +
        line('CV of ROE', C.fmtMultiple(u.roe.cv), C.fmtMultiple(l.roe.cv), 'stat') +
        line('Expected TIE', C.fmtMultiple(u.tie.expected), C.fmtMultiple(l.tie.expected), 'stat') +
        line('σ(TIE)', C.fmtMultiple(u.tie.sd), C.fmtMultiple(l.tie.sd), 'stat');
      $('firm-lever-table').innerHTML = '<table class="lever-table"><thead><tr><th></th><th>Firm U</th><th>Firm L</th></tr></thead><tbody>' +
        body + '</tbody></table>';
    }

    slider.addEventListener('input', show);
    $('btn-case').addEventListener('click', () => {
      const i = values.indexOf(ex.firm_l_debt);
      if (i === -1) return;
      slider.value = i;
      slider.dispatchEvent(new Event('input'));
    });
    // Start at the case's $10,000 (or 0 if it isn't a slider stop).
    slider.value = Math.max(0, values.indexOf(ex.firm_l_debt));
    show();
  }

  // Register the service worker (sw.js) so the app installs and works offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered:', err));
    });
  }

  loadData()
    .then(d => {
      renderExample(d);
      const out = renderCDSS(d);
      setupCDSSLever(d, out);
      setupFirmLever(d);
    })
    .catch(err => {
      const el = $('load-error');
      el.hidden = false;
      el.textContent = 'The app could not read its data files: ' + err.message +
        '. If you opened index.html straight from your computer, the browser blocks the files; it works once the site is published.';
      console.error(err);
    });
})();
