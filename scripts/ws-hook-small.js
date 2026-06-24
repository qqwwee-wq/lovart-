// scripts/ws-hook-small.js —— 同时跑两件事：
//   1. 压小鱼图重做完整 WS hook（看 WS 是否有消息）
//   2. 下载 Lovart 的 main JS bundle 并 grep API 端点
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { downloadOne, ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[ws-small]', ...a);

const WS_SPY = `
(() => {
  if (window.__WS_SPY__) return;
  window.__WS_SPY__ = { sent: [], received: [], sockets: [] };
  const OrigWS = window.WebSocket;
  function SpyWS(url, protocols) {
    const ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    const idx = window.__WS_SPY__.sockets.length;
    window.__WS_SPY__.sockets.push({ url, readyState: ws.readyState });
    ws.addEventListener('message', (ev) => {
      try {
        const data = typeof ev.data === 'string' ? ev.data : '[binary]';
        window.__WS_SPY__.received.push({ idx, t: Date.now(), data: data.slice(0, 6000) });
      } catch (e) {}
    });
    const origSend = ws.send.bind(ws);
    ws.send = function(data) {
      try {
        const s = typeof data === 'string' ? data : '[binary]';
        window.__WS_SPY__.sent.push({ idx, t: Date.now(), url: ws.url, data: s.slice(0, 6000) });
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
})();
`;

(async () => {
  // 先生成一张 100KB 的小图（用 Playwright 内置的 canvas）
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();
  await page.addInitScript(WS_SPY);

  log('1. 下载 Lovart 主 JS bundle（通过 page request，绕过 Cloudflare）');
  const jsUrls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.src)
      .filter((u) => u.includes('lovart') && u.endsWith('.js'));
  });
  // 这些 script src 要等页面加载才有，先开个空白页抓
  // 改：直接 page.goto 一次取所有 script
  log('   进首页抓 script URL');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);
  const homeScripts = await page.$$eval('script[src]', (els) => els.map((e) => e.src));
  log('   首页 script 数: ' + homeScripts.length);
  homeScripts.slice(0, 5).forEach((u) => console.log('     ' + u));

  // 拿主页的最大 JS（通常包含 API 路径）
  const canvasScripts = homeScripts.filter((u) => /canvas|agent/i.test(u));
  log('   canvas 相关: ' + canvasScripts.length);

  // 直接 fetch 一个最大 JS（canvas main bundle）
  let bigJs = '';
  for (const url of canvasScripts.length > 0 ? canvasScripts : homeScripts) {
    try {
      const resp = await page.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 800_000) };
      }, url);
      if (resp.ok && resp.body.length > 10_000) {
        bigJs = resp.body;
        log('   ✓ 拿到 JS ' + resp.body.length + ' 字节 from ' + url.slice(-60));
        break;
      }
    } catch (e) {}
  }

  if (bigJs) {
    fs.writeFileSync('docs/ws/lovart-js.txt', bigJs);
    log('   ✓ 保存到 docs/ws/lovart-js.txt');

    // grep API 路径
    log('2. 抽取 API 端点');
    const apiPaths = [...new Set(bigJs.match(/\/api\/[a-zA-Z0-9/_-]+/g) || [])];
    apiPaths.slice(0, 30).forEach((p) => console.log('   ' + p));

    // grep /canva/agent/ 相关
    log('3. 找 /canva/agent/ 端点');
    const agentApis = [...new Set(bigJs.match(/\/canva\/agent\/[a-zA-Z0-9_/-]+/g) || [])];
    agentApis.slice(0, 30).forEach((p) => console.log('   ' + p));

    // grep websocket 相关
    log('4. 找 WebSocket 消息结构');
    const wsRelated = bigJs.match(/["']\w*["']\s*:\s*["'][a-z]+\.lovart\.ai["']/g) || [];
    wsRelated.slice(0, 20).forEach((w) => console.log('   ' + w));

    // grep 'send' / 'chat' / 'message' 关键词
    log('5. 找 send/chat 关键词上下文');
    const keywords = ['sendMessage', 'sendChat', 'chatMessage', 'agentMessage', 'runAgent', 'executeAgent', 'agentRun'];
    keywords.forEach((kw) => {
      const re = new RegExp('.{0,80}' + kw + '.{0,80}', 'g');
      const matches = bigJs.match(re) || [];
      if (matches.length > 0) {
        console.log('   ' + kw + ' (' + matches.length + ' 次):');
        matches.slice(0, 5).forEach((m) => console.log('     ' + m.replace(/\s+/g, ' ').slice(0, 200)));
      }
    });
  }

  log('=== 现在跑小图 WS hook ===');

  // 生成小图（100x100 纯色）
  log('6. 生成 100KB 小图');
  const tmpDir = path.join(config.downloadsDir, '.tmp');
  ensureDir(tmpDir);
  const smallImg = path.join(tmpDir, `ws-hook-small-${Date.now()}.png`);
  // 用 canvas 生成
  const smallB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#fff';
    ctx.font = '20px sans-serif';
    ctx.fillText('TEST', 60, 110);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(smallImg, Buffer.from(smallB64, 'base64'));
  log('   写到 ' + smallImg + ' (' + fs.statSync(smallImg).size + ' bytes)');

  log('7. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);

  log('8. 跳过 onboarding');
  for (let i = 0; i < 5; i++) {
    const btn = await page.$('button:has-text("Next")');
    if (!btn) break;
    try { await btn.click({ force: true, timeout: 5000 }); await sleep(800); } catch (e) { break; }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });

  log('9. 上传小图（DataTransfer）');
  const uploadRes = await page.evaluate(async ({ b64 }) => {
    const res = await fetch('data:image/png;base64,' + b64);
    const blob = await res.blob();
    const file = new File([blob], 'small.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const main = document.querySelector('main') || document.body;
    ['dragenter', 'dragover', 'drop'].forEach((ev) => {
      main.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    return { ok: true, fileSize: blob.size };
  }, { b64: smallB64 });
  log('   上传: ' + JSON.stringify(uploadRes));
  await sleep(3000);

  log('10. 输入 prompt');
  await page.evaluate(() => {
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
      document.execCommand('insertText', false, '生成1张简单的橙白花色猫咪图');
    }
  });
  await sleep(500);

  log('11. 截图 before-send');
  await page.screenshot({ path: 'docs/ws/small-before-send.png' });

  log('12. 点 Agent');
  const agentBtn = await page.$('button:has-text("Agent")');
  if (agentBtn) await agentBtn.click({ force: true });

  log('13. 监控 60s');
  for (let i = 1; i <= 6; i++) {
    await sleep(10_000);
    const spy = await page.evaluate(() => ({
      sent: window.__WS_SPY__.sent.length,
      recv: window.__WS_SPY__.received.length,
    }));
    console.log(`[t=${i * 10}s] sent=${spy.sent} recv=${spy.recv}`);
  }

  log('14. 截图 after-60s');
  await page.screenshot({ path: 'docs/ws/small-after-60s.png' });

  log('15. 打印 WS 消息');
  const spy = await page.evaluate(() => window.__WS_SPY__);
  fs.writeFileSync('docs/ws/spy-small.json', JSON.stringify(spy, null, 2));
  console.log('=== Sent ===');
  spy.sent.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx}`);
    console.log('   data:', m.data.slice(0, 800));
  });
  console.log('=== Received ===');
  spy.received.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx}`);
    console.log('   data:', m.data.slice(0, 800));
  });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});