/* SwarmLite: the simpler fallback orbit (canvas-2D projection) used when the HQ WebGL renderer is unavailable.
   Orbital decision field in 3D, drawn only with light.
   Every element is a photon with a real 3D position, projected with perspective (size and brightness fall
   off with depth, plus a little depth fog). WebGL renders the photons as additive point sprites with a
   short, soft trail buffer; without WebGL the same photon list is projected on the CPU and drawn as 2D sprites.
   No stroked lines or outlines anywhere. Text sits on a 2D overlay, crisp, with no glow.
   - Each timeframe lane is its own tilted orbital plane. Alignment steps tighten the radii and rotate every
     plane toward one shared disc; at trade fire they lie flat together with the lime collapse.
     On invalidation the planes tumble apart.
   - The VSA overseer is a sparse, fixed-size photon sphere with an eye sweeping over its surface. */
(function (global) {
  'use strict';

  var TFS = ['4h', '2h', '30m', '15m', '5m'];
  var TFC = [[140, 154, 255], [63, 184, 255], [47, 220, 203], [214, 140, 255], [255, 143, 168]];
  var SIGNAL = [109, 255, 158];
  var PEARL = [237, 246, 255];
  var WARN = [255, 204, 51];
  var WHITE = [255, 255, 255];
  var RED = [255, 128, 104];
  var GOLD = [255, 168, 119];
  var LANE = [1.32, 1.14, 0.97, 0.82, 0.68];
  /* Alignment steps: 0 scanning, 1 HTF ND, 2 HTF UT/HUT, 3 30m, 4 15m, 5 5m, 6 trigger, 7 trade fire.
     Swarm (orbit) and band radii as a fraction of R = min(w, 1.18h). The overseer sphere stays at 0.45R. */
  var STEP_ORBIT = [0.300, 0.272, 0.246, 0.222, 0.200, 0.180, 0.162, 0.140];
  var STEP_RING = [0.400, 0.362, 0.328, 0.296, 0.268, 0.243, 0.220, 0.196];
  /* lane plane inclinations and ascending nodes while unaligned (degrees) */
  var INCL = [64, -48, 30, -72, 14];
  var NODE = [0, 72, 150, 222, 300];
  var TUMB = [1.0, -0.8, 1.2, -1.1, 0.9];
  var BAND_LANE = [4, 2, 0];
  var DEG = Math.PI / 180;
  var BG = [5, 9, 14];

  var SATS = [
    { id: 'ND', key: 'nd' }, { id: 'UT', key: 'ut' }, { id: 'CONF', key: 'conf' },
    { id: 'ENTRY', key: 'entry' }, { id: 'STOP', key: 'stop' }, { id: 'TRAIL', key: 'trail' }
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function jitterCol(c, j) {
    return [clamp(c[0] + j[0], 60, 255), clamp(c[1] + j[1], 60, 255), clamp(c[2] + j[2], 60, 255)];
  }
  function qb(a, b, c, t, o) {
    var u = 1 - t;
    o[0] = u * u * a[0] + 2 * u * t * b[0] + t * t * c[0];
    o[1] = u * u * a[1] + 2 * u * t * b[1] + t * t * c[1];
    o[2] = u * u * a[2] + 2 * u * t * b[2] + t * t * c[2];
    return o;
  }
  function fib(i, n) {
    var y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.399963229728653;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  }
  /* point on a lane plane: angle a, radius r, inclination inc, ascending node om; also returns plane normal */
  function planeBasis(inc, om) {
    var ci = Math.cos(inc), si = Math.sin(inc), co = Math.cos(om), so = Math.sin(om);
    /* u = in-plane x axis, v = in-plane z axis (after inclination about x, then node about y) */
    return { ux: co, uy: 0, uz: -so, vx: si * 0 + ci * so, vy: -si, vz: ci * co, nx: si * so, ny: ci, nz: si * co };
  }
  function onPlane(B, a, r, o) {
    var c = Math.cos(a) * r, s = Math.sin(a) * r;
    o[0] = B.ux * c + B.vx * s; o[1] = B.uy * c + B.vy * s; o[2] = B.uz * c + B.vz * s;
    return o;
  }

  /* ---------------- photon list ---------------- */
  function Buf(cap) { this.cap = cap; this.d = new Float32Array(cap * 8); this.n = 0; }
  Buf.prototype.push = function (x, y, z, c, a, s) {
    if (a <= 0.01 || s <= 0) return;
    if (this.n >= this.cap) {
      var nd = new Float32Array(this.cap * 16); nd.set(this.d); this.d = nd; this.cap *= 2;
    }
    var o = this.n * 8, d = this.d;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d[o + 3] = c[0] / 255; d[o + 4] = c[1] / 255; d[o + 5] = c[2] / 255;
    d[o + 6] = a > 1.4 ? 1.4 : a; d[o + 7] = s;
    this.n++;
  };

  /* ---------------- WebGL renderer ---------------- */
  var VS = [
    'attribute vec3 aP; attribute vec4 aC; attribute float aS;',
    'uniform mat3 uM; uniform float uD; uniform float uF; uniform float uFog; uniform vec2 uRes; uniform float uDpr; uniform float uMaxPt;',
    'varying vec4 vC;',
    'void main(){',
    '  vec3 v = uM * aP; float zc = max(uD - v.z, 1.0); float k = uF / zc;',
    '  gl_Position = vec4(v.x * k / (uRes.x * 0.5), v.y * k / (uRes.y * 0.5), 0.0, 1.0);',
    '  float fog = clamp(1.0 - (zc - uD) / uFog * 0.55, 0.3, 1.15);',
    '  float ps = aS * 2.0 * k * uDpr;',
    '  gl_PointSize = clamp(ps, 1.0, uMaxPt);',
    '  vC = vec4(aC.rgb, aC.a * fog * min(1.0, ps / 1.6));',
    '}'].join('\n');
  var FS = [
    'precision mediump float; varying vec4 vC;',
    'void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float r2 = dot(d, d); if (r2 > 1.0) discard;',
    '  float a = max(0.0, exp(-r2 * 4.0) - 0.0183);',
    '  gl_FragColor = vec4(vC.rgb * vC.a * a, 1.0); }'].join('\n');
  var QVS = 'attribute vec2 aQ; varying vec2 vU; void main(){ vU = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }';
  var QFS_T = 'precision mediump float; varying vec2 vU; uniform sampler2D uT; void main(){ gl_FragColor = texture2D(uT, vU); }';
  var QFS_C = 'precision mediump float; uniform vec4 uCol; void main(){ gl_FragColor = uCol; }';

  function GLR(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
    if (!gl) throw new Error('no webgl');
    this.gl = gl; this.canvas = canvas;
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function prog(v, f) {
      var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    this.pp = prog(VS, FS); this.pt = prog(QVS, QFS_T); this.pc = prog(QVS, QFS_C);
    this.loc = {
      aP: gl.getAttribLocation(this.pp, 'aP'), aC: gl.getAttribLocation(this.pp, 'aC'), aS: gl.getAttribLocation(this.pp, 'aS'),
      uM: gl.getUniformLocation(this.pp, 'uM'), uD: gl.getUniformLocation(this.pp, 'uD'), uF: gl.getUniformLocation(this.pp, 'uF'),
      uFog: gl.getUniformLocation(this.pp, 'uFog'), uRes: gl.getUniformLocation(this.pp, 'uRes'), uDpr: gl.getUniformLocation(this.pp, 'uDpr'),
      uMaxPt: gl.getUniformLocation(this.pp, 'uMaxPt'),
      tQ: gl.getAttribLocation(this.pt, 'aQ'), tT: gl.getUniformLocation(this.pt, 'uT'),
      cQ: gl.getAttribLocation(this.pc, 'aQ'), cCol: gl.getUniformLocation(this.pc, 'uCol')
    };
    this.vb = gl.createBuffer();
    this.qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var pr = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPt = pr ? pr[1] : 64;
    this.fbo = null; this.tex = null; this.fw = 0; this.fh = 0;
    gl.disable(gl.DEPTH_TEST);
  }
  GLR.prototype._ensureFbo = function (w, h) {
    var gl = this.gl;
    if (this.fbo && this.fw === w && this.fh === h) return;
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fw = w; this.fh = h;
  };
  GLR.prototype.clearTrail = function () {
    if (!this.fbo) return;
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  GLR.prototype._quad = function (prog, aq) {
    var gl = this.gl;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qb);
    gl.enableVertexAttribArray(aq);
    gl.vertexAttribPointer(aq, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(aq);
  };
  GLR.prototype._points = function (buf, V) {
    if (!buf.n) return;
    var gl = this.gl, L = this.loc;
    gl.useProgram(this.pp);
    gl.uniformMatrix3fv(L.uM, false, V.m);
    gl.uniform1f(L.uD, V.D); gl.uniform1f(L.uF, V.F); gl.uniform1f(L.uFog, V.fog);
    gl.uniform2f(L.uRes, V.w, V.h); gl.uniform1f(L.uDpr, V.dpr); gl.uniform1f(L.uMaxPt, this.maxPt);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
    gl.bufferData(gl.ARRAY_BUFFER, buf.d.subarray(0, buf.n * 8), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(L.aP); gl.enableVertexAttribArray(L.aC); gl.enableVertexAttribArray(L.aS);
    gl.vertexAttribPointer(L.aP, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(L.aC, 4, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(L.aS, 1, gl.FLOAT, false, 32, 28);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, buf.n);
    gl.disableVertexAttribArray(L.aP); gl.disableVertexAttribArray(L.aC); gl.disableVertexAttribArray(L.aS);
  };
  GLR.prototype.render = function (trail, crisp, V, fade) {
    var gl = this.gl, L = this.loc;
    var pw = gl.drawingBufferWidth, ph = gl.drawingBufferHeight;
    this._ensureFbo(pw, ph);
    /* trail pass: multiply down, subtract a hair (no 8-bit ghosts), then add this frame's photons */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, pw, ph);
    gl.enable(gl.BLEND);
    gl.useProgram(this.pc);
    gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform4f(L.cCol, 0, 0, 0, fade);
    this._quad(this.pc, L.cQ);
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT); gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform4f(L.cCol, 3 / 255, 3 / 255, 3 / 255, 0);
    this._quad(this.pc, L.cQ);
    gl.blendEquation(gl.FUNC_ADD);
    this._points(trail, V);
    /* screen: background, trail layer added on top, then the trail-free photons */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(BG[0] / 255, BG[1] / 255, BG[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.pt);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(L.tT, 0);
    this._quad(this.pt, L.tQ);
    this._points(crisp, V);
  };

  /* ---------------- canvas-2D fallback (same photon list, CPU projection) ---------------- */
  var SPR = {}, SPRN = 0, SHADE = null;
  function sprite(r8, g8, b8) {
    var r = r8 >> 3, g = g8 >> 3, b = b8 >> 3, key = (r << 10) | (g << 5) | b;
    var sp = SPR[key];
    if (sp) return sp;
    if (SPRN > 700) { SPR = {}; SPRN = 0; }
    sp = document.createElement('canvas');
    sp.width = sp.height = 32;
    var x = sp.getContext('2d');
    var cs = (r << 3) + 4 + ',' + ((g << 3) + 4) + ',' + ((b << 3) + 4);
    var gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(' + cs + ',1)');
    gr.addColorStop(0.28, 'rgba(' + cs + ',0.73)');
    gr.addColorStop(0.6, 'rgba(' + cs + ',0.22)');
    gr.addColorStop(1, 'rgba(' + cs + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    SPR[key] = sp; SPRN++;
    return sp;
  }
  function shadeSprite() {
    if (SHADE) return SHADE;
    SHADE = document.createElement('canvas');
    SHADE.width = 64; SHADE.height = 32;
    var x = SHADE.getContext('2d');
    x.setTransform(2, 0, 0, 1, 0, 0);
    var gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(5,9,14,0.85)'); gr.addColorStop(0.6, 'rgba(5,9,14,0.6)'); gr.addColorStop(1, 'rgba(5,9,14,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    return SHADE;
  }
  function draw2D(P, buf, V) {
    var d = buf.d, m = V.m;
    P.globalCompositeOperation = 'lighter';
    for (var i = 0; i < buf.n; i++) {
      var o = i * 8, x = d[o], y = d[o + 1], z = d[o + 2];
      var vx = m[0] * x + m[3] * y + m[6] * z, vy = m[1] * x + m[4] * y + m[7] * z, vz = m[2] * x + m[5] * y + m[8] * z;
      var zc = Math.max(1, V.D - vz), k = V.F / zc;
      var fog = clamp(1 - (zc - V.D) / V.fog * 0.55, 0.3, 1.15);
      var r = d[o + 7] * k, a = d[o + 6] * fog * Math.min(1, r * 2 * V.dpr / 1.6);
      if (a <= 0.01) continue;
      P.globalAlpha = a > 1 ? 1 : a;
      P.drawImage(sprite(d[o + 3] * 255, d[o + 4] * 255, d[o + 5] * 255), V.cx + vx * k - r, V.cy - vy * k - r, r * 2, r * 2);
    }
    P.globalAlpha = 1;
    P.globalCompositeOperation = 'source-over';
  }

  /* ---------------- Swarm ---------------- */
  function Swarm(canvas, opts) {
    this.opts = opts || {};
    this.canvas = canvas;
    this.parts = [];
    this.sats = SATS.map(function (s, i) { return { id: s.id, key: s.key, ang: (i / SATS.length) * Math.PI * 2, lock: 0, lockT: 0 }; });
    this.conf = 0.12; this.confT = 0.12;
    this.state = 'SCANNING';
    this.scatter = 0;
    this.pulses = [];
    this.packets = [];
    this.nodes = [];
    this.flash = null; this.flashT = 0;
    this.reduced = false;
    this.attr = null;
    this.label = 'GOLD (SIM)';
    this._built = -1;
    this.trail = null;
    this._spin = 0; this._t = 0; this._tumT = 0;
    this.ringA = 0; this.ringB = 0.4; this.ringC = 1.1;
    this.bristle = 0; this.bristleT = 0;
    this._packAcc = {};
    this.merge = 0; this.mergeT = 0;
    this.eyeAng = -Math.PI / 2; this.eyeLane = 4; this.eyeLock = 0; this.eyeWarn = 0;
    this.dim = 0; this.ripples = []; this.laneGlow = [0, 0, 0, 0, 0]; this.glyphs = [];
    this.haloSig = 0; this.haloSigCol = SIGNAL; this.bias = { bear: 0, bull: 0 };
    this.notch = null; this.crack = 0;
    this.step = 0; this.stepV = 0; this.stepFlash = 0;
    this.energy = 0; this.energyT = 0;
    this._pulseT = 0; this._haloRot = 0;
    this.ringP = []; this.haloP = []; this.nucP = []; this.coreP = [];
    this._cap = 220;
    this.bufT = new Buf(2048); this.bufC = new Buf(2048);
    this.cam = { yaw: 0, pitch: 0, yawV: 0, pitchV: 0, zoom: 1, zoomT: 1, drag: false, reset: 0 };
    this.fps = 0; this._fpsAcc = 0; this._fpsN = 0; this.cpuMs = 0;
    this.gl = null; this.mode = '2d';
    this._initGL();
    this._initInput();
  }

  Swarm.TF_COLORS = TFC;
  Swarm.STEP_ORBIT = STEP_ORBIT;
  Swarm.STEP_RING = STEP_RING;
  Swarm.SIGNAL = SIGNAL;
  Swarm.PEARL = PEARL;

  Swarm.prototype._initGL = function () {
    var want = !this.opts.force2d && !/[?&]nogl\b/.test(global.location ? global.location.search : '');
    if (!want) return;
    try {
      var c = document.createElement('canvas');
      c.className = 'swarm3d';
      c.setAttribute('aria-hidden', 'true');
      this.gl = new GLR(c);
      this.glCanvas = c;
      this.canvas.parentNode.insertBefore(c, this.canvas);
      this.canvas.classList.add('overlay3d');
      this.mode = 'webgl';
      var self = this;
      c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self._dropGL(); });
    } catch (e) { this.gl = null; this.mode = '2d'; }
  };
  Swarm.prototype._dropGL = function () {
    if (this.glCanvas && this.glCanvas.parentNode) this.glCanvas.parentNode.removeChild(this.glCanvas);
    this.gl = null; this.glCanvas = null; this.mode = '2d';
    this.canvas.classList.remove('overlay3d');
  };

  Swarm.prototype._initInput = function () {
    var c = this.canvas, cam = this.cam, self = this, ptrs = {}, last = null, pinch = 0;
    c.style.touchAction = 'pan-y';
    c.style.cursor = 'grab';
    function count() { return Object.keys(ptrs).length; }
    c.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { c.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      cam.drag = true; c.style.cursor = 'grabbing';
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (count() === 2) { var k = Object.keys(ptrs); pinch = Math.hypot(ptrs[k[0]].x - ptrs[k[1]].x, ptrs[k[0]].y - ptrs[k[1]].y); }
    });
    c.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() >= 2) {
        var k = Object.keys(ptrs);
        var dd = Math.hypot(ptrs[k[0]].x - ptrs[k[1]].x, ptrs[k[0]].y - ptrs[k[1]].y);
        if (pinch > 0) cam.zoomT = clamp(cam.zoomT * dd / pinch, 0.8, 1.35);
        pinch = dd; return;
      }
      var now = performance.now(), dt = Math.max(8, now - last.t) / 1000;
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      cam.yaw += dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.005, -0.95, 0.75);
      cam.yawV = dx * 0.006 / dt; cam.pitchV = dy * 0.005 / dt;
      last = { x: e.clientX, y: e.clientY, t: now };
    });
    function up(e) {
      delete ptrs[e.pointerId];
      if (!count()) { cam.drag = false; c.style.cursor = 'grab'; pinch = 0; }
      if (self.reduced) { cam.yawV = 0; cam.pitchV = 0; }
    }
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', function () { cam.reset = 1; cam.yawV = 0; cam.pitchV = 0; cam.zoomT = 1; });
    c.addEventListener('wheel', function (e) {
      var z = clamp(cam.zoomT * Math.exp(-e.deltaY * 0.0012), 0.8, 1.35);
      if (Math.abs(z - cam.zoomT) > 1e-4) { cam.zoomT = z; e.preventDefault(); }
    }, { passive: false });
  };

  /* debug / capture hook: rotate the camera programmatically (same path as a drag) */
  Swarm.prototype.orbitBy = function (dyaw, dpitch) {
    this.cam.yaw += dyaw; this.cam.pitch = clamp(this.cam.pitch + (dpitch || 0), -0.95, 0.75);
  };

  Swarm.prototype.setCount = function (n) {
    n = n | 0;
    if (n === this._built) return;
    this._built = n;
    this.parts = [];
    for (var i = 0; i < n; i++) {
      var stream = i % 7 === 0;
      this.parts.push({
        ang: Math.random() * Math.PI * 2,
        rj: (Math.random() - 0.5) * 0.07,
        zj: (Math.random() - 0.5) * 2,
        hj: (Math.random() - 0.5) * 0.06,
        speed: 0.6 + Math.random() * 1.2,
        seed: Math.random() * 20,
        rank: (i * 0.6180339887) % 1,
        stream: stream,
        t: Math.random(),
        lane: 4,
        col: TFC[4].slice(),
        jit: [(Math.random() - 0.5) * 46, (Math.random() - 0.5) * 46, (Math.random() - 0.5) * 46],
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        size: stream ? 1.6 + Math.random() * 1.2 : 1.0 + Math.random() * 1.4
      });
    }
    var phone = n <= 170, red = n <= 60;
    var per = red ? 2 : phone ? 3 : 4;
    var segs = [12, 16, 20];
    this.ringP = segs.map(function (sg) {
      var band = [], slot = Math.PI * 2 / sg;
      for (var si = 0; si < sg; si++) for (var k = 0; k < per; k++) {
        band.push({ a: si * slot + (k / per) * slot * 0.6 + (Math.random() - 0.5) * 0.03, rj: (Math.random() - 0.5) * 2,
          fly: 14 + (si % 4) * 12 + Math.random() * 30, tw: (Math.random() - 0.5) * 2, ph: Math.random() * 6, s: 0.8 + Math.random() * 0.45 });
      }
      return band;
    });
    var hn = red ? 70 : phone ? 110 : 220;
    this.haloP = [];
    for (var hi = 0; hi < hn; hi++) {
      var dv = fib(hi, hn);
      this.haloP.push({ d: dv, rj: (Math.random() - 0.5) * 2, ph: Math.random() * 6, h: (hi * 0.6180339887) % 1, s: 0.7 + Math.random() * 0.5 });
    }
    var cn = red ? 40 : phone ? 70 : 140;
    this.nucP = [];
    for (var ci = 0; ci < cn; ci++) this.nucP.push({ d: fib(ci, cn), r: 0.85 + Math.random() * 0.3, s: 0.7 + Math.random() * 0.7, wh: Math.random() * 0.35 });
    var dn = red ? 16 : phone ? 30 : 60;
    this.coreP = [];
    for (var di = 0; di < dn; di++) {
      var dd = fib(di, dn), rr = Math.pow(Math.random(), 0.7) * 0.42;
      this.coreP.push({ d: dd, r: rr, ph: Math.random() * 6, s: 0.8 + Math.random() * 0.8 });
    }
    this._cap = phone ? 90 : 220;
    this._phone = phone;
    this._placed = false;
  };

  Swarm.prototype.calm = function () {
    this.scatter = 0; this.flashT = 0; this.flash = null;
    this.pulses = []; this.packets = []; this._packAcc = {};
    this.ripples = []; this.dim = 0; this.eyeLock = 0; this.eyeWarn = 0; this.crack = 0;
    this.merge = this.mergeT; this.haloSig = 0; this._snap = true;
    if (this.gl) this.gl.clearTrail();
    if (this.trail) {
      var c = this.trail.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.trail.width, this.trail.height);
    }
  };

  Swarm.prototype.burst = function (kind) {
    if (kind === 'invalid') { this.scatter = 1; this.flash = 'invalid'; }
    else if (kind === 'win') this.flash = 'win';
    else if (kind === 'loss') this.flash = 'loss';
    else this.flash = 'entry';
    this.flashT = 1.1;
    var col = kind === 'loss' || kind === 'invalid' ? RED : kind === 'win' ? GOLD : SIGNAL;
    this.pulses.push({ r: 16, life: 1, color: col, width: 3 });
    this.pulses.push({ r: 8, life: 1, color: WHITE, width: 1.5 });
    if (kind === 'invalid') {
      this.parts.forEach(function (p) {
        var d = fib((Math.random() * 997) | 0, 997), sp = 80 + Math.random() * 220;
        p.vx = d[0] * sp; p.vy = d[1] * sp; p.vz = d[2] * sp;
      });
      this.packets.forEach(function (pk) { pk.dir = -1; });
    }
  };

  /* Trade fired: the overseer takes the signal colour if it agrees, amber if its net bias contradicts. */
  Swarm.prototype.fire = function (agree) {
    this.haloSig = 1.6;
    this.haloSigCol = agree ? SIGNAL : WARN;
    if (!agree) { this.eyeWarn = Math.max(this.eyeWarn, 1.6); this.crack = Math.max(this.crack, 1.2); }
  };

  /* A watcher finding. dir: 'bear' confirms the short, 'bull' contradicts it. */
  Swarm.prototype.vsa = function (f) {
    var k = TFS.indexOf(f.tf);
    if (k < 0) return;
    var s = clamp(f.strength | 0, 1, 3);
    var ed = this._eyeDir();
    if (f.dir === 'bear') {
      this.ripples.push({ t: 0, s: s, k: k, seed: Math.random() * 6 });
      if (this.ripples.length > 6) this.ripples.shift();
      this.laneGlow[k] = Math.max(this.laneGlow[k], 0.45 + s * 0.2);
      this.glyphs.push({ d: ed, life: 1, dir: 'bear', k: k });
      this.eyeLane = k;
    } else if (f.dir === 'bull') {
      this.eyeLane = k;
      this.eyeLock = 1.4 + s * 0.6;
      this.eyeWarn = Math.max(this.eyeWarn, 1.2 + s * 0.4);
      this.crack = Math.max(this.crack, 0.8 + s * 0.3);
      if (s >= 2) this.dim = 1;
      this.glyphs.push({ d: ed, life: 1, dir: 'bull', k: k });
    }
    if (this.glyphs.length > 14) this.glyphs.shift();
  };

  Swarm.prototype._eyeDir = function () {
    var lat = 0.42 * Math.sin(this.eyeAng * 0.7);
    return [Math.cos(this.eyeAng) * Math.cos(lat), Math.sin(lat), Math.sin(this.eyeAng) * Math.cos(lat)];
  };

  Swarm.prototype._ensureTrail = function (w, h, dpr) {
    var tw = Math.round(w * dpr), th = Math.round(h * dpr);
    if (!this.trail || this.trail.width !== tw || this.trail.height !== th) {
      this.trail = document.createElement('canvas');
      this.trail.width = tw; this.trail.height = th;
    }
  };

  /* evidence path in 3D: from the ladder side, at depth, arcing forward and into the core */
  Swarm.prototype._curve3 = function (node, i, R, h) {
    var y = clamp(-(node.y - h / 2) * 0.8, -R * 0.42, R * 0.42);
    var a = [-R * 0.86, y, -R * 0.38];
    var b = [-R * 0.42, y * 0.45 + (i - 2) * 10, R * 0.48];
    return [a, b, [0, 0, 0]];
  };

  Swarm.prototype._tickPackets = function (dt) {
    var nodes = this.nodes;
    if (this.reduced) {
      this.packets = [];
      for (var ri = 0; ri < nodes.length; ri++) {
        var rn = nodes[ri].hot ? 14 : nodes[ri].lit ? 10 : 4;
        for (var rk = 0; rk < rn; rk++) this.packets.push({ i: ri, t: (rk + 0.5) / rn, dir: 1, hot: !!nodes[ri].hot, lit: !!nodes[ri].lit, ox: 0, oy: 0, oz: 0, sj: 1 });
      }
      return;
    }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var every = (n.hot ? 0.035 : n.lit ? 0.07 : 0.3) / (1 + 2 * this.energy);
      this._packAcc[n.tf] = (this._packAcc[n.tf] || 0) + dt;
      while (this._packAcc[n.tf] >= every && this.packets.length < this._cap) {
        this._packAcc[n.tf] -= every;
        var sp = n.hot ? 9 : n.lit ? 6 : 3;
        this.packets.push({ i: i, t: 0, dir: this.scatter > 0.35 ? -1 : 1, hot: !!n.hot, lit: !!n.lit,
          ox: (Math.random() - 0.5) * sp, oy: (Math.random() - 0.5) * sp, oz: (Math.random() - 0.5) * sp,
          sj: 0.85 + Math.random() * 0.3, core: Math.random() < 0.4 });
      }
      if (this._packAcc[n.tf] > every) this._packAcc[n.tf] = 0;
    }
    for (var k = this.packets.length - 1; k >= 0; k--) {
      var pk = this.packets[k];
      if (this.scatter > 0.35) pk.dir = -1;
      var spd = (pk.hot ? 1.05 : pk.lit ? 0.62 : 0.24) * (pk.sj || 1) * (1 + 0.8 * this.energy);
      pk.t += dt * pk.dir * spd;
      if (pk.t > 1.02 || pk.t < -0.02) this.packets.splice(k, 1);
    }
  };

  /* camera: returns the view (rotation matrix column-major, distances, centre) */
  Swarm.prototype._camera = function (dt, w, h, R) {
    var cam = this.cam;
    if (!cam.drag && !this.reduced) {
      cam.yaw += cam.yawV * dt; cam.pitch = clamp(cam.pitch + cam.pitchV * dt, -0.95, 0.75);
      var damp = Math.exp(-dt * 2.6);
      cam.yawV *= damp; cam.pitchV *= damp;
    }
    if (cam.reset > 0) {
      var kk = Math.min(1, dt * 5);
      cam.yaw += (0 - cam.yaw) * kk; cam.pitch += (0 - cam.pitch) * kk;
      cam.reset = Math.abs(cam.yaw) + Math.abs(cam.pitch) > 0.002 ? 1 : 0;
    }
    cam.zoom += (cam.zoomT - cam.zoom) * Math.min(1, dt * 6);
    var drift = this.reduced ? 0 : 1;
    var yaw = 0.32 + cam.yaw + drift * 0.07 * Math.sin(this._t * 0.11);
    var pitch = 0.4 + cam.pitch + drift * 0.035 * Math.sin(this._t * 0.07 + 1);
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    /* M = Rx(pitch) * Ry(yaw), stored column-major for GLSL */
    var m00 = cy, m01 = 0, m02 = sy;
    var m10 = sp * sy, m11 = cp, m12 = -sp * cy;
    var m20 = -cp * sy, m21 = sp, m22 = cp * cy;
    var F = R * 1.9 * 0.97;
    return {
      m: new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]),
      D: R * 1.9 / cam.zoom, F: F, fog: R * 1.1, w: w, h: h, cx: w / 2, cy: h / 2, dpr: 1
    };
  };
  function project(V, x, y, z) {
    var m = V.m;
    var vx = m[0] * x + m[3] * y + m[6] * z, vy = m[1] * x + m[4] * y + m[7] * z, vz = m[2] * x + m[5] * y + m[8] * z;
    var zc = Math.max(1, V.D - vz), k = V.F / zc;
    return [V.cx + vx * k, V.cy - vy * k, k, zc];
  }

  Swarm.prototype.draw = function (dt, model) {
    var t0 = performance.now();
    dt = Math.max(0.001, Math.min(0.033, dt || 0.016));
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 1) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
    var canvas = this.canvas;
    var w = Math.max(10, canvas.clientWidth || canvas.getBoundingClientRect().width);
    var h = Math.max(10, canvas.clientHeight || canvas.getBoundingClientRect().height);
    var phoneW = w < 560;
    var dpr = Math.min(phoneW ? 1.75 : 2, global.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      this._placed = false; this.trail = null;
    }
    if (this.glCanvas) {
      var gc = this.glCanvas;
      gc.style.left = (canvas.offsetLeft + canvas.clientLeft) + 'px';
      gc.style.top = (canvas.offsetTop + canvas.clientTop) + 'px';
      gc.style.width = w + 'px'; gc.style.height = h + 'px';
      if (gc.width !== Math.round(w * dpr) || gc.height !== Math.round(h * dpr)) { gc.width = Math.round(w * dpr); gc.height = Math.round(h * dpr); }
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (model) {
      this.state = model.state || this.state;
      this.confT = model.conf == null ? this.confT : model.conf;
      this.reduced = !!model.reduced;
      this.attr = model.attr || null;
      this.label = model.label || this.label;
      this.nodes = model.nodes || this.nodes;
      this.bristleT = model.bristle || 0;
      this.mergeT = model.merged ? 1 : 0;
      if (model.bias) this.bias = model.bias;
      this.notchOn = !!model.vsaWarn;
      var ns = clamp(model.step | 0, 0, 7);
      if (ns > this.step) this.stepFlash = 1;
      this.step = ns;
      this.energyT = clamp((model.energy || 0) / 100, 0, 1);
      var locks = model.locks || {};
      this.sats.forEach(function (s) { s.lock = locks[s.key] ? 1 : 0; });
      this.setCount(this.reduced ? 60 : (phoneW ? 170 : 480));
    }
    var R = Math.min(w, h * 1.18);
    this._t += this.reduced ? 0 : dt;
    this.conf += (this.confT - this.conf) * Math.min(1, dt * 3);
    this.bristle += (this.bristleT - this.bristle) * Math.min(1, dt * (this.reduced ? 1 : 4));
    if (this.reduced) this.merge = this.mergeT;
    else this.merge = this.mergeT > this.merge ? Math.min(this.mergeT, this.merge + dt / 1.25) : Math.max(this.mergeT, this.merge - dt / 1.1);
    var mE = ease(this.merge);
    if (this.scatter > 0) this.scatter = Math.max(0, this.scatter - dt * 0.32);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.haloSig > 0) this.haloSig = Math.max(0, this.haloSig - dt);
    if (this.eyeLock > 0) this.eyeLock = Math.max(0, this.eyeLock - dt);
    if (this.eyeWarn > 0) this.eyeWarn = Math.max(0, this.eyeWarn - dt);
    if (this.crack > 0) this.crack = Math.max(0, this.crack - dt);
    if (this.dim > 0) this.dim = Math.max(0, this.dim - dt * 0.9);
    for (var lg = 0; lg < 5; lg++) this.laneGlow[lg] = Math.max(0, this.laneGlow[lg] - dt * 0.8);
    if (this.reduced) this.stepV = this.step;
    else this.stepV += (this.step - this.stepV) * Math.min(1, dt * 4.2);
    if (this.stepFlash > 0) this.stepFlash = Math.max(0, this.stepFlash - dt * 1.4);
    this.energy += (this.energyT - this.energy) * Math.min(1, dt * (this.reduced ? 10 : 2.5));
    var E = this.reduced ? 0 : this.energy;
    var sv = clamp(this.stepV, 0, 7), s0 = Math.floor(sv), s1 = Math.min(7, s0 + 1), sf = sv - s0;
    var stepOrbit = lerp(STEP_ORBIT[s0], STEP_ORBIT[s1], sf);
    var stepRing = lerp(STEP_RING[s0], STEP_RING[s1], sf);
    var tight = clamp(sv / 7, 0, 1);
    var spin = this.reduced ? 0 : dt * lerp(0.35, 2.05, tight) * (1 + 2 * E);
    this.ringA += spin; this.ringB -= spin * 0.82; this.ringC += spin * 0.55;
    this._spin += this.reduced ? 0 : dt * (0.15 + tight * 0.85) * (1 + E);
    this._pulseT += this.reduced ? 0 : dt * (2.5 + 9 * E);
    if (this.scatter > 0 && !this.reduced) this._tumT += dt * 2.4;
    if (!this.reduced && this.eyeLock <= 0) this.eyeAng += dt * 0.32;
    var T = this._spin;
    var phone = !!this._phone;

    /* lane weights: base 1, confirmed timeframe +2, hot +1 */
    var nodes = this.nodes;
    var wts = [1, 1, 1, 1, 1], hotK = -1, hotI = -1;
    for (var ni0 = 0; ni0 < nodes.length; ni0++) {
      var k0 = TFS.indexOf(nodes[ni0].tf);
      if (k0 < 0) continue;
      if (nodes[ni0].lit) wts[k0] += 2;
      if (nodes[ni0].hot) { wts[k0] += 1; hotK = k0; hotI = ni0; }
    }
    var wsum = wts.reduce(function (a, b) { return a + b; }, 0);
    var cum = []; var acc = 0;
    for (var c0 = 0; c0 < 5; c0++) { acc += wts[c0] / wsum; cum.push(acc); }

    var baseCore = hotK >= 0 ? TFC[hotK] : mix(PEARL, TFC[1], 0.25);
    var coreCol = mix(baseCore, SIGNAL, mE);
    if (this.flashT > 0) {
      var fc = this.flash === 'invalid' || this.flash === 'loss' ? RED : this.flash === 'win' ? GOLD : SIGNAL;
      coreCol = mix(coreCol, fc, Math.min(1, this.flashT));
    }

    /* lane planes: inclination shrinks toward the shared disc with each step (flat at fire); scatter tumbles them */
    var flat = Math.max(tight * 0.85, mE);
    var planes = [];
    for (var pl = 0; pl < 5; pl++) {
      var inc = INCL[pl] * DEG * (1 - flat);
      var om = NODE[pl] * DEG + (this.reduced ? 0 : this._t * 0.06 * (pl % 2 ? -1 : 1)) * (1 - flat);
      if (this.scatter > 0.01) {
        inc += this.scatter * TUMB[pl] * 1.1 * Math.sin(this._tumT + pl * 1.7);
        om += this.scatter * TUMB[pl] * this._tumT * 0.8;
      }
      planes.push(planeBasis(inc, om));
    }

    var haloR = R * 0.45;
    var orbitR = R * stepOrbit;
    if (this.scatter > 0) orbitR = lerp(orbitR, R * 0.5, this.scatter);
    var brVis = this.scatter > 0.12 ? 0 : Math.min(1, this.bristle / 0.34);
    var coreR = Math.max(26, Math.min(44, R * 0.1));
    var singleR = Math.max(orbitR * 0.95, coreR + 18);
    var dimA = 1 - 0.3 * this.dim;
    var BT = this.bufT, BC = this.bufC;
    BT.n = 0; BC.n = 0;
    var tmp = [0, 0, 0], tmp2 = [0, 0, 0];

    /* ---- swarm photons on their lane planes ---- */
    var parts = this.parts;
    var nAct = this.reduced ? parts.length : Math.round(parts.length * (0.62 + 0.38 * E));
    var hasAttr = hotI >= 0 && !!nodes[hotI];
    var hotCurve = hasAttr ? this._curve3(nodes[hotI], hotI, R, h) : null;
    for (var i = 0; i < nAct; i++) {
      var p = parts[i];
      var lane = 0;
      while (lane < 4 && p.rank > cum[lane]) lane++;
      p.lane = lane;
      var target = mix(jitterCol(TFC[lane], p.jit), jitterCol(SIGNAL, [p.jit[0] * 0.3, p.jit[1] * 0.3, p.jit[2] * 0.3]), mE);
      if (p.stream && hotK >= 0 && mE < 0.5) target = jitterCol(TFC[hotK], p.jit);
      var cr = this.reduced || this._snap ? 1 : Math.min(1, dt * 2.6);
      p.col[0] += (target[0] - p.col[0]) * cr; p.col[1] += (target[1] - p.col[1]) * cr; p.col[2] += (target[2] - p.col[2]) * cr;

      var laneR = orbitR * (LANE[lane] + p.rj * (1 - tight * 0.5));
      /* merged: one broad flat disc (not a thin ring) from just outside the nucleus outward */
      var rad = lerp(laneR, singleR * 0.92 + p.rank * orbitR * 1.05 + p.rj * orbitR * 0.35, mE);
      var B = planes[lane];
      if (!this.reduced && this.scatter > 0.08) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vx *= 0.992; p.vy *= 0.992; p.vz *= 0.992;
        var od = Math.hypot(p.x, p.y, p.z) || 1;
        if (od < haloR * 1.05) { var ps = this.scatter * 420 * dt / od; p.vx += p.x * ps; p.vy += p.y * ps; p.vz += p.z * ps; }
      } else if (!this.reduced && p.stream && hotCurve && brVis < 0.25 && mE < 0.6) {
        p.t += dt * lerp(0.35, 0.85, tight) * (0.55 + (p.seed % 1));
        if (p.t > 1) p.t -= 1;
        qb(hotCurve[2], hotCurve[1], hotCurve[0], p.t * 0.85, tmp);
        var perp = Math.sin(p.seed + p.t * 12) * (8 + (1 - tight) * 14);
        p.x = tmp[0]; p.y = tmp[1] + perp; p.z = tmp[2] + Math.cos(p.seed + p.t * 9) * perp;
      } else {
        if (!this.reduced) {
          var laneSpeed = 1 + (4 - lane) * -0.12;
          p.ang += dt * p.speed * laneSpeed * lerp(0.7, 2.5, Math.max(tight, mE)) * (1 + 1.6 * E) * (lane % 2 && mE < 0.5 ? -1 : 1);
        }
        var wob = this.reduced ? 0 : ((1 - tight) * 10 + E * 12) * Math.sin(this._spin * 2 + p.seed) + (E > 0.05 ? (Math.random() - 0.5) * E * 5 : 0);
        onPlane(B, p.ang, rad + wob, tmp);
        /* a little thickness off the plane, thinner as it aligns */
        var th = p.hj * orbitR * (1 - flat * 0.8);
        tmp[0] += B.nx * th; tmp[1] += B.ny * th; tmp[2] += B.nz * th;
        if (brVis > 0.02) {
          /* bristle: spikes radiate from the nucleus in all directions */
          var spike = brVis * (20 + ((i * 17) % 11) * 9);
          var bx = tmp[0] + B.nx * p.zj * rad * brVis, by = tmp[1] + B.ny * p.zj * rad * brVis, bz = tmp[2] + B.nz * p.zj * rad * brVis;
          var bl = Math.hypot(bx, by, bz) || 1, br = (rad + spike) / bl;
          tmp[0] = bx * br; tmp[1] = by * br; tmp[2] = bz * br;
        }
        if (this.reduced || !this._placed) { p.x = tmp[0]; p.y = tmp[1]; p.z = tmp[2]; }
        else {
          var kk = Math.min(1, dt * lerp(3.5, 9, tight));
          p.x += (tmp[0] - p.x) * kk; p.y += (tmp[1] - p.y) * kk; p.z += (tmp[2] - p.z) * kk;
        }
      }
      var lgB = this.laneGlow[lane] || 0;
      BT.push(p.x, p.y, p.z, p.col, (p.stream ? 0.95 : 0.8) * (1 - 0.3 * mE) * dimA * (1 + lgB * 0.6), p.size * (2.6 + lgB * 1.4));
      if (brVis > 0.08 && !(i % 2)) {
        var bc = mix(p.col, GOLD, 0.5);
        for (var bk = 1; bk <= 3; bk++) {
          var bt0 = 0.22 + bk * 0.19;
          BT.push(p.x * bt0, p.y * bt0, p.z * bt0, bc, (0.2 + brVis * 0.5) * dimA, 2.4);
        }
      }
    }
    this._placed = true;
    this._snap = false;
    this._tickPackets(dt);

    /* ---- inward-collapsing spherical shells (confirming VSA findings), drawn trail-free ---- */
    for (var ri = this.ripples.length - 1; ri >= 0; ri--) {
      var rp = this.ripples[ri];
      rp.t += dt / (this.reduced ? 0.4 : 1.1);
      if (rp.t >= 1) { this.ripples.splice(ri, 1); continue; }
      var rrr = lerp(haloR, R * 0.07, ease(rp.t));
      var rpa = Math.min(1, (1 - rp.t * 0.8) * (0.6 + rp.s * 0.2));
      var rcol = mix(PEARL, TFC[rp.k], 0.7);
      var rn = phone ? 80 : 170;
      var cs = Math.cos(rp.seed), sn = Math.sin(rp.seed);
      for (var rj = 0; rj < rn; rj++) {
        var fd = fib(rj, rn);
        BC.push((fd[0] * cs - fd[2] * sn) * rrr, fd[1] * rrr, (fd[0] * sn + fd[2] * cs) * rrr, rcol, rpa, 4.4 + rp.s * 1.3);
        if (!(rj % 3)) BC.push((fd[0] * cs - fd[2] * sn) * rrr, fd[1] * rrr, (fd[0] * sn + fd[2] * cs) * rrr, WHITE, rpa * 0.7, 1.8);
      }
    }
    /* burst pulses: expanding spherical shells */
    for (var ui = this.pulses.length - 1; ui >= 0; ui--) {
      var pulse = this.pulses[ui];
      if (this.reduced) { this.pulses.splice(ui, 1); continue; }
      pulse.r += dt * 220; pulse.life -= dt * 0.55;
      if (pulse.life <= 0) { this.pulses.splice(ui, 1); continue; }
      var pn = phone ? 50 : 100;
      for (var pj = 0; pj < pn; pj++) {
        var pd = fib(pj, pn);
        BC.push(pd[0] * pulse.r, pd[1] * pulse.r, pd[2] * pulse.r, pulse.color, Math.max(0, pulse.life) * 0.8, (pulse.width || 2) * 1.6);
      }
    }

    /* ---- evidence streams arcing in 3D from the ladder side into the core ---- */
    for (var pi = 0; pi < this.packets.length; pi++) {
      var pk = this.packets[pi];
      var nd = nodes[pk.i];
      if (!nd) continue;
      var kp = TFS.indexOf(nd.tf);
      var cv = this._curve3(nd, pk.i, R, h);
      var tt = clamp(pk.t, 0, 1);
      qb(cv[0], cv[1], cv[2], tt, tmp);
      var ofs = (1 - tt * 0.7) + (pk.dir < 0 ? (1 - tt) * 4 : 0);
      var pc = kp >= 0 ? TFC[kp] : PEARL;
      var pa = (pk.hot ? 1 : pk.lit ? 0.9 : 0.72) * dimA * Math.min(1, tt * 8, (1 - tt) * 10 + 0.3);
      var px = tmp[0] + pk.ox * ofs, py = tmp[1] + pk.oy * ofs, pz = tmp[2] + pk.oz * ofs;
      BC.push(px, py, pz, pc, pa, pk.hot ? 5 : pk.lit ? 4.4 : 4.2);
      if (pk.hot && pk.core) BC.push(px, py, pz, WHITE, 0.6 * dimA, 1.8);
    }

    /* ---- photon bands on the tilted lane planes (same radii and spin as before) ---- */
    var ringBase = R * stepRing;
    var ra = this.scatter > 0.15 ? lerp(0.6, 0.35, this.scatter) : lerp(0.45, 0.95, tight);
    ra = Math.min(1, ra + this.stepFlash * 0.35) * dimA;
    var rsz = 3 + tight * 1.4 + this.stepFlash * 1.4;
    var rots = [this.ringA, this.ringB, this.ringC], rk = [0.7, 0.95, 1.2], rfa = [1, 0.85, 0.7];
    for (var rgi = 0; rgi < this.ringP.length; rgi++) {
      var band = this.ringP[rgi], rr0 = ringBase * rk[rgi], PB = planes[BAND_LANE[rgi]];
      for (var bi = 0; bi < band.length; bi++) {
        var bp = band[bi];
        var fly = this.scatter * bp.fly;
        onPlane(PB, rots[rgi] + bp.a, rr0 + bp.rj * (2 + (1 - tight) * 3) + fly, tmp);
        var off = fly * bp.tw * 0.6;
        var tw = this.reduced ? 1 : 0.75 + 0.25 * Math.sin(T * 6 + bp.ph);
        BC.push(tmp[0] + PB.nx * off, tmp[1] + PB.ny * off, tmp[2] + PB.nz * off, coreCol, ra * rfa[rgi] * tw, rsz * bp.s);
      }
    }

    /* ---- overseer: sparse photon sphere, fixed size; amber share = bullish share of VSA weight ---- */
    var haloCol = PEARL;
    if (this.haloSig > 0) haloCol = mix(PEARL, this.haloSigCol, Math.min(1, this.haloSig));
    var bsum = this.bias.bear + this.bias.bull;
    var amberShare = bsum > 0.15 ? this.bias.bull / bsum : 0;
    var hA = 0.55 + 0.3 * Math.min(1, bsum / 3);
    this._haloRot += this.reduced ? 0 : dt * 0.05;
    var hc = Math.cos(this._haloRot), hs = Math.sin(this._haloRot);
    var flick = this.reduced ? 1 : (0.55 + 0.45 * Math.sin(T * 40 + this.crack * 30));
    var ed = this._eyeDir();
    for (var hi = 0; hi < this.haloP.length; hi++) {
      var q = this.haloP[hi];
      var dx = q.d[0] * hc - q.d[2] * hs, dy = q.d[1], dz = q.d[0] * hs + q.d[2] * hc;
      var qr = haloR + q.rj * 8 + (this.reduced ? 0 : Math.sin(T * 1.3 + q.ph) * 2);
      var amb = q.h < amberShare;
      var qc = amb ? WARN : haloCol;
      var qal = hA * (0.6 + 0.4 * Math.sin(T * 2 + q.ph * 3));
      if (this.crack > 0 && dx * ed[0] + dy * ed[1] + dz * ed[2] > 0.93) { qc = WARN; qal = Math.max(qal, Math.min(1, this.crack) * flick); }
      BC.push(dx * qr, dy * qr, dz * qr, qc, qal, q.s * (amb ? 4.2 : 3.6));
    }
    if (this.notchOn) {
      if (this.notch == null) this.notch = ed.slice();
      for (var nk = -3; nk <= 3; nk++) {
        var nr = haloR + nk * 4;
        BC.push(this.notch[0] * nr, this.notch[1] * nr, this.notch[2] * nr, WARN, 0.9 - Math.abs(nk) * 0.1, 4.5);
      }
    } else this.notch = null;
    for (var gi = this.glyphs.length - 1; gi >= 0; gi--) {
      var gph = this.glyphs[gi];
      gph.life -= dt / 9;
      if (gph.life <= 0) { this.glyphs.splice(gi, 1); continue; }
      var gr = haloR + 12;
      BC.push(gph.d[0] * gr, gph.d[1] * gr, gph.d[2] * gr, gph.dir === 'bear' ? TFC[gph.k] : WARN, Math.min(1, gph.life * 1.4), 7);
      BC.push(gph.d[0] * gr, gph.d[1] * gr, gph.d[2] * gr, WHITE, Math.min(0.8, gph.life), 2.4);
    }

    /* ---- the eye: a concentrated cluster on the sphere; gaze / amber tether arc in 3D into the lane ---- */
    var eyeCol = this.eyeWarn > 0 ? mix(PEARL, WARN, Math.min(1, this.eyeWarn * 1.5)) : (this.haloSig > 0 ? haloCol : PEARL);
    var E3 = [ed[0] * haloR, ed[1] * haloR, ed[2] * haloR];
    var gazeR = lerp(orbitR * LANE[this.eyeLane], singleR, mE);
    var L3 = onPlane(planes[this.eyeLane], this.eyeAng, gazeR, [0, 0, 0]);
    var C3 = [(E3[0] + L3[0]) * 0.5 + ed[0] * haloR * 0.25, (E3[1] + L3[1]) * 0.5 + haloR * 0.22, (E3[2] + L3[2]) * 0.5 + ed[2] * haloR * 0.25];
    var tether = this.eyeLock > 0;
    var gn = tether ? (phone ? 16 : 26) : 5;
    var gsp = tether ? 1.3 : 0.35;
    for (var gk = 0; gk < gn; gk++) {
      var gt = this.reduced ? (gk + 0.5) / gn : ((this._t * gsp * 3 + gk / gn) % 1);
      qb(E3, C3, L3, gt, tmp2);
      var gj = tether && !this.reduced ? (Math.random() - 0.5) * 3 : 0;
      BC.push(tmp2[0] + gj, tmp2[1] + gj, tmp2[2], tether ? WARN : eyeCol, tether ? 0.95 : 0.3, tether ? 3.6 : 2.6);
    }
    if (tether) for (var tk = 0; tk < 8; tk++) {
      var ta = tk / 8 * Math.PI * 2 + T * 3;
      BC.push(L3[0] + Math.cos(ta) * 8, L3[1] + Math.sin(ta) * 8, L3[2] + Math.sin(ta + 1) * 4, WARN, 0.85, 3.4);
    }
    BC.push(E3[0], E3[1], E3[2], eyeCol, 0.75, 16);
    BC.push(E3[0], E3[1], E3[2], WHITE, 0.85, 7);
    for (var ek = 0; ek < 9; ek++) {
      var ea = ek / 9 * Math.PI * 2 + T * 2.2, er = 6 + 3 * Math.sin(T * 3 + ek);
      BC.push(E3[0] + Math.cos(ea) * er, E3[1] + Math.sin(ea) * er, E3[2] + Math.sin(ea * 2) * er * 0.6, eyeCol, 0.8, 3.2);
    }

    /* ---- nucleus: spherical shell + dense centre + parallax glow (offset glow layers at different depths) ---- */
    var cp = this.reduced ? 0 : Math.max(0, Math.sin(this._pulseT)) * (1.5 + E * 6);
    var na = this.reduced ? 0.5 : this._t * (0.6 + 1.6 * E + tight);
    var nc = Math.cos(na), nsn = Math.sin(na), tc = Math.cos(0.5), ts = Math.sin(0.5);
    var shellR = coreR + 4 + cp;
    for (var ci = 0; ci < this.nucP.length; ci++) {
      var np = this.nucP[ci];
      var x0 = np.d[0] * nc - np.d[2] * nsn, z0 = np.d[0] * nsn + np.d[2] * nc, y0 = np.d[1];
      var y1 = y0 * tc - z0 * ts, z1 = y0 * ts + z0 * tc;
      var sr = shellR * np.r;
      BC.push(x0 * sr, y1 * sr, z1 * sr, mix(coreCol, WHITE, np.wh * 0.6), (0.38 + 0.3 * E) * dimA, np.s * (2.4 + E));
    }
    for (var di = 0; di < this.coreP.length; di++) {
      var dp = this.coreP[di];
      var dr = coreR * dp.r * (1 + (this.reduced ? 0 : 0.15 * Math.sin(this._pulseT + dp.ph)));
      BC.push(dp.d[0] * dr, dp.d[1] * dr, dp.d[2] * dr, mix(coreCol, WHITE, 0.4), 0.7 * dimA, dp.s * 2.6);
    }
    BC.push(0, 0, -coreR * 0.9, coreCol, (0.18 + 0.08 * E) * dimA, coreR * 2.2);
    BC.push(0, 0, coreR * 0.9, coreCol, (0.14 + 0.06 * E) * dimA, coreR * 1.5);
    BC.push(0, 0, 0, coreCol, (0.24 + 0.1 * E) * dimA, coreR * 1.1);

    /* ---- ladder label anchors on the shared plane (glow only; text goes on the overlay) ---- */
    var outer = coreR + lerp(88, 50, this.conf), inner = coreR + 36;
    var satPos = [];
    this.sats.forEach(function (st) {
      st.lockT += ((st.lock ? 1 : 0) - st.lockT) * Math.min(1, dt * 4);
      if (!this.reduced) st.ang += dt * (st.lock ? 0.7 : 0.28);
      var srad = lerp(outer, inner, st.lockT);
      var sx = Math.cos(st.ang) * srad, sz = Math.sin(st.ang) * srad, sy = 0;
      var hot = st.lockT > 0.45;
      BC.push(sx, sy, sz, hot ? coreCol : PEARL, hot ? 0.95 : 0.6, hot ? 9 : 6);
      satPos.push([st.id, sx, sy, sz]);
    }, this);

    /* ---- render photons ---- */
    var V = this._camera(dt, w, h, R);
    V.dpr = dpr;
    var fade = this.reduced ? 1 : (0.26 - 0.15 * E);
    if (this.gl) {
      try { this.gl.render(this.reduced ? new Buf(1) : BT, BC, V, fade); }
      catch (e) { this._dropGL(); }
      if (this.reduced && this.gl) this.gl._points(BT, V);
      ctx.clearRect(0, 0, w, h);
    }
    if (!this.gl) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#05090e';
      ctx.fillRect(0, 0, w, h);
      if (!this.reduced) {
        this._ensureTrail(w, h, dpr);
        var tctx = this.trail.getContext('2d');
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        tctx.globalCompositeOperation = 'source-over';
        tctx.fillStyle = 'rgba(5, 9, 14, ' + fade.toFixed(3) + ')';
        tctx.fillRect(0, 0, w, h);
        draw2D(tctx, BT, V);
        ctx.drawImage(this.trail, 0, 0, this.trail.width, this.trail.height, 0, 0, w, h);
      } else draw2D(ctx, BT, V);
      draw2D(ctx, BC, V);
    }

    /* ---- crisp overlay text (no glow), anchored to projected 3D points ---- */
    var c0p = project(V, 0, 0, 0);
    var wr = coreR * c0p[2] * 0.95;
    var well = ctx.createRadialGradient(c0p[0], c0p[1], 0, c0p[0], c0p[1], wr);
    well.addColorStop(0, 'rgba(5, 9, 14, 0.86)');
    well.addColorStop(0.55, 'rgba(5, 9, 14, 0.7)');
    well.addColorStop(1, 'rgba(5, 9, 14, 0)');
    ctx.fillStyle = well;
    ctx.fillRect(c0p[0] - wr, c0p[1] - wr, wr * 2, wr * 2);
    var shortMap = { 'SCANNING': 'SCAN', 'ND FOUND': 'ND', 'SETUP': 'SETUP', 'CONFIRMING': 'CONFIRM', 'IN TRADE': 'SHORT', 'TRAILING': 'TRAIL', 'EXIT': 'EXIT' };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + (coreR > 36 ? 15 : 12) + 'px Manrope, system-ui, sans-serif';
    ctx.fillText(shortMap[this.state] || this.state, c0p[0], c0p[1] - 7);
    ctx.font = '600 12px "Geist Mono", ui-monospace, monospace';
    ctx.fillText(Math.round(this.conf * 100) + '%', c0p[0], c0p[1] + 11);
    var shade = shadeSprite();
    ctx.font = '700 10px "Geist Mono", ui-monospace, monospace';
    var placed = [];
    for (var si = 0; si < satPos.length; si++) {
      var sp2 = project(V, satPos[si][1], satPos[si][2], satPos[si][3]);
      /* label sits just outside its anchor, pushed away from the core read-out so the two never overlap */
      var ldx = sp2[0] - c0p[0], ldy = sp2[1] - c0p[1], ll = Math.hypot(ldx, ldy) || 1;
      var lx2 = sp2[0] + ldx / ll * 14, ly2 = sp2[1] + ldy / ll * 12;
      var ex2 = (lx2 - c0p[0]) / 62, ey2 = (ly2 - c0p[1]) / 30, ee = Math.hypot(ex2, ey2);
      if (ee < 1) { var sc = 1 / Math.max(ee, 0.2); lx2 = c0p[0] + (lx2 - c0p[0]) * sc; ly2 = c0p[1] + (ly2 - c0p[1]) * sc; }
      /* keep labels from stacking on each other */
      for (var pq = 0; pq < placed.length; pq++) {
        if (Math.abs(placed[pq][0] - lx2) < 42 && Math.abs(placed[pq][1] - ly2) < 13) ly2 = placed[pq][1] + (ly2 >= placed[pq][1] ? 13 : -13);
      }
      placed.push([lx2, ly2]);
      ctx.drawImage(shade, lx2 - 22, ly2 - 11, 44, 22);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(satPos[si][0], lx2, ly2);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '700 11px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.label, 10, 17);
    ctx.font = '600 11px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#ecebff';
    var mode = this.reduced ? 'MOTION OFF' : this.scatter > 0.15 ? 'PLANES TUMBLING' : mE > 0.5 ? 'ALIGNED · ONE DISC' : 'LANES · ORBITAL PLANES';
    ctx.fillText(mode, 10, 33);
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  global.SwarmLite = Swarm;
})(window);
