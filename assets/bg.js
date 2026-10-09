/* Very low-contrast drifting star field behind the page. Static when motion is off. */
(function () {
  'use strict';
  var c = document.getElementById('bg');
  if (!c) return;
  var ctx = c.getContext('2d');
  var stars = [];
  var w = 0, h = 0, dpr = 1;
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  function size() {
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    var n = w < 560 ? 45 : 110;
    stars = [];
    for (var i = 0; i < n; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, z: 0.3 + Math.random() * 0.7, tw: Math.random() * 6 });
    paint(0);
  }
  function still() { return mq.matches || document.body.classList.contains('rm'); }
  function paint(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var a = 0.1 + 0.12 * s.z * (still() ? 1 : (0.6 + 0.4 * Math.sin(t * 0.0006 + s.tw)));
      ctx.fillStyle = 'rgba(214,236,255,' + a.toFixed(3) + ')';
      ctx.fillRect(s.x, s.y, s.z * 1.6, s.z * 1.6);
    }
  }
  var last = 0;
  function frame(t) {
    if (!still() && t - last > 50) {
      var dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        s.y -= dt * 4 * s.z; s.x += dt * 1.5 * s.z;
        if (s.y < -2) { s.y = h + 2; s.x = Math.random() * w; }
        if (s.x > w + 2) s.x = -2;
      }
      paint(t);
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', size);
  size();
  requestAnimationFrame(frame);
})();
