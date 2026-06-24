// src/lovart/browser.js —— 单个 BrowserContext 的生命周期（每个 worker 一份）
// 改用 CloakBrowser（drop-in Playwright 替换 + C++ 指纹补丁 + humanize）
// 每个 worker 独立 CloakBrowser 实例（避免 Lovart 限速/冲突）
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { makeLogger } = require('../logger');
const auth = require('./auth');

const log = makeLogger('lovart.browser');

/**
 * 启动一个全新的 CloakBrowser（每个 worker 独立实例）
 * @returns {Promise<Browser>}
 */
async function launchOwnBrowser() {
  const { launch } = await import('cloakbrowser');
  return launch({
    headless: true,
    humanize: true,
  });
}

/**
 * 创建一个带 Lovart cookies 的新 Browser + BrowserContext
 * 每个 worker 都有独立的 browser 实例
 * @param {string} workerLabel 用于日志
 */
async function newContext(workerLabel) {
  const browser = await launchOwnBrowser();
  log.info(`[${workerLabel}] ✓ CloakBrowser 启动`);

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  const cookies = auth.load();
  if (!cookies || !cookies.cookies) {
    await browser.close();
    throw new Error(
      `未找到 Lovart cookies (${auth.cookiesFile()})。请先执行：npm run login`,
    );
  }
  const filtered = cookies.cookies.filter(
    (c) => /\.lovart\.ai$/.test(c.domain) || c.domain.endsWith('.lovart.ai'),
  );
  await ctx.addCookies(filtered);
  log.info(`[${workerLabel}] ✓ 注入 ${filtered.length} cookies`);

  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);
  const url = page.url();
  if (url.includes('/login') || url.includes('/auth') || url.includes('/signin')) {
    await browser.close();
    throw new Error(`Lovart cookies 已失效（当前跳转到 ${url}）。请重新执行：npm run login`);
  }
  log.info(`[${workerLabel}] ✓ 已登录 URL=${url}`);

  return { browser, ctx, page };
}

async function closeAll() {
  // 无共享 browser，无需清理
}

module.exports = { newContext, closeAll, launchOwnBrowser };