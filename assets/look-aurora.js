/* Cascade Mountain · AURORA look (?look=aurora). SIMULATED data only.
   Five aurora curtains drift over a starry night sky above dark hills and a still lake, one curtain per timeframe
   (4H highest and farthest, 5m lowest), coloured as in the legend. Curtains are faint and slow while scanning,
   brighten and quicken as each timeframe aligns, track weakness energy, surge to signal green at fire, and while the
   trade is on they wind into a green cyclone around the decision corona (sustained, scaled by weakness energy),
   unwinding at exit or invalidation.
   VSA is a separate advisory ring of pearl photons lying on the lake, with a sweeping scan and one glyph per finding;
   it never feeds the curtains or the corona.
   Soft light only: the sky is a procedural composite (shared HQ bloom / tone map from swarm.js), photons are
   additive points; no line primitives; text is crisp on the 2D overlay. */
(function (global) {
  'use strict';
  var K = global.SwarmKit;
  if (!K) return;
  var HQ = K.HQ, Spring = K.Spring, lerp = K.lerp, mix = K.mix, clamp = K.clamp, c01 = K.c01;
  var SIGNAL = K.SIGNAL, SIGNAL_L = K.SIGNAL_L, PEARL = K.PEARL, WARN = K.WARN, WHITE = K.WHITE, RED = K.RED, GOLD = K.GOLD, TFC = K.TFC;
  var arcTarget = K.arcTarget;

  /* curtain colours in light (legend hues pushed toward aurora: violet, sky, teal-green, magenta, rose) */
  var AC = [[122, 108, 255], [52, 176, 255], [36, 255, 178], [214, 92, 255], [255, 86, 160]];
  var TF_LAB = ['4H', '2H', '30m', '15m', '5m'];
  var NEED = [1, 2, 3, 4, 5];            /* alignment step at which each timeframe's curtain locks */
  var BASE_D = [0.74, 0.645, 0.55, 0.455, 0.36], BASE_P = [0.80, 0.715, 0.63, 0.545, 0.46];

  /* ---------- sky composite: stars, curtains, hills, lake (then the shared bloom + tone map tail) ---------- */
  function auroraFS() {
    var src = K.COMP_FS;
    var head = src.slice(0, src.indexOf('void main(){'));
    var tail = src.slice(src.indexOf('  vec3 sc = texture2D(uS, uv).rgb;'));
    return head + [
      'uniform float uAI[5]; uniform float uAB[5]; uniform vec3 uAC[5];',
      'uniform float uAct, uSurge, uSwirl, uAmp, uAPh; uniform vec2 uCor; uniform vec3 uSig;',
      'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
      '  float a = hh(i), b = hh(i + vec2(1.0, 0.0)), c = hh(i + vec2(0.0, 1.0)), d = hh(i + vec2(1.0, 1.0));',
      '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }',
      /* curtain base line: sum of sines only, so the JS photons can sit exactly on it */
      'float baseY(float x, float fk, float t){',
      '  return 0.6 * sin(x * 1.7 + t * 0.11 + fk * 2.1) + 0.4 * sin(x * 3.9 - t * 0.17 + fk * 0.7) + 0.18 * sin(x * 9.0 + t * 0.5 + fk);',
      '}',
      'vec3 aurora(vec2 p){',
      '  vec2 d = p - uCor; float r = length(d);',
      /* cyclone: swirl the sky round the corona (sustained while in trade) */
      '  float sw = uSwirl * 1.9 * exp(-r * 2.4);',
      '  float ang = sw * (1.0 + 0.25 * sin(uAPh * 0.5)) + uSwirl * uAPh * 0.3 * exp(-r * 2.6);',
      '  float ca = cos(ang), sa = sin(ang);',
      '  p = uCor + vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);',
      '  vec3 acc = vec3(0.0);',
      '  float t = uAPh;',
      '  for (int k = 0; k < 5; k++) {',
      '    float fk = float(k);',
      '    float I = uAI[k]; if (I < 0.01) continue;',
      '    float base = uAB[k] + uAmp * baseY(p.x, fk, t);',
      '    float dy = p.y - base;',
      '    if (dy < -0.04) continue;',
      '    float hgt = 0.065 + 0.075 * I;',
      '    float lower = smoothstep(-0.007, 0.003, dy);',
      '    float up = exp(-max(dy, 0.0) / hgt);',
      /* fine vertical striations (rays) that shimmer sideways, plus broader folds */
      '    float r1 = vn(vec2(p.x * 95.0 + fk * 13.0 + t * 1.2, t * 0.3 + fk + dy * 3.0));',
      '    float r2 = vn(vec2(p.x * 21.0 - t * 0.45 + fk * 5.0, t * 0.17 + fk));',
      '    float rays = pow(0.2 + 0.8 * r1, 2.4) * (0.45 + 0.9 * r2);',
      '    float fold = 0.45 + 0.55 * sin(p.x * 5.0 + 3.0 * vn(vec2(p.x * 1.6 + t * 0.12, fk)) + t * 0.6 + fk * 1.3);',
      '    float hem = exp(-max(dy, 0.0) * 110.0) * lower * (0.55 + 0.45 * r2);',
      '    float glow = lower * exp(-max(dy, 0.0) / (hgt * 3.0)) * 0.10;',
      '    float a = (lower * up * rays * fold + hem * 0.55 + glow) * I;',
      '    vec3 c = uAC[k];',
      '    c = mix(c, mix(vec3(0.75, 1.0, 0.9), uAC[k], 0.35), hem * 0.8);',
      '    c = mix(c, c * vec3(0.8, 0.5, 1.15), smoothstep(0.0, hgt * 2.0, dy) * 0.6);',
      '    c = mix(c, uSig, uSurge);',
      '    acc += c * a;',
      '  }',
      /* corona: soft radial rays round the decision point, strongest in the cyclone */
      '  float cr2 = length(d);',
      '  float rayA = atan(d.y, d.x);',
      '  float cor = (0.25 + 0.75 * vn(vec2(rayA * 9.0 + uAPh * 0.4, uAPh * 0.2))) * exp(-cr2 * 4.5) * uSwirl;',
      '  acc += uSig * cor * 0.9;',
      '  return acc;',
      '}',
      'void main(){',
      '  vec2 uv = vU;',
      '  float x = (uv.x - 0.5) * uAspect;',
      /* night sky */
      '  vec3 col = mix(vec3(0.018, 0.030, 0.060), vec3(0.004, 0.008, 0.020), smoothstep(uHy, 1.0, uv.y));',
      '  col += vec3(0.020, 0.050, 0.070) * exp(-abs(uv.y - uHy) * 7.0);',
      /* stars (hashed grid, gentle twinkle) */
      '  vec2 sg = vec2(x, uv.y) * 140.0; vec2 si = floor(sg), sf = fract(sg);',
      '  float sr = hh(si);',
      '  if (sr > 0.965 && uv.y > uHy) { vec2 sp = vec2(hh(si + 3.1), hh(si + 7.7)) * 0.8 + 0.1; float sd = length(sf - sp);',
      '    col += vec3(0.85, 0.90, 1.0) * smoothstep(0.12, 0.0, sd) * (0.35 + 0.65 * hh(si + 1.3)) * (0.75 + 0.25 * sin(uTime * (1.0 + 3.0 * hh(si)) + sr * 40.0)); }',
      /* curtains in the sky, mirrored in the lake */
      '  vec3 au;',
      '  if (uv.y >= uHy) au = aurora(vec2(x, uv.y));',
      '  else { float dd = uHy - uv.y; au = aurora(vec2(x + sin(uv.y * 260.0 + uTime * 1.3) * 0.002 * (1.0 + dd * 8.0), uHy + dd * 1.25)) * 0.42 * exp(-dd * 2.5); }',
      '  col = col * (1.0 - clamp(dot(au, vec3(0.3)), 0.0, 0.6)) + au;',
      /* hills: two soft dark ridges with a faint aurora rim */
      '  float h1y = uHy + 0.050 + 0.030 * sin(x * 2.3 + 0.7) + 0.018 * sin(x * 5.1 + 2.0) + 0.006 * sin(x * 17.0);',
      '  float h2y = uHy + 0.018 + 0.016 * sin(x * 3.7 + 1.9) + 0.010 * sin(x * 8.3) + 0.004 * sin(x * 31.0);',
      '  float aa = 1.4 / uRes.y;',
      '  if (uv.y >= uHy) {',
      '    float m1 = smoothstep(h1y + aa, h1y - aa, uv.y), m2 = smoothstep(h2y + aa, h2y - aa, uv.y);',
      '    vec3 rimC = texture2D(uB2, vec2(uv.x, h1y + 0.03)).rgb * 0.6 + uSig * uSurge * 0.06;',
      '    col = mix(col, vec3(0.020, 0.030, 0.050) + rimC * exp(-max(h1y - uv.y, 0.0) * 160.0) * 0.5, m1);',
      '    col = mix(col, vec3(0.008, 0.012, 0.022) + rimC * exp(-max(h2y - uv.y, 0.0) * 220.0) * 0.3, m2);',
      '  } else {',
      /* lake: reflected hills darken the top of the water */
      '    float dd2 = uHy - uv.y, my = uHy + dd2 * 1.25;',
      '    float r1 = step(my, h1y), r2 = step(my, h2y);',
      '    col = mix(col, vec3(0.010, 0.015, 0.028), max(r1 * 0.75, r2 * 0.9));',
      '    col *= 0.85;',
      '  }'
    ].join('\n') + '\n' + tail;
  }

  function Aurora(canvas, opts) {
    opts = opts || {};
    var q = global.location ? global.location.search : '';
    var capture = /[?&]capture\b/.test(q);
    if (opts.force2d || /[?&]nogl\b/.test(q)) return new global.SwarmLite(canvas, { force2d: true });
    var gc = document.createElement('canvas');
    gc.className = 'swarm3d'; gc.setAttribute('aria-hidden', 'true');
    var hq;
    try { hq = new HQ(gc, { capture: capture, compFS: auroraFS() }); }
    catch (e) { if (global.console) console.warn('Aurora look unavailable, using the simple renderer:', e.message); return new global.SwarmLite(canvas, { force2d: true }); }
    this.hq = hq; this.glCanvas = gc;
    canvas.parentNode.insertBefore(gc, canvas);
    canvas.classList.add('overlay3d');
    canvas.style.cursor = 'default';
    this.canvas = canvas;
    this.mode = hq.hdr ? 'webgl-hdr' : 'webgl';
    this.state = 'SCANNING'; this.confT = 0.1; this.reduced = false; this.nodes = [];
    this.step = 0; this.energyT = 0; this.mergeT = 0; this.bias = { bear: 0, bull: 0 };
    this.sEnergy = new Spring(0, 2.2); this.sMerge = new Spring(0, 4); this.sArc = new Spring(0, 3);
    this.sAl = [0, 1, 2, 3, 4].map(function () { return new Spring(0, 2.6); });
    this.flash = null; this.flashT = 0; this.flashCol = SIGNAL; this.scatter = 0;
    this.shock = []; this.glyphs = []; this.ripV = []; this.scanA = 0.4;
    this.haloSig = 0; this.haloSigCol = SIGNAL;
    this._t = 0; this._ph = 0; this.counts = { motes: 0 };
    this.dT = new Float32Array(9000 * 10); this.nT = 0;
    this.dC = new Float32Array(9000 * 10); this.nC = 0;
    this.fps = 0; this._fpsAcc = 0; this._fpsN = 0; this.cpuMs = 0;
    this.modeLabel = 'Aurora · scanning';
    var self = this;
    gc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
  }
  Aurora.TF_COLORS = TFC; Aurora.SIGNAL = SIGNAL; Aurora.PEARL = PEARL;
  Aurora.prototype.destroy = K.destroy;
  Aurora.prototype.setCount = function () {};
  Aurora.prototype.orbitBy = function () {};
  Aurora.prototype.calm = function () { this.shock.length = 0; this.flashT = 0; this.scatter = 0; this.ripV.length = 0; };
  Aurora.prototype.burst = function (kind) {
    var col = kind === 'loss' || kind === 'invalid' ? RED : kind === 'win' ? GOLD : SIGNAL;
    this.flash = kind; this.flashCol = col; this.flashT = kind === 'entry' ? 1.2 : 0.9;
    this.shock.push({ t: 0, col: col, big: kind === 'entry' });
    if (kind === 'invalid' || kind === 'loss') this.scatter = 1;
  };
  Aurora.prototype.fire = function (agree) { this.haloSig = 1.6; this.haloSigCol = agree ? SIGNAL : WARN; };
  Aurora.prototype.vsa = function (f) {
    if (!f || (f.dir !== 'bear' && f.dir !== 'bull')) return;
    var k = Math.max(0, ['4h', '2h', '30m', '15m', '5m'].indexOf(f.tf));
    var ga = this.scanA, last = this.glyphs[this.glyphs.length - 1];
    if (last) { var dd = ((ga - last.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); if (dd < 0.34) ga = last.a + 0.34; }
    this.glyphs.push({ a: ga, dir: f.dir, k: k, s: clamp(f.strength | 0, 1, 3), born: this._t, life: 1, label: f.label || f.name || '' });
    if (this.glyphs.length > 9) this.glyphs.shift();
    this.ripV.push({ a: ga, t: 0, dir: f.dir });
  };
  Aurora.prototype._t1 = function (x, y, c, a, s) { if (this.nT < 9000 && a > 0.003) push(this.dT, this.nT++, x, y, c, a, s, this._w, this._h); };
  Aurora.prototype._c1 = function (x, y, c, a, s) { if (this.nC < 9000 && a > 0.003) push(this.dC, this.nC++, x, y, c, a, s, this._w, this._h); };
  function push(arr, idx, x, y, c, a, s, w, h) {
    var o = idx * 10;
    arr[o] = x - w / 2; arr[o + 1] = h / 2 - y; arr[o + 2] = 0;
    arr[o + 3] = c[0] / 255; arr[o + 4] = c[1] / 255; arr[o + 5] = c[2] / 255; arr[o + 6] = a;
    arr[o + 7] = s; arr[o + 8] = 0; arr[o + 9] = 0;
  }
  function baseY(x, fk, t) { return 0.6 * Math.sin(x * 1.7 + t * 0.11 + fk * 2.1) + 0.4 * Math.sin(x * 3.9 - t * 0.17 + fk * 0.7) + 0.18 * Math.sin(x * 9.0 + t * 0.5 + fk); }
  function hsh(n) { var x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

  Aurora.prototype.draw = function (dt, model) {
    var t0 = performance.now();
    dt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 1) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
    var canvas = this.canvas;
    var w = Math.max(10, canvas.clientWidth || canvas.getBoundingClientRect().width);
    var h = Math.max(10, canvas.clientHeight || canvas.getBoundingClientRect().height);
    this._w = w; this._h = h;
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
      this.mergeT = model.merged ? 1 : 0;
      if (model.bias) this.bias = model.bias;
      var ns = clamp(model.step | 0, 0, 7);
      if (ns > this.step) for (var nk = 0; nk < 5; nk++) if (NEED[nk] > this.step && NEED[nk] <= ns) this.shock.push({ t: 0, col: AC[nk], tier: nk });
      this.step = ns;
      this.energyT = clamp((model.energy || 0) / 100, 0, 1);
    }
    var red = this.reduced;
    var adt = red ? 0 : dt;
    this._t += adt;
    var T = this._t;
    if (red) { this.sMerge.snap(this.mergeT); this.sEnergy.snap(this.energyT); }
    var mE = clamp(this.sMerge.step(this.mergeT, dt), 0, 1);
    var E = clamp(this.sEnergy.step(this.energyT, dt), 0, 1);
    var arcT = arcTarget(this);
    var arc = clamp(this.sArc.step(arcT, dt, arcT > this.sArc.x ? 3.2 : 1.2), 0, 1);
    if (red) { this.sArc.snap(arcT); arc = arcT; }
    var hot = arc * mE;
    var al = [];
    for (var k = 0; k < 5; k++) {
      var tg = this.step >= NEED[k] ? 1 : this.step === NEED[k] - 1 ? 0.3 : 0;
      if (red) this.sAl[k].snap(tg);
      al.push(clamp(this.sAl[k].step(tg, dt), 0, 1));
    }
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.scatter > 0) this.scatter = Math.max(0, this.scatter - dt * 0.5);
    if (this.haloSig > 0) this.haloSig = Math.max(0, this.haloSig - dt * 0.8);
    var flashK = this.flashT > 0 ? Math.pow(Math.min(1, this.flashT / 1.2), 2) : 0;
    var entryK = this.flash === 'entry' ? flashK : 0;
    /* activity: slow drift while scanning, quicker as alignment builds, fast and sustained in trade */
    var act = 0.35 + 0.5 * E + 1.1 * arc + 0.9 * hot;
    this._ph += adt * act;
    var PH = this._ph;
    var hy = phone ? 0.20 : 0.22;
    var aspect = w / h;
    var BASE = phone ? BASE_P : BASE_D;
    var amp = (phone ? 0.045 : 0.06) * (1 + 0.5 * arc) * (1 - 0.4 * this.scatter) + 0.03 * this.scatter;
    var AI = [], AB = [], ACc = [];
    for (k = 0; k < 5; k++) {
      var lift = 0.34 + 0.6 * al[k];
      AI.push(Math.min(1.25, (lift * (0.85 + 0.35 * E) + 0.30 * arc + 0.25 * hot * (0.7 + 0.3 * Math.sin(PH * 2.2 + k))) * (1 - 0.5 * this.scatter) + 0.35 * entryK));
      AB.push(BASE[k] - 0.05 * hot * (k / 4));
      ACc.push(c01(AC[k]));
    }
    var surge = clamp(Math.max(mE * 0.82, entryK), 0, 1);
    var swirl = clamp(hot * (0.75 + 0.25 * E) + entryK * 0.5, 0, 1);
    var cor = [0, phone ? 0.66 : 0.62];
    var sig = this.flashT > 0 && this.flash !== 'entry' ? this.flashCol : SIGNAL_L;
    this.nT = 0; this.nC = 0;
    var i, x, y, a;
    function toPx(px, py) { return [w / 2 + px * h, h - py * h]; }   /* shader space (x in aspect units, y up) -> CSS px */

    /* motes: photons drifting along each curtain's hem, more and brighter as it aligns */
    var nM = red ? 50 : phone ? 90 : 170, mcount = 0;
    var halfW = aspect / 2;
    for (k = 0; k < 5; k++) {
      var col = mix(AC[k], SIGNAL_L, surge), I0 = AI[k];
      for (i = 0; i < nM; i++) {
        var sd = hsh(i * 7.31 + k * 101.7), sd2 = hsh(i * 3.17 + k * 57.3);
        x = -halfW + ((sd + PH * (0.015 + 0.03 * sd2) * (i % 2 ? 1 : -0.6)) % 1 + 1) % 1 * aspect;
        var by = BASE[k] - 0.05 * hot * (k / 4) + amp * baseY(x, k, PH);
        var rise = ((sd2 + PH * 0.05 * (0.5 + sd)) % 1);
        y = by + rise * (0.03 + 0.1 * I0) * sd;
        var pp = toPx(x, y);
        if (hot > 0.02) {   /* in trade the motes are pulled round the corona (cyclone) */
          var cx = w / 2 + cor[0] * h, cy = h - cor[1] * h, ddx = pp[0] - cx, ddy = pp[1] - cy, rr = Math.hypot(ddx, ddy);
          var rot = swirl * 1.9 * Math.exp(-rr / h * 2.4) + swirl * PH * 0.3 * Math.exp(-rr / h * 2.6);
          var cs = Math.cos(-rot), sn = Math.sin(-rot);
          pp = [cx + ddx * cs - ddy * sn, cy + ddx * sn + ddy * cs];
        }
        var tw = 0.55 + 0.45 * Math.sin(T * (2 + 3 * sd) + i);
        a = (0.10 + 0.55 * I0) * tw * (1 - rise * 0.8);
        this._t1(pp[0], pp[1], mix(col, WHITE, 0.25 * (1 - rise)), a, 2.2 + 2.6 * sd2 * (1 - rise));
        mcount++;
      }
    }
    /* cyclone arms: streams of green photons spiralling into the corona while in trade */
    var cpx = w / 2 + cor[0] * h, cpy = h - cor[1] * h;
    if (hot > 0.02) {
      var nArm = phone ? 260 : 620;
      for (i = 0; i < nArm; i++) {
        var f = ((i * 0.618034) + PH * 0.12 * (1 + E)) % 1;
        var arm = i % 3, rr2 = h * (0.03 + 0.55 * (1 - f));
        var an = arm * 2.094 + (1 - f) * 4.2 - PH * 0.9 + hsh(i) * 0.25;
        a = hot * (0.30 + 0.25 * E) * Math.sin(f * Math.PI) * (0.6 + 0.4 * hsh(i * 1.7));
        this._t1(cpx + Math.cos(an) * rr2 * 1.25, cpy + Math.sin(an) * rr2 * 0.55, i % 5 ? SIGNAL_L : mix(SIGNAL_L, WHITE, 0.6), a, 2 + 2.6 * f);
      }
    }
    /* decision corona: a soft star that charges with alignment, pulses while in trade (gentle at fire) */
    var charge = this.step / 7, pulse = red ? 0.5 * hot : hot * Math.pow(0.5 + 0.5 * Math.sin(T * 4.6), 3);
    var corC = mix(mix(PEARL, WHITE, charge), SIGNAL_L, surge * 0.7);
    this._c1(cpx, cpy, corC, 0.18 + 0.35 * charge + 0.35 * pulse + 0.6 * entryK, 7 + 6 * charge + 6 * pulse);
    this._c1(cpx, cpy, corC, 0.05 + 0.06 * charge + 0.10 * pulse + 0.15 * entryK, 36 + 22 * charge);
    for (i = 0; i < 4; i++) {   /* photon lens spikes on the corona */
      var la = i * Math.PI / 2 + Math.PI / 4;
      for (var j = 1; j <= 6; j++) this._c1(cpx + Math.cos(la) * j * 5, cpy + Math.sin(la) * j * 5, corC, (0.10 + 0.2 * charge + 0.2 * pulse) * (1 - j / 7), 2.4);
    }
    /* shock: at fire a ring of photons rolls out from the corona; a tier lock sends a soft ripple along its curtain */
    for (var si = this.shock.length - 1; si >= 0; si--) {
      var sh = this.shock[si];
      sh.t += dt / (red ? 0.35 : sh.tier != null ? 1.4 : 1.8);
      if (sh.t >= 1) { this.shock.splice(si, 1); continue; }
      var se = 1 - Math.pow(1 - sh.t, 3), sa = Math.pow(1 - sh.t, 1.5);
      if (sh.tier != null) {
        var kk = sh.tier;
        for (i = 0; i < 70; i++) {
          var xx = -halfW + aspect * (0.5 + (i % 2 ? 1 : -1) * se * 0.5 * (0.9 + 0.1 * hsh(i)));
          var p2 = toPx(xx, BASE[kk] + amp * baseY(xx, kk, PH) + 0.01 * hsh(i * 3.3));
          this._c1(p2[0], p2[1], mix(AC[kk], WHITE, 0.4), sa * 0.8, 3.2);
        }
        continue;
      }
      var nsh = phone ? 360 : 720;
      for (i = 0; i < nsh; i++) {
        var a4 = i / nsh * Math.PI * 2, sr = h * (0.04 + 0.9 * se) * (1 + ((i * 37) % 11 - 5) * 0.006);
        this._c1(cpx + Math.cos(a4) * sr * 1.3, cpy + Math.sin(a4) * sr * 0.6, i % 4 ? sh.col : WHITE, sa * (sh.big ? 0.55 : 0.4), i % 4 ? 3 : 2.2);
      }
    }
    /* VSA ring (advisory, separate): pearl photons lying on the lake, a sweeping scan, a glyph per finding */
    this.scanA += adt * 0.8;
    var hyPx = h - hy * h, vRx = w * (phone ? 0.44 : 0.40), vRy = h * (phone ? 0.05 : 0.07), vCy = hyPx + vRy * 0.15;
    var bsum = this.bias.bear + this.bias.bull, amb = bsum > 0.15 ? this.bias.bull / bsum : 0;
    var dustC = mix(PEARL, WARN, amb * 0.5);
    if (this.haloSig > 0) dustC = mix(dustC, this.haloSigCol, Math.min(1, this.haloSig) * 0.6);
    var nV = red ? 260 : phone ? 420 : 820;
    for (i = 0; i < nV; i++) {
      var av = i / nV * Math.PI * 2 + hsh(i) * 0.01;
      var dsc = ((this.scanA - av) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
      var lit = dsc < 1.0 ? Math.pow(1 - dsc / 1.0, 2) : 0;
      var front = Math.sin(av) > 0 ? 1 : 0.55;
      var jr = 1 + (hsh(i * 1.3) - 0.5) * 0.03;
      this._c1(w / 2 + Math.cos(av) * vRx * jr, vCy + Math.sin(av) * vRy * jr, mix(dustC, WHITE, lit * 0.5), (0.16 + 0.05 * Math.sin(T * 1.3 + i)) * front * (1 + lit * 2.4), 2 + hsh(i * 2.1) * 1.6);
    }
    var glyphPos = [];
    for (var gi = 0; gi < this.glyphs.length; gi++) {
      var g = this.glyphs[gi];
      g.life = Math.max(0.45, g.life - dt * 0.03);
      var age = T - g.born, pop = age < 0.6 ? 1 + 1.4 * (1 - age / 0.6) : 1;
      var gx = w / 2 + Math.cos(g.a) * vRx, gy = vCy + Math.sin(g.a) * vRy;
      var gcol = g.dir === 'bull' ? WARN : mix(PEARL, TFC[g.k], 0.25), gs = (6 + 2 * g.s) * pop, ga2 = g.life;
      if (g.dir === 'bull') for (i = 0; i < 16; i++) { var ca = i / 16 * Math.PI * 2; this._c1(gx + Math.cos(ca) * gs, gy + Math.sin(ca) * gs * 0.8, gcol, ga2 * 0.9, 2.6); }
      else for (i = 0; i < 16; i++) {
        var qd = i / 16 * 4, side = Math.floor(qd), qf = qd - side;
        var x0 = [1, 0, -1, 0][side], y0 = [0, 1, 0, -1][side], x1 = [0, -1, 0, 1][side], y1 = [1, 0, -1, 0][side];
        this._c1(gx + lerp(x0, x1, qf) * gs * 0.8, gy + lerp(y0, y1, qf) * gs * 1.2, gcol, ga2 * 0.9, 2.6);
      }
      this._c1(gx, gy, gcol, ga2 * (1 + (pop - 1)), 5 + g.s * 1.5);
      glyphPos.push([gx, gy, g]);
    }
    for (var vi = this.ripV.length - 1; vi >= 0; vi--) {
      var rv = this.ripV[vi];
      rv.t += dt / 1.4;
      if (rv.t >= 1) { this.ripV.splice(vi, 1); continue; }
      var spread = 0.05 + rv.t * 0.9, rcol = rv.dir === 'bull' ? WARN : PEARL;
      for (i = 0; i < 50; i++) {
        var ar = rv.a + (i % 2 ? 1 : -1) * spread * (0.9 + (i % 5) * 0.03);
        this._c1(w / 2 + Math.cos(ar) * vRx, vCy + Math.sin(ar) * vRy, rcol, Math.pow(1 - rv.t, 1.5) * 0.8, 3);
      }
    }
    this.counts = { motes: mcount, total: this.nT + this.nC };

    /* ---- render ---- */
    var V = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], D: 1000, F: 1000, R: 1e6, w: w, h: h, ox: 0, oy: 0, cx: w / 2, cy: h / 2, dpr: dpr };
    var post = {
      keep: red ? 0 : clamp(0.80 + 0.06 * E + 0.04 * arc, 0, 0.9), thr: 0.85, knee: 0.5, time: T, gain: 1, land: 0, arc: arc,
      expo: 1.0 + 0.06 * E + 0.05 * arc + 0.04 * pulse, flash: flashK * (this.flash === 'entry' ? 0.45 : 0.7), flashCol: c01(mix(this.flashCol, WHITE, 0.4)),
      grain: 0.022, hy: hy, bloom: 0.55 + 0.15 * E + 0.15 * arc + 0.2 * pulse + flashK * 0.3, vig: 0.5,
      core: [0.5 + cor[0] / aspect, cor[1]],
      extra: function (gl, u) {
        gl.uniform1fv(u.uAI, AI); gl.uniform1fv(u.uAB, AB);
        gl.uniform3fv(u.uAC, [].concat.apply([], ACc));
        gl.uniform1f(u.uAct, act); gl.uniform1f(u.uSurge, surge); gl.uniform1f(u.uSwirl, swirl);
        gl.uniform1f(u.uAmp, amp); gl.uniform1f(u.uAPh, PH);
        gl.uniform2f(u.uCor, cor[0], cor[1]); gl.uniform3fv(u.uSig, c01(sig));
      }
    };
    if (!this.lost) {
      try { this.hq.render2(V, this.dT, this.nT, this.dC, this.nC, post); }
      catch (e) { this.lost = true; if (global.console) console.warn('HQ renderer stopped:', e.message); }
    }

    /* ---- crisp overlay text (no glow, never bloomed) ---- */
    ctx.clearRect(0, 0, w, h);
    var fs = phone ? 10.5 : 12;
    var rects = [];
    function tag(txt, x, y, align, color, bold, optional) {
      ctx.font = (bold ? '700 ' : '600 ') + fs + 'px "Geist Mono", ui-monospace, monospace';
      var tw2 = ctx.measureText(txt).width;
      var x0 = align === 'left' ? x : align === 'right' ? x - tw2 : x - tw2 / 2;
      x0 = clamp(x0, phone ? 84 : 96, w - tw2 - 6);   /* keep clear of the timeframe chip rail */
      for (var ri = 0; optional && ri < rects.length; ri++) {
        var q3 = rects[ri];
        if (x0 < q3[2] + 8 && x0 + tw2 > q3[0] - 8 && Math.abs(y - q3[1]) < 20) return 0;
      }
      rects.push([x0, y, x0 + tw2]);
      ctx.fillStyle = 'rgba(4,10,20,0.62)';
      var pad = 5, hgt = fs + 7;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0 - pad, y - hgt / 2, tw2 + pad * 2, hgt, 4); else ctx.rect(x0 - pad, y - hgt / 2, tw2 + pad * 2, hgt);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(txt, x0, y + 0.5);
      return 1;
    }
    /* curtain labels on the right, at each curtain's hem */
    var xr = halfW - (phone ? 0.03 : 0.05) * aspect;
    for (k = 0; k < 5; k++) {
      var on = al[k] > 0.6;
      var yy = BASE[k] - 0.05 * hot * (k / 4) + amp * baseY(xr, k, PH);
      var lp = toPx(xr, yy);
      var hex = 'rgb(' + Math.round(lerp(TFC[k][0], 255, 0.45)) + ',' + Math.round(lerp(TFC[k][1], 255, 0.45)) + ',' + Math.round(lerp(TFC[k][2], 255, 0.45)) + ')';
      tag(TF_LAB[k] + (phone ? (on ? ' ✓' : '') : on ? ' · aligned' : ' · waiting'), w - 8, lp[1], 'right', hex, on);
    }
    if (!phone || hot > 0.02 || this.step >= 6) tag(hot > 0.02 ? 'IN TRADE · ' + Math.round(this.energyT * 100) + ' energy' : this.step >= 6 ? 'TRIGGER ARMED' : 'DECISION', cpx, cpy - (phone ? 26 : 34), 'center', hot > 0.02 || this.step >= 6 ? '#c9ffdc' : '#ffffff', true);
    tag(phone ? 'VSA · advisory' : 'VSA WATCHER · advisory ring', w / 2, vCy + vRy + (phone ? 14 : 18), 'center', '#f2f6ff', false);
    for (var gq = glyphPos.length - 1; gq >= Math.max(0, glyphPos.length - 3); gq--) {
      var G = glyphPos[gq], gt = (G[2].dir === 'bull' ? 'contradicts' : 'confirms');
      tag(gt, G[0], G[1] - 16, 'center', G[2].dir === 'bull' ? '#ffe7a3' : '#ffffff', false, true);
    }
    this.modeLabel = red ? 'Motion off' : this.scatter > 0.15 ? 'Curtains scattering' : hot > 0.3 ? 'Aurora cyclone · in trade' : this.step >= 6 ? 'Aurora surging · armed' : this.step >= 3 ? 'Aurora building' : 'Aurora · scanning';
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  global.AuroraLook = Aurora;
})(window);
