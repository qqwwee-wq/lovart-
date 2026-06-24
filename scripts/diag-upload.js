// scripts/diag-upload.js —— 重点：完整关 onboarding + 找真的 file input 元素
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[diag-up]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  ensureDir('docs/diag3');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/diag3/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f }); log('   📸 ' + f); } catch {}
  }

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap('01-fresh');

  log('2. 完整关 onboarding：尝试所有 dismiss 按钮（Next, Get started, Got it, OK 等）');
  const dismissBtns = ['Next', 'Get started', 'Got it', 'OK', 'Skip', '跳过', '知道了', '开始使用'];
  for (let round = 0; round < 6; round++) {
    let clicked = false;
    for (const text of dismissBtns) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try {
          await btn.click({ force: true, timeout: 3000 });
          log('   ✓ 点 "' + text + '"');
          clicked = true;
          await sleep(800);
        } catch (e) {}
      }
    }
    // 也清弹窗遮罩
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
      document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
    });
    if (!clicked) {
      log('   ✓ 没更多 dismiss 按钮（轮 ' + round + '）');
      break;
    }
  }
  await snap('02-after-dismiss');

  log('3. 列所有 input[type="file"]');
  const fileInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input[type="file"]')).map((e, i) => {
      const r = e.getBoundingClientRect();
      return {
        i,
        accept: e.accept || '',
        multiple: e.multiple,
        visible: r.width > 0 && r.height > 0,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        parent: e.parentElement?.tagName,
      };
    });
  });
  log('   file input 数: ' + fileInputs.length);
  fileInputs.forEach((f) => console.log('     ', JSON.stringify(f)));

  log('4. 列所有带 "上传" "Add" "Upload" 文字的按钮');
  const uploadBtns = await page.evaluate(() => {
    const re = /(上传|Upload|Add|附加|上传文件|文件|file)/i;
    return Array.from(document.querySelectorAll('button, [role="button"], a, label, div'))
      .filter((e) => re.test(e.innerText || '') && e.offsetParent !== null)
      .slice(0, 15)
      .map((e, i) => {
        const r = e.getBoundingClientRect();
        return { i, tag: e.tagName, text: (e.innerText || '').slice(0, 40), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      });
  });
  uploadBtns.forEach((b) => console.log('     ', JSON.stringify(b)));

  log('5. 列所有 contenteditable + textbox');
  const inps = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea, input[type="text"]'))
      .filter((e) => e.offsetParent !== null)
      .map((e, i) => {
        const r = e.getBoundingClientRect();
        return { i, tag: e.tagName, role: e.getAttribute('role') || '', ce: e.getAttribute('contenteditable') || '', placeholder: e.placeholder || '', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      });
  });
  inps.forEach((b) => console.log('     ', JSON.stringify(b)));

  log('6. 截屏');
  await snap('03-final');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});