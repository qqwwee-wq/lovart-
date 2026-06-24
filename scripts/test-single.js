// scripts/test-single.js —— 只跑单条 prompt（不并发），看 CloakBrowser 是否稳定
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep, randomMouseMove } = require('../src/utils/humanize');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[single]', ...a);

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true });
  log('✓ CloakBrowser 启动');

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const filtered = auth.load().cookies.filter(
    (c) => /\.lovart\.ai$/.test(c.domain) || c.domain.endsWith('.lovart.ai'),
  );
  await ctx.addCookies(filtered);
  log(`✓ 注入 ${filtered.length} cookies`);

  const page = await ctx.newPage();
  ensureDir('docs/single-test');

  log('进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(4000, 6000);
  await randomMouseMove(page);

  log('dismiss onboarding');
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try { await btn.click({ force: true, timeout: 2000 }); clicked = true; await sleep(700); break; } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) { await page.keyboard.press('Escape'); await sleep(500); }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });
  await humanSleep(2000, 4000);
  await page.screenshot({ path: 'docs/single-test/s01-after-dismiss.png' });

  log('上传参考图（小图）');
  const smallB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 200, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
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
  await humanSleep(3000, 5000);
  await page.screenshot({ path: 'docs/single-test/s02-after-upload.png' });

  // 第一次输入 - 等久一点确保 input box 加载完
  log('输入第 1 条 prompt（多等几秒）');
  await humanSleep(3000, 5000); // 等 chat 输入框完全加载
  const input1Ok = await page.evaluate(({ text }) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 100 && r.height > 15 && r.x > 800; // 右下角 input
      });
    if (all.length === 0) return { ok: false, reason: 'no input found', candidates: Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea')).length };
    const e = all.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return { ok: true };
  }, { text: '生成1张简单的橙白花色猫咪图（半身照）' });
  log('输入结果: ' + JSON.stringify(input1Ok));
  await humanSleep(2000, 3000);

  log('点 send');
  await page.click('[data-testid="agent-send-button"]', { force: true });
  await sleep(3000);

  // 监控 2 分钟
  log('监控 2 分钟');
  for (let i = 1; i <= 4; i++) {
    await sleep(30_000);
    const state = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe')).filter((f) => /hcaptcha\.com|hcaptcha-/i.test(f.src || ''));
      const captchaDiv = Array.from(document.querySelectorAll('div')).filter((d) => {
        const t = (d.innerText || '');
        return d.children.length < 3 && /hCaptcha|hcaptcha|我是真实访客|浏览器验证/i.test(t);
      }).length;
      const bigImgs = Array.from(document.querySelectorAll('img')).filter((i) => i.getBoundingClientRect().width > 100).length;
      return { hcIframes: iframes.length, captchaDiv, bigImgs };
    });
    console.log(`[t=${i * 30}s] captcha: ${state.hcIframes}/${state.captchaDiv} | imgs: ${state.bigImgs}`);
    await page.screenshot({ path: `docs/single-test/t${i * 30}s.png` });
    if (state.bigImgs > 0) break;
  }

  await browser.close();
  log('✅ 完成');
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});