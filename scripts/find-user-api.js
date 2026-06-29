// scripts/find-user-api.js —— 通过实际导航抓所有可能的用户 API
const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  const apiCalls = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/lovart\.ai.*\/api\//i.test(u)) {
      try {
        const body = await resp.text();
        if (body.length < 3000) apiCalls.push({ url: u.slice(0, 200), status: resp.status(), body });
      } catch {}
    }
  });

  log('导航到 home 触发所有 API');
  await page.goto('https://www.lovart.ai/zh/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  log('等 5 秒让所有 lazy API 加载');
  await page.waitForTimeout(5000);

  // 找可能含用户信息的
  const userApis = apiCalls.filter(r => /user|account|profile|member|info|me/i.test(r.url));
  console.log('\n=== 用户相关 API ===');
  for (const r of userApis) {
    console.log('\n[' + r.status + '] ' + r.url);
    console.log('  body:', r.body.slice(0, 500));
  }

  // 看完整 API 列表
  console.log('\n=== 所有 API URL ===');
  apiCalls.forEach(r => console.log('  [' + r.status + '] ' + r.url));

  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });

function log(...a) { console.error('[find-user-api]', ...a); }