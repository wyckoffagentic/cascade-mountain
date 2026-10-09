/* Cascade Mountain — replay UI. Demo bars only until data/custom has files. */
(function () {
  'use strict';
  var STATES = ['SCANNING', 'ND FOUND', 'SETUP', 'CONFIRMING', 'IN TRADE', 'TRAILING', 'EXIT'];
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var motionOn = !mq.matches;
  var soundOn = false;
  var playing = true;
  var speed = 1;
  /* replay pace (visual timing only): 1x = 340 ms per bar; bars while a setup is confirming or a trade is on play
     2.5x slower so the build, fire and in-trade phase stay watchable. One full cycle is ~71 s at 1x. */
  var BAR_MS = 340, DWELL = 2.5;
  function inSetup() {
    return [replay.gold, replay.nasdaq].some(function (x) { return x.pos || x.state === 'CONFIRMING' || x.state === 'IN TRADE' || x.state === 'TRAILING'; });
  }
  var focus = 'both';
  var follow = 'gold';
  var chartTf = '5m';
  var seed = 7;
  var equity0 = 50000;
  var risk = 0.0075;
  var replay = null;
  var world = null;
  var acc = 0;
  var lastTs = 0;
  var logQueue = [];
  var logShown = '';
  var ring = [];
  var tape = [];
  var rejects = 0;
  var odoVal = 0;
  var lastOdo = null;
  var riskFlag = false;
  var audioCtx = null;
  var custom = null;

  var chartG, chartN, swarm;
  /* ?capture: the frame loop is driven by __DMF.tick(n, ms) with a fixed timestep, for deterministic frame capture */
  var captureMode = /[?&]capture\b/.test(location.search), virtualNow = 0;
  var watcher = null;
  var vsaSilent = true;
  var vsaFeed = [];
  var vsaFresh = {};   /* finding id -> time it arrived live (panel slide-in/glow only) */
  var lastVsa = { bear: null, bull: null };
  var warnShown = {};
  var shown = { ripples: 0, contra: 0 };
  var TFS = ['5m', '15m', '30m', '2h', '4h'];
  var TF_VAR = { '4h': '--tf4h', '2h': '--tf2h', '30m': '--tf30', '15m': '--tf15', '5m': '--tf5' };

  /* Watcher plumbing: bars go out to the advisory module; findings come back through subscribe. Nothing flows back into the engine. */
  function feedWatcher(silent) {
    vsaSilent = !!silent;
    ['gold', 'nasdaq'].forEach(function (id) {
      var inst = instBy(id);
      watcher.ingest(id, '5m', inst.m5);
      watcher.ingest(id, '15m', inst.m15.bars);
      watcher.ingest(id, '30m', inst.m30.bars);
      watcher.ingest(id, '2h', inst.h2.bars);
      watcher.ingest(id, '4h', inst.h4.bars);
    });
    vsaSilent = true;
  }

  function onFinding(f) {
    vsaFeed.unshift(f);
    if (vsaFeed.length > 60) vsaFeed.length = 60;
    if (f.dir === 'bear' || f.dir === 'bull') lastVsa[f.dir] = f;
    if (vsaSilent) return;
    vsaFresh[f.id] = performance.now();
    if (f.inst !== focusInst().spec.id) return;
    if (f.dir === 'bear') shown.ripples++; else if (f.dir === 'bull') shown.contra++;
    swarm.vsa(f);
  }

  function nowT() {
    var b = replay.gold.m5[replay.gold.m5.length - 1];
    return b ? b.t + 300000 : 0;
  }

  function $(id) { return document.getElementById(id); }

  function motion() { return motionOn && !document.body.classList.contains('rm'); }

  function boot(toPreview) {
    world = DMF.createWorld(seed);
    replay = new DMF.Replay(world, { equity: equity0, risk: risk });
    watcher.reset(); vsaFeed = []; lastVsa = { bear: null, bull: null }; warnShown = {};
    ring = []; tape = []; logQueue = []; rejects = 0; riskFlag = false; odoVal = 0; lastOdo = null; acc = 0;
    chartG.setSource(replay.gold, DMF.SPECS.gold);
    chartN.setSource(replay.nasdaq, DMF.SPECS.nasdaq);
    chartG.setTf(chartTf); chartN.setTf(chartTf);
    var target = toPreview ? world.previewAt : 0;
    while (replay.i < target && replay.step()) { ingest(replay.events, true); feedWatcher(true); }
    paintLog(ring.slice(-8));
    var odo = $("odo"); if (odo) odo.dataset.built = "";
    renderDom();
  }

  function instBy(id) { return id === 'nasdaq' ? replay.nasdaq : replay.gold; }

  function focusInst() {
    if (focus === 'gold') return replay.gold;
    if (focus === 'nasdaq') return replay.nasdaq;
    return instBy(follow);
  }

  function ladderTf(inst) {
    if (!inst) return null;
    if (inst.pos || inst.state === 'TRAILING' || inst.state === 'IN TRADE') return '5m';
    var s = inst.cx && inst.cx.stage;
    if (s === 'nd') return inst.cx.tf || '2h';
    if (s === 'w30') return '30m';
    if (s === 'w15') return '15m';
    if (s === 'w5' || s === 'trig') return '5m';
    if (inst.state === 'SETUP') return (inst.cx && inst.cx.tf) || '2h';
    if (inst.state === 'CONFIRMING') return '5m';
    if (inst.state === 'ND FOUND') return (inst.cx && inst.cx.tf) || '2h';
    return null;
  }

  function ingest(events, silent) {
    events.forEach(function (e) {
      ring.push(e);
      if (ring.length > 120) ring.shift();
      if (!silent) logQueue.push(e);
      if (e.type === 'reject') rejects++;
      if (e.type === 'entry') {
        var p = instBy(e.inst).pos;
        if (p) tape.unshift({ kind: 'entry', inst: e.inst, t: p.entryT, text: e.msg, r: null, pnl: null });
        follow = e.inst;
      }
      if (e.type === 'win' || e.type === 'loss') {
        var tr = instBy(e.inst).trades.slice(-1)[0];
        if (tr) tape.unshift({ kind: e.type, inst: e.inst, t: tr.exitT, text: e.msg, r: tr.r, pnl: tr.pnl });
        follow = e.inst;
      }
      if (e.type === 'nd' || e.type === 'ut' || e.type === 'nd5' || e.type === 'ut5' || e.type === 'confirm' || e.type === 'reject') follow = e.inst;
    });
    if (tape.length > 40) tape.length = 40;
    ['gold', 'nasdaq'].forEach(function (id) {
      var f = instBy(id).flash;
      if (!f) return;
      instBy(id).flash = null;
      if (silent) return;
      if (f === 'invalid') swarm.burst('invalid');
      else if (f === 'win') { swarm.burst('win'); blip(880, 0.08); }
      else if (f === 'loss') { swarm.burst('loss'); blip(180, 0.12); }
      else if (f === 'entry') {
        swarm.burst('entry'); blip(520, 0.06);
        var bb = watcher.bias(id, nowT());
        swarm.fire(bb.net > -0.15);
      }
      var card = document.getElementById('card-' + id);
      if (card) { card.classList.add('hot'); setTimeout(function () { card.classList.remove('hot'); }, 700); }
    });
    var eq = Math.max(1, equity0 + replay.gold.realized + replay.nasdaq.realized);
    var rr = replay.openRisk() / eq;
    if (rr > 0.01 && !riskFlag) {
      riskFlag = true;
      var msg = { inst: 'gold', type: 'reject', msg: 'Combined open risk is ' + (rr * 100).toFixed(2) + '% of the account — above the 1.00% total cap. This should not happen: the second book is sized to the remaining headroom or skipped.', state: 'IN TRADE', t: 0 };
      ring.push(msg); if (!silent) logQueue.push(msg);
    }
    if (rr <= 0.01) riskFlag = false;
  }

  function doStep() {
    if (!replay.step()) { playing = false; setPlayLabel(); return false; }
    ingest(replay.events, false);
    feedWatcher(false);
    renderDom();
    return true;
  }

  function seekUntil(pred, max) {
    var n = 0;
    while (n++ < (max || 4000) && replay.i < replay.len) {
      if (!replay.step()) break;
      ingest(replay.events, true);
      feedWatcher(true);
      if (pred()) break;
    }
    paintLog(ring.slice(-8));
    renderDom();
    var fi = focusInst();
    if (fi.flash) { /* cleared in ingest silent */ }
  }

  function paintLog(list) {
    var el = $('log');
    el.innerHTML = '';
    list.forEach(function (e) { el.appendChild(logNode(e, true)); });
    el.scrollTop = el.scrollHeight;
    logShown = '';
    logQueue = [];
  }

  function logNode(e, full) {
    var d = document.createElement('p');
    d.className = 'ln ' + (e.type || '');
    var who = e.inst === 'nasdaq' ? 'NASDAQ' : 'GOLD';
    var text = full ? e.msg : '';
    d.innerHTML = '<b>' + who + '</b> ' + escapeHtml(text);
    d.dataset.full = e.msg;
    d.dataset.who = who;
    return d;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; });
  }

  function tickType(dt) {
    if (!logQueue.length) return;
    var el = $('log');
    var speedUp = speed >= 10 || !motion();
    if (speedUp) {
      logQueue.splice(0, 30).forEach(function (e) { el.appendChild(logNode(e, true)); });
      while (el.children.length > 24) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (!logShown) {
      var e = logQueue[0];
      var node = logNode(e, false);
      el.appendChild(node);
      logShown = e.msg;
      node.dataset.n = '0';
      while (el.children.length > 24) el.removeChild(el.firstChild);
    }
    var last = el.lastChild;
    var n = (+last.dataset.n || 0) + (dt > 0.03 ? 2 : 1);
    last.dataset.n = String(n);
    var full = logQueue[0].msg;
    last.innerHTML = '<b>' + last.dataset.who + '</b> ' + escapeHtml(full.slice(0, n));
    if (n >= full.length) { logQueue.shift(); logShown = ''; }
    el.scrollTop = el.scrollHeight;
  }

  function renderDom() {
    var g = replay.gold, n = replay.nasdaq;
    var fi = focusInst();
    $('followLabel').textContent = fi.spec.label;
    $('st-gold').textContent = g.state;
    $('st-nasdaq').textContent = n.state;
    setPx('gold', g);
    setPx('nasdaq', n);
    var bar = g.m5[g.m5.length - 1] || n.m5[n.m5.length - 1];
    if (bar) {
      var syd = DMF.fmtZone(bar.t, 'syd');
      var et = DMF.fmtZone(bar.t, 'et');
      var gst = DMF.globexState(bar.t);
      $('simClock').textContent = syd.full;
      var pill = $('pillSim');
      pill.classList.remove('open', 'break', 'closed');
      pill.classList.add(gst === 'OPEN' ? 'open' : gst === 'BREAK' ? 'break' : 'closed');
      $('mktClock').textContent = gst + ' · sim · ' + et.clock;
    }
    var st = $('states');
    var si = STATES.indexOf(fi.state);
    st.innerHTML = STATES.map(function (s, k) {
      return '<b class="' + (k === si ? 'on' : k < si ? 'done' : '') + '">' + s + '</b>';
    }).join('');
    $('meter').style.width = Math.round(fi.conf * 100) + '%';
    var checks = $('checks');
    checks.innerHTML = fi.checklist.map(function (c) {
      return '<li class="' + (c.on ? 'on' : '') + '"' + (c.short ? ' title="' + c.label + '"' : '') + '><i>' + (c.on ? '✓' : '') + '</i>' + (c.short || c.label) + (c.on && c.note ? ' · ' + c.note : '') + '</li>';
    }).join('');
    var on = {};
    fi.checklist.forEach(function (c) { on[c.id] = c.on; });
    var htf = (fi.cx && fi.cx.tf) || '2h';
    document.querySelectorAll('#ladder button').forEach(function (btn) {
      var tf = ladderTf(fi);
      var id = btn.dataset.tf;
      btn.classList.toggle('hot', id === tf);
      var done = (id === htf && on.nd) || (id === '30m' && on.w30) || (id === '15m' && on.w15) || (id === '5m' && (on.w5 || on.entry));
      btn.classList.toggle('done', done && id !== tf);
    });
    var tfNow = ladderTf(fi);
    document.querySelectorAll('.tflegend span[data-tf]').forEach(function (sp) {
      var id = sp.dataset.tf;
      var lit = (id === htf && on.nd) || (id === '30m' && on.w30) || (id === '15m' && on.w15) || (id === '5m' && (on.w5 || on.conf || on.entry));
      sp.classList.toggle('lit', !!lit); sp.classList.toggle('hot', id === tfNow);
    });
    var activeBtn = document.querySelector('#ladder button.hot');
    var rail = $('railDot');
    if (activeBtn && rail && getComputedStyle(rail.parentElement).display !== 'none') {
      var lr = rail.parentElement.getBoundingClientRect();
      var br = activeBtn.getBoundingClientRect();
      rail.style.top = Math.max(0, br.top - lr.top) + 'px';
    }
    var stt = replay.stats();
    var open = replay.gold.mark() + replay.nasdaq.mark();
    $('stats').innerHTML =
      stat('Closed', stt.n) + stat('Win rate', stt.n ? Math.round(stt.winRate * 100) + '%' : '—') +
      stat('R total', (stt.r >= 0 ? '+' : '') + stt.r.toFixed(2)) + stat('Rejects', rejects);
    var eq = Math.max(1, equity0 + replay.gold.realized + replay.nasdaq.realized); // same basis the engine sizes and caps on
    var orisk = replay.openRisk();
    var pct = eq ? orisk / eq : 0;
    $('riskLab').textContent = (pct * 100).toFixed(2) + '% at risk · $' + Math.round(orisk).toLocaleString('en-US');
    $('needle').style.left = Math.max(0, Math.min(98, pct / 0.02 * 100)) + '%';
    renderConds(fi);
    renderVsa(fi);
    var en = weaknessEnergy(fi);
    $('energyNum').textContent = String(en);
    $('energyBar').style.width = en + '%';
    $('pos').innerHTML = posCard(g) + posCard(n);
    var ul = $('tape');
    ul.innerHTML = tape.slice(0, 12).map(function (t) {
      var when = t.t ? DMF.fmtZone(t.t, 'syd').full : '';
      var extra = t.pnl == null ? '' : '<em>' + (t.r >= 0 ? '+' : '') + t.r.toFixed(2) + 'R</em><em>' + DMF.fmtUsd(t.pnl, 0) + '</em>';
      return '<li class="' + t.kind + '"><b>' + (t.kind === 'entry' ? 'FILL' : 'EXIT') + '</b><span>' + escapeHtml(t.text) + '<br><small style="color:#dfe9f0">' + when + '</small></span>' + extra + '</li>';
    }).join('') || '<li><b>—</b><span>No fills yet. The bot is scanning the sim tape.</span></li>';
    $('tfLab').textContent = 'chart ' + chartTf + ' · Sydney axis';
    drawSpark();
  }

  function stat(k, v) { return '<div><small>' + k + '</small><b>' + v + '</b></div>'; }

  function setPx(id, inst) {
    var el = $('px-' + id);
    var bars = inst.m5;
    if (!bars.length) { el.textContent = '—'; return; }
    var c = bars[bars.length - 1].c;
    var p = bars.length > 1 ? bars[bars.length - 2].c : c;
    el.textContent = DMF.fmtPx(inst.spec, c);
    el.classList.toggle('up', c >= p);
    el.classList.toggle('dn', c < p);
  }

  function posCard(inst) {
    var p = inst.pos;
    var last = inst.m5[inst.m5.length - 1];
    if (!p || !last) return '<div class="card"><h3>' + inst.spec.label + '</h3><p class="flat">Flat. No open short.</p></div>';
    var open = (p.entry - last.c) * p.point * p.qty;
    var r = (p.entry - last.c) / p.R;
    var room = p.trail != null ? (p.trail - last.c) : (p.stop - last.c);
    var ticks = Math.round(room / inst.spec.tick);
    return '<div class="card live"><h3>' + inst.spec.label + ' · ' + p.qty + ' ' + p.product + ' short</h3><p>Entry ' + DMF.fmtPx(inst.spec, p.entry) +
      ' · stop ' + DMF.fmtPx(inst.spec, p.stop) + ' · risk ' + DMF.fmtUsd(-p.riskUsd, 0).replace('+', '−') +
      '<br>Open ' + DMF.fmtUsd(open, 0) + ' · ' + (r >= 0 ? '+' : '') + r.toFixed(2) + 'R' +
      '<br>' + (p.trail != null ? ('Trail ' + DMF.fmtPx(inst.spec, p.trail) + ' · ' + ticks + ' ticks of room' + (p.exitNext ? ' · close is through the trail, exit next open' : '')) : 'Trail arms the bar after entry') +
      '</p></div>';
  }

  function drawSpark() {
    var c = $('spark');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth || 280, h = c.clientHeight || 84;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var all = replay.equityCurve || [];
    var start = 0;
    for (var si = 0; si < all.length; si++) {
      if (Math.abs(all[si] - equity0) > 1) { start = Math.max(0, si - 6); break; }
    }
    var eq = all.slice(start);
    if (eq.length > 160) eq = eq.slice(-160);
    if (eq.length < 2) return;
    var min = eq[0], max = eq[0];
    for (var i = 0; i < eq.length; i++) { if (eq[i] < min) min = eq[i]; if (eq[i] > max) max = eq[i]; }
    if (max - min < 20) { min -= 20; max += 20; }
    var pts = eq.map(function (v, i) {
      return [i / (eq.length - 1) * (w - 8) + 4, 6 + (1 - (v - min) / (max - min)) * (h - 14)];
    });
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var k = 1; k < pts.length - 1; k++) {
      var mx = (pts[k][0] + pts[k + 1][0]) / 2;
      var my = (pts[k][1] + pts[k + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    var up = eq[eq.length - 1] >= equity0;
    ctx.strokeStyle = up ? '#e8f4fb' : '#ffd9cf';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.lineTo(pts[pts.length - 1][0], h - 2);
    ctx.lineTo(pts[0][0], h - 2);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 4, 0, h);
    if (up) {
      g.addColorStop(0, 'rgba(159, 211, 238, 0.55)');
      g.addColorStop(0.55, 'rgba(47, 220, 203, 0.22)');
      g.addColorStop(1, 'rgba(47, 220, 203, 0.02)');
    } else {
      g.addColorStop(0, 'rgba(255, 156, 134, 0.5)');
      g.addColorStop(0.6, 'rgba(255, 138, 76, 0.2)');
      g.addColorStop(1, 'rgba(255, 138, 76, 0.02)');
    }
    ctx.fillStyle = g;
    ctx.fill();
  }

  function updateOdo(target) {
    var el = $('odo');
    if (!el.dataset.built) {
      el.innerHTML = '<span class="sign">+$</span>';
      for (var i = 0; i < 6; i++) {
        var d = document.createElement('div');
        d.className = 'odig';
        var strip = document.createElement('div');
        strip.className = 'strip';
        for (var n = 0; n < 10; n++) {
          var cell = document.createElement('b');
          cell.textContent = String(n);
          strip.appendChild(cell);
        }
        d.appendChild(strip);
        el.appendChild(d);
      }
      el.dataset.built = '1';
      lastOdo = null;
    }
    var rounded = Math.round(target);
    if (rounded === lastOdo) return;
    lastOdo = rounded;
    var neg = rounded < 0;
    el.classList.toggle('up', !neg);
    el.classList.toggle('dn', neg);
    el.querySelector('.sign').textContent = (neg ? '−' : '+') + '$';
    var digits = String(Math.abs(rounded)).padStart(6, '0').slice(-6);
    var strips = el.querySelectorAll('.odig .strip');
    var odigs = el.querySelectorAll('.odig'); var h = odigs[odigs.length - 1].clientHeight || 48;
    var sig = Math.max(1, String(Math.abs(rounded)).length);
    for (var k = 0; k < 6; k++) {
      strips[k].style.transform = 'translateY(' + (-(+digits[k]) * h) + 'px)';
      strips[k].parentNode.style.display = k < 6 - sig ? 'none' : '';
    }
    el.classList.toggle('flat', rounded === 0);
  }

  function clocks() {
    var now = Date.now();
    var syd = DMF.fmtZone(now, 'syd');
    var et = DMF.fmtZone(now, 'et');
    var g = DMF.globexState(now);
    $('nowClock').textContent = syd.full;
    var pill = $('pillNow');
    pill.classList.remove('open', 'break', 'closed');
    pill.classList.add(g === 'OPEN' ? 'open' : g === 'BREAK' ? 'break' : 'closed');
    $('pillNow').querySelector('.k').textContent = 'Now · ' + g;
    $('nowClock').textContent = syd.clock + ' · ET ' + et.clock;
  }

  function setPlayLabel() {
    var b = $('btnPlay');
    b.textContent = playing ? 'Pause' : 'Play';
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    var t = $('stPlay');
    if (t) { t.textContent = playing ? '❚❚' : '▶'; t.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
  }
  function setSpeed(x) {
    speed = x;
    ['speeds', 'stSpeeds'].forEach(function (id) {
      var g = $(id); if (!g) return;
      g.querySelectorAll('button[data-sp]').forEach(function (b) { b.classList.toggle('on', +b.dataset.sp === x); });
    });
  }
  /* bar index of the next CONFIRMING phase, found on a private copy of the replay (deterministic, never touches the live one) */
  function nextConfirmBar() {
    var probe = new DMF.Replay(world, { equity: equity0, risk: risk });
    probe.risk = replay.risk; probe.equity0 = replay.equity0;
    while (probe.i < replay.i && probe.step()) { /* catch up */ }
    while (probe.step()) {
      if (probe.gold.state === 'CONFIRMING' || probe.nasdaq.state === 'CONFIRMING') return probe.i;
    }
    return -1;
  }
  /* fast-forward to ~14 bars before the next confirming phase (so the build, fire and in-trade phase all play), then play */
  function jumpToSetup() {
    var c = nextConfirmBar();
    if (c < 0) { boot(true); c = nextConfirmBar(); }
    if (c >= 0) {
      var target = Math.max(replay.i, c - 14);
      if (target > replay.i) seekUntil(function () { return replay.i >= target; }, 5000);
    }
    acc = 0; playing = true; setPlayLabel();
  }

  function blip(freq, dur) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.value = 0.03;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* ignore */ }
  }



  function vsaWarnLive(fi) {
    if (!fi.pos) return false;
    return !!watcher.strongContra(fi.spec.id, nowT());
  }

  function tfColor(tf) { return 'var(' + (TF_VAR[tf] || '--pearl') + ')'; }

  function renderVsa(fi) {
    var id = fi.spec.id;
    var now = nowT();
    var b = watcher.bias(id, now);
    var tot = b.bear + b.bull;
    var bearW = tot ? Math.min(50, b.bear / Math.max(tot, 8) * 50) : 0;
    var bullW = tot ? Math.min(50, b.bull / Math.max(tot, 8) * 50) : 0;
    $('biasBear').style.width = bearW + '%';
    $('biasBull').style.width = bullW + '%';
    $('biasNum').textContent = fi.spec.label + ' · bearish ' + b.bear.toFixed(1) + ' vs bullish ' + b.bull.toFixed(1) + ' · net ' + (b.net >= 0 ? '+' : '') + b.net.toFixed(2);
    var th = watcher.thesis(id, { nowT: now, label: fi.spec.label });
    var tel = $('thesis');
    var warnLive = !!(fi.pos && th.warn);
    tel.textContent = fi.pos ? th.text : th.text.replace('tape supports the short.', 'tape leans bearish (no open short).');
    tel.className = 'thesis ' + (th.level === 'ok' ? 'ok' : th.level === 'bad' ? 'bad' : '');
    $('vsaFlag').hidden = !warnLive;
    if (warnLive && !warnShown[th.warn.id]) {
      warnShown[th.warn.id] = true;
      var panel = $('vsa');
      panel.classList.remove('warn'); void panel.offsetWidth; panel.classList.add('warn');
    }
    var html = vsaFeed.slice(0, 24).map(function (f) {
      var tag = f.dir === 'bear' ? '<span class="tag bear">CONFIRMS SHORT</span>' : f.dir === 'bull' ? '<span class="tag bull">CONTRADICTS SHORT</span>' : '<span class="tag neu">NEUTRAL</span>';
      var who = f.inst === 'nasdaq' ? 'Nasdaq (sim)' : 'Gold (sim)';
      var str = '<span class="str">' + '●●●'.slice(0, f.strength) + '○○○'.slice(0, 3 - f.strength) + '</span>';
      var fr = vsaFresh[f.id] && performance.now() - vsaFresh[f.id] < 1600 ? ' class="fresh ' + (f.dir === 'bull' ? 'fbull' : 'fbear') + '"' : '';
      return '<li' + fr + '><span class="t">' + DMF.fmtZone(f.closeT, 'syd').clock + '</span><span class="tf" style="--c:' + tfColor(f.tf) + '">' + f.tf.toUpperCase() + '</span>' +
        '<span class="what"><b>' + escapeHtml(f.name) + '</b> ' + str + '<small>' + who + ' · ' + escapeHtml(f.read) + '</small></span>' + tag + '</li>';
    }).join('');
    var feed = $('vsaFeed');
    if (feed._html !== html) { feed.innerHTML = html || '<li><span class="what"><small>No VSA findings yet.</small></span></li>'; feed._html = html; }
  }


  /* Alignment step for the ring tightening: 0 scanning … 6 trigger, 7 trade fire. */
  function alignStep(inst) {
    if (inst.pos) return 7;
    var on = {};
    inst.checklist.forEach(function (c) { on[c.id] = c.on; });
    if (on.entry) return 0;
    if (on.conf) return 6;
    if (on.w5) return 5;
    if (on.w15) return 4;
    if (on.w30) return 3;
    if (on.ut) return 2;
    if (on.nd) return 1;
    return 0;
  }

  /* Weakness energy 0–100 from real closed bars on the confirmed timeframes.
     Per bar (newest 8, age a): down close +1, no-demand +1, upthrust or hidden upthrust +1.5,
     close in bottom third +1, down-bar width vs ATR14 up to +1.5; capped at 4.
     tfScore = Σ(score·0.82^a) / Σ(4·0.82^a) × (1 + 0.12·stack), stack = run of newest bars scoring ≥ 1.5, capped at 1.
     energy = 100 × Σ(w_tf·tfScore) / Σ(w_all), w = HTF 1.0, 30m 0.9, 15m 0.8, 5m 1.0 (denominator always all four). */
  var EN_W = { htf: 1.0, '30m': 0.9, '15m': 0.8, '5m': 1.0 };
  function tfEnergy(bars) {
    var n = bars.length;
    if (n < 4) return 0;
    var num = 0, den = 0, stack = 0, run = true;
    for (var a = 0; a < 8 && n - 1 - a >= 2; a++) {
      var i = n - 1 - a, b = bars[i], p1 = bars[i - 1], p2 = bars[i - 2];
      var rng = b.h - b.l;
      var cl = rng > 0 ? (b.c - b.l) / rng : 0.5;
      var trs = 0, tn = 0;
      for (var k = Math.max(1, i - 14); k < i; k++) { trs += Math.max(bars[k].h - bars[k].l, Math.abs(bars[k].h - bars[k - 1].c), Math.abs(bars[k].l - bars[k - 1].c)); tn++; }
      var atr = tn ? trs / tn : rng;
      var sc = 0;
      var down = b.c < p1.c;
      if (down) sc += 1;
      if (b.c > p1.c && b.v < p1.v && b.v < p2.v) sc += 1;
      if ((b.h > p1.h && b.c < p1.h && cl <= 0.5) || (cl <= 1 / 3 && down)) sc += 1.5;
      if (cl <= 1 / 3) sc += 1;
      if (down && atr > 0) sc += Math.min(1.5, rng / atr);
      sc = Math.min(4, sc);
      if (run && sc >= 1.5) stack++; else run = false;
      var wa = Math.pow(0.82, a);
      num += sc * wa; den += 4 * wa;
    }
    return den ? Math.min(1, (num / den) * (1 + 0.12 * stack)) : 0;
  }
  function weaknessEnergy(inst) {
    var on = {};
    inst.checklist.forEach(function (c) { on[c.id] = c.on; });
    if (!inst.pos && on.entry) return 0;
    var htfBars = (inst.cx && inst.cx.tf === '4h') ? inst.h4.bars : inst.h2.bars;
    var tot = 0;
    if (on.nd || on.ut) tot += EN_W.htf * tfEnergy(htfBars);
    if (on.w30) tot += EN_W['30m'] * tfEnergy(inst.m30.bars);
    if (on.w15) tot += EN_W['15m'] * tfEnergy(inst.m15.bars);
    if (on.w5 || on.conf || inst.pos) tot += EN_W['5m'] * tfEnergy(inst.m5);
    return Math.round(100 * tot / (EN_W.htf + EN_W['30m'] + EN_W['15m'] + EN_W['5m']));
  }

  function zoneFrac(inst) {
    var p = inst.pos;
    var bar = inst.m5[inst.m5.length - 1];
    if (!p || !p.trailOn || p.trail == null || p.deepTop == null || !bar) return 0;
    var span = p.deepTop - p.trail;
    if (!(span > 1e-9)) return 0;
    if (bar.c > p.trail + 1e-9) return 0;
    if (bar.h <= p.trail) return 0;
    return Math.max(0, Math.min(1, (bar.h - p.trail) / span));
  }

  function ladderNodes() {
    var canvas = swarm.canvas;
    var cr = canvas.getBoundingClientRect();
    var fi = focusInst();
    var on = {};
    fi.checklist.forEach(function (c) { on[c.id] = c.on; });
    var htf = (fi.cx && fi.cx.tf) || '2h';
    var hot = ladderTf(fi);
    return ['4h', '2h', '30m', '15m', '5m'].map(function (tf) {
      var ai = ['4h', '2h', '30m', '15m', '5m'].indexOf(tf);
      var ax = 4, ay = cr.height * (0.36 + 0.085 * ai);
      var lit = tf === '4h' ? (htf === '4h' && !!on.nd)
        : tf === '2h' ? (htf === '2h' && !!on.nd)
        : tf === '30m' ? !!on.w30
        : tf === '15m' ? !!on.w15
        : !!(on.w5 || on.conf || on.entry);
      return { tf: tf, x: ax, y: ay, lit: lit, hot: tf === hot };
    });
  }

  function renderConds(fi) {
    var box = $('condPips');
    var list = fi.checklist;
    var n = 0;
    list.forEach(function (c) { if (c.on) n++; });
    $('condCount').textContent = String(n);
    $('condOf').textContent = ' / ' + list.length;
    if (box.childElementCount !== list.length) {
      box.innerHTML = list.map(function () { return '<i></i>'; }).join('');
      box._on = [];
    }
    var prev = box._on || [];
    list.forEach(function (c, i) {
      var pip = box.children[i];
      var on = !!c.on;
      pip.classList.toggle('on', on);
      pip.title = c.label;
      if (prev[i] !== on) {
        pip.classList.remove('flip');
        void pip.offsetWidth;
        pip.classList.add('flip');
      }
    });
    box._on = list.map(function (c) { return !!c.on; });
    var z = zoneFrac(fi);
    var tag = $('deepTag');
    var inTrade = fi.state === 'IN TRADE' || fi.state === 'TRAILING';
    tag.hidden = !(z > 0.02 && inTrade);
  }

  function attrFor() {
    var canvas = swarm.canvas;
    var cr = canvas.getBoundingClientRect();
    var tf = ladderTf(focusInst());
    if (!tf) return { x: cr.width * 0.5, y: cr.height * 0.5, k: 0.004 };
    var ai = ['4h', '2h', '30m', '15m', '5m'].indexOf(tf);
    if (ai < 0) return null;
    return { x: 4, y: cr.height * (0.36 + 0.085 * ai), k: 0.018 };
  }

  function frame(now) {
    var dt = lastTs ? Math.min(0.05, (now - lastTs) / 1000) : 0.016;
    lastTs = now;
    if (playing) {
      acc += dt * 1000 * speed;
      var budget = 0;
      var gap = BAR_MS * (inSetup() ? DWELL : 1);
      while (acc >= gap && budget < 8) {
        acc -= gap;
        gap = BAR_MS * (inSetup() ? DWELL : 1);
        if (!doStep()) break;
        budget++;
      }
      if (budget === 8) acc = 0;
    }
    tickType(dt);
    var fi = focusInst();
    var energyNow = weaknessEnergy(fi);
    var locks = {};
    fi.checklist.forEach(function (c) { locks[c.id] = c.on; });
    swarm.draw(dt, {
      state: fi.state,
      conf: fi.conf,
      locks: locks,
      reduced: !motion(),
      attr: attrFor(),
      label: fi.spec.label.toUpperCase(),
      nodes: ladderNodes(),
      bristle: zoneFrac(fi),
      merged: !!fi.pos,
      step: alignStep(fi),
      energy: energyNow,
      bias: watcher.bias(fi.spec.id, nowT()),
      vsaWarn: vsaWarnLive(fi)
    });
    chartG.draw(now, motion());
    chartN.draw(now, motion());
    var open = replay.gold.mark() + replay.nasdaq.mark();
    updateOdo(replay.gold.realized + replay.nasdaq.realized + open);
    updateHud(fi, replay.gold.realized + replay.nasdaq.realized + open, open);
    if (!captureMode) requestAnimationFrame(frame);
  }

  /* stage HUD: state + conviction, live P&L, render mode label (DOM text, never on the GL canvas) */
  var hudLast = {};
  function hudSet(id, v) { if (hudLast[id] !== v) { var el = $(id); if (!el) return; hudLast[id] = v; el.textContent = v; } }
  function money(v) { var r = Math.round(v); return (r < 0 ? '−$' : '+$') + Math.abs(r).toLocaleString('en-AU'); }
  function updateHud(fi, total, open) {
    hudSet('hudState', fi.state);
    hudSet('hudPct', Math.round(fi.conf * 100) + '%');
    hudSet('hudInst', fi.spec.label);
    var nOpen = (replay.gold.pos ? 1 : 0) + (replay.nasdaq.pos ? 1 : 0);
    var n = replay.stats().n;
    hudSet('hudOpen', nOpen ? ('open ' + money(open) + ' · ' + nOpen + (nOpen > 1 ? ' shorts' : ' short') + ' · ' + n + ' closed') : ('flat · ' + n + ' closed'));
    if (swarm.modeLabel) hudSet('hudMode', swarm.modeLabel);
  }

  function gotoPhase(phase) {
    if (phase === 'scan') { boot(true); if (swarm.calm) swarm.calm(); return Promise.resolve(); }
    var pred;
    if (phase === 'reject') pred = function () { return replay.events.some(function (e) { return e.type === 'reject'; }); };
    else if (phase === 'setup') pred = function () { return replay.events.some(function (e) { return e.type === 'ut5'; }); };
    else if (phase === 'trade') pred = function () {
      return (replay.gold.pos && replay.gold.trailHist.length >= 4) || (replay.nasdaq.pos && replay.nasdaq.trailHist.length >= 4);
    };
    else if (phase === 'exit') pred = function () { return replay.events.some(function (e) { return e.type === 'win' || e.type === 'loss'; }); };
    else if (phase === 'entry') pred = function () { return replay.events.some(function (e) { return e.type === 'entry'; }); };
    else if (phase === 'vsaBear' || phase === 'vsaBull') {
      var want = phase === 'vsaBear' ? 'bear' : 'bull';
      var mark = vsaFeed.length ? vsaFeed[0].id : 0;
      lastVsa[want] = null;
      pred = function () {
        var f = lastVsa[want];
        return !!(f && f.id > mark && f.inst === focusInst().spec.id && (want === 'bull' || f.strength >= 2));
      };
    }
    else if (phase === 'step6') pred = function () { var fx = focusInst(); return !fx.pos && alignStep(fx) >= 6; };
    else if (phase === 'deep') pred = function () { return zoneFrac(replay.gold) > 0.05 || zoneFrac(replay.nasdaq) > 0.05; };
    else pred = function () { return false; };
    if (phase === 'exit' || phase === 'trade' || phase === 'setup' || phase === 'reject' || phase === 'deep' || phase === 'entry' || phase === 'step6') {
      if (replay.i < world.previewAt) boot(true);
    }
    seekUntil(pred, 5000);
    if (phase === 'exit') { doStep(); doStep(); ingest([], true); renderDom(); }
    if (phase === 'reject') swarm.burst('invalid');
    else if (swarm.calm) swarm.calm();
    if (phase === 'entry') {
      var ef = focusInst();
      swarm.burst('entry');
      swarm.fire(watcher.bias(ef.spec.id, nowT()).net > -0.15);
    }
    if (phase === 'vsaBear' && lastVsa.bear) swarm.vsa(lastVsa.bear);
    if (phase === 'vsaBull' && lastVsa.bull) swarm.vsa(lastVsa.bull);
    return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(res); }); });
  }

  async function loadBars(symbol, tf) {
    var man = null;
    try {
      var mr = await fetch('data/custom/manifest.json', { cache: 'no-store' });
      if (mr.ok) man = await mr.json();
    } catch (e) { man = { files: [] }; }
    var key = symbol + '_' + tf;
    var files = (man && man.files) || [];
    if (files.indexOf(key + '.json') < 0 && files.indexOf(key + '.csv') < 0 && files.indexOf(key) < 0) return null;
    var urls = ['data/custom/' + symbol + '_' + tf + '.json', 'data/custom/' + symbol + '_' + tf + '.csv'];
    for (var i = 0; i < urls.length; i++) {
      try {
        var res = await fetch(urls[i], { cache: 'no-store' });
        if (!res.ok) continue;
        var text = await res.text();
        if (!text || text.trim().charAt(0) === '<') continue;
        var bars = DMF.parseBars(text);
        if (bars && bars.length) return bars;
      } catch (e) { /* missing file is the normal demo case */ }
    }
    return null;
  }

  /* ---------- LOOK switcher: Mountain (orbit swarm) · Vortex (cascade funnel) · Aurora (curtains) ----------
     Only the stage renderer and the chrome theme change; engine, sim, VSA watcher, risk and P&L are shared. */
  var LOOKS = { mountain: 'Swarm', vortex: 'VortexLook', aurora: 'AuroraLook' };
  var currentLook = document.documentElement.getAttribute('data-look') || 'mountain';
  if (!LOOKS[currentLook]) currentLook = 'mountain';
  function makeLook(look) {
    var old = $('swarm');
    if (swarm && swarm.destroy) swarm.destroy();
    var fresh = old.cloneNode(false);           /* drops the old renderer's listeners and 2D context */
    fresh.classList.remove('overlay3d');
    old.parentNode.replaceChild(fresh, old);
    var Ctor = window[LOOKS[look]] || window.Swarm;
    var r;
    try { r = new Ctor(fresh); } catch (e) { if (window.console) console.warn('Look "' + look + '" failed, using Mountain:', e.message); r = new window.Swarm(fresh); }
    return r;
  }
  function setLook(look, remember) {
    if (!LOOKS[look]) look = 'mountain';
    var changed = look !== currentLook;
    currentLook = look;
    document.documentElement.setAttribute('data-look', look);
    if (remember !== false) { try { localStorage.setItem('cm.look', look); } catch (e) { /* private mode */ } }
    try {
      var u = new URL(location.href);
      if (look === 'mountain') u.searchParams.delete('look'); else u.searchParams.set('look', look);
      history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch (e) { /* file:// */ }
    document.querySelectorAll('#lookSw button').forEach(function (b) {
      var on = b.getAttribute('data-look') === look;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (changed && swarm) { swarm = makeLook(look); hudLast = {}; if (captureMode) frame(performance.now()); }
  }
  function wireLooks() {
    document.querySelectorAll('#lookSw button').forEach(function (b) {
      b.addEventListener('click', function () { setLook(b.getAttribute('data-look')); });
    });
    setLook(currentLook, /[?&]look=/.test(location.search));
  }

  function wire() {
    chartG = new ChartPane($('c-gold'), $('tip-gold'));
    chartN = new ChartPane($('c-nasdaq'), $('tip-nasdaq'));
    swarm = makeLook(currentLook);
    wireLooks();
    watcher = new VSAWatcher({ tfs: TFS });
    watcher.subscribe(onFinding);
    chartG.setVsa(function () { return watcher.findings('gold'); });
    chartN.setVsa(function () { return watcher.findings('nasdaq'); });
    if (!motionOn) document.body.classList.add('rm');
    $('btnMotion').textContent = motionOn ? 'Motion on' : 'Motion off';
    $('btnMotion').setAttribute('aria-pressed', motionOn ? 'true' : 'false');
    boot(true);
    setPlayLabel();
    clocks();
    setInterval(clocks, 1000);
    $('btnPlay').onclick = function () { playing = !playing; setPlayLabel(); };
    $('btnStep').onclick = function () { playing = false; setPlayLabel(); doStep(); };
    $('btnNext').onclick = function () {
      playing = false; setPlayLabel();
      var seen = false;
      seekUntil(function () {
        var hit = replay.events.some(function (e) { return e.type === 'nd' || e.type === 'ut' || e.type === 'ut5' || e.type === 'confirm' || e.type === 'entry' || e.type === 'reject'; });
        if (hit && seen) return true;
        if (hit) seen = true;
        return false;
      }, 2500);
    };
    $('btnRestart').onclick = function () {
      seed = +$('seed').value || 7;
      equity0 = Math.max(1000, +$('equity').value || 50000);
      risk = Math.min(0.01, Math.max(0.0025, (+$('risk').value || 0.75) / 100));
      playing = true; setPlayLabel(); boot(true);
    };
    $('speeds').onclick = function (e) {
      var b = e.target.closest('button'); if (!b || !b.dataset.sp) return;
      setSpeed(+b.dataset.sp);
    };
    /* TEMP speed tool in the stage: same state as the controls bar (kept in sync) */
    $('stSpeeds').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      setSpeed(+b.dataset.sp);
    };
    $('stPlay').onclick = function () { playing = !playing; setPlayLabel(); };
    $('stJump').onclick = function () { jumpToSetup(); };
    $('tfPick').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      chartTf = b.dataset.tf;
      chartG.setTf(chartTf); chartN.setTf(chartTf);
      $('tfPick').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderDom();
    };
    $('focus').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      focus = b.dataset.f;
      document.body.classList.remove('focus-gold', 'focus-nasdaq');
      if (focus === 'gold') document.body.classList.add('focus-gold');
      if (focus === 'nasdaq') document.body.classList.add('focus-nasdaq');
      $('focus').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderDom();
    };
    $('btnMotion').onclick = function () {
      motionOn = !motionOn;
      document.body.classList.toggle('rm', !motionOn);
      this.textContent = motionOn ? 'Motion on' : 'Motion off';
      this.setAttribute('aria-pressed', motionOn ? 'true' : 'false');
    };
    $('btnSound').onclick = function () {
      soundOn = !soundOn;
      this.textContent = soundOn ? 'Sound on' : 'Sound off';
      this.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    };
    $('risk').oninput = function () {
      $('riskPctLab').textContent = (+this.value).toFixed(2) + '%';
      risk = Math.min(0.01, (+this.value) / 100);
      if (replay) replay.risk = risk;
    };
    $('equity').onchange = function () {
      equity0 = Math.max(1000, +this.value || 50000);
      if (replay) replay.equity0 = equity0;
    };
    document.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); playing = !playing; setPlayLabel(); }
      if (e.code === 'ArrowRight') { playing = false; setPlayLabel(); doStep(); }
    });
    window.__DMF = {
      ready: false,
      goto: gotoPhase,
      play: function () { playing = true; setPlayLabel(); },
      pause: function () { playing = false; setPlayLabel(); },
      setSpeed: function (x) { setSpeed(x); },
      jumpToSetup: function () { jumpToSetup(); return replay.i; },
      speed: function () { return speed; },
      step: function () { playing = false; doStep(); },
      tick: function (n, ms) {
        for (var k = 0; k < (n || 1); k++) { virtualNow += (ms || 1000 / 30); frame(virtualNow); }
        return virtualNow;
      },
      counts: function () { return swarm.counts || null; },
      look: function () { return currentLook; },
      setLook: function (l) { setLook(l); return currentLook; },
      state: function () {
        return {
          i: replay.i,
          gold: { state: replay.gold.state, conf: replay.gold.conf, pos: !!replay.gold.pos, trades: replay.gold.trades.length },
          nasdaq: { state: replay.nasdaq.state, conf: replay.nasdaq.conf, pos: !!replay.nasdaq.pos, trades: replay.nasdaq.trades.length },
          pnl: replay.gold.realized + replay.nasdaq.realized + replay.gold.mark() + replay.nasdaq.mark(),
          deep: { gold: zoneFrac(replay.gold), nasdaq: zoneFrac(replay.nasdaq) },
          vsa: { n: watcher.all.length, bear: watcher.all.filter(function (f) { return f.dir === 'bear'; }).length, bull: watcher.all.filter(function (f) { return f.dir === 'bull'; }).length, warn: vsaWarnLive(focusInst()) },
          focus: focusInst().spec.id,
          shown: shown,
          render: { mode: swarm.mode, fps: Math.round(swarm.fps || 0), cpuMs: +(swarm.cpuMs || 0).toFixed(2) },
          energy: weaknessEnergy(focusInst()),
          step: alignStep(focusInst()),
          merged: !!focusInst().pos,
          cond: focusInst().checklist.filter(function (c) { return c.on; }).length,
          log: ring.slice(-6).map(function (e) { return e.msg; })
        };
      }
    };
    if (captureMode) { virtualNow = 1000; lastTs = 0; frame(virtualNow); }
    else requestAnimationFrame(frame);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { window.__DMF.ready = true; });
    else window.__DMF.ready = true;
    setTimeout(function () { window.__DMF.ready = true; }, 600);
  }

  document.addEventListener('DOMContentLoaded', function () {
    wire();
    loadBars('GC', '5m').then(function (gc) {
      return loadBars('NQ', '5m').then(function (nq) {
        custom = { GC: gc, NQ: nq };
        var note = $('realNote');
        if ((gc && gc.length) || (nq && nq.length)) {
          note.textContent = ' Custom files detected — real mode is still off. Wire createWorld replacement when you want them driving the tape.';
        } else {
          note.textContent = ' No custom files found. Real mode off.';
        }
      });
    }).catch(function () {
      $('realNote').textContent = ' No custom files found. Real mode off.';
    });
  });

  window.addEventListener('error', function (e) {
    console.error(e.message);
  });
})();
