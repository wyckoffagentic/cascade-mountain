/* Cascade Mountain · VORTEX look (?look=vortex). SIMULATED data only.
   A vertical funnel of five timeframe tiers (4H wide at the top, 5m tight at the bottom) spiralling down into a
   decision core. Out-of-line tiers tilt and precess like loose gyroscope rings; as a tier aligns it levels, locks
   into the funnel and photon streams pour down from it into the next tier. At fire the funnel snaps into one green
   column, and while the trade is on it keeps roaring (fast rotation, rising streams, pulsing rings).
   VSA is a separate outer ring (advisory) with a sweeping scan and one photon glyph per finding; it never feeds the core.
   Reuses the shared HQ photon pipeline from swarm.js (window.SwarmKit). Photons only: no line primitives. */
(function (global) {
  'use strict';
  var K = global.SwarmKit;
  if (!K) return;
  var HQ = K.HQ, Spring = K.Spring, lerp = K.lerp, mix = K.mix, clamp = K.clamp, c01 = K.c01, rng = K.rng, fib = K.fib, project = K.project;
  var TFS = K.TFS, TFC = K.TFC, STAGE = K.STAGE, SIGNAL = K.SIGNAL, SIGNAL_L = K.SIGNAL_L, PEARL = K.PEARL, WARN = K.WARN, WHITE = K.WHITE, RED = K.RED, GOLD = K.GOLD;
  var STEP_ORBIT = K.STEP_ORBIT, STEP_RING = K.STEP_RING, arcTarget = K.arcTarget, shadeSprite = K.shadeSprite;

  /* geometry (units of R): tier ring radius and height, core, VSA ring */
  var TIER_R = [0.80, 0.64, 0.49, 0.35, 0.23];
  var TIER_Y = [0.56, 0.37, 0.19, 0.03, -0.12];
  var TIER_TILT = [0.42, 0.50, 0.58, 0.64, 0.70];      /* max wobble (rad) when out of line */
  var TIER_PREC = [0.23, -0.31, 0.37, -0.43, 0.52];    /* precession speed (rad/s) */
  var TIER_SPIN = [0.30, 0.42, 0.56, 0.74, 0.98];      /* orbital speed (rad/s), faster as it tightens */
  var TIER_NEED = [2, 2, 3, 4, 5];                     /* alignment step at which each tier locks */
  var CORE_Y = -0.33, VSA_R = 1.02, VSA_Y = 0.10;
  var TF_LAB = ['4H', '2H', '30m', '15m', '5m'];
  var ICE = [220, 238, 250];

  function Vortex(canvas, opts) {
    opts = opts || {};
    var q = global.location ? global.location.search : '';
    var capture = /[?&]capture\b/.test(q);
    if (opts.force2d || /[?&]nogl\b/.test(q)) return new global.SwarmLite(canvas, { force2d: true });
    var gc = document.createElement('canvas');
    gc.className = 'swarm3d'; gc.setAttribute('aria-hidden', 'true');
    var hq;
    try { hq = new HQ(gc, { capture: capture }); }
    catch (e) { return new global.SwarmLite(canvas, { force2d: true }); }
    this.hq = hq; this.glCanvas = gc;
    canvas.parentNode.insertBefore(gc, canvas);
    canvas.classList.add('overlay3d');
    this.canvas = canvas;
    this.mode = hq.hdr ? 'webgl-hdr' : 'webgl';
    this.state = 'SCANNING'; this.confT = 0.1; this.reduced = false; this.nodes = [];
    this.step = 0; this.energyT = 0; this.mergeT = 0; this.bias = { bear: 0, bull: 0 };
    this.sStep = new Spring(0, 3.0); this.sEnergy = new Spring(0, 2.2); this.sMerge = new Spring(0, 6.5); this.sPush = new Spring(0, 5); this.sArc = new Spring(0, 3);
    this.sAl = [0, 1, 2, 3, 4].map(function () { return new Spring(0, 3.4); });
    this.spin = [0, 1.1, 2.3, 3.1, 4.4]; this.prec = [0.3, 1.9, 3.7, 5.0, 0.9];
    this.flash = null; this.flashT = 0; this.flashCol = SIGNAL;
    this.shock = []; this.beam = 0; this.pulses = []; this.scatter = 0;
    this.glyphs = []; this.scanA = 0.6; this.vsaRot = 0; this.ripV = [];
    this.haloSig = 0; this.haloSigCol = SIGNAL;
    this._t = 0; this._built = ''; this.counts = null;
    this.dT = new Float32Array(16000 * 10); this.nT = 0;
    this.dC = new Float32Array(12000 * 10); this.nC = 0;
    this.cam = { yaw: 0, pitch: 0, yawV: 0, pitchV: 0, zoom: 1, zoomT: 1, drag: false, reset: 0, armed: 0 };
    this.fps = 0; this._fpsAcc = 0; this._fpsN = 0; this.cpuMs = 0;
    this.modeLabel = 'Cascade vortex';
    this._lastE = 0;
    var self = this;
    gc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    this._initInput();
  }
  Vortex.TF_COLORS = TFC; Vortex.STEP_ORBIT = STEP_ORBIT; Vortex.STEP_RING = STEP_RING; Vortex.SIGNAL = SIGNAL; Vortex.PEARL = PEARL;
  Vortex.prototype._initInput = K.initInput;
  Vortex.prototype.orbitBy = K.orbitBy;
  Vortex.prototype.destroy = K.destroy;
  Vortex.prototype.setCount = function () {};

  Vortex.prototype._build = function (tier) {
    if (tier === this._built) return;
    this._built = tier;
    var k = tier === 'reduced' ? 0.35 : tier === 'phone' ? 0.5 : 1;
    var C = {
      tiers: [1100, 1000, 900, 800, 700].map(function (n) { return Math.round(n * k); }),
      stream: Math.round(300 * k), funnel: Math.round(1600 * k), core: Math.round(360 * k),
      vsa: Math.round(2300 * k), scan: Math.round(220 * k), probe: Math.round(90 * k)
    };
    var R = rng(20261009 + (k * 100 | 0));
    function gauss() { return (R() + R() + R() - 1.5) / 1.5; }
    function pool(n, f) { var a = new Float32Array(n * 6); for (var i = 0; i < n; i++) f(a, i * 6, i); return a; }
    this.P = {
      tiers: C.tiers.map(function (n, t) {
        return pool(n, function (a, o, i) {
          var ph = R() * Math.PI * 2; ph += 0.4 * Math.sin(ph * (3 + t) + t);   /* knots along the ring */
          a[o] = ph; a[o + 1] = gauss(); a[o + 2] = gauss(); a[o + 3] = 0.85 + R() * 0.3; a[o + 4] = 1.6 + R() * 1.8 + (R() < 0.05 ? 2.4 : 0); a[o + 5] = R() * 100;
        });
      }),
      streams: [0, 1, 2, 3, 4].map(function () {
        return pool(C.stream, function (a, o) { a[o] = R() * Math.PI * 2; a[o + 1] = R(); a[o + 2] = gauss(); a[o + 3] = 0.8 + R() * 0.4; a[o + 4] = 1.8 + R() * 1.6; a[o + 5] = R() * 100; });
      }),
      funnel: pool(C.funnel, function (a, o) { a[o] = R() * Math.PI * 2; a[o + 1] = Math.pow(R(), 0.9); a[o + 2] = gauss(); a[o + 3] = 0.7 + R() * 0.6; a[o + 4] = 1.2 + R() * 1.4; a[o + 5] = R() * 100; }),
      core: pool(C.core, function (a, o, i) { var d = fib(i, C.core); a[o] = d[0]; a[o + 1] = d[1]; a[o + 2] = d[2]; a[o + 3] = R(); a[o + 4] = 1.6 + R() * 2.2; a[o + 5] = R() * 100; }),
      vsa: pool(C.vsa, function (a, o) { a[o] = R() * Math.PI * 2; a[o + 1] = gauss(); a[o + 2] = gauss(); a[o + 3] = R(); a[o + 4] = 1.2 + R() * 1.5 + (R() < 0.04 ? 2 : 0); a[o + 5] = R() * 100; }),
      probes: [0, 1, 2, 3, 4].map(function () {
        return pool(C.probe, function (a, o) { a[o] = R() * Math.PI * 2; a[o + 1] = R(); a[o + 2] = gauss(); a[o + 3] = 0.7 + R() * 0.7; a[o + 4] = 2 + R() * 1.6; a[o + 5] = R() * 100; });
      })
    };
    var n = C.stream * 5 + C.funnel + C.core + C.vsa + C.scan + C.probe * 5;
    C.tiers.forEach(function (x) { n += x; });
    C.total = n;
    this.counts = C;
  };

  Vortex.prototype.calm = function () {
    this.flashT = 0; this.flash = null; this.shock = []; this.beam = 0; this.pulses = []; this.scatter = 0; this.haloSig = 0;
    this.sMerge.snap(this.mergeT); this.sStep.snap(this.step); this.sPush.snap(0);
    for (var k = 0; k < 5; k++) this.sAl[k].snap(this._alTarget(k));
    if (this.hq) this.hq.clear();
  };
  Vortex.prototype.burst = function (kind) {
    var col = kind === 'loss' || kind === 'invalid' ? RED : kind === 'win' ? GOLD : SIGNAL;
    this.flash = kind; this.flashT = 1.1; this.flashCol = col;
    if (kind === 'invalid') this.scatter = 1;
    this.shock.push({ t: 0, col: col, big: kind === 'entry' });
    if (kind === 'entry') { this.beam = 1; this.sPush.v += 8; }
    if (this.shock.length > 4) this.shock.shift();
  };
  Vortex.prototype.fire = function (agree) { this.haloSig = 1.6; this.haloSigCol = agree ? SIGNAL : WARN; };
  Vortex.prototype.vsa = function (f) {
    if (f.dir !== 'bear' && f.dir !== 'bull') return;
    var k = TFS.indexOf(f.tf);
    /* the glyph lands where the scan head is right now, riding the ring from then on */
    var ga = this.scanA - this.vsaRot, last = this.glyphs[this.glyphs.length - 1];
    if (last) { var dd = ((ga - last.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); if (dd < 0.32) ga = last.a + 0.32; }  /* keep glyphs legible when findings arrive faster than the sweep */
    this.glyphs.push({ a: ga, dir: f.dir, s: clamp(f.strength | 0, 1, 3), k: k < 0 ? 4 : k, name: f.name || '', life: 1, born: this._t });
    if (this.glyphs.length > 12) this.glyphs.shift();
    this.ripV.push({ a: this.scanA, t: 0, dir: f.dir });
    if (this.ripV.length > 4) this.ripV.shift();
  };
  Vortex.prototype._alTarget = function (k) {
    var s = this.step;
    if (s >= TIER_NEED[k]) return 1;
    if (k < 2 && s >= 1) return 0.55;           /* HTF no-demand found: the top tiers start to settle */
    if (s === TIER_NEED[k] - 1) return 0.18;    /* the next tier in line leans in */
    return 0;
  };
  Vortex.prototype._camera = function (dt, w, h, R) {
    var cam = this.cam;
    if (cam.armed > 0) cam.armed -= dt;
    if (!cam.drag && !this.reduced) {
      cam.yaw += cam.yawV * dt; cam.pitch = clamp(cam.pitch + cam.pitchV * dt, -0.6, 0.75);
      var damp = Math.exp(-dt * 2.6); cam.yawV *= damp; cam.pitchV *= damp;
    }
    if (cam.reset > 0) {
      var kk = Math.min(1, dt * 5);
      cam.yaw += (0 - cam.yaw) * kk; cam.pitch += (0 - cam.pitch) * kk;
      cam.reset = Math.abs(cam.yaw) + Math.abs(cam.pitch) > 0.002 ? 1 : 0;
    }
    cam.zoom += (cam.zoomT - cam.zoom) * Math.min(1, dt * 6);
    var push = this.sPush.step(0, dt), drift = this.reduced ? 0 : 1;
    var yaw = 0.2 + cam.yaw + drift * 0.16 * Math.sin(this._t * 0.09);
    var pitch = 0.30 + cam.pitch + drift * (0.03 * Math.sin(this._t * 0.21 + 1) + 0.012 * Math.sin(this._t * 0.53));
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var z = cam.zoom * (1 + 0.08 * push);
    return {
      m: new Float32Array([cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy]),
      D: R * 2.5 / z, F: R * 2.5 * 0.97, R: R, w: w, h: h, cx: w / 2, cy: h / 2, dpr: 1, maxW: 40, ox: 0, oy: 0
    };
  };
  function pushP(arr, idx, p, c, a, s) {
    var o = idx * 10;
    arr[o] = p[0]; arr[o + 1] = p[1]; arr[o + 2] = p[2];
    arr[o + 3] = c[0] / 255; arr[o + 4] = c[1] / 255; arr[o + 5] = c[2] / 255; arr[o + 6] = a; arr[o + 7] = s; arr[o + 8] = 0; arr[o + 9] = 0;
  }
  Vortex.prototype._t1 = function (p, c, a, s) { if (this.nT < 16000 && a > 0.003) pushP(this.dT, this.nT++, p, c, a, s); };
  Vortex.prototype._c1 = function (p, c, a, s) { if (this.nC < 12000 && a > 0.003) pushP(this.dC, this.nC++, p, c, a, s); };

  Vortex.prototype.draw = function (dt, model) {
    var t0 = performance.now();
    dt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 1) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
    var canvas = this.canvas;
    var w = Math.max(10, canvas.clientWidth || canvas.getBoundingClientRect().width);
    var h = Math.max(10, canvas.clientHeight || canvas.getBoundingClientRect().height);
    var phone = w < 620;
    var dpr = Math.min(phone ? 2 : 1.5, global.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    var gc = this.glCanvas;
    if (gc.width !== Math.round(w * dpr) || gc.height !== Math.round(h * dpr)) { gc.width = Math.round(w * dpr); gc.height = Math.round(h * dpr); }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (model) {
      this.state = model.state || this.state;
      this.confT = model.conf == null ? this.confT : model.conf;
      this.reduced = !!model.reduced;
      this.nodes = model.nodes || this.nodes;
      this.mergeT = model.merged ? 1 : 0;
      if (model.bias) this.bias = model.bias;
      var ns = clamp(model.step | 0, 0, 7);
      if (ns > this.step) {
        for (var nk = 0; nk < 5; nk++) if (TIER_NEED[nk] > this.step && TIER_NEED[nk] <= ns) this.pulses.push({ k: nk, t: 0 });
        if (ns >= 6 && this.step < 6) this.pulses.push({ k: 5, t: 0 });
      }
      this.step = ns;
      this.energyT = clamp((model.energy || 0) / 100, 0, 1);
    }
    var red = this.reduced;
    this._build(red ? 'reduced' : phone ? 'phone' : 'desktop');
    var R = phone ? Math.min(w * 0.47, h * 0.5) : Math.min(w * 0.40, h * 0.56);
    var adt = red ? 0 : dt;              /* animation time: frozen under reduced motion */
    this._t += adt;
    var T = this._t;
    if (red) { this.sMerge.snap(this.mergeT); this.sStep.snap(this.step); this.sEnergy.snap(this.energyT); }
    var mE = clamp(this.sMerge.step(this.mergeT, dt), 0, 1);
    var E = clamp(this.sEnergy.step(this.energyT, dt), 0, 1);
    /* shared intensity arc: builds while confirming / armed, peaks at fire, stays roaring for the whole trade */
    var arcT = arcTarget(this);
    var arc = clamp(this.sArc.step(arcT, dt, arcT > this.sArc.x ? 3.2 : 1.3), 0, 1);
    if (red) { this.sArc.snap(arcT); arc = arcT; }
    var hot = arc * mE;                  /* in-trade roar */
    E = Math.max(E, arc * 0.9);
    this.sStep.step(this.step, dt);
    var al = [];
    for (var k = 0; k < 5; k++) { var tg = this._alTarget(k); if (red) this.sAl[k].snap(tg); al.push(clamp(this.sAl[k].step(tg, dt), 0, 1.1)); }
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.scatter > 0) this.scatter = Math.max(0, this.scatter - dt * 0.45);
    if (this.beam > 0) this.beam = Math.max(0, this.beam - dt / (red ? 0.3 : 1.6));
    if (this.haloSig > 0) this.haloSig = Math.max(0, this.haloSig - dt * 0.8);
    var flashK = this.flashT > 0 ? Math.pow(Math.min(1, this.flashT / 1.1), 2.2) : 0;
    var armed = this.step >= 6 ? 1 : 0;
    this.nT = 0; this.nC = 0;
    var sc = this.scatter, tight = 1 - 0.30 * mE;   /* at fire the funnel pulls into a column */
    var speed = (1 + 1.4 * E) * (1 + 0.6 * armed) * (1 + 0.5 * mE) * (1 + 1.5 * hot);
    var i, o, a, ph, p, c, r, y;

    /* ---- tier rings: tilted + precessing when out of line, level and locked when aligned ---- */
    var basis = [], tierR = [], tierY = [], tierCol = [];
    for (k = 0; k < 5; k++) {
      this.spin[k] += adt * TIER_SPIN[k] * speed;
      this.prec[k] += adt * TIER_PREC[k] * (1 + sc * 3);
      var loose = (1 - Math.min(1, al[k])) * (1 - mE);
      var tilt = TIER_TILT[k] * loose * (0.75 + 0.25 * Math.sin(T * 0.7 + k)) + sc * (0.9 + 0.2 * k);
      var nrm = [Math.sin(tilt) * Math.cos(this.prec[k]), Math.cos(tilt), Math.sin(tilt) * Math.sin(this.prec[k])];
      var ref = [0, 0, 1], u = [ref[1] * nrm[2] - ref[2] * nrm[1], ref[2] * nrm[0] - ref[0] * nrm[2], ref[0] * nrm[1] - ref[1] * nrm[0]];
      var ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
      var v = [nrm[1] * u[2] - nrm[2] * u[1], nrm[2] * u[0] - nrm[0] * u[2], nrm[0] * u[1] - nrm[1] * u[0]];
      basis.push({ u: u, v: v, n: nrm });
      tierR.push(R * TIER_R[k] * tight * (1 + 0.10 * loose));
      tierY.push(R * lerp(TIER_Y[k], TIER_Y[k] * 0.8 + CORE_Y * 0.2, mE) + (red ? 0 : R * 0.008 * Math.sin(T * 0.9 + k * 1.3)));
      var tc = mix(STAGE[k], SIGNAL_L, mE);
      if (this.flashT > 0 && this.flash !== 'entry') tc = mix(tc, this.flashCol, flashK * 0.6);
      tierCol.push(tc);
    }
    for (k = 0; k < 5; k++) {
      var pk = this.P.tiers[k], nk2 = pk.length / 6, B = basis[k], rr = tierR[k], yy = tierY[k];
      var loose2 = (1 - Math.min(1, al[k])) * (1 - mE);
      var ringWave = hot * Math.pow(0.5 + 0.5 * Math.sin(T * 5.5 - k * 1.1), 4);   /* pulse running down the rings */
      var lvl = (0.70 + 0.30 * Math.min(1, al[k]) + 0.18 * E + 0.25 * mE + 0.55 * ringWave) * (1 + flashK * 0.4);
      var jit = 0.05 + 0.07 * loose2, thick = R * (0.012 + 0.03 * loose2);
      for (i = 0; i < nk2; i++) {
        o = i * 6;
        ph = pk[o] + this.spin[k] * pk[o + 3];
        r = rr * (1 + pk[o + 1] * jit);
        var off = pk[o + 2] * thick, cs = Math.cos(ph), sn = Math.sin(ph);
        p = [B.u[0] * cs * r + B.v[0] * sn * r + B.n[0] * off, yy + B.u[1] * cs * r + B.v[1] * sn * r + B.n[1] * off, B.u[2] * cs * r + B.v[2] * sn * r + B.n[2] * off];
        var tw = 0.6 + 0.4 * Math.sin(T * (1.5 + (pk[o + 5] % 3)) + pk[o + 5]);
        this._t1(p, tierCol[k], lvl * tw * (0.62 + 0.25 * loose2), pk[o + 4]);
      }
      /* scan head: a bright knot running round each tier ("thinking"), faster as the tier aligns */
      var kn = phone ? 14 : 26, kh = this.spin[k] * 2.2 + k * 1.3, kA = (0.55 + 0.4 * (1 - mE)) * (1 - 0.6 * sc);
      for (i = 0; i < kn; i++) {
        var kf = i / kn, ka = kh - kf * 0.55, kcs = Math.cos(ka), ksn = Math.sin(ka);
        p = [B.u[0] * kcs * rr + B.v[0] * ksn * rr, yy + B.u[1] * kcs * rr + B.v[1] * ksn * rr, B.u[2] * kcs * rr + B.v[2] * ksn * rr];
        this._c1(p, mix(WHITE, tierCol[k], kf), kA * Math.pow(1 - kf, 2), 2.2 + 2.4 * (1 - kf));
      }
    }

    /* ---- funnel body: faint spinning dust on the surface joining the tiers into a vortex ---- */
    var fu = this.P.funnel, nf = fu.length / 6;
    var fA = (0.17 + 0.10 * E + 0.12 * hot + 0.10 * (this.step / 7) + 0.18 * mE) * (1 - 0.6 * sc);
    for (i = 0; i < nf; i++) {
      o = i * 6;
      var s = fu[o + 1] * 5, s0 = Math.min(4, Math.floor(s)), sf = s - s0;
      var ra = s0 < 4 ? lerp(tierR[s0], tierR[s0 + 1], sf) : lerp(tierR[4], R * 0.06, sf);
      var ya = s0 < 4 ? lerp(tierY[s0], tierY[s0 + 1], sf) : lerp(tierY[4], R * CORE_Y, sf);
      ph = fu[o] + T * (0.25 + 0.5 * fu[o + 1]) * speed * fu[o + 3];
      r = ra * (1 + fu[o + 2] * 0.04);
      c = s0 < 4 ? mix(tierCol[s0], tierCol[s0 + 1], sf) : mix(tierCol[4], WHITE, sf);
      this._t1([Math.cos(ph) * r, ya, Math.sin(ph) * r], c, fA * (0.5 + 0.5 * Math.sin(T * 2 + fu[o + 5])), fu[o + 4]);
    }

    /* ---- streams pour down between aligned tiers; probes from loose tiers fade halfway ---- */
    for (k = 0; k < 5; k++) {
      var st = this.P.streams[k], nst = st.length / 6;
      var a0 = Math.min(1, al[k]), a1 = k < 4 ? Math.min(1, al[k + 1]) : armed * 0.6 + 0.4 * Math.min(1, al[4]);
      var flow = a0 * a1 * (1 - sc);
      var rA = tierR[k], yA = tierY[k], rB = k < 4 ? tierR[k + 1] : R * 0.05, yB = k < 4 ? tierY[k + 1] : R * CORE_Y;
      var cA = tierCol[k], cB = k < 4 ? tierCol[k + 1] : mix(WHITE, SIGNAL_L, mE);
      var rate = 0.32 * speed;
      if (flow > 0.02) {
        for (i = 0; i < nst; i++) {
          o = i * 6;
          var uu = (st[o + 1] + T * rate * st[o + 3]) % 1;
          var e2 = uu * uu * (3 - 2 * uu);
          r = lerp(rA, rB, e2) * (1 + st[o + 2] * 0.03);
          y = lerp(yA, yB, uu);
          ph = st[o] + this.spin[k] + uu * 2.6;
          var fade = Math.sin(uu * Math.PI);
          this._t1([Math.cos(ph) * r, y, Math.sin(ph) * r], mix(cA, cB, uu), flow * fade * (0.55 + 0.25 * E), st[o + 4] * (0.9 + 0.4 * fade));
        }
      }
      /* probes: short searching sparks (always some, even when scanning) */
      var pr = this.P.probes[k], npr = pr.length / 6;
      var probe = (0.5 + 0.5 * a0) * (1 - flow) * (1 - mE) * (1 - 0.7 * sc);
      if (probe > 0.02) {
        for (i = 0; i < npr; i++) {
          o = i * 6;
          var up = (pr[o + 1] + T * 0.45 * pr[o + 3] * (1 + E)) % 1;
          var reach = 0.72;
          if (up > reach) continue;
          var q2 = up / reach;
          r = lerp(rA, rB, q2 * 0.6) * (1 + pr[o + 2] * 0.05);
          y = lerp(yA, yB, q2 * 0.6);
          ph = pr[o] + this.spin[k] * 0.8 + q2 * 1.4;
          this._t1([Math.cos(ph) * r, y, Math.sin(ph) * r], mix(cA, WHITE, 0.3), probe * Math.pow(1 - q2, 1.3) * 1.3, pr[o + 4] * 1.15);
        }
      }
    }

    /* ---- decision core: white-hot sphere that charges with each aligned tier ---- */
    var coreC = [0, R * CORE_Y, 0];
    var charge = this.step / 7;
    var beat = red ? 0 : (armed ? Math.pow(Math.max(0, Math.sin(T * 5.2)), 6) : 0.4 * Math.max(0, Math.sin(T * 1.6)));
    var cr = R * (0.055 + 0.02 * charge + 0.012 * beat) * (1 + flashK * 0.35);
    var coreCol = mix(mix(ICE, WHITE, charge), SIGNAL_L, mE * 0.75);
    if (this.flashT > 0 && this.flash !== 'entry') coreCol = mix(coreCol, this.flashCol, flashK);
    var co = this.P.core, nco = co.length / 6, rot = T * 0.6 * speed;
    var crs = Math.cos(rot), srs = Math.sin(rot);
    for (i = 0; i < nco; i++) {
      o = i * 6;
      var dx = co[o], dy = co[o + 1], dz = co[o + 2];
      var rx = dx * crs - dz * srs, rz = dx * srs + dz * crs;
      var rj = cr * (0.7 + 0.3 * co[o + 3]);
      this._c1([rx * rj, coreC[1] + dy * rj, rz * rj], coreCol, (0.35 + 0.35 * charge + 0.4 * beat) * 0.6, co[o + 4]);
    }
    var corePulse = hot * (red ? 0.5 : Math.pow(0.5 + 0.5 * Math.sin(T * 5.5), 3));
    this._c1(coreC, WHITE, 0.55 + 0.4 * charge + beat * 0.5 + flashK * 0.9 + 0.3 * corePulse, cr * 0.9);
    this._c1(coreC, coreCol, 0.08 + 0.07 * charge + flashK * 0.22 + 0.12 * corePulse, cr * 4.2);

    /* ---- alignment pulses: a ring of light runs round a tier the moment it locks ---- */
    for (var pi = this.pulses.length - 1; pi >= 0; pi--) {
      var pu = this.pulses[pi];
      pu.t += dt / (red ? 0.4 : 1.1);
      if (pu.t >= 1) { this.pulses.splice(pi, 1); continue; }
      var pa = Math.pow(1 - pu.t, 1.4);
      if (pu.k === 5) {
        for (i = 0; i < 90; i++) { var aa = i / 90 * Math.PI * 2, prr = cr * (1.5 + pu.t * 5); this._c1([Math.cos(aa) * prr, coreC[1], Math.sin(aa) * prr], WHITE, pa * 0.8, 3); }
        continue;
      }
      var PB = basis[pu.k], prr2 = tierR[pu.k] * (1 + 0.18 * pu.t);
      for (i = 0; i < 160; i++) {
        var a3 = i / 160 * Math.PI * 2, cs3 = Math.cos(a3), sn3 = Math.sin(a3);
        this._c1([PB.u[0] * cs3 * prr2 + PB.v[0] * sn3 * prr2, tierY[pu.k] + PB.u[1] * cs3 * prr2 + PB.v[1] * sn3 * prr2, PB.u[2] * cs3 * prr2 + PB.v[2] * sn3 * prr2], mix(tierCol[pu.k], WHITE, 0.5), pa * 0.9, 3.2);
      }
    }

    /* ---- fire: horizontal shockwave from the core and a photon beam up the axis ---- */
    for (var si = this.shock.length - 1; si >= 0; si--) {
      var sh = this.shock[si];
      sh.t += dt / (red ? 0.35 : 1.8);
      if (sh.t >= 1) { this.shock.splice(si, 1); continue; }
      var se = 1 - Math.pow(1 - sh.t, 3), sa = Math.pow(1 - sh.t, 1.5) * (sh.big ? 1.6 : 1.1);
      var nsh = phone ? 420 : 900;
      for (i = 0; i < nsh; i++) {
        var a4 = i / nsh * Math.PI * 2 + (i % 7) * 0.013, sr = R * (0.1 + 1.35 * se) * (1 + ((i * 37) % 11 - 5) * 0.004);
        this._c1([Math.cos(a4) * sr, coreC[1] + ((i * 13) % 9 - 4) * R * 0.002, Math.sin(a4) * sr], i % 4 ? sh.col : WHITE, sa * 0.6, i % 4 ? 3.4 : 2.4);
        if (!(i % 3)) { var sr2 = sr * 0.78; this._c1([Math.cos(a4) * sr2, coreC[1], Math.sin(a4) * sr2], WHITE, sa * 0.25, 2.2); }
      }
    }
    /* in trade: a sustained roaring green column (rising swirling streams up the axis, brighter with weakness energy) */
    if (hot > 0.02) {
      var ncol = phone ? 380 : 900, colA = hot * (0.5 + 0.3 * E);
      for (i = 0; i < ncol; i++) {
        var cf = ((i * 0.618034) + T * (0.35 + 0.25 * ((i * 13) % 7) / 7) * (1 + E)) % 1;
        var cyy = coreC[1] + R * (0.02 + 1.0 * cf);
        var cR = R * (0.02 + 0.10 * cf + 0.03 * ((i * 7) % 10) / 10), cang = i * 2.39996 + T * (3.2 + 2 * cf);
        this._c1([Math.cos(cang) * cR, cyy, Math.sin(cang) * cR], i % 4 ? SIGNAL_L : mix(SIGNAL_L, WHITE, 0.6), colA * Math.sin(cf * Math.PI) * (i % 4 ? 1 : 0.7), 2.2 + 1.8 * (1 - cf));
      }
    }
    if (this.beam > 0) {
      /* a soft column of sparks climbing the axis (rising, spreading, fading) */
      var bm = this.beam, nb = phone ? 220 : 480, rise = 1 - bm;
      for (i = 0; i < nb; i++) {
        var bf = (i * 0.618034 + rise * 0.9) % 1;
        var by = coreC[1] + R * (0.04 + 1.05 * bf);
        var bang = i * 2.39996 + T * 1.5, brr = R * (0.012 + 0.07 * bf) * (0.4 + 0.6 * ((i * 7) % 10) / 10);
        this._c1([Math.cos(bang) * brr, by, Math.sin(bang) * brr], i % 3 ? SIGNAL_L : WHITE, bm * Math.pow(1 - bf, 1.3) * 0.75, 2.4 + (1 - bf) * 2.6);
      }
    }

    /* ---- VSA ring (advisory, separate): pearl dust, sweeping scan, a glyph per finding ---- */
    this.vsaRot -= adt * 0.05;
    this.scanA += adt * 0.85;
    var vR = R * VSA_R, vY = R * VSA_Y;
    var bsum = this.bias.bear + this.bias.bull, amb = bsum > 0.15 ? this.bias.bull / bsum : 0;
    var dustC = mix(PEARL, WARN, amb * 0.5);
    if (this.haloSig > 0) dustC = mix(dustC, this.haloSigCol, Math.min(1, this.haloSig) * 0.6);
    var vs = this.P.vsa, nv = vs.length / 6;
    for (i = 0; i < nv; i++) {
      o = i * 6;
      a = vs[o] + this.vsaRot;
      var dsc = ((this.scanA - a) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);   /* angle behind the scan head */
      var lit = dsc < 1.1 ? Math.pow(1 - dsc / 1.1, 2) : 0;
      r = vR * (1 + vs[o + 1] * 0.022);
      this._c1([Math.cos(a) * r, vY + vs[o + 2] * R * 0.008, Math.sin(a) * r], mix(dustC, WHITE, lit * 0.5), (0.30 + 0.08 * Math.sin(T * 1.3 + vs[o + 5])) * (1 + lit * 2.2), vs[o + 4]);
    }
    var nsc = this.counts.scan;
    for (i = 0; i < nsc; i++) {
      var f = i / nsc, as = this.scanA - f * 0.5;
      var ri = vR * (1 + ((i * 7) % 9 - 4) * 0.009), yi = vY + ((i * 5) % 7 - 3) * R * 0.004;
      this._c1([Math.cos(as) * ri, yi, Math.sin(as) * ri], mix(WHITE, dustC, f), Math.pow(1 - f, 2.4) * 0.5, 2.4 + (1 - f) * 2.4);
    }
    for (var gi = 0; gi < this.glyphs.length; gi++) {
      var g = this.glyphs[gi];
      g.life = Math.max(0.45, g.life - dt * 0.03);
      var ga = g.a + this.vsaRot, age = T - g.born, pop = age < 0.6 ? 1 + 1.5 * (1 - age / 0.6) : 1;
      var gc0 = [Math.cos(ga) * vR, vY, Math.sin(ga) * vR];
      var tx = [-Math.sin(ga), 0, Math.cos(ga)];
      var gs = R * (0.028 + 0.010 * g.s) * pop;
      var col = g.dir === 'bull' ? WARN : mix(PEARL, TFC[g.k], 0.25);
      var ga2 = g.life * (g.dir === 'bull' ? 1.0 : 0.85);
      if (g.dir === 'bull') {
        for (i = 0; i < 18; i++) { var ca = i / 18 * Math.PI * 2; this._c1([gc0[0] + tx[0] * Math.cos(ca) * gs, gc0[1] + Math.sin(ca) * gs, gc0[2] + tx[2] * Math.cos(ca) * gs], col, ga2 * 0.9, 3); }
      } else {
        for (i = 0; i < 16; i++) {
          var qd = i / 16 * 4, side = Math.floor(qd), qf = qd - side;
          var cx0 = [1, 0, -1, 0][side], cy0 = [0, 1, 0, -1][side], cx1 = [0, -1, 0, 1][side], cy1 = [1, 0, -1, 0][side];
          var lx = lerp(cx0, cx1, qf) * gs * 0.8, ly = lerp(cy0, cy1, qf) * gs * 1.25;
          this._c1([gc0[0] + tx[0] * lx, gc0[1] + ly, gc0[2] + tx[2] * lx], col, ga2 * 0.9, 3);
        }
      }
      this._c1(gc0, col, ga2 * (1.1 + (pop - 1)), 6 + g.s * 1.5);
    }
    for (var vi = this.ripV.length - 1; vi >= 0; vi--) {
      var rv = this.ripV[vi];
      rv.t += dt / 1.4;
      if (rv.t >= 1) { this.ripV.splice(vi, 1); continue; }
      var spread = 0.05 + rv.t * 0.9, rcol = rv.dir === 'bull' ? WARN : PEARL;
      for (i = 0; i < 60; i++) {
        var sgn = i % 2 ? 1 : -1, ar = rv.a + sgn * spread * (0.9 + (i % 5) * 0.03);
        this._c1([Math.cos(ar) * vR, vY, Math.sin(ar) * vR], rcol, Math.pow(1 - rv.t, 1.5) * 0.9, 3.4);
      }
    }

    /* ---- render ---- */
    var V = this._camera(dt, w, h, R);
    V.dpr = dpr; V.maxW = phone ? 26 : 40;
    V.oy = phone ? R * 0.26 : -R * 0.07;
    var post = {
      keep: red ? 0 : clamp(0.80 + 0.08 * E, 0, 0.9), thr: 0.85, knee: 0.5, time: T, gain: 1,
      land: 0, arc: arc, expo: 1.08 + 0.05 * E + 0.03 * hot, flash: flashK * (this.flash === 'entry' ? 0.55 : 0.8), flashCol: c01(mix(this.flashCol, WHITE, 0.5)),
      grain: 0.028, hy: phone ? 0.2 : 0.22, bloom: 0.6 + 0.2 * E + flashK * 0.35 + 0.15 * mE + 0.12 * hot, vig: 0.55
    };
    var cpj = project(V, coreC); post.core = [cpj[0] / w, 1 - cpj[1] / h];
    if (!this.lost) {
      try { this.hq.render2(V, this.dT, this.nT, this.dC, this.nC, post); }
      catch (e) { this.lost = true; if (global.console) console.warn('HQ renderer stopped:', e.message); }
    }

    /* ---- crisp overlay text (no glow, never bloomed) ---- */
    ctx.clearRect(0, 0, w, h);
    var shade = shadeSprite();
    ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
    var fs = phone ? 9.5 : 11;
    var self = this;
    var rects = [];
    function tag(txt, x, y, align, color, bold, optional) {
      ctx.font = (bold ? '700 ' : '600 ') + fs + 'px "Geist Mono", ui-monospace, monospace';
      var tw2 = ctx.measureText(txt).width;
      var x0 = align === 'left' ? x : align === 'right' ? x - tw2 : x - tw2 / 2;
      x0 = clamp(x0, phone ? 84 : 96, w - tw2 - 6);   /* keep clear of the timeframe chip rail */
      /* optional labels give way to anything already placed (min gap 8px) */
      for (var ri = 0; optional && ri < rects.length; ri++) {
        var q3 = rects[ri];
        if (x0 < q3[2] + 8 && x0 + tw2 > q3[0] - 8 && Math.abs(y - q3[1]) < 22) return 0;
      }
      rects.push([x0, y, x0 + tw2]);
      ctx.drawImage(shade, x0 - 10, y - 12, tw2 + 20, 24);
      ctx.fillStyle = color; ctx.textAlign = 'left';
      ctx.fillText(txt, x0, y);
      return tw2;
    }
    /* tier labels at each ring's right-hand edge: timeframe + status */
    for (k = 0; k < 5; k++) {
      var best = null, B2 = basis[k];
      for (var sa2 = 0; sa2 < 24; sa2++) {
        var an = sa2 / 24 * Math.PI * 2, cs4 = Math.cos(an), sn4 = Math.sin(an);
        var pp = project(V, [B2.u[0] * cs4 * tierR[k] + B2.v[0] * sn4 * tierR[k], tierY[k] + B2.u[1] * cs4 * tierR[k] + B2.v[1] * sn4 * tierR[k], B2.u[2] * cs4 * tierR[k] + B2.v[2] * sn4 * tierR[k]]);
        if (!best || pp[0] > best[0]) best = pp;
      }
      var on = al[k] > 0.8 || mE > 0.5;
      var stTxt = mE > 0.5 ? '✓ fired' : on ? '✓ aligned' : al[k] > 0.3 ? '… settling' : '· searching';
      var lab = phone ? TF_LAB[k] + ' ' + (on ? '✓' : al[k] > 0.3 ? '…' : '·') : TF_LAB[k] + '  ' + stTxt;
      tag(lab, best[0] + (phone ? 6 : 12), best[1], 'left', on ? '#e9fff1' : '#eef6fb', on);
    }
    /* core caption */
    var coreTxt = mE > 0.5 ? 'CORE · IN TRADE' : armed ? 'CORE · 5m TRIGGER ARMED' : 'DECISION CORE';
    tag(coreTxt, cpj[0], cpj[1] + cr * cpj[2] + (phone ? 18 : 22), 'center', '#ffffff', true);
    /* VSA ring caption on its left extreme, plus the newest finding near its glyph */
    var vl = project(V, [-vR * Math.cos(0.25), vY, vR * Math.sin(0.25)]);
    tag('VSA RING · ADVISORY', vl[0] - 4, vl[1] + 16, 'left', '#f4f8fb', true);
    var gN = this.glyphs[this.glyphs.length - 1];
    if (gN && T - gN.born < 9) {
      var gpa = gN.a + this.vsaRot, gp = project(V, [Math.cos(gpa) * vR, vY, Math.sin(gpa) * vR]);
      var gtxt = gN.name.toUpperCase().slice(0, 26) + ' · ' + TF_LAB[gN.k] + (gN.dir === 'bull' ? ' · CONTRADICTS' : ' · CONFIRMS');
      tag(gtxt, gp[0], gp[1] - (phone ? 18 : 22), 'center', gN.dir === 'bull' ? '#ffe7a3' : '#ffffff', false, true);
    }
    this.modeLabel = red ? 'Motion off' : sc > 0.15 ? 'Rings tumbling' : mE > 0.5 ? 'Roaring column · in trade' : armed ? 'Trigger armed' : 'Cascade vortex';
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  global.VortexLook = Vortex;
})(window);
