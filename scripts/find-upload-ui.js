// scripts/find-upload-ui.js —— 找 Lovart 真正的 upload UI（按钮 + file input）
'use strict';

const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep } = require('../src/utils/humanize');

const log = (...a) => console.error('[find-up]', ...a);

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(4000, 6000);

  // dismiss onboarding
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of ['Next', 'Get started', 'Got it', '跳过', '知道了']) {
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
  await humanSleep(3000, 5000);

  // 列所有 file input
  const fileInputs = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.map((i, idx) => ({
      idx,
      accept: i.accept,
      multiple: i.multiple,
      visible: i.offsetParent !== null,
      parentClass: (i.parentElement?.className || '').toString().slice(0, 100),
      grandparentClass: (i.parentElement?.parentElement?.className || '').toString().slice(0, 100),
    }));
  });
  log('file inputs: ' + JSON.stringify(fileInputs));

  // 列所有含"上传/Upload/Add"的可见元素
  const uploadButtons = await page.evaluate(() => {
    const re = /(上传|Upload|Add attachment|attach)/i;
    const all = Array.from(document.querySelectorAll('button, a, div, [role="button"]'))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 20 && r.height > 20 && r.x > 800 && r.y > 600;
      });
    return all.filter((e) => re.test(e.innerText || e.getAttribute('aria-label') || '')).slice(0, 10).map((e) => ({
      tag: e.tagName,
      text: (e.innerText || '').slice(0, 50),
      aria: e.getAttribute('aria-label') || '',
      classes: (e.className || '').toString().slice(0, 100),
      rect: (() => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    }));
  });
  log('upload buttons (right-bottom area): ' + JSON.stringify(uploadButtons));

  // 检查 hidden file input 可能被放在哪个父元素
  const hiddenFileInputParents = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    return inputs.map((i) => ({
      parentTag: i.parentElement?.tagName,
      parentClass: (i.parentElement?.className || '').toString().slice(0, 80),
      grandparentTag: i.parentElement?.parentElement?.tagName,
      grandparentClass: (i.parentElement?.parentElement?.className || '').toString().slice(0, 80),
      greatgrandparentTag: i.parentElement?.parentElement?.parentElement?.tagName,
      outerHTML: i.outerHTML.slice(0, 300),
    }));
  });
  log('hidden file input details: ' + JSON.stringify(hiddenFileInputParents, null, 2));

  // 找 "Add attachment" 或类似按钮（这是 Lovart 上传图的入口）
  const attachmentBtn = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const candidates = btns.filter((b) => {
      const r = b.getBoundingClientRect();
      const t = (b.innerText || '').trim();
      const a = b.getAttribute('aria-label') || '';
      return r.width > 0 && r.height > 0 && /^(Add|attachment|attach|上传|添加)/i.test(t + ' ' + a);
    });
    return candidates.slice(0, 5).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.innerText || '').slice(0, 30),
        aria: b.getAttribute('aria-label') || '',
        html: b.outerHTML.slice(0, 250),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    });
  });
  log('Add attachment buttons: ' + JSON.stringify(attachmentBtn, null, 2));

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});