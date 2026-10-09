/* Cascade Mountain — HQ orbital decision field.
   A genuine 3D scene made only of light: thousands of GPU photons on tilted orbital lane planes,
   rendered into an HDR (half-float when available) buffer with photon trails, a bloom chain,
   ACES tone mapping, a warm grade, an alpine horizon with reflection, vignette and grain.
   Text never enters the GL pipeline: labels are drawn crisp on the 2D overlay canvas.
   No stroked lines anywhere: every element is made of photons (points / soft streak quads).
   Falls back to SwarmLite (simpler canvas renderer) when WebGL is unavailable. */
(function (global) {
  'use strict';

  var TFS = ['4h', '2h', '30m', '15m', '5m'];
  /* UI colours (as in the legend) and the more saturated "in light" stage colours */
  var TFC = [[140, 154, 255], [63, 184, 255], [47, 220, 203], [214, 140, 255], [255, 143, 168]];
  var STAGE = [[118, 132, 255], [36, 168, 255], [24, 236, 204], [206, 108, 255], [255, 104, 146]];
  var SIGNAL = [109, 255, 158], SIGNAL_L = [70, 255, 140];
  var PEARL = [237, 246, 255], WARN = [255, 204, 51], WHITE = [255, 255, 255];
  var RED = [255, 112, 90], GOLD = [255, 168, 119];
  var LANE = [1.32, 1.14, 0.97, 0.82, 0.68];
  var STEP_ORBIT = [0.300, 0.272, 0.246, 0.222, 0.200, 0.180, 0.162, 0.140];
  var STEP_RING = [0.400, 0.362, 0.328, 0.296, 0.268, 0.243, 0.220, 0.196];
  var INCL = [64, -48, 30, -72, 14], NODE = [0, 72, 150, 222, 300], TUMB = [1.0, -0.8, 1.2, -1.1, 0.9];
  var BAND_LANE = [4, 2, 0];
  var DEG = Math.PI / 180;
  var SATS = [
    { id: 'ND', key: 'nd' }, { id: 'UT', key: 'ut' }, { id: 'CONF', key: 'conf' },
    { id: 'ENTRY', key: 'entry' }, { id: 'STOP', key: 'stop' }, { id: 'TRAIL', key: 'trail' }
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function c01(c) { return [c[0] / 255, c[1] / 255, c[2] / 255]; }
  function fib(i, n) {
    var y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(Math.max(0, 1 - y * y)), a = i * 2.399963229728653;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  }
  function planeBasis(inc, om) {
    var ci = Math.cos(inc), si = Math.sin(inc), co = Math.cos(om), so = Math.sin(om);
    return { u: [co, 0, -so], v: [ci * so, -si, ci * co], n: [si * so, ci, si * co] };
  }
  function onPlane(B, a, r) {
    var c = Math.cos(a) * r, s = Math.sin(a) * r;
    return [B.u[0] * c + B.v[0] * s, B.u[1] * c + B.v[1] * s, B.u[2] * c + B.v[2] * s];
  }
  function qb(a, b, c, t) {
    var u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1], u * u * a[2] + 2 * u * t * b[2] + t * t * c[2]];
  }
  /* deterministic PRNG so the scene is identical run to run (stable captures) */
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* critically damped spring */
  function Spring(x, w) { this.x = x; this.v = 0; this.w = w; }
  Spring.prototype.step = function (target, dt, w) {
    var o = w || this.w;
    var a = -2 * o * this.v - o * o * (this.x - target);
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  };
  Spring.prototype.snap = function (x) { this.x = x; this.v = 0; };

  /* ---------------- shaders ---------------- */
  var HASH = 'float h1(float n){ return fract(sin(n * 12.9898) * 43758.5453); }\n';
  var PVS = [
    'precision highp float;',
    'attribute vec2 aC; attribute vec4 aA; attribute vec4 aB;',
    'uniform mat3 uM; uniform float uD, uF, uR, uFocus, uTime, uStreak, uDpr, uMaxW;',
    'uniform vec2 uRes, uOff;',
    'uniform vec3 uLU[5]; uniform vec3 uLV[5]; uniform vec3 uLN[5]; uniform vec3 uLCol[5];',
    'uniform float uLR[5]; uniform float uLPh[5]; uniform float uLOm[5]; uniform float uLDen[5]; uniform float uLGlow[5];',
    'uniform float uMerge, uSingleR, uDiscW, uThick, uTight, uBristle, uScatter, uScatterR, uE, uDim, uGain;',
    'uniform vec3 uRU[3]; uniform vec3 uRV[3]; uniform vec3 uRN[3]; uniform float uRR[3]; uniform float uRRot[3]; uniform float uROm[3];',
    'uniform vec3 uRCol; uniform float uRA;',
    'uniform vec3 uSA[5]; uniform vec3 uSB[5]; uniform vec3 uSC[5]; uniform vec3 uSCol[5]; uniform float uSPh[5]; uniform float uSDen[5]; uniform float uSSpd[5];',
    'uniform float uHR, uHRot, uHA, uAmber, uCrack; uniform vec3 uHCol, uEye, uWarn;',
    'uniform float uCR, uCPulse, uCRot, uCA; uniform vec3 uCCol;',
    'varying vec4 vC; varying vec3 vQ;',
    HASH,
    'vec3 bez(vec3 a, vec3 b, vec3 c, float t){ float u = 1.0 - t; return u*u*a + 2.0*u*t*b + t*t*c; }',
    'vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c); }',
    'vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, p.y*c - p.z*s, p.y*s + p.z*c); }',
    'vec3 sdir(float s){ float z = h1(s*3.1)*2.0-1.0; float a = h1(s*7.7)*6.2832; float r = sqrt(max(0.0,1.0-z*z)); return vec3(cos(a)*r, z, sin(a)*r); }',
    /* world position of this photon "back" seconds ago; also outputs colour/intensity/size/visibility */
    'vec3 place(float back, out vec3 col, out float inten, out float sz, out float vis){',
    '  float ty = aA.x; float seed = aB.w; sz = aB.z; vis = 1.0; col = vec3(1.0); inten = 1.0;',
    '  vec3 p = vec3(0.0);',
    '  if (ty < 0.5) {',
    '    int L = int(aA.y + 0.5); float sp = aA.w;',
    '    float ang = aA.z + (uLPh[L] - uLOm[L]*back) * sp;',
    '    float lr = uLR[L] * (1.0 + aB.x * (1.0 - uTight*0.45));',
    '    float dr = uSingleR*0.9 + h1(seed*3.7)*uDiscW + aB.x*uLR[L]*0.25;',
    '    float r = mix(lr, dr, uMerge);',
    '    r += ((1.0-uTight)*7.0 + uE*9.0) * sin(uTime*1.7 + seed*6.2832) + uE*4.0*sin(uTime*13.0 + seed*41.0);',
    '    p = uLU[L]*cos(ang)*r + uLV[L]*sin(ang)*r + uLN[L]*(aB.y*uThick*(1.0+aB.x*2.0));',
    '    if (uBristle > 0.01) { float zj = h1(seed*5.3)*2.0-1.0; vec3 q = p + uLN[L]*zj*r*uBristle; float spike = uBristle*(18.0 + h1(seed*11.0)*90.0); p = normalize(q)*(r + spike); }',
    '    p += sdir(seed) * uScatterR * (0.25 + h1(seed*7.1)) * uScatter;',
    '    vis = step(h1(seed*17.3), uLDen[L]);',
    '    col = uLCol[L] * (0.85 + 0.3*h1(seed*2.9)); inten = 0.30 * (1.0 + uLGlow[L]*0.9) * (1.0 - 0.25*uDim);',
    '  } else if (ty < 1.5) {',
    '    int K = int(aA.y + 0.5);',
    '    float ang = aA.z + uRRot[K] - uROm[K]*back;',
    '    float fly = uScatter * (14.0 + h1(seed*9.0)*70.0);',
    '    float r = uRR[K] * (1.0 + aB.x*0.018) + fly;',
    '    p = uRU[K]*cos(ang)*r + uRV[K]*sin(ang)*r + uRN[K]*(fly*aB.y + aB.x*2.0);',
    '    col = uRCol; inten = uRA * (0.7 + 0.3*sin(uTime*5.0 + seed*20.0));',
    '  } else if (ty < 2.5) {',
    '    int K = int(aA.y + 0.5);',
    '    float t = fract((uSPh[K] - back*uSSpd[K]) * aA.w + aA.z);',
    '    vis = step(h1(seed*13.7), uSDen[K]);',
    '    vec3 o = vec3(aB.x, aB.y, aB.x*0.6 - aB.y*0.8) * 0.6 * (1.0 - t*0.8) * (1.0 + uScatter*3.0*(1.0-t));',
    '    p = bez(uSA[K], uSB[K], uSC[K], t) + o;',
    '    col = uSCol[K]; inten = 0.42 * smoothstep(0.0, 0.07, t) * (0.35 + 0.65*smoothstep(1.0, 0.82, t)) * (1.0 - 0.3*uDim);',
    '  } else if (ty < 3.5) {',
    '    vec3 d = normalize(vec3(aA.z, aA.w, aB.x));',
    '    d = rotY(d, uHRot - back*0.05);',
    '    float r = uHR * (1.0 + aB.y*0.035) + sin(uTime*1.3 + seed*9.0)*1.5;',
    '    p = d * r;',
    '    bool amb = h1(seed*4.1) < uAmber;',
    '    col = amb ? uWarn : uHCol; inten = uHA * (0.55 + 0.45*sin(uTime*2.0 + seed*23.0)) * (amb ? 1.25 : 1.0);',
    '    if (uCrack > 0.0 && dot(d, uEye) > 0.92) { col = uWarn; inten = max(inten, min(1.0, uCrack) * (0.6 + 0.4*sin(uTime*40.0 + seed*30.0)) * 1.4); }',
    '  } else if (ty < 4.5) {',
    '    vec3 d = normalize(vec3(aA.z, aA.w, aB.x));',
    '    d = rotX(rotY(d, uCRot - back*0.8), 0.5);',
    '    p = d * uCR * (0.82 + 0.36*h1(seed*2.3)) * (1.0 + uCPulse);',
    '    col = mix(uCCol, vec3(1.0), 0.25 + 0.4*h1(seed*5.0)); inten = 0.32 * uCA;',
    '  } else if (ty < 5.5) {',
    '    vec3 d = normalize(vec3(aA.z, aA.w, aB.x));',
    '    float rr = pow(h1(seed*3.1), 0.8) * 0.5;',
    '    p = rotY(d, uCRot*0.6) * uCR * rr * (1.0 + 0.12*sin(uTime*3.0 + seed*7.0) + uCPulse*0.5);',
    '    col = mix(uCCol, vec3(1.0), 0.72); inten = 0.55 * uCA;',
    '  } else {',
    '    vec3 d = normalize(vec3(aA.z, aA.w, aB.x));',
    '    p = rotY(d, uTime*0.05) * uCR * (0.5 + 2.6*h1(seed*2.3));',
    '    col = mix(uCCol, vec3(0.75, 0.88, 1.0), 0.5); inten = 0.012 * uCA;',
    '  }',
    '  return p;',
    '}',
    'vec3 proj(vec3 p){ vec3 v = uM * p; float zc = uD - v.z; return vec3(v.xy * (uF / max(zc, 1.0)), zc); }',
    'void main(){',
    '  vec3 col; float inten, sz, vis; vec3 c2; float i2, s2, v2;',
    '  vec3 p0 = place(0.0, col, inten, sz, vis);',
    '  vec3 p1 = place(uStreak, c2, i2, s2, v2);',
    '  vec3 s0 = proj(p0), s1 = proj(p1);',
    '  if (vis < 0.5 || s0.z < 30.0 || inten < 0.003) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); vC = vec4(0.0); vQ = vec3(0.0); return; }',
    '  float k = uF / s0.z;',
    '  float w = sz * k * 0.62;',
    /* depth of field (point-size bokeh) and atmospheric depth tint */
    '  float dz = (s0.z - uFocus) / uR;',
    '  float bok = smoothstep(0.42, 1.15, abs(dz));',
    '  w *= 1.0 + 2.4*bok;',
    '  float a = inten * uGain / (1.0 + 2.6*bok);',
    '  float far = clamp(dz, 0.0, 1.0), near = clamp(-dz, 0.0, 1.0);',
    '  col *= mix(vec3(1.0), vec3(0.62, 0.8, 1.12), far) * mix(vec3(1.0), vec3(1.14, 1.0, 0.84), near);',
    '  a *= (1.0 - 0.55*far) * (1.0 + 0.35*near);',
    '  float tw = 0.78 + 0.22*sin(uTime*(2.0 + h1(aB.w*5.0)*5.0) + aB.w*31.0);',
    '  a *= tw;',
    '  w = clamp(w, 0.7, uMaxW);',
    /* velocity-aligned soft streak quad */
    '  vec2 dv = s0.xy - s1.xy; float len = length(dv);',
    '  if (len > 46.0) { dv *= 46.0/len; len = 46.0; }',
    '  vec2 ax = len > 0.05 ? dv/len : vec2(1.0, 0.0); vec2 pe = vec2(-ax.y, ax.x);',
    '  float hl = len * 0.5;',
    '  vec2 c = s0.xy - dv*0.5;',
    '  vec2 pos = c + ax * aC.x * (hl + w) + pe * aC.y * w;',
    '  vQ = vec3(aC.x * (hl + w) / w, aC.y, hl / w);',
    '  a /= (1.0 + hl/w*0.55);',
    '  vC = vec4(col, a);',
    '  gl_Position = vec4((pos + uOff) / (uRes * 0.5), 0.0, 1.0);',
    '}'
  ].join('\n');
  var PFS = [
    'precision mediump float;',
    'varying vec4 vC; varying vec3 vQ;',
    'void main(){',
    '  float d = length(vec2(max(abs(vQ.x) - vQ.z, 0.0), vQ.y));',
    '  if (d > 1.0) discard;',
    '  float f = exp(-d*d*4.2) - 0.015;',
    '  gl_FragColor = vec4(vC.rgb * vC.a * f, 1.0);',
    '}'
  ].join('\n');
  /* dynamic transient photons (shockwave, ripples, eye flare + lens spikes, tether, glyphs) */
  var DVS = [
    'precision highp float;',
    'attribute vec3 aP; attribute vec4 aCol; attribute float aS; attribute vec2 aO;',
    'uniform mat3 uM; uniform float uD, uF, uR, uFocus, uGain, uMaxPt; uniform vec2 uRes, uOff; uniform float uDpr;',
    'varying vec4 vC;',
    'void main(){',
    '  vec3 v = uM * aP; float zc = uD - v.z;',
    '  if (zc < 30.0) { gl_Position = vec4(3.0,3.0,3.0,1.0); vC = vec4(0.0); gl_PointSize = 0.0; return; }',
    '  float k = uF / zc;',
    '  vec2 s = v.xy * k + aO;',
    '  float far = clamp((zc - uFocus)/uR, 0.0, 1.0);',
    '  vC = vec4(aCol.rgb * mix(vec3(1.0), vec3(0.7,0.85,1.1), far), aCol.a * uGain * (1.0 - 0.45*far));',
    '  gl_PointSize = clamp(aS * k * uDpr * 0.62, 1.0, uMaxPt);',
    '  gl_Position = vec4((s + uOff) / (uRes*0.5), 0.0, 1.0);',
    '}'
  ].join('\n');
  var DFS = [
    'precision mediump float;',
    'varying vec4 vC;',
    'void main(){ vec2 q = gl_PointCoord*2.0 - 1.0; float r2 = dot(q,q); if (r2 > 1.0) discard; float f = exp(-r2*4.2) - 0.015; gl_FragColor = vec4(vC.rgb*vC.a*f, 1.0); }'
  ].join('\n');
  var QVS = 'attribute vec2 aQ; varying vec2 vU; void main(){ vU = aQ*0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }';
  var FADE_FS = 'precision mediump float; uniform float uK; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, uK); }';
  var BRIGHT_FS = [
    'precision mediump float; varying vec2 vU; uniform sampler2D uT; uniform vec2 uPx; uniform float uThr, uKnee;',
    'void main(){',
    '  vec3 c = texture2D(uT, vU + uPx*vec2(-0.5,-0.5)).rgb + texture2D(uT, vU + uPx*vec2(0.5,-0.5)).rgb + texture2D(uT, vU + uPx*vec2(-0.5,0.5)).rgb + texture2D(uT, vU + uPx*vec2(0.5,0.5)).rgb;',
    '  c *= 0.25;',
    '  float br = max(c.r, max(c.g, c.b));',
    '  float rq = clamp(br - uThr + uKnee, 0.0, 2.0*uKnee); rq = rq*rq/(4.0*uKnee + 1e-4);',
    '  float w = max(rq, br - uThr) / max(br, 1e-4);',
    '  gl_FragColor = vec4(c * w, 1.0);',
    '}'
  ].join('\n');
  var DOWN_FS = [
    'precision mediump float; varying vec2 vU; uniform sampler2D uT; uniform vec2 uPx;',
    'void main(){',
    '  vec3 c = texture2D(uT, vU + uPx*vec2(-1.0,-1.0)).rgb + texture2D(uT, vU + uPx*vec2(1.0,-1.0)).rgb + texture2D(uT, vU + uPx*vec2(-1.0,1.0)).rgb + texture2D(uT, vU + uPx*vec2(1.0,1.0)).rgb;',
    '  gl_FragColor = vec4(c*0.25, 1.0);',
    '}'
  ].join('\n');
  var BLUR_FS = [
    'precision mediump float; varying vec2 vU; uniform sampler2D uT; uniform vec2 uDir;',
    'void main(){',
    '  vec3 c = texture2D(uT, vU).rgb * 0.2270270270;',
    '  c += (texture2D(uT, vU + uDir*1.3846153846).rgb + texture2D(uT, vU - uDir*1.3846153846).rgb) * 0.3162162162;',
    '  c += (texture2D(uT, vU + uDir*3.2307692308).rgb + texture2D(uT, vU - uDir*3.2307692308).rgb) * 0.0702702703;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');
  var COMP_FS = [
    'precision highp float; varying vec2 vU;',
    'uniform sampler2D uS, uB0, uB1, uB2, uB3; uniform vec2 uRes; uniform float uTime, uExpo, uFlash, uGrain, uHy, uBloom, uVig, uAspect;',
    'uniform vec3 uFlashCol; uniform vec2 uCore; uniform float uArc; uniform float uLand;',
    HASH,
    'float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'vec3 aces(vec3 x){ return clamp((x*(2.51*x + 0.03)) / (x*(2.43*x + 0.59) + 0.14), 0.0, 1.0); }',
    'float tri(float x){ return 1.0 - abs(fract(x) * 2.0 - 1.0); }',
    /* sharp alpine profile: a few big peaks with ridged detail */
    'float peaksLo(float x, float s){ return 0.072*pow(tri(x*0.9 + s), 1.7) + 0.034*tri(x*2.3 + s*1.7) + 0.015*tri(x*5.7 + s*2.3); }',
    'float peaks(float x, float s){ return peaksLo(x, s) + 0.006*tri(x*13.0 + s*3.1) + 0.0025*tri(x*31.0 + s*4.3); }',
    /* one snow-capped range: rock hazed toward the sky by distance; a white cap whose depth grows with height above the snow altitude; lit on one face */
    'vec3 range(vec3 col, vec2 uv, float x, float fx, float s, float k, float lift, vec3 rock, float haze, float snowAt, float snowK, float aa){',
    '  float xx = x*fx + s*9.0;',
    '  float h = peaks(xx, s);',
    '  float m = uHy + h * k + lift;',
    '  float a = smoothstep(m + aa, m - aa, uv.y);',
    '  if (a <= 0.0) return col;',
    '  float dep = max(m - uv.y, 0.0) / k;',
    /* faceted light: the fold between the lit and shaded face leans away from each summit as it descends */
    '  float xs = xx + dep * 1.6 * fx;',
    '  float sl = peaksLo(xs + 0.008, s) - peaksLo(xs - 0.008, s);',
    '  float lit = smoothstep(-0.0008, 0.0008, sl);',
    '  float cap = max(h - snowAt, 0.0) * k * 0.5;',
    '  cap += step(0.0001, cap) * (0.004*tri(xx*37.0) + 0.003*tri(xx*83.0 + 0.3)) * k;',
    '  float snow = smoothstep(m - cap - aa*1.2, m - cap + aa*1.2, uv.y);',
    '  vec3 r = rock * (0.78 + 0.4*lit);',
    '  vec3 sn = mix(vec3(0.22, 0.29, 0.37), vec3(0.88, 0.93, 0.97), lit) * snowK;',
    '  sn = mix(sn, sn * vec3(1.25, 0.86, 0.72) + vec3(0.10, 0.03, 0.0) * lit, uArc * 0.75);',
    '  vec3 c = mix(r, sn, snow);',
    '  c = mix(c, vec3(0.046, 0.078, 0.100), haze * (0.45 + 0.55*smoothstep(m, uHy, uv.y)));',
    '  return mix(col, c, a);',
    '}',
    /* conifers: soft filled silhouettes, one tree per cell (checked with its neighbours so crowns overlap);
       stepped bough tiers, a slight sway that bends the crown, snow dusting on the upper edge of each tier */
    'float pineRow(float x, float y, float base, float dens, float hmin, float hmax, float seed, float sway, float aa, out float snow){',
    '  float cov = 0.0; snow = 0.0;',
    '  float ci = floor(x * dens);',
    '  for (int j = -1; j <= 1; j++) {',
    '    float c = ci + float(j);',
    '    float r1 = h1(c * 7.13 + seed), r2 = h1(c * 3.71 + seed * 1.7), r3 = h1(c * 5.31 + seed * 2.9);',
    '    if (r3 < 0.1) continue;',
    '    float th = mix(hmin, hmax, r1 * r1);',
    '    float tx = (c + 0.5 + (r2 - 0.5) * 0.8) / dens;',
    '    float ty = (y - base) / th;',
    '    if (ty < -0.02 || ty > 1.0) continue;',
    '    float sw = sway * sin(uTime * (0.9 + 2.6 * uArc) + c * 1.7 + seed) * (0.6 + r2);',
    '    float dx = x - tx - sw * ty * ty * th;',
    '    float tiers = 5.0 + floor(r1 * 3.0);',
    '    float ft = fract(ty * tiers - 0.15);',
    '    float hw = th * 0.30 * (1.0 - ty) * (0.58 + 0.42 * (1.0 - ft)) + th * 0.01;',
    '    hw = max(hw, ty < 0.07 ? th * 0.035 : 0.0);',
    '    float a = smoothstep(hw + aa, hw - aa, abs(dx));',
    '    if (a > cov) { cov = a; snow = a * pow(1.0 - ft, 5.0) * smoothstep(0.25, 0.95, abs(dx) / max(hw, 1e-4)) * step(0.1, ty); }',
    '  }',
    '  return cov;',
    '}',
    /* drifting snow in the air: wind and fall speed (and count) rise with the intensity arc */
    'float snowfall(vec2 uv, float sc, float seed){',
    '  vec2 p = uv * vec2(uAspect, 1.0) * sc;',
    '  p += vec2(-uTime * (0.08 + 1.6 * uArc) * sc * 0.25, uTime * (0.10 + 0.35 * uArc) * sc * 0.25);',
    '  p.x += sin(p.y * 0.7 + seed) * 0.6;',
    '  vec2 c = floor(p), f = fract(p);',
    '  float r = h1(dot(c, vec2(17.1, 113.7)) + seed);',
    '  if (r > 0.35 + 0.4 * uArc) return 0.0;',
    '  vec2 q = vec2(h1(r * 91.3), h1(r * 47.9)) * 0.8 + 0.1;',
    '  float d = length(f - q);',
    '  return smoothstep(0.09, 0.0, d);',
    '}',
    'void main(){',
    '  vec2 uv = vU;',
    '  float x = (uv.x - 0.5) * uAspect;',
    /* night sky: deep blue-black, glacier teal near the horizon, a whisper of alpenglow at the horizon line */
    '  vec3 sky = mix(vec3(0.020, 0.040, 0.062), vec3(0.008, 0.014, 0.024), smoothstep(uHy, 1.0, uv.y));',
    '  float hd = uv.y - uHy;',
    '  sky += vec3(0.05, 0.13, 0.17) * exp(-abs(hd) * 5.0) * 1.25 + vec3(0.03, 0.06, 0.09) * smoothstep(0.35, 0.0, hd) * step(0.0, hd);',
    '  sky += vec3(0.30, 0.15, 0.08) * exp(-abs(hd) * 26.0) * 0.08;',
    '  vec3 col = sky;',
    /* three snow-capped ranges: far (hazed, light), middle, near (dark slate, crisp caps) */
    /* ranges only below the tallest possible summit (keeps the sky pass cheap) */
    '  if (uLand > 0.5 && uv.y < uHy + 0.29) {',
    '    float aa = 1.2 / uRes.y;',
    '    if (uv.y > uHy) {',
    '    col = range(col, uv, x, 0.55, 0.61, 2.0, 0.018, vec3(0.040, 0.062, 0.080), 0.5, 0.064, 0.6, aa);',
    '    col = range(col, uv, x, 0.80, 0.37, 1.45, 0.006, vec3(0.028, 0.043, 0.057), 0.28, 0.058, 0.66, aa);',
    '    }',
    '    float m1 = uHy + peaks(x*1.15 + 0.99, 0.11) * 1.0;',
    '    float rim = exp(-max(m1 - uv.y, 0.0) * 260.0);',
    '    col = range(col, uv, x, 1.15, 0.11, 1.0, 0.0, vec3(0.011, 0.018, 0.025), 0.0, 0.052, 0.6, aa);',
    /* the near caps catch a little of the swarm light */
    '    vec3 bl2 = texture2D(uB2, uv).rgb;',
    '    if (uv.y < m1) col += bl2 * rim * 0.4;',
    '  }',
    /* pine rows along the shore: far (light, hazy), mid, near (dark slate with snow; kept to the sides so the centre stays open) */
    '  if (uLand > 0.5 && abs(uv.y - uHy) < 0.12) {',
    '    float aa2 = 1.3 / uRes.y, sn1, sn2;',
    '    float yy = uv.y >= uHy ? uv.y : uHy + (uHy - uv.y) * 1.1;',
    '    float swy = 0.05 + 0.22 * uArc;',
    '    float c1 = pineRow(x, yy, uHy, 34.0, 0.022, 0.042, 3.1, swy * 0.5, aa2, sn1);',
    '    float c2 = pineRow(x, yy, uHy, 19.0, 0.035, 0.065, 7.7, swy * 0.8, aa2, sn2);',
    '    vec3 t1 = vec3(0.10, 0.14, 0.17), t2 = vec3(0.045, 0.068, 0.085);',
    '    vec3 tc = col;',
    '    tc = mix(tc, t1 + vec3(0.12, 0.15, 0.17) * sn1 * 0.5, c1 * 0.8);',
    '    tc = mix(tc, t2 + vec3(0.30, 0.36, 0.42) * sn2 * 0.6, c2 * 0.92);',
    '    col = uv.y >= uHy ? tc : mix(col, tc * 0.6, 0.7);',
    '  }',
    /* still water below the horizon: reflected, blurred light of the scene */
    '  if (uv.y < uHy) {',
    '    float dd = uHy - uv.y;',
    '    vec2 ru = vec2(uv.x + sin(uv.y*240.0 + uTime*1.2)*0.0016, uHy + dd*1.15);',
    '    vec3 refl = texture2D(uB1, ru).rgb*0.7 + texture2D(uB2, ru).rgb*0.8 + texture2D(uS, ru).rgb*0.12;',
    '    col = mix(col, vec3(0.006, 0.012, 0.018), 0.6);',
    '    col += refl * 0.30 * exp(-dd * 5.0);',
    '  }',
    /* foreground: two rows of tall pines on snowbanks at the sides (centre left open for the orbit and its reflection) */
    '  float sideX = abs(uv.x - 0.5) * 2.0;',
    '  if (uLand > 0.5 && uv.y < uHy + 0.36 && sideX > 0.35) {',
    '    float aa3 = 1.4 / uRes.y, sn3, sn4, swy2 = 0.05 + 0.22 * uArc;',
    '    float bank3 = uHy - 0.055 + 0.012 * sin(x * 9.0 + 1.0), bank4 = uHy - 0.12 + 0.02 * sin(x * 5.0 + 2.0);',
    '    float s3 = smoothstep(0.35, 0.6, sideX), s4 = smoothstep(0.55, 0.8, sideX);',
    '    float c3 = pineRow(x, uv.y, bank3, 10.0, 0.12, 0.22, 11.3, swy2, aa3, sn3) * s3;',
    '    float c4 = pineRow(x, uv.y, bank4, 5.0, 0.24, 0.42, 19.7, swy2 * 1.2, aa3, sn4) * s4;',
    '    float b3 = smoothstep(bank3 + aa3, bank3 - aa3, uv.y) * s3, b4 = smoothstep(bank4 + aa3, bank4 - aa3, uv.y) * s4;',
    '    float lip3 = exp(-max(bank3 - uv.y, 0.0) * 90.0) * b3, lip4 = exp(-max(bank4 - uv.y, 0.0) * 60.0) * b4;',
    '    vec3 glowC = vec3(0.20, 0.08, 0.03) * uArc;',
    /* valley mist behind the foreground trunks so the silhouettes read */
    '    col += (vec3(0.05, 0.085, 0.11) + glowC * 0.4) * exp(-abs(uv.y - bank3 - 0.03) * 18.0) * s3 * 0.9;',
    '    vec3 bl3 = texture2D(uB3, uv).rgb;',
    '    col = mix(col, vec3(0.085, 0.11, 0.135) + vec3(0.30, 0.36, 0.42) * lip3 + glowC * lip3, b3 * 0.97);',
    '    col = mix(col, vec3(0.042, 0.060, 0.076) + (vec3(0.62, 0.70, 0.78) + glowC) * sn3 * 0.7 + bl3 * 0.25, c3);',
    '    col = mix(col, vec3(0.06, 0.08, 0.10) + vec3(0.34, 0.40, 0.47) * lip4 + glowC * lip4, b4);',
    '    col = mix(col, vec3(0.032, 0.048, 0.062) + (vec3(0.70, 0.78, 0.86) + glowC) * sn4 * 0.85 + bl3 * 0.2, c4);',
    '  }',
    '  float flakes = snowfall(uv, 26.0, 1.3) * 0.55 + snowfall(uv, 14.0, 4.1) * 0.85;',
    '  col += vec3(0.80, 0.88, 0.95) * flakes * (0.10 + 0.22 * uArc) * uLand;',
    '  vec3 sc = texture2D(uS, uv).rgb;',
    '  vec3 bloom = texture2D(uB0, uv).rgb*0.55 + texture2D(uB1, uv).rgb*0.75 + texture2D(uB2, uv).rgb*0.95 + texture2D(uB3, uv).rgb*1.15;',
    '  vec2 fd = (uv - uCore) * vec2(uAspect, 1.0);',
    '  vec3 hdr = sc + bloom * uBloom + uFlashCol * uFlash * (1.6 * exp(-dot(fd, fd) * 60.0) + 0.25 * exp(-dot(fd, fd) * 6.0));',
    '  hdr *= uExpo * (1.0 + uFlash * 0.25);',
    /* warm the highlights slightly (chromatic warmth) before tone mapping */
    '  float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));',
    '  hdr *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), smoothstep(0.6, 3.0, lum));',
    '  vec3 m = aces(hdr);',
    '  col = 1.0 - (1.0 - col) * (1.0 - m);',
    '  float vg = length((uv - 0.5) * vec2(uAspect, 1.0) * vec2(0.78, 1.0));',
    '  col *= mix(1.0, smoothstep(1.05, 0.25, vg), uVig);',
    '  col += (hh(uv * uRes + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i), nm = info.name.replace(/\[0\]$/, '');
      u[nm] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  /* ---------------- GL renderer ---------------- */
  function HQ(canvas, opts) {
    var attrs = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.capture, powerPreference: 'high-performance' };
    var gl = canvas.getContext('webgl2', attrs), v2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('no webgl');
    this.gl = gl; this.v2 = v2;
    /* HDR target: half float when renderable, else 8-bit */
    this.hdr = false;
    if (v2) {
      if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) { this.hdr = true; this.ifmt = gl.RGBA16F; this.fmt = gl.RGBA; this.type = gl.HALF_FLOAT; }
      gl.getExtension('OES_texture_float_linear');
    } else {
      var hf = gl.getExtension('OES_texture_half_float');
      var hfl = gl.getExtension('OES_texture_half_float_linear');
      var cb = gl.getExtension('EXT_color_buffer_half_float');
      if (hf && hfl && cb) { this.hdr = true; this.ifmt = gl.RGBA; this.fmt = gl.RGBA; this.type = hf.HALF_FLOAT_OES; }
    }
    if (!this.hdr) { this.ifmt = gl.RGBA; this.fmt = gl.RGBA; this.type = gl.UNSIGNED_BYTE; }
    this.pP = program(gl, PVS, PFS);
    this.pD = program(gl, DVS, DFS);
    this.pFade = program(gl, QVS, FADE_FS);
    this.pCopy = program(gl, QVS, 'precision mediump float; varying vec2 vU; uniform sampler2D uT; void main(){ gl_FragColor = vec4(texture2D(uT, vU).rgb, 1.0); }');
    this.pBright = program(gl, QVS, BRIGHT_FS);
    this.pDown = program(gl, QVS, DOWN_FS);
    this.pBlur = program(gl, QVS, BLUR_FS);
    this.pComp = program(gl, QVS, (opts && opts.compFS) || COMP_FS);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.pbuf = gl.createBuffer(); this.ibuf = gl.createBuffer(); this.dbuf = gl.createBuffer();
    this.nP = 0; this.w = 0; this.h = 0; this.rts = null;
    this.maxPt = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64;
    this.uint = v2 || !!gl.getExtension('OES_element_index_uint');
  }
  HQ.prototype.setParticles = function (data, n) {
    var gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    var idx = (n * 4 > 65535 && this.uint) ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    for (var i = 0; i < n; i++) {
      var b = i * 4, o = i * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b + 2; idx[o + 4] = b + 1; idx[o + 5] = b + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.idxType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.nP = n;
    this.nTrail = arguments[2] == null ? n : arguments[2];
  };
  HQ.prototype._rt = function (w, h) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.ifmt, w, h, 0, this.fmt, this.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { t: t, f: f, w: w, h: h, ok: ok };
  };
  HQ.prototype._ensure = function (w, h) {
    if (this.rts && this.w === w && this.h === h) return;
    var gl = this.gl;
    if (this.rts) this.rts.all.forEach(function (r) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.f); });
    this.w = w; this.h = h;
    var acc = this._rt(w, h);
    if (!acc.ok && this.hdr) { this.hdr = false; this.ifmt = gl.RGBA; this.fmt = gl.RGBA; this.type = gl.UNSIGNED_BYTE; gl.deleteTexture(acc.t); gl.deleteFramebuffer(acc.f); acc = this._rt(w, h); }
    var scene = this._rt(w, h);
    var lv = [], all = [acc, scene];
    for (var i = 1; i <= 4; i++) {
      var lw = Math.max(1, Math.round(w / Math.pow(2, i))), lh = Math.max(1, Math.round(h / Math.pow(2, i)));
      var a = this._rt(lw, lh), b = this._rt(lw, lh);
      lv.push({ a: a, b: b }); all.push(a, b);
    }
    this.rts = { acc: acc, scene: scene, lv: lv, all: all };
  };
  HQ.prototype.clear = function () {
    if (!this.rts) return;
    var gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rts.acc.f);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  };
  HQ.prototype._quadDraw = function (prog) {
    var gl = this.gl, loc = gl.getAttribLocation(prog.p, 'aQ');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  };
  HQ.prototype._tex = function (prog, name, unit, tex) {
    var gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u[name], unit);
  };
  /* U: per-frame uniforms for the particle program; dyn: Float32Array of transient photons (10 floats each) */
  HQ.prototype.render = function (V, U, dyn, nDyn, post) {
    var gl = this.gl, W = Math.max(2, Math.round(V.w * V.dpr)), H = Math.max(2, Math.round(V.h * V.dpr));
    this._ensure(W, H);
    var R = this.rts;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    /* 1. trail fade (multiply) in the HDR accumulation buffer */
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.acc.f);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.pFade.p);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.uniform1f(this.pFade.u.uK, post.keep);
    this._quadDraw(this.pFade);
    /* 2. GPU photons (soft velocity streak quads), additive */
    gl.blendFunc(gl.ONE, gl.ONE);
    var P = this.pP, u = P.u;
    gl.useProgram(P.p);
    gl.uniformMatrix3fv(u.uM, false, V.m);
    gl.uniform1f(u.uD, V.D); gl.uniform1f(u.uF, V.F); gl.uniform1f(u.uR, V.R); gl.uniform1f(u.uFocus, V.D);
    gl.uniform2f(u.uRes, V.w, V.h); gl.uniform1f(u.uDpr, V.dpr);
    gl.uniform1f(u.uMaxW, V.maxW); gl.uniform2f(u.uOff, V.ox, V.oy);
    for (var key in U) {
      var val = U[key], loc = u[key];
      if (loc == null) continue;
      if (typeof val === 'number') gl.uniform1f(loc, val);
      else if (val.t === 3) gl.uniform3fv(loc, val.v);
      else gl.uniform1fv(loc, val.v);
    }
    var self = this;
    function drawRange(first, count) {
      if (count <= 0) return;
      gl.useProgram(P.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, self.pbuf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, self.ibuf);
      var lc = gl.getAttribLocation(P.p, 'aC'), la = gl.getAttribLocation(P.p, 'aA'), lb = gl.getAttribLocation(P.p, 'aB');
      gl.enableVertexAttribArray(lc); gl.enableVertexAttribArray(la); gl.enableVertexAttribArray(lb);
      gl.vertexAttribPointer(lc, 2, gl.FLOAT, false, 40, 0);
      gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 40, 8);
      gl.vertexAttribPointer(lb, 4, gl.FLOAT, false, 40, 24);
      var bytes = self.idxType === gl.UNSIGNED_INT ? 4 : 2;
      gl.drawElements(gl.TRIANGLES, count * 6, self.idxType, first * 6 * bytes);
      gl.disableVertexAttribArray(lc); gl.disableVertexAttribArray(la); gl.disableVertexAttribArray(lb);
    }
    /* orbiting photons leave trails */
    drawRange(0, this.nTrail);
    /* scene = trails + crisp photons (overseer, nucleus, haze, transients) */
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.f);
    gl.useProgram(this.pCopy.p);
    this._tex(this.pCopy, 'uT', 0, R.acc.t);
    this._quadDraw(this.pCopy);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    drawRange(this.nTrail, this.nP - this.nTrail);
    /* 3. transient photons */
    if (nDyn > 0) {
      var D = this.pD, du = D.u;
      gl.useProgram(D.p);
      gl.uniformMatrix3fv(du.uM, false, V.m);
      gl.uniform1f(du.uD, V.D); gl.uniform1f(du.uF, V.F); gl.uniform1f(du.uR, V.R); gl.uniform1f(du.uFocus, V.D);
      gl.uniform2f(du.uRes, V.w, V.h); gl.uniform2f(du.uOff, V.ox, V.oy); gl.uniform1f(du.uDpr, V.dpr); gl.uniform1f(du.uGain, 1);
      gl.uniform1f(du.uMaxPt, Math.min(this.maxPt, 96 * V.dpr));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dbuf);
      gl.bufferData(gl.ARRAY_BUFFER, dyn.subarray(0, nDyn * 10), gl.DYNAMIC_DRAW);
      var l1 = gl.getAttribLocation(D.p, 'aP'), l2 = gl.getAttribLocation(D.p, 'aCol'), l3 = gl.getAttribLocation(D.p, 'aS'), l4 = gl.getAttribLocation(D.p, 'aO');
      gl.enableVertexAttribArray(l1); gl.enableVertexAttribArray(l2); gl.enableVertexAttribArray(l3); gl.enableVertexAttribArray(l4);
      gl.vertexAttribPointer(l1, 3, gl.FLOAT, false, 40, 0);
      gl.vertexAttribPointer(l2, 4, gl.FLOAT, false, 40, 12);
      gl.vertexAttribPointer(l3, 1, gl.FLOAT, false, 40, 28);
      gl.vertexAttribPointer(l4, 2, gl.FLOAT, false, 40, 32);
      gl.drawArrays(gl.POINTS, 0, nDyn);
      gl.disableVertexAttribArray(l1); gl.disableVertexAttribArray(l2); gl.disableVertexAttribArray(l3); gl.disableVertexAttribArray(l4);
    }
    this._post(W, H, post);
  };
  HQ.prototype._post = function (W, H, post) {
    var gl = this.gl, R = this.rts;
    gl.disable(gl.BLEND);
    /* 4. bloom: bright pass -> downsample chain -> separable gaussian per level */
    var lv = R.lv;
    gl.useProgram(this.pBright.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, lv[0].a.f); gl.viewport(0, 0, lv[0].a.w, lv[0].a.h);
    this._tex(this.pBright, 'uT', 0, R.scene.t);
    gl.uniform2f(this.pBright.u.uPx, 1 / W, 1 / H);
    gl.uniform1f(this.pBright.u.uThr, post.thr); gl.uniform1f(this.pBright.u.uKnee, post.knee);
    this._quadDraw(this.pBright);
    for (var i = 1; i < lv.length; i++) {
      gl.useProgram(this.pDown.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv[i].a.f); gl.viewport(0, 0, lv[i].a.w, lv[i].a.h);
      this._tex(this.pDown, 'uT', 0, lv[i - 1].a.t);
      gl.uniform2f(this.pDown.u.uPx, 0.5 / lv[i - 1].a.w, 0.5 / lv[i - 1].a.h);
      this._quadDraw(this.pDown);
    }
    gl.useProgram(this.pBlur.p);
    for (var j = 0; j < lv.length; j++) {
      var L = lv[j];
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.b.f); gl.viewport(0, 0, L.b.w, L.b.h);
      this._tex(this.pBlur, 'uT', 0, L.a.t);
      gl.uniform2f(this.pBlur.u.uDir, 1 / L.a.w, 0);
      this._quadDraw(this.pBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L.a.f);
      this._tex(this.pBlur, 'uT', 0, L.b.t);
      gl.uniform2f(this.pBlur.u.uDir, 0, 1 / L.a.h);
      this._quadDraw(this.pBlur);
    }
    /* 5. composite: sky + mountains + reflection + scene + bloom, ACES tone map, warmth, vignette, grain */
    var C = this.pComp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(C.p);
    this._tex(C, 'uS', 0, R.scene.t);
    this._tex(C, 'uB0', 1, lv[0].a.t);
    this._tex(C, 'uB1', 2, lv[1].a.t);
    this._tex(C, 'uB2', 3, lv[2].a.t);
    this._tex(C, 'uB3', 4, lv[3].a.t);
    gl.uniform2f(C.u.uRes, W, H);
    gl.uniform1f(C.u.uTime, post.time); gl.uniform1f(C.u.uExpo, post.expo); gl.uniform1f(C.u.uFlash, post.flash);
    gl.uniform3fv(C.u.uFlashCol, post.flashCol); gl.uniform2f(C.u.uCore, post.core[0], post.core[1]);
    gl.uniform1f(C.u.uGrain, post.grain); gl.uniform1f(C.u.uHy, post.hy); gl.uniform1f(C.u.uBloom, post.bloom);
    gl.uniform1f(C.u.uVig, post.vig); gl.uniform1f(C.u.uAspect, W / H);
    if (C.u.uArc != null) gl.uniform1f(C.u.uArc, post.arc || 0);
    if (C.u.uLand != null) gl.uniform1f(C.u.uLand, post.land == null ? 1 : post.land);
    if (post.extra) post.extra(gl, C.u);
    this._quadDraw(C);
    gl.activeTexture(gl.TEXTURE0);
  };

  /* intensity arc target: confirming / armed ramp, in trade high and scaled by weakness energy */
  function arcTarget(o) {
    if (o.mergeT) return 0.8 + 0.2 * (o.energyT || 0);
    var st = o.step | 0;
    return st >= 6 ? 0.6 : st >= 3 ? 0.2 + 0.1 * (st - 3) : st > 0 ? 0.08 * st : 0;
  }
  /* point-only pass used by the alternate looks: trail photons -> acc, crisp photons -> scene, then bloom + composite */
  HQ.prototype._pts = function (buf, data, n, V, gain) {
    if (n <= 0) return;
    var gl = this.gl, D = this.pD, du = D.u;
    gl.useProgram(D.p);
    gl.uniformMatrix3fv(du.uM, false, V.m);
    gl.uniform1f(du.uD, V.D); gl.uniform1f(du.uF, V.F); gl.uniform1f(du.uR, V.R); gl.uniform1f(du.uFocus, V.D);
    gl.uniform2f(du.uRes, V.w, V.h); gl.uniform2f(du.uOff, V.ox, V.oy); gl.uniform1f(du.uDpr, V.dpr); gl.uniform1f(du.uGain, gain || 1);
    gl.uniform1f(du.uMaxPt, Math.min(this.maxPt, 120 * V.dpr));
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 10), gl.DYNAMIC_DRAW);
    var l1 = gl.getAttribLocation(D.p, 'aP'), l2 = gl.getAttribLocation(D.p, 'aCol'), l3 = gl.getAttribLocation(D.p, 'aS'), l4 = gl.getAttribLocation(D.p, 'aO');
    gl.enableVertexAttribArray(l1); gl.enableVertexAttribArray(l2); gl.enableVertexAttribArray(l3); gl.enableVertexAttribArray(l4);
    gl.vertexAttribPointer(l1, 3, gl.FLOAT, false, 40, 0);
    gl.vertexAttribPointer(l2, 4, gl.FLOAT, false, 40, 12);
    gl.vertexAttribPointer(l3, 1, gl.FLOAT, false, 40, 28);
    gl.vertexAttribPointer(l4, 2, gl.FLOAT, false, 40, 32);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disableVertexAttribArray(l1); gl.disableVertexAttribArray(l2); gl.disableVertexAttribArray(l3); gl.disableVertexAttribArray(l4);
  };
  HQ.prototype.render2 = function (V, dT, nT, dC, nC, post) {
    var gl = this.gl, W = Math.max(2, Math.round(V.w * V.dpr)), H = Math.max(2, Math.round(V.h * V.dpr));
    this._ensure(W, H);
    var R = this.rts;
    if (!this.cbuf) this.cbuf = gl.createBuffer();
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.acc.f);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.pFade.p);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
    gl.uniform1f(this.pFade.u.uK, post.keep);
    this._quadDraw(this.pFade);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._pts(this.dbuf, dT, nT, V, post.gain);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.scene.f);
    gl.useProgram(this.pCopy.p);
    this._tex(this.pCopy, 'uT', 0, R.acc.t);
    this._quadDraw(this.pCopy);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    this._pts(this.cbuf, dC, nC, V, post.gain);
    this._post(W, H, post);
  };

  /* ---------------- overlay helpers ---------------- */
  var SHADE = null;
  function shadeSprite() {
    if (SHADE) return SHADE;
    var c = document.createElement('canvas'); c.width = 64; c.height = 32;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(32, 16, 0, 32, 16, 32);
    g.addColorStop(0, 'rgba(4,8,13,0.82)'); g.addColorStop(0.6, 'rgba(4,8,13,0.55)'); g.addColorStop(1, 'rgba(4,8,13,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 32);
    SHADE = c; return c;
  }

  /* ---------------- the Swarm ---------------- */
  function Swarm(canvas, opts) {
    opts = opts || {};
    var q = global.location ? global.location.search : '';
    var capture = /[?&]capture\b/.test(q);
    this.ultra = /[?&]ultra\b/.test(q);
    /* boosted look (default; ?boost=0 restores the earlier look): larger phone orbit at confirming,
       stronger overseer shell, more readable shockwave, quicker green settle */
    this.boost = !/[?&]boost=0\b/.test(q);
    if (opts.force2d || /[?&]nogl\b/.test(q)) return new global.SwarmLite(canvas, { force2d: true });
    var gc = document.createElement('canvas');
    gc.className = 'swarm3d';
    gc.setAttribute('aria-hidden', 'true');
    var hq;
    try { hq = new HQ(gc, { capture: capture }); }
    catch (e) { return new global.SwarmLite(canvas, { force2d: true }); }
    this.hq = hq; this.glCanvas = gc;
    canvas.parentNode.insertBefore(gc, canvas);
    canvas.classList.add('overlay3d');
    this.canvas = canvas;
    this.mode = hq.hdr ? 'webgl-hdr' : 'webgl';
    this.sats = SATS.map(function (s, i) { return { id: s.id, key: s.key, ang: (i / SATS.length) * Math.PI * 2, lock: 0, lockT: 0 }; });
    this.conf = 0.12; this.confT = 0.12;
    this.state = 'SCANNING';
    this.label = 'GOLD (SIM)';
    this.nodes = [];
    this.reduced = false;
    this.scatter = 0; this._tumT = 0;
    this.flash = null; this.flashT = 0; this.flashCol = SIGNAL;
    this.shock = []; this.ripples = []; this.glyphs = [];
    this.bristle = 0; this.bristleT = 0;
    this.mergeT = 0; this.sMerge = new Spring(0, 2.6); this.sArc = new Spring(0, 3);
    this.sFlat = new Spring(0, 2.4);
    this.sStep = new Spring(0, 3.2);
    this.sEnergy = new Spring(0, 2.2);
    this.sConf = new Spring(0.12, 3);
    this.sPush = new Spring(0, 5);
    this.snapT = 0;
    this.step = 0; this.stepFlash = 0; this.energyT = 0;
    this.eyeAng = -Math.PI / 2; this.eyeLane = 4; this.eyeLock = 0; this.eyeWarn = 0;
    this.dim = 0; this.laneGlow = [0, 0, 0, 0, 0];
    this.haloSig = 0; this.haloSigCol = SIGNAL; this.bias = { bear: 0, bull: 0 };
    this.notch = null; this.notchOn = false; this.crack = 0;
    this.lanePh = [0, 1.3, 2.6, 3.9, 5.2]; this.laneOm = [0, 0, 0, 0, 0];
    this.ringRot = [0, 0.4, 1.1]; this.ringOm = [0, 0, 0];
    this.streamPh = [0, 0, 0, 0, 0]; this.streamDen = [0, 0, 0, 0, 0];
    this._t = 0; this._haloRot = 0; this._coreRot = 0; this._pulseT = 0;
    this._built = ''; this.counts = null;
    this.dyn = new Float32Array(6000 * 10); this.nDyn = 0;
    this.cam = { yaw: 0, pitch: 0, yawV: 0, pitchV: 0, zoom: 1, zoomT: 1, drag: false, reset: 0, armed: 0 };
    this.fps = 0; this._fpsAcc = 0; this._fpsN = 0; this.cpuMs = 0;
    this.modeLabel = 'Lanes · orbital planes';
    var self = this;
    gc.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    this._initInput();
  }
  Swarm.TF_COLORS = TFC; Swarm.STEP_ORBIT = STEP_ORBIT; Swarm.STEP_RING = STEP_RING; Swarm.SIGNAL = SIGNAL; Swarm.PEARL = PEARL;

  /* release the GL context and the stage canvas when the look switcher swaps renderers */
  Swarm.prototype.destroy = function () {
    this.dead = true;
    try { var ext = this.hq && this.hq.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) { /* already gone */ }
    if (this.glCanvas && this.glCanvas.parentNode) this.glCanvas.parentNode.removeChild(this.glCanvas);
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
      cam.drag = true; cam.armed = 6; c.style.cursor = 'grabbing';
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
    /* wheel zooms once the stage has been touched (or with ctrl/cmd), so page scrolling over the hero still scrolls */
    c.addEventListener('wheel', function (e) {
      if (!(cam.armed > 0 || e.ctrlKey || e.metaKey)) return;
      var z = clamp(cam.zoomT * Math.exp(-e.deltaY * 0.0012), 0.8, 1.35);
      if (Math.abs(z - cam.zoomT) > 1e-4) { cam.zoomT = z; cam.armed = 6; e.preventDefault(); }
    }, { passive: false });
  };
  Swarm.prototype.orbitBy = function (dyaw, dpitch) {
    this.cam.yaw += dyaw; this.cam.pitch = clamp(this.cam.pitch + (dpitch || 0), -0.95, 0.75);
  };

  /* build the static GPU photon buffer: 4 vertices per photon, 10 floats per vertex */
  Swarm.prototype._build = function (tier) {
    if (tier === this._built) return;
    this._built = tier;
    var C = tier === 'reduced' ? { swarm: 900, band: 270, stream: 300, halo: 600, shell: 180, core: 90, haze: 40 }
      : /^phone/.test(tier) ? { swarm: 1700, band: 360, stream: 380, halo: 900, shell: 200, core: 110, haze: 50 }
        : { swarm: 5600, band: 1260, stream: 1500, halo: 2600, shell: 640, core: 320, haze: 110 };
    /* offline stills: about twice the photons at lower per-photon gain (same exposure, finer grain) */
    if (/-boost/.test(tier)) { C.halo = Math.round(C.halo * (/^phone/.test(tier) ? 2 : 1.6)); }
    if (/-ultra$/.test(tier)) { for (var kq in C) C[kq] = Math.round(C[kq] * 2.2); }
    var n = 0; for (var k in C) n += C[k];
    C.total = n;
    this.counts = C;
    var d = new Float32Array(n * 40), o = 0, R = rng(20261009);
    var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    function put(a, b) {
      for (var c = 0; c < 4; c++) {
        d[o++] = corners[c][0]; d[o++] = corners[c][1];
        d[o++] = a[0]; d[o++] = a[1]; d[o++] = a[2]; d[o++] = a[3];
        d[o++] = b[0]; d[o++] = b[1]; d[o++] = b[2]; d[o++] = b[3];
      }
    }
    function gauss() { return (R() + R() + R() - 1.5) / 1.5; }
    var i;
    /* swarm photons: equal share per lane; lane weight shows as density + brightness */
    for (i = 0; i < C.swarm; i++) {
      var lane = i % 5;
      /* clustered phases make the ribbons breathe (denser knots along each orbit) */
      var ph = R() * Math.PI * 2; ph += 0.35 * Math.sin(ph * 3 + lane);
      put([0, lane, ph, 0.75 + R() * 0.6], [gauss() * 0.05, gauss() * 0.5, 0.9 + R() * 1.5 + (R() < 0.04 ? 2 : 0), R() * 100]);
    }
    /* photon bands: segmented clusters on three planes */
    var segs = [12, 16, 20];
    for (i = 0; i < C.band; i++) {
      var ring = i % 3, sg = segs[ring], si = (R() * sg) | 0;
      var a = (si + Math.pow(R(), 0.8) * 0.86) / sg * Math.PI * 2;
      put([1, ring, a, 0], [gauss(), (R() - 0.5) * 2, 1.4 + R() * 1.2, R() * 100]);
    }
    for (i = 0; i < C.stream; i++) {
      put([2, i % 5, R(), 0.8 + R() * 0.45], [gauss() * 9, gauss() * 9, 1.4 + R() * 1.6, R() * 100]);
    }
    for (i = 0; i < C.halo; i++) {
      var hd = fib(i, C.halo);
      put([3, 0, hd[0], hd[1]], [hd[2], gauss(), 1.2 + R() * 1.3, R() * 100]);
    }
    for (i = 0; i < C.shell; i++) {
      var sd = fib(i, C.shell);
      put([4, 0, sd[0], sd[1]], [sd[2], 0, 1.1 + R() * 1.4, R() * 100]);
    }
    for (i = 0; i < C.core; i++) {
      var cd = fib(i, C.core);
      put([5, 0, cd[0], cd[1]], [cd[2], 0, 1.6 + R() * 2.2, R() * 100]);
    }
    for (i = 0; i < C.haze; i++) {
      var zd = fib(i, C.haze);
      put([6, 0, zd[0], zd[1]], [zd[2], 0, 26 + R() * 40, R() * 100]);
    }
    this.hq.setParticles(d, n, C.swarm + C.band + C.stream);
  };
  Swarm.prototype.setCount = function () { /* counts are tiered (desktop / phone / reduced) in _build */ };

  Swarm.prototype.calm = function () {
    this.scatter = 0; this.flashT = 0; this.flash = null;
    this.shock = []; this.ripples = []; this.dim = 0; this.eyeLock = 0; this.eyeWarn = 0; this.crack = 0;
    this.sMerge.snap(this.mergeT); this.sFlat.snap(Math.max(this.mergeT, clamp(this.step / 7, 0, 1) * 0.85));
    this.sStep.snap(this.step); this.sPush.snap(0); this.snapT = 0;
    this.haloSig = 0;
    if (this.hq) this.hq.clear();
  };
  Swarm.prototype.burst = function (kind) {
    var col = kind === 'loss' || kind === 'invalid' ? RED : kind === 'win' ? GOLD : SIGNAL;
    this.flash = kind; this.flashT = 1.1; this.flashCol = col;
    if (kind === 'invalid') { this.scatter = 1; this._tumT = 0; }
    this.shock.push({ t: 0, col: col, big: kind === 'entry' });
    if (kind === 'entry') { this.snapT = 1.1; this.sPush.v += 9; }
    if (this.shock.length > 4) this.shock.shift();
  };
  Swarm.prototype.fire = function (agree) {
    this.haloSig = 1.6;
    this.haloSigCol = agree ? SIGNAL : WARN;
    if (!agree) { this.eyeWarn = Math.max(this.eyeWarn, 1.6); this.crack = Math.max(this.crack, 1.2); }
  };
  Swarm.prototype.vsa = function (f) {
    var k = TFS.indexOf(f.tf);
    if (k < 0) return;
    var s = clamp(f.strength | 0, 1, 3);
    var ed = this._eyeDir();
    if (f.dir === 'bear') {
      this.ripples.push({ t: 0, s: s, k: k, seed: (this.ripples.length * 1.7 + k) % 6.28 });
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
  Swarm.prototype._curve3 = function (node, i, R, h) {
    var y = clamp(-(node.y - h / 2) * 0.8, -R * 0.42, R * 0.42);
    return [[-R * 0.95, y, -R * 0.42], [-R * 0.46, y * 0.45 + (i - 2) * 12, R * 0.5], [0, 0, 0]];
  };

  Swarm.prototype._camera = function (dt, w, h, R) {
    var cam = this.cam;
    if (cam.armed > 0) cam.armed -= dt;
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
    var push = this.sPush.step(0, dt);
    var drift = this.reduced ? 0 : 1;
    /* idle orbit: ±10° yaw sweep with a gentle bob */
    var yaw = 0.30 + cam.yaw + drift * 0.175 * Math.sin(this._t * 0.085);
    var pitch = 0.36 + cam.pitch + drift * (0.035 * Math.sin(this._t * 0.21 + 1) + 0.015 * Math.sin(this._t * 0.53));
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var m00 = cy, m01 = 0, m02 = sy;
    var m10 = sp * sy, m11 = cp, m12 = -sp * cy;
    var m20 = -cp * sy, m21 = sp, m22 = cp * cy;
    var z = cam.zoom * (1 + 0.09 * push);
    return {
      m: new Float32Array([m00, m10, m20, m01, m11, m21, m02, m12, m22]),
      D: R * 1.9 / z, F: R * 1.9 * 0.97, R: R, w: w, h: h, cx: w / 2, cy: h / 2, dpr: 1, maxW: 40, ox: 0, oy: 0
    };
  };
  function project(V, p) {
    var m = V.m, x = p[0], y = p[1], z = p[2];
    var vx = m[0] * x + m[3] * y + m[6] * z, vy = m[1] * x + m[4] * y + m[7] * z, vz = m[2] * x + m[5] * y + m[8] * z;
    var zc = Math.max(1, V.D - vz), k = V.F / zc;
    return [V.cx + V.ox + vx * k, V.cy - V.oy - vy * k, k, zc];
  }

  /* transient photons: x,y,z, r,g,b,a, size, ox,oy */
  Swarm.prototype._dp = function (p, c, a, s, ox, oy) {
    if (this.nDyn >= 6000) return;
    var d = this.dyn, o = this.nDyn * 10;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
    d[o + 3] = c[0] / 255; d[o + 4] = c[1] / 255; d[o + 5] = c[2] / 255; d[o + 6] = a;
    d[o + 7] = s; d[o + 8] = ox || 0; d[o + 9] = oy || 0;
    this.nDyn++;
  };

  Swarm.prototype.draw = function (dt, model) {
    var t0 = performance.now();
    dt = Math.max(0.001, Math.min(0.05, dt || 0.016));
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc >= 1) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
    var canvas = this.canvas;
    var w = Math.max(10, canvas.clientWidth || canvas.getBoundingClientRect().width);
    var h = Math.max(10, canvas.clientHeight || canvas.getBoundingClientRect().height);
    var phoneW = w < 620;
    var dpr = this.ultra ? Math.min(3, global.devicePixelRatio || 1) : Math.min(phoneW ? 2 : 1.5, global.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    var gc = this.glCanvas;
    if (gc.width !== Math.round(w * dpr) || gc.height !== Math.round(h * dpr)) { gc.width = Math.round(w * dpr); gc.height = Math.round(h * dpr); }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (model) {
      this.state = model.state || this.state;
      this.confT = model.conf == null ? this.confT : model.conf;
      this.reduced = !!model.reduced;
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
    }
    var red = this.reduced;
    this._build(red ? 'reduced' : (phoneW ? 'phone' : 'desktop') + (this.boost ? '-boost' : '') + (this.ultra ? '-ultra' : ''));
    var R = (phoneW ? Math.min(w * 0.98, h * 0.95) : Math.min(w * 0.62, h * 1.05)) * (+canvas.dataset.scale || 1);
    this._t += red ? 0 : dt;
    var T = this._t;

    /* ---- springs (critically damped) ---- */
    if (red) {
      this.sConf.snap(this.confT); this.sStep.snap(this.step); this.sMerge.snap(this.mergeT); this.sEnergy.snap(this.energyT);
    }
    var conf = this.sConf.step(this.confT, dt);
    var sv = clamp(this.sStep.step(this.step, dt), 0, 7);
    var mE = clamp(this.sMerge.step(this.mergeT, dt, this.mergeT > this.sMerge.x ? (this.boost ? 6.5 : 3.4) : 2.4), 0, 1);
    var E = red ? 0 : clamp(this.sEnergy.step(this.energyT, dt), 0, 1);
    /* intensity arc (shared by all looks): builds through confirming / trigger armed, peaks at fire, stays high for the
       whole trade (scaled by weakness energy), unwinds at exit or invalidation */
    var arc = clamp(this.sArc.step(arcTarget(this), dt, arcTarget(this) > this.sArc.x ? 3.2 : 1.3), 0, 1);
    if (red) { this.sArc.snap(arcTarget(this)); arc = this.sArc.x; }
    E = Math.max(E, arc);
    var tradePulse = red ? 0.5 * arc * this.mergeT : this.mergeT * arc * Math.pow(0.5 + 0.5 * Math.sin(T * 4.6), 2);
    this.bristle += (this.bristleT - this.bristle) * Math.min(1, dt * (red ? 10 : 4));
    if (this.snapT > 0) this.snapT = Math.max(0, this.snapT - dt);
    var tight = sv / 7;
    var flatT = Math.max(tight * 0.85, this.mergeT);
    var flat = red ? flatT : clamp(this.sFlat.step(flatT, dt, this.snapT > 0 ? 7.5 : 2.4), 0, 1.05);
    if (red) this.sFlat.snap(flatT);
    if (this.scatter > 0) this.scatter = Math.max(0, this.scatter - dt * 0.32);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.haloSig > 0) this.haloSig = Math.max(0, this.haloSig - dt);
    if (this.eyeLock > 0) this.eyeLock = Math.max(0, this.eyeLock - dt);
    if (this.eyeWarn > 0) this.eyeWarn = Math.max(0, this.eyeWarn - dt);
    if (this.crack > 0) this.crack = Math.max(0, this.crack - dt);
    if (this.dim > 0) this.dim = Math.max(0, this.dim - dt * 0.9);
    if (this.stepFlash > 0) this.stepFlash = Math.max(0, this.stepFlash - dt * 1.4);
    for (var lg = 0; lg < 5; lg++) this.laneGlow[lg] = Math.max(0, this.laneGlow[lg] - dt * 0.8);
    if (this.scatter > 0 && !red) this._tumT += dt * 2.4;
    if (!red && this.eyeLock <= 0) this.eyeAng += dt * 0.32;
    var s0 = Math.floor(sv), s1 = Math.min(7, s0 + 1), sf = sv - s0;
    var stepOrbit = lerp(STEP_ORBIT[s0], STEP_ORBIT[s1], sf);
    var stepRing = lerp(STEP_RING[s0], STEP_RING[s1], sf);

    /* ---- lane weights from the ladder (confirmed tf +2, hot +1) -> density + glow ---- */
    var nodes = this.nodes, wts = [1, 1, 1, 1, 1], hotK = -1;
    for (var ni = 0; ni < nodes.length; ni++) {
      var kk0 = TFS.indexOf(nodes[ni].tf);
      if (kk0 < 0) continue;
      if (nodes[ni].lit) wts[kk0] += 2;
      if (nodes[ni].hot) { wts[kk0] += 1; hotK = kk0; }
    }
    var vis = red ? 1 : 0.76 + 0.24 * E;
    var laneDen = wts.map(function (x) { return clamp((0.42 + 0.19 * x) * vis, 0, 1); });
    var laneBright = wts.map(function (x) { return 0.8 + 0.12 * x; });

    var baseCore = hotK >= 0 ? STAGE[hotK] : mix(PEARL, STAGE[1], 0.2);
    var coreCol = mix(baseCore, SIGNAL_L, mE);
    if (this.flashT > 0) coreCol = mix(coreCol, this.flashCol, Math.min(1, this.flashT));

    /* lane planes: inclination collapses toward one disc with each step (flat at fire); invalidation tumbles them */
    var planes = [];
    for (var pl = 0; pl < 5; pl++) {
      var inc = INCL[pl] * DEG * (1 - Math.min(1, flat));
      var om = NODE[pl] * DEG + T * 0.06 * (pl % 2 ? -1 : 1) * (1 - Math.min(1, flat));
      if (this.scatter > 0.01) {
        inc += this.scatter * TUMB[pl] * 1.1 * Math.sin(this._tumT + pl * 1.7);
        om += this.scatter * TUMB[pl] * this._tumT * 0.8;
      }
      planes.push(planeBasis(inc, om));
    }
    var haloR = R * 0.45;
    var orbitBoost = this.boost && phoneW ? 1 + 0.22 * clamp((sv - 2) / 4, 0, 1) : 1; /* grows in as the rings tighten: full +22% from step 6 */
    var orbitR = R * stepOrbit * orbitBoost;
    if (this.scatter > 0) orbitR = lerp(orbitR, R * 0.5, this.scatter);
    var coreR = Math.max(22, Math.min(46, R * 0.085));
    var singleR = Math.max(orbitR * 0.95, coreR + 18);
    var brVis = this.scatter > 0.12 ? 0 : Math.min(1, this.bristle / 0.34);

    /* ---- integrate orbital phases (continuous, so speed changes never jump) ---- */
    var dirMerge = mE >= 0.5;
    for (var L = 0; L < 5; L++) {
      var laneSpeed = 1 - (4 - L) * 0.12;
      var om2 = 0.55 * laneSpeed * lerp(0.7, 2.4, Math.max(tight, mE)) * (1 + 1.5 * E) * ((L % 2) && !dirMerge ? -1 : 1);
      this.laneOm[L] = red ? 0 : om2;
      this.lanePh[L] += red ? 0 : om2 * dt;
    }
    var spin = Math.min(2.4 + 1.4 * arc * this.mergeT, lerp(0.35, 1.6, tight) * (1 + 0.9 * E) * (1 + 0.7 * arc * this.mergeT));
    this.ringOm = red ? [0, 0, 0] : [spin, -spin * 0.82, spin * 0.55];
    for (var rr = 0; rr < 3; rr++) this.ringRot[rr] += this.ringOm[rr] * dt;
    this._haloRot += red ? 0 : dt * 0.05;
    this._coreRot += red ? 0 : dt * (0.6 + 1.6 * E + tight);
    this._pulseT += red ? 0 : dt * (2.5 + 9 * E);

    /* ---- evidence streams from the ladder chips into the core ---- */
    var sA = [], sB = [], sC = [], sCol = [], sSpd = [];
    for (var si = 0; si < 5; si++) {
      var nd = nodes[si] || { tf: TFS[si], y: h / 2 };
      var cv = this._curve3(nd, si, R, h);
      sA.push(cv[0][0], cv[0][1], cv[0][2]); sB.push(cv[1][0], cv[1][1], cv[1][2]); sC.push(0, 0, 0);
      var sc = c01(mix(STAGE[si], SIGNAL_L, mE * 0.6)); sCol.push(sc[0], sc[1], sc[2]);
      var dTarget = nd.hot ? 1 : nd.lit ? 0.62 : 0.16;
      dTarget *= (brVis > 0.25 || mE > 0.6) ? 0.15 : 1;
      dTarget = Math.min(1, dTarget * (1 + 0.8 * E));
      this.streamDen[si] += (dTarget - this.streamDen[si]) * Math.min(1, dt * 2.5);
      if (red) this.streamDen[si] = dTarget;
      var spd = (nd.hot ? 0.75 : nd.lit ? 0.48 : 0.2) * (1 + 0.7 * E) * (this.scatter > 0.35 ? -1.6 : 1);
      sSpd.push(red ? 0 : spd);
      this.streamPh[si] += red ? 0 : spd * dt;
    }

    /* ---- uniforms ---- */
    var LU = [], LV = [], LN = [], LCol = [], LR = [];
    for (var l2 = 0; l2 < 5; l2++) {
      var B = planes[l2];
      LU.push(B.u[0], B.u[1], B.u[2]); LV.push(B.v[0], B.v[1], B.v[2]); LN.push(B.n[0], B.n[1], B.n[2]);
      var lc = mix(STAGE[l2], SIGNAL_L, mE);
      if (this.flashT > 0 && this.flash !== 'entry') lc = mix(lc, this.flashCol, Math.min(1, this.flashT) * 0.6);
      var lb = laneBright[l2];
      LCol.push(lc[0] / 255 * lb, lc[1] / 255 * lb, lc[2] / 255 * lb);
      LR.push(orbitR * LANE[l2]);
    }
    var RU = [], RV = [], RN = [], RRr = [];
    var ringBase = R * stepRing * orbitBoost, rk = [0.7, 0.95, 1.2];
    for (var r3 = 0; r3 < 3; r3++) {
      var PB = planes[BAND_LANE[r3]];
      RU.push(PB.u[0], PB.u[1], PB.u[2]); RV.push(PB.v[0], PB.v[1], PB.v[2]); RN.push(PB.n[0], PB.n[1], PB.n[2]);
      RRr.push(ringBase * rk[r3]);
    }
    var ra = this.scatter > 0.15 ? lerp(0.6, 0.35, this.scatter) : lerp(0.66, 1.0, tight);
    ra = Math.min(1.3, ra + this.stepFlash * 0.45) * (1 - 0.3 * this.dim);
    var haloCol = PEARL;
    if (this.haloSig > 0) haloCol = mix(PEARL, this.haloSigCol, Math.min(1, this.haloSig));
    var bsum = this.bias.bear + this.bias.bull;
    var amberShare = bsum > 0.15 ? this.bias.bull / bsum : 0;
    var hA = (0.75 + 0.3 * Math.min(1, bsum / 3)) * (this.boost ? 1.25 : 1);
    var ed = this._eyeDir();
    var cp = red ? 0 : Math.max(0, Math.sin(this._pulseT)) * (0.04 + E * 0.12);
    var flashK = this.flashT > 0 ? Math.pow(Math.min(1, this.flashT / 1.1), 2.2) : 0;
    var thick = orbitR * 0.055 * (1 - Math.min(1, flat) * 0.8);
    var ringColA = c01(coreCol);
    var U = {
      uTime: T, uStreak: red ? 0 : (0.045 + 0.05 * E + 0.03 * tight), uGain: this.ultra ? 0.5 : 1,
      uLU: { t: 3, v: LU }, uLV: { t: 3, v: LV }, uLN: { t: 3, v: LN }, uLCol: { t: 3, v: LCol },
      uLR: { t: 1, v: LR }, uLPh: { t: 1, v: this.lanePh }, uLOm: { t: 1, v: this.laneOm }, uLDen: { t: 1, v: laneDen }, uLGlow: { t: 1, v: this.laneGlow },
      uMerge: mE, uSingleR: singleR, uDiscW: orbitR * 1.15, uThick: thick, uTight: tight, uBristle: brVis, uScatter: this.scatter,
      uScatterR: R * 0.55 * Math.min(1, (1 - this.scatter) * 3 + 0.2), uE: E, uDim: this.dim,
      uRU: { t: 3, v: RU }, uRV: { t: 3, v: RV }, uRN: { t: 3, v: RN }, uRR: { t: 1, v: RRr }, uRRot: { t: 1, v: this.ringRot }, uROm: { t: 1, v: this.ringOm },
      uRCol: { t: 3, v: ringColA }, uRA: ra * 0.75,
      uSA: { t: 3, v: sA }, uSB: { t: 3, v: sB }, uSC: { t: 3, v: sC }, uSCol: { t: 3, v: sCol }, uSPh: { t: 1, v: this.streamPh }, uSDen: { t: 1, v: this.streamDen }, uSSpd: { t: 1, v: sSpd },
      uHR: haloR, uHRot: this._haloRot, uHA: hA, uAmber: amberShare, uCrack: this.crack, uHCol: { t: 3, v: c01(haloCol) }, uEye: { t: 3, v: ed }, uWarn: { t: 3, v: c01(WARN) },
      uCR: coreR, uCPulse: cp + flashK * 0.5, uCRot: this._coreRot, uCA: (1 + 0.4 * E + flashK * 1.6 + 0.5 * tradePulse) * (1 - 0.25 * this.dim), uCCol: { t: 3, v: c01(coreCol) }
    };

    /* ---- transient photons ---- */
    this.nDyn = 0;
    var phone = phoneW;
    /* trade-fire shockwave: an expanding photon shell plus an equatorial ring wave */
    for (var shI = this.shock.length - 1; shI >= 0; shI--) {
      var sh = this.shock[shI];
      sh.t += dt / (red ? 0.35 : this.boost ? 1.9 : 1.5);
      if (sh.t >= 1 || red) { this.shock.splice(shI, 1); continue; }
      var e1 = 1 - Math.pow(1 - sh.t, 3);
      var shr = lerp(coreR * 0.8, R * (sh.big ? 0.95 : 0.8), e1);
      var sha = Math.pow(1 - sh.t, 1.6) * (sh.big ? 1.3 : 1.0) * (this.boost ? 1.7 : 1);
      var bz = this.boost ? 1.35 : 1;
      var nsh = phone ? (this.boost ? 520 : 260) : (this.boost ? 1300 : 720);
      for (var sj = 0; sj < nsh; sj++) {
        var fd = fib(sj, nsh), jr = shr * (1 + ((sj * 37) % 11 - 5) * 0.006);
        this._dp([fd[0] * jr, fd[1] * jr * 0.85, fd[2] * jr], sj % 4 ? sh.col : WHITE, sha * 0.55, (sj % 4 ? 3.2 : 2.2) * bz);
        if (this.boost && !(sj % 3)) { var jr2 = jr * 0.8; this._dp([fd[0] * jr2, fd[1] * jr2 * 0.85, fd[2] * jr2], WHITE, sha * 0.3, 2.4); }
      }
      var nring = phone ? (this.boost ? 300 : 160) : (this.boost ? 640 : 420);
      var PR = planes[2];
      for (var rj = 0; rj < nring; rj++) {
        var ang = rj / nring * Math.PI * 2, rrj = shr * 1.12 + ((rj * 13) % 7) * 2;
        this._dp(onPlane(PR, ang, rrj), rj % 3 ? sh.col : WHITE, sha * 0.9, 4 * bz);
      }
    }
    /* VSA bear ripples: spherical shells collapsing inward */
    for (var ri = this.ripples.length - 1; ri >= 0; ri--) {
      var rp = this.ripples[ri];
      rp.t += dt / (red ? 0.4 : 1.2);
      if (rp.t >= 1) { this.ripples.splice(ri, 1); continue; }
      var re = rp.t < 0.5 ? 4 * rp.t * rp.t * rp.t : 1 - Math.pow(-2 * rp.t + 2, 3) / 2;
      var rrr = lerp(haloR, R * 0.07, re);
      var rpa = Math.min(1, (1 - rp.t * 0.8) * (0.6 + rp.s * 0.2));
      var rcol = mix(PEARL, STAGE[rp.k], 0.7);
      var rn = phone ? 200 : 520;
      var cs = Math.cos(rp.seed), sn = Math.sin(rp.seed);
      for (var rq = 0; rq < rn; rq++) {
        var qd = fib(rq, rn);
        var qp = [(qd[0] * cs - qd[2] * sn) * rrr, qd[1] * rrr, (qd[0] * sn + qd[2] * cs) * rrr];
        this._dp(qp, rq % 4 ? rcol : WHITE, rpa * 0.75, rq % 4 ? 3.6 + rp.s : 2);
      }
    }
    /* notch, glyphs */
    if (this.notchOn) {
      if (this.notch == null) this.notch = ed.slice();
      for (var nk = -4; nk <= 4; nk++) { var nr = haloR + nk * 3.5; this._dp([this.notch[0] * nr, this.notch[1] * nr, this.notch[2] * nr], WARN, 0.95 - Math.abs(nk) * 0.08, 4.4); }
    } else this.notch = null;
    for (var gi = this.glyphs.length - 1; gi >= 0; gi--) {
      var gph = this.glyphs[gi];
      gph.life -= dt / 9;
      if (gph.life <= 0) { this.glyphs.splice(gi, 1); continue; }
      var gr = haloR + 12, gp = [gph.d[0] * gr, gph.d[1] * gr, gph.d[2] * gr];
      this._dp(gp, gph.dir === 'bear' ? STAGE[gph.k] : WARN, Math.min(1, gph.life * 1.4), 8);
      this._dp(gp, WHITE, Math.min(0.9, gph.life), 2.6);
    }
    /* the eye: a star flare on the overseer with photon lens spikes (screen-space offsets), plus gaze / amber tether */
    var eyeCol = this.eyeWarn > 0 ? mix(PEARL, WARN, Math.min(1, this.eyeWarn * 1.5)) : (this.haloSig > 0 ? haloCol : PEARL);
    var E3 = [ed[0] * haloR, ed[1] * haloR, ed[2] * haloR];
    var gazeR = lerp(orbitR * LANE[this.eyeLane], singleR, mE);
    var L3 = onPlane(planes[this.eyeLane], this.eyeAng, gazeR);
    var C3 = [(E3[0] + L3[0]) * 0.5 + ed[0] * haloR * 0.25, (E3[1] + L3[1]) * 0.5 + haloR * 0.22, (E3[2] + L3[2]) * 0.5 + ed[2] * haloR * 0.25];
    var tether = this.eyeLock > 0;
    var gn = tether ? (phone ? 40 : 90) : 10;
    for (var gk = 0; gk < gn; gk++) {
      var gt = red ? (gk + 0.5) / gn : ((T * (tether ? 1.3 : 0.35) * 3 + gk / gn) % 1);
      var g3 = qb(E3, C3, L3, gt);
      this._dp(g3, tether ? WARN : eyeCol, tether ? 0.9 : 0.28, tether ? 3.4 : 2.4);
    }
    if (tether) for (var tk = 0; tk < 14; tk++) {
      var ta = tk / 14 * Math.PI * 2 + T * 3;
      this._dp([L3[0] + Math.cos(ta) * 9, L3[1] + Math.sin(ta) * 9, L3[2] + Math.sin(ta + 1) * 4], WARN, 0.85, 3.4);
    }
    var tw = red ? 1 : 0.85 + 0.15 * Math.sin(T * 5.3);
    this._dp(E3, eyeCol, 0.5 * tw, 26);
    this._dp(E3, WHITE, 1.4, 7);
    this._dp(E3, WHITE, 1.0, 3.5);
    var spikeN = 9, spikeL = (phone ? 26 : 40) * tw;
    for (var sp2 = 1; sp2 <= spikeN; sp2++) {
      var f = sp2 / spikeN, sa = Math.pow(1 - f, 1.6) * 0.95, ss = 3.4 * (1 - f * 0.6);
      var off = f * spikeL;
      this._dp(E3, eyeCol, sa, ss, off, 0); this._dp(E3, eyeCol, sa, ss, -off, 0);
      this._dp(E3, eyeCol, sa * 0.8, ss, 0, off * 0.8); this._dp(E3, eyeCol, sa * 0.8, ss, 0, -off * 0.8);
      if (sp2 <= 4) {
        var od = off * 0.45;
        this._dp(E3, eyeCol, sa * 0.45, ss * 0.8, od, od); this._dp(E3, eyeCol, sa * 0.45, ss * 0.8, -od, od);
        this._dp(E3, eyeCol, sa * 0.45, ss * 0.8, od, -od); this._dp(E3, eyeCol, sa * 0.45, ss * 0.8, -od, -od);
      }
    }
    /* nucleus: white-hot point and a soft volumetric glow */
    this._dp([0, 0, 0], WHITE, (0.55 + 0.35 * E + flashK * 2.5) * (1 - 0.25 * this.dim), coreR * 0.32);
    this._dp([0, 0, 0], coreCol, (0.08 + 0.06 * E + flashK * 0.5), coreR * 1.8);
    /* sat anchors on the shared plane (glow only; text on the overlay) */
    var outer = coreR + lerp(98, 56, conf), inner = coreR + 40;
    var satPos = [];
    for (var st = 0; st < this.sats.length; st++) {
      var sat = this.sats[st];
      sat.lockT += ((sat.lock ? 1 : 0) - sat.lockT) * Math.min(1, dt * 4);
      if (!red) sat.ang += dt * (sat.lock ? 0.7 : 0.28);
      var srad = lerp(outer, inner, sat.lockT);
      var spos = [Math.cos(sat.ang) * srad, 0, Math.sin(sat.ang) * srad];
      var hot = sat.lockT > 0.45;
      this._dp(spos, hot ? coreCol : PEARL, hot ? 1.0 : 0.6, hot ? 8 : 5.5);
      satPos.push([sat.id, spos]);
    }

    /* ---- render ---- */
    var V = this._camera(dt, w, h, R);
    V.dpr = dpr; V.maxW = phone ? 26 : 40;
    /* optional orbit centre offset for asymmetric layouts: data-cx / data-cy as fractions of the stage */
    V.ox = ((+canvas.dataset.cx || 0.5) - 0.5) * w + (phone && !canvas.dataset.cx ? 22 : 0); V.oy = -((+canvas.dataset.cy || 0.5) - 0.5) * h;
    var keep = red ? 0 : clamp(0.74 + 0.1 * E + 0.04 * tight, 0, 0.9);
    var post = {
      keep: keep, thr: 0.85, knee: 0.5, time: T,
      arc: arc, expo: 1.06 + 0.04 * E + 0.05 * tradePulse, flash: flashK * (this.flash === 'entry' ? 1.4 : 1), flashCol: c01(mix(this.flashCol, WHITE, 0.5)),
      grain: 0.018, hy: +canvas.dataset.hy || (phone ? 0.2 : 0.24), bloom: (0.55 + 0.2 * E + flashK * 0.7 + 0.12 * arc + 0.3 * tradePulse) * (this.ultra ? 1.25 : 1), vig: 0.55
    };
    var cpj = project(V, [0, 0, 0]); post.core = [cpj[0] / w, 1 - cpj[1] / h];
    if (!this.lost) {
      try { this.hq.render(V, U, this.dyn, this.nDyn, post); }
      catch (e) { this.lost = true; if (global.console) console.warn('HQ renderer stopped:', e.message); }
    }

    /* ---- crisp overlay text (no glow, never bloomed) ---- */
    ctx.clearRect(0, 0, w, h);
    var c0p = project(V, [0, 0, 0]);
    var shade = shadeSprite();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0;
    ctx.font = '700 ' + (phone ? 9.5 : 10.5) + 'px "Geist Mono", ui-monospace, monospace';
    /* label layout: start just outside each anchor along its radial direction (clear of the core),
       then relax pairwise overlaps with a minimum gap, moving labels outward along their own radials */
    var labs = [], coreRx = coreR * c0p[2] + 30, coreRy = coreR * c0p[2] * 0.62 + 18, GAP = 8, LH = 20;
    for (var sq = 0; sq < satPos.length; sq++) {
      var pp = project(V, satPos[sq][1]);
      var ux = pp[0] - c0p[0], uy = pp[1] - c0p[1], ul = Math.hypot(ux, uy);
      if (ul < 1) { ux = Math.cos(sq); uy = Math.sin(sq); ul = 1; }
      ux /= ul; uy /= ul;
      var tw2 = ctx.measureText(satPos[sq][0]).width + 14;
      /* minimum radius: outside the core ellipse along this direction */
      var rMin = 1 / Math.sqrt((ux * ux) / (coreRx * coreRx) + (uy * uy) / (coreRy * coreRy));
      labs.push({ t: satPos[sq][0], ux: ux, uy: uy, r: Math.max(ul + 16, rMin), w: tw2 });
    }
    for (var it = 0; it < 24; it++) {
      var moved = false;
      for (var la = 0; la < labs.length; la++) for (var lb2 = la + 1; lb2 < labs.length; lb2++) {
        var A = labs[la], Bq = labs[lb2];
        var ax = c0p[0] + A.ux * A.r, ay = c0p[1] + A.uy * A.r, bx = c0p[0] + Bq.ux * Bq.r, by = c0p[1] + Bq.uy * Bq.r;
        var ox = (A.w + Bq.w) / 2 + GAP - Math.abs(ax - bx), oy = LH + GAP - Math.abs(ay - by);
        if (ox > 0 && oy > 0) {
          /* push the outer one outward (or both if level) by the smaller overlap */
          var push = Math.min(ox, oy) * 0.6 + 1;
          if (A.r > Bq.r + 2) A.r += push; else if (Bq.r > A.r + 2) Bq.r += push; else { A.r += push * 0.5; Bq.r += push; }
          moved = true;
        }
      }
      if (!moved) break;
    }
    /* clamp into the stage, then separate any overlaps the clamp re-created (vertical moves, min gap) */
    var xMin = 8;
    for (var lq0 = 0; lq0 < labs.length; lq0++) {
      var L0 = labs[lq0];
      L0.x = clamp(c0p[0] + L0.ux * L0.r, L0.w / 2 + xMin, w - L0.w / 2 - 6);
      L0.y = clamp(c0p[1] + L0.uy * L0.r, 12, h - 12);
      if (L0.x + L0.w / 2 > w - (phone ? 196 : 400) && L0.y < (phone ? 48 : 88)) L0.y = phone ? 48 : 88;   /* keep clear of the LOOK switcher + temp speed tool */
    }
    for (var it2 = 0; it2 < 16; it2++) {
      var mv2 = false;
      for (var ia = 0; ia < labs.length; ia++) for (var ib = ia + 1; ib < labs.length; ib++) {
        var P = labs[ia], Q = labs[ib];
        var dx2 = (P.w + Q.w) / 2 + GAP - Math.abs(P.x - Q.x), dy2 = LH + 8 - Math.abs(P.y - Q.y);
        if (dx2 > 0 && dy2 > 0) {
          var sgn = P.y < Q.y || (P.y === Q.y && ia < ib) ? -1 : 1, hm = dy2 / 2 + 0.5;
          P.y = clamp(P.y + sgn * hm, 12, h - 12); Q.y = clamp(Q.y - sgn * hm, 12, h - 12); mv2 = true;
        }
      }
      if (!mv2) break;
    }
    /* ease each label toward its target so the layout glides instead of jumping */
    var lp = this._labPos || (this._labPos = {}), lk = red ? 1 : 1 - Math.exp(-dt * 9);
    var drawn = [];
    for (var lq1 = 0; lq1 < labs.length; lq1++) {
      var Lb1 = labs[lq1], pv = lp[Lb1.t];
      if (!pv) pv = lp[Lb1.t] = { x: Lb1.x, y: Lb1.y };
      pv.x += (Lb1.x - pv.x) * lk; pv.y += (Lb1.y - pv.y) * lk;
      drawn.push(pv);
    }
    /* the eased positions can lag the targets while the swarm spins fast (in trade): separate them once more */
    for (var it3 = 0; it3 < 12; it3++) {
      var mv3 = false;
      for (var ja = 0; ja < labs.length; ja++) for (var jb = ja + 1; jb < labs.length; jb++) {
        var Pa = drawn[ja], Qb = drawn[jb];
        var dx3 = (labs[ja].w + labs[jb].w) / 2 + GAP - Math.abs(Pa.x - Qb.x), dy3 = LH + 8 - Math.abs(Pa.y - Qb.y);
        if (dx3 > 0 && dy3 > 0) {
          var sg3 = Pa.y <= Qb.y ? -1 : 1, hm3 = dy3 / 2 + 0.5;
          Pa.y = clamp(Pa.y + sg3 * hm3, 12, h - 12); Qb.y = clamp(Qb.y - sg3 * hm3, 12, h - 12); mv3 = true;
        }
      }
      if (!mv3) break;
    }
    for (var lq = 0; lq < labs.length; lq++) {
      var Lb = labs[lq], prv = drawn[lq];
      var lx = prv.x, ly = prv.y;
      ctx.drawImage(shade, lx - Lb.w / 2 - 6, ly - 12, Lb.w + 12, 24);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(Lb.t, lx, ly);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this.modeLabel = red ? 'Motion off' : this.scatter > 0.15 ? 'Planes tumbling' : mE > 0.5 ? 'Aligned · one disc' : 'Lanes · orbital planes';
    this.cpuMs = this.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  };

  global.Swarm = Swarm;
  /* shared kit for the alternate looks (assets/look-*.js) */
  global.SwarmKit = {
    HQ: HQ, Spring: Spring, COMP_FS: COMP_FS, destroy: Swarm.prototype.destroy, program: program, QVS: QVS, HASH: HASH, rng: rng, fib: fib, lerp: lerp, mix: mix, clamp: clamp, c01: c01,
    project: project, shadeSprite: shadeSprite, arcTarget: arcTarget, initInput: Swarm.prototype._initInput, orbitBy: Swarm.prototype.orbitBy,
    TFS: TFS, TFC: TFC, STAGE: STAGE, SIGNAL: SIGNAL, SIGNAL_L: SIGNAL_L, PEARL: PEARL, WARN: WARN, WHITE: WHITE, RED: RED, GOLD: GOLD,
    STEP_ORBIT: STEP_ORBIT, STEP_RING: STEP_RING
  };
})(window);
