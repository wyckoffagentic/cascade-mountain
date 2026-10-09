/* HLC chart for Cascade Mountain. Close tick is as thick as the high-low stem. */
(function (global) {
  'use strict';
  var UP = '#d9eef8';
  var DN = '#ff9c86';
  var GRID = 'rgba(214, 236, 255, 0.13)';
  var AXIS = '#ffffff';
  var EMA = { 10: '#7fd4ff', 20: '#c3a6ff', 50: '#f2dfae' };

  function ChartPane(canvas, tip) {
    this.canvas = canvas;
    this.tip = tip;
    this.inst = null;
    this.spec = null;
    this.tf = '5m';
    this.hover = null;
    this.cssW = 0;
    this.cssH = 0;
    this._growI = -1;
    this._growT = 0;
    this.pan = 0;
    this.follow = true;
    this._slot = 8;
    var self = this;
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.pan = Math.max(0, self.pan + (e.deltaY > 0 ? 8 : -8));
      self.follow = self.pan === 0;
    }, { passive: false });
    canvas.addEventListener('pointerdown', function (e) {
      self._drag = { x: e.clientX, pan: self.pan, moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!self._drag) { self._pointer(e.clientX, e.clientY); return; }
      var dx = e.clientX - self._drag.x;
      if (Math.abs(dx) > 4) self._drag.moved = true;
      if (!self._drag.moved) return;
      self.pan = Math.max(0, Math.round(self._drag.pan + dx / Math.max(4, self._slot)));
      self.follow = self.pan === 0;
      self.hover = null;
    });
    canvas.addEventListener('pointerup', function () { self._drag = null; });
    canvas.addEventListener('dblclick', function () { self.pan = 0; self.follow = true; });
    canvas.addEventListener('mousemove', function (e) { self._pointer(e.clientX, e.clientY); });
    canvas.addEventListener('mouseleave', function () { self.hover = null; if (self.tip) self.tip.hidden = true; });
    canvas.addEventListener('touchstart', function (e) {
      if (!e.touches[0]) return;
      self._pointer(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (!e.touches[0]) return;
      self._pointer(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  ChartPane.prototype.setSource = function (inst, spec) {
    this.inst = inst;
    this.spec = spec;
    this.pan = 0;
    this.follow = true;
  };

  ChartPane.prototype.setTf = function (tf) { this.tf = tf || '5m'; };

  /* Advisory VSA glyphs: the chart only reads findings, it never feeds anything back. */
  ChartPane.prototype.setVsa = function (fn) { this.vsaFn = fn; };

  var TF_COL = { '4h': '#8c9aff', '2h': '#3fb8ff', '30m': '#2fdccb', '15m': '#d68cff', '5m': '#ff8fa8' };
  ChartPane.prototype._vsa = function (ctx, bars, i0, i1, X, Y, L, plotB) {
    if (!this.vsaFn || i1 <= i0) return;
    var list = this.vsaFn() || [];
    var tStart = bars[i0].t, tEnd = bars[i1 - 1].t + 300000;
    var stack = {};
    for (var k = list.length - 1; k >= 0; k--) {
      var f = list[k];
      if (f.dir === 'neutral') continue;
      if (f.closeT <= tStart) break;
      if (f.closeT > tEnd + 1) continue;
      var lo = i0, hi = i1 - 1, j = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (bars[mid].t < f.closeT) { j = mid; lo = mid + 1; } else hi = mid - 1; }
      if (j < i0) continue;
      var key = j + f.dir;
      var n = stack[key] = (stack[key] || 0) + 1;
      if (n > 3) continue;
      var x = X(j);
      var size = 3 + f.strength;
      var y = f.dir === 'bear' ? Y(bars[j].h) - 7 - (n - 1) * (size * 2 + 2) : Y(bars[j].l) + 7 + (n - 1) * (size * 2 + 2);
      y = Math.max(L.t + 4, Math.min(plotB - 2, y));
      ctx.fillStyle = TF_COL[f.tf] || '#ffffff';
      ctx.strokeStyle = f.dir === 'bull' ? '#ffcc33' : 'rgba(5,9,14,0.9)';
      ctx.lineWidth = f.dir === 'bull' ? 1.6 : 1;
      ctx.beginPath();
      if (f.dir === 'bear') { ctx.moveTo(x - size, y - size); ctx.lineTo(x + size, y - size); ctx.lineTo(x, y + size * 0.6); }
      else { ctx.moveTo(x - size, y + size); ctx.lineTo(x + size, y + size); ctx.lineTo(x, y - size * 0.6); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  };

  ChartPane.prototype._series = function () {
    var inst = this.inst;
    if (!inst) return { bars: [], e10: [], e20: [], e50: [] };
    if (this.tf === '5m') return { bars: inst.m5, e10: inst.ema10, e20: inst.ema20, e50: inst.ema50 };
    var book = this.tf === '15m' ? inst.m15 : this.tf === '30m' ? inst.m30 : this.tf === '2h' ? inst.h2 : inst.h4;
    var bars = book.bars;
    return {
      bars: bars,
      e10: bars.map(function (b) { return b.e10; }),
      e20: bars.map(function (b) { return b.e20; }),
      e50: bars.map(function (b) { return b.e50; })
    };
  };

  ChartPane.prototype._layout = function (w, h) {
    var narrow = w < 520;
    return {
      l: 6, r: narrow ? 52 : 62, t: 14, b: 20,
      vol: Math.max(36, Math.round(h * 0.16)),
      plotB: 0
    };
  };

  ChartPane.prototype._pointer = function (cx, cy) {
    var rect = this.canvas.getBoundingClientRect();
    var x = cx - rect.left, y = cy - rect.top;
    this.hover = { x: x, y: y };
  };

  function yOf(v, lo, hi, top, bot) {
    if (hi === lo) return (top + bot) / 2;
    return top + (hi - v) / (hi - lo) * (bot - top);
  }

  ChartPane.prototype.draw = function (now, motion) {
    var canvas = this.canvas;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(10, rect.width), h = Math.max(10, rect.height);
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    this.cssW = w; this.cssH = h;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var spec = this.spec;
    var S = this._series();
    var bars = S.bars;
    if (!bars.length || !spec) {
      ctx.fillStyle = AXIS;
      ctx.font = '12px Manrope, system-ui, sans-serif';
      ctx.fillText('Waiting for bars…', 12, 24);
      return;
    }
    var visN = w < 520 ? 64 : 78;
    var i1 = bars.length - (this.pan | 0);
    if (i1 > bars.length) i1 = bars.length;
    if (i1 < Math.min(visN, bars.length)) i1 = Math.min(visN, bars.length);
    var i0 = Math.max(0, i1 - visN);
    if (bars.length - i1 !== this.pan) this.pan = Math.max(0, bars.length - i1);
    var L = this._layout(w, h);
    var plotB = h - L.b - L.vol - 6;
    L.plotB = plotB;
    var lo = Infinity, hi = -Infinity, vmax = 1;
    for (var i = i0; i < i1; i++) {
      var b = bars[i];
      if (b.l < lo) lo = b.l;
      if (b.h > hi) hi = b.h;
      if (b.v > vmax) vmax = b.v;
    }
    if (!isFinite(lo) || hi === lo) { lo -= spec.tick * 4; hi += spec.tick * 4; }
    var pad = (hi - lo) * 0.1;
    lo -= pad; hi += pad;
    var span0 = Math.max(hi - lo, spec.tick * 8);
    var mid0 = (hi + lo) / 2;
    for (var ei = i0; ei < i1; ei++) {
      var ev = S.e10[ei];
      if (ev != null && Math.abs(ev - mid0) < span0 * 0.65) { if (ev < lo) lo = ev; if (ev > hi) hi = ev; }
    }
    var n = i1 - i0;
    var innerW = w - L.l - L.r;
    var slot = innerW / Math.max(1, n);
    this._slot = slot;
    function X(i) { return L.l + (i - i0 + 0.35) * slot; }
    function Y(v) { return yOf(v, lo, hi, L.t, plotB); }

    ctx.font = '11px "Geist Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(5, 10, 15, 0.6)';
    ctx.fillRect(0, plotB + 4, w, L.vol + L.b);
    for (var g = 0; g < 4; g++) {
      var gy = L.t + (plotB - L.t) * g / 3;
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.l, gy);
      ctx.lineTo(w - L.r + 4, gy);
      ctx.stroke();
      var pv = hi - (hi - lo) * g / 3;
      ctx.fillStyle = AXIS;
      ctx.textAlign = 'left';
      ctx.fillText(DMF.fmtPx(spec, pv), w - L.r + 8, gy + 4);
    }

    var last = bars[bars.length - 1];
    if (this._growI !== bars.length - 1) { this._growI = bars.length - 1; this._growT = now; }
    var grow = 1;
    if (motion) {
      var age = now - this._growT;
      grow = age > 180 ? 1 : (0.25 + 0.75 * (age / 180));
    }

    var stem = Math.max(1.8, Math.min(3.1, slot * 0.34));
    for (var j = i0; j < i1; j++) {
      var bar = bars[j];
      var prev = j > 0 ? bars[j - 1].c : bar.o;
      var up = bar.c >= prev;
      var x = X(j);
      var yH = Y(bar.h), yL = Y(bar.l), yC = Y(bar.c);
      if (j === i1 - 1 && grow < 1) {
        var mid = (yH + yL) / 2;
        yH = mid + (yH - mid) * grow;
        yL = mid + (yL - mid) * grow;
        yC = mid + (yC - mid) * grow;
      }
      ctx.strokeStyle = up ? UP : DN;
      ctx.lineWidth = stem;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.moveTo(x, yC);
      ctx.lineTo(x + Math.max(3.5, slot * 0.42), yC);
      ctx.stroke();
      var vh = (bar.v / vmax) * (L.vol - 4);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = up ? UP : DN;
      ctx.fillRect(x - Math.max(1, stem * 0.45), h - L.b - vh, Math.max(1.5, stem), vh);
      ctx.globalAlpha = 1;
    }

    drawEma(ctx, S.e10, i0, i1, X, Y, EMA[10]);
    drawEma(ctx, S.e20, i0, i1, X, Y, EMA[20]);
    drawEma(ctx, S.e50, i0, i1, X, Y, EMA[50]);

    if (this.tf === '5m') this._overlays(ctx, bars, i0, i1, X, Y, lo, hi, L, plotB, w, now, motion);
    this._vsa(ctx, bars, i0, i1, X, Y, L, plotB);

    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = '700 12px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.follow ? 'SIMULATED' : 'SIMULATED · PAN', L.l + 2, L.t + 12);

    var ticks = 4;
    ctx.font = '10px "Geist Mono", ui-monospace, monospace';
    ctx.fillStyle = AXIS;
    ctx.textAlign = 'center';
    for (var t = 0; t < ticks; t++) {
      var ii = Math.round(i0 + (n - 1) * t / (ticks - 1));
      ii = Math.max(i0, Math.min(i1 - 1, ii));
      var lab = DMF.fmtZone(bars[ii].t, 'syd').clock.replace(/\s+\w+$/, '');
      ctx.fillText(lab, X(ii), h - 6);
    }

    if (this.hover) this._cross(ctx, bars, i0, i1, X, Y, L, plotB, w, h, slot);
    else if (this.tip) this.tip.hidden = true;

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 11px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    var ly = Y(last.c);
    ly = Math.max(L.t + 8, Math.min(plotB - 4, ly));
    ctx.fillText(DMF.fmtPx(spec, last.c), w - L.r + 8, ly + 4);
  };

  function drawEma(ctx, arr, i0, i1, X, Y, color) {
    ctx.beginPath();
    var started = false;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.35;
    for (var i = i0; i < i1; i++) {
      if (arr[i] == null) continue;
      var x = X(i), y = Y(arr[i]);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ChartPane.prototype._overlays = function (ctx, bars, i0, i1, X, Y, lo, hi, L, plotB, w, now, motion) {
    var inst = this.inst;
    var spec = this.spec;
    var xEnd = w - L.r;
    var labelY = [];
    var offscreen = [];
    function hline(px, color, label, dash) {
      if (px == null || !isFinite(px)) return;
      var y = Y(px);
      var edge = false;
      if (px < lo || px > hi) { offscreen.push(label + ' ' + DMF.fmtPx(spec, px)); return; }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 1.25;
      ctx.setLineDash(dash || [4, 3]);
      ctx.beginPath();
      ctx.moveTo(L.l, y);
      ctx.lineTo(xEnd, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.font = '700 11px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      var ly = Math.max(L.t + 12, Math.min(plotB - 6, y - 2));
      var nudge = 0;
      while (nudge < 10 && labelY.some(function (u) { return Math.abs(u - ly) < 13; })) { ly -= 13; nudge++; }
      labelY.push(ly);
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(5, 10, 15, 0.85)';
      ctx.fillRect(xEnd - tw - 8, ly - 11, tw + 6, 14);
      ctx.fillStyle = color;
      ctx.fillText(label, xEnd - 4, ly);
      ctx.restore();
    }
    var lines = inst.lines || {};
    var tick = spec.tick;
    function near(a, b) { return a != null && b != null && Math.abs(a - b) <= tick * 4; }
    if (inst.trailHist && inst.trailHist.length) hline(inst.trailHist[inst.trailHist.length - 1].y, '#ff8a4c', 'TRAIL', []);
    if (lines.psl != null && !near(lines.psl, lines.target) && !near(lines.psl, lines.swing)) hline(lines.psl, '#c9d6ff', 'PSL', [2, 3]);
    if (lines.swing != null && !near(lines.swing, lines.target)) hline(lines.swing, '#a9b6ff', 'SWING', [2, 3]);
    if (lines.r3 != null && !near(lines.r3, lines.target) && !near(lines.r3, lines.r2)) hline(lines.r3, '#fff0c9', '3R', [5, 3]);
    hline(lines.r2, '#ffe08a', '2R', [5, 3]);
    hline(lines.target, '#6dff9e', 'TGT', []);
    hline(lines.stop, '#ff9c86', 'STOP', []);
    if (offscreen.length) {
      ctx.save();
      ctx.font = '700 10px "Geist Mono", ui-monospace, monospace';
      ctx.fillStyle = '#ffd9c4';
      ctx.textAlign = 'left';
      ctx.fillText('Below window: ' + offscreen.join('  ·  '), L.l + 2, plotB - 4);
      ctx.restore();
    }

    if (inst.trailHist && inst.trailHist.length) {
      ctx.save();
      ctx.beginPath();
      var started = false;
      var pts = [];
      inst.trailHist.forEach(function (pt) {
        if (pt.i < i0 || pt.i >= i1) return;
        pts.push(pt);
      });
      if (pts.length) {
        ctx.fillStyle = 'rgba(255, 138, 76, 0.24)';
        ctx.beginPath();
        pts.forEach(function (pt, k) {
          var x = X(pt.i), y = Y(pt.y);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        for (var k = pts.length - 1; k >= 0; k--) ctx.lineTo(X(pts[k].i), Y(pts[k].top));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ff8a4c';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([]);
        ctx.beginPath();
        pts.forEach(function (pt, k) {
          var x = X(pt.i), y = Y(pt.y);
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    var marks = [
      inst.markers.nd && { m: inst.markers.nd, text: 'ND', color: '#7fd4ff', dy: -12 },
      inst.markers.ut && { m: inst.markers.ut, text: inst.markers.ut.kind || 'UT', color: '#d68cff', dy: -26 },
      inst.markers.confirm && { m: inst.markers.confirm, text: 'CFM', color: '#ffe08a', dy: 14 },
      inst.markers.entry && { m: inst.markers.entry, text: 'SHORT', color: '#6dff9e', dy: -12, arrow: true },
      inst.markers.exit && { m: inst.markers.exit, text: 'EXIT', color: inst.markers.exit.pnl >= 0 ? '#6dff9e' : '#ff9c86', dy: 16 }
    ].filter(Boolean);

    var used = [];
    marks.forEach(function (mk) {
      var i = mk.m.i;
      if (i == null || i < i0 || i >= i1) return;
      var x = X(i);
      var y = (mk.dy > 0 ? Y(bars[i].l) : Y(bars[i].h)) + mk.dy;
      var guard = 0;
      while (guard++ < 6 && used.some(function (u) { return Math.abs(u.x - x) < 34 && Math.abs(u.y - y) < 13; })) y += (mk.dy >= 0 ? 13 : -13);
      used.push({ x: x, y: y });
      var sc = 1;
      if (motion && mk.m._born == null) mk.m._born = now;
      if (motion && mk.m._born) {
        var a = (now - mk.m._born) / 280;
        sc = a >= 1 ? 1 : 0.4 + 0.6 * a;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.fillStyle = mk.color;
      ctx.strokeStyle = '#06101a';
      ctx.lineWidth = 3;
      ctx.font = '700 11px "Geist Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.strokeText(mk.text, 0, 0);
      ctx.fillText(mk.text, 0, 0);
      if (mk.arrow) {
        ctx.beginPath();
        ctx.moveTo(0, 6);
        ctx.lineTo(-5, 16);
        ctx.lineTo(5, 16);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    });
  };

  ChartPane.prototype._cross = function (ctx, bars, i0, i1, X, Y, L, plotB, w, h, slot) {
    var hx = this.hover.x;
    if (hx < L.l || hx > w - L.r) { if (this.tip) this.tip.hidden = true; return; }
    var idx = Math.round(i0 + (hx - L.l) / slot - 0.35);
    idx = Math.max(i0, Math.min(i1 - 1, idx));
    var b = bars[idx];
    var x = X(idx);
    ctx.save();
    ctx.strokeStyle = 'rgba(159, 211, 238, 0.85)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, L.t);
    ctx.lineTo(x, plotB);
    ctx.moveTo(L.l, this.hover.y);
    ctx.lineTo(w - L.r, this.hover.y);
    ctx.stroke();
    ctx.restore();
    if (!this.tip) return;
    var syd = DMF.fmtZone(b.t, 'syd');
    var et = DMF.fmtZone(b.t, 'et');
    var inst = this.inst;
    var e10 = this.tf === '5m' ? inst.ema10[idx] : b.e10;
    var e20 = this.tf === '5m' ? inst.ema20[idx] : b.e20;
    var e50 = this.tf === '5m' ? inst.ema50[idx] : b.e50;
    var spec = this.spec;
    this.tip.hidden = false;
    this.tip.innerHTML =
      '<b>' + syd.full + '</b>' +
      '<div class="sub">' + et.full + ' ET session</div>' +
      '<div class="pxs">' +
      '<span>O ' + DMF.fmtPx(spec, b.o) + '</span>' +
      '<span>H ' + DMF.fmtPx(spec, b.h) + '</span>' +
      '<span>L ' + DMF.fmtPx(spec, b.l) + '</span>' +
      '<span>C ' + DMF.fmtPx(spec, b.c) + '</span>' +
      '</div>' +
      '<div>Vol ' + Math.round(b.v).toLocaleString('en-US') + '</div>' +
      '<div class="emas">EMA10 ' + DMF.fmtPx(spec, e10) + ' · 20 ' + DMF.fmtPx(spec, e20) + ' · 50 ' + DMF.fmtPx(spec, e50) + '</div>';
    var tw = this.tip.offsetWidth || 180;
    var left = x + 12;
    if (left + tw > w - 4) left = x - tw - 8;
    var top = Math.max(8, Math.min(h - 90, this.hover.y + 10));
    this.tip.style.left = left + 'px';
    this.tip.style.top = top + 'px';
  };

  global.ChartPane = ChartPane;
})(window);
