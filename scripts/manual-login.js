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
    humanize: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log(`[manual-login] 已打开 ${page.url()}`);
  console.log('[manual-login] 请在浏览器中完成登录，系统会自动检测并保存...');
  console.log('[manual-login] 完成后也可以直接关闭浏览器窗口，自动结束');

  // 自动检测登录：每 3 秒检查是否有 Lovart 认证 cookie
  let loggedIn = false;
  const startTime = Date.now();
  const timeout = 300_000; // 5 分钟超时
  while (!loggedIn && Date.now() - startTime < timeout) {
    await new Promise(r => setTimeout(r, 3000));
    const state = await ctx.storageState();
    const authCookies = state.cookies.filter(c =>
      /lovart\.ai$/i.test(c.domain) && /token|auth|session|jwt|access/i.test(c.name)
    );
    if (authCookies.length > 0) {
      auth.save(state);
      console.log(`[manual-login] ✅ 自动检测到登录完成！`);
      console.log(`[manual-login] cookies 已保存到 ${auth.cookiesFile()}`);
      console.log(`[manual-login] cookie 数量: ${state.cookies.length}`);
      loggedIn = true;
    }
  }

  if (!loggedIn) {
    // 超时也保存
    const state = await ctx.storageState();
    auth.save(state);
    console.log('[manual-login] ⚠️ 检测超时（5分钟），已保存当前状态');
  }

  console.log('[manual-login] 关闭浏览器...');
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('[manual-login] ❌ 失败:', e.message);
  process.exit(1);
});
