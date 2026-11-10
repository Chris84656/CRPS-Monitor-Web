const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function dynamic() {
  return { vin: 230, iin: 2, vout: 12, iout: 10, pout: 120, eff: 26,
    fan: 1000, t1: 40, t2: 42, rt: 100, pwr: 1, si: 0, sn: 0, st: 0, sf: 0, valid: true };
}
function stat() {
  return { mid: 'ACME', mm: 'CRPS', msn: '123', mrev: 'A1', mloc: 'rack',
    mdate: '20260101', prev: 34, rimax: 100, rpmax: 1200, rt1: 70, rt2: 80, valid: true };
}
function setup() {
  let now = 0, id = 0;
  const nodes = new Map(), timers = new Map(), toasts = [];
  function el(key) {
    if (!nodes.has(key)) {
      const classes = new Set(), attributes = {}, listeners = {};
      nodes.set(key, {
        textContent: '', innerHTML: '', style: { setProperty() {} }, dataset: {}, offsetLeft: 0, offsetWidth: 1,
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
          toggle(x, yes) { if (yes) classes.add(x); else classes.delete(x); } },
        setAttribute: (k, v) => { attributes[k] = v; }, getAttribute: k => attributes[k],
        addEventListener: (event, fn) => { listeners[event] = fn; }, click() { listeners.click?.({}); },
        appendChild() {}, insertBefore() {}, querySelector: selector => el(key + selector)
      });
    }
    return nodes.get(key);
  }
  function timer(fn, delay, repeat) {
    timers.set(++id, { fn, due: now + delay, repeat });
    return id;
  }
  const context = {
    console: { log() {}, warn() {}, error() {} }, TextDecoder, TextEncoder, Uint8Array,
    Date: class extends Date { static now() { return 1700000000000 + now; } }, performance: { now: () => now },
    document: { getElementById: el, querySelector: el, querySelectorAll: () => [], createElement: () => el('new' + ++id) },
    localStorage: { getItem: () => '1' }, location: { protocol: 'https:', hostname: 'localhost' },
    navigator: { bluetooth: { requestDevice() { throw new Error('No selected device'); } } },
    setTimeout: (fn, ms) => timer(fn, ms, 0), clearTimeout: n => timers.delete(n),
    setInterval: (fn, ms) => timer(fn, ms, ms), clearInterval: n => timers.delete(n),
    addEventListener() {}, matchMedia: () => ({ matches: true, addEventListener() {} })
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  context.showToast = (kind, message) => toasts.push({ kind, message });
  context.showModal = () => {};
  return { s: context, el, timers, toasts,
    model: () => vm.runInContext('dataModel', context),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [n, t] = next;
        now = t.due;
        if (t.repeat) t.due += t.repeat; else timers.delete(n);
        t.fn(); await flush();
      }
      now = end; await flush();
    }
  };
}
function device(name) {
  const listeners = new Set();
  const d = { name, id: name, listeners, dynamic: dynamic(), static: stat(), writes: [], reads: [], closes: 0,
    active: 0, maxActive: 0, holds: {}, fail: {}, connectWait: null,
    addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f),
    hold(kind) { const wait = deferred(); d.holds[kind] = wait; return wait; } };
  async function operation(kind, value) {
    d.active++; d.maxActive = Math.max(d.maxActive, d.active);
    assert.equal(d.active, 1, 'GATT operations overlap');
    const held = d.holds[kind]; delete d.holds[kind];
    try {
      if (held) await held.promise;
      if (d.fail[kind]) throw new Error(kind + ' failed');
      if (kind === 'write') {
        d.writes.push(value);
        if (!d.noFeedback) {
          d.dynamic.pwr = value;
          if (d.dynamic.ack !== undefined && d.lastPayload.length === 5) {
            d.dynamic.ack = new DataView(new Uint8Array(d.lastPayload).buffer).getUint32(1, true);
          }
        }
        return;
      }
      d.reads.push(kind);
      const text = d.raw?.[kind] ?? JSON.stringify(d[kind]);
      const bytes = new TextEncoder().encode('xx' + text + 'yy');
      return new DataView(bytes.buffer, 2, bytes.length - 4);
    } finally { d.active--; }
  }
  const chars = {
    '00002a56-0000-1000-8000-00805f9b34fb': { readValue: () => operation('dynamic') },
    '00002a58-0000-1000-8000-00805f9b34fb': { readValue: () => operation('static') },
    '00002a57-0000-1000-8000-00805f9b34fb': {
      properties: { get read() { return !!d.authRead; } },
      readValue: () => operation('auth'),
      writeValue: v => { d.lastPayload = [...v]; return operation('write', v[0]); }
    }
  };
  const service = { async getCharacteristic(uuid) {
    if (d.missingChar === uuid) throw new Error('missing characteristic');
    return chars[uuid];
  } };
  const server = { async getPrimaryService() {
    if (d.serviceFail) throw new Error('missing service');
    return service;
  } };
  d.gatt = {
    connected: false,
    async connect() {
      const wait = d.connectWait; d.connectWait = null;
      if (wait) await wait.promise;
      this.connected = true;
      return server;
    },
    disconnect() { d.closes++; this.connected = false; [...listeners].forEach(f => f({ target: d })); }
  };
  return d;
}
async function connect(env, dev) {
  env.s.navigator.bluetooth.requestDevice = () => Promise.resolve(dev);
  env.s.startConnection(); await flush();
}

test('complete Read values: strings, UTF-8, size/schema limits and recovery', () => {
  const { s } = setup();
  const value = { ...stat(), mid: 'ACME{Lab', mm: 'A}B "\\ 中文' };
  assert.equal(s.parsePacket(JSON.stringify(value), 'static').mid, value.mid);
  assert.equal(s.parsePacket('{"mid":', 'static'), null);
  assert.equal(s.parsePacket(JSON.stringify(stat()), 'static').mid, 'ACME');
  for (const input of ['null', '[]', '{}', '{'.repeat(100000), JSON.stringify({ ...dynamic(), vin: '230' }),
    JSON.stringify({ ...dynamic(), pwr: 2 }), JSON.stringify({ ...dynamic(), proto: 2 })]) {
    assert.equal(s.parsePacket(input, 'dynamic'), null);
  }
  assert.equal(s.parsePacket(JSON.stringify({ ...stat(), mid: '汉'.repeat(400) }), 'static'), null);
  assert.equal(s.decodePacket(new Uint8Array([0xFF]).buffer, 'dynamic'), null);
  assert.equal(s.parsePacket(JSON.stringify(dynamic()), 'dynamic').vin, 230);
  assert.equal('packetBuffer' in s.bleState, false);
});

test('normal connection reads immediately and serially; disconnect clears state', async () => {
  const e = setup(), d = device('A'); await connect(e, d);
  assert.deepEqual(d.reads, ['dynamic', 'static']);
  assert.equal(d.maxActive, 1); assert.equal(e.s.bleState.dataFresh, true);
  assert.equal(e.el('[data-field="vin"]').textContent, '230.00');
  assert.equal(e.el('status-bar-text').textContent, '正常');
  e.s.disconnect(); assert.equal(d.gatt.connected, false); assert.equal(d.listeners.size, 0);
  assert.equal(e.timers.size, 0); assert.equal(e.model().dynamic.vin, null);
  assert.equal(e.el('[data-field="vin"]').textContent, '--');
});

test('device chooser is not timed out; service failure closes GATT and permits retry', async () => {
  const e = setup(), choice = deferred(), d = device('A');
  e.s.navigator.bluetooth.requestDevice = () => choice.promise;
  e.s.startConnection(); await e.advance(90000);
  assert.equal(e.s.bleState.connecting, true);
  d.serviceFail = true; choice.resolve(d); await flush();
  assert.equal(e.s.bleState.session, null); assert.equal(d.gatt.connected, false);
  assert.equal(e.timers.size, 0);
  d.serviceFail = false; await connect(e, d); assert.equal(e.s.bleState.connected, true);
});

test('late A connection and disconnect cannot replace B or route B control to A', async () => {
  const e = setup(), a = device('A'), b = device('B'), late = deferred();
  a.connectWait = late; await connect(e, a); const oldCallback = [...a.listeners][0];
  await e.advance(60000); assert.equal(e.s.bleState.session, null);
  await connect(e, b); const current = e.s.bleState.session;
  late.resolve(); await flush(); oldCallback();
  assert.equal(e.s.bleState.session, current); assert.equal(e.s.bleState.connected, true);
  assert.equal(a.gatt.connected, false); assert.equal(a.listeners.size, 0);
  e.s.sendPowerCommand(0); await flush();
  assert.deepEqual(a.writes, []); assert.deepEqual(b.writes, [0]);
  e.s.disconnect(); assert.equal(e.timers.size, 0);
});

test('late attempt for the same device does not close the newer GATT handle', async () => {
  const e = setup(), d = device('A'), late = deferred();
  d.connectWait = late; await connect(e, d); await e.advance(60000);
  await connect(e, d); const closes = d.closes, current = e.s.bleState.session;
  late.resolve(); await flush();
  assert.equal(d.closes, closes); assert.equal(d.gatt.connected, true);
  assert.equal(e.s.bleState.session, current);
});

test('late read from A cannot populate B or retain charts/identity', async () => {
  const e = setup(), a = device('A'), b = device('B'); await connect(e, a);
  const delayed = a.hold('dynamic'); await e.advance(250);
  e.s.sendPowerCommand(0); e.s.disconnect(); b.fail.dynamic = true;
  await connect(e, b); delayed.resolve(); await flush();
  assert.deepEqual(a.writes, []); assert.deepEqual(b.writes, []);
  assert.equal(e.model().dynamic.vin, null); assert.equal(e.model().static.received, false);
  assert.equal(e.s.__crpsDataBuffers.vin.length, 0); assert.equal(e.s.switchState.position, 'off');
});

test('read failures and repeated source sequence expire data, disable controls and recover', async () => {
  for (const mode of ['failure', 'same-sequence']) {
    const e = setup(), d = device(mode); d.dynamic.seq = 1; await connect(e, d);
    if (mode === 'failure') d.fail.dynamic = true;
    await e.advance(11000);
    assert.equal(e.s.bleState.connected, true); assert.equal(e.s.bleState.dataFresh, false);
    assert.equal(e.el('[data-field="vin"]').textContent, '--');
    assert.equal(e.el('status-text').textContent, '数据已过期');
    assert.equal(e.model().dynamic.rt, 100); e.s.sendPowerCommand(0); await flush();
    assert.deepEqual(d.writes, []);
    d.fail.dynamic = false; d.dynamic.seq = 2; await e.advance(250);
    assert.equal(e.s.bleState.dataFresh, true); assert.equal(e.el('[data-field="vin"]').textContent, '230.00');
  }
});

test('no first packet, malformed packet and hung operation never appear healthy', async () => {
  const e = setup(), d = device('A'); d.raw = { dynamic: '{}' }; await connect(e, d);
  await e.advance(11000); assert.equal(e.s.bleState.dataFresh, false);
  assert.equal(e.el('[data-field="pwr"]').textContent, '--');
  delete d.raw; await e.advance(250); assert.equal(e.s.bleState.dataFresh, true);
  const held = d.hold('dynamic'); await e.advance(250); await e.advance(10000);
  assert.equal(e.s.bleState.session, null); assert.equal(d.gatt.connected, false);
  held.resolve(); await flush(); assert.equal(e.timers.size, 0);
});

test('invalid acquisition stays explicit; legacy packets never claim verified health', async () => {
  const e = setup(), d = device('A');
  for (const key of Object.keys(d.dynamic)) if (!['rt','pwr','valid'].includes(key)) d.dynamic[key] = null;
  d.dynamic.valid = false; d.static.valid = false; await connect(e, d);
  assert.equal(e.el('status-bar-text').textContent, '采集失败');
  assert.equal(e.el('[data-field="vin"]').textContent, '--');
  assert.equal(e.el('[data-field="pwr"]').textContent, 'ON');
  assert.equal(e.s.__crpsDataBuffers.vin[0][1], null);
  d.dynamic = dynamic(); delete d.dynamic.valid; await e.advance(250);
  assert.equal(e.el('status-bar-text').textContent, '采集状态未知');
  assert.equal(e.el('[data-field="vin"]').textContent, '230.00');
});

test('static read errors expire identity and identical successful data restores it', async () => {
  const e = setup(), d = device('A'); await connect(e, d);
  d.fail.static = true; await e.advance(16000);
  assert.equal(e.model().static.received, false);
  assert.equal(e.el('.device-value[data-field="mid"]').textContent, '不可用');
  d.fail.static = false; await e.advance(5000);
  assert.equal(e.model().static.received, true);
  assert.equal(e.el('.device-value[data-field="mid"]').textContent, 'ACME');
});

test('reads and controls serialize, rapid changes retain last queued intent', async () => {
  const e = setup(), d = device('A'); await connect(e, d);
  const held = d.hold('dynamic'); await e.advance(250);
  e.el('power-switch').click(); e.el('power-switch').click();
  assert.deepEqual(d.writes, []); held.resolve(); await flush(); await e.advance(0);
  assert.deepEqual(d.writes, [1]); assert.equal(d.maxActive, 1);
  const write = d.hold('write'); e.s.sendPowerCommand(1); e.s.sendPowerCommand(0);
  write.resolve(); await flush(); await e.advance(0);
  assert.deepEqual(d.writes, [1, 1, 0]); assert.equal(d.maxActive, 1);
  assert.equal(e.s.bleState.session.command, null); assert.equal(e.s.switchState.position, 'off');
});

test('write rejection and absent physical confirmation restore observed switch state', async () => {
  for (const mode of ['reject', 'no-feedback']) {
    const e = setup(), d = device(mode); await connect(e, d);
    d.fail.write = mode === 'reject'; d.noFeedback = mode === 'no-feedback';
    e.s.sendPowerCommand(0); await flush(); await e.advance(6500);
    assert.equal(e.s.bleState.session.command, null); assert.equal(e.s.switchState.position, 'on');
    assert(e.toasts.some(t => t.kind === 'error'));
  }
});

test('partial acquisition retains known fields and marks missing fields unknown', async () => {
  const e = setup(), d = device('partial');
  d.dynamic = { ...dynamic(), valid: false, vout: null, st: null, seq: 1 };
  d.static = { ...stat(), valid: false, prev: null, mm: null };
  await connect(e, d);
  assert.equal(e.el('[data-field="vin"]').textContent, '230.00');
  assert.equal(e.el('[data-field="vout"]').textContent, '--');
  assert.equal(e.el('reg-val-st').textContent, '--');
  assert.equal(e.el('.device-value[data-field="mid"]').textContent, 'ACME');
  assert.equal(e.el('.device-value[data-field="prev"]').textContent, '未知');
  assert.equal(e.el('status-bar-text').textContent, '采集失败');
  assert.equal(e.s.__crpsDataBuffers.vout[0][1], null);
  d.dynamic = { ...dynamic(), seq: 2 }; await e.advance(250);
  assert.equal(e.el('[data-field="vout"]').textContent, '12.00');
  assert.equal(e.el('status-bar-text').textContent, '正常');
});

test('a repeated sample cannot confirm a command even when its pwr field changes', async () => {
  const e = setup(), d = device('sequence');d.dynamic.seq = 1;await connect(e,d);
  e.s.sendPowerCommand(0);await flush();await e.advance(250);
  assert.notEqual(e.s.bleState.session.command, null);
  d.dynamic.seq = 2;await e.advance(250);
  assert.equal(e.s.bleState.session.command, null);
});

test('protected control read completes before connection becomes usable', async () => {
  const e = setup(), d = device('secure'); d.authRead = true;
  const auth = d.hold('auth'); await connect(e, d); await e.advance(40000);
  assert.equal(e.s.bleState.connected, false);
  e.s.sendPowerCommand(0); assert.deepEqual(d.writes, []);
  auth.resolve(); await flush();
  assert.equal(e.s.bleState.connected, true);
  assert.deepEqual(d.reads.slice(0, 3), ['auth', 'dynamic', 'static']);
});

test('failed and timed-out pairing never enable controls or replace a newer session', async () => {
  const e = setup(), a = device('A'), b = device('B');
  a.authRead = true; a.fail.auth = true; await connect(e, a);
  assert.equal(e.s.bleState.session, null); assert.equal(a.gatt.connected, false);
  a.fail.auth = false; const late = a.hold('auth'); await connect(e, a); await e.advance(60000);
  assert.equal(e.s.bleState.session, null);
  await connect(e, b); const active = e.s.bleState.session;
  late.resolve(); await flush(); assert.equal(e.s.bleState.session, active);
  e.s.sendPowerCommand(0); await flush(); assert.deepEqual(a.writes, []); assert.deepEqual(b.writes, [0]);
});

test('command token and physical state must both match after the write', async () => {
  const e = setup(), d = device('ack'); d.dynamic.ack = 0; d.dynamic.seq = 1; d.noFeedback = true;
  await connect(e, d); e.s.sendPowerCommand(0); await flush();
  assert.deepEqual(d.lastPayload, [0, 1, 0, 0, 0]);
  d.dynamic = { ...d.dynamic, seq: 2, pwr: 0 }; await e.advance(250);
  assert.notEqual(e.s.bleState.session.command, null);
  d.dynamic.seq++; d.dynamic.ack = 1; await e.advance(250);
  assert.equal(e.s.bleState.session.command, null);
  e.s.sendPowerCommand(1); e.s.sendPowerCommand(0); await flush();
  d.dynamic.seq++; d.dynamic.ack = 2; await e.advance(250);
  assert.notEqual(e.s.bleState.session.command, null);
  d.dynamic.seq++; d.dynamic.ack = 3; await e.advance(250);
  assert.equal(e.s.bleState.session.command, null);
});

test('static sampling sequence expires even while cached reads succeed', async () => {
  const e = setup(), d = device('static-sequence'); d.static.seq = 1; await connect(e, d);
  await e.advance(40000); assert.equal(e.model().static.received, true);
  await e.advance(6000); assert.equal(e.model().static.received, false);
  d.static.seq = 2; await e.advance(5000); assert.equal(e.model().static.received, true);
});

test('chart headers clear on stale telemetry and disconnect, including paused charts', async () => {
  for (const paused of [false, true]) {
    const e = setup(), d = device('chart');
    const get = e.s.document.getElementById;
    e.s.document.getElementById = id => ['chip-bar', 'chart-grid'].includes(id) ? null : get(id);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../chart.js'), 'utf8'), e.s);
    e.s.document.getElementById = get;
    e.s.chartState.selectedIndicators = ['vout'];
    e.s.chartState.chartInstances.vout = { key: 'vout', lastConsumedT: -Infinity, bucketSec: null,
      bucketValue: 0, ema: null, data: [], lastInteract: 0,
      series: { setData() {} }, chart: { timeScale: () => ({ setVisibleRange() {} }) } };
    await connect(e, d); await e.advance(2000); assert.equal(e.el('curval-vout').textContent, '12.00');
    e.s.chartState.paused.vout = paused;
    d.fail.dynamic = true; await e.advance(11000);
    assert.equal(e.el('curval-vout').textContent, '--');
    e.el('curval-vout').textContent = 'old'; e.s.disconnect();
    assert.equal(e.el('curval-vout').textContent, '--');
  }
});
