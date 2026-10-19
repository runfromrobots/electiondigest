// Midterm Digest: theme toggle, countdown, seat-change chart, archive search.
(function () {
  var root = document.documentElement;

  // Theme toggle (remembered per browser).
  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var dark = root.dataset.theme
        ? root.dataset.theme === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
      if (window.__drawChart) window.__drawChart();
    });
  }

  // Live countdown.
  var cd = document.querySelector('.countdown');
  if (cd) {
    var eday = new Date(cd.dataset.election + 'T00:00:00');
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var days = Math.max(0, Math.round((eday - today) / 86400000));
    document.getElementById('days-left').textContent = days;
  }

  // Archive search.
  var search = document.getElementById('archive-search');
  if (search) {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.arch-row'));
    var empty = document.getElementById('arch-empty');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (r) {
        var hit = !q || r.dataset.search.indexOf(q) !== -1;
        r.hidden = !hit;
        if (hit) shown++;
      });
      empty.hidden = shown !== 0;
    });
  }

  // Seat-change chart.
  var el = document.getElementById('chart');
  var dataEl = document.getElementById('digest-data');
  if (!el || !dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var series = data.series;
  var tip = document.getElementById('chart-tip');
  var mode = 'daily';
  var NS = 'http://www.w3.org/2000/svg';

  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d;
  }
  function label(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function fmt(n) { return n > 0 ? '+' + n : (n < 0 ? '−' + Math.abs(n) : '0'); }
  function node(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceStep(range) {
    var raw = range / 4, pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  // Bar with 4px rounding on the data end only, flat against the baseline.
  function barPath(x, w, y0, y1) {
    var up = y1 < y0, h = Math.abs(y1 - y0), r = Math.min(4, w / 2, h);
    if (h < 0.5) return '';
    if (up) {
      return 'M' + x + ',' + y0 + 'V' + (y1 + r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 +
        'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 + r) + 'V' + y0 + 'Z';
    }
    return 'M' + x + ',' + y0 + 'V' + (y1 - r) + 'Q' + x + ',' + y1 + ' ' + (x + r) + ',' + y1 +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y1 + ' ' + (x + w) + ',' + (y1 - r) + 'V' + y0 + 'Z';
  }

  function draw() {
    el.innerHTML = '';
    hideTip();
    var W = el.clientWidth, H = el.clientHeight;
    if (W < 120 || H < 80) return;
    var narrow = W < 560;
    var m = { t: 22, r: narrow ? 8 : 16, b: 28, l: 34 };
    var lastIso = series[series.length - 1].date;
    var futureDays = Math.max(0, Math.round((new Date(data.election + 'T00:00:00') - new Date(lastIso + 'T00:00:00')) / 86400000));
    var slots = series.length + futureDays;
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var slot = iw / slots;
    var gap = 2;
    var bw = Math.max(2, slot - gap);

    var vals = series.map(function (p) { return mode === 'daily' ? (p.score || 0) : p.total; });
    var max = Math.max(1, Math.max.apply(null, vals));
    var min = Math.min(0, Math.min.apply(null, vals));
    var step = niceStep(max - min);
    max = Math.ceil(max / step) * step;
    // A small dip below zero gets just enough room, not a whole empty band.
    min = -min > step * 0.4 ? Math.floor(min / step) * step : Math.min(min * 1.6, 0);
    var y = function (v) { return m.t + ih - ((v - min) / (max - min)) * ih; };
    var yOf = y;

    var svg = node('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' }, el);

    // Future zone up to Election Day.
    if (futureDays > 0) {
      var fx = m.l + series.length * slot;
      node('rect', { class: 'future', x: fx, y: m.t, width: futureDays * slot, height: ih, rx: 4 }, svg);
      if (futureDays * slot > 90) {
        var fl = node('text', { class: 'future-label', x: fx + 8, y: m.t + 14 }, svg);
        fl.textContent = futureDays + ' days to go';
      }
      node('line', { class: 'eday', x1: m.l + iw, x2: m.l + iw, y1: m.t, y2: m.t + ih }, svg);
      var el2 = node('text', { class: 'eday-label', x: m.l + iw - 4, y: m.t - 8, 'text-anchor': 'end' }, svg);
      el2.textContent = 'Election Day';
    }

    // Grid + y labels.
    var grid = node('g', { class: 'grid axis' }, svg);
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
      if (v !== 0) node('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }, grid);
      var t = node('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, grid);
      t.textContent = fmt(v);
    }

    // X labels: weekly from the first day.
    var xa = node('g', { class: 'axis' }, svg);
    var every = narrow ? 14 : 7;
    for (var i = 0; i < slots; i += every) {
      var lx = node('text', { x: m.l + i * slot + slot / 2, y: H - 8, 'text-anchor': 'middle' }, xa);
      lx.textContent = label(addDays(series[0].date, i));
    }

    // Bars.
    var cols = node('g', {}, svg);
    var maxIdx = vals.indexOf(Math.max.apply(null, vals));
    series.forEach(function (p, i) {
      var g = node('g', { class: 'col', 'data-i': i }, cols);
      var x = m.l + i * slot + gap / 2;
      var v = vals[i];
      node('rect', { class: 'hit', x: m.l + i * slot, y: m.t, width: slot, height: ih }, g);
      if (p.score === null && mode === 'daily') return;
      if (v === 0) {
        node('rect', { class: 'bar-zero', x: x, y: y(0) - 1.5, width: bw, height: 3, rx: 1.5 }, g);
      } else {
        node('path', { class: v > 0 ? 'bar-dem' : 'bar-rep', d: barPath(x, bw, y(0), y(v)) }, g);
        // Selective labels: daily bars of +4 or more, any negative, and the running-total peak.
        var show = mode === 'daily' ? (Math.abs(v) >= 4 || v < 0) : i === maxIdx;
        if (show && !(narrow && mode === 'daily' && Math.abs(v) < 10 && v > 0)) {
          var vt = node('text', { class: 'val', x: x + bw / 2, y: v > 0 ? y(v) - 6 : y(v) + 14, 'text-anchor': 'middle' }, g);
          vt.textContent = fmt(v);
        }
      }
    });
    node('line', { class: 'zero-line', x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }, svg);

    var active = null;
    function activate(i, evt) {
      if (active !== null) cols.children[active].classList.remove('is-active');
      active = i;
      cols.children[i].classList.add('is-active');
      showTip(series[i], m.l + i * slot + slot / 2, Math.min(yOf(0), yOf(vals[i])));
    }
    cols.addEventListener('mousemove', function (e) {
      var g = e.target.closest('.col'); if (g) activate(+g.dataset.i, e);
    });
    cols.addEventListener('mouseleave', function () {
      if (active !== null) cols.children[active].classList.remove('is-active');
      active = null; hideTip();
    });
    cols.addEventListener('click', function (e) {
      var g = e.target.closest('.col'); if (!g) return;
      var p = series[+g.dataset.i];
      var touch = e.pointerType === 'touch' || (window.matchMedia && window.matchMedia('(hover: none)').matches);
      if (touch && active !== +g.dataset.i) { activate(+g.dataset.i, e); return; }
      if (p.issue) window.location.href = p.issue;
    });
  }

  function showTip(p, cx, top) {
    var score = p.score === null ? 'Not tracked' : fmt(p.score);
    tip.innerHTML =
      '<div class="tip-head"><span>' + label(new Date(p.date + 'T00:00:00')) + '</span>' +
      '<span class="tip-score">' + (mode === 'daily' ? score : 'Total ' + fmt(p.total)) + '</span></div>' +
      '<div>' + escapeHtml(p.note) + '</div>' +
      (mode === 'daily' ? '' : '<div class="tip-more">That day: ' + score + '</div>') +
      (p.issue ? '<div class="tip-more">Issue ' + p.n + ' · click to read</div>' : '');
    tip.hidden = false;
    var W = el.clientWidth;
    var tw = tip.offsetWidth;
    var left = Math.min(Math.max(0, cx - tw / 2), W - tw);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, top - 10) + 'px';
    tip.style.transform = 'translateY(-100%)';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  document.querySelectorAll('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.mode;
      document.querySelectorAll('.seg-btn').forEach(function (o) {
        var on = o === b;
        o.classList.toggle('is-on', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      draw();
    });
  });

  window.__drawChart = draw;
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(draw, 120); });
  draw();
})();
