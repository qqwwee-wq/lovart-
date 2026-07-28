// scripts/manual-login.js —— 一次性手动登录 Lovart，把 cookies 存到 ./data/cookies.json
// 用法：
//   1. node scripts/manual-login.js
//   2. 浏览器弹出后，手动完成 Google/Apple/邮箱 登录
//   3. 登录成功后回到本终端按回车
//   4. cookies 自动保存，下次 5 个 worker 会共享
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

// 用 cloakbrowser（打包内置了隐身 Chromium），不用 playwright.chromium

(async () => {
  console.log('[manual-login] 启动有头浏览器，请手动完成登录...');
  const { launch } = await import('cloakbrowser');
  const browser = await launch({
    headless: false,
    humanize: false,
    slowMo: 0,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log(`[manual-login] 已打开 ${page.url()}`);
  console.log('[manual-login] 请在浏览器中完成登录，完成后直接关闭浏览器窗口');
  console.log('[manual-login] cookies 会自动保存');

  // 定期保存 cookies，等用户关闭浏览器后退出
  let lastState = null;
  const saveInterval = setInterval(async () => {
    try {
      lastState = await ctx.storageState();
    } catch (_) {}
  }, 3000);

  browser.on('disconnected', () => {
    clearInterval(saveInterval);
    if (lastState) {
      auth.save(lastState);
      console.log(`[manual-login] ✅ cookies 已保存 (${lastState.cookies.length} 个)`);
    } else {
      console.log('[manual-login] ⚠️ 浏览器已关闭但未获取到 cookies');
    }
    process.exit(0);
  });

  // 保持运行直到浏览器关闭
  await new Promise(() => {});
})().catch((e) => {
  console.error('[manual-login] ❌ 失败:', e.message);
  process.exit(1);
});
