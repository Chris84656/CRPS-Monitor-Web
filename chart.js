/* ============================================================
   CRPS Power Monitor — Chart Management
   ============================================================ */

// ===== 1. State =====
var chartState = {
  selectedIndicators: [],
  chartInstances: {},
  paused: {},
  updateTimer: null
};

// ===== 2. Chip Bar =====
function buildChipBar() {
  var bar = document.getElementById('chip-bar');
  if (!bar) return;
  bar.innerHTML = '';

  // Restore from localStorage or use defaults
  var saved = localStorage.getItem('crps_chart_indicators');
  chartState.selectedIndicators = saved ? JSON.parse(saved) : window.__crpsDefaultSelected.slice();

  window.__crpsIndicatorKeys.forEach(function(key) {
    var chip = document.createElement('button');
    chip.className = 'chip' + (chartState.selectedIndicators.indexOf(key) !== -1 ? ' selected' : '');
    chip.textContent = window.__crpsIndicatorLabels[key];
    chip.dataset.key = key;

    chip.addEventListener('click', function() {
      var idx = chartState.selectedIndicators.indexOf(key);
      if (idx !== -1) {
        // Don't allow deselecting the last indicator
        if (chartState.selectedIndicators.length <= 1) return;
        chartState.selectedIndicators.splice(idx, 1);
        chip.classList.remove('selected');
      } else {
        chartState.selectedIndicators.push(key);
        chip.classList.add('selected');
      }
      localStorage.setItem('crps_chart_indicators', JSON.stringify(chartState.selectedIndicators));
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

  // Remove old chart instances
  var oldKeys = Object.keys(chartState.chartInstances);
  oldKeys.forEach(function(key) {
    if (chartState.chartInstances[key]) {
      chartState.chartInstances[key].dispose();
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
    });

    controls.appendChild(live);
    controls.appendChild(pauseBtn);
    header.appendChild(title);
    header.appendChild(controls);

    var container = document.createElement('div');
    container.className = 'chart-canvas-container';
    container.id = 'chart-container-' + key;

    card.appendChild(header);
    card.appendChild(container);

    grid.appendChild(card);

    // Initialize ECharts
    initChart(key);
  });
}

// Helper: hex to rgba
function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(function(c) { return c + c; }).join('');
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// 自适应 Y 轴范围 — 根据实际数据计算，带 padding 防止曲线贴边
function calcYAxisRange(data) {
  if (!data || data.length === 0) return { min: 0, max: 100 };

  var minVal = Infinity, maxVal = -Infinity;
  for (var i = 0; i < data.length; i++) {
    var v = data[i][1];
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }

  var range = maxVal - minVal;
  var mid = (maxVal + minVal) / 2;

  // 最小范围取数据中值的 8%，防止微小波动导致 Y 轴大幅缩放
  if (range < 0.5) range = 0.5;
  var minRange = Math.abs(mid) * 0.08;
  if (range < minRange) range = minRange;

  var paddingTop = range * 0.2;
  var paddingBottom = range * 0.1;

  var min = minVal - paddingBottom;
  var max = maxVal + paddingTop;

  // 如果数据全是正数，下限不低于 0
  if (minVal >= 0) min = Math.max(0, min);

  return { min: min, max: max };
}

// 初始宽泛默认范围，覆盖常见电源参数
var DEFAULT_RANGES = {
  vin:  { min: 0,   max: 300 },
  iin:  { min: 0,   max: 10  },
  vout: { min: 0,   max: 15  },
  iout: { min: 0,   max: 30  },
  pout: { min: 0,   max: 500 },
  eff:  { min: 0,   max: 100 },
  fan:  { min: 0,   max: 10000 },
  t1:   { min: 0,   max: 100 },
  t2:   { min: 0,   max: 100 }
};

// ===== 4. Chart Initialization =====
function initChart(key) {
  var container = document.getElementById('chart-container-' + key);
  if (!container || typeof echarts === 'undefined') return;

  var chart = echarts.init(container);
  chartState.chartInstances[key] = chart;
  chartState.paused[key] = false;

  var color = window.__crpsIndicatorColors[key] || '#0071e3';
  var range = DEFAULT_RANGES[key] || { min: 0, max: 100 };

  chart.setOption({
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: {
      show: false,
      type: 'time',
      min: Date.now() - 60000,
      max: Date.now()
    },
    yAxis: { show: false, type: 'value', min: range.min, max: range.max },
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        var p = params[0];
        var d = new Date(p.data[0]);
        var time = d.toLocaleTimeString('zh-CN', { hour12: false });
        var val = p.data[1];
        var label = window.__crpsIndicatorLabels[key] || key;
        return label + '<br/>' + time + '  ' + val;
      }
    },
    series: [{
      type: 'line',
      smooth: false,
      animation: false,
      showSymbol: false,
      lineStyle: { width: 2, color: color },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: hexToRgba(color, 0.3) },
            { offset: 1, color: hexToRgba(color, 0.02) }
          ]
        },
        opacity: 1
      },
      data: []
    }]
  });

  // Handle resize
  var ro = new ResizeObserver(function() {
    chart.resize();
  });
  ro.observe(container);
}

// ===== 5. Chart Update Loop =====
function updateCharts() {
  var now = Date.now();
  var timeWindow = 60000; // 60 seconds

  chartState.selectedIndicators.forEach(function(key) {
    var chart = chartState.chartInstances[key];
    if (!chart || chartState.paused[key]) return;

    var buf = window.__crpsDataBuffers[key] || [];

    // Filter data within 60s window
    var filtered = buf.filter(function(p) {
      return (now - p[0]) <= timeWindow;
    });

    // Pad to fill full chart width — extend first point to left edge
    if (filtered.length > 0) {
      var leftEdge = now - timeWindow;
      var first = filtered[0];
      if (first[0] > leftEdge) {
        filtered.unshift([leftEdge, first[1]]);
      }
    }

    // Adaptive Y-axis range from actual data
    var yRange = calcYAxisRange(filtered);

    chart.setOption({
      xAxis: { min: now - timeWindow, max: now },
      yAxis: { min: yRange.min, max: yRange.max },
      series: [{ data: filtered }]
    }, { notMerge: false });
  });
}

// ===== 6. Data Update Callback =====
window.__crpsOnDataUpdate = function() {
  // Throttled: update at most every 250ms
  if (!chartState.updateTimer) {
    chartState.updateTimer = setTimeout(function() {
      chartState.updateTimer = null;
      updateCharts();
    }, 250);
  }
};

// ===== 7. Resize Handling =====
window.addEventListener('resize', function() {
  Object.keys(chartState.chartInstances).forEach(function(key) {
    if (chartState.chartInstances[key]) {
      chartState.chartInstances[key].resize();
    }
  });
});

// ===== 8. Init =====
buildChipBar();
rebuildChartGrid();