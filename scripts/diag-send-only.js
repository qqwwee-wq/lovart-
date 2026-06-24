// scripts/diag-send-only.js —— 只点 agent-send-button，确认能真生成图
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');

const log = (...a) => console.error('[send-only]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // 拦截所有 canva 相关 API + 所有 a.lovart.ai 资源
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/(lovart\.ai.*api|agent|artifacts|a\.lovart)/i.test(u) && !/static|googleads|analytics|sentry|tiktok|pinimg|clarity|yandex/i.test(u)) {
      apiCalls.push({ t: Date.now(), type: 'req', method: req.method(), url: u.slice(0, 250), body: (req.postData() || '').slice(0, 600) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/(lovart\.ai.*api|agent|artifacts|a\.lovart)/i.test(u) && !/static|googleads|analytics|sentry|tiktok|pinimg|clarity|yandex/i.test(u)) {
      try {
        const text = await resp.text();
        apiCalls.push({ t: Date.now(), type: 'resp', status: resp.status(), url: u.slice(0, 250), body: text.slice(0, 600) });
      } catch {}
    }
  });

  log('1. 进画布 + dismiss onboarding');
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
  await sleep(2000);

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

  log('3. 点 [data-testid="agent-send-button"]');
  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('   ✓ 已点 send');

  log('4. 监控 5 分钟（每 30 秒检查大图数）');
  for (let i = 1; i <= 10; i++) {
    await sleep(30_000);
    const bigImgs = await page.$$eval('img', (els) =>
      els
        .filter((im) => im.getBoundingClientRect().width > 100)
        .map((im) => ({ src: (im.src || '').slice(0, 120), w: im.getBoundingClientRect().width, h: im.getBoundingClientRect().height })),
    );
    const visibleText = await page.evaluate(() => {
      const re = /生成|完成|正在|完成度|loading|done|complete/i;
      return Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.y > 50 && r.y < 850 && re.test(el.innerText || '');
        })
        .slice(0, 5)
        .map((el) => (el.innerText || '').slice(0, 60));
    });
    console.log(`[t=${i * 30}s] 大图=${bigImgs.length}`);
    if (bigImgs.length > 0) {
      console.log('   新图:');
      bigImgs.slice(0, 3).forEach((im) => console.log('     ', im.src, im.w + 'x' + im.h));
    }
    console.log(`   可见状态文本: ${JSON.stringify(visibleText.slice(0, 3))}`);
    if (bigImgs.length >= 1) break;
  }

  log('5. 打印 API 调用（lgw/canva/agent/select）');
  apiCalls
    .filter((c) => /canva|lgw|artifacts|chat|generate|task|send/i.test(c.url))
    .slice(-30)
    .forEach((c) => {
      if (c.type === 'req') console.log('  →', c.method, c.url, c.body ? '\\n     body: ' + c.body : '');
      else console.log('  ←', c.status, c.url, '\\n     body:', c.body?.slice(0, 400));
    });

  log('6. 最终截图');
  await page.screenshot({ path: 'docs/send-only-final.png', fullPage: true });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});