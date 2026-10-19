// Midterm Digest: state map of tracked race-rating changes.
(function () {
  var ATLAS = 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json';
  var data = JSON.parse(document.getElementById('moves-data').textContent);

  var NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
    IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
    ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
    NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
  };
  var POSTAL = {};
  Object.keys(NAMES).forEach(function (k) { POSTAL[NAMES[k]] = k; });
  var TYPE_LABEL = { sen: 'Senate', gov: 'Governor', house: 'House' };
  // Display order of the rating scale, R to D.
  var SCALE = ['Solid R', 'Likely R', 'Lean R', 'Tilt R', 'Toss Up', 'Tilt D', 'Lean D', 'Likely D', 'Solid D'];

  function val(label) {
    var l = label.toLowerCase();
    var mag = /solid|safe/.test(l) ? 4 : /likely/.test(l) ? 3 : /lean/.test(l) ? 2 : /tilt/.test(l) ? 1 : 0;
    if (!mag) return 0;
    return /\bd$/.test(l) ? mag : -mag;
  }
  function canon(label) { return SCALE[val(label) + 4]; }
  function cls(label) {
    var v = val(label);
    return v === 0 ? 't0' : (v > 0 ? 'd' : 'r') + Math.abs(v);
  }
  function dir(m) { return Math.sign(val(m.to) - val(m.from)); }
  function fmt(n) { return n > 0 ? '+' + n : (n < 0 ? '−' + Math.abs(n) : '0'); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function shortDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function chip(label) {
    return '<span class="rating rt-' + cls(label) + '">' + esc(canon(label)) + '</span>';
  }

  // Group moves into races.
  var races = {};
  data.moves.forEach(function (m) {
    var key = m.type + ':' + (m.dist || m.st);
    if (!races[key]) races[key] = { key: key, st: m.st, type: m.type, dist: m.dist || null, moves: [] };
    races[key].moves.push(m);
  });
  var raceList = Object.keys(races).map(function (k) {
    var r = races[k];
    r.moves.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    r.before = r.moves[0].from;
    r.now = r.moves[r.moves.length - 1].to;
    r.net = r.moves.reduce(function (s, m) { return s + dir(m); }, 0);
    r.name = r.type === 'house' ? r.dist : NAMES[r.st] + ' ' + TYPE_LABEL[r.type];
    return r;
  });

  var state = { type: 'sen', view: 'now', selected: null };
  var mapEl = document.getElementById('map');
  var side = document.getElementById('map-side');
  var tip = document.getElementById('map-tip');
  var legend = document.getElementById('map-legend');
  var svg, paths, arrowLayer, selLayer, geoPath, centroids = {};

  function racesFor(type, st) {
    return raceList.filter(function (r) {
      return (type === 'all' || r.type === type) && (!st || r.st === st);
    });
  }
  function stateNet(type, st) {
    return racesFor(type, st).reduce(function (s, r) { return s + r.net; }, 0);
  }
  function ratingView() { return (state.type === 'sen' || state.type === 'gov') && state.view !== 'shift'; }

  // ---------------------------------------------------------------- render

  function paint() {
    if (!svg) return;
    var rv = ratingView();
    paths.attr('class', function (f) {
      var st = f.properties.st;
      var rs = racesFor(state.type, st);
      var c = 'state';
      if (!rs.length) c += ' none';
      else if (rv) c += ' rt-' + cls(state.view === 'before' ? rs[0].before : rs[0].now);
      else {
        var n = stateNet(state.type, st);
        c += n > 0 ? ' shift-d' : n < 0 ? ' shift-r' : ' shift-0';
      }
      if (st === state.selected) c += ' is-selected';
      return c;
    });

    selLayer.selectAll('*').remove();
    paths.filter(function (f) { return f.properties.st === state.selected; }).each(function (f) {
      selLayer.append('path').attr('class', 'sel-outline').attr('d', geoPath(f));
    });
    arrowLayer.selectAll('*').remove();
    if (!rv) {
      Object.keys(centroids).forEach(function (st) {
        var n = stateNet(state.type, st);
        if (!n) return;
        var c = centroids[st];
        var L = Math.min(18 + 9 * Math.abs(n), 90);
        var dx = (n > 0 ? -1 : 1) * L * 0.7071, dy = -L * 0.7071;
        arrowLayer.append('line')
          .attr('class', 'arrow ' + (n > 0 ? 'arrow-d' : 'arrow-r'))
          .attr('x1', c[0]).attr('y1', c[1]).attr('x2', c[0] + dx).attr('y2', c[1] + dy)
          .attr('marker-end', 'url(#head-' + (n > 0 ? 'd' : 'r') + ')');
        arrowLayer.append('text')
          .attr('class', 'arrow-label')
          .attr('x', c[0] + dx + (n > 0 ? -4 : 4)).attr('y', c[1] + dy - 4)
          .attr('text-anchor', n > 0 ? 'end' : 'start')
          .text(fmt(n));
      });
    }
    renderLegend(rv);
    renderSide();
  }

  function renderLegend(rv) {
    if (rv) {
      legend.innerHTML = '<div class="scale">' + SCALE.map(function (s) {
        return '<span class="scale-step"><i class="rt-' + cls(s) + '"></i>' + s.replace(' R', '').replace(' D', '').replace('Toss Up', 'Toss-up') + '</span>';
      }).join('') + '</div><div class="scale-ends"><span>Republican</span><span>Democratic</span></div>' +
        '<p class="legend-note">' + (state.view === 'before' ? 'First tracked rating for each race.' : 'Latest tracked rating for each race.') +
        ' <i class="sw none-sw"></i> No tracked change.</p>';
    } else {
      legend.innerHTML = '<p class="legend-note"><span class="leg-arrow d">↖</span> Net moves toward Democrats <span class="leg-arrow r">↗</span> toward Republicans. ' +
        'Arrow length is the net number of moves (+1 or −1 each, as in the score). <i class="sw none-sw"></i> No tracked change.</p>';
    }
  }

  function raceBlock(r) {
    var steps = r.moves.map(function (m) {
      var d = dir(m);
      return '<li><span class="tl-date">' + shortDate(m.date) + '</span>' +
        '<span class="tl-move">' + esc(m.rater) + ': ' + esc(m.from) + ' → ' + esc(m.to) +
        (m.scored ? '' : ' <em>(not scored)</em>') + '</span>' +
        '<b class="' + (d > 0 ? 'pos-text' : d < 0 ? 'neg-text' : '') + '">' + fmt(d) + '</b>' +
        '<a href="issues/' + m.issue + '.html">No. ' + m.issue + '</a></li>';
    }).join('');
    return '<div class="race">' +
      '<div class="race-head"><b>' + esc(r.type === 'house' ? 'House · ' + r.dist : TYPE_LABEL[r.type]) + '</b>' +
      '<span class="race-path">' + chip(r.before) + '<span aria-hidden="true">→</span>' + chip(r.now) + '</span></div>' +
      '<ul class="timeline">' + steps + '</ul></div>';
  }

  function renderSide() {
    var t = state.type;
    if (state.selected) {
      var st = state.selected;
      var rs = racesFor('all', st);
      var focus = rs.filter(function (r) { return t === 'all' || r.type === t; });
      var other = rs.filter(function (r) { return focus.indexOf(r) === -1; });
      var n = stateNet('all', st);
      side.innerHTML =
        '<div class="side-head"><h2>' + esc(NAMES[st]) + '</h2><button type="button" class="side-close" aria-label="Back to all states">×</button></div>' +
        (rs.length
          ? '<p class="side-sum">Net <b class="' + (n > 0 ? 'pos-text' : n < 0 ? 'neg-text' : '') + '">' + fmt(n) + '</b> across ' + rs.length + (rs.length === 1 ? ' race' : ' races') + '.</p>' +
            (focus.length ? focus.map(raceBlock).join('') : '<p class="side-empty">No tracked ' + TYPE_LABEL[t] + ' change here.</p>') +
            (other.length ? '<p class="side-sub">Other races in ' + esc(NAMES[st]) + '</p>' + other.map(raceBlock).join('') : '')
          : '<p class="side-empty">No tracked rating changes in ' + esc(NAMES[st]) + ' yet.</p>');
      side.querySelector('.side-close').addEventListener('click', function () { select(null); });
      return;
    }
    var list = racesFor(t);
    var byState = {};
    list.forEach(function (r) { (byState[r.st] = byState[r.st] || []).push(r); });
    var sts = Object.keys(byState).sort(function (a, b) {
      return Math.abs(stateNet(t, b)) - Math.abs(stateNet(t, a)) || NAMES[a].localeCompare(NAMES[b]);
    });
    var label = t === 'all' ? 'races' : TYPE_LABEL[t] + (t === 'house' ? ' districts' : ' races');
    side.innerHTML =
      '<h2>' + list.length + ' ' + label + ' moved</h2>' +
      '<p class="side-sum">In ' + sts.length + ' states. Select a state on the map or below for its full history.</p>' +
      '<ul class="state-list">' + sts.map(function (st) {
        var rs = byState[st], n = stateNet(t, st);
        var detail = ratingView()
          ? '<span class="race-path">' + chip(rs[0].before) + '<span aria-hidden="true">→</span>' + chip(rs[0].now) + '</span>'
          : '<span class="sl-count">' + rs.length + (rs.length === 1 ? ' race' : ' races') + '</span>';
        return '<li><button type="button" data-st="' + st + '"><span class="sl-name">' + esc(NAMES[st]) + '</span>' + detail +
          '<b class="' + (n > 0 ? 'pos-text' : n < 0 ? 'neg-text' : '') + '">' + fmt(n) + '</b></button></li>';
      }).join('') + '</ul>';
    side.querySelectorAll('[data-st]').forEach(function (b) {
      b.addEventListener('click', function () { select(b.dataset.st); });
    });
  }

  function select(st) {
    state.selected = st;
    paint();
    if (st && window.matchMedia('(max-width: 900px)').matches) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderOutlook() {
    var el = document.getElementById('outlook');
    function dist(type, which) {
      var counts = SCALE.map(function () { return 0; });
      racesFor(type).forEach(function (r) { counts[val(r[which]) + 4]++; });
      return counts;
    }
    function bar(counts, total) {
      return '<div class="dist-bar">' + counts.map(function (c, i) {
        if (!c) return '';
        return '<span class="rt-' + cls(SCALE[i]) + '" style="flex:' + c + '" title="' + SCALE[i] + ': ' + c + '">' + c + '</span>';
      }).join('') + '</div>';
    }
    function summary(type) {
      var rs = racesFor(type);
      var b = dist(type, 'before'), n = dist(type, 'now');
      var dBefore = b.slice(5).reduce(function (a, c) { return a + c; }, 0);
      var dNow = n.slice(5).reduce(function (a, c) { return a + c; }, 0);
      var rBefore = b.slice(0, 4).reduce(function (a, c) { return a + c; }, 0);
      var rNow = n.slice(0, 4).reduce(function (a, c) { return a + c; }, 0);
      var toward = rs.filter(function (r) { return r.net > 0; }).length;
      return '<div class="outlook-card">' +
        '<h3>' + TYPE_LABEL[type] + ' <span>' + rs.length + ' races moved, ' + toward + ' toward Democrats</span></h3>' +
        '<div class="dist-row"><span class="dist-label">Before</span>' + bar(b) + '</div>' +
        '<div class="dist-row"><span class="dist-label">Now</span>' + bar(n) + '</div>' +
        '<p>Favoring Democrats (Tilt D or better): <b>' + dBefore + ' → ' + dNow + '</b>. Favoring Republicans: <b>' + rBefore + ' → ' + rNow + '</b>.</p>' +
        '</div>';
    }
    var house = racesFor('house');
    var hD = house.filter(function (r) { return r.net > 0; }).length;
    var hStates = {};
    house.forEach(function (r) { hStates[r.st] = 1; });
    var un = data.unitemized.reduce(function (s, u) { return s + u.count; }, 0);
    el.innerHTML =
      '<h2>Direction of travel</h2>' +
      '<p class="outlook-dek">Among races whose ratings moved, how the tracked ratings were spread out before the moves and now.</p>' +
      '<div class="outlook-grid">' + summary('sen') + summary('gov') +
      '<div class="outlook-card"><h3>House <span>' + house.length + ' districts in ' + Object.keys(hStates).length + ' states</span></h3>' +
      '<div class="dist-row"><span class="dist-label">Before</span>' + bar(dist('house', 'before')) + '</div>' +
      '<div class="dist-row"><span class="dist-label">Now</span>' + bar(dist('house', 'now')) + '</div>' +
      '<p>' + hD + ' of ' + house.length + ' districts moved toward Democrats. Plus ' + un + ' more House moves, also toward Democrats, that were never itemized by district.</p></div>' +
      '</div>';
  }

  function renderTable() {
    var tbody = document.querySelector('#race-table tbody');
    var order = { sen: 0, gov: 1, house: 2 };
    tbody.innerHTML = raceList.slice().sort(function (a, b) {
      return order[a.type] - order[b.type] || a.name.localeCompare(b.name);
    }).map(function (r) {
      return '<tr><td>' + esc(r.type === 'house' ? 'House · ' + r.dist : r.name) + '</td><td>' + chip(r.before) + '</td><td>' + chip(r.now) + '</td>' +
        '<td class="num ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'zero') + '">' + fmt(r.net) + '</td>' +
        '<td>' + r.moves.map(function (m) { return esc(m.rater) + ' ' + shortDate(m.date); }).join(', ') + '</td></tr>';
    }).join('');
    var u = data.unitemized.map(function (x) { return x.note; }).join(' ');
    document.getElementById('map-note').innerHTML =
      'How to read this: ratings come from whichever rater moved the race (Cook, Sabato or Inside Elections), so a race’s starting point and current rating can come from different raters. ' +
      '“Tilt” is Inside Elections’ half-step between Lean and Toss-up. “Before” is the first rating the digest tracked, which is not necessarily where the race began the cycle. ' +
      'States in gray had no tracked change, which doesn’t mean their races are safe. ' + esc(u);
  }

  // ---------------------------------------------------------------- tooltip

  function showTip(evt, st) {
    var rs = racesFor(state.type, st);
    var body = rs.length
      ? rs.slice(0, 6).map(function (r) {
        return '<div class="tip-row"><span>' + esc(r.type === 'house' ? r.dist : TYPE_LABEL[r.type]) + '</span><span>' +
          esc(canon(r.before)) + ' → ' + esc(canon(r.now)) + '</span></div>';
      }).join('') + (rs.length > 6 ? '<div class="tip-more">+' + (rs.length - 6) + ' more</div>' : '')
      : '<div class="tip-more">No tracked ' + (state.type === 'all' ? '' : TYPE_LABEL[state.type] + ' ') + 'change</div>';
    tip.innerHTML = '<div class="tip-head"><span>' + esc(NAMES[st]) + '</span>' +
      (rs.length ? '<span class="tip-score">' + fmt(stateNet(state.type, st)) + '</span>' : '') + '</div>' + body;
    tip.hidden = false;
    var box = mapEl.getBoundingClientRect();
    var x = evt.clientX - box.left, y = evt.clientY - box.top;
    var tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(0, x - tw / 2), box.width - tw) + 'px';
    tip.style.top = Math.max(0, y - 14) + 'px';
    tip.style.transform = 'translateY(-100%)';
  }

  // ---------------------------------------------------------------- controls

  function setSeg(id, attr, value) {
    document.querySelectorAll('#' + id + ' .seg-btn').forEach(function (b) {
      var on = b.dataset[attr] === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function syncViewButtons() {
    var allowRating = state.type === 'sen' || state.type === 'gov';
    document.querySelectorAll('#view-seg .seg-btn').forEach(function (b) {
      if (b.dataset.view !== 'shift') {
        b.disabled = !allowRating;
        b.title = allowRating ? '' : 'Before and Now apply to statewide races. House and All show shift.';
      }
    });
    if (!allowRating && state.view !== 'shift') { state.forced = state.view; state.view = 'shift'; }
    else if (allowRating) state.forced = null;
    setSeg('view-seg', 'view', state.view);
  }
  document.querySelectorAll('#type-seg .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      state.type = b.dataset.type;
      if ((state.type === 'sen' || state.type === 'gov') && state.forced) state.view = state.forced;
      setSeg('type-seg', 'type', state.type);
      syncViewButtons();
      paint();
    });
  });
  document.querySelectorAll('#view-seg .seg-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.disabled) return;
      state.view = b.dataset.view;
      state.forced = null;
      setSeg('view-seg', 'view', state.view);
      paint();
    });
  });

  // ---------------------------------------------------------------- map

  renderOutlook();
  renderTable();
  renderSide();
  renderLegend(true);

  fetch(ATLAS).then(function (r) { return r.json(); }).then(function (us) {
    var features = topojson.feature(us, us.objects.states).features;
    features.forEach(function (f) { f.properties.st = POSTAL[f.properties.name]; });
    var path = geoPath = d3.geoPath();
    svg = d3.select(mapEl).append('svg').attr('viewBox', '0 0 975 610').attr('aria-hidden', 'true');
    var defs = svg.append('defs');
    ['d', 'r'].forEach(function (k) {
      defs.append('marker').attr('id', 'head-' + k).attr('viewBox', '0 0 10 10')
        .attr('refX', 6).attr('refY', 5).attr('markerWidth', 5).attr('markerHeight', 5).attr('orient', 'auto-start-reverse')
        .append('path').attr('d', 'M0,0 L10,5 L0,10 Z').attr('class', 'head-' + k);
    });
    paths = svg.append('g').selectAll('path').data(features).join('path')
      .attr('d', path)
      .on('mousemove', function (e, f) { showTip(e, f.properties.st); })
      .on('mouseleave', function () { tip.hidden = true; })
      .on('click', function (e, f) { select(state.selected === f.properties.st ? null : f.properties.st); });
    svg.append('path').attr('class', 'state-mesh')
      .attr('d', path(topojson.mesh(us, us.objects.states, function (a, b) { return a !== b; })));
    features.forEach(function (f) { centroids[f.properties.st] = path.centroid(f); });
    // Nudge centroids that land awkwardly.
    if (centroids.FL) centroids.FL[0] += 18;
    if (centroids.MI) { centroids.MI[0] += 12; centroids.MI[1] += 22; }
    if (centroids.LA) centroids.LA[0] -= 10;
    selLayer = svg.append('g');
    arrowLayer = svg.append('g').attr('class', 'arrows');
    paint();
  }).catch(function () {
    mapEl.innerHTML = '<p class="map-error">The map outline couldn’t load. The state list and table still have every race.</p>';
  });
})();
