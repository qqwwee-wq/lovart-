// scripts/ws-hook.js —— 在所有 JS 之前注入 WebSocket spy，捕获 Lovart 所有 send/recv
// 然后走真实流程（开新项目→输入→Agent），把每帧 WS 消息 dump 出来
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { downloadOne, ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[ws-hook]', ...a);

// 在浏览器加载任何 JS 之前注入 WebSocket spy
const WS_SPY = `
(() => {
  if (window.__WS_SPY__) return;
  window.__WS_SPY__ = { sent: [], received: [], sockets: [] };
  const OrigWS = window.WebSocket;
  function SpyWS(url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    const idx = window.__WS_SPY__.sockets.length;
    window.__WS_SPY__.sockets.push({ url, readyState: ws.readyState });
    ws.addEventListener('open', () => {
      window.__WS_SPY__.sockets[idx].readyState = ws.readyState;
    });
    ws.addEventListener('message', (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : '[binary]';
        window.__WS_SPY__.received.push({ idx, t: Date.now(), data: data.slice(0, 4000) });
      } catch (e) {}
    });
    const origSend = ws.send.bind(ws);
    ws.send = function(data) {
      try {
        const s = typeof data === 'string' ? data : '[binary]';
        window.__WS_SPY__.sent.push({ idx, t: Date.now(), url: ws.url, data: s.slice(0, 4000) });
      } catch (e) {}
      return origSend(data);
    };
    return ws;
  }
  SpyWS.prototype = OrigWS.prototype;
  SpyWS.CONNECTING = OrigWS.CONNECTING;
  SpyWS.OPEN = OrigWS.OPEN;
  SpyWS.CLOSING = OrigWS.CLOSING;
  SpyWS.CLOSED = OrigWS.CLOSED;
  window.WebSocket = SpyWS;
  console.log('[ws-spy] WebSocket hooked');
})();
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // ⚠️ 在所有 JS 之前注入
  await page.addInitScript(WS_SPY);

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('ws-spy')) console.error('[browser]', t);
    if (msg.type() === 'error') console.error('[browser-err]', t.slice(0, 200));
  });

  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/lovart\.ai.*api|chat|generation|task|asset|selection|ws=/i.test(u)) {
      apiCalls.push({ t: Date.now(), type: 'req', method: req.method(), url: u.slice(0, 300), body: (req.postData() || '').slice(0, 500) });
    }
  });

  ensureDir('docs/ws');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/ws/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f }); log('   📸 ' + f); } catch {}
  }

  log('1. 进画布（WS spy 已注入）');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap('01-fresh');

  log('2. 跳过 onboarding');
  for (let i = 0; i < 5; i++) {
    const btn = await page.$('button:has-text("Next")');
    if (!btn) { log('   ✓ 完成（' + i + ' 次 Next）'); break; }
    try { await btn.click({ force: true, timeout: 5000 }); await sleep(800); } catch (e) { break; }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });
  await snap('02-after-skip');

  log('3. 上传参考图（用本地已有文件）');
  // 用 e2e 时下载过的本地文件（避免 OSS URL 过期）
  const localRef = 'd:/Desktop/lovart慢速生图/downloads/.tmp/1782208476215-3.png';
  if (!fs.existsSync(localRef)) throw new Error('本地参考图不存在: ' + localRef);
  log('   用 ' + localRef);

  // 试找 Lovart 真正的 file input
  const fileInputs = await page.$$eval('input[type="file"]', (els) =>
    els.map((e, i) => ({ i, accept: e.accept || '', classes: (e.className || '').toString().slice(0, 80), visible: e.offsetParent !== null })),
  );
  log('   找到 ' + fileInputs.length + ' 个 file input:');
  fileInputs.forEach((f) => console.log('     ', JSON.stringify(f)));

  if (fileInputs.length > 0) {
    log('   用 setInputFiles 上传');
    await page.setInputFiles('input[type="file"]', localRef);
    await sleep(2000);
    await snap('03-after-upload-fileinput');
  } else {
    log('   没 file input，用 base64 DataTransfer');
    const b64 = fs.readFileSync(localRef).toString('base64');
    await page.evaluate(async ({ dataUrl }) => {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'reference.png', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      const main = document.querySelector('main') || document.body;
      ['dragenter', 'dragover', 'drop'].forEach((ev) => {
        main.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }, { dataUrl: `data:image/png;base64,${b64}` });
    await sleep(2000);
    await snap('03-after-upload-datatransfer');
  }

  log('4. 输入 prompt');
  await page.evaluate(({ text }) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null);
    const e = all.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0];
    if (e) {
      e.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    }
  }, { text: '生成1张简单的猫咪图（橙白花色）' });
  await sleep(500);
  await snap('04-after-input');

  log('5. 打印当前 WS 状态');
  let spyData = await page.evaluate(() => window.__WS_SPY__);
  log('   sockets: ' + spyData.sockets.length + ', sent: ' + spyData.sent.length + ', received: ' + spyData.received.length);
  spyData.sockets.forEach((s, i) => console.log('   socket ' + i + ': ' + s.url.slice(0, 100)));

  log('6. 点 Agent');
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
  });
  const agentBtn = await page.$('button:has-text("Agent")');
  if (agentBtn) {
    await agentBtn.click({ force: true });
    log('   ✓ 已点');
  }
  await sleep(3000);
  await snap('05-after-send');

  log('7. 等 60s 看 WS 消息');
  for (let i = 1; i <= 6; i++) {
    await sleep(10_000);
    spyData = await page.evaluate(() => window.__WS_SPY__);
    console.log(`[t=${i * 10}s] sent=${spyData.sent.length} recv=${spyData.received.length}`);
  }
  await snap('06-after-60s');

  log('8. 打印所有 WS 消息');
  spyData = await page.evaluate(() => window.__WS_SPY__);
  fs.writeFileSync('docs/ws/spy-data.json', JSON.stringify(spyData, null, 2));
  console.log('=== Sent messages ===');
  spyData.sent.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx} ${m.url.slice(0, 80)}`);
    console.log('   data:', m.data.slice(0, 500));
  });
  console.log('\\n=== Received messages ===');
  spyData.received.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx}`);
    console.log('   data:', m.data.slice(0, 500));
  });

  log('9. 打印关键 HTTP API 调用');
  apiCalls.filter((c) => /chat|agent|task|ws=/i.test(c.url)).slice(0, 20).forEach((c) => {
    if (c.type === 'req') console.log('  →', c.method, c.url.slice(0, 150), c.body ? '\\n     body: ' + c.body : '');
  });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});