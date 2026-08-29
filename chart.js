/* ============================================================
   CRPS Power Monitor — Chart Management
   基于 TradingView lightweight-charts v5 重写
   特性：滚动窗口跟随（Motion 补间丝滑滑动）、1Hz 采样、
   Curved 平滑曲线、Y 轴只扩不缩（10s 周期收缩）、
   十字光标磁吸 + 悬浮提示、单图暂停 / LIVE 徽标
   ============================================================ */

// ===== 1. State =====
var chartState = {
  selectedIndicators: [],
  chartInstances: {},   // key -> instance
  paused: {},
  updateTimer: null,
  reduceMotion: false
};

var TIME_WINDOW = 60; // 秒，滑动窗口

// 各指标小数位与单位
var INDICATOR_DECIMALS = { vin: 2, iin: 2, vout: 2, iout: 2, pout: 1, eff: 1, fan: 0, t1: 1, t2: 1 };
var INDICATOR_UNITS    = { vin: 'V', iin: 'A', vout: 'V', iout: 'A', pout: 'W', eff: '%', fan: 'RPM', t1: '°C', t2: '°C' };

// Y 轴最小显示跨度比例（=|中心值|×比例），压平小幅噪声带来的"假性大波动"
var INDICATOR_SPAN_RATIO = { vin: 0.03, iin: 0.05, vout: 0.03, iout: 0.05, pout: 0.05, eff: 0.04, fan: 0.04, t1: 0.05, t2: 0.05 };
// 曲线数值平滑系数（指数移动平均，按指标分档：越大越跟手、越小越平缓）
// 电流/功率/风扇变化快，取高 α 恢复响应；电压/温度/效率本身噪声小，保持中等平滑。
var SMOOTH_ALPHA = { vin: 0.5, iin: 0.65, vout: 0.5, iout: 0.65, pout: 0.65, eff: 0.5, fan: 0.7, t1: 0.4, t2: 0.4 };
var SMOOTH_ALPHA_DEFAULT = 0.5;
// 跳变直通阈值：新值与平滑值偏差超过（|旧值|×6%，且至少 0.5）时认为是真实电平跳变
// （开关机、负载突变），直接把平滑值重置为新值，避免曲线"爬坡式"慢慢追。
var SNAP_RATIO = 0.06;
var SNAP_MIN_ABS = 0.5;

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function formatValue(key, v) {
  return v.toFixed(INDICATOR_DECIMALS[key] || 0);
}

// ===== 2. Chip Bar =====
function buildChipBar() {
  var bar = document.getElementById('chip-bar');
  if (!bar) return;
  bar.innerHTML = '';

  var saved = null;
  try { saved = localStorage.getItem('crps_chart_indicators'); } catch (e) {}
  var parsed = null;
  try { parsed = saved ? JSON.parse(saved) : null; } catch (e) {}
  chartState.selectedIndicators = (parsed && parsed.length) ? parsed : window.__crpsDefaultSelected.slice();

  window.__crpsIndicatorKeys.forEach(function(key) {
    var chip = document.createElement('button');
    chip.className = 'chip' + (chartState.selectedIndicators.indexOf(key) !== -1 ? ' selected' : '');
    chip.textContent = window.__crpsIndicatorLabels[key];
    chip.dataset.key = key;

    chip.addEventListener('click', function() {
      var idx = chartState.selectedIndicators.indexOf(key);
      if (idx !== -1) {
        // 至少保留一个指标
        if (chartState.selectedIndicators.length <= 1) return;
        chartState.selectedIndicators.splice(idx, 1);
        chip.classList.remove('selected');
      } else {
        chartState.selectedIndicators.push(key);
        chip.classList.add('selected');
      }
      try { localStorage.setItem('crps_chart_indicators', JSON.stringify(chartState.selectedIndicators)); } catch (e) {}
      rebuildChartGrid();
    });

    bar.appendChild(chip);
  });
}

// ===== 3. Chart Grid =====
function rebuildChartGrid() {
  var grid = document.getElementById('chart-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // 销毁旧实例
  var oldKeys = Object.keys(chartState.chartInstances);
  oldKeys.forEach(function(key) {
    var inst = chartState.chartInstances[key];
    if (inst) {
      if (inst.resizeObserver) { try { inst.resizeObserver.disconnect(); } catch (e) {} }
      try { inst.chart.remove(); } catch (e) {}
    }
  });
  chartState.chartInstances = {};
  chartState.paused = {};

  chartState.selectedIndicators.forEach(function(key) {
    var card = document.createElement('div');
    card.className = 'chart-card liquid-glass';
    card.id = 'chart-card-' + key;

    var header = document.createElement('div');
    header.className = 'chart-card-header';

    var title = document.createElement('span');
    title.className = 'chart-card-title';
    title.textContent = window.__crpsIndicatorLabels[key];

    var controls = document.createElement('div');
    controls.className = 'chart-card-controls';

    // 当前值（颜色跟随指标曲线）
    var curVal = document.createElement('span');
    curVal.className = 'chart-curval';
    curVal.id = 'curval-' + key;
    curVal.textContent = '--';
    var seriesColor = window.__crpsIndicatorColors[key] || '#0071e3';
    curVal.style.color = seriesColor;

    var live = document.createElement('span');
    live.className = 'live-badge';
    live.textContent = 'LIVE';
    live.id = 'live-' + key;

    var pauseBtn = document.createElement('span');
    pauseBtn.className = 'chart-pause-btn';
    pauseBtn.innerHTML = '<span class="material-symbols-outlined">pause_circle</span>';
    pauseBtn.dataset.key = key;

    pauseBtn.addEventListener('click', function() {
      var k = this.dataset.key;
      chartState.paused[k] = !chartState.paused[k];
      var icon = this.querySelector('.material-symbols-outlined');
      icon.textContent = chartState.paused[k] ? 'play_circle' : 'pause_circle';
      var liveEl = document.getElementById('live-' + k);
      if (liveEl) liveEl.style.opacity = chartState.paused[k] ? '0.4' : '1';
      // 恢复时立即拉取最新窗口
      if (!chartState.paused[k]) {
        var inst = chartState.chartInstances[k];
        if (inst) { inst.restart = true; }
      }
    });

    controls.appendChild(curVal);
    controls.appendChild(live);
    controls.appendChild(pauseBtn);
    header.appendChild(title);
    header.appendChild(controls);

    var container = document.createElement('div');
    container.className = 'chart-canvas-container';
    container.id = 'chart-container-' + key;

    // 十字光标悬浮提示
    var tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    container.appendChild(tooltip);

    card.appendChild(header);
    card.appendChild(container);
    grid.appendChild(card);

    initChart(key, tooltip);
  });

  // 重建后立即同步一次数据
  updateChartsImmediate();
}

// ===== 4. Chart Initialization =====
function initChart(key, tooltip) {
  var container = document.getElementById('chart-container-' + key);
  if (!container || typeof LightweightCharts === 'undefined') return;

  var inst = {
    key: key,
    container: container,
    tooltip: tooltip,
    lastConsumedT: -Infinity,
    bucketSec: null,
    bucketValue: 0,
    ema: null,           // 曲线平滑状态（指数移动平均）
    data: [],            // {time(秒), value}
    lastInteract: 0,
    rangeAnim: null,
    restart: false,
    resizeObserver: null
  };
  chartState.chartInstances[key] = inst;

  // 跟随当前主题的十字线颜色
  function getCrosshairColor() {
    var css = getComputedStyle(document.documentElement).getPropertyValue('--outline').trim() || '#8d919a';
    return hexToRgba(css, 0.7);
  }

  var chart = LightweightCharts.createChart(container, {
    // 不用 autoSize：devicePixelRatio 为小数(如1.71)时会向下取整出 1~2px 缝隙，
    // 露出卡片半透明白背景，形成“会闪的白色横线”。改用显式尺寸 + overflow:hidden 裁掉溢出。
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: LightweightCharts.ColorType.Solid, color: 'transparent' },
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
      attributionLogo: false
    },
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false }
    },
    rightPriceScale: { visible: false, borderVisible: false },
    timeScale: {
      visible: false,
      borderVisible: false,
      rightOffset: 0,
      lockVisibleTimeRangeOnResize: true
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Magnet,
      vertLine: {
        color: getCrosshairColor(),
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelVisible: false
      },
      horzLine: { visible: false, labelVisible: false }
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: false,
      vertTouchDrag: false
    },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: false
    },
    kineticScroll: { mouse: true, touch: true }
  });

  var color = window.__crpsIndicatorColors[key] || '#0071e3';

  // Y 轴只扩不缩：数据越界立即扩大，每 10s 才允许收缩（消除“呼吸抖动”）
  var lo = Infinity, hi = -Infinity, lastShrink = 0, lastDataTs = 0;

  var series = chart.addSeries(LightweightCharts.AreaSeries, {
    lineColor: color,
    lineWidth: 2,
    topColor: hexToRgba(color, 0.26),
    bottomColor: hexToRgba(color, 0.015),
    lineType: LightweightCharts.LineType.Simple, // Simple 直线连接：Curved(Catmull-Rom)在陡变处会过冲/过降
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    baseLineVisible: false,
    autoscaleInfoProvider: function(original) {
      var vals = [];
      for (var i = 0; i < inst.data.length; i++) vals.push(inst.data[i].value);
      if (vals.length === 0) return (typeof original === 'function' && original()) || null;

      var mn = Infinity, mx = -Infinity;
      for (var j = 0; j < vals.length; j++) {
        if (vals[j] < mn) mn = vals[j];
        if (vals[j] > mx) mx = vals[j];
      }

      // 断开/长时间无数据后重置
      if (lastDataTs && (Date.now() - lastDataTs) > 15000) { lo = Infinity; hi = -Infinity; }
      if (mx > hi) hi = mx;
      if (mn < lo) lo = mn;
      // 周期收缩 + 阻尼
      if (Date.now() - lastShrink > 10000) { lo = mn; hi = mx; lastShrink = Date.now(); }

      var range = hi - lo;
      if (range < 1e-6) range = 1;

      // 最小跨度下限：数据只在小范围波动时也保持足够 Y 轴宽度，
      // 避免 0.05V 这类小幅噪声被缩放成满屏起伏（用局部变量，不回写持久 lo/hi）。
      var outLo = lo, outHi = hi;
      var center = (outLo + outHi) / 2;
      var minSpan = Math.abs(center) * (INDICATOR_SPAN_RATIO[key] || 0.04);
      if (range < minSpan) {
        outLo = center - minSpan / 2;
        outHi = center + minSpan / 2;
        range = minSpan;
      }

      var padTop = range * 0.18;
      var padBottom = range * 0.08;
      var min = outLo - padBottom;
      var max = outHi + padTop;
      if (outLo >= 0) min = Math.max(0, min);

      return { priceRange: { minValue: min, maxValue: max } };
    }
  });

  inst.chart = chart;
  inst.series = series;

  // ===== 十字光标提示 =====
  chart.subscribeCrosshairMove(function(param) {
    if (!param.point || !param.time) {
      tooltip.style.display = 'none';
      container.style.cursor = 'default';
      return;
    }
    var val = param.seriesData.get(series);
    container.style.cursor = 'crosshair';
    if (val === undefined) {
      tooltip.style.display = 'none';
      return;
    }

    var d = new Date(val.time * 1000);
    var timeStr = d.toLocaleTimeString('zh-CN', { hour12: false });
    var valueStr = formatValue(key, val.value) + ' ' + INDICATOR_UNITS[key];

    tooltip.innerHTML =
      '<div class="ct-time">' + timeStr + '</div>' +
      '<div class="ct-val">' + valueStr + '</div>';
    tooltip.style.display = 'block';
    tooltip.style.color = color;

    // 定位：跟随光标，边缘翻转
    var w = container.clientWidth;
    var h = container.clientHeight;
    var tw = tooltip.offsetWidth;
    var th = tooltip.offsetHeight;
    var x = param.point.x + 14;
    var y = param.point.y + 14;
    if (x + tw > w - 6) x = param.point.x - tw - 14;
    if (y + th > h - 6) y = param.point.y - th - 14;
    tooltip.style.left = Math.max(4, x) + 'px';
    tooltip.style.top = Math.max(4, y) + 'px';
  });

  // 用户交互检测：交互期间不让程序滚动窗口抢控制权
  ['pointerdown', 'pointermove'].forEach(function(evt) {
    container.addEventListener(evt, function() { inst.lastInteract = Date.now(); }, { passive: true });
  });
  container.addEventListener('wheel', function(ev) {
    if (Math.abs(ev.deltaX) > 0) inst.lastInteract = Date.now();
  }, { passive: true });

  // 主题切换时更新十字线颜色
  var darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkMq.addEventListener) {
    darkMq.addEventListener('change', function() {
      chart.applyOptions({
        crosshair: { vertLine: { color: getCrosshairColor() } }
      });
    });
  }

  // 初始为空数据
  series.setData([]);

  // 关闭 autoSize 后，需自行跟随容器尺寸变化（含窗口缩放、字体加载导致的高度变化）
  if (typeof ResizeObserver !== 'undefined') {
    inst.resizeObserver = new ResizeObserver(function() {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
      });
    });
    inst.resizeObserver.observe(container);
  }
}

// ===== 5. 数据消费与采样（1Hz 桶，4Hz 原始数据取桶内最新值） =====
// 注意：app.js 的缓冲是环形缓冲（超 240 点会从头部 shift），
// 所以这里按“最后消费的时间戳”判定新数据，不能用绝对下标。
function consumeBuffer(inst) {
  var buf = window.__crpsDataBuffers[inst.key] || [];
  for (var i = 0; i < buf.length; i++) {
    var raw = buf[i];
    if (raw[0] <= inst.lastConsumedT) continue;
    inst.lastConsumedT = raw[0];

    var sec = Math.floor(raw[0] / 1000);
    if (inst.bucketSec === sec) {
      inst.bucketValue = raw[1]; // 同一秒内覆盖为最新值
    } else {
      if (inst.bucketSec !== null) {
        // 指数平滑去毛刺：新点 = 旧平滑值 + α×(新值 - 旧平滑值)
        var alpha = SMOOTH_ALPHA[inst.key] || SMOOTH_ALPHA_DEFAULT;
        if (inst.ema === null) inst.ema = inst.bucketValue;
        else {
          var dev = Math.abs(inst.bucketValue - inst.ema);
          var snapTh = Math.max(Math.abs(inst.ema) * SNAP_RATIO, SNAP_MIN_ABS);
          if (dev > snapTh) {
            // 真实电平跳变：直通新值，防止曲线缓慢爬坡追不上
            inst.ema = inst.bucketValue;
          } else {
            inst.ema = inst.ema + alpha * (inst.bucketValue - inst.ema);
          }
        }
        inst.data.push({ time: inst.bucketSec, value: inst.ema });
      }
      inst.bucketSec = sec;
      inst.bucketValue = raw[1];
    }
  }

  // 修剪窗口外旧点（留 10s 余量，避免边缘闪动）
  var cutoff = Math.floor(Date.now() / 1000) - TIME_WINDOW - 10;
  while (inst.data.length && inst.data[0].time < cutoff) inst.data.shift();
}

// ===== 6. 窗口跟随（同步锁定右边缘，避免补间与更新周期冲突导致曲线抽动） =====
function followTimeRange(inst) {
  // 无数据时 LWC 的 setVisibleRange 会触发内部断言，直接跳过
  if (!inst.data.length) return;

  var ts = inst.chart.timeScale();
  var nowSec = Date.now() / 1000;
  var targetFrom = nowSec - TIME_WINDOW;
  var targetTo = nowSec;

  // 用户正在平移/缩放 1.2s 内不接管
  if (Date.now() - inst.lastInteract < 1200) return;

  // 直接同步设置可见范围、锁定右边缘跟随实时。
  // 注：之前用 Motion 补间追赶目标，但补间时长(280ms)大于数据更新周期(250ms)，
  // 每次更新都会 stop/restart 动画，时间轴在帧间不连续，曲线左右抽动。
  // 60s 窗口每次随数据均匀前进 0.25s，直接 set 即可平滑滚动。
  ts.setVisibleRange({ from: targetFrom, to: targetTo });
}

// ===== 7. 更新循环 =====
function updateCharts() {
  chartState.selectedIndicators.forEach(function(key) {
    var inst = chartState.chartInstances[key];
    if (!inst || chartState.paused[key]) return;

    consumeBuffer(inst);
    inst.series.setData(inst.data);

    // 窗口跟随（首次/恢复播放/落后于数据时，Motion 补间滑动过去）
    inst.restart = false;
    followTimeRange(inst);

    // 头部当前值
    var curValEl = document.getElementById('curval-' + key);
    if (curValEl && inst.data.length) {
      var last = inst.data[inst.data.length - 1];
      curValEl.textContent = formatValue(key, last.value);
    }
    if (curValEl && !inst.data.length) curValEl.textContent = '--';
  });
}

// 重建图表卡后立即同步（不等下一个 tick）
function updateChartsImmediate() {
  if (chartState.updateTimer) {
    clearTimeout(chartState.updateTimer);
    chartState.updateTimer = null;
  }
  updateCharts();
}

// ===== 8. 数据更新回调（250ms 节流，同 BLE 数据节奏） =====
window.__crpsOnDataUpdate = function() {
  if (!chartState.updateTimer) {
    chartState.updateTimer = setTimeout(function() {
      chartState.updateTimer = null;
      updateCharts();
    }, 250);
  }
};

// 断开连接时清空图表
window.__crpsResetCharts = function() {
  Object.keys(chartState.chartInstances).forEach(function(key) {
    var inst = chartState.chartInstances[key];
    if (!inst) return;
    inst.lastConsumedT = -Infinity;
    inst.bucketSec = null;
    inst.bucketValue = 0;
    inst.data = [];
    inst.ema = null;
    inst.restart = true;
    try { inst.series.setData([]); } catch (e) {}
  });
};

// ===== 9. Reduced Motion =====
(function() {
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  chartState.reduceMotion = mq.matches;
  if (mq.addEventListener) {
    mq.addEventListener('change', function() { chartState.reduceMotion = mq.matches; });
  }
})();

// ===== 10. Init =====
buildChipBar();
rebuildChartGrid();