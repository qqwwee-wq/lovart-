// scripts/credit-detail.js —— 详细查积分状态
const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  // 抓多个相关 endpoint
  for (const a of [
    '/api/www/lovart/member/free/power',
    '/api/www/lovart/member/account',
    '/api/canva/agent-cashier/task/query/unlimited',
    '/api/canva/agent-cashier/task/query/fast/unlimited',
    '/api/www/lovart/member/power',
    '/api/www/lovart/member/credit',
    '/api/canva/agent-cashier/power/get',
  ]) {
    const u = 'https://www.lovart.ai' + a;
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        const t = await res.text();
        return { s: res.status, b: t };
      }, u);
      console.log('\n[' + r.s + '] ' + a);
      console.log(r.b.slice(0, 800));
    } catch (e) {}
  }
  // 抓 lgw
  for (const a of [
    '/v1/account/get',
    '/v1/account/info',
    '/v1/credit/get',
    '/v1/credit/total',
    '/v1/user/me',
  ]) {
    const u = 'https://lgw.lovart.ai' + a;
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        const t = await res.text();
        return { s: res.status, b: t };
      }, u);
      if (r.s !== 404) {
        console.log('\n[' + r.s + '] ' + a);
        console.log(r.b.slice(0, 800));
      }
    } catch (e) {}
  }
  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });