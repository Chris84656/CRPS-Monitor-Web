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
const DYNAMIC_FIELDS = ['vin','iin','vout','iout','pout','eff','fan','t1','t2','rt','pwr','si','sn','st','sf'];
const STATIC_TEXT_FIELDS = ['mid','mm','mrev','msn','mloc','mdate'];
const STATIC_NUMBER_FIELDS = ['prev','rimax','rpmax','rt1','rt2'];
const MAX_PACKET_BYTES = 1024;
const DATA_TIMEOUT_MS = 10000;
const STATIC_TIMEOUT_MS = 15000;
const dataModel = { dynamic: {}, static: { received: false } };

// Chart data buffers (shared with chart.js)
window.__crpsDataBuffers = {};
window.__crpsIndicatorKeys = ['vin','iin','vout','iout','pout','eff','fan','t1','t2'];
window.__crpsIndicatorLabels = {
  vin:'输入电压 (V)', iin:'输入电流 (A)', vout:'输出电压 (V)', iout:'输出电流 (A)',
  pout:'输出功率 (W)', eff:'估算效率 (%)', fan:'风扇转速 (RPM)', t1:'环境温度 (°C)', t2:'热点温度 (°C)'
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
  session: null,
  connected: false,
  connecting: false,
  dataFresh: false
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
  function reading(key, digits) {
    return bleState.dataFresh && Number.isFinite(d[key]) ? d[key].toFixed(digits) : '--';
  }
  var fields = {
    vin: reading('vin', 2),
    iin: reading('iin', 2),
    vout: reading('vout', 2),
    iout: reading('iout', 2),
    pout: reading('pout', 1),
    eff: reading('eff', 1),
    fan: reading('fan', 0),
    t1: reading('t1', 1),
    t2: reading('t2', 1),
    rt: bleState.dataFresh ? formatRuntime(d.rt) : '--',
    pwr: bleState.dataFresh ? (d.pwr === 1 ? 'ON' : 'OFF') : '--'
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
    var rpm = bleState.dataFresh && Number.isFinite(d.fan) ? d.fan : 0;
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
    pwrEl.style.color = bleState.dataFresh && d.pwr === 1 ? 'var(--success)' : 'var(--text-secondary)';
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
  var readable = bleState.dataFresh;
  var hasAlert = false;

  Object.keys(regs).forEach(function(key) {
    var el = document.querySelector('.status-reg-cell .reg-value[data-field="' + key + '"]');
    if (el) {
      el.textContent = readable && Number.isInteger(regs[key]) ? '0x' + regs[key].toString(16).toUpperCase().padStart(2, '0') : '--';
    }
    if (readable && Number.isInteger(regs[key]) && isStatusAlert(key, regs[key])) hasAlert = true;
  });

  dom.statusBar.classList.toggle('alert', !readable || d.valid === false || hasAlert);
  dom.statusBarText.textContent = !bleState.dataFresh ? '等待有效数据' :
    d.valid === false ? '采集失败' : hasAlert ? '告警' : d.valid === true ? '正常' : '采集状态未知';
}

// ===== 12. Device Info Update =====
function updateDeviceInfo() {
  var s = dataModel.static;

  var prevMap = { 0: 'V1.0', 17: 'V1.1', 34: 'V1.2', 51: 'V1.3' };
  var fields = {
    mid: s.mid || '未知',
    mm: s.mm || '未知',
    mrev: s.mrev || '未知',
    msn: s.msn || '未知',
    mloc: s.mloc || '未知',
    mdate: s.mdate || '未知',
    prev: prevMap[s.prev] || '未知',
    rimax: Number.isFinite(s.rimax) ? s.rimax + 'A' : '未知',
    rpmax: Number.isFinite(s.rpmax) ? s.rpmax + 'W' : '未知',
    rt1: Number.isFinite(s.rt1) ? s.rt1 + '°C' : '未知',
    rt2: Number.isFinite(s.rt2) ? s.rt2 + '°C' : '未知'
  };

  Object.keys(fields).forEach(function(key) {
    var el = document.querySelector('.device-value[data-field="' + key + '"]');
    if (el) {
      el.textContent = !s.received ? '不可用' : fields[key];
      el.classList.toggle('loading', !s.received || s[key] === null);
    }
  });
}

// ===== 13. Status Register Update (Detailed, Tab 2) =====
function updateStatusDetailed() {
  var d = dataModel.dynamic;
  var regs = { si: d.si, sn: d.sn, st: d.st, sf: d.sf };
  Object.keys(regs).forEach(function(key) {
    var readable = bleState.dataFresh && Number.isInteger(regs[key]);
    var hex = readable ? '0x' + regs[key].toString(16).toUpperCase().padStart(2, '0') : '--';
    var valEl = document.getElementById('reg-val-' + key);
    var chipEl = document.getElementById('reg-chip-' + key);
    if (valEl) valEl.textContent = hex;
    if (chipEl) {
      var isAlert = readable && isStatusAlert(key, regs[key]);
      chipEl.classList.toggle('alert', isAlert);
      var dot = chipEl.querySelector('.chip-dot');
      var text = chipEl.querySelector('.chip-text');
      if (dot) dot.style.background = !readable || d.valid === undefined ? 'var(--text-secondary)' : isAlert ? 'var(--error)' : 'var(--success)';
      if (text) text.textContent = !readable ? '未知' : isAlert ? '告警 (' + hex + ')' :
        (d.valid !== undefined ? '正常 (' : '未校验 (') + hex + ')';
    }
  });
}

// ===== 14. BLE Data Handling =====
function parsePacket(text, kind) {
  if (typeof text !== 'string' || text.length > MAX_PACKET_BYTES ||
      new TextEncoder().encode(text).length > MAX_PACKET_BYTES) return null;
  try {
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (obj.proto !== undefined && obj.proto !== 1) return null;
    if (obj.valid !== undefined && typeof obj.valid !== 'boolean') return null;
    if (obj.seq !== undefined && (!Number.isInteger(obj.seq) || obj.seq < 0 || obj.seq > 0xFFFFFFFF)) return null;
    if (obj.ack !== undefined && (!Number.isInteger(obj.ack) || obj.ack < 0 || obj.ack > 0xFFFFFFFF)) return null;
    var invalid = obj.valid === false;
    if (kind === 'dynamic') {
      if (!DYNAMIC_FIELDS.every(function(key) {
        return Number.isFinite(obj[key]) || (invalid && obj[key] === null && key !== 'rt' && key !== 'pwr');
      })) return null;
      if ((obj.pwr !== 0 && obj.pwr !== 1) || !Number.isSafeInteger(obj.rt) || obj.rt < 0) return null;
      if (!['eff','fan'].every(function(key) {
        return (invalid && obj[key] === null) || (Number.isInteger(obj[key]) && obj[key] >= 0 && obj[key] <= (key === 'eff' ? 100 : 100000));
      })) return null;
      if (!['si','sn','st','sf'].every(function(key) {
        return (invalid && obj[key] === null) || (Number.isInteger(obj[key]) && obj[key] >= 0 && obj[key] <= 0xFFFF);
      })) return null;
    } else if (kind === 'static') {
      if (!STATIC_TEXT_FIELDS.every(function(key) {
        return (invalid && obj[key] === null) || (typeof obj[key] === 'string' && obj[key].length <= 128);
      }) || !STATIC_NUMBER_FIELDS.every(function(key) {
        return Number.isFinite(obj[key]) || (invalid && obj[key] === null);
      })) return null;
      if (!(invalid && obj.prev === null) && (!Number.isInteger(obj.prev) || obj.prev < 0 || obj.prev > 255)) return null;
    } else return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function decodePacket(value, kind) {
  if (!value || value.byteLength > MAX_PACKET_BYTES) return null;
  try {
    var bytes = value.buffer ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
    return parsePacket(new TextDecoder('utf-8', { fatal: true }).decode(bytes), kind);
  } catch (e) {
    return null;
  }
}

function handleData(obj, kind, session) {
  if (!obj || session !== bleState.session || !bleState.connected) return;
  var now = performance.now();
  if (kind === 'dynamic') {
    var newSample = obj.seq === undefined || obj.seq !== session.lastSequence;
    if (newSample) session.lastDynamic = now;
    session.lastSequence = obj.seq;
    DYNAMIC_FIELDS.forEach(function(key) { dataModel.dynamic[key] = obj[key]; });
    dataModel.dynamic.valid = obj.valid;
    dataModel.dynamic.ack = obj.ack;
    updateFreshness(session);
    if (bleState.dataFresh) {
      if (!session.command || (newSample && session.command.deadline !== null &&
          (session.command.token === null || obj.ack === session.command.token) && session.command.value === obj.pwr)) {
        session.command = null;
        setSwitchPosition(obj.pwr === 1 ? 'on' : 'off');
      }
      if (newSample) {
        var wallTime = Date.now();
        window.__crpsIndicatorKeys.forEach(function(key) {
          var buf = window.__crpsDataBuffers[key];
          buf.push([wallTime, obj[key]]);
          if (buf.length > 240) buf.shift();
        });
        if (window.__crpsOnDataUpdate) window.__crpsOnDataUpdate();
      }
    }
  } else {
    STATIC_TEXT_FIELDS.concat(STATIC_NUMBER_FIELDS).forEach(function(key) { dataModel.static[key] = obj[key]; });
    dataModel.static.valid = obj.valid;
    dataModel.static.received = true;
    if (obj.seq === undefined || obj.seq !== session.lastStaticSequence) session.lastStatic = now;
    session.lastStaticSequence = obj.seq;
    updateDeviceInfo();
  }
  updateFreshness(session);
}

function resetTelemetry() {
  DYNAMIC_FIELDS.forEach(function(key) { dataModel.dynamic[key] = null; });
  STATIC_TEXT_FIELDS.concat(STATIC_NUMBER_FIELDS).forEach(function(key) { dataModel.static[key] = null; });
  dataModel.dynamic.valid = null;
  dataModel.dynamic.ack = undefined;
  dataModel.static.valid = null;
  dataModel.static.received = false;
  bleState.dataFresh = false;
  setSwitchPosition('off');
  window.__crpsIndicatorKeys.forEach(function(key) { window.__crpsDataBuffers[key] = []; });
  if (window.__crpsResetCharts) window.__crpsResetCharts();
  updateDataCards();
  updateStatusSimple();
  updateStatusDetailed();
  updateDeviceInfo();
}

// ===== 15. BLE Connection =====
function closeSession(session) {
  if (!session) return;
  ['connectTimer','pollTimer','watchdogTimer','operationTimer'].forEach(function(key) {
    clearTimeout(session[key]);
    clearInterval(session[key]);
    session[key] = null;
  });
  if (session.device && session.onDisconnect) {
    session.device.removeEventListener('gattserverdisconnected', session.onDisconnect);
  }
  session.pendingPower = null;
  session.command = null;
  if (bleState.session === session) {
    bleState.session = null;
    bleState.connected = false;
    bleState.connecting = false;
    resetTelemetry();
    updateUIState('disconnected');
    dom.connectingView.classList.add('hidden');
  }
  var current = bleState.session;
  // A late attempt may share the same OS device handle as a newer connection.
  var reused = current && current.device && session.device &&
    (current.device === session.device || (current.device.id && current.device.id === session.device.id));
  if (session.device && !reused) session.device.gatt.disconnect();
}

async function startConnection() {
  if (bleState.connecting || bleState.connected) return;
  var session = {
    device: null, charDynamic: null, charStatic: null, charControl: null,
    lastDynamic: null, lastStatic: null, lastSequence: null, lastStaticSequence: null, nextCommandToken: 0,
    pendingPower: null, command: null, busy: false
  };
  bleState.session = session;
  bleState.connecting = true;
  resetTelemetry();
  updateUIState('connecting');
  dom.connectingView.classList.remove('hidden');
  try {
    session.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [BLE_SERVICE_UUID]
    });
    if (session !== bleState.session) { closeSession(session); return; }
    session.onDisconnect = function() { onDisconnected(session); };
    session.device.addEventListener('gattserverdisconnected', session.onDisconnect);
    // Allow time for the OS pairing prompt; choosing a device has no application deadline.
    session.connectTimer = setTimeout(function() {
      if (session !== bleState.session) return;
      closeSession(session);
      showToast('error', '连接超时，请重试');
    }, 60000);
    var server = await session.device.gatt.connect();
    if (session !== bleState.session) { closeSession(session); return; }
    var service = await server.getPrimaryService(BLE_SERVICE_UUID);
    if (session !== bleState.session) { closeSession(session); return; }
    session.charDynamic = await service.getCharacteristic(BLE_CHAR_DYNAMIC);
    if (session !== bleState.session) { closeSession(session); return; }
    session.charStatic = await service.getCharacteristic(BLE_CHAR_STATIC);
    if (session !== bleState.session) { closeSession(session); return; }
    session.charControl = await service.getCharacteristic(BLE_CHAR_CONTROL);
    if (session !== bleState.session) { closeSession(session); return; }
    if (session.charControl.properties && session.charControl.properties.read) {
      await session.charControl.readValue();
      if (session !== bleState.session) { closeSession(session); return; }
    }

    clearTimeout(session.connectTimer);
    session.connectTimer = null;
    bleState.connecting = false;
    bleState.connected = true;
    session.connectedAt = performance.now();
    session.nextStatic = session.connectedAt;
    updateUIState('connected');
    updateFreshness(session);
    dom.connectingView.classList.add('hidden');
    showToast('success', '连接成功');
    session.watchdogTimer = setInterval(function() { updateFreshness(session); }, 1000);
    pollSession(session);
  } catch (err) {
    var current = session === bleState.session;
    closeSession(session);
    if (current) showToast(err.name === 'NotFoundError' ? 'warning' : 'error',
      err.name === 'NotFoundError' ? '已取消选择设备' : '连接失败，请重试');
  }
}

async function pollSession(session) {
  if (session !== bleState.session || !bleState.connected || session.busy) return;
  updateFreshness(session);
  if (session.pendingPower !== null && !bleState.dataFresh) {
    session.pendingPower = null;
    session.command = null;
    showToast('error', '数据已过期，未发送指令');
  }
  session.busy = true;
  var writing = session.pendingPower !== null;
  session.operationTimer = setTimeout(function() {
    if (session !== bleState.session) return;
    closeSession(session);
    showToast('error', '蓝牙操作超时，请重新连接');
  }, writing ? 60000 : DATA_TIMEOUT_MS);
  try {
    if (writing) {
      var command = session.pendingPower;
      session.pendingPower = null;
      var payload = new Uint8Array(command.token === null ? 1 : 5);
      payload[0] = command.value;
      if (command.token !== null) new DataView(payload.buffer).setUint32(1, command.token, true);
      await session.charControl.writeValue(payload);
      if (session !== bleState.session) return;
      if (session.command === command) {
        command.deadline = performance.now() + 6000;
        showToast('success', command.value === 1 ? '开机指令已发送' : '关机指令已发送');
      }
    } else {
      var value = await session.charDynamic.readValue();
      if (session !== bleState.session) return;
      handleData(decodePacket(value, 'dynamic'), 'dynamic', session);
      if (session.pendingPower === null && performance.now() >= session.nextStatic) {
        session.nextStatic = performance.now() + 5000;
        value = await session.charStatic.readValue();
        if (session !== bleState.session) return;
        handleData(decodePacket(value, 'static'), 'static', session);
      }
    }
  } catch (err) {
    if (session !== bleState.session) return;
    if (writing && session.command === command) {
      session.command = null;
      setSwitchPosition(dataModel.dynamic.pwr === 1 ? 'on' : 'off');
      showToast('error', '指令发送失败');
    }
  } finally {
    clearTimeout(session.operationTimer);
    session.operationTimer = null;
    session.busy = false;
    if (session === bleState.session && bleState.connected) {
      updateFreshness(session);
      session.pollTimer = setTimeout(function() { pollSession(session); },
        writing || session.pendingPower !== null ? 0 : 250);
    }
  }
}

function disconnect() {
  closeSession(bleState.session);
}

function onDisconnected(session) {
  if (session !== bleState.session) return;
  closeSession(session);
  showModal(
    '连接已断开',
    '设备连接已断开，请点击下方按钮重新连接。',
    [{ label: '重新连接', callback: function() { closeModal(); startConnection(); } }]
  );
  showToast('error', '设备已断开');
}

// ===== 16. Data Freshness =====
function updateFreshness(session) {
  if (session !== bleState.session || !bleState.connected) return;
  var now = performance.now();
  var wasFresh = bleState.dataFresh;
  bleState.dataFresh = session.lastDynamic !== null && now - session.lastDynamic < DATA_TIMEOUT_MS;
  if (wasFresh && !bleState.dataFresh && window.__crpsOnDataUpdate) window.__crpsOnDataUpdate();
  var expired = now - (session.lastDynamic === null ? session.connectedAt : session.lastDynamic) >= DATA_TIMEOUT_MS;
  dom.statusText.textContent = bleState.dataFresh ? '已连接' : expired ? '数据已过期' : '已连接 · 等待数据';
  dom.statusDot.className = bleState.dataFresh ? 'status-dot connected' : expired ? 'status-dot alert' : 'status-dot connecting';
  if (session.command && session.command.deadline !== null && now >= session.command.deadline) {
    session.command = null;
    setSwitchPosition(dataModel.dynamic.pwr === 1 ? 'on' : 'off');
    showToast('error', '设备状态未确认，请检查电源后重试');
  }
  var disabled = !bleState.dataFresh;
  dom.powerSwitch.classList.toggle('disabled', disabled);
  dom.powerSwitch.setAttribute('aria-disabled', String(disabled));
  dom.powerSwitch.setAttribute('aria-busy', String(session.command !== null));
  var staticTimeout = session.lastStaticSequence == null ? STATIC_TIMEOUT_MS : 45000;
  if (now - (session.lastStatic === null ? session.connectedAt : session.lastStatic) >= staticTimeout) {
    dataModel.static.received = false;
    updateDeviceInfo();
  }
  updateDataCards();
  updateStatusSimple();
  updateStatusDetailed();
  if (expired) dom.statusBarText.textContent = '数据已过期';
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
var switchState = { position: 'off' };

function setSwitchPosition(pos) {
  switchState.position = pos;
  dom.switchTrack.classList.toggle('on', pos === 'on');
}

function sendPowerCommand(value) {
  var session = bleState.session;
  if (!session || !bleState.connected || !bleState.dataFresh ||
      (value !== 0 && value !== 1)) return;
  session.nextCommandToken = session.nextCommandToken % 0xFFFFFFFF + 1;
  session.command = { value: value, deadline: null, token: dataModel.dynamic.ack === undefined ? null : session.nextCommandToken };
  session.pendingPower = session.command;
  setSwitchPosition(value === 1 ? 'on' : 'off');
  updateFreshness(session);
  clearTimeout(session.pollTimer);
  pollSession(session);
}

// Click to toggle
dom.powerSwitch.addEventListener('click', function(e) {
  if (dom.powerSwitch.classList.contains('disabled')) return;

  var newPos = switchState.position === 'on' ? 'off' : 'on';
  sendPowerCommand(newPos === 'on' ? 1 : 0);
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
resetTelemetry();
updateUIState('disconnected');
moveTabIndicator(false);
