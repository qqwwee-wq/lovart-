// src/lovart/browser.js —— 单个 BrowserContext 的生命周期（每个 worker 一份）
'use strict';

const { chromium } = require('playwright');
const config = require('../config');
const { makeLogger } = require('../logger');
const auth = require('./auth');

const log = makeLogger('lovart.browser');

// 共享一个 chromium 进程，worker 共享浏览器但各自隔离 context
let sharedBrowser = null;
let sharedBrowserInitPromise = null;

async function getBrowser() {
  if (sharedBrowser) return sharedBrowser;
  if (sharedBrowserInitPromise) return sharedBrowserInitPromise;

  sharedBrowserInitPromise = (async () => {
    log.info('启动 Chromium（headless）');
    sharedBrowser = await chromium.launch({
      headless: true,
      // 减少被反爬识别的特征
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    sharedBrowser.on('disconnected', () => {
      log.warn('Chromium 断开连接');
      sharedBrowser = null;
      sharedBrowserInitPromise = null;
    });
    return sharedBrowser;
  })();
  return sharedBrowserInitPromise;
}

/**
 * 创建一个带 Lovart cookies 的新 BrowserContext（每个 worker 一次）
 * @param {string} workerLabel 用于日志
 */
async function newContext(workerLabel) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  // 注入 cookies
  const cookies = auth.load();
  if (!cookies || !cookies.cookies) {
    throw new Error(
      `未找到 Lovart cookies (${auth.cookiesFile()})。\n` +
      '请先执行：npm run login',
    );
  }
  // 只保留 lovart.ai 域名
  const filtered = cookies.cookies.filter(
    (c) => /\.lovart\.ai$/.test(c.domain) || c.domain.endsWith('.lovart.ai'),
  );
  await ctx.addCookies(filtered);
  log.info(`[${workerLabel}] 创建 BrowserContext，注入 ${filtered.length} 个 Lovart cookies`);

  // 验证登录态：访问首页看是否已登录
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);
  const url = page.url();
  if (url.includes('/login') || url.includes('/auth') || url.includes('/signin')) {
    throw new Error(
      `Lovart cookies 已失效（当前跳转到 ${url}）。请重新执行：npm run login`,
    );
  }
  log.info(`[${workerLabel}] 已登录，URL=${url}`);

  return { ctx, page };
}

async function closeAll() {
  if (sharedBrowser) {
    try {
      await sharedBrowser.close();
    } catch (_) {}
    sharedBrowser = null;
    sharedBrowserInitPromise = null;
  }
}

module.exports = { getBrowser, newContext, closeAll };
