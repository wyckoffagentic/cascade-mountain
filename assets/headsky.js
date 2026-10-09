/* Header sky (shared by every look): a living aurora behind the title and the snow-capped ridgeline, the odd snow
   gust across the peaks, and an occasional sun glint on the wordmark and the snow caps.
   Two light 2D canvases: the aurora is drawn at 1/3 resolution (soft by upscaling) at ~20 fps behind the ridgeline;
   the front canvas (snow gust + cap sparkles) only draws during an event. Paused off-screen and when the tab is hidden.
   Reduced motion: one static aurora frame, no storm and no glint. */
(function () {
  'use strict';
  var app = document.querySelector('.app'), head = document.querySelector('.head'), ridge = document.querySelector('.ridgeline');
  if (!app || !head || !ridge) return;
  var box = document.createElement('div'); box.className = 'headsky'; box.setAttribute('aria-hidden', 'true');
  var back = document.createElement('canvas'); back.className = 'hs-back';
  var front = document.createElement('canvas'); front.className = 'hs-front';
  box.appendChild(back); box.appendChild(front);
  app.insertBefore(box, app.firstChild);
  var bctx = back.getContext('2d'), fctx = front.getContext('2d');
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  var capture = /[?&]capture\b/.test(location.search);
  function still() { return mq.matches || document.body.classList.contains('rm'); }

  var W = 0, H = 0, bw = 0, bh = 0, dpr = 1, ridgeTop = 0, ridgeH = 78, boxTop = 0;
  var COLS = [[70, 255, 170], [150, 105, 255], [255, 92, 180]];
  var sprites = COLS.map(function (c) {
    var s = document.createElement('canvas'); s.width = 1; s.height = 64;
    var g = s.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(' + c + ',0)');
    gr.addColorStop(0.55, 'rgba(' + c + ',0.35)');
    gr.addColorStop(0.9, 'rgba(' + c + ',0.9)');
    gr.addColorStop(0.96, 'rgba(' + Math.min(255, c[0] + 90) + ',' + Math.min(255, c[1] + 60) + ',' + Math.min(255, c[2] + 60) + ',1)');
    gr.addColorStop(1, 'rgba(' + c + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, 1, 64);
    return s;
  });
  var peaks = [];   /* snow-cap tips from the ridge SVG (svg units, 2400 x 130) */
  fetch('assets/peaks-ridge.svg').then(function (r) { return r.text(); }).then(function (t) {
    var paths = t.match(/d="M[^"]+"/g) || [];
    paths.forEach(function (d) {
      var nums = d.match(/-?\d+(\.\d+)?/g).map(Number), pts = [];
      for (var i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      for (var j = 1; j + 1 < pts.length; j++) if (pts[j][1] < pts[j - 1][1] && pts[j][1] < pts[j + 1][1] && pts[j][1] < 70) peaks.push(pts[j]);
    });
  }).catch(function () { /* sparkles are optional */ });

  function layout() {
    var ar = app.getBoundingClientRect(), rr = ridge.getBoundingClientRect();
    boxTop = 0;
    W = document.documentElement.clientWidth;
    H = Math.max(60, Math.round(rr.bottom - ar.top + 4));
    ridgeTop = rr.top - ar.top; ridgeH = rr.height;
    box.style.height = H + 'px';
    dpr = Math.min(2, window.devicePixelRatio || 1);
    bw = Math.max(40, Math.round(W / 3)); bh = Math.max(20, Math.round(H / 3));
    back.width = bw; back.height = bh;
    front.width = Math.round(W * dpr); front.height = Math.round(H * dpr);
    paintBack(T);
  }

  /* ---- aurora: three drifting, breathing curtains whose hems sit low behind the peaks ---- */
  var T = 0;
  function paintBack(t) {
    bctx.globalCompositeOperation = 'source-over';
    bctx.clearRect(0, 0, bw, bh);
    bctx.globalCompositeOperation = 'lighter';
    var s = bw / W;   /* css px -> low-res px */
    var breath = 0.78 + 0.22 * Math.sin(t * 2 * Math.PI / 14);
    var hemBase = (ridgeTop + ridgeH * 0.42) * s / (H * s) * bh;
    var wide = W < 620;
    for (var k = 0; k < 3; k++) {
      var amp = bh * (wide ? 0.05 : 0.07), ph = k * 2.1, sp = sprites[k];
      var Imax = (k === 0 ? 0.62 : 0.5) * breath;
      var hgt0 = bh * (wide ? 0.62 : 0.9) * (0.82 + 0.18 * Math.sin(t * 0.21 + k * 1.7));
      for (var x = 0; x < bw; x++) {
        var u = x / bw * (wide ? 2.2 : 5.0);
        var hem = hemBase - bh * 0.03 * k + amp * (0.6 * Math.sin(u * 1.3 + t * 0.07 + ph) + 0.4 * Math.sin(u * 3.1 - t * 0.11 + ph * 0.5));
        var hgt = hgt0 * (0.75 + 0.25 * Math.sin(u * 0.9 + t * 0.13 + k));
        var ray = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.37 + t * 0.4 + k * 3.3)) * (0.5 + 0.5 * Math.sin(x * 0.13 - t * 0.17 + k));
        var fold = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(u * 0.8 + t * 0.09 + ph * 1.3), 1.5);
        var a = Imax * ray * fold;
        if (a < 0.01) continue;
        bctx.globalAlpha = Math.min(1, a);
        bctx.drawImage(sp, x, hem - hgt, 1, hgt + bh * 0.04);
      }
    }
    bctx.globalAlpha = 1;
  }

  /* ---- events: snow gust (every 45-90 s) and sun glint (every 20-40 s) ---- */
  var gust = null, glint = null, nextGust = 0, nextGlint = 0, flakes = [];
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function startGust() {
    var dir = Math.random() < 0.5 ? 1 : -1, n = W < 620 ? 260 : 650;
    flakes = [];
    for (var i = 0; i < n; i++) {
      var yb = ridgeTop + ridgeH * (0.15 + 0.9 * Math.pow(Math.random(), 0.7)) - Math.random() * 40;
      flakes.push({ x: Math.random() * W, y: yb, vx: dir * rnd(260, 720), vy: rnd(-20, 50), r: rnd(0.6, 1.9), a: rnd(0.35, 0.95), wob: Math.random() * 6 });
    }
    gust = { t: 0, dur: rnd(3.5, 5.5), dir: dir };
  }
  function startGlint() {
    glint = { t: 0, dur: 1.6 };
    var b = document.querySelector('.wm b');
    if (b) { b.classList.remove('glint'); void b.offsetWidth; b.classList.add('glint'); setTimeout(function () { b.classList.remove('glint'); }, 1700); }
  }
  function capPx(p) {   /* svg peak -> css px (background: bottom center / auto 100% repeat-x) */
    var sc = ridgeH / 130, tileW = 2400 * sc, x0 = W / 2 - tileW / 2;
    return [x0 + p[0] * sc, ridgeTop + p[1] * sc];
  }
  function paintFront(dt) {
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.clearRect(0, 0, W, H);
    if (gust) {
      gust.t += dt;
      var u = gust.t / gust.dur, e = Math.pow(Math.sin(Math.PI * Math.min(1, u)), 0.8);
      /* soft whiteout over the ridge at the height of the gust */
      var g = fctx.createLinearGradient(0, ridgeTop - 20, 0, ridgeTop + ridgeH);
      g.addColorStop(0, 'rgba(220,234,245,0)'); g.addColorStop(0.6, 'rgba(220,234,245,' + (0.26 * e).toFixed(3) + ')'); g.addColorStop(1, 'rgba(220,234,245,' + (0.14 * e).toFixed(3) + ')');
      fctx.fillStyle = g; fctx.fillRect(0, ridgeTop - 20, W, ridgeH + 20);
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.x += f.vx * dt; f.y += (f.vy + Math.sin(gust.t * 3 + f.wob) * 20) * dt;
        if (f.x > W + 12) f.x = -12; if (f.x < -12) f.x = W + 12;
        var al = f.a * e, tail = f.vx * 0.012;
        fctx.fillStyle = 'rgba(240,248,255,' + (al * 0.35).toFixed(3) + ')';
        fctx.fillRect(Math.min(f.x, f.x - tail), f.y - f.r * 0.5, Math.abs(tail), f.r);
        fctx.fillStyle = 'rgba(246,251,255,' + al.toFixed(3) + ')';
        fctx.beginPath(); fctx.arc(f.x, f.y, f.r, 0, 6.2832); fctx.fill();
      }
      if (u >= 1) gust = null;
    }
    if (glint) {
      glint.t += dt;
      var v = glint.t / glint.dur, sweepX = -0.1 * W + 1.2 * W * v;
      for (var j = 0; j < peaks.length; j++) {
        var cp = capPx(peaks[j]), period = ridgeH / 130 * 2400;
        for (var rep = -2; rep <= 2; rep++) {
          var px = cp[0] + rep * period;
          if (px < 0 || px > W) continue;
          var d = Math.abs(px - sweepX), k2 = Math.exp(-d * d / (2 * 50 * 50));
          if (k2 < 0.03) continue;
          var r = 7 * k2 + 2, rg = fctx.createRadialGradient(px, cp[1] + 1, 0, px, cp[1] + 1, r * 2.2);
          rg.addColorStop(0, 'rgba(255,246,222,' + (0.95 * k2).toFixed(3) + ')'); rg.addColorStop(1, 'rgba(255,246,222,0)');
          fctx.fillStyle = rg; fctx.fillRect(px - r * 2.2, cp[1] + 1 - r * 2.2, r * 4.4, r * 4.4);
          fctx.fillStyle = 'rgba(255,250,235,' + (0.6 * k2).toFixed(3) + ')';
          fctx.fillRect(px - r * 1.6, cp[1] + 0.5, r * 3.2, 1); fctx.fillRect(px - 0.5, cp[1] + 1 - r * 1.6, 1, r * 3.2);
        }
      }
      if (v >= 1) glint = null;
    }
  }

  var visible = true, raf = 0, last = 0, lastBack = 0, frontDirty = false;
  function loop(now) {
    raf = 0;
    if (!visible || document.hidden || still()) return;
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016; last = now;
    if (!capture) T += dt;   /* ?capture (stills/tests): the sky clock is pinned via __HEADSKY.at */
    if (now - lastBack > 50) { paintBack(T); lastBack = now; }
    if (!capture) {
      if (!nextGust) nextGust = T + rnd(12, 25);
      if (!nextGlint) nextGlint = T + rnd(5, 9);
      if (T > nextGust && !gust) { startGust(); nextGust = T + rnd(45, 90); }
      if (T > nextGlint && !glint) { startGlint(); nextGlint = T + rnd(20, 40); }
    }
    if (gust || glint) { paintFront(dt); frontDirty = true; }
    else if (frontDirty) { fctx.clearRect(0, 0, front.width, front.height); frontDirty = false; }
    raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf && visible && !document.hidden && !still()) { last = 0; raf = requestAnimationFrame(loop); } }
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; kick(); }).observe(box);
  document.addEventListener('visibilitychange', kick);
  if (mq.addEventListener) mq.addEventListener('change', function () { paintBack(T); kick(); });
  new MutationObserver(function () { if (still()) { gust = null; glint = null; fctx.clearRect(0, 0, front.width, front.height); paintBack(T); } kick(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', layout);
  if ('ResizeObserver' in window) new ResizeObserver(layout).observe(head);
  layout(); kick();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  /* deterministic hooks for still capture */
  window.__HEADSKY = {
    at: function (t) { T = t; paintBack(T); },
    gust: function (sec) { startGust(); var n = Math.round((sec || 2) / 0.033); for (var i = 0; i < n; i++) paintFront(0.033); },
    glint: function (sec) { startGlint(); peaksReady(); var n = Math.round((sec || 0.8) / 0.033); for (var i = 0; i < n; i++) paintFront(0.033); },
    peaks: function () { return peaks.length; }
  };
  function peaksReady() {}
})();
