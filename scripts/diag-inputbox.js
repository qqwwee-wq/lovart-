// scripts/diag-inputbox.js —— 诊断：[role="textbox"] 在哪、有几个、弹窗是否真的挡事
'use strict';

const { chromium } = require('playwright');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);

  // 列出所有 role=textbox 元素
  const boxes = await page.$$eval('[role="textbox"], div[contenteditable="true"]', (els) =>
    els.map((el, i) => {
      const r = el.getBoundingClientRect();
      return {
        i,
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        ce: el.getAttribute('contenteditable') || '',
        classes: (el.className || '').toString().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || '',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        visible: r.width > 0 && r.height > 0,
        text: (el.innerText || '').slice(0, 50),
      };
    }),
  );
  console.log('=== 所有 [role="textbox"] / contenteditable ===');
  boxes.forEach((b) => console.log(JSON.stringify(b)));

  // 列出 fixed inset-0 bg-black 遮罩
  const overlays = await page.$$eval('.fixed.inset-0', (els) =>
    els.map((el, i) => ({
      i,
      classes: (el.className || '').toString().slice(0, 200),
      dataState: el.getAttribute('data-state') || '',
      ariaHidden: el.getAttribute('aria-hidden') || '',
      pointerEvents: getComputedStyle(el).pointerEvents,
      rect: (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    })),
  );
  console.log('\\n=== .fixed.inset-0 遮罩 ===');
  overlays.forEach((o) => console.log(JSON.stringify(o)));

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});