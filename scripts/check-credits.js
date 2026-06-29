// scripts/check-credits.js —— 查 Lovart 账号积分余额
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  // 抓取 API 响应
  const apiResponses = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/lovart\.ai.*(member|credit|account|power|quota|user)/i.test(u)) {
      try {
        const body = await resp.text();
        apiResponses.push({ url: u.slice(0, 150), status: resp.status(), body: body.slice(0, 1500) });
      } catch {}
    }
  });

  log('访问 Lovart 主页触发 API');
  await page.goto('https://www.lovart.ai/zh/home', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);

  log('检查账号 + 会员 API');
  for (const api of ['/api/www/lovart/member/account', '/api/www/lovart/member/free/power', '/api/www/lovart/member/packages?packageType=TRAIN&libId=0&language=zh']) {
    try {
      const resp = await page.evaluate(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        return { status: r.status, body: (await r.text()).slice(0, 2000) };
      }, 'https://www.lovart.ai' + api);
      console.log(`\n=== ${api} (${resp.status}) ===`);
      console.log(resp.body);
    } catch (e) {
      console.log(`=== ${api} ERROR: ${e.message.slice(0, 100)} ===`);
    }
  }

  // 抓所有相关 API
  log('\n=== 所有相关 API 响应 ===');
  apiResponses.forEach((r) => {
    console.log(`\n--- ${r.url.slice(0, 100)} (${r.status}) ---`);
    console.log(r.body.slice(0, 800));
  });

  // 截屏首页看余额显示
  await page.screenshot({ path: 'docs/account-info.png', fullPage: true });
  log('\n截图: docs/account-info.png');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

function log(...a) { console.error('[check-credits]', ...a); }