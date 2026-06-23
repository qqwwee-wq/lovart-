// scripts/find-nano-banana-2.js —— 全页面找 Nano Banana 2 + 看画布上所有可交互 UI
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[find-nb2]', ...a);

async function collectAllText(page) {
  return await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const hits = [];
    for (const el of all) {
      const txt = (el.innerText || el.textContent || '').trim();
      if (!txt) continue;
      // 找所有含 Nano Banana 字符的
      if (/Nano Banana/i.test(txt) && txt.length < 500) {
        hits.push({
          tag: el.tagName,
          text: txt,
          classes: (el.className || '').toString().slice(0, 100),
        });
      }
    }
    return hits;
  });
}

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // === 1. 首页全搜 ===
  log('A. 首页全搜 Nano Banana');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) await skipBtn.click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  let homeHits = await collectAllText(page);
  log('   首页命中: ' + homeHits.length);
  homeHits.slice(0, 20).forEach((h) => console.log('   ', h.tag, JSON.stringify(h.text.slice(0, 100))));

  // === 2. 在首页滚到最底 + 全文本搜索 ===
  log('B. 首页滚到底找隐藏模型');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);
  const homeHits2 = await collectAllText(page);
  log('   滚动后命中: ' + homeHits2.length);
  homeHits2.slice(0, 20).forEach((h) => console.log('   ', h.tag, JSON.stringify(h.text.slice(0, 100))));

  // === 3. 画布全搜（不带滚动）===
  log('C. 画布全搜 Nano Banana');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  // 移除弹窗
  await page.evaluate(() => {
    document.querySelectorAll('[data-state="open"][aria-hidden="true"]').forEach((el) => el.remove());
  });
  await page.waitForTimeout(500);

  let canvasHits = await collectAllText(page);
  log('   画布命中: ' + canvasHits.length);
  canvasHits.slice(0, 20).forEach((h) => console.log('   ', h.tag, JSON.stringify(h.text.slice(0, 100))));

  // === 4. 画布 - 点右上角"对话"按钮，可能打开设置面板 ===
  log('D. 点画布右上 "对话" 按钮');
  const dialogBtn = await page.$('button:has-text("对话")');
  if (dialogBtn) {
    await dialogBtn.click({ force: true });
    await page.waitForTimeout(2000);
    log('   ✓ 已点 对话');
  } else {
    log('   ⚠ 没找到 对话 按钮');
  }
  let canvasAfterDialogHits = await collectAllText(page);
  log('   对话面板后命中: ' + canvasAfterDialogHits.length);
  canvasAfterDialogHits.slice(0, 20).forEach((h) => console.log('   ', h.tag, JSON.stringify(h.text.slice(0, 100))));

  // 关掉
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // === 5. 画布 - 点 "Agent" 按钮 ===
  log('E. 点 Agent 按钮');
  const agentBtn = await page.$('button:has-text("Agent")');
  if (agentBtn) {
    await agentBtn.click({ force: true });
    await page.waitForTimeout(2000);
    log('   ✓ 已点 Agent');
  } else {
    log('   ⚠ 没找到 Agent');
  }
  let canvasAfterAgentHits = await collectAllText(page);
  log('   Agent 后命中: ' + canvasAfterAgentHits.length);
  canvasAfterAgentHits.slice(0, 30).forEach((h) => console.log('   ', h.tag, JSON.stringify(h.text.slice(0, 120))));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // === 6. 截一张画布全屏 ===
  try { await page.screenshot({ path: 'docs/lovart-deep-nb2.png', fullPage: true }); } catch {}

  fs.writeFileSync('docs/lovart-nb2.json', JSON.stringify({
    homeHits,
    homeHits2,
    canvasHits,
    canvasAfterDialogHits,
    canvasAfterAgentHits,
  }, null, 2));
  log('✓ 已保存 docs/lovart-nb2.json');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});