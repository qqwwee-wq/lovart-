// scripts/find-model-selector.js —— 回到首页，找到模型选择器，列出所有可用模型
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[find-model]', ...a);

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  log('1. 打开首页');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);

  log('2. 跳过引导');
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) await skipBtn.click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  log('3. 找所有含 Nano Banana / 模型 / Select model 的元素');
  const modelElements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const out = [];
    for (const el of all) {
      if (el.children.length > 2) continue;
      const txt = (el.innerText || '').trim();
      if (!txt) continue;
      if (/(Nano Banana|模型|model|Model|GPT Image|Seedance|Design)/i.test(txt) && txt.length < 300) {
        const r = el.getBoundingClientRect();
        out.push({
          tag: el.tagName,
          text: txt,
          classes: (el.className || '').toString().slice(0, 120),
          rect: r.width > 0 ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
          role: el.getAttribute('role') || '',
          aria: el.getAttribute('aria-label') || '',
        });
      }
    }
    return out.slice(0, 30);
  });
  log('   找到 ' + modelElements.length + ' 个相关元素:');
  modelElements.forEach((m) => console.log('   ', m.tag, 'text=' + JSON.stringify(m.text.slice(0, 80)), 'rect=' + JSON.stringify(m.rect), 'role=' + m.role));

  log('4. 尝试点 "让 Lovart 设计" 或 "Select model"');
  const triggerSelectors = [
    'button:has-text("让 Lovart 设计")',
    'button:has-text("Select model")',
    'button:has-text("选择模型")',
    'div:has-text("Nano Banana")',
    '[role="combobox"]',
  ];
  let clicked = false;
  for (const sel of triggerSelectors) {
    const el = await page.$(sel);
    if (el) {
      log('   试 ' + sel);
      try {
        await el.click({ force: true, timeout: 5000 });
        log('   ✓ 已点');
        clicked = true;
        break;
      } catch (e) {
        log('   ✗ ' + e.message.slice(0, 100));
      }
    }
  }
  if (clicked) await page.waitForTimeout(2000);

  log('5. 列出所有可见菜单/弹窗内容');
  const dialogContent = await page.evaluate(() => {
    // 找所有可能是弹窗/菜单的容器
    const candidates = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-state="open"]'));
    return candidates.map((el, i) => ({
      i,
      tag: el.tagName,
      role: el.getAttribute('role') || '',
      dataState: el.getAttribute('data-state') || '',
      text: (el.innerText || '').slice(0, 500),
      classes: (el.className || '').toString().slice(0, 100),
    }));
  });
  dialogContent.forEach((d) => {
    console.log('--- dialog', d.i, d.role, d.dataState, '---');
    console.log(d.text.slice(0, 400));
  });

  try { await page.screenshot({ path: 'docs/lovart-model-dropdown.png', fullPage: true }); } catch {}

  fs.writeFileSync('docs/lovart-model-dropdown.json', JSON.stringify({ modelElements, dialogContent }, null, 2));
  log('✓ 已保存');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});