/* VSA Watcher — advisory overseer for Cascade Mountain.
   Reads closed sim bars per timeframe and publishes findings. It never writes to the
   trading engine: no entries, stops or exits are changed here.

   API
     var w = new VSAWatcher({ tfs: ['5m','15m','30m','2h','4h'] });
     w.subscribe(fn)            fn(finding) for every new finding or sequence status change
     w.ingest(instId, tf, bars) call after each replay step; scans bars it has not seen yet
     w.findings(instId?)        newest-last list (both instruments if omitted)
     w.bias(instId, nowT)       { bear, bull, net } over recent bars (time-decayed)
     w.thesis(instId, ctx)      { text, level: 'ok'|'bad'|'neutral', warn: finding|null }
     w.reset()

   Finding
     { id, inst, tf, t (bar open, ms), closeT, code, name, read, dir: 'bear'|'bull'|'neutral',
       verdict: 'CONFIRMS SHORT'|'CONTRADICTS SHORT'|'NEUTRAL', strength: 1..3, kind: 'sign'|'seq'|'status' }

   Rules follow the Gavin Holmes / TradeGuider set-up sequences as calibrated in the
   vsa-trade-setup-sequences workflow: vr, sr, cl, 20-bar lookbacks, A->B->C within 20 bars,
   extreme + structure checks, trigger = 0.1% beyond bar C within 3 bars, no look-ahead. */
(function (global) {
  'use strict';

  var TF_MIN = { '5m': 5, '15m': 15, '30m': 30, '2h': 120, '4h': 240 };
  var TF_W = { '5m': 1, '15m': 1.5, '30m': 2, '2h': 2.6, '4h': 3 };

  function mean(arr, a, b, f) {
    var s = 0, n = 0;
    for (var i = Math.max(0, a); i < b; i++) { s += f(arr[i]); n++; }
    return n ? s / n : 0;
  }

  /* Per-bar measures using bars <= i only. */
  function measure(bars, i) {
    var b = bars[i];
    var p = bars[i - 1];
    var spread = b.h - b.l;
    var mv = mean(bars, i - 20, i, function (x) { return x.v; });
    var ms = mean(bars, i - 20, i, function (x) { return x.h - x.l; });
    var hh = -Infinity, ll = Infinity;
    for (var k = Math.max(0, i - 20); k < i; k++) { if (bars[k].h > hh) hh = bars[k].h; if (bars[k].l < ll) ll = bars[k].l; }
    var chg = p ? b.c - p.c : 0;
    var level = Math.abs(chg) <= 0.1 * spread;
    var sma50 = mean(bars, i - 49, i + 1, function (x) { return x.c; });
    var sma50p = mean(bars, i - 59, i - 9, function (x) { return x.c; });
    var sma20 = mean(bars, i - 19, i + 1, function (x) { return x.c; });
    return {
      vr: mv > 0 ? b.v / mv : 1,
      sr: ms > 0 ? spread / ms : 1,
      cl: spread > 0 ? (b.c - b.l) / spread : 0.5,
      up: !!p && chg > 0 && !level,
      down: !!p && chg < 0 && !level,
      level: !!p && level,
      vLow2: i >= 2 && b.v < bars[i - 1].v && b.v < bars[i - 2].v,
      vAbovePrev: !!p && b.v > p.v,
      nh: i >= 20 && b.h >= hh,
      nl: i >= 20 && b.l <= ll,
      hh20: hh, ll20: ll,
      /* Intraday adaptation of "rising market": 50-bar mean rising over 10 bars and price above it. */
      rising: i >= 60 && sma50 > sma50p && b.c > sma50,
      falling: i >= 60 && sma50 < sma50p && b.c < sma50,
      below20: b.c < sma20
    };
  }

  /* Tag bar i with every step definition it meets (two-bar patterns tag their second bar). */
  function tags(bars, M, i) {
    var m = M[i], p = M[i - 1], b = bars[i], pb = bars[i - 1];
    var T = {};
    if (!m) return T;
    T.nd = (m.up || (m.down && pb && b.h > pb.h)) && m.vLow2 && m.sr < 1.25;
    T.ns = m.down && m.vLow2 && m.sr < 1.25;
    T.ut = !!pb && b.h > pb.h && m.cl <= 0.3 && m.sr >= 1.0;
    T.test = !!pb && b.l < pb.l && m.cl >= 0.5 && m.vr <= 0.8 && !!p && b.v < pb.v;
    T.nst = T.ns || T.test;
    T.bc = m.up && m.nh && m.rising && m.vr >= 1.3 && m.cl >= 0.25 && m.cl <= 0.75;
    T.sci = m.up && m.vr >= 1.3 && m.vAbovePrev && m.cl < 0.7;
    T.sci2 = !!p && p.up && p.vr >= 1.3 && m.down;
    T.eorm = m.up && m.sr <= 0.75 && m.vr >= 1.3 && m.nh && m.cl < 0.7;
    T.pca = !!p && p.up && m.up && p.vr >= 1.3 && m.vr >= 1.3 && m.vAbovePrev && m.cl < 0.7 && m.nh;
    var recentTest = false;
    for (var k = Math.max(1, i - 5); k < i; k++) if (M[k] && M[k].tags && M[k].tags.test) recentTest = true;
    var below3 = i >= 3 && b.c < Math.min(bars[i - 1].l, bars[i - 2].l, bars[i - 3].l);
    T.ft = m.down && m.sr >= 1.25 && m.cl <= 0.3 && below3 && recentTest;
    T.utw = T.ut && !!p && p.up && p.vr >= 1.3;
    T.rer = !!p && p.cl >= 0.7 && p.vr >= 1.2 && p.up && m.down && pb && (pb.c - b.c) >= 0.6 * Math.max(1e-9, pb.c - (bars[i - 2] ? bars[i - 2].c : pb.o));
    T.tr = !!p && p.up && p.cl >= 0.7 && m.down && m.cl <= 0.3 && pb && b.c < (pb.h + pb.l) / 2;
    T.sod = m.up && m.vr >= 1.2 && m.vAbovePrev && m.cl <= 0.5;
    T.phs = (m.up || m.level) && m.cl <= 0.6 && (m.vr >= 1.2 || m.vLow2);
    T.dos = m.down && m.vr >= 1.2 && m.vAbovePrev && m.cl >= 0.5;
    T.psc = m.down && m.nl && m.falling && m.vr >= 1.3;
    var lo10 = Infinity;
    for (var q = Math.max(0, i - 10); q < i; q++) lo10 = Math.min(lo10, bars[q].l);
    var vAbove3 = i >= 3 && b.v > bars[i - 1].v && b.v > bars[i - 2].v && b.v > bars[i - 3].v;
    T.sv = m.down && b.l <= lo10 + (b.h - b.l) * 0.25 && vAbove3 && m.vr >= 1.3 && m.cl >= 0.5;
    T.br = !!p && p.down && p.cl <= 0.3 && m.up && m.cl >= 0.7 && pb && b.c > (pb.h + pb.l) / 2;
    T.so = m.nl && m.cl >= 0.6 && m.vr >= 1.3;
    T.cas = T.so || (T.psc && m.cl >= 0.7);
    var recentSo = false;
    for (var r = Math.max(1, i - 10); r < i; r++) if (M[r] && M[r].tags && M[r].tags.so) recentSo = true;
    T.tas = T.test && recentSo;
    T.bag = m.down && m.sr <= 0.75 && m.vr >= 2 && m.nl && m.falling;
    var brk = !!p && i >= 21 && pb.c > p.hh20;
    T.tob = (T.test || T.ns) && m.cl >= 0.5 && brk;
    T.trm = T.test && m.rising;
    T.ppb = T.psc && m.vr >= 2.0;
    T.rtb = !!p && p.down && p.nl && m.up && m.sr >= 1.25 && m.cl >= 0.5;
    /* Single-bar watch items that are not sequence steps. */
    T.sos = m.up && m.sr >= 1.25 && m.vr >= 1.3 && m.cl < 0.7;
    T.hut = !!pb && b.h <= pb.h && m.cl <= 1 / 3 && m.down && !!p && p.up && m.vr >= 1.0;
    T.sc = m.down && m.nl && m.falling && m.vr >= 1.3 && m.cl >= 0.25;
    T.spring = !!pb && b.l < m.ll20 && b.c > m.ll20 && m.cl >= 0.6 && m.vr < 1.3 && i >= 20;
    var hi5 = -Infinity;
    for (var u5 = Math.max(0, i - 5); u5 < i; u5++) hi5 = Math.max(hi5, bars[u5].h);
    T.utSign = T.ut && m.vr >= 1.0 && b.h >= hi5;
    T.evrUp = m.up && m.vr >= 1.8 && m.sr <= 0.6;
    T.evrDn = m.down && m.vr >= 1.8 && m.sr <= 0.6;
    return T;
  }

  var SEQ = [
    { code: 'W1', dir: 'bear', name: 'Buying climax → supply / upthrust → no demand', A: 'bc', B: ['sci2', 'ut'], C: 'nd' },
    { code: 'W2', dir: 'bear', name: 'Supply coming in → supply coming in → no demand', A: 'sci', B: 'sci', C: 'nd' },
    { code: 'W3', dir: 'bear', name: 'Possible hidden selling → supply coming in → no demand', A: 'phs', B: 'sci', C: 'nd' },
    { code: 'W4', dir: 'bear', name: 'No demand → upthrust → no demand', A: 'nd', B: 'ut', C: 'nd' },
    { code: 'W5', dir: 'bear', name: 'End of rising market → upthrust → no demand', A: 'eorm', B: 'ut', C: 'nd' },
    { code: 'W6', dir: 'bear', name: 'Climactic action → failed test → upthrust after weakness', A: 'pca', B: 'ft', C: 'utw' },
    { code: 'W7', dir: 'bear', name: 'Reversal after effort to rise → upthrust → no demand', A: 'rer', B: 'ut', C: 'nd', group: 'W78' },
    { code: 'W8', dir: 'bear', name: 'Top reversal → upthrust → no demand', A: 'tr', B: 'ut', C: 'nd', group: 'W78' },
    { code: 'W9', dir: 'bear', name: 'Supply overcoming demand → upthrust → no demand', A: 'sod', B: 'ut', C: 'nd' },
    { code: 'W10', dir: 'bear', name: 'End of rising market → no demand → no demand', A: 'eorm', B: 'nd', C: 'nd' },
    { code: 'S1', dir: 'bull', name: 'Demand overcoming supply → no supply / test → no supply', A: 'dos', B: 'nst', C: 'ns', edge: true },
    { code: 'S2', dir: 'bull', name: 'Climactic action → stopping volume → test', A: 'psc', B: 'sv', C: 'test' },
    { code: 'S3', dir: 'bull', name: 'Bottom reversal → test → no supply / test', A: 'br', B: 'test', C: 'nst', group: 'S35' },
    { code: 'S4', dir: 'bull', name: 'Climactic action / shakeout → test → no supply', A: 'cas', B: 'test', C: 'ns', edge: true },
    { code: 'S5', dir: 'bull', name: 'Two-bar reversal → test / no supply → no supply', A: 'br', B: 'nst', C: 'ns', group: 'S35' },
    { code: 'S6', dir: 'bull', name: 'Shakeout → test after shakeout → no supply', A: 'so', B: 'tas', C: 'ns', edge: true },
    { code: 'S7', dir: 'bull', name: 'Bag holding → test of breakout → test in rising market', A: 'bag', B: 'tob', C: 'trm' },
    { code: 'S8', dir: 'bull', name: 'Professional buying → test → no supply / test', A: 'ppb', B: 'test', C: 'nst' },
    { code: 'S9', dir: 'bull', name: 'Selling climax → no supply / test → demand overcoming supply', A: 'psc', B: 'nst', C: 'dos' },
    { code: 'S10', dir: 'bull', name: 'Reversal over two bars → no supply → no supply', A: 'rtb', B: 'ns', C: 'ns', edge: true }
  ];

  /* Single-bar signs (tagged on their own bar, unconfirmed). Order = priority when several hit one bar. */
  var SIGNS = [
    { key: 'bc', dir: 'bear', name: 'Buying climax', s: 2, read: 'Up bar to a new high on heavy volume, closing off the high: buyers are being supplied.' },
    { key: 'sc', dir: 'bull', name: 'Selling climax', s: 3, read: 'Down bar to a new low on heavy volume, closing off the low: someone is absorbing the selling.' },
    { key: 'sv', dir: 'bull', name: 'Stopping volume', s: 2, read: 'Heavy volume near the low with a close in the upper half: selling is being stopped.' },
    { key: 'so', dir: 'bull', name: 'Shakeout', s: 2, read: 'Dropped below support on high volume and closed back up: weak holders shaken out.' },
    { key: 'spring', dir: 'bull', name: 'Spring', s: 1, read: 'Poked below the 20-bar low on modest volume and closed high: no real supply below.' },
    { key: 'sos', dir: 'bear', name: 'Signs of selling', s: 2, read: 'Wide up bar on high volume closing off its high: supply is coming in on the rally.' },
    { key: 'sci2', dir: 'bear', name: 'Supply coming in', s: 2, read: 'High-volume up bar followed straight away by a down bar: the rally met supply.' },
    { key: 'utSign', dir: 'bear', name: 'Upthrust', s: 2, read: 'Pushed above the prior high and closed in the bottom 30%: a trap for buyers.' },
    { key: 'hut', dir: 'bear', name: 'Hidden upthrust', s: 1, read: 'After an up bar, closed down in the bottom third without a new high: quiet selling.' },
    { key: 'nd', dir: 'bear', name: 'No demand', s: 1, read: 'Up bar on volume below the prior two bars: professionals are not buying.' },
    { key: 'ns', dir: 'bull', name: 'No supply', s: 1, read: 'Down bar on volume below the prior two bars: sellers are not pressing.' },
    { key: 'test', dir: 'bull', name: 'Test', s: 1, read: 'Dipped below the prior low on low volume and closed in the upper half: supply tested and absent.' },
    { key: 'evrUp', dir: 'bear', name: 'Effort, no result (up)', s: 1, read: 'Very heavy volume but a narrow up bar: effort to rise is being absorbed.' },
    { key: 'evrDn', dir: 'bull', name: 'Effort, no result (down)', s: 1, read: 'Very heavy volume but a narrow down bar: effort to fall is being absorbed.' }
  ];

  function VSAWatcher(opts) {
    opts = opts || {};
    this.tfs = opts.tfs || ['5m', '15m', '30m', '2h', '4h'];
    this.subs = [];
    this.reset();
  }

  VSAWatcher.prototype.reset = function () {
    this.state = {};
    this.all = [];
    this._id = 0;
  };

  VSAWatcher.prototype.subscribe = function (fn) { this.subs.push(fn); };

  VSAWatcher.prototype._emit = function (f) {
    f.id = ++this._id;
    this.all.push(f);
    if (this.all.length > 600) this.all.splice(0, this.all.length - 600);
    for (var i = 0; i < this.subs.length; i++) {
      try { this.subs[i](f); } catch (e) { /* subscriber errors never reach the scan */ }
    }
  };

  VSAWatcher.prototype._st = function (inst, tf) {
    var key = inst + '|' + tf;
    if (!this.state[key]) this.state[key] = { seen: 0, M: [], armed: [], lastSeq: {}, lastSign: {}, lastBg: -99 };
    return this.state[key];
  };

  VSAWatcher.prototype.ingest = function (inst, tf, bars) {
    if (!bars) return;
    var st = this._st(inst, tf);
    while (st.seen < bars.length) {
      this._scan(inst, tf, bars, st, st.seen);
      st.seen++;
    }
  };

  VSAWatcher.prototype._f = function (inst, tf, bar, o) {
    var dir = o.dir;
    return {
      inst: inst, tf: tf, t: bar.t, closeT: bar.t + TF_MIN[tf] * 60000,
      code: o.code, name: o.name, read: o.read, dir: dir,
      verdict: dir === 'bear' ? 'CONFIRMS SHORT' : dir === 'bull' ? 'CONTRADICTS SHORT' : 'NEUTRAL',
      strength: Math.max(1, Math.min(3, o.strength | 0)), kind: o.kind
    };
  };

  VSAWatcher.prototype._scan = function (inst, tf, bars, st, i) {
    var M = st.M;
    if (i < 1) { M[i] = null; return; }
    var m = measure(bars, i);
    M[i] = m;
    m.tags = tags(bars, M, i);
    var bar = bars[i];
    var self = this;

    /* 1) Resolve armed sequences with this bar (it is a later bar than C, so no look-ahead). */
    st.armed = st.armed.filter(function (a) {
      var age = i - a.c;
      if (a.dir === 'bear') {
        if (bar.c > a.stop) { self._emit(self._f(inst, tf, bar, { dir: 'neutral', code: a.code, name: a.code + ' invalidated', read: 'Closed above the sequence high: the bearish read is wrong.', strength: 1, kind: 'status' })); return false; }
        if (bar.l <= a.trig) { self._emit(self._f(inst, tf, bar, { dir: 'bear', code: a.code, name: a.code + ' confirmed', read: 'Traded 0.1% below bar C: the weakness sequence triggered.', strength: Math.min(3, a.s + 1), kind: 'status' })); return false; }
      } else {
        if (bar.c < a.stop) { self._emit(self._f(inst, tf, bar, { dir: 'neutral', code: a.code, name: a.code + ' invalidated', read: 'Closed below the sequence low: the bullish read is wrong.', strength: 1, kind: 'status' })); return false; }
        if (bar.h >= a.trig) { self._emit(self._f(inst, tf, bar, { dir: 'bull', code: a.code, name: a.code + ' confirmed', read: 'Traded 0.1% above bar C: the strength sequence triggered.', strength: Math.min(3, a.s + 1), kind: 'status' })); return false; }
      }
      if (age >= 3) { self._emit(self._f(inst, tf, bar, { dir: 'neutral', code: a.code, name: a.code + ' expired', read: 'No 0.1% break of bar C within 3 bars: stale.', strength: 1, kind: 'status' })); return false; }
      return true;
    });

    /* 2) Sequences with this bar as C. */
    var fired = {};
    for (var s = 0; s < SEQ.length; s++) {
      var q = SEQ[s];
      if (!m.tags[q.C]) continue;
      var grp = q.group || q.code;
      if (fired[grp]) continue;
      if (st.lastSeq[grp] != null && i - st.lastSeq[grp] < 10) continue;
      var Bi = -1;
      for (var bi = i - 1; bi >= Math.max(1, i - 19); bi--) {
        var bt = M[bi] && M[bi].tags;
        if (!bt) continue;
        var okB = Array.isArray(q.B) ? (bt[q.B[0]] || bt[q.B[1]]) : bt[q.B];
        if (okB) { Bi = bi; break; }
      }
      if (Bi < 0) continue;
      var Ai = -1;
      for (var ai = Bi - 1; ai >= Math.max(1, i - 20); ai--) {
        var at = M[ai] && M[ai].tags;
        if (at && at[q.A]) { Ai = ai; break; }
      }
      if (Ai < 0) continue;
      var ext = false, abHi = -Infinity, abLo = Infinity, acHi = -Infinity, acLo = Infinity;
      for (var k = Ai; k <= i; k++) {
        if (q.dir === 'bear' ? M[k].nh : M[k].nl) ext = true;
        if (bars[k].h > acHi) acHi = bars[k].h;
        if (bars[k].l < acLo) acLo = bars[k].l;
        if (k <= Bi) { if (bars[k].h > abHi) abHi = bars[k].h; if (bars[k].l < abLo) abLo = bars[k].l; }
      }
      if (!ext) continue;
      var intact = true;
      for (var z = Bi + 1; z <= i; z++) {
        if (q.dir === 'bear' && bars[z].c > abHi) intact = false;
        if (q.dir === 'bull' && bars[z].c < abLo) intact = false;
      }
      if (!intact) continue;
      var strength = q.edge ? 3 : 2;
      var fresh = this._recentDir(inst, tf, q.dir === 'bull' ? 'bear' : 'bull', bar.t, 5);
      if (q.dir === 'bull' && m.falling && fresh) strength--;
      if (q.dir === 'bear' && m.rising && fresh) strength--;
      fired[grp] = true;
      st.lastSeq[grp] = i;
      var trig = q.dir === 'bear' ? bar.l * 0.999 : bar.h * 1.001;
      var stop = q.dir === 'bear' ? acHi * 1.001 : acLo * 0.999;
      st.armed.push({ code: q.code, dir: q.dir, c: i, trig: trig, stop: stop, s: strength });
      this._emit(this._f(inst, tf, bar, {
        dir: q.dir, code: q.code, name: q.code + ' · ' + q.name, kind: 'seq', strength: strength,
        read: (q.dir === 'bear' ? 'Weakness' : 'Strength') + ' sequence armed on bar C. Needs a 0.1% break of ' + (q.dir === 'bear' ? 'its low' : 'its high') + ' within 3 bars.'
      }));
    }

    /* 3) Single-bar signs: one per bar (highest priority), deduped per tf for 6 bars. */
    for (var g = 0; g < SIGNS.length; g++) {
      var sg = SIGNS[g];
      if (!m.tags[sg.key]) continue;
      if (st.lastSign[sg.key] != null && i - st.lastSign[sg.key] < 6) break;
      st.lastSign[sg.key] = i;
      var str = sg.s + (m.vr >= 2 ? 1 : 0);
      if (sg.dir === 'bear' && m.falling) str += sg.s === 1 ? 1 : 0;
      this._emit(this._f(inst, tf, bar, { dir: sg.dir, code: sg.key, name: sg.name, read: sg.read, strength: str, kind: 'sign' }));
      break;
    }

    /* 4) Background weakness: falling market, below the 20-bar mean, and repeated bearish signs. */
    if (m.falling && m.below20 && i - st.lastBg >= 20) {
      var n = 0;
      for (var w = this.all.length - 1; w >= 0 && n < 50; w--) {
        var f = this.all[w];
        if (f.inst !== inst || f.tf !== tf) continue;
        if (bar.t - f.t > TF_MIN[tf] * 60000 * 12) break;
        if (f.dir === 'bear' && f.kind !== 'status') n++;
      }
      if (n >= 2) {
        st.lastBg = i;
        this._emit(this._f(inst, tf, bar, { dir: 'bear', code: 'bgw', name: 'Background weakness', read: 'Falling market below its 20-bar mean with repeated supply signs.', strength: 1, kind: 'sign' }));
      }
    }
  };

  VSAWatcher.prototype._recentDir = function (inst, tf, dir, t, nBars) {
    var span = TF_MIN[tf] * 60000 * nBars;
    for (var i = this.all.length - 1; i >= 0; i--) {
      var f = this.all[i];
      if (t - f.t > span * 4) break;
      if (f.inst === inst && f.tf === tf && f.dir === dir && t - f.t <= span) return true;
    }
    return false;
  };

  VSAWatcher.prototype.findings = function (inst) {
    if (!inst) return this.all;
    return this.all.filter(function (f) { return f.inst === inst; });
  };

  /* Time-decayed weight over the last 3 hours of sim time. */
  VSAWatcher.prototype.bias = function (inst, nowT) {
    var win = 3 * 3600000;
    var bear = 0, bull = 0;
    for (var i = this.all.length - 1; i >= 0; i--) {
      var f = this.all[i];
      if (f.inst !== inst) continue;
      var age = nowT - f.closeT;
      if (age > win) { if (age > win * 4) break; continue; }
      if (age < -1) continue;
      var w = f.strength * TF_W[f.tf] * (1 - Math.max(0, age) / win);
      if (f.dir === 'bear') bear += w; else if (f.dir === 'bull') bull += w;
    }
    return { bear: bear, bull: bull, net: (bear - bull) / (bear + bull + 2) };
  };

  /* A strong contradiction = bullish finding with strength 3, or strength 2 on 15m or higher, in the last 45 sim minutes. */
  VSAWatcher.prototype.strongContra = function (inst, nowT) {
    for (var i = this.all.length - 1; i >= 0; i--) {
      var f = this.all[i];
      if (nowT - f.closeT > 45 * 60000) break;
      if (f.inst !== inst || f.dir !== 'bull' || nowT < f.closeT - 1) continue;
      if (f.strength >= 3 || (f.strength >= 2 && TF_W[f.tf] >= 1.5)) return f;
    }
    return null;
  };

  VSAWatcher.prototype.thesis = function (inst, ctx) {
    ctx = ctx || {};
    var b = this.bias(inst, ctx.nowT || 0);
    var c = this.strongContra(inst, ctx.nowT || 0);
    var label = ctx.label || inst;
    if (c) {
      return { text: 'Warning (' + label + '): ' + c.name.toLowerCase() + ' on ' + c.tf + ' contradicts the short.', level: 'bad', warn: c, bias: b };
    }
    if (b.net >= 0.15) return { text: label + ': tape supports the short.', level: 'ok', warn: null, bias: b };
    if (b.net <= -0.15) return { text: label + ': tape leans bullish. The watcher would not add.', level: 'bad', warn: null, bias: b };
    return { text: label + ': tape is mixed, no strong VSA read.', level: 'neutral', warn: null, bias: b };
  };

  VSAWatcher.TF_MIN = TF_MIN;
  VSAWatcher.SEQ = SEQ;
  VSAWatcher.SIGNS = SIGNS;
  if (typeof module === 'object' && module.exports) module.exports = VSAWatcher;
  else global.VSAWatcher = VSAWatcher;
})(typeof window !== 'undefined' ? window : this);
