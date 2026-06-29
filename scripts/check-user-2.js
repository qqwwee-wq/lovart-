// scripts/check-user-2.js —— 找用户信息
const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  for (const a of [
    '/api/www/lovart/user/info',
    '/api/www/lovart/account/info',
    '/api/www/lovart/getUserInfo',
    '/api/lovart/v1/user/me',
    '/api/lovart/v1/account/info',
    '/api/www/lovart/member/account',
    '/api/www/lovart/member/user',
  ]) {
    const u = 'https://api.lovart.ai' + a;
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include' });
        const t = await res.text();
        return { s: res.status, b: t.slice(0, 500) };
      }, u);
      if (r.s === 200 && !r.b.includes('"code":401')) {
        console.log(r.s, a, '|', r.b.slice(0, 200));
      }
    } catch (e) {}
  }
  for (const a of [
    '/api/www/lovart/member/account',
    '/api/canva/agent/genShareCode',
  ]) {
    const u = 'https://www.lovart.ai' + a;
    try {
      const r = await page.evaluate(async (u) => {
        const res = await fetch(u, { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'test', threadId: 'test', cid: 'test' }) });
        const t = await res.text();
        return { s: res.status, b: t.slice(0, 500) };
      }, u);
      if (r.s === 200 && !r.b.includes('"code":401')) {
        console.log(r.s, a, '|', r.b.slice(0, 200));
      }
    } catch (e) {}
  }

  // 直接看用户界面
  await page.goto('https://www.lovart.ai/zh/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // 找用户名
  const userInfo = await page.evaluate(() => {
    const avatarImg = document.querySelector('img[alt]');
    // 找包含中文昵称或 email 的元素
    const allText = document.body.innerText;
    const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const phoneMatch = allText.match(/1[3-9]\d{9}/);
    return {
      avatarAlt: avatarImg?.alt,
      email: emailMatch?.[0],
      phone: phoneMatch?.[0],
      bodyTextStart: allText.slice(0, 500),
    };
  });
  console.log('UI userInfo:', JSON.stringify(userInfo, null, 2));
  await page.screenshot({ path: 'docs/account-avatar.png', clip: { x: 1100, y: 0, width: 340, height: 100 } });
  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });