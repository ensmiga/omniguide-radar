/* OmniGuide - application shell.
   Radar (where) -> Guide (when and how) -> Legal Gate (may I), plus saved
   locations, seven-day planning, alerts, logging and the entitlement model. */
(function (global) {
  'use strict';

  var geo = global.OG.geo, env = global.OG.env, models = global.OG.models,
      regs = global.OG.regs, guide = global.OG.guide, radarNS = global.OG.radar;

  /* ---------- Storage ---------- */

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }

  var DEFAULT_SPOTS = [
    { id: 's1', name: 'Backwater Blind', lon: -107.952, lat: 45.335, note: 'Side channel, walk-in' },
    { id: 's2', name: 'Right Bank', lon: -107.918, lat: 45.299, note: 'Bank blind above the riffle' },
    { id: 's3', name: 'The Island', lon: -107.977, lat: 45.372, note: 'Upper island, boat only' },
    { id: 's4', name: 'Corn Field', lon: -107.884, lat: 45.286, note: 'Dry field, permission' }
  ];

  /* ---------- App ---------- */

  /* Species ids changed when the individual duck species were merged, so an
     entitlement stored under an old id falls back rather than breaking. */
  function validSpecies(id) {
    return models.byId(id) ? id : 'ducks';
  }

  var App = {
    state: {
      species: 'ducks',
      layer: 'opportunity',
      basemap: load('og.basemap', 'relief'),
      t: 1,
      playing: false,
      legalOverlay: true,
      selection: null,
      spots: load('og.spots', DEFAULT_SPOTS),
      logs: load('og.logs', []),
      ent: load('og.ent', { pro: false, state: 'MT', species: 'ducks', changed: Date.now() })
    },
    dirty: true,
    _theme: null
  };
  App.state.ent.species = validSpecies(App.state.ent.species);

  App.theme = function () {
    if (this._theme) return this._theme;
    var cs = getComputedStyle(document.documentElement);
    this._theme = {
      mapBg: cs.getPropertyValue('--map-bg').trim(),
      land: cs.getPropertyValue('--map-land').trim(),
      border: cs.getPropertyValue('--map-border').trim(),
      county: cs.getPropertyValue('--map-county').trim(),
      halo: cs.getPropertyValue('--map-halo').trim(),
      stateLabel: cs.getPropertyValue('--map-state-label').trim(),
      countyLabel: cs.getPropertyValue('--map-county-label').trim(),
      cityLabel: cs.getPropertyValue('--map-city-label').trim(),
      water: cs.getPropertyValue('--map-water').trim(),
      outRange: cs.getPropertyValue('--map-outrange').trim(),
      graticule: cs.getPropertyValue('--graticule').trim(),
      micro: cs.getPropertyValue('--micro').trim(),
      label: cs.getPropertyValue('--text').trim()
    };
    return this._theme;
  };

  App.speciesName = function (id) { var s = models.byId(id); return s ? s.name : id; };

  /* How old the baked forecast is, in plain words. */
  App.wxNote = function () {
    var W = global.OG.wx;
    if (!W || !W.available()) return 'Synthetic forecast - no live feed in this build.';
    var h = W.staleHours();
    var age = h < 1 ? 'under an hour' : h < 48 ? Math.round(h) + ' hours' : Math.round(h / 24) + ' days';
    return 'Open-Meteo multi-model blend, run captured ' + age + ' ago. Snapshot, not live.';
  };

  /* t carries a time of day, so the day is the floor of it, never the round. */
  App.dayIndex = function () {
    return Math.max(0, Math.min(6, Math.floor(this.state.t)));
  };

  App.entitlement = function () {
    var e = this.state.ent;
    var st = null;
    for (var i = 0; i < geo.states.length; i++) if (geo.states[i].abbr === e.state) st = geo.states[i];
    return { pro: e.pro, state: e.state, stateName: st ? st.name : e.state, species: e.species };
  };

  App.unlockedAt = function (lon, lat, spId) {
    var e = this.entitlement();
    if (e.pro) return true;
    var si = geo.stateIndexAt(lon, lat);
    if (si < 0) return false;
    return geo.states[si].abbr === e.state && spId === e.species;
  };

  var spotScoreCache = new Map();
  App.spotScore = function (spot, t) {
    var k = spot.id + ':' + t + ':' + this.state.species;
    var v = spotScoreCache.get(k);
    if (!v) {
      var d = guide.dateFor(t);
      var sc = models.scoreAt(spot.lon, spot.lat, t, env.doyFor(t), this.state.species);
      v = { opp: sc.opportunity, conf: sc.confidence, mig: sc.migration, nb: sc.newBird, wx: sc.wx };
      spotScoreCache.set(k, v);
    }
    return v;
  };

  /* ---------- Small DOM helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function frag() { return document.createDocumentFragment(); }
  function $(sel) { return document.querySelector(sel); }

  function band(v) {
    return v >= 90 ? 'Exceptional' : v >= 80 ? 'Very good' : v >= 70 ? 'Good' :
           v >= 60 ? 'Fair' : v >= 50 ? 'Marginal' : 'Poor';
  }

  function fmtDay(d) {
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return days[d.getDay()] + ', ' + mon[d.getMonth()] + ' ' + d.getDate();
  }
  function shortDay(i, d) {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  }

  function statusChip(status) {
    var c = el('span', 'chip status-' + status.toLowerCase().replace(/\s/g, ''), status);
    return c;
  }

  /* ---------- Layers ---------- */

  var LAYERS = [
    { id: 'opportunity', name: 'Opportunity', desc: 'Overall OmniGuide Opportunity Score' },
    { id: 'movement', name: 'Movement', desc: 'Expected local animal activity' },
    { id: 'migration', name: 'Migration', desc: 'Expected migratory movement' },
    { id: 'newbird', name: 'New birds', desc: 'Probability fresh birds are arriving' },
    { id: 'legal', name: 'Legal', desc: 'Season status for the selected species' },
    { id: 'confidence', name: 'Confidence', desc: 'How much to trust the prediction' },
    { id: 'temp', name: 'Temp', wx: true, desc: 'Forecast temperature' },
    { id: 'wind', name: 'Wind', wx: true, desc: 'Forecast wind speed, with streamlines' },
    { id: 'gusts', name: 'Gusts', wx: true, desc: 'Forecast wind gusts' },
    { id: 'precip', name: 'Precip', wx: true, desc: 'Forecast precipitation' },
    { id: 'cloud', name: 'Cloud', wx: true, desc: 'Forecast cloud cover' },
    { id: 'snowpack', name: 'Snow', wx: true, desc: 'Forecast snow depth' }
  ];

  /* ---------- Charts ---------- */

  function hourlyChart(plan) {
    var sun = plan.hours.sun;
    var lo = Math.max(0, (sun.dawn != null ? sun.dawn / 60 : 5) - 1.0);
    var hi = Math.min(24, (sun.dusk != null ? sun.dusk / 60 : 19) + 1.0);
    var W = 100, H = 34, padB = 6;
    var sx = function (h) { return (h - lo) / (hi - lo) * W; };
    var sy = function (a) { return (H - padB) - a * (H - padB - 2); };

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'hchart');
    svg.setAttribute('preserveAspectRatio', 'none');

    function add(tag, attrs) {
      var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      svg.appendChild(n);
      return n;
    }

    if (plan.hours.start != null) {
      var a = Math.max(lo, plan.hours.start / 60), b = Math.min(hi, plan.hours.end / 60);
      add('rect', { x: sx(a), y: 0, width: Math.max(0, sx(b) - sx(a)), height: H - padB, 'class': 'legalband' });
    }
    if (plan.legalWindow) {
      var wa = Math.max(lo, plan.legalWindow.startMin / 60), wb = Math.min(hi, plan.legalWindow.endMin / 60);
      add('rect', { x: sx(wa), y: 0, width: Math.max(0, sx(wb) - sx(wa)), height: H - padB, 'class': 'bestband' });
    }

    var d = '', dA = '';
    for (var i = 0; i < plan.curve.length; i++) {
      var p = plan.curve[i];
      if (p.h < lo || p.h > hi) continue;
      var X = sx(p.h), Y = sy(p.a);
      d += (d ? 'L' : 'M') + X.toFixed(2) + ' ' + Y.toFixed(2);
    }
    dA = d + 'L' + W + ' ' + (H - padB) + 'L0 ' + (H - padB) + 'Z';
    add('path', { d: dA, 'class': 'curvefill' });
    add('path', { d: d, 'class': 'curveline' });

    for (var h = Math.ceil(lo); h <= hi; h += 2) {
      add('line', { x1: sx(h), y1: H - padB, x2: sx(h), y2: H - padB + 2, 'class': 'tick' });
      var t = add('text', { x: sx(h), y: H - 0.5, 'class': 'tlab' });
      t.textContent = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p');
    }
    return svg;
  }

  function weekChart(series, container) {
    var best = 0;
    series.forEach(function (s) { if (s.opp > series[best].opp) best = s.day; });
    var wrap = el('div', 'week');
    series.forEach(function (s) {
      var c = el('div', 'wk' + (s.day === best ? ' wk-best' : ''));
      var bar = el('div', 'wkbar');
      var fill = el('div', 'wkfill');
      fill.style.height = Math.max(4, s.opp) + '%';
      fill.style.background = radarNS.rampCSS(s.opp / 100, 0.92);
      bar.appendChild(fill);
      c.appendChild(el('div', 'wkval', String(s.opp)));
      c.appendChild(bar);
      c.appendChild(el('div', 'wkday', shortDay(s.day, s.date).slice(0, 3)));
      var dot = el('div', 'wkstat s-' + s.status.toLowerCase());
      dot.title = 'Season status: ' + s.status;
      c.appendChild(dot);
      wrap.appendChild(c);
    });
    container.appendChild(wrap);
    return best;
  }

  /* ---------- Panel plumbing ---------- */

  var panel, scrim, panelBody, panelTitle;

  function openPanel(title, builder) {
    panelTitle.textContent = title;
    panelBody.innerHTML = '';
    panelBody.appendChild(builder());
    panel.hidden = false;
    scrim.hidden = false;
    panelBody.scrollTop = 0;
  }
  function closePanel() { panel.hidden = true; scrim.hidden = true; }

  function section(title) {
    var s = el('section', 'sec');
    if (title) s.appendChild(el('h3', 'sech', title));
    return s;
  }

  function kvList(items) {
    var dl = el('dl', 'kv');
    items.forEach(function (it) {
      dl.appendChild(el('dt', null, it.k));
      var dd = el('dd');
      if (Array.isArray(it.v)) {
        var ul = el('ul');
        it.v.forEach(function (line) { ul.appendChild(el('li', null, line)); });
        dd.appendChild(ul);
      } else dd.textContent = it.v;
      dl.appendChild(dd);
    });
    return dl;
  }

  /* ---------- The Plan ---------- */

  function buildPlan(lon, lat, spotName) {
    var st = App.state;

    if (!App.unlockedAt(lon, lat, st.species)) return buildLocked(lon, lat);

    /* Scored at the exact time on the slider, not at midnight of the day, so
       this number matches the hexagon the user tapped. */
    var plan = guide.plan(lon, lat, st.t, st.species);
    var sc = plan.score;
    var root = frag();

    if (!sc.inRange || (plan.legal.state && !regs.hasSeasonRecord(plan.legal.state.abbr, st.species))) {
      var oh = el('div', 'planhead');
      oh.appendChild(el('div', 'ph-title', plan.place.title));
      oh.appendChild(el('div', 'ph-sub', plan.place.sub + '  ·  ' + plan.place.coords));
      root.appendChild(oh);
      var ob = el('div', 'gate gate-outrange');
      ob.appendChild(el('div', 'gate-h', 'Outside the ' + App.speciesName(st.species).toLowerCase() + ' range'));
      var why = !sc.inRange
        ? (sc.outReason === 'habitat'
            ? 'The terrain and land cover here do not support this species.'
            : 'Occurrence records show this species is effectively absent here.')
        : 'No season record exists for this species in ' +
          (plan.legal.state ? plan.legal.state.name : 'this state') + '.';
      ob.appendChild(el('div', 'gate-b', why +
        ' OmniGuide does not produce an opportunity score where the species is not a huntable resource.'));
      root.appendChild(ob);
      var alt = section('What you can do here');
      alt.appendChild(el('p', null, 'Switch species in the top bar, or move to country where this one ' +
        'actually lives. The map leaves out-of-range ground blank for the selected species.'));
      root.appendChild(alt);
      return root;
    }

    /* Header */
    var head = el('div', 'planhead');
    head.appendChild(el('div', 'ph-title', spotName || plan.place.title));
    head.appendChild(el('div', 'ph-sub', plan.place.sub + '  ·  ' + plan.place.coords));
    head.appendChild(el('div', 'ph-date', fmtDay(plan.date) + ' · ' + clockAt(st.t) +
      '  ·  ' + plan.species.name));
    head.appendChild(el('div', 'ph-cell', spotName
      ? 'Scored at the saved coordinates'
      : 'Scored at these exact coordinates'));
    root.appendChild(head);

    /* Score block */
    var legalOk = plan.legal.status === 'OPEN' || plan.legal.status === 'LIMITED';
    var sb = el('div', 'scoreblock');
    var big = el('div', 'bigscore');
    big.style.color = radarNS.rampCSS(sc.opportunity / 100, 1);
    big.appendChild(el('span', 'bs-num', String(sc.opportunity)));
    big.appendChild(el('span', 'bs-den', '/100'));
    sb.appendChild(big);
    var sbr = el('div', 'sb-right');
    sbr.appendChild(el('div', 'bs-band', band(sc.opportunity)));
    sbr.appendChild(el('div', 'bs-lab', legalOk ? 'OmniGuide Opportunity Score'
                                                : 'Biological activity only. This is not a statement that hunting is permitted.'));
    sb.appendChild(sbr);
    root.appendChild(sb);

    if (!legalOk) {
      var warn = el('div', 'gate gate-' + plan.legal.status.toLowerCase());
      warn.appendChild(el('div', 'gate-h', plan.legal.status === 'CLOSED' ? 'SEASON CLOSED'
        : plan.legal.status === 'PERMIT' ? 'PERMIT REQUIRED' : 'REGULATION STATUS UNKNOWN'));
      warn.appendChild(el('div', 'gate-b', plan.legal.reason +
        ' The score above describes animal activity, not a hunting opportunity.'));
      root.appendChild(warn);
    }

    /* Metric row */
    var mets = [
      { k: 'Season reference', v: plan.legal.status, chip: true },
      { k: 'Confidence', v: sc.confidence + '%' },
      { k: 'Movement', v: sc.movement },
      { k: 'Migration', v: sc.mig.applies ? sc.migration : '—' },
      { k: 'New birds', v: sc.mig.applies ? sc.newBird + '%' : '—' },
      { k: 'Habitat', v: sc.habitat }
    ];
    var mr = el('div', 'metrics');
    mets.forEach(function (m) {
      var c = el('div', 'metric');
      c.appendChild(el('div', 'm-k', m.k));
      if (m.chip) c.appendChild(statusChip(m.v));
      else c.appendChild(el('div', 'm-v', String(m.v)));
      mr.appendChild(c);
    });
    root.appendChild(mr);

    /* Window */
    var winSec = section('Best window');
    if (plan.legalWindow) {
      var wrow = el('div', 'window');
      wrow.appendChild(el('div', 'win-label', 'Peak activity window'));
      wrow.appendChild(el('div', 'win-time',
        env.hhmm(plan.legalWindow.startMin) + ' – ' + env.hhmm(plan.legalWindow.endMin) +
        ' ' + plan.hours.sun.tz));
      winSec.appendChild(wrow);
      if (plan.bioWindow && plan.hours.start != null &&
          plan.bioWindow.startMin < plan.hours.start - 1) {
        winSec.appendChild(el('p', 'note',
          'Biological movement starts around ' + env.hhmm(plan.bioWindow.startMin) +
          ', before legal shooting light at ' + env.hhmm(plan.hours.start) +
          '. The window above is clipped to legal hours.'));
      }
    }
    var sunLine = el('div', 'sunline');
    sunLine.appendChild(el('span', null, 'Sunrise ' + env.hhmm(plan.hours.sun.sunrise)));
    sunLine.appendChild(el('span', null, 'Sunset ' + env.hhmm(plan.hours.sun.sunset)));
    if (plan.hours.start != null) sunLine.appendChild(el('span', 'accent',
      'Legal ' + env.hhmm(plan.hours.start) + '–' + env.hhmm(plan.hours.end)));
    winSec.appendChild(sunLine);
    winSec.appendChild(hourlyChart(plan));
    winSec.appendChild(el('div', 'chartkey',
      'Shaded band = legal hours. Brighter band = predicted peak activity inside them.'));
    root.appendChild(winSec);

    /* Recommendation */
    var recSec = section('OmniGuide recommendation');
    plan.body.recommendation.forEach(function (p) { recSec.appendChild(el('p', null, p)); });

    /* Terrain is measured from elevation tiles, which arrive over the
       network, so the panel renders immediately and this fills in. */
    var tSlot = el('div', 'terrain-slot');
    tSlot.appendChild(el('p', 'note', 'Reading the ground at these coordinates…'));
    recSec.appendChild(tSlot);
    root.appendChild(recSec);

    if (global.OG.terrain) {
      global.OG.terrain.analyse(lon, lat).then(function (T) {
        if (!tSlot.isConnected) return;
        tSlot.innerHTML = '';
        if (!T) {
          tSlot.appendChild(el('p', 'note', 'Elevation data could not be reached, so the advice above ' +
            'is based on the regional habitat model rather than the ground at this point.'));
          return;
        }
        var notes = guide.terrainNotes(T, sc, plan.species) || [];
        notes.forEach(function (n) { tSlot.appendChild(el('p', null, n)); });
        var extra = guide.terrainSetup(T);
        if (extra) tSlot.appendChild(kvList([extra]));
      });
    }

    /* Fly fishing extras */
    if (plan.body.hatches) {
      var hsec = section('Hatch forecast');
      var tbl = el('div', 'hatches');
      plan.body.hatches.slice(0, 5).forEach(function (h) {
        var r = el('div', 'hrow');
        r.appendChild(el('div', 'h-n', h.n));
        var barw = el('div', 'h-bar');
        var f = el('div', 'h-fill');
        f.style.width = Math.round(h.v * 100) + '%';
        f.style.background = radarNS.rampCSS(h.v, 0.9);
        barw.appendChild(f);
        r.appendChild(barw);
        r.appendChild(el('div', 'h-v', h.v > 0.6 ? 'High' : h.v > 0.33 ? 'Moderate' : 'Low'));
        tbl.appendChild(r);
      });
      hsec.appendChild(tbl);
      var fr = el('div', 'metrics two');
      [['Surface feeding', plan.body.surface + '%'], ['Streamer activity', plan.body.streamer + '%']]
        .forEach(function (p) {
          var c = el('div', 'metric');
          c.appendChild(el('div', 'm-k', p[0]));
          c.appendChild(el('div', 'm-v', p[1]));
          fr.appendChild(c);
        });
      hsec.appendChild(fr);
      root.appendChild(hsec);

      /* Local shops. Linked and credited, never copied - the report is
         theirs and so is the traffic. */
      if (plan.body.shops && plan.body.shops.length) {
        var shSec = section('Local reports and flies');
        shSec.appendChild(el('p', 'note', 'These shops fish this water every day and post their own ' +
          'reports. For what actually came off yesterday and what the fish ate, they beat any model.'));
        plan.body.shops.forEach(function (s) {
          var row = el('div', 'shoprow');
          var a = el('a', 'shop-link', s.shop.n);
          a.href = s.shop.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          row.appendChild(a);
          row.appendChild(el('div', 'shop-meta', s.shop.town +
            (s.onWater ? '  ·  fishes this water' : '  ·  about ' + s.miles + ' miles away')));
          shSec.appendChild(row);
        });
        shSec.appendChild(el('p', 'note', 'OmniGuide links to shop reports rather than reproducing them. ' +
          'If a pattern they recommend is working, buy it from them.'));
        root.appendChild(shSec);
      }
    }

    /* Setup */
    var setSec = section(plan.species.pursuit === 'fish' ? 'Rig and approach' : 'Setup recommendation');
    setSec.appendChild(kvList(plan.body.setup));
    root.appendChild(setSec);

    /* Why */
    var whySec = section('Why OmniGuide reads it this way');
    if (plan.positives.length) {
      var ul = el('ul', 'drivers pos');
      plan.positives.forEach(function (p) { ul.appendChild(el('li', null, p.t)); });
      whySec.appendChild(ul);
    }
    if (plan.negatives.length) {
      var ul2 = el('ul', 'drivers neg');
      plan.negatives.forEach(function (p) { ul2.appendChild(el('li', null, p.t)); });
      whySec.appendChild(ul2);
    }
    root.appendChild(whySec);

    /* Seven day */
    var wkSec = section('Next seven days here');
    var series = guide.outlook(lon, lat, st.species);
    var best = weekChart(series, wkSec);
    wkSec.appendChild(el('p', 'note',
      shortDay(best, series[best].date) + ' currently provides the strongest ' +
      plan.species.name.toLowerCase() + ' opportunity over the next seven days at this location (' +
      series[best].opp + '/100).'));
    root.appendChild(wkSec);

    /* Legal gate detail */
    var lgSec = section('Season reference (unverified)');
    var lgItems = [
      { k: 'Status', v: plan.legal.status },
      { k: 'Jurisdiction', v: plan.legal.state ? plan.legal.state.name : 'Unknown' },
      { k: 'County', v: plan.place.county ? plan.place.county.name + ' County' : 'Unknown' },
      { k: 'Zone', v: plan.legal.zone ? plan.legal.zone.name : 'Unknown' },
      { k: 'Season record', v: plan.legal.typeName || 'No record on file' },
      { k: 'Shooting hours', v: plan.hours.label },
      { k: 'Source agency', v: plan.legal.agency || 'Unknown' }
    ];
    if (plan.legal.bag) lgItems.push({ k: 'Daily bag', v: plan.legal.bag });
    if (plan.legal.possession) lgItems.push({ k: 'Possession', v: plan.legal.possession });
    if (plan.legal.special) lgItems.push({ k: 'Special area', v: plan.legal.special.n });
    if (plan.legal.note) lgItems.push({ k: 'Note', v: plan.legal.note });
    lgSec.appendChild(kvList(lgItems));
    lgSec.appendChild(el('div', 'verify', 'Record verification: UNVERIFIED PLACEHOLDER. ' + regs.DISCLAIMER));
    root.appendChild(lgSec);

    /* Failure modes */
    var fSec = section('What could make this plan fail');
    var fl = el('ul', 'drivers warn');
    plan.failures.forEach(function (f) { fl.appendChild(el('li', null, f)); });
    fSec.appendChild(fl);
    root.appendChild(fSec);

    /* How the number was made */
    var bd = sc.breakdown;
    var mSec = section('How this number was made');
    var tbl = el('div', 'calc');
    function calcRow(k, v, w, c, cls) {
      var r = el('div', 'calcrow' + (cls ? ' ' + cls : ''));
      r.appendChild(el('div', 'c-k', k));
      r.appendChild(el('div', 'c-v', v));
      r.appendChild(el('div', 'c-w', w));
      r.appendChild(el('div', 'c-c', c));
      return r;
    }
    tbl.appendChild(calcRow('Component', 'Value', 'Weight', 'Adds', 'calchead'));
    if (bd.distIdx != null) {
      tbl.appendChild(calcRow('Habitat model', Math.round(bd.habModel), '', '', 'calcsub'));
      tbl.appendChild(calcRow('· observed range index', Math.round(bd.distIdx * 100),
        (bd.distWeight * 100).toFixed(0) + '% pull', '→ ' + Math.round(bd.habAdjusted), 'calcsub'));
    }
    bd.parts.forEach(function (p) {
      if (!p.w) return;
      tbl.appendChild(calcRow(p.k, Math.round(p.v), (p.w / bd.totalWeight).toFixed(2),
        (p.w * p.v / bd.totalWeight).toFixed(1)));
    });
    tbl.appendChild(calcRow('Weighted mean', '', '', bd.weighted.toFixed(1), 'calcsum'));
    tbl.appendChild(calcRow('Hunter pressure', Math.round(bd.pressureIdx * 100),
      '−' + (bd.pressureSens * 100).toFixed(0) + '% max', '−' + bd.pressureDrop.toFixed(1)));
    tbl.appendChild(calcRow('Spread ×' + bd.spread + ' about ' + bd.pivot, '', '',
      bd.afterPressure.toFixed(1) + ' → ' + bd.final, 'calcsum'));
    mSec.appendChild(tbl);
    mSec.appendChild(el('p', 'note', 'Weights are specific to ' + plan.species.name.toLowerCase() +
      '. The spread step stretches the distribution so the map is readable; it changes contrast, ' +
      'not ranking.'));
    mSec.appendChild(el('p', 'note', 'Not in this number: land access, whether the habitat is in good ' +
      'condition this year, last season’s production, stocking or harvest history, or anything ' +
      'about the previous winter. Those matter, several of them more than today’s weather.'));
    root.appendChild(mSec);

    /* Conditions detail */
    var cSec = section('Conditions behind the score');
    var wx = sc.wx;
    cSec.appendChild(kvList([
      { k: 'Temperature', v: Math.round(wx.tempF) + '°F (' + (wx.temp24 >= 0 ? '+' : '') +
          Math.round(wx.temp24) + '° in 24h)' },
      { k: 'Wind', v: env.dirName(wx.windFrom) + ' ' + Math.round(wx.windSpd) + ' mph, gusts ' +
          Math.round(wx.gust) },
      { k: 'Pressure', v: Math.round(wx.pressure) + ' hPa, ' +
          (wx.pressTrend > 0.15 ? 'rising' : wx.pressTrend < -0.15 ? 'falling' : 'steady') },
      { k: 'Cloud', v: Math.round(wx.cloud * 100) + '%' },
      { k: 'Freeze index', v: Math.round(wx.freeze * 100) + '%' },
      { k: 'Water temperature', v: Math.round(wx.waterTemp) + '°F' },
      { k: 'Habitat', v: (sc.hab.region || sc.hab.water || 'Unnamed') + ' · ' +
          Math.round(sc.hab.elev) + ' ft' },
      { k: 'Estimated pressure', v: sc.pressure + '/100 hunting pressure proxy' }
    ]));
    root.appendChild(cSec);

    /* Actions */
    var acts = el('div', 'actions');
    if (!spotName) {
      var saveBtn = el('button', 'btn primary', 'Save this spot');
      saveBtn.addEventListener('click', function () {
        var name = prompt('Name this location', plan.place.title);
        if (!name) return;
        App.state.spots.push({ id: 'u' + Date.now(), name: name, lon: lon, lat: lat, note: '' });
        save('og.spots', App.state.spots);
        spotScoreCache.clear();
        App.dirty = true;
        renderSpotsPanel();
      });
      acts.appendChild(saveBtn);
    }
    var logBtn = el('button', 'btn', 'Log an outing here');
    logBtn.addEventListener('click', function () { renderLogPanel({ lon: lon, lat: lat, name: spotName || plan.place.title }); });
    acts.appendChild(logBtn);
    root.appendChild(acts);

    return root;
  }

  function buildLocked(lon, lat) {
    var st = App.state, ent = App.entitlement();
    var sc = models.scoreAt(lon, lat, st.t, env.doyFor(st.t), st.species);
    var place = guide.placeLabel(lon, lat);
    var root = frag();
    var head = el('div', 'planhead');
    head.appendChild(el('div', 'ph-title', place.title));
    head.appendChild(el('div', 'ph-sub', place.sub));
    root.appendChild(head);

    var pv = el('div', 'preview');
    pv.appendChild(el('div', 'pv-band', band(sc.opportunity)));
    pv.appendChild(el('div', 'pv-lab', 'Generalized ' + App.speciesName(st.species).toLowerCase() +
      ' conditions. Exact scores, migration detail and the OmniGuide Plan are part of Pro.'));
    root.appendChild(pv);

    var s = section('Unlock nationwide OmniGuide');
    s.appendChild(el('p', null, 'Your free plan covers ' + ent.stateName + ' and ' +
      App.speciesName(ent.species).toLowerCase() + '. This location is outside that combination.'));
    var ul = el('ul', 'drivers pos');
    ['Every state and every supported species', 'Full Migration and New Bird layers',
     'Detailed hunt and fishing plans', 'Unlimited saved locations and alerts']
      .forEach(function (x) { ul.appendChild(el('li', null, x)); });
    s.appendChild(ul);
    var b = el('button', 'btn primary', 'Simulate Pro in this demo');
    b.addEventListener('click', function () {
      App.state.ent.pro = true;
      save('og.ent', App.state.ent);
      radarNS.clearScores();
      App.dirty = true;
      openPanel('OmniGuide Plan', function () { return buildPlan(lon, lat); });
    });
    s.appendChild(b);
    s.appendChild(el('p', 'note', 'No payment flow is wired up in this build. Entitlements are enforced ' +
      'in the data layer, not by hiding UI.'));
    root.appendChild(s);
    return root;
  }

  /* ---------- Spots ---------- */

  function saveSpot(name, lon, lat, note) {
    App.state.spots.push({
      id: 'u' + Date.now() + Math.floor(Math.random() * 1000),
      name: name, lon: +lon.toFixed(5), lat: +lat.toFixed(5), note: note || ''
    });
    save('og.spots', App.state.spots);
    spotScoreCache.clear();
    App.dirty = true;
  }

  function addSpotAt(lon, lat) {
    var suggested = guide.placeLabel(lon, lat).title;
    var name = prompt('Name this spot', suggested);
    if (!name) return;
    saveSpot(name, lon, lat, '');
    renderSpotsPanel();
  }

  /* GPX and KML import. Reading a file the user picked is local to the
     browser, so this works even where network access does not. */
  function importWaypoints(text, fallbackName) {
    var doc;
    try { doc = new DOMParser().parseFromString(text, 'application/xml'); }
    catch (e) { return 0; }
    if (doc.getElementsByTagName('parsererror').length) return 0;

    var added = 0, i;
    var wpts = doc.getElementsByTagName('wpt');
    for (i = 0; i < wpts.length; i++) {
      var la = parseFloat(wpts[i].getAttribute('lat'));
      var lo = parseFloat(wpts[i].getAttribute('lon'));
      if (!isFinite(la) || !isFinite(lo)) continue;
      var nEl = wpts[i].getElementsByTagName('name')[0];
      saveSpot(nEl && nEl.textContent ? nEl.textContent.trim() : fallbackName + ' ' + (added + 1), lo, la, 'Imported');
      added++;
    }
    if (added) return added;

    var places = doc.getElementsByTagName('Placemark');
    for (i = 0; i < places.length; i++) {
      var pt = places[i].getElementsByTagName('coordinates')[0];
      if (!pt) continue;
      var bits = pt.textContent.trim().split(/\s+/)[0].split(',');
      var klo = parseFloat(bits[0]), kla = parseFloat(bits[1]);
      if (!isFinite(kla) || !isFinite(klo)) continue;
      var kn = places[i].getElementsByTagName('name')[0];
      saveSpot(kn && kn.textContent ? kn.textContent.trim() : fallbackName + ' ' + (added + 1), klo, kla, 'Imported');
      added++;
    }
    return added;
  }

  function spotAdder() {
    var wrap = section('Add a spot');

    var pick = el('button', 'btn primary', 'Pick on the map');
    pick.addEventListener('click', function () {
      App.addSpotMode = true;
      document.body.classList.add('adding');
      closePanel();
    });

    var nameIn = el('input');
    nameIn.type = 'text';
    nameIn.id = 'spot-name';
    nameIn.placeholder = 'Backwater Blind';
    var coordIn = el('input');
    coordIn.type = 'text';
    coordIn.id = 'spot-coord';
    coordIn.placeholder = '45.335, -107.952';

    var addBtn = el('button', 'btn', 'Add');
    addBtn.addEventListener('click', function () {
      var pt = parseCoords(coordIn.value);
      if (!pt) { coordIn.value = ''; coordIn.placeholder = 'Could not read those coordinates'; return; }
      if (geo.stateIndexAt(pt.lon, pt.lat) < 0 && geo.stateIndexAt(-pt.lon, pt.lat) >= 0) pt.lon = -pt.lon;
      saveSpot(nameIn.value.trim() || guide.placeLabel(pt.lon, pt.lat).title, pt.lon, pt.lat, '');
      renderSpotsPanel();
    });

    var file = el('input');
    file.type = 'file';
    file.id = 'spot-file';
    file.accept = '.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml';
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        var n = importWaypoints(String(fr.result), f.name.replace(/\.[^.]+$/, ''));
        renderSpotsPanel();
        if (!n) alert('No waypoints found in that file.');
      };
      fr.readAsText(f);
    });

    var row = el('div', 'frow');
    var f1 = el('label', 'field');
    f1.appendChild(el('span', null, 'Name'));
    f1.appendChild(nameIn);
    var f2 = el('label', 'field');
    f2.appendChild(el('span', null, 'Coordinates'));
    f2.appendChild(coordIn);
    row.appendChild(f1);
    row.appendChild(f2);

    var f3 = el('label', 'field');
    f3.appendChild(el('span', null, 'Import GPX or KML waypoints'));
    f3.appendChild(file);

    wrap.appendChild(pick);
    wrap.appendChild(row);
    wrap.appendChild(addBtn);
    wrap.appendChild(f3);
    wrap.appendChild(el('p', 'note', 'Waypoints exported from onX, Garmin, Google Earth or HuntStand ' +
      'import directly. Nothing leaves your browser.'));
    return wrap;
  }

  function renderSpotsPanel() {
    openPanel('Saved locations', function () {
      var root = frag(), st = App.state;
      var day = st.t;
      root.appendChild(spotAdder());
      if (!st.spots.length) {
        root.appendChild(el('p', 'note', 'No saved locations yet.'));
        return root;
      }
      var ranked = st.spots.map(function (s) {
        var sc = App.spotScore(s, day);
        var series = guide.outlook(s.lon, s.lat, st.species);
        var bi = 0;
        series.forEach(function (x) { if (x.opp > series[bi].opp) bi = x.day; });
        return { spot: s, sc: sc, series: series, best: bi };
      }).sort(function (a, b) { return b.sc.opp - a.sc.opp; });

      var lead = el('div', 'lede');
      lead.textContent = 'Of your saved locations, ' + ranked[0].spot.name + ' has the strongest ' +
        App.speciesName(st.species).toLowerCase() + ' opportunity ' +
        (Math.floor(day) === 0 ? 'today' : Math.floor(day) === 1 ? 'tomorrow' : 'on ' + fmtDay(guide.dateFor(day))) + ' at ' + clockAt(day) +
        ', ' + ranked[0].sc.opp + '/100.';
      root.appendChild(lead);

      ranked.forEach(function (r) {
        var card = el('div', 'spotcard');
        var top = el('div', 'sc-top');
        var nm = el('div', 'sc-name', r.spot.name);
        top.appendChild(nm);
        var sv = el('div', 'sc-score', String(r.sc.opp));
        sv.style.color = radarNS.rampCSS(r.sc.opp / 100, 1);
        top.appendChild(sv);
        card.appendChild(top);
        card.appendChild(el('div', 'sc-sub', (r.spot.note || '') +
          (r.spot.note ? '  ·  ' : '') + 'Confidence ' + r.sc.conf + '%'));
        var mini = el('div', 'mini');
        r.series.forEach(function (d) {
          var b = el('div', 'mb');
          b.style.height = Math.max(6, d.opp) + '%';
          b.style.background = radarNS.rampCSS(d.opp / 100, d.day === r.best ? 1 : 0.55);
          b.title = shortDay(d.day, d.date) + ': ' + d.opp;
          mini.appendChild(b);
        });
        card.appendChild(mini);
        card.appendChild(el('div', 'sc-best', 'Best this week: ' +
          shortDay(r.best, r.series[r.best].date) + ' at ' + r.series[r.best].opp));
        var row = el('div', 'sc-actions');
        var open = el('button', 'btn small', 'Open plan');
        open.addEventListener('click', function () {
          App.state.selection = { lon: r.spot.lon, lat: r.spot.lat };
          App.radar.zoomToBounds(r.spot.lon - 0.5, r.spot.lat - 0.4, r.spot.lon + 0.5, r.spot.lat + 0.4);
          App.dirty = true;
          openPanel('OmniGuide Plan', function () { return buildPlan(r.spot.lon, r.spot.lat, r.spot.name); });
        });
        row.appendChild(open);
        var del = el('button', 'btn small ghost', 'Remove');
        del.addEventListener('click', function () {
          App.state.spots = App.state.spots.filter(function (x) { return x.id !== r.spot.id; });
          save('og.spots', App.state.spots);
          App.dirty = true;
          renderSpotsPanel();
        });
        row.appendChild(del);
        card.appendChild(row);
        root.appendChild(card);
      });
      return root;
    });
  }

  /* ---------- Plan a hunt ---------- */

  var plannerWhere = null;     // {lon, lat, name}

  function plannerTarget() {
    if (plannerWhere) return plannerWhere;
    if (App.state.selection) {
      return {
        lon: App.state.selection.lon, lat: App.state.selection.lat,
        name: guide.placeLabel(App.state.selection.lon, App.state.selection.lat).title
      };
    }
    if (App.state.spots.length) {
      var s = App.state.spots[0];
      return { lon: s.lon, lat: s.lat, name: s.name };
    }
    return null;
  }

  function renderPlannerPanel() {
    openPanel('Plan a hunt', function () {
      var root = frag(), st = App.state;
      var planner = global.OG.planner;

      if (!planner || !planner.available()) {
        root.appendChild(el('p', 'note', 'Climate normals are not loaded in this build.'));
        return root;
      }

      var target = plannerTarget();
      if (!target) {
        root.appendChild(el('p', 'note', 'Pick a spot on the map or save a location first, then come back.'));
        return root;
      }

      /* Where */
      var pick = el('div', 'frow');
      var locSel = el('select');
      locSel.id = 'plan-loc';
      st.spots.forEach(function (s) {
        var o = el('option', null, s.name);
        o.value = s.id;
        if (target.name === s.name) o.selected = true;
        locSel.appendChild(o);
      });
      if (st.selection) {
        var o2 = el('option', null, 'Current map selection');
        o2.value = '__sel';
        if (!plannerWhere) o2.selected = true;
        locSel.appendChild(o2);
      }
      locSel.addEventListener('change', function () {
        if (locSel.value === '__sel') plannerWhere = null;
        else {
          var s = st.spots.filter(function (x) { return x.id === locSel.value; })[0];
          if (s) plannerWhere = { lon: s.lon, lat: s.lat, name: s.name };
        }
        renderPlannerPanel();
      });
      var fL = el('label', 'field');
      fL.appendChild(el('span', null, 'Location'));
      fL.appendChild(locSel);

      var spSel = el('select');
      spSel.id = 'plan-species';
      models.SPECIES.forEach(function (s) {
        var o = el('option', null, s.name);
        o.value = s.id;
        if (s.id === st.species) o.selected = true;
        spSel.appendChild(o);
      });
      spSel.addEventListener('change', function () {
        st.species = spSel.value;
        spotScoreCache.clear();
        App.dirty = true;
        syncControls();
        buildLegend();
        renderPlannerPanel();
      });
      var fS = el('label', 'field');
      fS.appendChild(el('span', null, 'Species'));
      fS.appendChild(spSel);
      pick.appendChild(fL);
      pick.appendChild(fS);
      root.appendChild(pick);

      var rows = planner.horizon(target.lon, target.lat, st.species, 20);
      if (!rows.length) {
        root.appendChild(el('p', 'note', 'No climate coverage at this location.'));
        return root;
      }

      /* Headline */
      var windows = planner.bestWindows(rows, 3);
      var head = el('div', 'planhead');
      head.appendChild(el('div', 'ph-title', target.name));
      head.appendChild(el('div', 'ph-sub', 'Seasonal index, next 20 weeks, ' +
        App.speciesName(st.species).toLowerCase()));
      root.appendChild(head);

      if (windows.length) {
        var top = windows[0], peak = rows[top.peakIdx];
        var lede = el('div', 'lede');
        lede.textContent = 'The strongest legal stretch here is normally ' +
          monthDay(rows[top.from].date) + ' to ' + monthDay(rows[top.to].date) +
          ', peaking the week of ' + monthDay(peak.date) + ' at a typical ' + peak.score + '/100.';
        root.appendChild(lede);
      } else {
        root.appendChild(el('div', 'lede', 'No legally open week for this species at this location in ' +
          'the next 20 weeks, based on the placeholder regulation records.'));
      }

      /* Chart */
      var chartSec = section('Week by week');
      var chart = el('div', 'pweeks');
      rows.forEach(function (r) {
        var col = el('div', 'pw' + (r.legalOpen ? '' : ' pw-closed'));
        var track = el('div', 'pwtrack');
        var bar = el('div', 'pwbar');
        bar.style.height = Math.max(3, r.score) + '%';
        bar.style.background = radarNS.rampCSS(r.score / 100, r.legalOpen ? 0.95 : 0.3);
        var band = el('div', 'pwband');
        band.style.bottom = r.lo + '%';
        band.style.height = Math.max(2, r.hi - r.lo) + '%';
        track.appendChild(bar);
        track.appendChild(band);
        col.appendChild(track);
        col.appendChild(el('div', 'pwlab', monthDay(r.date)));
        col.title = monthDay(r.date) + ': typical ' + r.score +
          ' (range ' + r.lo + '-' + r.hi + '), season ' + r.status;
        chart.appendChild(col);
      });
      chartSec.appendChild(chart);
      chartSec.appendChild(el('div', 'chartkey',
        'Bar is the seasonal index for that week, which ranks weeks and is not a forecast score. The lighter band is how much it moves in a ' +
        'notably warm or notably cold year. Faded bars are weeks the season is not open.'));
      root.appendChild(chartSec);

      /* Ranked windows */
      if (windows.length) {
        var wSec = section('Best windows');
        windows.forEach(function (wd, i) {
          var pk = rows[wd.peakIdx];
          var card = el('div', 'spotcard');
          var topRow = el('div', 'sc-top');
          topRow.appendChild(el('div', 'sc-name', (i + 1) + '. Week of ' + monthDay(pk.date)));
          var sv = el('div', 'sc-score', String(pk.score));
          sv.style.color = radarNS.rampCSS(pk.score / 100, 1);
          topRow.appendChild(sv);
          card.appendChild(topRow);
          card.appendChild(el('div', 'sc-sub',
            monthDay(rows[wd.from].date) + ' to ' + monthDay(rows[wd.to].date) +
            '  ·  average ' + Math.round(wd.mean) + '  ·  ' + pk.status));
          card.appendChild(el('div', 'sc-best',
            'Normally ' + Math.round(pk.clim.tmax) + '° / ' + Math.round(pk.clim.tmin) +
            '°F, precipitation on ' + Math.round(pk.clim.precipProb) + '% of days' +
            (pk.clim.snowIn > 0.4 ? ', ' + pk.clim.snowIn.toFixed(1) + ' in snow on the ground' : '')));
          if (pk.drivers.length) {
            var ul = el('ul', 'drivers pos');
            pk.drivers.forEach(function (d) { ul.appendChild(el('li', null, d.t)); });
            card.appendChild(ul);
          }
          wSec.appendChild(card);
        });
        root.appendChild(wSec);
      }

      /* Honesty */
      var lim = section('What this is and is not');
      lim.appendChild(el('p', null, 'This ranks weeks on what is genuinely seasonal: normal temperature, ' +
        'when freeze-up normally arrives, normal snow cover, the migration chronology for this species at ' +
        'this latitude, and whether the season is open.'));
      lim.appendChild(el('p', null, 'It says nothing about wind, pressure or front timing. At this range ' +
        'nobody knows them, so those terms are held neutral rather than invented. Inside eight days, go back ' +
        'to the Radar - that is a real forecast and it will beat this every time.'));
      lim.appendChild(el('p', null, 'Because those three are held neutral, and they are among the strongest ' +
        'positive drivers, these numbers run lower than a forecast day will. Read them against each other, ' +
        'not against a Radar score. A 49 here is a strong week, not a mediocre day.'));

      if (models.byId(st.species).group === 'waterfowl') {
        lim.appendChild(el('p', null, 'On why the curve turns over: cold helps right up until it does not. ' +
          'Falling temperature drives feeding and pushes new birds down the flyway, so the index climbs ' +
          'through the first hard weather. Once water locks up, birds leave rather than concentrate, and ' +
          'the birds upstream that would have replaced them have already gone. The model peaks around ' +
          'partial freeze and falls away after it, which is why a northern water tops out before the ' +
          'calendar season ends.'));
      }
      var cv = rows[0].clim;
      lim.appendChild(el('p', 'note', planner.source + ', ' + planner.period + ', ' +
        planner.stations + ' stations. Nearest station to this point is about ' +
        Math.round(cv.nearestMiles) + ' miles away' +
        (cv.coverage < 0.5 ? ', which is far enough that the normals here are weakly constrained.' : '.')));
      root.appendChild(lim);

      return root;
    });
  }

  function monthDay(d) {
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return mon[d.getMonth()] + ' ' + d.getDate();
  }

  /* ---------- Alerts ---------- */

  function computeAlerts() {
    var st = App.state, out = [];
    st.spots.forEach(function (s) {
      if (!App.unlockedAt(s.lon, s.lat, st.species)) return;
      var series = guide.outlook(s.lon, s.lat, st.species);
      var today = series[0], bi = 0;
      series.forEach(function (x) { if (x.opp > series[bi].opp) bi = x.day; });
      var best = series[bi];
      if (best.opp - today.opp >= 15 && bi > 0) {
        out.push({
          sev: 'up',
          t: s.name + ' forecast rises from ' + today.opp + ' to ' + best.opp,
          b: shortDay(bi, best.date) + ' is projected to be the strongest day at this location over the next seven days.'
        });
      }
      var migDay = null;
      for (var i = 0; i < series.length; i++) if (series[i].mig >= 70 && (migDay === null || series[i].mig > series[migDay].mig)) migDay = i;
      if (migDay !== null) {
        out.push({
          sev: 'mig',
          t: 'Major migration conditions developing ' + shortDay(migDay, series[migDay].date).toLowerCase(),
          b: 'Migration index ' + series[migDay].mig + ' near ' + s.name + ', with new bird probability ' +
             series[migDay].newBird + '%.'
        });
      }
      var statusChange = null;
      for (var k = 1; k < series.length; k++) if (series[k].status !== series[k - 1].status) { statusChange = k; break; }
      if (statusChange !== null) {
        out.push({
          sev: 'legal',
          t: 'Season status changes to ' + series[statusChange].status + ' ' +
             shortDay(statusChange, series[statusChange].date).toLowerCase() + ' near ' + s.name,
          b: 'Placeholder regulation record - confirm with the state agency before acting on this.'
        });
      }
      var f0 = App.spotScore(s, 0).wx.freeze, f3 = App.spotScore(s, 3).wx.freeze;
      if (f3 - f0 > 0.28) {
        out.push({
          sev: 'freeze',
          t: 'Freeze-up accelerating near ' + s.name,
          b: 'Freeze index climbs from ' + Math.round(f0 * 100) + '% to ' + Math.round(f3 * 100) +
             '% within three days. Expect birds to shift to moving water.'
        });
      }
    });
    var seen = {};
    return out.filter(function (a) { if (seen[a.t]) return false; seen[a.t] = 1; return true; }).slice(0, 8);
  }

  function renderAlertsPanel() {
    openPanel('Alerts', function () {
      var root = frag();
      var list = computeAlerts();
      root.appendChild(el('p', 'note', 'OmniGuide only raises an alert when something materially changes a ' +
        'decision at one of your saved locations.'));
      if (!list.length) {
        root.appendChild(el('div', 'lede', 'Nothing worth telling you about right now.'));
        return root;
      }
      list.forEach(function (a) {
        var c = el('div', 'alert a-' + a.sev);
        c.appendChild(el('div', 'al-t', a.t));
        c.appendChild(el('div', 'al-b', a.b));
        root.appendChild(c);
      });
      return root;
    });
  }

  /* ---------- Log ---------- */

  function renderLogPanel(prefill) {
    openPanel('Hunt and fishing log', function () {
      var root = frag(), st = App.state;

      var form = el('form', 'logform');
      var spotSel = el('select');
      spotSel.id = 'log-spot';
      st.spots.forEach(function (s) {
        var o = el('option', null, s.name);
        o.value = s.id;
        spotSel.appendChild(o);
      });
      if (prefill) {
        var other = el('option', null, prefill.name);
        other.value = '__other';
        spotSel.appendChild(other);
        spotSel.value = '__other';
      }

      function field(labelText, node) {
        var w = el('label', 'field');
        w.appendChild(el('span', null, labelText));
        w.appendChild(node);
        return w;
      }

      var went = el('select'); went.id = 'log-went';
      ['Yes, I went', 'No, I skipped it'].forEach(function (x, i) {
        var o = el('option', null, x); o.value = i ? 'no' : 'yes'; went.appendChild(o);
      });
      var spSel = el('select'); spSel.id = 'log-species';
      models.SPECIES.forEach(function (s) {
        var o = el('option', null, s.name); o.value = s.id;
        if (s.id === st.species) o.selected = true;
        spSel.appendChild(o);
      });
      var seen = el('input'); seen.type = 'number'; seen.min = '0'; seen.value = '0'; seen.id = 'log-seen';
      var took = el('input'); took.type = 'number'; took.min = '0'; took.value = '0'; took.id = 'log-took';
      var when = el('select'); when.id = 'log-when';
      ['First light', 'Mid morning', 'Midday', 'Afternoon', 'Last light'].forEach(function (x) {
        when.appendChild(el('option', null, x));
      });
      var outcome = el('select'); outcome.id = 'log-outcome';
      ['Excellent', 'Good', 'Fair', 'Slow', 'Nothing moving'].forEach(function (x) {
        outcome.appendChild(el('option', null, x));
      });
      var notes = el('textarea'); notes.rows = 2; notes.id = 'log-notes';
      notes.placeholder = 'Optional: calling, spread, fly, water, pressure';

      form.appendChild(field('Location', spotSel));
      form.appendChild(field('Did you go?', went));
      form.appendChild(field('Species', spSel));
      var row = el('div', 'frow');
      row.appendChild(field('Seen', seen));
      row.appendChild(field('Harvested', took));
      form.appendChild(row);
      var row2 = el('div', 'frow');
      row2.appendChild(field('Time', when));
      row2.appendChild(field('Outcome', outcome));
      form.appendChild(row2);
      form.appendChild(field('Notes', notes));

      var submit = el('button', 'btn primary', 'Save log');
      submit.type = 'submit';
      form.appendChild(submit);

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var spot = st.spots.filter(function (s) { return s.id === spotSel.value; })[0];
        var lon = spot ? spot.lon : (prefill ? prefill.lon : null);
        var lat = spot ? spot.lat : (prefill ? prefill.lat : null);
        if (lon == null) return;
        var d = new Date();
        var sc = models.scoreAt(lon, lat, 0, env.dayOfYear(d), spSel.value);
        st.logs.unshift({
          ts: Date.now(), name: spot ? spot.name : (prefill ? prefill.name : 'Location'),
          lon: lon, lat: lat, went: went.value, species: spSel.value,
          seen: +seen.value, took: +took.value, when: when.value,
          outcome: outcome.value, notes: notes.value,
          /* The learning loop: what we predicted is stored alongside what happened. */
          forecast: { opp: sc.opportunity, conf: sc.confidence, mig: sc.migration },
          observed: { windFrom: Math.round(sc.wx.windFrom), windSpd: Math.round(sc.wx.windSpd),
                      tempF: Math.round(sc.wx.tempF), temp24: Math.round(sc.wx.temp24) }
        });
        save('og.logs', st.logs);
        renderLogPanel();
      });
      root.appendChild(form);

      /* Learning loop output */
      var insight = personalInsight();
      if (insight.length) {
        var is = section('What your logs are telling OmniGuide');
        insight.forEach(function (x) { is.appendChild(el('p', 'insight', x)); });
        root.appendChild(is);
      }

      if (st.logs.length) {
        var ls = section('Recent outings');
        st.logs.slice(0, 12).forEach(function (l) {
          var c = el('div', 'logrow');
          var d = new Date(l.ts);
          c.appendChild(el('div', 'lg-t', l.name + ' · ' + App.speciesName(l.species)));
          c.appendChild(el('div', 'lg-b', l.went === 'no' ? 'Did not go'
            : l.seen + ' seen, ' + l.took + ' harvested · ' + l.when + ' · ' + l.outcome));
          c.appendChild(el('div', 'lg-m', (d.getMonth() + 1) + '/' + d.getDate() + ' · forecast was ' +
            l.forecast.opp + ' · ' + env.dirName(l.observed.windFrom) + ' ' + l.observed.windSpd + ' mph'));
          ls.appendChild(c);
        });
        root.appendChild(ls);
      } else {
        root.appendChild(el('p', 'note', 'Nothing logged yet. Every logged outing is stored next to the ' +
          'forecast that produced it, which is what lets the model learn your spots.'));
      }
      return root;
    });
  }

  function personalInsight() {
    var logs = App.state.logs.filter(function (l) { return l.went === 'yes'; });
    if (logs.length < 3) return [];
    var out = [];
    var byName = {};
    logs.forEach(function (l) { (byName[l.name] || (byName[l.name] = [])).push(l); });

    Object.keys(byName).forEach(function (name) {
      var ls = byName[name];
      if (ls.length < 3) return;
      var nw = ls.filter(function (l) { var d = l.observed.windFrom; return d > 270 && d < 360 && l.observed.windSpd >= 10; });
      var other = ls.filter(function (l) { return nw.indexOf(l) < 0; });
      if (nw.length >= 2 && other.length >= 1) {
        var a = nw.reduce(function (s, l) { return s + l.seen; }, 0) / nw.length;
        var b = other.reduce(function (s, l) { return s + l.seen; }, 0) / other.length;
        if (b > 0 && Math.abs(a - b) / b > 0.2) {
          out.push('You have seen ' + Math.round(Math.abs(a - b) / b * 100) + '% ' +
            (a > b ? 'more' : 'fewer') + ' birds at ' + name + ' on northwest winds above 10 mph (' +
            nw.length + ' of ' + ls.length + ' outings).');
        }
      }
      var cold = ls.filter(function (l) { return l.observed.temp24 <= -12; });
      if (cold.length >= 2) {
        var ca = cold.reduce(function (s, l) { return s + l.seen; }, 0) / cold.length;
        out.push('Your best outings at ' + name + ' follow temperature declines greater than 12 degrees, ' +
          'averaging ' + Math.round(ca) + ' birds seen.');
      }
    });

    var hits = logs.filter(function (l) { return l.forecast.opp >= 75; });
    var miss = logs.filter(function (l) { return l.forecast.opp < 60; });
    if (hits.length >= 2 && miss.length >= 2) {
      var ha = hits.reduce(function (s, l) { return s + l.seen; }, 0) / hits.length;
      var ma = miss.reduce(function (s, l) { return s + l.seen; }, 0) / miss.length;
      out.push('Across your logs, outings on a forecast of 75 or better averaged ' + Math.round(ha) +
        ' birds seen against ' + Math.round(ma) + ' on a forecast under 60. That gap is the signal the ' +
        'model is being scored against.');
    }
    return out.slice(0, 3);
  }

  /* ---------- Account ---------- */

  function renderAccountPanel() {
    openPanel('Account and access', function () {
      var root = frag(), st = App.state, ent = App.entitlement();

      var tier = el('div', 'tier' + (ent.pro ? ' pro' : ''));
      tier.appendChild(el('div', 'tier-n', ent.pro ? 'OmniGuide Pro' : 'Free'));
      tier.appendChild(el('div', 'tier-d', ent.pro
        ? 'All states, all supported species, all layers.'
        : 'One state and one species, fully functional inside that combination.'));
      root.appendChild(tier);

      var s = section('Your free combination');
      var stSel = el('select');
      geo.states.forEach(function (x) {
        var o = el('option', null, x.name);
        o.value = x.abbr;
        if (x.abbr === st.ent.state) o.selected = true;
        stSel.appendChild(o);
      });
      var spSel = el('select');
      models.SPECIES.forEach(function (x) {
        var o = el('option', null, x.name);
        o.value = x.id;
        if (x.id === st.ent.species) o.selected = true;
        spSel.appendChild(o);
      });
      var f1 = el('label', 'field'); f1.appendChild(el('span', null, 'State')); f1.appendChild(stSel);
      var f2 = el('label', 'field'); f2.appendChild(el('span', null, 'Species')); f2.appendChild(spSel);
      s.appendChild(f1); s.appendChild(f2);

      var days = Math.floor((Date.now() - (st.ent.changed || 0)) / 86400000);
      var locked = days < 90 && st.ent.changedOnce;
      var apply = el('button', 'btn primary', 'Apply');
      apply.addEventListener('click', function () {
        if (locked) return;
        st.ent.state = stSel.value;
        st.ent.species = spSel.value;
        st.ent.changed = Date.now();
        st.ent.changedOnce = true;
        save('og.ent', st.ent);
        radarNS.clearScores();
        App.dirty = true;
        renderAccountPanel();
        syncControls();
      });
      s.appendChild(apply);
      s.appendChild(el('p', 'note', locked
        ? 'Your free combination can change once every 90 days. ' + (90 - days) + ' days remaining.'
        : 'Your free combination can be changed once every 90 days, so it stays a real plan rather than a way to tour the country for free.'));
      root.appendChild(s);

      var p = section('Demo controls');
      var proBtn = el('button', 'btn' + (ent.pro ? '' : ' primary'), ent.pro ? 'Switch back to Free' : 'Simulate Pro');
      proBtn.addEventListener('click', function () {
        st.ent.pro = !st.ent.pro;
        save('og.ent', st.ent);
        radarNS.clearScores();
        App.dirty = true;
        renderAccountPanel();
      });
      p.appendChild(proBtn);
      var reset = el('button', 'btn ghost', 'Reset saved data');
      reset.addEventListener('click', function () {
        if (!confirm('Remove saved spots, logs and entitlement settings from this browser?')) return;
        try { ['og.spots', 'og.logs', 'og.ent'].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
        st.spots = DEFAULT_SPOTS.slice();
        st.logs = [];
        st.ent = { pro: false, state: 'MT', species: 'ducks', changed: Date.now() };
        spotScoreCache.clear();
        radarNS.clearScores();
        App.dirty = true;
        renderAccountPanel();
      });
      p.appendChild(reset);
      root.appendChild(p);

      var about = section('What is real in this build');
      about.appendChild(el('p', null, 'Geography, the Albers projection, the H3-style multi-resolution cell ' +
        'grid, solar geometry and legal shooting light, the species models, the migration and confidence ' +
        'engines, the strategy rules, entitlement enforcement and the learning loop are all real code.'));
      about.appendChild(el('p', null, 'The forecast is real: a 987-point grid over the lower 48, every three ' +
        'hours for eight days, from the Open-Meteo multi-model blend, bilinearly interpolated and ' +
        'lapse-corrected to the terrain elevation of each cell. It is a snapshot taken when this build was ' +
        'assembled, because the artifact sandbox blocks all network calls, so it ages and cannot refresh. ' +
        App.wxNote()));
      about.appendChild(el('p', null, 'Plan a hunt uses NOAA 1991-2020 daily climate normals from about ' +
        (global.OG.planner ? global.OG.planner.stations : 0) + ' first-order stations, aggregated to 52 ' +
        'weeks and interpolated with an elevation correction. It ranks weeks on seasonal factors only and ' +
        'deliberately refuses to guess wind or front timing that far out.'));
      about.appendChild(el('p', null, 'There is no satellite imagery layer. The artifact sandbox blocks ' +
        'external images along with everything else on the network, so map tiles cannot load here. Hosted ' +
        'outside the sandbox, an imagery basemap is straightforward to add.'));
      about.appendChild(el('p', null, 'Streamflow has no live feed yet and remains seasonal and synthetic. ' +
        'Every regulation record is still an unverified placeholder. Both sit behind single modules so ' +
        'production can swap in USGS gauge data and verified agency rules without touching anything above them.'));
      root.appendChild(about);
      return root;
    });
  }

  /* ---------- Timeline ---------- */

  var SPAN = 7;

  /* The forecast grid is 3-hourly. Every time the app asks for is snapped to
     that step, so the map, the plan panel and the saved-spot pins all score
     the same instant. Showing a value between two forecast steps would be
     false precision anyway. */
  var STEP_T = 3 / 24;
  function snapT(t) {
    var s = Math.round(t / STEP_T) * STEP_T;
    return Math.max(0, Math.min(SPAN - STEP_T, s));
  }

  /* The time axis is local time where you are looking, so night and legal
     light are drawn for that place rather than for some arbitrary meridian. */
  function timeRef() {
    if (App.state.selection) return App.state.selection;
    if (App.radar) {
      var ll = App.radar.lonLatAt(App.radar.w / 2, App.radar.h / 2);
      if (isFinite(ll[0]) && isFinite(ll[1]) && geo.stateIndexAt(ll[0], ll[1]) >= 0) {
        return { lon: ll[0], lat: ll[1] };
      }
    }
    return { lon: -100, lat: 42 };
  }

  function bandLabel(i, d) {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tmrw';
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  }

  function buildBands() {
    if (!tlBands) return;
    var ref = timeRef();
    var wpx = tlBands.clientWidth || 300;
    var showHours = wpx / SPAN > 100;
    var cur = App.dayIndex();
    tlBands.innerHTML = '';

    for (var d = 0; d < SPAN; d++) {
      var date = guide.dateFor(d);
      var s = env.sun(ref.lat, ref.lon, date);
      var seg = el('div', 'tl-day' + (d % 2 ? ' alt' : '') + (d === cur ? ' on' : ''));
      seg.style.left = (d / SPAN * 100) + '%';
      seg.style.width = (100 / SPAN) + '%';

      var sr = s.sunrise == null ? 420 : s.sunrise;
      var ss = s.sunset == null ? 1080 : s.sunset;
      var n1 = el('div', 'tl-night');
      n1.style.left = '0';
      n1.style.width = (sr / 1440 * 100) + '%';
      var n2 = el('div', 'tl-night');
      n2.style.left = (ss / 1440 * 100) + '%';
      n2.style.right = '0';
      seg.appendChild(n1);
      seg.appendChild(n2);

      if (s.shootStart != null) {
        var lg = el('div', 'tl-legal');
        lg.style.left = (s.shootStart / 1440 * 100) + '%';
        lg.style.width = ((s.shootEnd - s.shootStart) / 1440 * 100) + '%';
        lg.title = 'Legal shooting light';
        seg.appendChild(lg);
      }

      for (var hi = 0; hi < 3; hi++) {
        var hh = [6, 12, 18][hi];
        var tk = el('div', 'tl-tick');
        tk.style.left = (hh / 24 * 100) + '%';
        seg.appendChild(tk);
        if (showHours) {
          var lb = el('div', 'tl-hr', hh === 12 ? 'noon' : hh < 12 ? hh + 'a' : (hh - 12) + 'p');
          lb.style.left = (hh / 24 * 100) + '%';
          seg.appendChild(lb);
        }
      }
      seg.appendChild(el('div', 'tl-name', bandLabel(d, date)));
      tlBands.appendChild(seg);
    }
  }

  var bandTimer = null;
  function scheduleBands() {
    if (bandTimer) clearTimeout(bandTimer);
    bandTimer = setTimeout(function () { bandTimer = null; buildBands(); }, 350);
  }

  /* Jump to first legal light on the chosen day - the hour a hunter wants. */
  function dayStartT(d) {
    var ref = timeRef();
    var s = env.sun(ref.lat, ref.lon, guide.dateFor(d));
    var m = s.shootStart != null ? s.shootStart : 420;
    return snapT(d + Math.min(0.98, Math.max(0.02, m / 1440)));
  }

  function clockAt(t) {
    var ref = timeRef();
    var mins = (t - Math.floor(t)) * 1440;
    var s = env.sun(ref.lat, ref.lon, guide.dateFor(t));
    return env.hhmm(mins) + ' ' + s.tz;
  }

  /* Zoom range: the national view sits near 8, and the ceiling reaches
     roughly tile level 18, which is individual-tree detail on imagery. */
  var ZOOM_MIN = 2, ZOOM_MAX = 140000;
  function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

  /* ---------- Coordinate search ---------- */

  /* Accepts what people actually paste: decimal pairs with or without signs,
     hemisphere letters in either position, and degrees/minutes/seconds. */
  function parseCoords(q) {
    var s = q.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    var vals = [], m;

    var dms = /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]\s*)?\s*([NSEW])/gi;
    while ((m = dms.exec(s)) !== null) {
      var v = parseFloat(m[1]) + (m[2] ? parseFloat(m[2]) / 60 : 0) + (m[3] ? parseFloat(m[3]) / 3600 : 0);
      var d = m[4].toUpperCase();
      vals.push({ v: (d === 'S' || d === 'W') ? -v : v, axis: (d === 'N' || d === 'S') ? 'lat' : 'lon' });
    }

    if (vals.length < 2) {
      vals = [];
      var dec = /(-?\d+(?:\.\d+)?)\s*[°º]?\s*([NSEW])?/gi;
      while ((m = dec.exec(s)) !== null) {
        if (!m[1]) continue;
        var val = parseFloat(m[1]);
        var dir = m[2] ? m[2].toUpperCase() : null;
        if (dir === 'S' || dir === 'W') val = -Math.abs(val);
        else if (dir === 'N' || dir === 'E') val = Math.abs(val);
        vals.push({ v: val, axis: dir ? ((dir === 'N' || dir === 'S') ? 'lat' : 'lon') : null });
      }
    }
    if (vals.length < 2) return null;
    vals = vals.slice(0, 2);

    var lat = null, lon = null;
    for (var i = 0; i < 2; i++) {
      if (vals[i].axis === 'lat' && lat === null) lat = vals[i].v;
      else if (vals[i].axis === 'lon' && lon === null) lon = vals[i].v;
    }
    if (lat === null && lon === null) {
      lat = vals[0].v; lon = vals[1].v;
      /* Latitude cannot exceed 90, so an out-of-range first value means the
         pair was written longitude first. */
      if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { var sw = lat; lat = lon; lon = sw; }
    } else if (lat === null) {
      lat = (vals[0].axis === 'lon') ? vals[1].v : vals[0].v;
    } else if (lon === null) {
      lon = (vals[0].axis === 'lat') ? vals[1].v : vals[0].v;
    }

    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon };
  }

  /* ---------- Controls ---------- */

  var speciesSel, layerRail, scrub, playBtn, dayChips, timeLabel, pursuitChip, tlBands;

  /* Move the map to a point, optionally pinning it and opening the plan. */
  function goTo(lon, lat, halfDeg, openIt) {
    var r = App.radar;
    r.zoomToBounds(lon - halfDeg, lat - halfDeg * 0.75, lon + halfDeg, lat + halfDeg * 0.75, 0.1);
    App.dirty = true;
    scheduleBands();
    if (!openIt) return;
    App.state.selection = { lon: lon, lat: lat };
    if (geo.stateIndexAt(lon, lat) >= 0) {
      openPanel('OmniGuide Plan', function () { return buildPlan(lon, lat); });
    }
  }

  function syncControls() {
    speciesSel.value = App.state.species;
    var sp = models.byId(App.state.species);
    pursuitChip.textContent = sp.pursuit === 'fish' ? 'Fly fishing' : 'Hunting';
    pursuitChip.title = sp.blurb;
    Array.prototype.forEach.call(layerRail.children, function (b) {
      if (!b.dataset.layer) return;                 // separators and group labels
      b.classList.toggle('on', b.dataset.layer === App.state.layer);
      var isMig = b.dataset.layer === 'migration' || b.dataset.layer === 'newbird';
      b.disabled = isMig && !sp.migratory;
    });
    Array.prototype.forEach.call(dayChips.children, function (b, i) {
      b.classList.toggle('on', App.dayIndex() === i);
    });
    scrub.value = String(App.state.t);
    var cur = App.dayIndex();
    if (tlBands) {
      for (var bi = 0; bi < tlBands.children.length; bi++) {
        tlBands.children[bi].classList.toggle('on', bi === cur);
      }
    }
    var d = guide.dateFor(App.state.t);
    timeLabel.textContent = shortDay(cur, d) + ' · ' + clockAt(App.state.t);
    playBtn.textContent = App.state.playing ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-pressed', String(App.state.playing));
  }

  function buildLegend() {
    var lg = $('#legend');
    lg.innerHTML = '';
    var layer = LAYERS.filter(function (l) { return l.id === App.state.layer; })[0];
    var wxl = radarNS.WX_LAYERS[App.state.layer];

    if (wxl) {
      lg.appendChild(el('div', 'lg-title', wxl.name + ' (' + wxl.unit + ')'));
      var wbar = el('div', 'lg-bar');
      var wstops = [];
      for (var wi = 0; wi <= 12; wi++) {
        var c = wxl.ramp(wi / 12);
        wstops.push('rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ') ' + Math.round(wi / 12 * 100) + '%');
      }
      wbar.style.background = 'linear-gradient(90deg,' + wstops.join(',') + ')';
      lg.appendChild(wbar);
      var wsc = el('div', 'lg-scale');
      for (var si = 0; si <= 4; si++) {
        var v = wxl.min + (wxl.max - wxl.min) * si / 4;
        wsc.appendChild(el('span', null, wxl.digits ? v.toFixed(wxl.digits) : String(Math.round(v))));
      }
      lg.appendChild(wsc);
      lg.appendChild(el('div', 'lg-note', App.wxNote()));
      return;
    }

    lg.appendChild(el('div', 'lg-title', layer.name));
    if (App.state.layer === 'legal') {
      var keys = [['OPEN', 'Open'], ['LIMITED', 'Limited'], ['PERMIT', 'Permit required'],
                  ['CLOSED', 'Closed'], ['UNKNOWN', 'Unverified']];
      var ks = el('div', 'lg-keys');
      keys.forEach(function (k) {
        var r = el('div', 'lg-k');
        var sw = el('span', 'lg-sw');
        sw.style.background = radarNS.STATUS_COLOR[k[0]];
        r.appendChild(sw);
        r.appendChild(el('span', null, k[1]));
        ks.appendChild(r);
      });
      lg.appendChild(ks);
    } else {
      var bar = el('div', 'lg-bar');
      var stops = [];
      for (var i = 0; i <= 10; i++) stops.push(radarNS.rampCSS(i / 10, 1) + ' ' + (i * 10) + '%');
      bar.style.background = 'linear-gradient(90deg,' + stops.join(',') + ')';
      lg.appendChild(bar);
      var sc = el('div', 'lg-scale');
      ['0', '25', '50', '75', '100'].forEach(function (x) { sc.appendChild(el('span', null, x)); });
      lg.appendChild(sc);
      lg.appendChild(el('div', 'lg-note', App.state.layer === 'confidence'
        ? 'Low confidence reads darker and flatter.'
        : 'Blank ground means out of range, no season record, or outside your plan.'));
    }
  }

  /* ---------- Interaction ---------- */

  function wireMap(canvas, radar) {
    var dragging = false, moved = 0, lastX = 0, lastY = 0, pinch = null;

    function pt(e) {
      var r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      dragging = true; moved = 0;
      var p = pt(e); lastX = p[0]; lastY = p[1];
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = pt(e);
      var dx = p[0] - lastX, dy = p[1] - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      radar.view.cx -= dx / radar.view.zoom;
      radar.view.cy -= dy / radar.view.zoom;
      lastX = p[0]; lastY = p[1];
      App.dirty = true;
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (moved < 6) {
        var p = pt(e);
        var raw = radar.lonLatAt(p[0], p[1]);
        if (!isFinite(raw[0])) return;

        /* The exact point, not a snapped cell centre. Clicks used to snap to
           the hexagon under the cursor so the panel matched the mosaic; with
           a continuous field there is no mosaic to match, and snapping threw
           away up to sixteen kilometres of precision - which is the opposite
           of analysing the ground someone actually pointed at. */
        var lon = raw[0], lat = raw[1];
        if (geo.stateIndexAt(lon, lat) < 0) return;

        if (App.addSpotMode) {
          App.addSpotMode = false;
          document.body.classList.remove('adding');
          addSpotAt(raw[0], raw[1]);
          return;
        }
        App.state.selection = { lon: lon, lat: lat };
        App.dirty = true;
        scheduleBands();
        openPanel('OmniGuide Plan', function () { return buildPlan(lon, lat); });
      }
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', function () { dragging = false; });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pt(e);
      var before = radar.toWorld(p[0], p[1], [0, 0]);
      var f = Math.exp(-e.deltaY * 0.0016);
      radar.view.zoom = clampZoom(radar.view.zoom * f);
      var after = radar.toWorld(p[0], p[1], [0, 0]);
      radar.view.cx += before[0] - after[0];
      radar.view.cy += before[1] - after[1];
      App.dirty = true;
    }, { passive: false });

    /* Pinch */
    var pts = {};
    canvas.addEventListener('pointerdown', function (e) { pts[e.pointerId] = pt(e); });
    canvas.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in pts)) return;
      pts[e.pointerId] = pt(e);
      var ids = Object.keys(pts);
      if (ids.length !== 2) return;
      var a = pts[ids[0]], b = pts[ids[1]];
      var dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (pinch) {
        var before = radar.toWorld(mid[0], mid[1], [0, 0]);
        radar.view.zoom = clampZoom(radar.view.zoom * (dist / pinch.dist));
        var after = radar.toWorld(mid[0], mid[1], [0, 0]);
        radar.view.cx += before[0] - after[0];
        radar.view.cy += before[1] - after[1];
        App.dirty = true;
      }
      pinch = { dist: dist };
      dragging = false;
    });
    function clearPt(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) pinch = null; }
    canvas.addEventListener('pointerup', clearPt);
    canvas.addEventListener('pointercancel', clearPt);
  }

  /* ---------- Boot ---------- */

  /* One-time acknowledgment. Season data is the one thing in here that can
     get someone cited, so it is gated behind an explicit action rather than
     a line of small print they can scroll past. */
  function requireAcknowledgment(done) {
    var seen = false;
    try { seen = localStorage.getItem('og.ack') === '2'; } catch (e) {}
    if (seen) { done(); return; }

    var veil = el('div', 'ackveil');
    var card = el('div', 'ackcard');
    card.appendChild(el('div', 'ack-h', 'Before you use OmniGuide'));
    card.appendChild(el('p', null, 'OmniGuide predicts animal activity. It does not tell you what is ' +
      'legal, and it is not a substitute for the regulations.'));
    var ul = el('ul', 'drivers warn');
    [
      'Season information here is an unverified reference and may be wrong, stale or missing.',
      'Zones, units, refuge closures, emergency orders and tag requirements are not modelled.',
      'Nothing here tells you who owns the ground or whether you may legally be on it.',
      'Confirm every season, limit and shooting hour with the issuing agency before you go.'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    card.appendChild(ul);
    card.appendChild(el('p', 'note', 'You are solely responsible for hunting and fishing lawfully.'));
    var btn = el('button', 'btn primary', 'I understand');
    btn.addEventListener('click', function () {
      try { localStorage.setItem('og.ack', '2'); } catch (e) {}
      veil.remove();
      done();
    });
    card.appendChild(btn);
    veil.appendChild(card);
    document.body.appendChild(veil);
  }

  function boot() {
    panel = $('#panel'); scrim = $('#scrim');
    panelBody = $('#panel-body'); panelTitle = $('#panel-title');
    $('#panel-close').addEventListener('click', closePanel);
    scrim.addEventListener('click', closePanel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

    var canvas = $('#map');
    var radar = new radarNS.Radar(canvas, App);
    App.radar = radar;

    /* Species */
    speciesSel = $('#species');
    var groups = {
      waterfowl: 'Waterfowl', biggame: 'Big game', turkey: 'Turkey',
      upland: 'Upland', fishing: 'Fly fishing'
    };
    Object.keys(groups).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = groups[g];
      models.SPECIES.filter(function (s) { return s.group === g; }).forEach(function (s) {
        var o = el('option', null, s.name);
        o.value = s.id;
        og.appendChild(o);
      });
      speciesSel.appendChild(og);
    });
    speciesSel.value = App.state.species;
    speciesSel.addEventListener('change', function () {
      App.state.species = speciesSel.value;
      var sp = models.byId(App.state.species);
      if (!sp.migratory && (App.state.layer === 'migration' || App.state.layer === 'newbird')) {
        App.state.layer = 'opportunity';
      }
      spotScoreCache.clear();
      App.dirty = true;
      syncControls();
      buildLegend();
    });
    pursuitChip = $('#pursuit');

    /* Layer rail */
    /* Layer dock open/closed, remembered per browser. */
    var dock = $('#layerdock'), layerTab = $('#layertab');
    try {
      if (localStorage.getItem('og.dock') === 'closed') dock.classList.remove('open');
    } catch (e) {}
    layerTab.setAttribute('aria-expanded', String(dock.classList.contains('open')));
    layerTab.addEventListener('click', function () {
      var open = dock.classList.toggle('open');
      layerTab.setAttribute('aria-expanded', String(open));
      try { localStorage.setItem('og.dock', open ? 'open' : 'closed'); } catch (e) {}
    });

    $('#zoom-in').addEventListener('click', function () {
      radar.view.zoom = clampZoom(radar.view.zoom * 1.7);
      App.dirty = true;
      scheduleBands();
    });
    $('#zoom-out').addEventListener('click', function () {
      radar.view.zoom = clampZoom(radar.view.zoom / 1.7);
      App.dirty = true;
      scheduleBands();
    });

    layerRail = $('#layers');
    layerRail.appendChild(el('div', 'layer-grp', 'Intelligence'));
    var sawWx = false;
    LAYERS.forEach(function (l) {
      /* Intelligence layers and raw weather are different kinds of thing, so
         the rail says so rather than running them together. */
      if (l.wx && !sawWx) {
        sawWx = true;
        layerRail.appendChild(el('div', 'layer-sep'));
        layerRail.appendChild(el('div', 'layer-grp', 'Weather'));
      }
      var b = el('button', 'layerbtn', l.name);
      b.dataset.layer = l.id;
      b.title = l.desc;
      b.addEventListener('click', function () {
        App.state.layer = l.id;
        App.dirty = true;
        syncControls();
        buildLegend();
      });
      layerRail.appendChild(b);
    });

    /* Timeline */
    dayChips = $('#daychips');
    tlBands = $('#tlbands');
    for (var i = 0; i < SPAN; i++) {
      (function (i) {
        var d = guide.dateFor(i);
        var b = el('button', 'daychip', shortDay(i, d));
        b.title = 'Jump to first legal light';
        b.addEventListener('click', function () {
          App.state.t = dayStartT(i);
          App.state.playing = false;
          App.dirty = true;
          syncControls();
        });
        dayChips.appendChild(b);
      })(i);
    }
    scrub = $('#scrub');
    scrub.addEventListener('input', function () {
      App.state.t = snapT(parseFloat(scrub.value));
      App.state.playing = false;
      App.dirty = true;
      syncControls();
    });
    playBtn = $('#play');
    playBtn.addEventListener('click', function () {
      App.state.playing = !App.state.playing;
      syncControls();
    });
    timeLabel = $('#timelabel');

    /* Legal overlay toggle */
    var lo = $('#legaltoggle');
    lo.addEventListener('change', function () {
      App.state.legalOverlay = lo.checked;
      App.dirty = true;
      buildLegend();
    });

    /* Panels */
    $("#btn-plan").addEventListener("click", renderPlannerPanel);
    $('#btn-spots').addEventListener('click', renderSpotsPanel);
    $('#btn-alerts').addEventListener('click', renderAlertsPanel);
    $('#btn-log').addEventListener('click', function () { renderLogPanel(); });
    $('#btn-account').addEventListener('click', renderAccountPanel);

    /* GPS. Needs a secure origin, which GitHub Pages provides and the
       artifact sandbox does not. */
    var gpsBtn = $('#btn-gps');
    var watchId = null;
    gpsBtn.addEventListener('click', function () {
      if (!navigator.geolocation) { gpsBtn.textContent = 'No GPS'; return; }
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        App.state.gps = null;
        gpsBtn.classList.remove('on');
        gpsBtn.textContent = 'Locate';
        App.dirty = true;
        return;
      }
      gpsBtn.textContent = 'Locating';
      watchId = navigator.geolocation.watchPosition(function (pos) {
        App.state.gps = {
          lon: pos.coords.longitude, lat: pos.coords.latitude,
          accuracy: pos.coords.accuracy
        };
        gpsBtn.classList.add('on');
        gpsBtn.textContent = 'You';
        if (!App._gpsCentred) {
          App._gpsCentred = true;
          radar.zoomToBounds(App.state.gps.lon - 0.22, App.state.gps.lat - 0.16,
                             App.state.gps.lon + 0.22, App.state.gps.lat + 0.16, 0.1);
          scheduleBands();
        }
        App.dirty = true;
      }, function (err) {
        gpsBtn.textContent = err.code === 1 ? 'Denied' : 'No fix';
        gpsBtn.classList.remove('on');
        watchId = null;
      }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    });

    /* Mark the current GPS fix as a saved spot - the point of having GPS. */
    $('#btn-markhere').addEventListener('click', function () {
      var g = App.state.gps;
      if (!g) { gpsBtn.click(); return; }
      addSpotAt(g.lon, g.lat);
    });

    /* Sit the readout beside the cursor, flipping away from whichever edge
       it is about to run off. Measured each time because the box changes
       width with the value and the coordinate. */
    function placeHover(node, x, y) {
      var w = node.offsetWidth || 170, h = node.offsetHeight || 54;
      var pad = 18, m = 8;
      var left = x + pad;
      if (left + w > radar.w - m) left = x - pad - w;
      if (left < m) left = Math.min(radar.w - w - m, m);
      var top = y - h / 2;
      if (top < m) top = m;
      if (top + h > radar.h - m) top = radar.h - h - m;
      node.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
    }

    /* Hover readout. */
    var hov = $('#hover');
    var hoverRaf = null, hoverPt = null;
    canvas.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r2 = canvas.getBoundingClientRect();
      hoverPt = [e.clientX - r2.left, e.clientY - r2.top];
      /* Position tracks the pointer immediately; only the value lookup is
         throttled, so the box never lags behind the cursor. */
      if (!hov.hidden) placeHover(hov, hoverPt[0], hoverPt[1]);
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(function () {
        hoverRaf = null;
        if (!hoverPt) return;
        var ll = radar.lonLatAt(hoverPt[0], hoverPt[1]);
        if (!isFinite(ll[0]) || geo.stateIndexAt(ll[0], ll[1]) < 0) { hov.hidden = true; return; }
        var v = radar.fieldAt(ll[0], ll[1], false);
        var wxl = radarNS.WX_LAYERS[App.state.layer];
        hov.hidden = false;
        placeHover(hov, hoverPt[0], hoverPt[1]);
        hov.querySelector('.hv-coord').textContent =
          Math.abs(ll[1]).toFixed(4) + '° ' + (ll[1] >= 0 ? 'N' : 'S') + '  ' +
          Math.abs(ll[0]).toFixed(4) + '° ' + (ll[0] >= 0 ? 'E' : 'W');
        var vn = hov.querySelector('.hv-val');
        if (v !== v) {
          vn.textContent = '--';
          vn.style.color = '';
          hov.querySelector('.hv-lab').textContent = 'No data';
        } else if (v === -1) {
          vn.textContent = '—';
          vn.style.color = '';
          hov.querySelector('.hv-lab').textContent = 'Locked';
        } else {
          vn.textContent = wxl ? (wxl.digits ? v.toFixed(wxl.digits) : Math.round(v)) : Math.round(v);
          vn.style.color = wxl ? '' : radarNS.rampCSS(v / 100, 1);
          hov.querySelector('.hv-lab').textContent = wxl ? wxl.name + ' ' + wxl.unit
            : App.state.layer === 'legal' ? 'Season' : band(Math.round(v));
        }
      });
    });
    canvas.addEventListener('pointerleave', function () { hov.hidden = true; hoverPt = null; });

    /* Basemap. Satellite is a Pro layer: imagery is what lets someone pick a
       slough or a field edge out by eye, so it is worth paying for. */
    var bmBtn = $('#btn-basemap');
    var BM_CYCLE = ['relief', 'satellite', 'none'];
    function bmLabel() {
      var k = App.state.basemap;
      return k === 'relief' ? 'Relief' : k === 'satellite' ? 'Satellite' : 'No base';
    }
    var syncBasemap = function () {
      if (App.autoOpacity) App.autoOpacity();
      bmBtn.textContent = bmLabel();
      bmBtn.classList.toggle('pro-locked', App.state.basemap === 'satellite' && !App.entitlement().pro);
    };
    /* Overlay strength. The right blend depends on what is underneath, so it
       is a control rather than a constant. */
    layerRail.appendChild(el('div', 'layer-sep'));
    layerRail.appendChild(el('div', 'layer-grp', 'Overlay'));
    var opWrap = el('div', 'opacity-ctl');
    var opIn = el('input');
    opIn.type = 'range';
    opIn.id = 'fieldop';
    opIn.min = '10'; opIn.max = '100'; opIn.step = '5';
    opIn.value = String(Math.round((load('og.fieldop', 0) || 0) * 100) || 62);
    App.state.fieldOpacity = parseInt(opIn.value, 10) / 100;
    var opVal = el('span', 'op-val', opIn.value + '%');
    opIn.addEventListener('input', function () {
      App.state.fieldOpacity = parseInt(opIn.value, 10) / 100;
      App._opTouched = true;
      opVal.textContent = opIn.value + '%';
      save('og.fieldop', App.state.fieldOpacity);
      App.dirty = true;
    });

    /* Until someone sets it themselves, the overlay follows the basemap:
       imagery needs to show through far more than a relief shade does. */
    App.autoOpacity = function () {
      if (App._opTouched) return;
      var d = App.state.basemap === 'satellite' ? 38 : App.state.basemap === 'none' ? 85 : 62;
      opIn.value = String(d);
      var snapped = parseInt(opIn.value, 10);   // the step may round it
      opVal.textContent = snapped + "%";
      App.state.fieldOpacity = snapped / 100;
    };
    opWrap.appendChild(opIn);
    opWrap.appendChild(opVal);
    layerRail.appendChild(opWrap);

    /* Base map choices live in the layer dock too, where someone looking for
       map options will actually look. */
    layerRail.appendChild(el('div', 'layer-sep'));
    layerRail.appendChild(el('div', 'layer-grp', 'Base map'));
    var bmBtns = {};
    BM_CYCLE.forEach(function (k) {
      var b = el('button', 'layerbtn', k === 'relief' ? 'Relief' : k === 'satellite' ? 'Satellite' : 'None');
      if (k === 'satellite') b.appendChild(el('span', 'pro-tag', 'Pro'));
      b.dataset.basemap = k;
      b.addEventListener('click', function () { setBasemap(k); });
      bmBtns[k] = b;
      layerRail.appendChild(b);
    });

    function setBasemap(next) {
      if (next === 'satellite' && !App.entitlement().pro) {
        openPanel('Satellite imagery', function () {
          var root = frag();
          root.appendChild(el('div', 'lede', 'Satellite imagery is part of OmniGuide Pro.'));
          root.appendChild(el('p', null, 'Aerial imagery is how you pick out the slough, the treeline and ' +
            'the field edge you are actually going to hunt, rather than guessing from a relief map. ' +
            'It is the difference between marking a spot and marking the right spot.'));
          var b = el('button', 'btn primary', 'Simulate Pro in this demo');
          b.addEventListener('click', function () {
            App.state.ent.pro = true;
            save('og.ent', App.state.ent);
            App.state.basemap = 'satellite';
            save('og.basemap', 'satellite');
            radarNS.clearScores();
            App.dirty = true;
            syncBasemap();
            closePanel();
          });
          root.appendChild(b);
          return root;
        });
        return;
      }
      App.state.basemap = next;
      save('og.basemap', next);
      if (App.autoOpacity) App.autoOpacity();
      App.dirty = true;
      syncBasemap();
    }

    bmBtn.addEventListener('click', function () {
      var i = BM_CYCLE.indexOf(App.state.basemap);
      setBasemap(BM_CYCLE[(i + 1) % BM_CYCLE.length]);
    });

    var baseSync = syncBasemap;
    syncBasemap = function () {
      baseSync();
      for (var k in bmBtns) bmBtns[k].classList.toggle('on', k === App.state.basemap);
    };
    syncBasemap();

    /* Theme toggle */
    var tt = $('#themebtn');
    tt.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var isDark = cur ? cur === 'dark'
        : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
      App._theme = null;
      App.dirty = true;
    });

    /* Search */
    var search = $('#search');
    search.addEventListener('change', function () {
      var raw = search.value.trim();
      if (!raw) return;

      /* Coordinates win: a pin someone pasted is always an exact request. */
      var pt = parseCoords(raw);
      if (pt) {
        if (geo.stateIndexAt(pt.lon, pt.lat) < 0 && geo.stateIndexAt(-pt.lon, pt.lat) >= 0) {
          pt.lon = -pt.lon;          // western hemisphere assumed when unsigned
        }
        goTo(pt.lon, pt.lat, 0.22, true);
        return;
      }

      var q = raw.toLowerCase();

      /* Towns, most prominent match first. "Craig, MT" narrows by state. */
      var parts = q.split(',');
      var nameQ = parts[0].trim(), stQ = parts[1] ? parts[1].trim().toUpperCase() : null;
      var cities = geo.cities, exact = null, prefix = null;
      for (var c = 0; c < cities.length; c++) {
        var ct = cities[c];
        if (stQ && ct.st !== stQ) continue;
        var ln = ct.name.toLowerCase();
        if (ln === nameQ) { exact = ct; break; }
        if (!prefix && ln.indexOf(nameQ) === 0) prefix = ct;
      }
      var city = exact || prefix;
      if (city) { goTo(city.lon, city.lat, 0.55, false); return; }

      var all = env.WF_REGIONS.concat(env.TROUT_WATERS);
      for (var k = 0; k < all.length; k++) {
        if (all[k].n.toLowerCase().indexOf(q) >= 0) {
          radar.zoomToBounds(all[k].lon - all[k].rx * 1.8, all[k].lat - all[k].ry * 1.8,
                             all[k].lon + all[k].rx * 1.8, all[k].lat + all[k].ry * 1.8);
          App.dirty = true;
          scheduleBands();
          return;
        }
      }

      for (var s = 0; s < geo.states.length; s++) {
        if (geo.states[s].name.toLowerCase().indexOf(q) === 0 || geo.states[s].abbr.toLowerCase() === q) {
          radar.zoomToState(geo.states[s].abbr);
          App.dirty = true;
          scheduleBands();
          return;
        }
      }

      /* County names are the last thing tried, since many repeat across states. */
      for (var cy = 0; cy < geo.counties.length; cy++) {
        var co = geo.counties[cy];
        if (stQ && co.stateAbbr !== stQ) continue;
        if (co.name.toLowerCase() === nameQ) {
          var b = co.bbox;
          radar.zoomToBounds(b[0], b[1], b[2], b[3]);
          App.dirty = true;
          scheduleBands();
          return;
        }
      }

      search.setCustomValidity('');
      search.placeholder = 'No match for "' + raw + '"';
      search.value = '';
    });

    wireMap(canvas, radar);

    var ro = new ResizeObserver(function () { radar.resize(); App.dirty = true; buildBands(); });
    ro.observe(canvas.parentElement);
    radar.resize();

    /* Night and legal light are place-dependent, so the bands follow the view. */
    canvas.addEventListener('pointerup', scheduleBands);
    canvas.addEventListener('wheel', scheduleBands, { passive: true });
    App.state.t = dayStartT(1);   // already snapped
    buildBands();

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      App._theme = null; App.dirty = true;
    });

    var wn = $('#wxnote');
    if (wn) wn.textContent = App.wxNote();

    syncControls();
    buildLegend();

    /* Alert badge */
    var n = computeAlerts().length;
    if (n) {
      var dot = $('#alertdot');
      dot.hidden = false;
      dot.textContent = String(n);
    }

    $('#boot').remove();
    requireAcknowledgment(function () {});

    var last = performance.now(), playAccum = 0;
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (App.state.playing) {
        /* Playback advances one forecast step at a time rather than sliding
           continuously, so every frame is a real model step. */
        playAccum += dt * 0.85;
        if (playAccum >= STEP_T) {
          var steps = Math.floor(playAccum / STEP_T);
          playAccum -= steps * STEP_T;
          var nt = App.state.t + steps * STEP_T;
          App.state.t = nt > SPAN - STEP_T ? 0 : snapT(nt);
          App.dirty = true;
          syncControls();
        }
      }
      if (App.dirty || App.state.layer === 'migration') {
        radar.draw();
        App.dirty = false;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* A failure during boot would otherwise leave the splash up with no
     explanation, so surface it where it can actually be read. */
  function safeBoot() {
    try { boot(); }
    catch (err) {
      var b = document.getElementById('boot');
      if (b) {
        b.innerHTML = '';
        var box = el('div');
        box.appendChild(el('b', null, 'OmniGuide failed to start'));
        box.appendChild(el('div', null, String(err && err.message ? err.message : err)));
        b.appendChild(box);
      }
      throw err;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safeBoot);
  else safeBoot();

  global.OG.app = App;
})(window);
