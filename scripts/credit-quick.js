// scripts/credit-quick.js
const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));
(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();
  // 先访问 home 让 cookies 激活
  await page.goto('https://www.lovart.ai/zh/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  // 再 fetch
  const r = await page.evaluate(async () => {
    const r1 = await fetch('https://www.lovart.ai/api/www/lovart/member/free/power', { credentials: 'include' });
    const r2 = await fetch('https://www.lovart.ai/api/www/lovart/member/account', { credentials: 'include' });
    return {
      power: { s: r1.status, b: await r1.text() },
      account: { s: r2.status, b: (await r2.text()).slice(0, 1000) },
    };
  });
  console.log('=== power ===');
  console.log(r.power.b);
  console.log('\n=== account ===');
  console.log(r.account.b);
  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });