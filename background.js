/* ============================================================
   CRPS Power Monitor — DotField Particle Background
   Vanilla JS port of the DotField React component
   ============================================================ */

(function() {
  'use strict';

  var config = {
    dotRadius: 1,
    dotSpacing: 14,
    bulgeStrength: 30,
    cursorRadius: 500,
    cursorForce: 0.15,
    glowRadius: 160,
    gradientFrom: '#777778',
    gradientTo: '#7aa5eb',
    glowColor: '#120F17'
  };

  var canvas = document.createElement('canvas');
  canvas.id = 'bg-dotfield';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(canvas);

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(svg);

  var glowId = 'dot-field-glow-' + Math.random().toString(36).slice(2, 9);
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  var radialGrad = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
  radialGrad.setAttribute('id', glowId);
  var stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop1.setAttribute('offset', '0%');
  stop1.setAttribute('stop-color', config.glowColor);
  var stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
  stop2.setAttribute('offset', '100%');
  stop2.setAttribute('stop-color', 'transparent');
  radialGrad.appendChild(stop1);
  radialGrad.appendChild(stop2);
  defs.appendChild(radialGrad);
  svg.appendChild(defs);

  var glowCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  glowCircle.setAttribute('cx', '-9999');
  glowCircle.setAttribute('cy', '-9999');
  glowCircle.setAttribute('r', config.glowRadius);
  glowCircle.setAttribute('fill', 'url(#' + glowId + ')');
  glowCircle.style.cssText = 'opacity:0;will-change:opacity;';
  svg.appendChild(glowCircle);

  var ctx = canvas.getContext('2d', { alpha: true });
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var dots = [];
  var mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
  var size = { w: 0, h: 0, offsetX: 0, offsetY: 0 };
  var glowOpacity = 0;
  var engagement = 0;
  var rafId = null;
  var frameCount = 0;

  function buildDots(w, h) {
    var step = config.dotRadius + config.dotSpacing;
    var cols = Math.floor(w / step);
    var rows = Math.floor(h / step);
    var padX = (w % step) / 2;
    var padY = (h % step) / 2;
    var arr = [];

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var ax = padX + col * step + step / 2;
        var ay = padY + row * step + step / 2;
        arr.push({ ax: ax, ay: ay, sx: ax, sy: ay });
      }
    }
    dots = arr;
  }

  function doResize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    var w = rect.width;
    var h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    size.w = w;
    size.h = h;
    size.offsetX = rect.left + window.scrollX;
    size.offsetY = rect.top + window.scrollY;

    svg.style.width = w + 'px';
    svg.style.height = h + 'px';

    buildDots(w, h);
  }

  function onMouseMove(e) {
    mouse.x = e.pageX - size.offsetX;
    mouse.y = e.pageY - size.offsetY;
  }

  function updateMouseSpeed() {
    var dx = mouse.prevX - mouse.x;
    var dy = mouse.prevY - mouse.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    mouse.speed += (dist - mouse.speed) * 0.5;
    if (mouse.speed < 0.001) mouse.speed = 0;
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;
  }

  var speedInterval = setInterval(updateMouseSpeed, 20);

  function tick() {
    frameCount++;
    var len = dots.length;
    var w = size.w;
    var h = size.h;
    var m = mouse;
    var cr = config.cursorRadius;
    var crSq = cr * cr;
    var rad = config.dotRadius / 2;

    var targetEngagement = Math.min(m.speed / 5, 1);
    engagement += (targetEngagement - engagement) * 0.06;
    if (engagement < 0.001) engagement = 0;
    var eng = engagement;

    glowOpacity += (eng - glowOpacity) * 0.08;

    glowCircle.setAttribute('cx', m.x);
    glowCircle.setAttribute('cy', m.y);
    glowCircle.style.opacity = glowOpacity;

    ctx.clearRect(0, 0, w, h);

    var grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, config.gradientFrom);
    grad.addColorStop(1, config.gradientTo);
    ctx.fillStyle = grad;

    ctx.beginPath();

    for (var i = 0; i < len; i++) {
      var d = dots[i];
      var dx = m.x - d.ax;
      var dy = m.y - d.ay;
      var distSq = dx * dx + dy * dy;

      if (distSq < crSq && eng > 0.01) {
        var dist = Math.sqrt(distSq);
        var t = 1 - dist / cr;
        var push = t * t * config.bulgeStrength * eng;
        var angle = Math.atan2(dy, dx);
        d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15;
        d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15;
      } else {
        d.sx += (d.ax - d.sx) * 0.1;
        d.sy += (d.ay - d.sy) * 0.1;
      }

      ctx.moveTo(d.sx + rad, d.sy);
      ctx.arc(d.sx, d.sy, rad, 0, Math.PI * 2);
    }

    ctx.fill();
    rafId = requestAnimationFrame(tick);
  }

  doResize();
  window.addEventListener('resize', doResize);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  rafId = requestAnimationFrame(tick);

  // Cleanup on page unload
  window.addEventListener('beforeunload', function() {
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(speedInterval);
  });
})();