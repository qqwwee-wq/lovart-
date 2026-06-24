// scripts/diag-full-flow.js —— 全 dismisser（识别所有 onboarding） + 输入 + Agent + WS hook
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[diag-full]', ...a);

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

  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('ws-spy')) console.error('[browser]', t);
  });

  ensureDir('docs/full');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/full/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f }); } catch {}
  }

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  await snap('01-fresh');

  log('2. 全 dismiss onboarding（连续 8 轮，每轮尝试所有 dismiss 按钮）');
  const dismissTexts = ['Next', 'Get started', 'Got it', 'OK', 'Skip', '跳过', '知道了', '开始使用', '关联品牌套件', '暂不', '不再提示'];
  for (let round = 1; round <= 8; round++) {
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try {
          await btn.click({ force: true, timeout: 2000 });
          log(`   轮 ${round}: 点 "${text}"`);
          clicked = true;
          await sleep(500);
          break;
        } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) {
      // 试试 ESC
      await page.keyboard.press('Escape');
      log(`   轮 ${round}: 无 dismiss 按钮，ESC`);
      await sleep(500);
    }
    // 检查剩余 onboarding 文本
    const onb = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length < 5);
      const onbKeywords = ['All-New Lovart', 'Membership', 'Brand', '品牌', 'onboarding', 'Getting started', '欢迎'];
      return all
        .filter((el) => onbKeywords.some((k) => (el.innerText || '').includes(k)))
        .filter((el) => el.offsetParent !== null)
        .slice(0, 5)
        .map((el) => (el.innerText || '').slice(0, 100));
    });
    if (onb.length === 0 && round > 1) {
      log(`   ✓ 无更多 onboarding 元素（轮 ${round}）`);
      break;
    } else if (onb.length > 0) {
      log('   剩余 onboarding: ' + JSON.stringify(onb.slice(0, 2)));
    }
  }
  await sleep(2000);
  await snap('02-after-dismiss');

  log('3. 列当前所有可见交互元素');
  const interactive = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, [role="button"], input, textarea, [role="textbox"], [contenteditable="true"]'))
      .filter((e) => e.offsetParent !== null);
    return all.map((e, i) => {
      const r = e.getBoundingClientRect();
      return {
        i,
        tag: e.tagName,
        text: (e.innerText || e.placeholder || e.value || '').slice(0, 40),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        role: e.getAttribute('role') || '',
      };
    });
  });
  interactive.forEach((b) => console.log('   ', JSON.stringify(b)));

  log('4. 上传参考图（小图 2KB）');
  const smallB64 = (await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 100; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 100, 100);
    return c.toDataURL('image/png').split(',')[1];
  }));
  await page.evaluate(async ({ b64 }) => {
    const res = await fetch('data:image/png;base64,' + b64);
    const blob = await res.blob();
    const file = new File([blob], 'ref.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const main = document.querySelector('main') || document.body;
    ['dragenter', 'dragover', 'drop'].forEach((ev) => {
      main.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
  }, { b64: smallB64 });
  await sleep(3000);
  await snap('03-after-upload');

  log('5. 输入 prompt');
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

  log('6. 当前 WS 状态');
  let spy = await page.evaluate(() => ({
    sockets: window.__WS_SPY__.sockets.length,
    sent: window.__WS_SPY__.sent.length,
    recv: window.__WS_SPY__.received.length,
  }));
  log('   ' + JSON.stringify(spy));

  log('7. 点 Agent');
  // 找 Agent 按钮（在输入框附近的）
  const agentBtn = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'))
      .filter((b) => (b.innerText || '').includes('Agent') && b.offsetParent !== null);
    if (all.length === 0) return null;
    return all[0].outerHTML.slice(0, 200);
  });
  log('   Agent 按钮 HTML: ' + agentBtn);

  const clickResult = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .filter((b) => (b.innerText || '').includes('Agent') && b.offsetParent !== null)[0];
    if (btn) {
      btn.click();
      return { clicked: true };
    }
    return { clicked: false };
  });
  log('   ' + JSON.stringify(clickResult));
  await sleep(3000);
  await snap('05-after-send');

  log('8. 监控 90s');
  for (let i = 1; i <= 9; i++) {
    await sleep(10_000);
    spy = await page.evaluate(() => ({
      sent: window.__WS_SPY__.sent.length,
      recv: window.__WS_SPY__.received.length,
    }));
    const bigImgs = await page.$$eval('img', (els) =>
      els.filter((i) => i.getBoundingClientRect().width > 100).length,
    );
    console.log(`[t=${i * 10}s] sent=${spy.sent} recv=${spy.recv} 大图=${bigImgs}`);
    if (spy.sent > 0 || spy.recv > 0) {
      log('   🎯 检测到 WS 消息！');
    }
    if (i % 3 === 0) await snap('t' + (i * 10) + 's');
  }

  log('9. 打印 WS 消息');
  spy = await page.evaluate(() => window.__WS_SPY__);
  fs.writeFileSync('docs/full/spy.json', JSON.stringify(spy, null, 2));
  console.log('=== Sent ===');
  spy.sent.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx}`);
    console.log('   data:', m.data.slice(0, 1500));
  });
  console.log('=== Received ===');
  spy.received.forEach((m, i) => {
    console.log(`[${i}] socket=${m.idx}`);
    console.log('   data:', m.data.slice(0, 800));
  });

  await snap('final');
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});