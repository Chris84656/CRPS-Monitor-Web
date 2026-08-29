/* ============================================================
   CRPS Power Monitor — Application Logic
   ============================================================ */

// ===== 1. BLE Constants =====
const BLE_SERVICE_UUID = '00001815-0000-1000-8000-00805f9b34fb';
const BLE_CHAR_DYNAMIC = '00002a56-0000-1000-8000-00805f9b34fb';
const BLE_CHAR_STATIC  = '00002a58-0000-1000-8000-00805f9b34fb';
const BLE_CHAR_CONTROL = '00002a57-0000-1000-8000-00805f9b34fb';
const DEVICE_NAME_PREFIX = 'CRPS Monitor_';

// ===== 2. Data Model =====
const dataModel = {
  dynamic: {
    vin: 0, iin: 0, vout: 0, iout: 0, pout: 0, eff: 0,
    fan: 0, t1: 0, t2: 0, rt: 0, pwr: 0,
    si: 0, sn: 0, st: 0, sf: 0
  },
  static: {
    mid: '', mm: '', mrev: '', msn: '', mloc: '', mdate: '',
    prev: 0, rimax: 0, rpmax: 0, rt1: 0, rt2: 0,
    received: false
  },
  prevDynamic: {}
};

// Chart data buffers (shared with chart.js)
window.__crpsDataBuffers = {};
window.__crpsIndicatorKeys = ['vin','iin','vout','iout','pout','eff','fan','t1','t2'];
window.__crpsIndicatorLabels = {
  vin:'输入电压 (V)', iin:'输入电流 (A)', vout:'输出电压 (V)', iout:'输出电流 (A)',
  pout:'输出功率 (W)', eff:'效率 (%)', fan:'风扇转速 (RPM)', t1:'环境温度 (°C)', t2:'热点温度 (°C)'
};
window.__crpsIndicatorColors = {
  vin:'#3B82F6', iin:'#FBBF24', vout:'#00D9FF', iout:'#EC4899',
  pout:'#FFA500', eff:'#14B8A6', fan:'#00FF88', t1:'#F97316', t2:'#A855F7'
};
window.__crpsDefaultSelected = ['vout','pout','fan','t2'];

// Initialize buffers
window.__crpsIndicatorKeys.forEach(function(key) {
  window.__crpsDataBuffers[key] = [];
});

// ===== 3. DOM References =====
var dom = {
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  btnConnect: document.getElementById('btn-connect'),
  btnConnectText: document.getElementById('btn-connect-text'),
  btnConnectLarge: document.getElementById('btn-connect-large'),
  disconnectedView: document.getElementById('disconnected-view'),
  connectingView: document.getElementById('connecting-view'),
  tabMonitor: document.getElementById('tab-monitor'),
  tabDevice: document.getElementById('tab-device'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  powerSwitch: document.getElementById('power-switch'),
  switchTrack: document.getElementById('switch-track'),
  switchKnob: document.getElementById('switch-knob'),
  toastContainer: document.getElementById('toast-container'),
  modalOverlay: document.getElementById('modal-overlay'),
  modalTitle: document.getElementById('modal-title'),
  modalBody: document.getElementById('modal-body'),
  modalActions: document.getElementById('modal-actions'),
  statusBar: document.getElementById('status-bar'),
  statusBarText: document.getElementById('status-bar-text')
};

// ===== 4. State =====
var bleState = {
  device: null,
  server: null,
  service: null,
  charDynamic: null,
  charStatic: null,
  charControl: null,
  connected: false,
  connecting: false,
  connectTimeout: null,
  packetBuffer: '',
  staticDataReceived: false,
  staticDataTimer: null,
  runtimeTimer: null
};

// ===== 4b. UI State (Motion) =====
var uiState = {
  reduceMotion: false,
  current: 'disconnected'
};

// 风扇图标上一次的旋转时长（避免每帧重复写 style）
var lastFanDuration = -1;

// ===== 5. Tab Switching =====
function performTabSwitch(tabId) {
  dom.tabButtons.forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  dom.tabMonitor.classList.toggle('active', tabId === 'monitor');
  dom.tabDevice.classList.toggle('active', tabId === 'device');
  moveTabIndicator();
}

function switchTab(tabId) {
  // 直接切换：View Transitions 会把半透明玻璃卡片单独快照，
  // 快照时 backdrop-filter 失效、遮罩闪到错误位置，并短暂覆盖 sticky 状态栏，故停用 VT。
  performTabSwitch(tabId);
}

// ===== 5b. Tab Indicator (Motion 弹簧滑动) =====
var tabIndicator = document.createElement('div');
tabIndicator.className = 'tab-indicator';
var tabBarEl = document.querySelector('.tab-bar');
if (tabBarEl) tabBarEl.appendChild(tabIndicator);

function moveTabIndicator(animate) {
  var activeBtn = document.querySelector('.tab-btn.active');
  if (!activeBtn || !tabBarEl) return;
  var left = activeBtn.offsetLeft;
  var w = activeBtn.offsetWidth;

  if (animate !== false && window.Motion && window.Motion.animate && !uiState.reduceMotion) {
    var curLeft = parseFloat(tabIndicator.style.left);
    var curW = parseFloat(tabIndicator.style.width);
    if (isNaN(curLeft)) curLeft = left;
    if (isNaN(curW)) curW = w;
    window.Motion.animate(tabIndicator,
      { left: [curLeft, left], width: [curW, w] },
      { type: 'spring', visualDuration: 0.45, bounce: 0.18 });
  } else {
    tabIndicator.style.left = left + 'px';
    tabIndicator.style.width = w + 'px';
  }
}

// 连接成功后监控卡片错峰入场
function animateMonitorEnter() {
  if (uiState.reduceMotion || !window.Motion || !window.Motion.animate) return;
  var cards = document.querySelectorAll('#tab-monitor .data-card, #tab-monitor .chart-card, #tab-monitor .status-card-simple');
  cards.forEach(function(card, i) {
    window.Motion.animate(card,
      { opacity: [0, 1], y: [16, 0] },
      { duration: 0.5, delay: 0.05 + i * 0.045, easing: 'easeOut' });
  });
}

dom.tabButtons.forEach(function(btn) {
  btn.addEventListener('click', function() {
    switchTab(btn.dataset.tab);
  });
});

// ===== 7. Toast System =====
function showToast(type, message) {
  var icons = { success: 'check_circle', warning: 'warning', error: 'error' };
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.innerHTML = '<span class="material-symbols-outlined">' + (icons[type] || 'info') + '</span>' + message;
  dom.toastContainer.appendChild(toast);
  setTimeout(function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

// ===== 8. Modal System =====
function showModal(title, body, actions) {
  dom.modalTitle.textContent = title;
  dom.modalBody.innerHTML = body;
  dom.modalActions.innerHTML = '';
  actions.forEach(function(action) {
    var btn = document.createElement('button');
    btn.className = 'modal-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', function(e) {
      if (action.callback) action.callback(e);
    });
    dom.modalActions.appendChild(btn);
  });
  dom.modalOverlay.classList.remove('hidden');
}

function closeModal() {
  dom.modalOverlay.classList.add('hidden');
}

// ===== 9. Runtime Formatting =====
function formatRuntime(seconds) {
  if (seconds === 0) return '0秒';
  var s = seconds % 60;
  var m = Math.floor(seconds / 60) % 60;
  var h = Math.floor(seconds / 3600) % 24;
  var d = Math.floor(seconds / 86400);
  var parts = [];
  if (d > 0) parts.push(d + '天');
  if (h > 0) parts.push(h + '小时');
  if (m > 0) parts.push(m + '分');
  parts.push(s + '秒');
  return parts.join('');
}

// ===== 10. Data Card Update =====
function updateDataCards() {
  var d = dataModel.dynamic;
  var fields = {
    vin: d.vin.toFixed(2),
    iin: d.iin.toFixed(2),
    vout: d.vout.toFixed(2),
    iout: d.iout.toFixed(2),
    pout: d.pout.toFixed(1),
    eff: d.eff.toFixed(1),
    fan: Math.round(d.fan),
    t1: d.t1.toFixed(1),
    t2: d.t2.toFixed(1),
    rt: formatRuntime(d.rt),
    pwr: d.pwr === 1 ? 'ON' : 'OFF'
  };

  Object.keys(fields).forEach(function(key) {
    var el = document.querySelector('[data-field="' + key + '"]');
    if (el) {
      el.textContent = fields[key];
    }
  });

  // 风扇图标转速度随 RPM 联动（仅在时长变化时写入，避免每帧样式抖动）
  var fanIcon = document.getElementById('fan-icon');
  if (fanIcon) {
    var rpm = d.fan || 0;
    if (rpm > 0) {
      var dur = Math.round(Math.min(2.5, Math.max(0.35, 9000 / rpm)) * 10) / 10;
      if (lastFanDuration !== dur) {
        lastFanDuration = dur;
        fanIcon.style.setProperty('--fan-duration', dur.toFixed(1) + 's');
      }
      fanIcon.classList.add('spinning');
    } else {
      fanIcon.classList.remove('spinning');
    }
  }

  // Power status color
  var pwrEl = document.getElementById('field-pwr');
  if (pwrEl) {
    pwrEl.style.color = d.pwr === 1 ? 'var(--success)' : 'var(--text-secondary)';
  }
}

// 状态寄存器"正常"判定：0x00 恒为正常；风扇状态 0xA200 为风扇正常运转的特定编码
function isStatusAlert(key, val) {
  if (val === 0) return false;
  if (key === 'sf' && val === 0xA200) return false;
  return true;
}

// ===== 11. Status Register Update (Simplified) =====
function updateStatusSimple() {
  var d = dataModel.dynamic;
  var regs = { si: d.si, sn: d.sn, st: d.st, sf: d.sf };
  var hasAlert = false;

  Object.keys(regs).forEach(function(key) {
    var el = document.querySelector('.status-reg-cell .reg-value[data-field="' + key + '"]');
    if (el) {
      el.textContent = '0x' + (regs[key] < 16 ? '0' : '') + (regs[key] || 0).toString(16).toUpperCase();
    }
    if (isStatusAlert(key, regs[key])) hasAlert = true;
  });

  dom.statusBar.classList.toggle('alert', hasAlert);
  dom.statusBarText.textContent = hasAlert ? '告警' : '正常';
}

// ===== 12. Device Info Update =====
function updateDeviceInfo() {
  var s = dataModel.static;
  if (!s.received) return;

  var prevMap = { 0: 'V1.0', 17: 'V1.1', 34: 'V1.2', 51: 'V1.3' };
  var fields = {
    mid: s.mid || '未知',
    mm: s.mm || '未知',
    mrev: s.mrev || '未知',
    msn: s.msn || '未知',
    mloc: s.mloc || '未知',
    mdate: s.mdate || '未知',
    prev: prevMap[s.prev] || '未知',
    rimax: s.rimax + 'A',
    rpmax: s.rpmax + 'W',
    rt1: s.rt1 + '°C',
    rt2: s.rt2 + '°C'
  };

  Object.keys(fields).forEach(function(key) {
    var el = document.querySelector('.device-value[data-field="' + key + '"]');
    if (el) {
      el.textContent = fields[key];
      el.classList.remove('loading');
    }
  });
}

// ===== 13. Status Register Update (Detailed, Tab 2) =====
function updateStatusDetailed() {
  var d = dataModel.dynamic;
  var regs = { si: d.si, sn: d.sn, st: d.st, sf: d.sf };

  Object.keys(regs).forEach(function(key) {
    var hex = '0x' + (regs[key] < 16 ? '0' : '') + (regs[key] || 0).toString(16).toUpperCase();
    var valEl = document.getElementById('reg-val-' + key);
    var chipEl = document.getElementById('reg-chip-' + key);
    if (valEl) valEl.textContent = hex;
    if (chipEl) {
      var isAlert = isStatusAlert(key, regs[key]);
      chipEl.classList.toggle('alert', isAlert);
      var dot = chipEl.querySelector('.chip-dot');
      var text = chipEl.querySelector('.chip-text');
      if (dot) dot.style.background = isAlert ? 'var(--error)' : 'var(--success)';
      if (text) text.textContent = isAlert ? '告警 (' + hex + ')' : '正常 (' + hex + ')';
    }
  });
}

// ===== 14. BLE Data Handling =====
function parsePacket(chunk) {
  if (!chunk || chunk.length === 0) return;

  bleState.packetBuffer += chunk;

  // Process all complete JSON objects in buffer
  var processed = false;
  while (true) {
    var start = bleState.packetBuffer.indexOf('{');
    if (start === -1) break;

    var depth = 0;
    var end = -1;
    for (var i = start; i < bleState.packetBuffer.length; i++) {
      var c = bleState.packetBuffer[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break; // Incomplete JSON

    var jsonStr = bleState.packetBuffer.substring(start, end + 1);
    bleState.packetBuffer = bleState.packetBuffer.substring(end + 1);

    // Remove any leading/trailing whitespace
    jsonStr = jsonStr.trim();

    try {
      var obj = JSON.parse(jsonStr);
      processed = true;
      handleData(obj);
    } catch (e) {
      console.warn('[CRPS] JSON parse error:', e.message, '| raw:', jsonStr.substring(0, 100));
      // Discard invalid JSON and continue
    }
  }
}

function handleData(obj) {
  // Check if dynamic or static
  if ('vin' in obj || 'vout' in obj) {
    // Dynamic data
    var d = dataModel.dynamic;
    var changed = false;
    ['vin','iin','vout','iout','pout','eff','fan','t1','t2','rt','pwr','si','sn','st','sf'].forEach(function(key) {
      if (obj[key] !== undefined) {
        d[key] = obj[key];
        changed = true;
      }
    });
    if (changed) {
      // Push to chart buffers
      var now = Date.now();
      window.__crpsIndicatorKeys.forEach(function(key) {
        if (obj[key] !== undefined) {
          var buf = window.__crpsDataBuffers[key];
          buf.push([now, obj[key]]);
          // Keep 240 data points (60s at 4Hz)
          if (buf.length > 240) buf.shift();
        }
      });

      updateDataCards();
      updateStatusSimple();
      updateStatusDetailed();

      // 同步开关位置（手动切换后 800ms 冷却期内不覆盖用户操作）
      // 注意：仅跳过开关同步，不能提前 return 影响后续静态数据与图表更新
      var skipSwitchSync = obj.pwr !== undefined && (Date.now() - switchState.lastManualToggle < 800);
      if (obj.pwr !== undefined && !skipSwitchSync) {
        var currentPos = switchState.position;
        var targetPos = obj.pwr === 1 ? 'on' : 'off';
        if (currentPos !== targetPos) {
          setSwitchPosition(targetPos);
        }
      }
    }
  }

  if ('mid' in obj || 'mm' in obj || 'prev' in obj) {
    // Static data
    var s = dataModel.static;
    ['mid','mm','mrev','msn','mloc','mdate','prev','rimax','rpmax','rt1','rt2'].forEach(function(key) {
      if (obj[key] !== undefined) s[key] = obj[key];
    });
    if (!s.received) {
      s.received = true;
      bleState.staticDataReceived = true;
      if (bleState.staticDataTimer) {
        clearTimeout(bleState.staticDataTimer);
        bleState.staticDataTimer = null;
      }
    }
    updateDeviceInfo();
  }

  // Update chart data callback
  if (window.__crpsOnDataUpdate) {
    window.__crpsOnDataUpdate();
  }
}

// ===== 15. BLE Connection =====
function startConnection() {
  if (bleState.connecting) return;

  bleState.connecting = true;
  updateUIState('connecting');

  // Show connecting overlay
  dom.connectingView.classList.remove('hidden');

  // Timeout after 10 seconds
  bleState.connectTimeout = setTimeout(function() {
    if (bleState.connecting) {
      bleState.connecting = false;
      updateUIState('disconnected');
      dom.connectingView.classList.add('hidden');
      showToast('error', '连接超时，请重试');
    }
  }, 10000);

  navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
    optionalServices: [BLE_SERVICE_UUID]
  })
  .then(function(device) {
    bleState.device = device;
    device.addEventListener('gattserverdisconnected', onDisconnected);
    return device.gatt.connect();
  })
  .then(function(server) {
    bleState.server = server;
    return server.getPrimaryService(BLE_SERVICE_UUID);
  })
  .then(function(service) {
    bleState.service = service;
    return Promise.all([
      service.getCharacteristic(BLE_CHAR_DYNAMIC),
      service.getCharacteristic(BLE_CHAR_STATIC),
      service.getCharacteristic(BLE_CHAR_CONTROL)
    ]);
  })
  .then(function(chars) {
    bleState.charDynamic = chars[0];
    bleState.charStatic = chars[1];
    bleState.charControl = chars[2];

    // Helper: read characteristic value → string
    function charValueToString(val) {
      if (!val) return '';
      try {
        // DataView
        if (val.buffer && typeof val.byteOffset === 'number' && typeof val.byteLength === 'number') {
          var bytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
          return new TextDecoder('utf-8').decode(bytes);
        }
        // ArrayBuffer fallback
        if (val.byteLength !== undefined) {
          return new TextDecoder('utf-8').decode(new Uint8Array(val));
        }
        return String(val);
      } catch(e) {
        console.warn('[CRPS] decode error:', e);
        return '';
      }
    }

    // 数据读取：dynamic 250ms 轮询，static 5s 轮询（轮询比 notify 更稳，且无需 startNotifications）
    function readDynamicChar() {
      if (!bleState.charDynamic || !bleState.connected) return;
      bleState.charDynamic.readValue()
        .then(function(val) {
          var text = charValueToString(val);
          if (text) {
            parsePacket(text);
          }
        })
        .catch(function(err) {
          // 读失败静默处理，下次继续
        });
    }
    function readStaticChar() {
      if (!bleState.charStatic || !bleState.connected) return;
      bleState.charStatic.readValue()
        .then(function(val) {
          var text = charValueToString(val);
          if (text) {
            parsePacket(text);
          }
        })
        .catch(function(err) {
          // 静默
        });
    }
    bleState.dynPollTimer = setInterval(readDynamicChar, 250);
    bleState.staticPollTimer = setInterval(readStaticChar, 5000);
    // 立即读一次
    readDynamicChar();
    readStaticChar();

    // Success
    if (bleState.connectTimeout) {
      clearTimeout(bleState.connectTimeout);
      bleState.connectTimeout = null;
    }
    bleState.connecting = false;
    bleState.connected = true;
    updateUIState('connected');
    dom.connectingView.classList.add('hidden');
    showToast('success', '连接成功');

    // Start runtime counter
    startRuntimeCounter();

    // Static data timeout (15s)
    bleState.staticDataTimer = setTimeout(function() {
      if (!bleState.staticDataReceived) {
        // Show "不可用" for static data fields
        document.querySelectorAll('.device-value').forEach(function(el) {
          if (el.textContent === '加载中…') {
            el.textContent = '不可用';
            el.classList.add('loading');
          }
        });
      }
    }, 15000);
  })
  .catch(function(err) {
    if (bleState.connectTimeout) {
      clearTimeout(bleState.connectTimeout);
      bleState.connectTimeout = null;
    }
    bleState.connecting = false;
    bleState.connected = false;
    updateUIState('disconnected');
    dom.connectingView.classList.add('hidden');

    if (err.name === 'NotFoundError') {
      showToast('warning', '已取消选择设备');
    } else {
      showToast('error', '连接失败，请重试');
    }
  });
}

function disconnect() {
  if (bleState.device && bleState.connected) {
    bleState.device.gatt.disconnect();
  }
}

function onDisconnected() {
  bleState.connected = false;
  bleState.connecting = false;
  bleState.staticDataReceived = false;
  bleState.packetBuffer = '';
  stopRuntimeCounter();

  // 清理轮询定时器
  if (bleState.dynPollTimer) {
    clearInterval(bleState.dynPollTimer);
    bleState.dynPollTimer = null;
  }
  if (bleState.staticPollTimer) {
    clearInterval(bleState.staticPollTimer);
    bleState.staticPollTimer = null;
  }

  if (bleState.staticDataTimer) {
    clearTimeout(bleState.staticDataTimer);
    bleState.staticDataTimer = null;
  }

  // Clear chart buffers
  window.__crpsIndicatorKeys.forEach(function(key) {
    window.__crpsDataBuffers[key] = [];
  });
  if (window.__crpsResetCharts) window.__crpsResetCharts();

  updateUIState('disconnected');

  // Reset device info to loading
  document.querySelectorAll('.device-value').forEach(function(el) {
    el.textContent = '加载中…';
    el.classList.add('loading');
  });

  // Show disconnect modal
  showModal(
    '连接已断开',
    '设备连接已断开，请点击下方按钮重新连接。',
    [{ label: '重新连接', callback: function() {
      closeModal();
      startConnection();
    }}]
  );

  showToast('error', '设备已断开');
}

// ===== 16. Runtime Counter =====
function startRuntimeCounter() {
  if (bleState.runtimeTimer) clearInterval(bleState.runtimeTimer);
  bleState.runtimeTimer = setInterval(function() {
    if (bleState.connected && dataModel.dynamic.pwr === 1) {
      dataModel.dynamic.rt++;
      var rtEl = document.querySelector('[data-field="rt"]');
      if (rtEl) rtEl.textContent = formatRuntime(dataModel.dynamic.rt);
    }
  }, 1000);
}

function stopRuntimeCounter() {
  if (bleState.runtimeTimer) {
    clearInterval(bleState.runtimeTimer);
    bleState.runtimeTimer = null;
  }
}

// ===== 17. UI State Update =====
function applyUIState(state) {
  var dot = dom.statusDot;
  var text = dom.statusText;
  var btn = dom.btnConnect;
  var btnText = dom.btnConnectText;
  var switchEl = dom.powerSwitch;

  // Reset dot classes
  dot.className = 'status-dot';

  switch (state) {
    case 'disconnected':
      dot.className = 'status-dot';
      text.textContent = '未连接';
      btnText.textContent = '连接设备';
      btn.querySelector('.material-symbols-outlined').textContent = 'bluetooth';
      btn.disabled = false;
      switchEl.classList.add('disabled');
      dom.disconnectedView.style.display = 'flex';
      dom.tabMonitor.classList.remove('active');
      dom.tabDevice.classList.remove('active');
      break;

    case 'connecting':
      dot.className = 'status-dot connecting';
      text.textContent = '连接中';
      btnText.textContent = '连接中…';
      btn.querySelector('.material-symbols-outlined').textContent = 'bluetooth';
      btn.disabled = true;
      switchEl.classList.add('disabled');
      dom.disconnectedView.style.display = 'none';
      break;

    case 'connected':
      dot.className = 'status-dot connected';
      text.textContent = '已连接';
      btnText.textContent = '断开连接';
      btn.querySelector('.material-symbols-outlined').textContent = 'bluetooth_connected';
      btn.disabled = false;
      switchEl.classList.remove('disabled');
      dom.disconnectedView.style.display = 'none';
      dom.tabMonitor.classList.add('active');
      animateMonitorEnter();
      break;

    case 'alert':
      dot.className = 'status-dot alert';
      text.textContent = '告警';
      break;
  }
}

function updateUIState(state) {
  uiState.current = state;
  // 停用 View Transitions，避免半透明玻璃卡片快照闪烁、状态栏被短暂覆盖。
  applyUIState(state);
}

// ===== 18. Power Switch (Apple-style Toggle) =====
var switchState = { position: 'off', lastManualToggle: 0 };

function setSwitchPosition(pos) {
  switchState.position = pos;
  dom.switchTrack.classList.toggle('on', pos === 'on');
}

function sendPowerCommand(value) {
  if (!bleState.charControl || !bleState.connected) return;
  var data = new Uint8Array([value]);
  bleState.charControl.writeValue(data)
    .then(function() {
      showToast('success', value === 1 ? '开机指令已发送' : '关机指令已发送');
    })
    .catch(function() {
      showToast('error', '指令发送失败');
    });
}

// Click to toggle
dom.powerSwitch.addEventListener('click', function(e) {
  if (dom.powerSwitch.classList.contains('disabled')) return;

  var newPos = switchState.position === 'on' ? 'off' : 'on';
  setSwitchPosition(newPos);
  sendPowerCommand(newPos === 'on' ? 1 : 0);
  switchState.lastManualToggle = Date.now();
});

// ===== 20. First-visit Modal =====
(function checkFirstVisit() {
  if (localStorage.getItem('crps_guide_dismissed') === '1') return;
  // Show after a short delay
  setTimeout(function() {
    showModal(
      '欢迎使用 CRPS 电源监控',
      '<div style="margin-bottom: 16px;">请使用 Chrome 或 Edge 浏览器连接您的 CRPS Monitor 设备。</div>' +
      '<div style="margin-bottom: 8px;">• 确保设备已通电并处于蓝牙广播状态</div>' +
      '<div style="margin-bottom: 8px;">• 电脑需支持蓝牙或使用 USB 蓝牙适配器</div>' +
      '<div>• 点击"连接设备"按钮开始搜索</div>',
      [{
        label: '开始使用',
        callback: function() {
          var cb = document.getElementById('guide-checkbox');
          if (cb && cb.checked) {
            localStorage.setItem('crps_guide_dismissed', '1');
          }
          closeModal();
        }
      }]
    );
    // Add checkbox
    var actions = dom.modalActions;
    var checkbox = document.createElement('label');
    checkbox.className = 'modal-checkbox';
    checkbox.innerHTML = '<input type="checkbox" id="guide-checkbox">不再显示';
    actions.insertBefore(checkbox, actions.firstChild);
  }, 500);
})();

// ===== 21. Event Bindings =====
dom.btnConnect.addEventListener('click', function() {
  if (bleState.connected) {
    disconnect();
  } else {
    startConnection();
  }
});

dom.btnConnectLarge.addEventListener('click', function() {
  if (!bleState.connected && !bleState.connecting) {
    startConnection();
  }
});

// ===== 22. Security Check =====
(function checkSecureContext() {
  if (location.protocol === 'file:') {
    console.error('[CRPS] 错误：Web Bluetooth API 需要 HTTP/HTTPS 安全上下文');
    console.error('[CRPS] 请使用本地服务器运行此页面:');
    console.error('[CRPS]   node server.js  然后访问 http://localhost:8080');
    showToast('error', '请通过本地服务器 (http://localhost:8080) 访问此页面，file:// 不支持蓝牙');
  } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    console.warn('[CRPS] Web Bluetooth 需要 HTTPS 安全上下文');
  } else {
    console.log('[CRPS] 安全上下文正常，Web Bluetooth 可用');
  }
})();

// ===== 23. Reduced Motion & Resize =====
(function() {
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  uiState.reduceMotion = mq.matches;
  if (mq.addEventListener) {
    mq.addEventListener('change', function() { uiState.reduceMotion = mq.matches; });
  }
})();

// Tab 指示器随窗口尺寸重定位
window.addEventListener('resize', function() {
  moveTabIndicator(false);
});

// ===== 24. Init =====
updateUIState('disconnected');
moveTabIndicator(false);