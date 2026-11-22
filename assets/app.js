/* =========================================================
   Tick Market Dashboard — homepage engine
   - Renders Call vs Put OI, PCR, intraday, and futures buildup
   - Polls this project's same-origin JSON API every 60s by default
   - Shows DEMO/OFFLINE status honestly; it never fabricates quotes
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- config ---------------- */
  var REFRESH_MS_DEFAULT = 60 * 1000;      // poll the API every minute by default
  var REFRESH_MS = REFRESH_MS_DEFAULT;
  var OI_API = '/api/oi';
  var OI_META_API = '/api/oi-meta';
  var INTRADAY_API = '/api/intraday';
  var FUTURES_API = '/api/futures';

  var SYMBOL_LABELS = {
    'NIFTY W': 'Nifty Current Week',
    'NIFTY WN': 'Nifty Next Week',
    'NIFTY M': 'Nifty Monthly Exp',
    'BANKNIFTY': 'BANK NIFTY'
  };
  var symbolLabel = function (code) { return SYMBOL_LABELS[code] || code; };
  var ATM_STEP = { 'NIFTY W': 50, 'NIFTY WN': 50, 'NIFTY M': 50, 'BANKNIFTY': 100 };

  /* ---------------- tiny utils ---------------- */
  function $(id) { return document.getElementById(id); }
  function fmtInt(n) {
    if (n == null || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-IN');
  }
  function fmt2(n) {
    if (n == null || isNaN(n)) return '—';
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtKM(n) {
    if (n == null || isNaN(n)) return '—';
    var abs = Math.abs(n), sign = n < 0 ? '−' : '';
    if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2) + 'K';
    return sign + String(Math.round(abs));
  }
  function fmtSignedKM(n) {
    if (n == null || isNaN(n)) return '—';
    var sign = n < 0 ? '−' : '+';
    return sign + fmtKM(Math.abs(n)).replace('−', '');
  }
  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---------------- state ---------------- */
  var SEED = window.SEED_DATA;
  var oiState = {};   // per OI symbol: { meta, strikes, insights, data(summary) }
  var indState = {};  // per index symbol
  var buildup = {};
  var spark = [];
  var liveMode = false;
  var apiAvailable = false;
  var feedMode = 'demo';
  var futuresFeedMode = 'demo';
  var lastCheckedAt = null;
  var refreshInProgress = false;
  var paused = false;
  var countdownLeft = REFRESH_MS;
  var intradayChart = null;
  var barMinute = {};
  var lastRaw = {};   // previous numeric values, for up/down flashing

  function strikeSums(st) {
    var tc = 0, tp = 0, cc = 0, cp = 0;
    st.forEach(function (k) {
      tc += k.ce_oi; tp += k.pe_oi;
      cc += k.call_oi_change; cp += k.pe_oi_change;
    });
    return { tc: tc, tp: tp, cc: cc, cp: cp };
  }

  function captureBase(key) {
    oiState[key].baseStrike = strikeSums(oiState[key].strikes);
  }

  (function init() {
    Object.keys(SEED.OI).forEach(function (sym) {
      oiState[sym] = {
        meta: JSON.parse(JSON.stringify(SEED.OI_META[sym])),
        strikes: JSON.parse(JSON.stringify(SEED.OI[sym].strikes)),
        insights: JSON.parse(JSON.stringify(SEED.OI[sym].insights || {})),
        base: JSON.parse(JSON.stringify(SEED.OI[sym].baseSummary || {})),
        data: null
      };
      captureBase(sym);
    });
    Object.keys(SEED.INTRADAY).forEach(function (sym) {
      var d = SEED.INTRADAY[sym];
      var lastLabel = d.labels[d.labels.length - 1];
      var parts = lastLabel.split(':');
      barMinute[sym] = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      indState[sym] = {
        name: d.name,
        labels: d.labels.slice(),
        prices: d.prices.slice(),
        open: d.open,
        high: d.high,
        low: d.low,
        prev_close: d.prev_close,
        trading_date: d.trading_date,
        as_of: d.trading_date + ' ' + lastLabel,
        mode: 'demo',
        source: 'sample-snapshot'
      };
    });
    buildup = JSON.parse(JSON.stringify(SEED.BUILDUP));
    for (var i = 1; i <= 8; i++) spark[i] = randomWalk(30, 20, 3);
    Object.keys(oiState).forEach(function (sym) { computeSummary(sym); });
  })();

  /* ---------------- sentiment ---------------- */
  function pcrSentiment(v) {
    if (v == null || isNaN(v)) return { label: '—', css: 'badge-soft-secondary' };
    if (v >= 1.5) return { label: 'Strong Bullish', css: 'badge-soft-success' };
    if (v >= 1.1) return { label: 'Bullish', css: 'badge-soft-success' };
    if (v >= 0.9) return { label: 'Neutral', css: 'badge-soft-secondary' };
    if (v >= 0.6) return { label: 'Bearish', css: 'badge-soft-danger' };
    return { label: 'Strong Bearish', css: 'badge-soft-danger' };
  }
  function oiChangePcrSentiment(v) {
    if (v == null || isNaN(v)) return { label: '—', css: 'badge-soft-secondary' };
    if (v >= 1.5) return { label: 'Strong Bullish', css: 'badge-soft-success' };
    if (v >= 1.0) return { label: 'Bullish', css: 'badge-soft-success' };
    if (v >= 0.5) return { label: 'Neutral', css: 'badge-soft-secondary' };
    if (v >= 0.2) return { label: 'Bearish', css: 'badge-soft-danger' };
    return { label: 'Strong Bearish', css: 'badge-soft-danger' };
  }

  /* ---------------- summary computation ----------------
     The API summary is computed over ALL strikes, but the page
     only ships the ~11 strikes around ATM. So we keep the real
     API totals as a base and scale them by how the visible
     strikes moved since the snapshot.                     */
  function computeSummary(sym) {
    var st = oiState[sym].strikes;
    var cur = strikeSums(st);
    var visMaxC = 0, visMaxP = 0, visMaxCc = 0, visMaxPc = 0;
    st.forEach(function (k) {
      if (k.ce_oi > visMaxC) visMaxC = k.ce_oi;
      if (k.pe_oi > visMaxP) visMaxP = k.pe_oi;
      if (k.call_oi_change > visMaxCc) visMaxCc = k.call_oi_change;
      if (k.pe_oi_change > visMaxPc) visMaxPc = k.pe_oi_change;
    });
    var b = oiState[sym].base || {};
    var bs = oiState[sym].baseStrike || { tc: cur.tc, tp: cur.tp, cc: cur.cc, cp: cur.cp };
    var fTc = bs.tc ? cur.tc / bs.tc : 1;
    var fTp = bs.tp ? cur.tp / bs.tp : 1;
    var fCc = bs.cc ? cur.cc / bs.cc : 1;
    var fCp = bs.cp ? cur.cp / bs.cp : 1;
    var tc = (b.total_call_oi != null ? b.total_call_oi : cur.tc) * fTc;
    var tp = (b.total_put_oi != null ? b.total_put_oi : cur.tp) * fTp;
    var cc = (b.call_oi_change_abs != null ? b.call_oi_change_abs : cur.cc) * fCc;
    var cp = (b.put_oi_change_abs != null ? b.put_oi_change_abs : cur.cp) * fCp;
    var pcr = tc > 0 ? tp / tc : null;
    var cpcr = cc !== 0 ? cp / cc : null;
    var m = oiState[sym].meta;
    var step = ATM_STEP[sym] || 50;
    m.atm = Math.round(m.spot / step) * step;
    var o = {
      total_call_oi: tc, total_put_oi: tp,
      overall_pcr: pcr, oi_change_pcr: cpcr,
      call_oi_change_abs: cc, put_oi_change_abs: cp,
      max_call_oi_strike: b.max_call_oi_strike != null ? b.max_call_oi_strike : st[0].strike,
      max_call_oi_value: (b.max_call_oi_value != null ? b.max_call_oi_value : visMaxC) * fTc,
      max_put_oi_strike: b.max_put_oi_strike != null ? b.max_put_oi_strike : st[0].strike,
      max_put_oi_value: (b.max_put_oi_value != null ? b.max_put_oi_value : visMaxP) * fTp,
      max_call_oi_chg_strike: b.max_call_oi_chg_strike != null ? b.max_call_oi_chg_strike : st[0].strike,
      max_call_oi_chg_value: (b.max_call_oi_chg_value != null ? b.max_call_oi_chg_value : visMaxCc) * fCc,
      max_put_oi_chg_strike: b.max_put_oi_chg_strike != null ? b.max_put_oi_chg_strike : st[0].strike,
      max_put_oi_chg_value: (b.max_put_oi_chg_value != null ? b.max_put_oi_chg_value : visMaxPc) * fCp,
      sentiment: pcrSentiment(pcr)
    };
    oiState[sym].data = o;
    oiState[sym].insights = {
      put_support: 'Heavy Put OI at ' + fmtInt(o.max_put_oi_strike) + ' suggests downside support.',
      call_resist: 'Highest Call OI at ' + fmtInt(o.max_call_oi_strike) + ' acts as resistance.',
      bias: pcr >= 1 ? 'Put OI dominant — support zone holding.' : 'Call OI dominant — resistance overhead.'
    };
    return o;
  }

  /* ---------------- same-origin data API ---------------- */
  function fetchJson(url) {
    var c = new AbortController();
    var to = setTimeout(function () { c.abort(); }, 8000);
    return fetch(url, { cache: 'no-store', signal: c.signal, headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (e) { clearTimeout(to); throw e; });
  }

  function tryLive(bSym, fSym, indSym, bExpiry, fExpiry) {
    var requests = [];
    var requested = {};
    function addOiRequest(sym, expiry) {
      var key = sym + '|' + (expiry || '');
      if (requested[key]) return;
      requested[key] = true;
      var query = '?symbol=' + encodeURIComponent(sym) + '&expiry=' + encodeURIComponent(expiry || '');
      requests.push(fetchJson(OI_API + query).then(function (j) { return { oi: j }; }));
    }
    addOiRequest(bSym, bExpiry);
    addOiRequest(fSym, fExpiry);
    requests.push(fetchJson(INTRADAY_API + '?symbol=' + encodeURIComponent(indSym))
      .then(function (j) { return { ind: j }; }));
    requests.push(fetchJson(FUTURES_API).then(function (j) { return { futures: j }; }));

    return Promise.all(requests).then(function (results) {
      results.forEach(function (r) {
        if (r.oi) {
          if (r.oi.status !== 'ok' || !r.oi.meta || !oiState[r.oi.meta.symbol]) {
            throw new Error((r.oi && r.oi.error) || 'Invalid OI response');
          }
          var key = r.oi.meta.symbol;
          oiState[key].meta = r.oi.meta;
          oiState[key].strikes = r.oi.strikes || [];
          if (r.oi.insights) oiState[key].insights = r.oi.insights;
          oiState[key].base = r.oi.summary || {};
          captureBase(key);
        }
        if (r.ind) {
          if (!r.ind.success || !indState[r.ind.symbol]) throw new Error((r.ind && r.ind.error) || 'Invalid intraday response');
          var s = indState[r.ind.symbol];
          s.labels = r.ind.labels || [];
          s.prices = r.ind.prices || [];
          s.open = r.ind.open;
          s.high = r.ind.high;
          s.low = r.ind.low;
          s.prev_close = r.ind.current_price - r.ind.price_change;
          s.trading_date = r.ind.trading_date || s.trading_date;
          s.as_of = r.ind.as_of || s.as_of;
          s.mode = r.ind.mode || 'demo';
          s.source = r.ind.source || 'upstox';
          if (s.labels.length) {
            var pl = s.labels[s.labels.length - 1].split(':');
            barMinute[r.ind.symbol] = parseInt(pl[0], 10) * 60 + parseInt(pl[1], 10);
          }
        }
        if (r.futures) {
          if (r.futures.status !== 'ok' || !r.futures.data) throw new Error((r.futures && r.futures.error) || 'Invalid futures response');
          buildup = r.futures.data;
          futuresFeedMode = r.futures.mode || 'demo';
        }
      });
      Object.keys(oiState).forEach(computeSummary);
      apiAvailable = true;
      var modes = results.map(function (r) { return (r.oi || r.ind || r.futures || {}).mode || 'demo'; });
      liveMode = modes.length > 0 && modes.every(function (mode) { return mode === 'live'; });
      feedMode = liveMode ? 'live' : (modes.some(function (mode) { return mode === 'live'; }) ? 'mixed' : 'demo');
      lastCheckedAt = new Date();
      return true;
    }).catch(function () {
      apiAvailable = false;
      liveMode = false;
      feedMode = 'offline';
      lastCheckedAt = new Date();
      return false;
    });
  }

  /* ---------------- value setting + flash ---------------- */
  var flashTimers = {};
  function setVal(id, text, raw) {
    var el = $(id);
    if (!el) return;
    var dir = 0;
    if (typeof raw === 'number' && !isNaN(raw)) {
      var prev = lastRaw[id];
      if (typeof prev === 'number' && prev !== raw) dir = raw > prev ? 1 : -1;
      lastRaw[id] = raw;
    }
    if (el.textContent === text) return;
    el.textContent = text;
    if (dir) {
      var box = el.closest('.stat-tile, .pcr-panel, .buildup-tile, .pcr-metrics') || el;
      box.classList.remove('tick-flash');
      void box.offsetWidth;
      box.classList.add('tick-flash');
      el.classList.add(dir === 1 ? 'up-flash' : 'down-flash');
      clearTimeout(flashTimers[id]);
      flashTimers[id] = setTimeout(function () {
        box.classList.remove('tick-flash');
        el.classList.remove('up-flash', 'down-flash');
      }, 900);
    }
  }

  /* ---------------- renderers ---------------- */
  function renderCallVsPut() {
    var sym = $('b-filterSymbol').value;
    var st = oiState[sym];
    if (!st) return;
    var o = st.data || computeSummary(sym);
    var m = st.meta;

    setVal('b-totalCallOi', fmtKM(o.total_call_oi), o.total_call_oi);
    setVal('b-totalPutOi', fmtKM(o.total_put_oi), o.total_put_oi);
    setVal('b-callChg', fmtSignedKM(o.call_oi_change_abs), o.call_oi_change_abs);
    setVal('b-putChg', fmtSignedKM(o.put_oi_change_abs), o.put_oi_change_abs);

    var maxOi = Math.max(o.total_call_oi, o.total_put_oi, 1);
    $('b-oiCallBar').style.height = Math.max(6, (o.total_call_oi / maxOi) * 100) + '%';
    $('b-oiPutBar').style.height = Math.max(6, (o.total_put_oi / maxOi) * 100) + '%';
    $('b-oiCallVal').textContent = fmtKM(o.total_call_oi);
    $('b-oiPutVal').textContent = fmtKM(o.total_put_oi);
    var maxChg = Math.max(Math.abs(o.call_oi_change_abs), Math.abs(o.put_oi_change_abs), 1);
    $('b-chgCallBar').style.height = Math.max(6, (Math.abs(o.call_oi_change_abs) / maxChg) * 100) + '%';
    $('b-chgPutBar').style.height = Math.max(6, (Math.abs(o.put_oi_change_abs) / maxChg) * 100) + '%';
    $('b-chgCallVal').textContent = fmtSignedKM(o.call_oi_change_abs);
    $('b-chgPutVal').textContent = fmtSignedKM(o.put_oi_change_abs);

    $('b-heroSymbol').textContent = symbolLabel(sym);
    $('b-heroExpiry').textContent = m.expiry;
    $('b-heroSpot').textContent = fmt2(m.spot);
    $('b-heroUpdated').textContent = m.snapshot_time;
  }

  function renderPcrPanels() {
    var sym = $('filterSymbol').value;
    var st = oiState[sym];
    if (!st) return;
    var o = st.data || computeSummary(sym);
    var m = st.meta;

    var pcr = o.overall_pcr;
    setVal('pcrValue', pcr == null ? '—' : pcr.toFixed(2), pcr);
    var pv = $('pcrValue');
    pv.classList.remove('text-green', 'text-red');
    pv.classList.add(pcr >= 1 ? 'text-green' : 'text-red');
    var sb = pcrSentiment(pcr);
    var badge = $('pcrBadge');
    badge.textContent = sb.label;
    badge.className = 'badge ' + sb.css;
    $('pcrMarker').style.left = Math.max(0, Math.min(100, ((pcr || 0) / 2) * 100)) + '%';

    $('maxCallStrike').textContent = fmtInt(o.max_call_oi_strike);
    $('maxCallOiValue').textContent = fmtKM(o.max_call_oi_value);
    $('maxPutStrike').textContent = fmtInt(o.max_put_oi_strike);
    $('maxPutOiValue').textContent = fmtKM(o.max_put_oi_value);
    $('atmStrike').textContent = fmtInt(m.atm);
    $('atmSpot').textContent = fmt2(m.spot);
    $('heroSymbol').textContent = symbolLabel(sym);
    $('heroExpiry').textContent = m.expiry;
    $('heroSpot').textContent = fmt2(m.spot);
    $('heroUpdated').textContent = m.snapshot_time;

    var cpcr = o.oi_change_pcr;
    setVal('chgPcrValue', cpcr == null ? '—' : cpcr.toFixed(2), cpcr);
    var cv = $('chgPcrValue');
    cv.classList.remove('positive');
    if (cpcr != null && cpcr >= 1) cv.classList.add('positive');
    var cs = oiChangePcrSentiment(cpcr);
    var cb = $('chgPcrBadge');
    cb.textContent = cs.label;
    cb.className = 'badge ' + cs.css;
    var pos = cpcr == null ? 50 : ((cpcr - 0.1) / (2.0 - 0.1)) * 100;
    $('chgPcrMarker').style.left = Math.max(0, Math.min(100, pos)) + '%';

    $('maxCallChgStrike').textContent = fmtInt(o.max_call_oi_chg_strike);
    $('maxCallChgValue').textContent = fmtSignedKM(o.max_call_oi_chg_value);
    $('maxPutChgStrike').textContent = fmtInt(o.max_put_oi_chg_strike);
    $('maxPutChgValue').textContent = fmtSignedKM(o.max_put_oi_chg_value);
    $('chgSpot').textContent = fmt2(m.spot);
    $('chgSpotSub').textContent = 'auto-refresh ' + (REFRESH_MS / 1000) + 's';
  }

  function renderIntraday() {
    var sym = $('niftySymbolSelect').value;
    var s = indState[sym];
    if (!s) return;
    var last = s.prices[s.prices.length - 1];
    var chg = last - s.prev_close;
    var chgP = s.prev_close > 0 ? (chg / s.prev_close) * 100 : 0;
    var up = chg >= 0;

    setVal('niftyCurrentPrice', fmt2(last), last);
    var badge = $('niftyChangeBadge');
    badge.textContent = (up ? '↑ ' : '↓ ') + Math.abs(chgP).toFixed(2) + '%';
    badge.classList.toggle('positive', up);
    var abs = $('niftyAbsoluteChange');
    abs.textContent = (up ? '+' : '−') + fmt2(Math.abs(chg));
    abs.classList.toggle('positive', up);
    $('niftyIndexName').textContent = s.name;
    $('niftyOpen').textContent = fmt2(s.open);
    $('niftyHigh').textContent = fmt2(s.high);
    $('niftyLow').textContent = fmt2(s.low);
    var lastLabel = s.labels[s.labels.length - 1] || '';
    var sourceLabel = s.mode === 'demo' ? 'Demo snapshot' : 'Upstox data';
    $('niftyLastUpdated').textContent = sourceLabel + ': ' + (s.trading_date || '') + ' ' + lastLabel + ' IST';

    if (typeof Chart === 'undefined') return;
    var color = up ? '#16a085' : '#dc2626';
    var labels = s.labels, data = s.prices;
    var makeGrad = function (ctx) {
      var g = ctx.createLinearGradient(0, 0, 0, 185);
      g.addColorStop(0, up ? 'rgba(22,160,133,.25)' : 'rgba(220,38,38,.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      return g;
    };
    if (intradayChart) {
      intradayChart.data.labels = labels;
      intradayChart.data.datasets[0].data = data;
      intradayChart.data.datasets[0].borderColor = color;
      intradayChart.data.datasets[0].backgroundColor = makeGrad(intradayChart.ctx);
      intradayChart.update('none');
    } else {
      var ctx = $('niftyIntradayCanvas').getContext('2d');
      intradayChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            borderColor: color,
            backgroundColor: makeGrad(ctx),
            fill: true,
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.25
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              displayColors: false,
              callbacks: {
                title: function (items) { return 'Time: ' + items[0].label; },
                label: function (item) { return s.name + ': ' + fmt2(item.parsed.y); }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 7, font: { size: 9 }, color: '#94a3b8' }
            },
            y: {
              position: 'right',
              grid: { color: 'rgba(148,163,184,.15)' },
              ticks: { font: { size: 9 }, color: '#94a3b8', maxTicksLimit: 5, callback: function (v) { return fmtInt(v); } }
            }
          }
        }
      });
    }
  }

  function renderBuildup() {
    setVal('bd-long', String(buildup.long), buildup.long);
    setVal('bd-short', String(buildup.short), buildup.short);
    setVal('bd-lu', String(buildup.long_unwind), buildup.long_unwind);
    setVal('bd-sc', String(buildup.short_cover), buildup.short_cover);
  }

  /* ---------------- sparklines ---------------- */
  function randomWalk(n, start, vol) {
    var a = [start];
    for (var i = 1; i < n; i++) a.push(Math.max(2, a[i - 1] + gauss() * vol));
    return a;
  }
  function sparkPath(vals) {
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var range = (max - min) || 1;
    var step = 100 / (vals.length - 1);
    return vals.map(function (v, i) {
      var x = (i * step).toFixed(1);
      var y = (38 - ((v - min) / range) * 34 - 2).toFixed(1);
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ');
  }
  function renderSparklines() {
    for (var i = 1; i <= 8; i++) {
      var el = $('spark-' + i);
      if (el) el.setAttribute('d', sparkPath(spark[i]));
    }
  }

  /* ---------------- auto-refresh bar ---------------- */
  var RING_C = 2 * Math.PI * 9; // ring radius = 9
  (function initRing() {
    var fg = $('ringFg');
    if (fg) {
      fg.style.strokeDasharray = String(RING_C);
      fg.style.strokeDashoffset = '0';
    }
  })();

  function setModeUI() {
    var bar = $('refresh-bar');
    bar.classList.toggle('sim', feedMode !== 'live');
    bar.classList.toggle('paused', paused);
    $('rbMode').textContent = paused ? 'PAUSED' : feedMode.toUpperCase();
    $('toastSrc').textContent = feedMode === 'live' ? 'Upstox API' :
      (feedMode === 'mixed' ? 'Upstox + demo data' :
        (feedMode === 'demo' ? 'sample snapshot API' : 'cached snapshot; API unavailable'));
    $('refresh-toast').classList.toggle('sim', feedMode !== 'live');
    if ($('logoMode')) $('logoMode').textContent = feedMode === 'live' ? 'LIVE' : feedMode.toUpperCase();
    if ($('futuresModeTag')) $('futuresModeTag').textContent = futuresFeedMode === 'live'
      ? 'Live Futures Data' : 'Demo Futures Snapshot';
    var note = $('dataStatusNote');
    if (note) {
      if (feedMode === 'live') {
        note.textContent = 'Upstox market data connected for the active option-chain and intraday panels. The futures buildup panel is still a demo snapshot.';
      } else if (feedMode === 'mixed') {
        note.textContent = 'MIXED DATA: Upstox supplies available option-chain/intraday data; the futures buildup panel and any no-candle fallback remain clearly marked as demo. Check each panel’s as-of date.';
      } else if (feedMode === 'demo') {
        note.textContent = 'DEMO DATA: this is a historical sample snapshot. The page checks the API every minute; values will not become live until a licensed market-data provider is connected.';
      } else {
        note.textContent = 'API unavailable: showing the last cached snapshot. Check the Render logs, token expiry, and Upstox API permissions.';
      }
    }
  }

  var toastTimer = null;
  function toast(timeStr) {
    $('toastTime').textContent = timeStr + ' IST';
    var t = $('refresh-toast');
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function renderAll() {
    renderCallVsPut();
    renderPcrPanels();
    renderIntraday();
    renderBuildup();
    renderSparklines();
    var m = oiState[$('filterSymbol').value].meta;
    var checked = lastCheckedAt
      ? lastCheckedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      : 'not yet';
    $('rbUpdated').textContent = (apiAvailable ? 'API checked: ' : 'API check: ') + checked;
    $('chartsUpdated').textContent = m.snapshot_time.slice(11);
  }

  function doRefresh(manual) {
    if ((paused && !manual) || refreshInProgress) return;
    refreshInProgress = true;

    var bSym = $('b-filterSymbol').value;
    var fSym = $('filterSymbol').value;
    var indSym = $('niftySymbolSelect').value;
    var bExpiry = $('b-filterExpiry').value || oiState[bSym].meta.expiry;
    var fExpiry = $('filterExpiry').value || oiState[fSym].meta.expiry;
    countdownLeft = REFRESH_MS;
    updateCountdownUI();
    $('rbNow').disabled = true;

    return tryLive(bSym, fSym, indSym, bExpiry, fExpiry).then(function () {
      renderAll();
      setModeUI();
      var checked = lastCheckedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      toast(checked);
      countdownLeft = REFRESH_MS;
      updateCountdownUI();
    }).finally(function () {
      refreshInProgress = false;
      $('rbNow').disabled = false;
    });
  }

  /* ---------------- scheduler ---------------- */
  var timer = null;
  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(tickSecond, 1000);
  }

  function tickSecond() {
    if (paused) return;
    countdownLeft -= 1000;
    if (countdownLeft <= 0) { doRefresh(false); return; }
    updateCountdownUI();
  }

  function updateCountdownUI() {
    var s = Math.max(0, Math.ceil(countdownLeft / 1000));
    $('rbCount').textContent = s + 's';
    var fg = $('ringFg');
    if (fg) fg.style.strokeDashoffset = String(RING_C * (1 - Math.max(0, Math.min(1, countdownLeft / REFRESH_MS))));
  }

  /* ---------------- controls ---------------- */
  function wire() {
    $('navToggle').addEventListener('click', function () {
      $('headerNav').classList.toggle('open');
    });

    $('rbInterval').addEventListener('change', function () {
      REFRESH_MS = parseInt(this.value, 10) * 1000;
      countdownLeft = REFRESH_MS;
      updateCountdownUI();
    });

    $('rbPause').addEventListener('click', function () {
      paused = !paused;
      $('rbPauseTxt').textContent = paused ? 'Resume' : 'Pause';
      if (!paused) countdownLeft = REFRESH_MS;
      setModeUI();
      updateCountdownUI();
    });

    $('rbNow').addEventListener('click', function () { doRefresh(true); });

    function syncExpiry(id) {
      var v = $(id).value;
      var expSel = $(id === 'b-filterSymbol' ? 'b-filterExpiry' : 'filterExpiry');
      var isNifty = v.indexOf('NIFTY') === 0;
      expSel.style.display = isNifty ? 'block' : 'none';
      if (isNifty) {
        var meta = oiState[v].meta;
        var expected = meta && meta.expiry;
        if (expected) {
          var exists = false;
          for (var i = 0; i < expSel.options.length; i++) {
            if (expSel.options[i].value === expected) { exists = true; break; }
          }
          if (!exists) {
            var option = document.createElement('option');
            option.value = expected;
            option.textContent = expected;
            expSel.appendChild(option);
          }
          expSel.value = expected;
        } else if (SEED.EXPIRIES.length) {
          expSel.value = SEED.EXPIRIES[0];
        }
      } else {
        expSel.value = (oiState[v] && oiState[v].meta.expiry) || '';
      }
      if (isNifty && expSel.value) oiState[v].meta.expiry = expSel.value;
    }
    function loadExpiryOptions(sym) {
      return fetchJson(OI_META_API + '?symbol=' + encodeURIComponent(sym)).then(function (meta) {
        if (meta.status !== 'ok' || !Array.isArray(meta.expiries) || !meta.expiries.length) return false;
        var expiries = meta.expiries.map(function (item) {
          return typeof item === 'string' ? item : item.expiry;
        }).filter(Boolean);
        if (!expiries.length) return false;
        var chosen = meta.default_expiry || (meta.meta && meta.meta.expiry) || oiState[sym].meta.expiry;
        if (expiries.indexOf(chosen) < 0) chosen = expiries[0];
        if (meta.meta) oiState[sym].meta = Object.assign({}, oiState[sym].meta, meta.meta);
        oiState[sym].meta.expiry = chosen;

        ['b-filterSymbol', 'filterSymbol'].forEach(function (symbolId) {
          if ($(symbolId).value !== sym) return;
          var expiryId = symbolId === 'b-filterSymbol' ? 'b-filterExpiry' : 'filterExpiry';
          var select = $(expiryId);
          select.textContent = '';
          expiries.forEach(function (expiry) {
            var option = document.createElement('option');
            option.value = expiry;
            option.textContent = expiry;
            select.appendChild(option);
          });
          select.value = chosen;
        });
        return true;
      }).catch(function () { return false; });
    }
    function syncOiselects(src) {
      var v = src.value;
      ['b-filterSymbol', 'filterSymbol'].forEach(function (id) {
        if (id !== src.id && $(id)) $(id).value = v;
      });
      syncExpiry('b-filterSymbol');
      syncExpiry('filterSymbol');
      renderCallVsPut();
      renderPcrPanels();
      loadExpiryOptions(v).then(function () {
        renderCallVsPut();
        renderPcrPanels();
        doRefresh(true);
      });
    }
    ['b-filterSymbol', 'filterSymbol'].forEach(function (id) {
      $(id).addEventListener('change', function () { syncOiselects($(id)); });
    });
    ['b-filterExpiry', 'filterExpiry'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var srcId = id === 'b-filterExpiry' ? 'b-filterSymbol' : 'filterSymbol';
        var peerId = id === 'b-filterExpiry' ? 'filterExpiry' : 'b-filterExpiry';
        if (this.value) {
          oiState[$(srcId).value].meta.expiry = this.value;
          $(peerId).value = this.value;
        }
        renderCallVsPut();
        renderPcrPanels();
        doRefresh(true);
      });
    });
    ['b-filterExpiry', 'filterExpiry'].forEach(function (id) {
      var sel = $(id);
      SEED.EXPIRIES.forEach(function (e) {
        var o = document.createElement('option');
        o.value = e; o.textContent = e;
        sel.appendChild(o);
      });
    });
    syncExpiry('b-filterSymbol');
    syncExpiry('filterSymbol');

    $('niftySymbolSelect').addEventListener('change', function () {
      if (intradayChart) { intradayChart.destroy(); intradayChart = null; }
      renderIntraday();
      doRefresh(true);
    });

    setModeUI();
    updateCountdownUI();
    renderAll();
    startTimer();
    loadExpiryOptions($('filterSymbol').value).then(function () { doRefresh(true); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  /* debug hook (also handy for testing) */
  if (typeof window !== 'undefined') {
    window.ttDebug = {
      doRefresh: doRefresh,
      getState: function () {
        return { oiState: oiState, indState: indState, buildup: buildup, liveMode: liveMode, feedMode: feedMode, apiAvailable: apiAvailable, lastCheckedAt: lastCheckedAt };
      }
    };
  }
})();
