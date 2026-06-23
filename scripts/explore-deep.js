// scripts/explore-deep.js —— 点 "Agent" 按钮、看工具栏、dump 模型/比例选项
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[explore-deep]', ...a);

async function dumpVisible(page, label) {
  return await page.evaluate((label) => {
    const all = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"], input, textarea, [contenteditable], li, [role="menuitem"], [role="option"]'));
    const visible = all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el, i) => ({
        i,
        tag: el.tagName,
        role: el.getAttribute('role') || '',
        type: el.type || '',
        text: (el.innerText || el.value || '').trim().slice(0, 80),
        placeholder: el.placeholder || '',
        aria: el.getAttribute('aria-label') || '',
        classes: (el.className || '').toString().slice(0, 150),
        dataAttrs: Object.fromEntries(
          Array.from(el.attributes || [])
            .filter((a) => a.name.startsWith('data-'))
            .map((a) => [a.name, a.value.slice(0, 80)]),
        ),
      }));
    return { label, visible };
  }, label);
}

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  log('1. 进入画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);

  // 关掉可能的引导（按 ESC + 找 "Next" 关掉）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const nextBtn = await page.$('button:has-text("Next")');
  if (nextBtn) {
    log('   ✓ 关掉引导 Next');
    try { await nextBtn.click({ timeout: 3000 }); } catch {}
    await page.waitForTimeout(500);
  }

  const initial = await dumpVisible(page, 'initial');

  // 点 "Agent" 按钮 (1094, 851)
  log('2. 点 "Agent" 按钮（看模型选项）');
  const agentBtn = await page.$('button:has-text("Agent")');
  if (agentBtn) {
    await agentBtn.click();
    await page.waitForTimeout(1500);
  } else {
    log('   ⚠ 没找到 Agent 按钮');
  }
  const afterAgent = await dumpVisible(page, 'after-agent-click');

  // 关掉弹窗
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 检查工具栏那 11 个按钮（320-689, y=853）
  log('3. 检查工具栏按钮');
  const toolbarBtns = await page.$$eval('button', (els) =>
    els
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.y >= 840 && r.y <= 870 && r.x >= 300 && r.x <= 720 && r.width < 50;
      })
      .map((b, i) => ({ i, text: (b.innerText || '').trim().slice(0, 40), aria: b.getAttribute('aria-label') || '', classes: (b.className || '').toString().slice(0, 120) })),
  );
  log('   工具栏 ' + toolbarBtns.length + ' 个按钮');

  // 点第一个工具栏按钮（看是干嘛的）
  if (toolbarBtns.length > 0) {
    const first = await page.$$('button');
    for (const b of first) {
      const box = await b.boundingBox();
      if (box && box.y >= 840 && box.y <= 870 && box.x >= 300 && box.x <= 720 && box.width < 50) {
        await b.click();
        await page.waitForTimeout(1500);
        log('   ✓ 点了第一个工具栏按钮');
        break;
      }
    }
  }
  const afterToolbar = await dumpVisible(page, 'after-toolbar-click');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 截屏
  try { await page.screenshot({ path: 'docs/lovart-deep.png', fullPage: true }); } catch {}

  fs.writeFileSync('docs/lovart-deep.json', JSON.stringify({ initial, afterAgent, afterToolbar, toolbarBtns }, null, 2));
  log('✓ 已保存 docs/lovart-deep.json');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});