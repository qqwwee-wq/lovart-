// scripts/manual-login.js —— 一次性手动登录 Lovart，把 cookies 存到 ./data/cookies.json
// 用法：
//   1. node scripts/manual-login.js
//   2. 浏览器弹出后，手动完成 Google/Apple/邮箱 登录
//   3. 登录成功后回到本终端按回车
//   4. cookies 自动保存，下次 5 个 worker 会共享
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const readline = require('readline');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  console.log('[manual-login] 启动有头浏览器，请手动完成登录...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log(`[manual-login] 已打开 ${page.url()}`);
  console.log('[manual-login] 请在打开的浏览器里完成登录（Google / Apple / 邮箱）');
  console.log('[manual-login] 登录完成后回到这里按回车，cookies 会自动保存');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question('> 按回车保存 cookies（Ctrl+C 取消）: ', resolve));
  rl.close();

  // 拿到当前 storage state（含 cookies）
  const state = await ctx.storageState();
  auth.save(state);
  console.log(`[manual-login] ✅ cookies 已保存到 ${auth.cookiesFile()}`);
  console.log(`[manual-login] cookie 数量: ${state.cookies.length}`);
  console.log('[manual-login] 关闭浏览器...');
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.error('[manual-login] ❌ 失败:', e.message);
  process.exit(1);
});
