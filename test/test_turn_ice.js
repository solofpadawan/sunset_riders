// TURN comes only from signal.php?a=ice. No ROM, no production signaling.
// node test/test_turn_ice.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const SRC = fs.readFileSync(path.join(WEB, 'net/transport.js'), 'utf8');
const SIGNAL = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php';
const FAKE = 'https://signal.test.invalid/ssr/signal.php';
const BANNED = ['open' + 'relay', 'static' + 'auth', 'hmac' + 'Cred', 'OPEN' + 'RELAY', 'openrelayproject' + 'secret'];

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function load(fetchImpl) {
  const window = {};
  const sandbox = {
    window, crypto: globalThis.crypto, fetch: fetchImpl, console,
    AbortController, setTimeout, clearTimeout,
    TextEncoder: globalThis.TextEncoder,
    URLSearchParams: globalThis.URLSearchParams,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'transport.js' });
  return sandbox.window.SSRNET;
}
function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

async function testDynamic() {
  let calls = 0;
  const net = load(async (url, opt) => {
    calls++;
    assert.equal(url, FAKE + '?a=ice');
    assert.equal(opt.cache, 'no-store');
    assert.ok(!String(url).includes('alwaysdata'));
    return jsonResponse(200, { ok: true, ice: [
      { urls: ['turn:dyn.example:3478?transport=udp', 'turns:dyn.example:5349', 'javascript:no', 'not-a-url'], username: 'minted-user', credential: 'minted-pass', ttl: 86400 },
      { urls: 'stun:stun.dyn.example:3478' },
      { urls: 'turn:skip.example:3478', username: 'no-credential' },
      null,
    ] });
  });
  const got = await net.getTurn(FAKE);
  assert.deepEqual(got, [{ urls: ['turn:dyn.example:3478?transport=udp', 'turns:dyn.example:5349'], username: 'minted-user', credential: 'minted-pass' }]);
  assert.equal(calls, 1);
  assert.deepEqual(await net.getTurn('https://other.example/signal.php'), got);
  assert.equal(calls, 1);
  const ice = net.ICE.concat(got);
  assert.equal(ice[0].urls, 'stun:stun.l.google.com:19302');
  assert.equal(ice.filter(s => s.username).length, 1);
  return { calls, servers: ice.length };
}

async function testDefaultSignal() {
  let seen = '';
  const net = load(async (url) => { seen = url; return jsonResponse(200, { ok: true, ice: [{ urls: 'turn:dyn.example:443?transport=tcp', username: 'u', credential: 'c' }] }); });
  assert.equal(net.DEFAULT_SIGNAL, SIGNAL);
  assert.equal(net.OPENRELAY, undefined);
  assert.equal(net.hmacCred, undefined);
  const got = await net.getTurn();
  assert.equal(seen, SIGNAL + '?a=ice');
  assert.deepEqual(got, [{ urls: 'turn:dyn.example:443?transport=tcp', username: 'u', credential: 'c' }]);
}

async function testMiss(label, impl) {
  let calls = 0;
  const net = load(async (url) => {
    calls++;
    assert.equal(url, FAKE + '?a=ice');
    if (calls > 1) return jsonResponse(200, { ok: true, ice: [{ urls: 'turn:recovered.example:3478', username: 'later', credential: 'cred' }] });
    return impl();
  });
  const first = await net.getTurn(FAKE);
  assert.deepEqual(first, [], label);
  const ice = net.ICE.concat(first);
  assert.deepEqual(ice, net.ICE, label);
  assert.ok(ice.every(s => !s.username && !s.credential && String(s.urls).startsWith('stun:')), label);
  const second = await net.getTurn(FAKE);
  if (label === 'empty') {
    assert.equal(calls, 1, label);
    assert.deepEqual(second, []);
  } else {
    assert.equal(calls, 2, label);
    assert.deepEqual(second, [{ urls: 'turn:recovered.example:3478', username: 'later', credential: 'cred' }]);
  }
  return label;
}

function testShippedWeb() {
  const files = walk(WEB, []).concat([path.join(ROOT, 'NOTES.md')]);
  const hits = [];
  for (const file of files) {
    if (!/\.(js|html|css|php|json|md|txt)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const n of BANNED) if (text.includes(n)) hits.push(path.relative(ROOT, file) + ':' + n);
  }
  assert.deepEqual(hits, []);
}

async function main() {
  const dynamic = await testDynamic();
  await testDefaultSignal();
  const misses = [];
  misses.push(await testMiss('throw', () => { throw new Error('down'); }));
  misses.push(await testMiss('http', () => jsonResponse(500, { ok: false, error: 'no' })));
  misses.push(await testMiss('bad', () => jsonResponse(200, { ok: false, error: 'no' })));
  misses.push(await testMiss('shape', () => jsonResponse(200, { ok: true })));
  misses.push(await testMiss('json', () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })));
  misses.push(await testMiss('empty', () => jsonResponse(200, { ok: true, ice: [] })));
  testShippedWeb();
  console.log(JSON.stringify({ ok: true, synthetic: true, rom: false, signal: 'mock', dynamic, misses }));
}
main().catch(e => { console.error(e); process.exit(1); });
