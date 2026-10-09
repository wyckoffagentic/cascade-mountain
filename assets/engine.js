/* Cascade Mountain — DMF sim engine (futures, demo bars only).
   No network. Real bars can be parsed later via parseBars() / loadBars() in app.js.
   Browser: window.DMF. Node: module.exports.
*/
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DMF = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPECS = {
    gold: {
      id: 'gold', label: 'Gold (sim)', badge: 'GOLD-SIM',
      tick: 0.1, pointMini: 100, pointMicro: 10, mini: 'gold-mini (sim)', micro: 'gold-micro (sim)',
      tickValMini: 10, tickValMicro: 1,
      start: 1800, drift: -0.045, noise: 0.05, range: 0.35, u: 0.5, seedOff: 11,
      pxDigits: 1
    },
    nasdaq: {
      id: 'nasdaq', label: 'Nasdaq (sim)', badge: 'NASDAQ-SIM',
      tick: 0.25, pointMini: 20, pointMicro: 2, mini: 'nasdaq-mini (sim)', micro: 'nasdaq-micro (sim)',
      tickValMini: 5, tickValMicro: 0.5,
      start: 10000, drift: -0.55, noise: 0.35, range: 2.4, u: 4, seedOff: 97,
      pxDigits: 2
    }
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function etStamp(y, m, d, H, M) {
    return Date.parse(y + '-' + pad(m) + '-' + pad(d) + 'T' + pad(H) + ':' + pad(M) + ':00-04:00');
  }

  function roundTick(x, tick) {
    if (!isFinite(x)) return x;
    const n = Math.round(x / tick);
    const v = n * tick;
    return tick < 0.2 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
  }

  function fmtPx(spec, x) {
    if (x == null || !isFinite(x)) return '—';
    return Number(x).toFixed(spec.pxDigits);
  }

  function fmtUsd(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    const d = digits == null ? 0 : digits;
    const sign = x < 0 ? '-' : '+';
    const abs = Math.abs(x);
    return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function clv(b) {
    if (b.h === b.l) return 0.5;
    return (b.c - b.l) / (b.h - b.l);
  }

  function ema(prev, v, n) {
    if (prev == null) return v;
    const a = 2 / (n + 1);
    return prev + a * (v - prev);
  }

  function weekdays(n) {
    const out = [];
    let t = Date.parse('2026-09-14T12:00:00Z');
    while (out.length < n) {
      const d = new Date(t);
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) {
        const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
        out.push({ y: y, m: m, d: day, sess: y + '-' + pad(m) + '-' + pad(day) });
      }
      t += 86400000;
    }
    return out;
  }

  const ET_FMT = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
  const SYD_FMT = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', hour12: false, weekday: 'short',
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  function fmtZone(ts, which) {
    const fmt = which === 'syd' ? SYD_FMT : ET_FMT;
    const parts = fmt.formatToParts(new Date(ts));
    const g = {};
    parts.forEach(function (p) { if (p.type !== 'literal') g[p.type] = p.value; });
    const hour = g.hour === '24' ? '00' : g.hour;
    return {
      clock: hour + ':' + g.minute + ' ' + (g.timeZoneName || ''),
      date: (g.weekday || '') + ' ' + g.day + ' ' + g.month,
      full: (g.weekday || '') + ' ' + g.day + ' ' + g.month + ' ' + hour + ':' + g.minute + ' ' + (g.timeZoneName || ''),
      hour: +hour, minute: +g.minute
    };
  }

  function etHM(ts) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, weekday: 'short',
      hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(ts));
    const g = {};
    parts.forEach(function (p) { g[p.type] = p.value; });
    let H = g.hour === '24' ? 0 : +g.hour;
    return { H: H, M: +g.minute, wd: g.weekday, date: g.year + '-' + g.month + '-' + g.day };
  }

  function globexState(ts) {
    const p = etHM(ts);
    const mins = p.H * 60 + p.M;
    const wd = p.wd;
    if (wd === 'Sat') return 'CLOSED';
    if (wd === 'Sun' && mins < 18 * 60) return 'CLOSED';
    if (wd === 'Fri' && mins >= 17 * 60) return 'CLOSED';
    if (mins >= 17 * 60 && mins < 18 * 60) return 'BREAK';
    return 'OPEN';
  }

  function pushBar(bars, spec, date, mins, o, h, l, c, v) {
    const tick = spec.tick;
    o = roundTick(o, tick);
    c = roundTick(c, tick);
    h = roundTick(Math.max(h, o, c), tick);
    l = roundTick(Math.min(l, o, c), tick);
    if (h < Math.max(o, c)) h = roundTick(Math.max(o, c), tick);
    if (l > Math.min(o, c)) l = roundTick(Math.min(o, c), tick);
    if (l > h) l = h;
    const H = Math.floor(mins / 60), M = mins % 60;
    const bar = {
      t: etStamp(date.y, date.m, date.d, H, M),
      o: o, h: h, l: l, c: c,
      v: Math.max(1, Math.round(v)),
      sess: date.sess
    };
    bars.push(bar);
    return bar;
  }

  function fillFlat(bars, spec, date, startMin, n, O, H, L, C, VOL) {
    const tick = spec.tick;
    O = roundTick(O, tick); C = roundTick(C, tick);
    H = roundTick(Math.max(H, O, C), tick);
    L = roundTick(Math.min(L, O, C), tick);
    const each = Math.max(1, Math.round(VOL / n));
    let px = O;
    const made = [];
    for (let i = 0; i < n; i++) {
      let c = (i === n - 1) ? C : roundTick(O + (C - O) * ((i + 1) / n), tick);
      if (c > H) c = H;
      if (c < L) c = L;
      const b = pushBar(bars, spec, date, startMin + i * 5, px, Math.max(px, c), Math.min(px, c), c, each);
      made.push(b);
      px = b.c;
    }
    made[Math.min(1, n - 1)].h = roundTick(Math.max(made[Math.min(1, n - 1)].h, H), tick);
    const li = Math.min(3, n - 1);
    made[li].l = roundTick(Math.min(made[li].l, L), tick);
    made[0].o = O;
    made[n - 1].c = C;
    made[n - 1].h = Math.max(made[n - 1].h, made[n - 1].o, made[n - 1].c);
    made[n - 1].l = Math.min(made[n - 1].l, made[n - 1].o, made[n - 1].c);
    for (let i = 0; i < made.length; i++) {
      const b = made[i];
      b.h = roundTick(Math.max(b.h, b.o, b.c), tick);
      b.l = roundTick(Math.min(b.l, b.o, b.c), tick);
      if (b.h > H && i !== 1) {
        b.h = roundTick(Math.max(b.o, b.c), tick);
      }
      if (b.l < L && i !== li) {
        b.l = roundTick(Math.min(b.o, b.c), tick);
      }
      if (b.l > b.h) { const t = b.l; b.l = b.h; b.h = t; }
    }
    let gh = -1e15, gl = 1e15;
    made.forEach(function (b) { if (b.h > gh) gh = b.h; if (b.l < gl) gl = b.l; });
    if (gh < H) made[1].h = H;
    if (gl > L) made[li].l = L;
    made.forEach(function (b) {
      b.h = Math.max(b.h, b.o, b.c);
      b.l = Math.min(b.l, b.o, b.c);
    });
    return made;
  }

  function makeBars(spec, seed) {
    const rng = mulberry32((seed + spec.seedOff) >>> 0);
    const days = weekdays(17);
    const bars = [];
    let px = spec.start;
    const u = spec.u;
    for (let di = 0; di < 15; di++) {
      const date = days[di];
      for (let k = 0; k < 96; k++) {
        const mins = 8 * 60 + k * 5;
        const o = px;
        const step = di * 96 + k;
        const wave = Math.sin(step / 7.4) * spec.u * 1.15 + Math.sin(step / 18.5) * spec.u * 0.55;
        const prevWave = Math.sin((step - 1) / 7.4) * spec.u * 1.15 + Math.sin((step - 1) / 18.5) * spec.u * 0.55;
        const noise = (rng() - 0.5) * spec.u * 0.42;
        let c = o + spec.drift * 0.55 + (wave - prevWave) + noise;
        const upW = spec.u * (0.28 + rng() * 0.55);
        const dnW = spec.u * (0.25 + rng() * 0.5);
        let h = Math.max(o, c) + upW;
        let l = Math.min(o, c) - dnW;
        const v1 = bars.length ? bars[bars.length - 1].v : 1400;
        const v2 = bars.length > 1 ? bars[bars.length - 2].v : 1400;
        let v = 900 + Math.round(rng() * 900 + 280 * (0.5 + 0.5 * Math.sin(step / 3.1)));
        if (v < v1 && v < v2) v = Math.min(v1, v2);
        const b = pushBar(bars, spec, date, mins, o, h, l, c, v);
        px = b.c;
      }
    }
    // Day 15 — planted HTF ND then a close above the ND high (invalidation).
    // Gold in the morning, Nasdaq in the afternoon. The other half of the day drifts.
    const d15 = days[15];
    const A15 = px;
    function driftRest(date, fromMin, toMin) {
      const n = Math.round((toMin - fromMin) / 5);
      for (let k = 0; k < n; k++) {
        const o = px;
        const step = k + fromMin;
        const wave = Math.sin(step / 6.5) * spec.u * 0.7;
        const prevWave = Math.sin((step - 5) / 6.5) * spec.u * 0.7;
        const c = o + spec.drift * 0.45 + (wave - prevWave) * 0.15 + (rng() - 0.5) * spec.u * 0.2;
        const v1 = bars.length ? bars[bars.length - 1].v : 1400;
        const v2 = bars.length > 1 ? bars[bars.length - 2].v : 1400;
        let v = 1100 + Math.round(rng() * 500);
        if (v < v1 && v < v2) v = Math.min(v1, v2);
        const b = pushBar(bars, spec, date, fromMin + k * 5, o, Math.max(o, c) + spec.u * 0.35, Math.min(o, c) - spec.u * 0.3, c, v);
        px = b.c;
      }
    }
    if (spec.id === 'gold') {
      fillFlat(bars, spec, d15, 8 * 60, 24, px, A15 + 2.2 * u, A15 - 0.4 * u, A15 + u, 8000);
      px = bars[bars.length - 1].c;
      const ndHigh = A15 + 2.2 * u;
      fillFlat(bars, spec, d15, 10 * 60, 24, px, ndHigh + 1.4 * u, px - 0.3 * u, roundTick(ndHigh + u, spec.tick), 52000);
      px = bars[bars.length - 1].c;
      driftRest(d15, 12 * 60, 16 * 60);
    } else {
      driftRest(d15, 8 * 60, 12 * 60);
      const A = px;
      fillFlat(bars, spec, d15, 12 * 60, 24, px, A + 2.2 * u, A - 0.4 * u, A + u, 8000);
      px = bars[bars.length - 1].c;
      const ndHigh = A + 2.2 * u;
      fillFlat(bars, spec, d15, 14 * 60, 24, px, ndHigh + 1.4 * u, px - 0.3 * u, roundTick(ndHigh + u, spec.tick), 52000);
      px = bars[bars.length - 1].c;
    }
    // Wick a prior-session low well under the next day's trade, constant volume (not an ND).
    if (bars.length) {
      const last = bars[bars.length - 1];
      const wick = bars[bars.length - 8];
      if (wick && wick.sess === last.sess) {
        wick.l = roundTick(Math.min(wick.l, wick.c - 18 * u), spec.tick);
        wick.h = Math.max(wick.h, wick.o, wick.c);
      }
    }
    const psl = (function () {
      let m = 1e15;
      const sess = d15.sess;
      for (let i = 0; i < bars.length; i++) if (bars[i].sess === sess && bars[i].l < m) m = bars[i].l;
      return m;
    })();

    // Day 16 — full cascade + trade.
    const d16 = days[16];
    const A = px;
    const tick = spec.tick;
    // 2h ND 08:00-10:00. Small up close, low volume, high capped.
    const ndC = roundTick(A + 0.8 * u, tick);
    const ndH = roundTick(A + 2.0 * u, tick);
    const ndL = roundTick(A - 0.5 * u, tick);
    fillFlat(bars, spec, d16, 8 * 60, 24, px, ndH, ndL, ndC, 4200);
    px = bars[bars.length - 1].c;
    // 2h UT 10:00-12:00. Spike above ND high, fade, close in lower half.
    const utH = roundTick(ndH + 4.5 * u, tick);
    const utL = roundTick(ndC - 2.2 * u, tick);
    const utC = roundTick(utL + 0.28 * (utH - utL), tick); // CLV ~0.28, below ND high
    const utBars = fillFlat(bars, spec, d16, 10 * 60, 24, px, utH, utL, utC, 48000);
    // Keep the last 30m (6 bars) volume modest so the next 30m can be "rising volume".
    for (let i = 18; i < 24; i++) utBars[i].v = 700;
    px = bars[bars.length - 1].c;

    // Explicit post-T0 sequence. Prices in units off anchor B = ut close.
    const B = px;
    function pb(mins, o, h, l, c, v) {
      const b = pushBar(bars, spec, d16, mins, o, h, l, c, v);
      px = b.c;
      return b;
    }
    // 30m weakness 12:00-12:30 — six 5m bars. Big down, close in bottom third, volume 18000.
    // Swing low printed on bar index 3 of this block, neighbors higher.
    const wHigh = roundTick(B + 0.3 * u, tick);
    const swing = roundTick(B - 7.5 * u, tick);
    const wClose = roundTick(B - 5.6 * u, tick);
    const vols30 = [2800, 3200, 3000, 3600, 3000, 2400]; // sum 18000
    const path30 = [0.15, -0.4, -1.6, -7.5, -6.2, -5.6];
    let o = B;
    for (let i = 0; i < 6; i++) {
      const c = roundTick(B + path30[i] * u, tick);
      let h = Math.max(o, c) + 0.15 * u;
      let l = Math.min(o, c) - 0.15 * u;
      if (i === 0) h = wHigh;
      if (i === 3) l = swing;
      pb(12 * 60 + i * 5, o, h, l, c, vols30[i]);
      o = px;
    }
    // Force 30m aggregate close
    bars[bars.length - 1].c = wClose;
    px = wClose;

    // 15m weakness 12:30-12:45. Down close vs prior 15m (which closed at wClose), CLV<=1/3, higher vol.
    const p15c = px;
    const c15 = roundTick(p15c - 1.3 * u, tick);
    const h15 = roundTick(p15c + 0.35 * u, tick);
    const l15 = roundTick(c15 - 0.45 * u, tick);
    // 3 bars, last one prints the weak close. Vol sum 9000 > prior 15m (last 3 of the 30m = 3600+3000+2400=9000). Need strictly greater.
    const v15 = [3600, 3400, 3600]; // 10600
    const pth = [ -0.2, -0.7, -1.3 ];
    o = px;
    for (let i = 0; i < 3; i++) {
      const c = roundTick(p15c + pth[i] * u, tick);
      let h = Math.max(o, c) + 0.1 * u;
      let l = Math.min(o, c) - 0.12 * u;
      if (i === 0) h = h15;
      if (i === 2) { l = l15; }
      pb(12 * 60 + 30 + i * 5, o, h, l, c, v15[i]);
      o = px;
    }
    bars[bars.length - 1].c = c15;
    bars[bars.length - 1].l = Math.min(bars[bars.length - 1].l, l15);
    px = c15;

    // 5m ND 12:45 — up close, very low volume vs prior two (3600 and 3400), tiny bounce.
    const nd5c = roundTick(px + 0.55 * u, tick);
    const nd5h = roundTick(nd5c + 0.25 * u, tick);
    const nd5l = roundTick(px - 0.08 * u, tick);
    const ndBar = pb(12 * 60 + 45, px, nd5h, nd5l, nd5c, 400);
    // 5m setup bar 12:50
    let setupBar;
    if (spec.id === 'gold') {
      // Type 1 UT: poke above the ND high, close back below it, CLV <= 0.5.
      const sH = roundTick(ndBar.h + Math.max(tick * 4, 0.9 * u), tick);
      const sL = roundTick(Math.min(ndBar.l, ndBar.c) - Math.max(tick * 3, 1.05 * u), tick);
      let sC = roundTick(sL + 0.32 * (sH - sL), tick);
      const cap = roundTick(ndBar.h - tick, tick);
      if (sC > cap) sC = cap;
      if (sC <= sL) sC = roundTick(sL + tick, tick);
      setupBar = pb(12 * 60 + 50, px, sH, sL, sC, 2200);
    } else {
      // Type 2 HUT: bottom third, close under the ND close, high does NOT clear the ND high
      // (otherwise the bar would be labelled UT).
      const sH = ndBar.h;
      const sL = roundTick(ndBar.c - Math.max(tick * 4, 1.35 * u), tick);
      let sC = roundTick(sL + 0.2 * (sH - sL), tick);
      const cap = roundTick(ndBar.c - tick, tick);
      if (sC > cap) sC = cap;
      if (sC <= sL) sC = roundTick(sL + tick, tick);
      setupBar = pb(12 * 60 + 50, px, sH, sL, sC, 2200);
    }
    // Inside bar 12:55 — stays strictly inside the setup bar, so it neither confirms nor kills it.
    const holdC = setupBar.c;
    const holdH = roundTick(Math.min(setupBar.h - tick, Math.max(setupBar.o, holdC)), tick);
    const holdL = roundTick(Math.max(setupBar.l + tick, Math.min(setupBar.o, holdC)), tick);
    pb(12 * 60 + 55, px, holdH, holdL, holdC, 1800);
    // Confirm 13:00 — close below the setup low, high still under the setup high.
    const confC = roundTick(setupBar.l - Math.max(tick * 2, 0.25 * u), tick);
    const confH = roundTick(Math.min(setupBar.h - tick, Math.max(px, confC) + Math.max(tick, 0.08 * u)), tick);
    pb(13 * 60, px, confH, confC, confC, 2600);
    // Entry bar is NEXT. Build it and the management path in the same session.
    // Entry open slightly below confirm close.
    const entryOpen = roundTick(px - 0.1 * u, tick);
    // Decline ~10 bars, then a poke into the deep zone, then a close above the trail.
    // Ranges stay tight so 2*ATR trail sits above price until the scripted rally.
    const decline = [];
    o = entryOpen;
    // entry bar itself: small down, must NOT tag the stop (setup high + tick)
    {
      const c = roundTick(o - 0.25 * u, tick);
      decline.push(pb(13 * 60 + 5, o, o + 0.12 * u, c - 0.08 * u, c, 1600));
      o = px;
    }
    for (let i = 0; i < 10; i++) {
      const mins = 13 * 60 + 10 + i * 5;
      const c = roundTick(o - 0.28 * u, tick);
      const h = roundTick(o + 0.08 * u, tick);
      const l = roundTick(c - 0.1 * u, tick);
      decline.push(pb(mins, o, h, l, c, 1500 + i * 20));
      o = px;
    }
    // Poke into the 1-ATR deep zone: wick up, close stays near the low (no exit).
    {
      const mins = 13 * 60 + 10 + 10 * 5;
      const c = roundTick(o - 0.04 * u, tick);
      const h = roundTick(o + (spec.id==="gold"?1.05:1.2) * u, tick);
      const l = roundTick(Math.min(o, c) - 0.12 * u, tick);
      pb(mins, o, h, l, c, 1700);
      o = px;
    }
    // Close back above a 2-ATR trail. High stays inside the deep zone so the exit is the close, not a stop touch.
    {
      const mins = 13 * 60 + 10 + 11 * 5;
      const c = roundTick(o + (spec.id==="gold"?1.28:1.42) * u, tick);
      const h = roundTick(c + tick, tick);
      const l = roundTick(o - 0.06 * u, tick);
      pb(mins, o, h, l, c, 2400);
      o = px;
    }
    // Exit fill bar (next open) and a few quiet bars so the chart has room after the exit.
    for (let i = 0; i < 8; i++) {
      const mins = 14 * 60 + 10 + i * 5;
      if (mins >= 16 * 60) break;
      const c = roundTick(o + spec.drift * 0.3, tick);
      pb(mins, o, Math.max(o, c) + 0.12 * u, Math.min(o, c) - 0.12 * u, c, 1400);
      o = px;
    }
    // Fill the rest of the session with flat-volume drift (no fresh ND: volume never strictly falls vs both priors).
    const lastMin = etHM(bars[bars.length - 1].t);
    let cursor = lastMin.H * 60 + lastMin.M + 5;
    while (cursor < 16 * 60) {
      const c = roundTick(px + spec.drift * 0.4, tick);
      pb(cursor, px, Math.max(px, c) + spec.range * 0.3, Math.min(px, c) - spec.range * 0.25, c, 1400);
      cursor += 5;
    }

    return {
      bars: bars,
      previewAt: 15 * 96 - 18,
      pslDay: psl,
      days: days
    };
  }

  function parseBars(text) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    let rows;
    if (raw[0] === '[' || raw[0] === '{') {
      let data = JSON.parse(raw);
      if (data && data.bars) data = data.bars;
      rows = data;
    } else {
      const lines = raw.split(/\r?\n/).filter(function (l) { return l.trim() && !/^#/.test(l.trim()); });
      const head = lines[0].split(',').map(function (s) { return s.trim().toLowerCase(); });
      const idx = {};
      head.forEach(function (h, i) { idx[h] = i; });
      const start = (idx.t != null || idx.time != null || idx.timestamp != null) ? 1 : 0;
      rows = [];
      for (let i = start; i < lines.length; i++) {
        const c = lines[i].split(',');
        if (start === 0) {
          rows.push({ t: c[0], o: c[1], h: c[2], l: c[3], c: c[4], v: c[5] });
        } else {
          const get = function (k, j) { return c[idx[k] != null ? idx[k] : j]; };
          rows.push({
            t: get('t', get('time', get('timestamp', 0))),
            o: get('o', 1), h: get('h', 2), l: get('l', 3), c: get('c', 4), v: get('v', 5)
          });
        }
      }
    }
    return rows.map(function (r, i) {
      let t = r.t != null ? r.t : r.time || r.timestamp;
      if (typeof t === 'string' && !/^-?\d+$/.test(t.trim())) t = Date.parse(t);
      else t = +t;
      if (!isFinite(t)) throw new Error('Bad timestamp on row ' + i);
      const bar = { t: t, o: +r.o, h: +r.h, l: +r.l, c: +r.c, v: +r.v || 0, sess: r.sess || etHM(t).date };
      if (![bar.o, bar.h, bar.l, bar.c].every(isFinite)) throw new Error('Bad OHLC on row ' + i);
      bar.h = Math.max(bar.h, bar.o, bar.c);
      bar.l = Math.min(bar.l, bar.o, bar.c);
      return bar;
    }).sort(function (a, b) { return a.t - b.t; });
  }

  function Book(tfMin) {
    this.tf = tfMin;
    this.bars = [];
    this.cur = null;
    this.e10 = null; this.e20 = null; this.e50 = null;
    this.prevE10 = null; this.prevE20 = null;
    this.atr = null; this._atrN = 0; this._atrSum = 0;
    this.prevClose = null;
  }

  function barEnd(bar, tf) { return bar.t + tf * 60 * 1000; }

  function aggKey(ts, tf) {
    const p = etHM(ts);
    const mins = p.H * 60 + p.M;
    const base = 8 * 60;
    const k = base + Math.floor((mins - base) / tf) * tf;
    return p.date + '-' + k;
  }

  Book.prototype.roll = function (bar5) {
    const key = aggKey(bar5.t, this.tf);
    const events = [];
    if (this.cur && this.cur.key !== key) events.push(this._seal());
    if (!this.cur) {
      this.cur = { key: key, t: bar5.t, o: bar5.o, h: bar5.h, l: bar5.l, c: bar5.c, v: 0, sess: bar5.sess, n: 0 };
    }
    const c = this.cur;
    if (c.n === 0) { c.t = bar5.t; c.o = bar5.o; c.h = bar5.h; c.l = bar5.l; c.sess = bar5.sess; }
    c.h = Math.max(c.h, bar5.h);
    c.l = Math.min(c.l, bar5.l);
    c.c = bar5.c;
    c.v += bar5.v;
    c.n++;
    return events;
  };

  Book.prototype._seal = function () {
    const c = this.cur;
    this.cur = null;
    if (!c || !c.n) return null;
    const bar = { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, sess: c.sess, tf: this.tf };
    this.prevE10 = this.e10; this.prevE20 = this.e20;
    this.e10 = ema(this.e10, bar.c, 10);
    this.e20 = ema(this.e20, bar.c, 20);
    this.e50 = ema(this.e50, bar.c, 50);
    const tr = this.prevClose == null ? bar.h - bar.l : Math.max(bar.h - bar.l, Math.abs(bar.h - this.prevClose), Math.abs(bar.l - this.prevClose));
    if (this.atr == null) {
      this._atrSum += tr; this._atrN++;
      if (this._atrN >= 14) this.atr = this._atrSum / 14;
    } else {
      this.atr = (this.atr * 13 + tr) / 14;
    }
    this.prevClose = bar.c;
    bar.e10 = this.e10; bar.e20 = this.e20; bar.e50 = this.e50; bar.atr = this.atr; bar.tr = tr;
    this.bars.push(bar);
    return bar;
  };

  Book.prototype.flush = function () {
    if (this.cur) return this._seal();
    return null;
  };

  function swingPoints(bars, upto, kind) {
    const out = [];
    for (let i = 2; i <= upto - 2; i++) {
      const v = bars[i][kind];
      if (kind === 'l') {
        if (v < bars[i - 1].l && v < bars[i - 2].l && v <= bars[i + 1].l && v <= bars[i + 2].l) out.push(i);
      } else {
        if (v > bars[i - 1].h && v > bars[i - 2].h && v >= bars[i + 1].h && v >= bars[i + 2].h) out.push(i);
      }
    }
    return out;
  }

  function isWeakness(book, i) {
    const bars = book.bars;
    if (i < 1) return null;
    const b = bars[i], p = bars[i - 1];
    const same = book.tf > 30 || (b.sess === p.sess && (i < 2 || b.sess === bars[i - 2].sess));
    if (i >= 2 && same && b.c > p.c && b.v < bars[i - 1].v && b.v < bars[i - 2].v) return 'ND';
    if (i >= 5) {
      let hh = -1e15;
      for (let k = i - 5; k < i; k++) if (bars[k].h > hh) hh = bars[k].h;
      if (b.h > hh && b.c < hh && clv(b) <= 0.5) return 'UT';
    }
    if (b.h > p.h && clv(b) <= 1 / 3 && b.c < p.c) return 'HUT';
    if (b.c < p.c && clv(b) <= 1 / 3 && b.v > p.v) return 'W4';
    const highs = swingPoints(bars, i, 'h');
    if (highs.length && b.h < bars[highs[highs.length - 1]].h && b.c < p.c) return 'LH';
    return null;
  }

  function ndFails(book, i) {
    const bars = book.bars;
    const fails = [];
    if (i < 2) return ['short history'];
    const b = bars[i];
    if (!(b.c > bars[i - 1].c)) fails.push('not an up close');
    if (!(b.v < bars[i - 1].v && b.v < bars[i - 2].v)) fails.push('volume not below both prior bars');
    if (book.tf <= 30 && (b.sess !== bars[i - 1].sess || b.sess !== bars[i - 2].sess)) fails.push('crosses session');
    if (!(b.c < book.e10 && b.c < book.e20)) fails.push('not below EMA10 and EMA20');
    return fails;
  }

  function Inst(built, spec) {
    this.spec = spec;
    this.bars = built.bars;
    this.previewAt = built.previewAt;
    this.m5 = [];
    this.e10 = null; this.e20 = null; this.e50 = null;
    this.prevE10 = null; this.prevE20 = null;
    this.atr = null; this._atrN = 0; this._atrSum = 0; this.prevClose = null;
    this.ema10 = []; this.ema20 = []; this.ema50 = []; this.atrs = [];
    this.h4 = new Book(240); this.h2 = new Book(120); this.m30 = new Book(30); this.m15 = new Book(15);
    this.cx = { stage: 'idle' };
    this.s5 = { stage: 'idle' };
    this.pos = null;
    this.pending = null; // {kind:'entry'|'exit', ...}
    this.trades = [];
    this.state = 'SCANNING';
    this.conf = 0.08;
    this.markers = { nd: null, ut: null, confirm: null, entry: null, exit: null, reject: null };
    this.htfMark = { nd: null, ut: null };
    this.trailHist = [];
    this.lines = {};
    this.checklist = freshChecks();
    this.realized = 0;
    this.flash = null;
    this.exitHold = 0;
    this.lastWeak = null;
  }

  function freshChecks() {
    return [
      { id: 'nd', label: 'HTF no-demand', on: false },
      { id: 'ut', label: 'HTF upthrust / HUT', on: false },
      { id: 'w30', label: '30m weakness', on: false },
      { id: 'w15', label: '15m weakness', on: false },
      { id: 'w5', label: '5m weakness', on: false },
      { id: 'conf', label: '5m confirm / trigger', on: false },
      { id: 'entry', label: 'Short entry', on: false },
      { id: 'stop', label: 'Stop armed', on: false },
      { id: 'trail', label: 'Trail ratcheting', on: false }
    ];
  }

  function checkOn(inst, id, on) {
    inst.checklist.forEach(function (c) { if (c.id === id) c.on = on; });
  }

  Inst.prototype._setState = function (s, conf) {
    this.state = s;
    if (conf != null) this.conf = conf;
  };

  Inst.prototype._ideal = function (bar) {
    return bar.e10 < bar.e20 && bar.e20 < bar.e50;
  };

  Inst.prototype._armND = function (book, bar, events) {
    const tfName = book.tf === 240 ? '4h' : '2h';
    const i = book.bars.length - 1;
    const fails = ndFails(book, i);
    if (fails.length) return;
    // Prefer 4h if both fire on the same bar; otherwise first signal wins until reset.
    if (this.cx.stage !== 'idle' && !(this.cx.stage === 'nd' && this.cx.tf === '2h' && tfName === '4h')) return;
    this.markers.entry = null; this.markers.exit = null; this.markers.confirm = null; this.markers.ut = null; this.markers.nd = null;
    this.trailHist = [];
    this.checklist.forEach(function (c) { c.on = false; });
    this.cx = {
      stage: 'nd', tf: tfName, bookTf: book.tf,
      nd: { i: i, t: bar.t, h: bar.h, l: bar.l, c: bar.c, v: bar.v, e10: bar.e10, e20: bar.e20, e50: bar.e50, ideal: this._ideal(bar) },
      waited: 0
    };
    this.htfMark.nd = { t: bar.t, h: bar.h, tf: tfName };
    checkOn(this, 'nd', true);
    this._setState('ND FOUND', 0.34);
    const b = bar, p = book.bars[i - 1];
    events.push(this._ev('nd', tfName + ' ND: up close ' + fmtPx(this.spec, b.c) + ' > ' + fmtPx(this.spec, p.c)
      + ', vol ' + Math.round(b.v) + ' below ' + Math.round(book.bars[i - 1].v) + ' and ' + Math.round(book.bars[i - 2].v)
      + '. Close under EMA10 ' + fmtPx(this.spec, b.e10) + ' and EMA20 ' + fmtPx(this.spec, b.e20)
      + (this._ideal(bar) ? ' — ideal stack 10<20<50.' : ' — stack not fully aligned.')
      + ' Waiting up to 5 ' + tfName + ' bars for an upthrust (0 of 5).'));
  };

  Inst.prototype._onHTF = function (book, bar, events) {
    if (!bar) return;
    const tfName = book.tf === 240 ? '4h' : '2h';
    const i = book.bars.length - 1;
    if (this.cx.stage === 'idle' || (this.cx.stage === 'nd' && this.cx.tf !== tfName && this.cx.bookTf !== book.tf)) {
      if (this.cx.stage === 'idle') this._armND(book, bar, events);
      return;
    }
    if (this.cx.stage === 'nd' && this.cx.bookTf === book.tf) {
      this.cx.waited++;
      if (bar.c > this.cx.nd.h) {
        events.push(this._ev('reject', 'Invalidated: ' + tfName + ' close ' + fmtPx(this.spec, bar.c) + ' above ND high ' + fmtPx(this.spec, this.cx.nd.h) + '. Demand showed up — setup scrapped.'));
        this._resetCascade(true);
        this._clearChecks();
        this.flash = 'invalid';
        this._setState('SCANNING', 0.06);
        return;
      }
      const ut = bar.h > this.cx.nd.h && bar.c < this.cx.nd.h && clv(bar) <= 0.5;
      const hut = clv(bar) <= 1 / 3 && bar.c < this.cx.nd.c;
      if (ut || hut) {
        const kind = ut ? 'UT' : 'HUT';
        this.cx.stage = 'w30';
        this.cx.setup = { i: i, t: bar.t, h: bar.h, l: bar.l, c: bar.c, kind: kind, end: barEnd(bar, book.tf) };
        this.cx.w30Seen = 0;
        this.htfMark.ut = { t: bar.t, h: bar.h, l: bar.l, kind: kind, tf: tfName };
        checkOn(this, 'ut', true);
        this._setState('SETUP', 0.52);
        events.push(this._ev('ut', tfName + ' ' + (ut ? 'Type 1 upthrust' : 'Type 2 hidden upthrust')
          + ' (bar ' + this.cx.waited + ' of 5): high ' + fmtPx(this.spec, bar.h)
          + (ut ? ' > ND high ' + fmtPx(this.spec, this.cx.nd.h) + ', close back below it' : '')
          + ', CLV ' + clv(bar).toFixed(2) + '. Cascade open — waiting on 30m weakness.'));
        return;
      }
      if (this.cx.waited >= 5) {
        events.push(this._ev('reject', tfName + ' ND expired: no upthrust within 5 bars.'));
        this._resetCascade(true);
        this._clearChecks();
        this.flash = 'invalid';
        this._setState('SCANNING', 0.07);
      } else {
        events.push(this._ev('wait', 'ND on ' + tfName + ' still live. Waiting up to 5 bars for upthrust (' + this.cx.waited + ' of 5).'));
      }
      return;
    }
  };

  Inst.prototype._resetCascade = function () {
    this.cx = { stage: 'idle' };
    this.s5 = { stage: 'idle' };
  };
  Inst.prototype._clearChecks = function () {
    if (this.pos) return;
    this.checklist.forEach(function (c) { c.on = false; });
  };

  Inst.prototype._killCascade = function (msg, events) {
    events.push(this._ev('reject', msg));
    this.flash = 'invalid';
    this._resetCascade(true);
    this._clearChecks();
    if (!this.pos) this._setState('SCANNING', 0.05);
  };

  Inst.prototype._on30 = function (bar, events) {
    if (!bar || this.cx.stage !== 'w30') return;
    if (barEnd(bar, 30) <= this.cx.setup.end) return;
    this.cx.w30Seen++;
    const w = isWeakness(this.m30, this.m30.bars.length - 1);
    if (w) {
      this.cx.stage = 'w15';
      this.cx.w30 = { end: barEnd(bar, 30), h: bar.h, t: bar.t, kind: w };
      this.cx.w15Seen = 0;
      checkOn(this, 'w30', true);
      this._setState('CONFIRMING', 0.64);
      this.lastWeak = '30m';
      events.push(this._ev('weak', '30m weakness (' + w + ') inside the window. High ' + fmtPx(this.spec, bar.h) + ', close ' + fmtPx(this.spec, bar.c) + ', CLV ' + clv(bar).toFixed(2) + '. Next: 15m.'));
      return;
    }
    if (this.cx.w30Seen >= 4) this._killCascade('Cascade expired: no 30m weakness within 4 bars of the ' + this.cx.tf + ' upthrust.', events);
  };

  Inst.prototype._on15 = function (bar, events) {
    if (!bar || this.cx.stage !== 'w15') return;
    if (barEnd(bar, 15) <= this.cx.w30.end) return;
    this.cx.w15Seen++;
    if (bar.c > this.cx.w30.h) {
      this._killCascade('Invalidated: 30m-window broken — a 15m close is not the rule, but price printed through the 30m weakness high on the way. Scrapping.', events);
      return;
    }
    const w = isWeakness(this.m15, this.m15.bars.length - 1);
    if (w) {
      this.cx.stage = 'w5';
      this.cx.w15 = { end: barEnd(bar, 15), h: bar.h, kind: w };
      this.cx.w5Seen = 0;
      checkOn(this, 'w15', true);
      this._setState('CONFIRMING', 0.74);
      this.lastWeak = '15m';
      events.push(this._ev('weak', '15m weakness (' + w + '). Close ' + fmtPx(this.spec, bar.c) + ' CLV ' + clv(bar).toFixed(2) + '. Dropping to 5m.'));
      return;
    }
    if (this.cx.w15Seen >= 4) this._killCascade('Cascade expired: no 15m weakness within 4 bars.', events);
  };

  Inst.prototype._on5Cascade = function (bar, i, events) {
    if (this.cx.stage === 'w30' && this.m30.cur == null) { /* wait */ }
    if ((this.cx.stage === 'w30' || this.cx.stage === 'w15' || this.cx.stage === 'w5' || this.cx.stage === 'trig') && this.cx.setup && bar.h > this.cx.setup.h) {
      this._killCascade('Invalidated: price traded ' + fmtPx(this.spec, bar.h) + ' above the ' + this.cx.tf + ' upthrust high ' + fmtPx(this.spec, this.cx.setup.h) + '.', events);
      return;
    }
    if (this.cx.stage === 'w5') {
      if (barEnd(bar, 5) <= this.cx.w15.end) return;
      this.cx.w5Seen++;
      const w = isWeakness5(this, i);
      if (w) {
        this.cx.stage = 'trig';
        this.cx.w5 = { end: barEnd(bar, 5), kind: w, i: i };
        this.cx.trigSeen = 0;
        checkOn(this, 'w5', true);
        this._setState('CONFIRMING', 0.82);
        this.lastWeak = '5m';
        events.push(this._ev('weak', '5m weakness (' + w + ') at ' + fmtPx(this.spec, bar.c) + '. Trigger window open: confirmation close, or a fresh EMA10 cross below EMA20 (12 bars).'));
      } else if (this.cx.w5Seen >= 6) {
        this._killCascade('Cascade expired: no 5m weakness within 6 bars.', events);
      }
    }
  };

  function isWeakness5(inst, i) {
    const bars = inst.m5;
    if (i < 1) return null;
    const b = bars[i], p = bars[i - 1];
    if (i >= 2 && b.sess === p.sess && b.sess === bars[i - 2].sess && b.c > p.c && b.v < bars[i - 1].v && b.v < bars[i - 2].v && b.c < inst.e10 && b.c < inst.e20) return 'ND';
    if (i >= 2 && b.sess === p.sess && b.c > p.c && b.v < bars[i - 1].v && b.v < bars[i - 2].v) return 'ND';
    if (i >= 5) {
      let hh = -1e15;
      for (let k = i - 5; k < i; k++) if (bars[k].h > hh) hh = bars[k].h;
      if (b.h > hh && b.c < hh && clv(b) <= 0.5) return 'UT';
    }
    if (b.h > p.h && clv(b) <= 1 / 3 && b.c < p.c) return 'HUT';
    if (b.c < p.c && clv(b) <= 1 / 3 && b.v > p.v) return 'W4';
    const highs = swingPoints(bars, i, 'h');
    if (highs.length && b.h < bars[highs[highs.length - 1]].h && b.c < p.c) return 'LH';
    return null;
  }

  Inst.prototype._on5Setup = function (bar, i, events) {
    if (this.cx.stage !== 'trig' || this.pos || this.pending) return;
    this.cx.trigSeen = (this.cx.trigSeen || 0) + 1;
    const bars = this.m5;
    // Fresh MA cross can trigger only when no 5m ND is already armed (otherwise wait for the confirm).
    const crossed = this.prevE10 != null && this.prevE10 >= this.prevE20 && this.e10 < this.e20 && bar.c < this.e10 && bar.c < this.e20;
    if (this.s5.stage === 'idle') {
      const fails = (function () {
        if (i < 2) return ['short'];
        if (bar.sess !== bars[i - 1].sess || bar.sess !== bars[i - 2].sess) return ['session'];
        if (!(bar.c > bars[i - 1].c)) return ['up'];
        if (!(bar.v < bars[i - 1].v && bar.v < bars[i - 2].v)) return ['vol'];
        if (!(bar.c < this.e10 && bar.c < this.e20)) return ['ema'];
        return [];
      }).call(this);
      if (!fails.length) {
        this.s5 = { stage: 'nd', i: i, h: bar.h, l: bar.l, c: bar.c, waited: 0, t: bar.t };
        this.markers.nd = { i: i, h: bar.h, l: bar.l, t: bar.t };
        this._setState('ND FOUND', Math.max(this.conf, 0.8));
        events.push(this._ev('nd5', '5m ND: up close ' + fmtPx(this.spec, bar.c) + ' > ' + fmtPx(this.spec, bars[i - 1].c)
          + ', vol ' + Math.round(bar.v) + ' below ' + Math.round(bars[i - 1].v) + ' and ' + Math.round(bars[i - 2].v)
          + '. Below EMA10 ' + fmtPx(this.spec, this.e10) + ' / EMA20 ' + fmtPx(this.spec, this.e20)
          + '. Waiting up to 5 bars for upthrust (0 of 5).'));
      } else if (crossed) {
        this._armTrigger(bar, i, 'MA flip — EMA10 crossed below EMA20, close under both. Stop one tick above this bar.', events, bar.h);
      }
    } else if (this.s5.stage === 'nd') {
      this.s5.waited++;
      if (bar.c > this.s5.h) {
        events.push(this._ev('reject', 'Invalidated: 5m close ' + fmtPx(this.spec, bar.c) + ' above ND high ' + fmtPx(this.spec, this.s5.h) + '.'));
        this.flash = 'invalid';
        this.s5 = { stage: 'idle' };
        this.markers.nd = null;
        this._setState('CONFIRMING', 0.4);
      } else {
        const ut = bar.h > this.s5.h && bar.c < this.s5.h && clv(bar) <= 0.5;
        const hut = clv(bar) <= 1 / 3 && bar.c < this.s5.c;
        if (ut || hut) {
          const kind = ut ? 'UT' : 'HUT';
          this.s5 = { stage: 'setup', i: i, h: bar.h, l: bar.l, c: bar.c, kind: kind, waited: 0, t: bar.t, ndH: this.s5.h, ndC: this.s5.c };
          this.markers.ut = { i: i, h: bar.h, l: bar.l, kind: kind, t: bar.t };
          this._setState('SETUP', 0.9);
          events.push(this._ev('ut5', '5m ' + (kind === 'UT' ? 'Type 1 upthrust' : 'Type 2 hidden upthrust')
            + ' (bar ' + this.s5.waited + ' of 5): high ' + fmtPx(this.spec, bar.h)
            + ', close ' + fmtPx(this.spec, bar.c) + ', CLV ' + clv(bar).toFixed(2)
            + (kind === 'HUT' ? ', close under the ND close' : ', close back under the ND high')
            + '. Need a close below ' + fmtPx(this.spec, bar.l) + ' within 6 bars.'));
          // waited was copied wrong — the new object reset waited. The message uses 0. Fix phrase:
          events[events.length - 1].msg = events[events.length - 1].msg.replace('(bar 0 of 5)', '(within 5)');
        } else if (this.s5.waited >= 5) {
          events.push(this._ev('reject', '5m ND expired: no upthrust within 5 bars.'));
          this.flash = 'invalid';
          this.s5 = { stage: 'idle' };
          this.markers.nd = null;
        } else {
          events.push(this._ev('wait', '5m ND live. Waiting up to 5 bars for upthrust (' + this.s5.waited + ' of 5).'));
        }
      }
    } else if (this.s5.stage === 'setup') {
      this.s5.waited++;
      if (bar.h > this.s5.h) {
        events.push(this._ev('reject', 'Invalidated: price traded above the ' + this.s5.kind + ' high ' + fmtPx(this.spec, this.s5.h) + ' before confirmation.'));
        this.flash = 'invalid';
        this.s5 = { stage: 'idle' };
        this.markers.ut = null;
        this._setState('CONFIRMING', 0.35);
      } else if (bar.c < this.s5.l) {
        const stop = roundTick(this.s5.h + this.spec.tick, this.spec.tick);
        this.markers.confirm = { i: i, t: bar.t, c: bar.c };
        checkOn(this, 'conf', true);
        this._setState('CONFIRMING', 0.96);
        events.push(this._ev('confirm', 'Confirmed: close ' + fmtPx(this.spec, bar.c) + ' below the ' + this.s5.kind + ' low ' + fmtPx(this.spec, this.s5.l)
          + '. Short next bar open. Stop ' + fmtPx(this.spec, stop) + ' (one tick above the ' + this.s5.kind + ' high).'));
        this.pending = { kind: 'entry', stop: stop, setup: this.s5, confirmI: i };
        this.s5 = { stage: 'idle' };
      } else if (this.s5.waited >= 6) {
        events.push(this._ev('reject', 'Invalidated: no close below the ' + this.s5.kind + ' low within 6 bars.'));
        this.flash = 'invalid';
        this.s5 = { stage: 'idle' };
        this.markers.ut = null;
      }
    }
    if (this.cx.trigSeen >= 12 && this.s5.stage === 'idle' && !this.pending && !this.pos) {
      this._killCascade('Trigger window elapsed (12×5m) with no confirmation.', events);
    }
  };

  Inst.prototype._armTrigger = function (bar, i, why, events, stopH) {
    const stop = roundTick(stopH + this.spec.tick, this.spec.tick);
    this.markers.confirm = { i: i, t: bar.t, c: bar.c, ma: true };
    checkOn(this, 'conf', true);
    events.push(this._ev('confirm', why + ' Stop ' + fmtPx(this.spec, stop) + '.'));
    this.pending = { kind: 'entry', stop: stop, setup: { h: stopH, l: bar.l, kind: 'MA', i: i, t: bar.t }, confirmI: i, ma: true };
    this._setState('CONFIRMING', 0.9);
  };

  Inst.prototype._ev = function (type, msg) {
    return { inst: this.spec.id, type: type, msg: msg, state: this.state, conf: this.conf, t: this._lastT || 0 };
  };

  // Risk rules: each trade <= the per-trade setting (max 1%), and total open risk across both books <= 1%.
  const TOTAL_RISK_CAP = 0.01, MIN_TRADE_RISK = 0.0025;

  function sizePos(spec, equity, riskPct, entry, stop) {
    const dist = stop - entry;
    if (!(dist > 0) || !(equity > 0)) return null;
    const budget = equity * riskPct;
    const perMini = dist * spec.pointMini;
    let qty = Math.floor(budget / perMini + 1e-9);
    let product = spec.mini, point = spec.pointMini, micro = false;
    if (qty < 1) {
      qty = Math.floor(budget / (dist * spec.pointMicro) + 1e-9);
      product = spec.micro; point = spec.pointMicro; micro = true;
    }
    if (qty < 1) return { qty: 0, budget: budget, dist: dist };
    return { qty: qty, product: product, point: point, micro: micro, riskUsd: Math.round(qty * dist * point * 100) / 100, budget: budget, dist: dist };
  }

  Inst.prototype._targets = function (entry, confirmI) {
    const spec = this.spec;
    const lows = swingPoints(this.m5, confirmI, 'l');
    let swing = null;
    for (let k = lows.length - 1; k >= 0; k--) {
      const px = this.m5[lows[k]].l;
      if (px < entry) { swing = { px: px, i: lows[k] }; break; }
    }
    let psl = null;
    const sess = this.m5[confirmI].sess;
    for (let k = confirmI; k >= 0; k--) {
      if (this.m5[k].sess !== sess) {
        const prev = this.m5[k].sess;
        let m = 1e15;
        for (let j = k; j >= 0 && this.m5[j].sess === prev; j--) if (this.m5[j].l < m) m = this.m5[j].l;
        psl = m;
        break;
      }
    }
    const cands = [];
    if (swing) cands.push({ px: swing.px, why: 'swing low' });
    if (psl != null && psl < entry) cands.push({ px: psl, why: 'prev session low' });
    cands.sort(function (a, b) { return b.px - a.px; }); // nearer first (higher price, still below entry)
    return { swing: swing ? swing.px : null, psl: psl, target: cands[0] || null, all: cands };
  };

  Inst.prototype._fillEntry = function (bar, i, equity, riskPct, events, cap) {
    const spec = this.spec;
    const stop = this.pending.stop;
    const entry = bar.o;
    if (entry >= stop) {
      events.push(this._ev('reject', 'Skipped: open ' + fmtPx(spec, entry) + ' already through the stop ' + fmtPx(spec, stop) + '.'));
      this.flash = 'invalid';
      this.pending = null;
      this._resetCascade(true);
      this._setState('SCANNING', 0.08);
      return;
    }
    // Total-risk cap: the other book's open risk leaves only `cap.head` of the 1.00% budget.
    if (cap && cap.capped && riskPct < MIN_TRADE_RISK) {
      events.push(this._ev('reject', 'Skipped: risk cap. Open risk on the other book is ' + (cap.open * 100).toFixed(2) + '% of the account, leaving '
        + (Math.max(0, riskPct) * 100).toFixed(2) + '% under the ' + (TOTAL_RISK_CAP * 100).toFixed(2) + '% total cap (minimum ' + (MIN_TRADE_RISK * 100).toFixed(2) + '% per trade).'));
      this.pending = null;
      this._resetCascade(true);
      this._setState('SCANNING', 0.08);
      return;
    }
    const sz = sizePos(spec, equity, riskPct, entry, stop);
    if ((!sz || sz.qty < 1) && cap && cap.capped) {
      events.push(this._ev('reject', 'Skipped: risk cap. Only ' + (riskPct * 100).toFixed(2) + '% headroom left under the ' + (TOTAL_RISK_CAP * 100).toFixed(2)
        + '% total cap, and one micro at this stop (' + fmtPx(spec, stop - entry) + ') would need more.'));
      this.pending = null;
      this._resetCascade(true);
      this._setState('SCANNING', 0.08);
      return;
    }
    if (!sz || sz.qty < 1) {
      events.push(this._ev('reject', 'Skipped: stop distance ' + fmtPx(spec, stop - entry) + ' is too wide for one micro at ' + (riskPct * 100).toFixed(2) + '% of ' + fmtUsd(equity, 0) + '.'));
      this.pending = null;
      this._resetCascade(true);
      this._setState('SCANNING', 0.08);
      return;
    }
    const tg = this._targets(entry, this.pending.confirmI);
    const R = sz.dist;
    const r2 = roundTick(entry - 2 * R, spec.tick);
    const r3 = roundTick(entry - 3 * R, spec.tick);
    let target = tg.target ? tg.target.px : r2;
    let why = tg.target ? tg.target.why : '2R (no support below)';
    if (tg.target && (entry - tg.target.px) < 0.25 * R) {
      target = r2; why = '2R (support was inside 0.25R)';
    }
    this.pos = {
      product: sz.product, qty: sz.qty, micro: sz.micro, point: sz.point,
      entry: entry, stop: stop, initStop: stop, R: R, riskUsd: sz.riskUsd,
      target: target, targetWhy: why, swing: tg.swing, psl: tg.psl, r2: r2, r3: r3,
      entryI: i, entryT: bar.t, lowest: bar.l, trail: null, trail0: null, trailOn: false,
      atr: this.atr, setupKind: this.pending.setup.kind || 'UT', exitNext: false
    };
    this.lines = { stop: stop, target: target, swing: tg.swing, psl: (tg.psl != null && tg.psl < entry) ? tg.psl : null, r2: r2, r3: r3 };
    this.markers.entry = { i: i, px: entry, t: bar.t };
    this.trailHist = [];
    checkOn(this, 'entry', true);
    checkOn(this, 'stop', true);
    this._setState('IN TRADE', 0.94);
    this.flash = 'entry';
    this.pending = null;
    const d2 = sz.qty * (entry - r2) * sz.point;
    const d3 = sz.qty * (entry - r3) * sz.point;
    events.push(this._ev('entry', 'SHORT ' + sz.qty + ' ' + sz.product + ' @ ' + fmtPx(spec, entry)
      + '. Stop ' + fmtPx(spec, stop) + ' (' + Math.round(sz.dist / spec.tick) + ' ticks, risk ' + fmtUsd(-sz.riskUsd, 0).replace('+', '-')
      + ', ' + (sz.riskUsd / equity * 100).toFixed(2) + '% of account).'
      + (cap && cap.capped ? ' Sized down to the remaining risk headroom (' + (riskPct * 100).toFixed(2) + '% left under the ' + (TOTAL_RISK_CAP * 100).toFixed(2) + '% total cap).' : '')
      + ' Target ' + fmtPx(spec, target) + ' (' + why + '). 2R ' + fmtPx(spec, r2) + ' (' + fmtUsd(d2, 0) + ') · 3R ' + fmtPx(spec, r3) + ' (' + fmtUsd(d3, 0) + ').'));
  };

  Inst.prototype._exit = function (bar, i, px, reason, events) {
    const p = this.pos;
    const spec = this.spec;
    px = roundTick(px, spec.tick);
    const pnl = Math.round(((p.entry - px) * p.point * p.qty) * 100) / 100;
    const rMul = (p.entry - px) / p.R;
    this.realized += pnl;
    const tr = {
      inst: spec.id, product: p.product, qty: p.qty, entry: p.entry, exit: px,
      entryT: p.entryT, exitT: bar.t, pnl: pnl, r: rMul, reason: reason,
      entryI: p.entryI, exitI: i, riskUsd: p.riskUsd
    };
    this.trades.push(tr);
    this.markers.exit = { i: i, px: px, t: bar.t, reason: reason, pnl: pnl };
    events.push(this._ev(pnl >= 0 ? 'win' : 'loss', 'EXIT ' + p.qty + ' ' + p.product + ' @ ' + fmtPx(spec, px)
      + ' — ' + reason + '. ' + fmtUsd(pnl, 0) + ' (' + (rMul >= 0 ? '+' : '') + rMul.toFixed(2) + 'R).'));
    this.flash = pnl >= 0 ? 'win' : 'loss';
    this.pos = null;
    this.pending = null;
    this._resetCascade(true);
    this.exitHold = 8;
    this._setState('EXIT', pnl >= 0 ? 1 : 0.12);
    checkOn(this, 'trail', false);
    return tr;
  };

  Inst.prototype._manage = function (bar, i, events) {
    const p = this.pos;
    if (!p) return;
    const spec = this.spec;
    if (p.exitNext) {
      this._exit(bar, i, bar.o, 'close back above the trail (filled next open)', events);
      return;
    }
    const atr = (this.atrs[i - 1] != null ? this.atrs[i - 1] : this.atr) || p.R;
    const hard = p.trailOn && p.trail != null ? Math.min(p.initStop, p.trail + atr) : p.initStop;
    p.hard = hard;
    p.deepTop = p.trailOn && p.trail != null ? p.trail + atr : null;
    // Gap through the hard stop.
    if (bar.o >= hard) {
      this._exit(bar, i, bar.o, bar.o >= p.initStop && (!p.trailOn || p.initStop <= hard + 1e-9) ? 'gap through stop' : 'gap through deep-zone stop', events);
      return;
    }
    if (bar.h >= hard) {
      const reason = (p.trailOn && hard < p.initStop - spec.tick * 0.5) ? 'touched trail + 1 ATR (deep zone)' : 'stop';
      this._exit(bar, i, hard, reason, events);
      return;
    }
    if (bar.l <= p.target) {
      this._exit(bar, i, p.target, 'target (' + p.targetWhy + ')', events);
      return;
    }
    // Update extremes and ratchet the trail at the close. Active from the bar AFTER entry.
    p.lowest = Math.min(p.lowest, bar.l);
    const atrNow = this.atr || atr;
    if (i > p.entryI && atrNow) {
      const cand = p.lowest + 2 * atrNow;
      if (p.trail == null) p.trail = cand;
      else if (cand < p.trail - 1e-9) p.trail = cand;
      const moved = p._loggedTrail == null || (p._loggedTrail - p.trail) >= spec.tick * 12;
      if (p.trail != null && (p._loggedTrail == null || moved)) {
        checkOn(this, 'trail', true);
        p._loggedTrail = p.trail;
        events.push(this._ev('trail', 'Trail ratchets to ' + fmtPx(spec, p.trail) + ' (lowest low ' + fmtPx(spec, p.lowest) + ' + 2×ATR ' + fmtPx(spec, atrNow) + '). Deep zone ' + fmtPx(spec, p.trail) + ' → ' + fmtPx(spec, p.trail + atrNow) + '. A poke into that band is allowed; a close above the trail is not.'));
      }
      p.trail0 = p.trail0 == null ? p.trail : p.trail0;
      p.trailOn = true;
      p.atr = atrNow;
      this.trailHist.push({ i: i, y: p.trail, top: p.trail + atrNow });
      if (this.state === 'IN TRADE') this._setState('TRAILING', Math.max(0.7, Math.min(0.98, 0.8 + (p.entry - bar.c) / p.R * 0.05)));
      if (bar.c > p.trail) p.exitNext = true;
    }
  };

  Inst.prototype.feed = function (i, equity, riskPct, cap) {
    const events = [];
    const bar = this.bars[i];
    if (!bar) return events;
    this._lastT = bar.t;
    // Roll higher TFs first (completes the PREVIOUS bucket when the boundary is crossed).
    const c4 = this.h4.roll(bar);
    const c2 = this.h2.roll(bar);
    const c30 = this.m30.roll(bar);
    const c15 = this.m15.roll(bar);
    c4.forEach(function (b) { this._onHTF(this.h4, b, events); }, this);
    c2.forEach(function (b) { this._onHTF(this.h2, b, events); }, this);
    c30.forEach(function (b) { this._on30(b, events); }, this);
    c15.forEach(function (b) { this._on15(b, events); }, this);

    // 5m indicators including this close — but management uses the prior ATR (stored after).
    if (this.pending && this.pending.kind === 'entry' && !this.pos) this._fillEntry(bar, i, equity, riskPct, events, cap);
    // Push bar into m5 before manage so lowest/indexes line up. Indicators update after manage
    // so the stop check doesn't use same-bar ATR. We still need prevClose TR after manage.
    this.m5.push(bar);
    if (this.pos) this._manage(bar, i, events);

    this.prevE10 = this.e10; this.prevE20 = this.e20;
    this.e10 = ema(this.e10, bar.c, 10);
    this.e20 = ema(this.e20, bar.c, 20);
    this.e50 = ema(this.e50, bar.c, 50);
    const tr = this.prevClose == null ? bar.h - bar.l : Math.max(bar.h - bar.l, Math.abs(bar.h - this.prevClose), Math.abs(bar.l - this.prevClose));
    if (this.atr == null) {
      this._atrSum += tr; this._atrN++;
      if (this._atrN >= 14) this.atr = this._atrSum / 14;
    } else this.atr = (this.atr * 13 + tr) / 14;
    this.prevClose = bar.c;
    this.ema10.push(this.e10); this.ema20.push(this.e20); this.ema50.push(this.e50); this.atrs.push(this.atr);

    if (this.pos) {
      // Trail was updated inside _manage before ATR refresh. Re-ratchet once with the fresh ATR
      // if this isn't the entry bar — keep a single trail update per bar using atr AFTER close.
      // _manage already ran with old ATR for the hard stop (correct, no lookahead) and ratcheted
      // with this.atr which was still the previous bar. Good.
    }

    if (!this.pos && !(this.pending && this.pending.kind === 'entry')) {
      this._on5Cascade(bar, i, events);
      if (this.cx.stage === 'trig') this._on5Setup(bar, i, events);
    }

    // 30m close above the weakness high kills the cascade (checked when a 30m bar seals — handled
    // if stage has moved on). Also check the just-sealed bar if we're past w30.
    if (this.cx.stage && this.cx.w30 && (this.cx.stage === 'w15' || this.cx.stage === 'w5' || this.cx.stage === 'trig')) {
      const last30 = this.m30.bars[this.m30.bars.length - 1];
      if (last30 && last30.t !== (this._last30t) && last30.c > this.cx.w30.h && barEnd(last30, 30) > this.cx.w30.end) {
        this._last30t = last30.t;
        this._killCascade('Invalidated: 30m close ' + fmtPx(this.spec, last30.c) + ' above the 30m weakness high ' + fmtPx(this.spec, this.cx.w30.h) + '.', events);
      } else if (last30) this._last30t = last30.t;
    }

    if (!this.pos && this.exitHold > 0) {
      this.exitHold--;
      if (this.exitHold === 0 && this.cx.stage === 'idle') {
        this.checklist.forEach(function (c) { c.on = false; });
        this._setState('SCANNING', 0.1);
      }
    } else if (!this.pos && this.cx.stage === 'idle' && this.state !== 'EXIT') {
      this._setState('SCANNING', Math.max(0.08, this.conf * 0.98));
    }
    if (this.cx.stage === 'nd') this._setState('ND FOUND', Math.max(0.22, this.conf - 0.005));
    return events;
  };

  Inst.prototype.mark = function () {
    const last = this.m5[this.m5.length - 1];
    if (!this.pos || !last) return 0;
    return (this.pos.entry - last.c) * this.pos.point * this.pos.qty;
  };

  function Replay(world, opts) {
    opts = opts || {};
    this.world = world;
    this.equity0 = opts.equity || 50000;
    this.risk = Math.min(0.01, opts.risk || 0.0075);
    this.gold = new Inst(world.gold, SPECS.gold);
    this.nasdaq = new Inst(world.nasdaq, SPECS.nasdaq);
    this.i = 0;
    this.len = world.gold.bars.length;
    this.events = [];
    this.equityCurve = [this.equity0];
  }

  Replay.prototype.equity = function () {
    return this.equity0 + this.gold.realized + this.nasdaq.realized + this.gold.mark() + this.nasdaq.mark();
  };

  Replay.TOTAL_RISK_CAP = TOTAL_RISK_CAP;
  Replay.prototype.openRisk = function () {
    let r = 0;
    [this.gold, this.nasdaq].forEach(function (inst) { if (inst.pos) r += inst.pos.riskUsd; });
    return r;
  };

  Replay.prototype.step = function () {
    if (this.i >= this.len) return false;
    const eq = this.equity0 + this.gold.realized + this.nasdaq.realized; // size off realized equity, not open marks
    const ev = [];
    const eqS = Math.max(1000, eq), self = this;
    // per-instrument budget = min(per-trade risk, headroom left under the total cap); recomputed after each book fills
    function slot() {
      const open = self.openRisk() / eqS, head = Math.max(0, TOTAL_RISK_CAP - open);
      const pct = Math.min(Math.min(TOTAL_RISK_CAP, self.risk), head);
      return { pct: pct, cap: { capped: pct < Math.min(TOTAL_RISK_CAP, self.risk) - 1e-9, open: open, head: head } };
    }
    let sl = slot();
    ev.push.apply(ev, this.gold.feed(this.i, eqS, sl.pct, sl.cap));
    sl = slot();
    ev.push.apply(ev, this.nasdaq.feed(this.i, eqS, sl.pct, sl.cap));
    this.i++;
    this.events = ev;
    this.equityCurve.push(this.equity());
    return true;
  };

  Replay.prototype.stats = function () {
    const all = this.gold.trades.concat(this.nasdaq.trades);
    const wins = all.filter(function (t) { return t.pnl > 0; }).length;
    const r = all.reduce(function (s, t) { return s + t.r; }, 0);
    return { n: all.length, wins: wins, winRate: all.length ? wins / all.length : 0, r: r, realized: this.gold.realized + this.nasdaq.realized };
  };

  function createWorld(seed) {
    seed = (seed == null ? 7 : seed) | 0;
    const gold = makeBars(SPECS.gold, seed);
    const nasdaq = makeBars(SPECS.nasdaq, seed);
    const n = Math.min(gold.bars.length, nasdaq.bars.length);
    gold.bars = gold.bars.slice(0, n);
    nasdaq.bars = nasdaq.bars.slice(0, n);
    return { seed: seed, gold: gold, nasdaq: nasdaq, previewAt: Math.min(gold.previewAt, nasdaq.previewAt), len: n };
  }

  return {
    SPECS: SPECS, createWorld: createWorld, Replay: Replay, parseBars: parseBars,
    fmtPx: fmtPx, fmtUsd: fmtUsd, fmtZone: fmtZone, globexState: globexState, clv: clv,
    roundTick: roundTick
  };
});
