// scripts/find-newbtn.js —— 详细列出所有可见元素 + 找真正的"新建项目"按钮
'use strict';

const { chromium } = require('playwright');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) { await skipBtn.click(); await page.waitForTimeout(2000); }

  // 找所有可见的 link/button
  const elements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"]'));
    return all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el, i) => ({
        i,
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        text: (el.innerText || '').trim().slice(0, 50),
        href: el.getAttribute('href') || '',
        aria: el.getAttribute('aria-label') || '',
        visible: true,
        rect: (() => {
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        })(),
      }));
  });
  console.log('=== 可见元素 ===');
  elements.forEach((e) =>
    console.log(`[${e.i}] ${e.tag}${e.role ? '[' + e.role + ']' : ''} text=${JSON.stringify(e.text)} href=${JSON.stringify(e.href.slice(0, 80))} aria=${JSON.stringify(e.aria)} rect=${JSON.stringify(e.rect)}`),
  );

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});