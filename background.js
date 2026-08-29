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
    gradientFrom: '#777778',
    gradientTo: '#7aa5eb'
  };

  var canvas = document.createElement('canvas');
  canvas.id = 'bg-dotfield';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(canvas);

  var ctx = canvas.getContext('2d', { alpha: true });
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var dots = [];
  var mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 };
  var size = { w: 0, h: 0, offsetX: 0, offsetY: 0 };
  var engagement = 0;
  var rafId = null;
  var idle = false;
  var lastActive = Date.now();

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    // canvas 为 fixed 定位，应铺满当前视口，尺寸取视口而非父元素内容高度
    var w = window.innerWidth;
    var h = window.innerHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    size.w = w;
    size.h = h;
    // fixed 元素锚定视口，左上角即视口原点，无需叠加滚动偏移
    size.offsetX = 0;
    size.offsetY = 0;

    buildDots(w, h);

    // 冻结态下窗口变化后补画一帧静态画面，避免空白
    if (idle || reduceMotion) drawFrame();
  }

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    lastActive = Date.now();
    if (idle) {
      idle = false;
      start();
    }
  }

  function drawFrame() {
    ctx.clearRect(0, 0, size.w, size.h);

    var grad = ctx.createLinearGradient(0, 0, size.w, size.h);
    grad.addColorStop(0, config.gradientFrom);
    grad.addColorStop(1, config.gradientTo);
    ctx.fillStyle = grad;

    var rad = config.dotRadius / 2;
    var len = dots.length;

    ctx.beginPath();
    for (var i = 0; i < len; i++) {
      var d = dots[i];
      ctx.moveTo(d.sx + rad, d.sy);
      ctx.arc(d.sx, d.sy, rad, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function tick() {
    // 更新鼠标速度与参与度
    var dx = mouse.prevX - mouse.x;
    var dy = mouse.prevY - mouse.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    mouse.speed += (dist - mouse.speed) * 0.5;
    if (mouse.speed < 0.001) mouse.speed = 0;
    mouse.prevX = mouse.x;
    mouse.prevY = mouse.y;

    var targetEngagement = Math.min(mouse.speed / 5, 1);
    engagement += (targetEngagement - engagement) * 0.06;
    if (engagement < 0.001) engagement = 0;

    // 点阵物理：光标附近凸起，离开后弹回
    var cr = config.cursorRadius;
    var crSq = cr * cr;
    var len = dots.length;
    for (var i = 0; i < len; i++) {
      var d = dots[i];
      var px = mouse.x - d.ax;
      var py = mouse.y - d.ay;
      var distSq = px * px + py * py;

      if (distSq < crSq && engagement > 0.01) {
        var pointDist = Math.sqrt(distSq);
        var t = 1 - pointDist / cr;
        var push = t * t * config.bulgeStrength * engagement;
        var angle = Math.atan2(py, px);
        d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15;
        d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15;
      } else {
        d.sx += (d.ax - d.sx) * 0.1;
        d.sy += (d.ay - d.sy) * 0.1;
      }
    }

    // 空闲 2.5s 后冻结画布（省电），鼠标一动立即恢复，视觉无感
    if (engagement === 0 && (Date.now() - lastActive) > 2500) {
      idle = true;
      rafId = null;
      return;
    }

    drawFrame();
    rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (!rafId && !reduceMotion) rafId = requestAnimationFrame(tick);
  }

  doResize();
  window.addEventListener('resize', doResize);

  if (reduceMotion) {
    // 减弱动效偏好：只绘制一帧静态点阵，不进入动画循环
    drawFrame();
  } else {
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    start();
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', function() {
    if (rafId) cancelAnimationFrame(rafId);
  });
})();