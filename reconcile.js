/*
 * reconcile.js - core logic for the Payout vs 1099 Reconciler.
 * Pure arithmetic on numbers the user provides. NOT TAX ADVICE.
 * Zero dependencies. Works in the browser (window.Reconcile) and in Node (require).
 * All money is handled as integer cents to avoid floating-point drift.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reconcile = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DISCLAIMER =
    'NOT TAX ADVICE. This report only adds up and compares numbers you provided. ' +
    'It does not say which figure to report or file, whether any amount is taxed, ' +
    'or what you owe. For those questions, ask a qualified tax professional.';

  var ROLES = ['date', 'id', 'gross', 'tips', 'fees', 'payout'];
  var ROLE_LABELS = {
    date: 'Date', id: 'Order / trip ID', gross: 'Gross', tips: 'Tips',
    fees: 'Fees', payout: 'Payout (net)', amount: 'Deposit amount'
  };

  // ---------- CSV ----------
  function parseCSV(text) {
    if (typeof text !== 'string') text = String(text || '');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    var rows = [], row = [], field = '', i = 0, inQ = false, n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // drop fully blank lines
    rows = rows.filter(function (r) { return r.some(function (f) { return f.trim() !== ''; }); });
    // leading comment lines (e.g. "# SAMPLE DATA") before the header are skipped
    var comments = [];
    while (rows.length && /^\s*#/.test(rows[0][0])) comments.push(rows.shift().join(','));
    if (!rows.length) return { headers: [], rows: [], comments: comments };
    var headers = rows[0].map(function (h) { return h.trim(); });
    var body = rows.slice(1).map(function (r, idx) {
      var o = { __line: idx + 2 + comments.length, __raw: r };
      headers.forEach(function (h, j) { o[h] = r[j] !== undefined ? r[j] : ''; });
      return o;
    });
    return { headers: headers, rows: body, comments: comments };
  }

  // ---------- amounts & dates ----------
  // Returns {ok, cents, empty}. Never silently turns junk into 0.
  function parseAmount(s) {
    if (s === null || s === undefined) return { ok: true, cents: 0, empty: true };
    var t = String(s).trim();
    if (t === '' || t === '-' || t === '—') return { ok: true, cents: 0, empty: true };
    var neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
    t = t.replace(/^(USD|US\$)\s*/i, '').replace(/\s*(USD)$/i, '');
    if (t[0] === '-') { neg = !neg; t = t.slice(1).trim(); }
    else if (t[0] === '+') { t = t.slice(1).trim(); }
    t = t.replace(/^\$/, '').trim();
    if (t[0] === '-') { neg = !neg; t = t.slice(1).trim(); }
    t = t.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return { ok: false, cents: 0, empty: false };
    var parts = t.split('.');
    var whole = parts[0] ? parseInt(parts[0], 10) : 0;
    var frac = parts[1] || '';
    var cents = whole * 100;
    if (frac.length) {
      var f3 = (frac + '000').slice(0, 3);
      var c2 = parseInt(f3.slice(0, 2), 10);
      if (parseInt(f3[2], 10) >= 5) c2 += 1; // round half up on 3rd decimal
      cents += c2;
    }
    return { ok: true, cents: neg ? -cents : cents, empty: false };
  }

  // Returns 'YYYY-MM' or null. Accepts YYYY-MM-DD[...], YYYY/MM/DD, M/D/YYYY, M/D/YY.
  function monthKey(s) {
    if (!s) return null;
    var t = String(s).trim(), m;
    if ((m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(t))) return pad(m[1], m[2]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(t))) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      return pad(y, m[1]);
    }
    return null;
    function pad(y, mo) {
      var mi = parseInt(mo, 10);
      if (mi < 1 || mi > 12) return null;
      return y + '-' + (mi < 10 ? '0' : '') + mi;
    }
  }

  function fmt(cents) {
    var neg = cents < 0, a = Math.abs(cents);
    var d = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var c = (a % 100 < 10 ? '0' : '') + (a % 100);
    return (neg ? '-$' : '$') + d + '.' + c;
  }

  // ---------- column guessing ----------
  function guessColumns(headers) {
    var map = { date: null, id: null, gross: null, tips: null, fees: null, payout: null };
    var used = {};
    function pick(role, re, avoid) {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i];
        if (used[h]) continue;
        if (re.test(h) && !(avoid && avoid.test(h))) { map[role] = h; used[h] = true; return; }
      }
    }
    pick('tips', /\btips?\b|gratuit/i);
    pick('fees', /\bfees?\b|commission|service charge/i);
    pick('payout', /payout|\bnet\b|deposit|paid out|take.?home|proceeds/i);
    pick('gross', /gross/i);
    pick('gross', /total|earning|sales|revenue|fare|amount|income/i, /tax/i);
    pick('date', /date|\bday\b|period|time/i);
    pick('id', /\bid\b|order|trip|transaction|ref/i);
    return map;
  }

  function guessDepositColumns(headers) {
    var map = { date: null, amount: null };
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i];
      if (!map.date && /date|day|posted/i.test(h)) map.date = h;
      else if (!map.amount && /amount|deposit|credit|value/i.test(h)) map.amount = h;
    }
    return map;
  }

  // ---------- summarize records ----------
  function summarizeRecords(parsed, mapping) {
    var totals = { gross: 0, tips: 0, fees: 0, payout: 0 };
    var badCells = [], months = {}, missingDates = [], seenRaw = {}, seenId = {}, dups = [];
    var money = ['gross', 'tips', 'fees', 'payout'].filter(function (r) { return mapping[r]; });
    var usedRows = 0;
    parsed.rows.forEach(function (row) {
      var rowVals = {}, rowBad = false;
      money.forEach(function (role) {
        var p = parseAmount(row[mapping[role]]);
        if (!p.ok) { badCells.push({ line: row.__line, column: mapping[role], value: String(row[mapping[role]]) }); rowBad = true; }
        rowVals[role] = p.ok ? p.cents : 0;
      });
      // A row with any unreadable money cell is excluded entirely (listed, never guessed).
      if (rowBad) return;
      usedRows++;
      money.forEach(function (role) { totals[role] += rowVals[role]; });
      var key = row.__raw.map(function (f) { return f.trim(); }).join('\u0001');
      if (seenRaw[key]) dups.push({ line: row.__line, sameAs: seenRaw[key], reason: 'identical row' });
      else {
        seenRaw[key] = row.__line;
        if (mapping.id) {
          var idv = String(row[mapping.id] || '').trim();
          if (idv) {
            if (seenId[idv]) dups.push({ line: row.__line, sameAs: seenId[idv], reason: 'same ID "' + idv + '"' });
            else seenId[idv] = row.__line;
          }
        }
      }
      if (mapping.date) {
        var mk = monthKey(row[mapping.date]);
        if (!mk) missingDates.push({ line: row.__line, value: String(row[mapping.date] || '') });
        else {
          if (!months[mk]) months[mk] = { gross: 0, tips: 0, fees: 0, payout: 0, rows: 0 };
          money.forEach(function (role) { months[mk][role] += rowVals[role]; });
          months[mk].rows++;
        }
      }
    });
    return {
      rowCount: parsed.rows.length, usedRows: usedRows, mapped: money.slice(),
      totals: totals, badCells: badCells, duplicates: dups, missingDates: missingDates, months: months
    };
  }

  function summarizeDeposits(parsed, mapping) {
    var total = 0, badCells = [], months = {}, used = 0;
    parsed.rows.forEach(function (row) {
      var p = parseAmount(row[mapping.amount]);
      if (!p.ok) { badCells.push({ line: row.__line, column: mapping.amount, value: String(row[mapping.amount]) }); return; }
      used++; total += p.cents;
      var mk = mapping.date ? monthKey(row[mapping.date]) : null;
      if (mk) months[mk] = (months[mk] || 0) + p.cents;
    });
    return { rowCount: parsed.rows.length, usedRows: used, total: total, badCells: badCells, months: months };
  }

  // ---------- reconcile ----------
  // formFigures: [{label, compareTo: 'gross'|'tips'|'fees'|'payout', cents}]
  function reconcile(opts) {
    var rec = opts.records, dep = opts.deposits || null;
    var tol = typeof opts.toleranceCents === 'number' ? Math.abs(opts.toleranceCents) : 1;
    var errors = [];
    if (!rec) errors.push('No records file loaded.');
    else if (rec.rowCount === 0) errors.push('The records file has a header but no data rows.');
    else if (!rec.mapped.length) errors.push('No money column is mapped. Pick at least the Gross column.');
    if (errors.length) return { errors: errors, comparisons: [], flags: [], toleranceCents: tol };

    var t = rec.totals, comparisons = [], flags = [];
    var candidates = [];
    if (rec.mapped.indexOf('tips') >= 0) candidates.push({ name: 'your tips total', cents: t.tips });
    if (rec.mapped.indexOf('fees') >= 0) candidates.push({ name: 'your fees total', cents: t.fees });
    if (rec.mapped.indexOf('tips') >= 0 && rec.mapped.indexOf('fees') >= 0)
      candidates.push({ name: 'your tips + fees total', cents: t.tips + t.fees });
    if (rec.mapped.indexOf('gross') >= 0 && rec.mapped.indexOf('payout') >= 0)
      candidates.push({ name: 'your gross minus payout', cents: t.gross - t.payout });

    (opts.formFigures || []).forEach(function (f) {
      if (f == null || typeof f.cents !== 'number') return;
      var role = f.compareTo || 'gross';
      if (rec.mapped.indexOf(role) < 0) {
        comparisons.push({ label: f.label, compareTo: role, formCents: f.cents, recordsCents: null,
          deltaCents: null, status: 'NO_COLUMN',
          note: 'No ' + ROLE_LABELS[role] + ' column is mapped in your records, so this figure was not compared.' });
        return;
      }
      var recC = t[role], delta = recC - f.cents, ok = Math.abs(delta) <= tol;
      var explains = [];
      if (!ok) candidates.forEach(function (c) {
        if (c.cents !== 0 && Math.abs(Math.abs(delta) - Math.abs(c.cents)) <= tol) explains.push(c.name);
      });
      var note;
      if (ok) note = 'Matches your records within ' + fmt(tol) + '.';
      else {
        note = 'Your records are ' + fmt(Math.abs(delta)) + (delta > 0 ? ' higher' : ' lower') + ' than this form figure.';
        if (explains.length) note += ' The gap is the same size as ' + explains.join(', and as ') + '.';
        else note += ' No single total in your records is the same size as this gap.';
      }
      comparisons.push({ label: f.label, compareTo: role, formCents: f.cents, recordsCents: recC,
        deltaCents: delta, status: ok ? 'MATCH' : 'MISMATCH', explainedBy: explains, note: note });
    });

    var hasTipsFigure = (opts.formFigures || []).some(function (f) { return f && f.compareTo === 'tips'; });
    if (rec.mapped.indexOf('tips') >= 0 && t.tips !== 0 && !hasTipsFigure)
      flags.push({ code: 'TIPS_NOT_ON_FORM', cents: t.tips,
        text: 'Your records show ' + fmt(t.tips) + ' in tips. You did not enter a separate tips figure from your form, so tips were not checked on their own.' });
    if (!(opts.formFigures || []).length)
      flags.push({ code: 'NO_FORM_FIGURES', text: 'No form figures entered yet. Add the amounts printed on your form to compare them.' });
    if (rec.badCells.length)
      flags.push({ code: 'UNREADABLE_CELLS', count: rec.badCells.length,
        text: rec.badCells.length + ' cell(s) could not be read as money, so ' + (rec.rowCount - rec.usedRows) +
          ' row(s) were left out of every total: ' +
          rec.badCells.slice(0, 10).map(function (b) { return 'line ' + b.line + ' ' + b.column + '="' + b.value + '"'; }).join('; ') +
          (rec.badCells.length > 10 ? '; ...' : '') + '.' });
    if (rec.duplicates.length)
      flags.push({ code: 'POSSIBLE_DUPLICATES', count: rec.duplicates.length,
        text: rec.duplicates.length + ' possible duplicate row(s) are included in the totals. Check them: ' +
          rec.duplicates.slice(0, 10).map(function (d) { return 'line ' + d.line + ' (' + d.reason + ', first seen line ' + d.sameAs + ')'; }).join('; ') +
          (rec.duplicates.length > 10 ? '; ...' : '') + '.' });
    if (rec.missingDates.length)
      flags.push({ code: 'UNREADABLE_DATES', count: rec.missingDates.length,
        text: rec.missingDates.length + ' row(s) have a date that could not be read, so they are in the totals but not in the monthly table.' });

    var depositCmp = null, monthly = [];
    if (dep) {
      if (dep.badCells.length)
        flags.push({ code: 'UNREADABLE_DEPOSIT_CELLS', count: dep.badCells.length,
          text: dep.badCells.length + ' deposit amount(s) could not be read and were left out.' });
      if (rec.mapped.indexOf('payout') >= 0) {
        var dd = t.payout - dep.total;
        depositCmp = { recordsPayoutCents: t.payout, depositsCents: dep.total, deltaCents: dd,
          status: Math.abs(dd) <= tol ? 'MATCH' : 'MISMATCH' };
        if (depositCmp.status === 'MISMATCH')
          flags.push({ code: 'DEPOSITS_GAP', cents: dd,
            text: 'Your records\' payout total is ' + fmt(Math.abs(dd)) + (dd > 0 ? ' higher' : ' lower') + ' than the deposits file total.' });
      } else {
        flags.push({ code: 'NO_PAYOUT_COLUMN', text: 'A deposits file is loaded, but no Payout column is mapped in your records, so deposits were not compared.' });
      }
    }
    var keys = {};
    Object.keys(rec.months).forEach(function (k) { keys[k] = 1; });
    if (dep) Object.keys(dep.months).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).sort().forEach(function (k) {
      var m = rec.months[k] || { gross: 0, tips: 0, fees: 0, payout: 0, rows: 0 };
      var row = { month: k, rows: m.rows, gross: m.gross, tips: m.tips, fees: m.fees, payout: m.payout };
      if (dep && rec.mapped.indexOf('payout') >= 0) {
        row.deposits = dep.months[k] || 0;
        row.depositDelta = m.payout - row.deposits;
        row.status = Math.abs(row.depositDelta) <= tol ? 'MATCH' : 'MISMATCH';
      }
      monthly.push(row);
    });
    var badMonths = monthly.filter(function (m) { return m.status === 'MISMATCH'; }).map(function (m) { return m.month; });
    if (badMonths.length)
      flags.push({ code: 'MONTHS_DIFFER', months: badMonths,
        text: 'Payouts and deposits differ in: ' + badMonths.join(', ') + '.' });

    return { errors: [], toleranceCents: tol, totals: t, mapped: rec.mapped, rowCount: rec.rowCount,
      usedRows: rec.usedRows, comparisons: comparisons, flags: flags, deposits: depositCmp, monthly: monthly };
  }

  // ---------- report output ----------
  function reportText(r) {
    var L = [];
    L.push('PAYOUT VS 1099 RECONCILER - REPORT');
    L.push(DISCLAIMER);
    L.push('');
    if (r.errors && r.errors.length) {
      L.push('Could not reconcile:');
      r.errors.forEach(function (e) { L.push('  - ' + e); });
      L.push(''); L.push(DISCLAIMER);
      return L.join('\n');
    }
    L.push('Rows read: ' + r.rowCount + ' (used in totals: ' + r.usedRows + ')');
    L.push('Tolerance: ' + fmt(r.toleranceCents));
    L.push('');
    L.push('Your records totals:');
    r.mapped.forEach(function (k) { L.push('  ' + ROLE_LABELS[k] + ': ' + fmt(r.totals[k])); });
    L.push('');
    L.push('Form figures compared:');
    if (!r.comparisons.length) L.push('  (none entered)');
    r.comparisons.forEach(function (c) {
      L.push('  [' + c.status + '] ' + c.label + ' vs your ' + ROLE_LABELS[c.compareTo] + ': form ' + fmt(c.formCents) +
        (c.recordsCents === null ? '' : ', records ' + fmt(c.recordsCents) + ', difference (records - form) ' + fmt(c.deltaCents)));
      L.push('      ' + c.note);
    });
    if (r.deposits) {
      L.push('');
      L.push('Deposits: [' + r.deposits.status + '] records payout ' + fmt(r.deposits.recordsPayoutCents) +
        ', deposits ' + fmt(r.deposits.depositsCents) + ', difference ' + fmt(r.deposits.deltaCents));
    }
    L.push('');
    L.push('Things to check:');
    if (!r.flags.length) L.push('  (nothing flagged)');
    r.flags.forEach(function (f) { L.push('  - ' + f.text); });
    if (r.monthly.length) {
      L.push('');
      L.push('By month:');
      r.monthly.forEach(function (m) {
        var s = '  ' + m.month + ': rows ' + m.rows;
        r.mapped.forEach(function (k) { s += ', ' + k + ' ' + fmt(m[k]); });
        if (m.deposits !== undefined) s += ', deposits ' + fmt(m.deposits) + ' [' + m.status + ']';
        L.push(s);
      });
    }
    L.push('');
    L.push(DISCLAIMER);
    return L.join('\n');
  }

  function csvCell(v) {
    var s = String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\$?[\d,.]+$/.test(s)) s = "'" + s; // guard spreadsheet formula injection
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function reportCSV(r) {
    var rows = [['section', 'item', 'form', 'records', 'difference_records_minus_form', 'status', 'note']];
    rows.push(['disclaimer', DISCLAIMER, '', '', '', '', '']);
    if (r.errors && r.errors.length) r.errors.forEach(function (e) { rows.push(['error', e, '', '', '', '', '']); });
    else {
      r.mapped.forEach(function (k) { rows.push(['records_total', ROLE_LABELS[k], '', fmt(r.totals[k]), '', '', '']); });
      r.comparisons.forEach(function (c) {
        rows.push(['comparison', c.label + ' vs ' + ROLE_LABELS[c.compareTo], fmt(c.formCents),
          c.recordsCents === null ? '' : fmt(c.recordsCents), c.deltaCents === null ? '' : fmt(c.deltaCents), c.status, c.note]);
      });
      if (r.deposits) rows.push(['deposits', 'payout vs deposits', fmt(r.deposits.depositsCents),
        fmt(r.deposits.recordsPayoutCents), fmt(r.deposits.deltaCents), r.deposits.status, '']);
      r.flags.forEach(function (f) { rows.push(['flag', f.code, '', '', '', '', f.text]); });
      r.monthly.forEach(function (m) {
        rows.push(['month', m.month, m.deposits === undefined ? '' : fmt(m.deposits),
          m.payout !== undefined && r.mapped.indexOf('payout') >= 0 ? fmt(m.payout) : fmt(m.gross),
          m.depositDelta === undefined ? '' : fmt(m.depositDelta), m.status || '', 'rows ' + m.rows]);
      });
    }
    return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\n') + '\n';
  }

  return {
    DISCLAIMER: DISCLAIMER, ROLES: ROLES, ROLE_LABELS: ROLE_LABELS,
    parseCSV: parseCSV, parseAmount: parseAmount, monthKey: monthKey, fmt: fmt,
    guessColumns: guessColumns, guessDepositColumns: guessDepositColumns,
    summarizeRecords: summarizeRecords, summarizeDeposits: summarizeDeposits,
    reconcile: reconcile, reportText: reportText, reportCSV: reportCSV
  };
});
