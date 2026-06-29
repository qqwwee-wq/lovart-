// scripts/check-user.js —— 查 Lovart 账号详细信息
const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  // 查所有可能的用户信息 endpoint
  const apis = [
    'https://www.lovart.ai/api/www/lovart/login/getUserByUuid?userUuid=e40fe1dddbe647ebac08fba8e80f1b65',
    'https://www.lovart.ai/api/www/lovart/member/account',
    'https://api.lovart.ai/api/www/user/info',
    'https://lgw.lovart.ai/v1/user/info?user_uuid=e40fe1dddbe647ebac08fba8e80f1b65',
  ];
  for (const u of apis) {
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        return { s: res.status, b: (await res.text()).slice(0, 800) };
      }, u);
      console.log('--- ' + u + ' [' + r.s + '] ---');
      console.log(r.b);
      console.log('');
    } catch (e) { console.log('ERR', u, e.message); }
  }

  // 导航到 Lovart 账号页看 UI
  log('导航到 Lovart 账号设置页');
  await page.goto('https://www.lovart.ai/zh/me', { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/account-page.png', fullPage: true });
  log('截图: docs/account-page.png');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

function log(...a) { console.error('[check-user]', ...a); }