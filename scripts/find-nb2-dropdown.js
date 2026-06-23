// scripts/find-nb2-dropdown.js —— 点首页 "Nano Banana Pro" 触发 dropdown，找 Nano Banana 2
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[nb2-dropdown]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  log('1. 首页');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) await skipBtn.click();
  await page.waitForTimeout(1500);

  log('2. 找所有 "Nano Banana" 元素（含可点击的）');
  const allNB = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    return all
      .filter((el) => /Nano Banana/i.test(el.innerText || ''))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el, i) => {
        const r = el.getBoundingClientRect();
        return {
          i,
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          text: (el.innerText || '').slice(0, 60),
          classes: (el.className || '').toString().slice(0, 120),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      });
  });
  allNB.forEach((m) => console.log('  ', m.i, m.tag, JSON.stringify(m.text.slice(0, 40)), 'rect=' + JSON.stringify({x:m.x,y:m.y,w:m.w,h:m.h})));

  log('3. 挨个点 Nano Banana 元素（找有 dropdown 行为的）');
  for (const target of allNB) {
    // 用 evaluate 点击（不依赖可见性）
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (el) el.click();
    }, { x: target.x + target.w / 2, y: target.y + target.h / 2 });
    await page.waitForTimeout(1500);

    // 检查是否有下拉
    const dropdownVisible = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"], [data-state="open"]'));
      return all
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el) => (el.innerText || '').slice(0, 300))
        .filter((t) => t.length > 0);
    });
    if (dropdownVisible.length > 0) {
      console.log('   🎯 点 (' + target.x + ',' + target.y + ') 后弹出:');
      dropdownVisible.forEach((d) => console.log('   >>>\n' + d.split('\n').map((l) => '       ' + l).join('\n')));
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  try { await page.screenshot({ path: 'docs/lovart-nb2-dropdown.png', fullPage: true }); } catch {}

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});