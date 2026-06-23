// scripts/smoke-lovart-flow.js —— 跑 Lovart 流程到"输入完成 + 点击发送前"，验证选择器都通
// 不真点发送（避免消耗积分）
'use strict';

const { chromium } = require('playwright');
const path = require('path');
const { sleep } = require('../src/utils/sleep');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[smoke]', ...a);

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  log('1. 打开新项目画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  log('   URL:', page.url());

  log('1.5 移除弹窗遮罩（只移除 pointer-events:auto 的）');
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });
  await page.waitForTimeout(500);

  log('2. 找输入框');
  const textbox = await page.$('[role="textbox"], div[contenteditable="true"]');
  if (!textbox) throw new Error('找不到输入框');
  log('   ✓ 找到输入框');

  log('3. 输入一个简单 prompt（不点发送）');
  // 不 click（click 会触发弹窗变化），直接用 evaluate focus + 输入
  const ok = await page.evaluate(() => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (!e) {
      console.error('textbox not found');
      console.error('all contenteditable:', document.querySelectorAll('[contenteditable]').length);
      console.error('all textbox:', document.querySelectorAll('[role="textbox"]').length);
      return false;
    }
    e.focus();
    // 用 execCommand 兼容 contenteditable
    document.execCommand('selectAll');
    document.execCommand('insertText', false, '一只可爱的猫咪（冒烟测试，不发送）');
    return true;
  });
  log('   ' + (ok ? '✓ 输入完成' : '✗ 输入失败'));
  await page.waitForTimeout(500);
  const text = await page.evaluate(() => document.querySelector('[role="textbox"], div[contenteditable="true"]').innerText);
  log('   ✓ 输入完成：' + JSON.stringify(text.slice(0, 50)));

  log('4. 找 Agent 按钮（确认能找到，不点）');
  const agentBtn = await page.$('button:has-text("Agent")');
  log('   ' + (agentBtn ? '✓ 找到' : '⚠ 没找到'));

  log('5. 截屏（带输入框 + prompt）');
  await page.screenshot({ path: 'docs/smoke-lovart-input.png', fullPage: false });
  log('   ✓ 已截图 docs/smoke-lovart-input.png');

  log('6. 关闭');
  await browser.close();
  log('✅ 冒烟测试通过');
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});