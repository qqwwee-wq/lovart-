// scripts/diag-real-send.js —— 找出真正的发送按钮（不是 Agent 模式切换器）
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');

const log = (...a) => console.error('[diag-send]', ...a);

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
})();
`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();
  await page.addInitScript(WS_SPY);

  // 拦截 API
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/lovart\.ai.*\/api\/canva|chat|task|agent/i.test(u) && !/static|googleads|analytics|sentry|tag|tiktok|pinimg|clarity/i.test(u)) {
      apiCalls.push({ t: Date.now(), type: 'req', method: req.method(), url: u.slice(0, 200), body: (req.postData() || '').slice(0, 500) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/lovart\.ai.*\/api\/canva|chat|task|agent/i.test(u) && !/static|googleads|analytics|sentry|tag|tiktok|pinimg|clarity/i.test(u)) {
      try {
        const text = await resp.text();
        apiCalls.push({ t: Date.now(), type: 'resp', status: resp.status(), url: u.slice(0, 200), body: text.slice(0, 500) });
      } catch {}
    }
  });

  log('1. 进画布 + 全 dismiss onboarding');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try { await btn.click({ force: true, timeout: 2000 }); clicked = true; log(`   轮 ${round}: 点 "${text}"`); await sleep(500); break; } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) { await page.keyboard.press('Escape'); await sleep(500); }
  }

  log('2. 输入 prompt');
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
      document.execCommand('insertText', false, '生成1张简单的猫咪图（橙白花色）');
    }
  });
  await sleep(1000);

  log('3. 列输入区附近的按钮（详细）');
  const nearbyBtns = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'))
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.x >= 1000 && r.x <= 1430 && r.y >= 770 && r.y <= 900 && r.width < 120;
      });
    return all.map((b, i) => {
      const r = b.getBoundingClientRect();
      return {
        i,
        text: (b.innerText || '').slice(0, 30),
        ariaLabel: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        dataTestid: b.getAttribute('data-testid') || '',
        classes: (b.className || '').toString().slice(0, 80),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        innerHTML: b.outerHTML.slice(0, 300),
      };
    });
  });
  nearbyBtns.forEach((b) => console.log('   ', JSON.stringify(b)));

  log('4. 试试 Enter 发送（不点按钮）');
  await page.keyboard.press('Enter');
  await sleep(3000);
  let spy = await page.evaluate(() => window.__WS_SPY__);
  console.log(`   按 Enter 后: sent=${spy.sent.length} recv=${spy.received.length}`);

  log('5. 试试每个按钮（依次点）');
  const beforeApi = apiCalls.length;
  for (const btn of nearbyBtns) {
    // 重置 spy
    await page.evaluate(() => {
      window.__WS_SPY__.sent = [];
      window.__WS_SPY__.received = [];
    });
    // 重新输入 prompt（之前可能被发送走了）
    await page.evaluate(() => {
      const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
      if (e) {
        e.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, '生成1张猫咪图');
      }
    });
    await sleep(300);

    const clickX = btn.rect.x + btn.rect.w / 2;
    const clickY = btn.rect.y + btn.rect.h / 2;
    log(`   试 button[${btn.i}] "${btn.text || btn.dataTestid || btn.ariaLabel}" @ (${Math.round(clickX)},${Math.round(clickY)})`);
    await page.mouse.click(clickX, clickY);
    await sleep(3000);
    spy = await page.evaluate(() => window.__WS_SPY__);
    console.log(`     -> sent=${spy.sent.length} recv=${spy.received.length}`);
    if (spy.sent.length > 0 || spy.received.length > 0) {
      log('   🎯 这个按钮触发了 WS！');
      console.log('     sent:', JSON.stringify(spy.sent[0]?.data?.slice(0, 300)));
      break;
    }
  }

  log('6. 打印 API 调用（最近 30 条）');
  apiCalls.slice(-30).forEach((c) => {
    if (c.type === 'req') console.log('  →', c.method, c.url, c.body ? '\\n     body: ' + c.body : '');
    else console.log('  ←', c.status, c.url, '\\n     body:', c.body?.slice(0, 300));
  });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});