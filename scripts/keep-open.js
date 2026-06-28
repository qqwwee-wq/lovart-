// scripts/keep-open.js —— 跑 client.js 完整流程，结束后保持浏览器开着供你查看
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep } = require('../src/utils/humanize');
const selectors = require('../src/lovart/selectors');

const log = (...a) => console.error('[keep-open]', ...a);

async function main() {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({
    headless: false,
    humanize: true,
    slowMo: 500,
  });
  log('✓ 浏览器已打开');

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  log('打开 Lovart canvas');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(5000, 7000);

  // 截图 1：刚加载
  await page.screenshot({ path: 'docs/keep-1-loaded.png' });
  log('📸 截图 1: docs/keep-1-loaded.png（刚加载）');

  log('点 Next（轮 1）');
  let btn = await page.$('button:has-text("Next")');
  if (btn) { await btn.click({ force: true }); await sleep(1500); }
  await page.screenshot({ path: 'docs/keep-2-r1.png' });
  log('📸 截图 2: docs/keep-2-r1.png（点 Next 后）');

  log('点 Next（轮 2）');
  btn = await page.$('button:has-text("Next")');
  if (btn) { await btn.click({ force: true }); await sleep(1500); }
  await page.screenshot({ path: 'docs/keep-3-r2.png' });
  log('📸 截图 3: docs/keep-3-r2.png（再点 Next 后）');

  log('点 Get started（轮 3）');
  btn = await page.$('button:has-text("Get started")');
  if (btn) { await btn.click({ force: true }); await sleep(2000); }
  await page.screenshot({ path: 'docs/keep-4-r3.png' });
  log('📸 截图 4: docs/keep-4-r3.png（点 Get started 后）');

  log('点 跳过（轮 4）');
  btn = await page.$('button:has-text("跳过")');
  if (btn) { await btn.click({ force: true }); await sleep(2000); }
  await page.screenshot({ path: 'docs/keep-5-r4.png' });
  log('📸 截图 5: docs/keep-5-r4.png（点 跳过 后）');

  log('ESC + 检查');
  await page.keyboard.press('Escape');
  await sleep(1500);
  await page.screenshot({ path: 'docs/keep-6-after-esc.png' });
  log('📸 截图 6: docs/keep-6-after-esc.png');

  const state = await page.evaluate(() => ({
    url: location.href,
    inputs: Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null).length,
    bodyLen: (document.body.innerText || '').length,
    bodyText: (document.body.innerText || '').slice(0, 300),
  }));
  log('页面状态: ' + JSON.stringify(state));

  log('============================================');
  log('⏰ 浏览器保持 5 分钟供你查看');
  log('============================================');
  for (let i = 1; i <= 30; i++) {
    await sleep(10_000);
    // 每 30 秒截一张图
    if (i % 3 === 0) {
      await page.screenshot({ path: `docs/keep-watch-${i}.png` });
    }
  }
  log('关闭');
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });