/* app.js - UI wiring. All processing is local; no network calls. Uses textContent only (no HTML injection). */
(function () {
  'use strict';
  var R = window.Reconcile;
  var state = { rec: null, recMap: null, dep: null, depMap: null, last: null };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function mappingSelects(container, headers, map, roles, onChange) {
    clear(container);
    roles.forEach(function (role) {
      var sel = el('select', { id: container.id + '_' + role, 'data-role': role });
      sel.appendChild(el('option', { value: '', text: '(none)' }));
      headers.forEach(function (h) {
        var o = el('option', { value: h, text: h });
        if (map[role] === h) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () { map[role] = sel.value || null; onChange(); });
      container.appendChild(el('div', null, [el('label', { 'for': sel.id, text: R.ROLE_LABELS[role] + ' column' }), sel]));
    });
  }

  function loadRecords(text, name) {
    var p = R.parseCSV(text);
    state.rec = p; state.recMap = R.guessColumns(p.headers);
    $('recInfo').textContent = (name || 'file') + ': ' + p.rows.length + ' data rows, ' + p.headers.length +
      ' columns. Check the column matches below (we guessed from the header names).';
    mappingSelects($('recMap'), p.headers, state.recMap, R.ROLES, run);
  }
  function loadDeposits(text, name) {
    var p = R.parseCSV(text);
    state.dep = p; state.depMap = R.guessDepositColumns(p.headers);
    $('depInfo').textContent = (name || 'file') + ': ' + p.rows.length + ' deposit rows.';
    mappingSelects($('depMap'), p.headers, state.depMap, ['date', 'amount'], run);
  }

  function addFigureRow(label, compareTo, cents) {
    var wrap = el('div', { className: 'row fig' });
    var lab = el('input', { type: 'text', value: label || 'Form amount', 'aria-label': 'Form amount label' });
    var sel = el('select', { 'aria-label': 'Compare with' });
    ['gross', 'tips', 'fees', 'payout'].forEach(function (r) {
      var o = el('option', { value: r, text: 'your ' + R.ROLE_LABELS[r] + ' total' });
      if (r === (compareTo || 'gross')) o.selected = true;
      sel.appendChild(o);
    });
    var amt = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'e.g. 1,549.00', 'aria-label': 'Amount on form',
      value: typeof cents === 'number' ? (cents / 100).toFixed(2) : '' });
    var rm = el('button', { type: 'button', className: 'secondary', text: 'Remove' });
    rm.addEventListener('click', function () { wrap.parentNode.removeChild(wrap); run(); });
    wrap.appendChild(el('div', null, [el('label', { text: 'Label' }), lab]));
    wrap.appendChild(el('div', null, [el('label', { text: 'Compare with' }), sel]));
    wrap.appendChild(el('div', null, [el('label', { text: 'Amount on form ($)' }), amt]));
    wrap.appendChild(el('div', { style: 'flex:0 0 auto' }, [rm]));
    [lab, sel, amt].forEach(function (x) { x.addEventListener('change', run); });
    $('formRows').appendChild(wrap);
  }

  function readFigures() {
    var out = [], bad = [];
    Array.prototype.forEach.call(document.querySelectorAll('#formRows .fig'), function (row) {
      var inputs = row.querySelectorAll('input'), sel = row.querySelector('select');
      var raw = inputs[1].value;
      if (raw.trim() === '') return;
      var p = R.parseAmount(raw);
      if (!p.ok) { bad.push(inputs[0].value + ': "' + raw + '"'); return; }
      out.push({ label: inputs[0].value || 'Form amount', compareTo: sel.value, cents: p.cents });
    });
    return { figures: out, bad: bad };
  }

  function run() {
    var body = $('reportBody');
    if (!state.rec) return;
    var tolP = R.parseAmount($('tol').value);
    var figs = readFigures();
    var recSum = R.summarizeRecords(state.rec, state.recMap);
    var depSum = state.dep && state.depMap.amount ? R.summarizeDeposits(state.dep, state.depMap) : null;
    var res = R.reconcile({ records: recSum, deposits: depSum, formFigures: figs.figures,
      toleranceCents: tolP.ok ? tolP.cents : 1 });
    state.last = res;
    render(res, figs.bad);
    $('report').classList.remove('hidden');
  }

  function render(r, badFigs) {
    var body = $('reportBody'); clear(body);
    if (badFigs && badFigs.length) body.appendChild(el('p', { className: 'error', text: 'Could not read form amount(s): ' + badFigs.join('; ') }));
    if (r.errors.length) { r.errors.forEach(function (e) { body.appendChild(el('p', { className: 'error', text: e })); }); return; }
    body.appendChild(el('p', { className: 'muted', text: 'Rows read: ' + r.rowCount + ' (used in totals: ' + r.usedRows + '). Tolerance: ' + R.fmt(r.toleranceCents) + '.' }));

    var tot = el('table', { id: 'totalsTable' }, [el('thead', null, [el('tr', null, [el('th', { text: 'Your records' }), el('th', { className: 'num', text: 'Total' })])])]);
    var tb = el('tbody');
    r.mapped.forEach(function (k) { tb.appendChild(el('tr', null, [el('td', { text: R.ROLE_LABELS[k] }), el('td', { className: 'num', text: R.fmt(r.totals[k]) })])); });
    tot.appendChild(tb); body.appendChild(tot);

    body.appendChild(el('h2', { text: 'Form amounts vs your records', style: 'margin-top:16px' }));
    var ct = el('table', { id: 'cmpTable' }, [el('thead', null, [el('tr', null, [
      el('th', { text: 'Status' }), el('th', { text: 'Form amount' }), el('th', { className: 'num', text: 'On form' }),
      el('th', { className: 'num', text: 'Your records' }), el('th', { className: 'num', text: 'Difference' }), el('th', { text: 'What we see' })])])]);
    var cb = el('tbody');
    if (!r.comparisons.length) cb.appendChild(el('tr', null, [el('td', { colspan: '6', className: 'muted', text: 'No form amounts entered yet.' })]));
    r.comparisons.forEach(function (c) {
      cb.appendChild(el('tr', null, [
        el('td', null, [el('span', { className: 'badge ' + c.status, text: c.status === 'NO_COLUMN' ? 'NOT COMPARED' : c.status })]),
        el('td', { text: c.label + ' (vs ' + R.ROLE_LABELS[c.compareTo] + ')' }),
        el('td', { className: 'num', text: R.fmt(c.formCents) }),
        el('td', { className: 'num', text: c.recordsCents === null ? '-' : R.fmt(c.recordsCents) }),
        el('td', { className: 'num', text: c.deltaCents === null ? '-' : R.fmt(c.deltaCents) }),
        el('td', { text: c.note })]));
    });
    ct.appendChild(cb); body.appendChild(ct);

    if (r.deposits) body.appendChild(el('p', null, [el('span', { className: 'badge ' + r.deposits.status, text: r.deposits.status }),
      ' Deposits: records payout ' + R.fmt(r.deposits.recordsPayoutCents) + ' vs deposits file ' + R.fmt(r.deposits.depositsCents) +
      ' (difference ' + R.fmt(r.deposits.deltaCents) + ')']));

    body.appendChild(el('h2', { text: 'Things to check', style: 'margin-top:16px' }));
    var ul = el('ul', { className: 'flags', id: 'flags' });
    if (!r.flags.length) ul.appendChild(el('li', { text: 'Nothing flagged.' }));
    r.flags.forEach(function (f) { ul.appendChild(el('li', { text: f.text })); });
    body.appendChild(ul);

    if (r.monthly.length) {
      body.appendChild(el('h2', { text: 'By month', style: 'margin-top:16px' }));
      var hasDep = r.monthly[0].deposits !== undefined;
      var head = [el('th', { text: 'Month' }), el('th', { className: 'num', text: 'Rows' })];
      r.mapped.forEach(function (k) { head.push(el('th', { className: 'num', text: R.ROLE_LABELS[k] })); });
      if (hasDep) { head.push(el('th', { className: 'num', text: 'Deposits' })); head.push(el('th', { text: 'Status' })); }
      var mt = el('table', { id: 'monthTable' }, [el('thead', null, [el('tr', null, head)])]);
      var mb = el('tbody');
      r.monthly.forEach(function (m) {
        var cells = [el('td', { text: m.month }), el('td', { className: 'num', text: String(m.rows) })];
        r.mapped.forEach(function (k) { cells.push(el('td', { className: 'num', text: R.fmt(m[k]) })); });
        if (hasDep) { cells.push(el('td', { className: 'num', text: R.fmt(m.deposits) })); cells.push(el('td', null, [el('span', { className: 'badge ' + m.status, text: m.status })])); }
        mb.appendChild(el('tr', null, cells));
      });
      mt.appendChild(mb); body.appendChild(mt);
    }
  }

  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = el('a', { href: url, download: name }); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 0);
  }

  function wireDrop(dropId, fileId, loader) {
    var drop = $(dropId), input = $(fileId);
    function readFile(f) { var fr = new FileReader(); fr.onload = function () { loader(String(fr.result), f.name); run(); }; fr.readAsText(f); }
    drop.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { if (input.files[0]) readFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });
  }

  function loadSample() {
    var S = window.SAMPLE_DATA;
    loadRecords(S.records, 'SAMPLE_platform_export.csv (synthetic)');
    loadDeposits(S.deposits, 'SAMPLE_bank_deposits.csv (synthetic)');
    clear($('formRows'));
    S.form.forEach(function (f) { addFigureRow(f.label, f.compareTo, f.cents); });
    $('sampleBanner').classList.remove('hidden');
    run();
  }

  wireDrop('recDrop', 'recFile', loadRecords);
  wireDrop('depDrop', 'depFile', loadDeposits);
  $('addFig').addEventListener('click', function () { addFigureRow(); });
  $('runBtn').addEventListener('click', function () {
    if (!state.rec) { $('recInfo').textContent = 'Load your records CSV first (step 1).'; return; }
    run();
  });
  $('tol').addEventListener('change', run);
  $('sampleBtn').addEventListener('click', loadSample);
  $('dlTxt').addEventListener('click', function () { if (state.last) download('reconcile-report.txt', R.reportText(state.last), 'text/plain'); });
  $('dlCsv').addEventListener('click', function () { if (state.last) download('reconcile-report.csv', R.reportCSV(state.last), 'text/csv'); });
  addFigureRow('1099 amount', 'gross');
  if (location.hash === '#demo') loadSample();
  document.documentElement.setAttribute('data-ready', '1');
})();
