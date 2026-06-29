const path = require('path');
const auth = require(path.resolve(__dirname, '../src/lovart/auth'));
(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true, slowMo: 200 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();
  await page.goto('https://www.lovart.ai/zh/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  // 找积分显示
  const r = await page.evaluate(() => {
    // 找包含"积分"或数字的元素
    const all = Array.from(document.querySelectorAll('*'));
    const creditInfo = [];
    for (const el of all) {
      const t = (el.innerText || '').trim();
      if (/积分|credit|power|balance/i.test(t) && t.length < 200 && t.length > 0) {
        creditInfo.push({ tag: el.tagName, text: t.slice(0, 200) });
      }
    }
    // 找数字
    const numbers = Array.from(document.querySelectorAll('*'))
      .filter((e) => e.children.length === 0 && /^\d+$/.test((e.innerText || '').trim()))
      .map((e) => ({ tag: e.tagName, text: e.innerText.trim(), parent: e.parentElement?.innerText?.slice(0, 100) }))
      .slice(0, 30);
    return { creditInfo, numbers };
  });
  console.log('=== credit info ===');
  console.log(JSON.stringify(r, null, 2).slice(0, 2000));
  await page.screenshot({ path: 'docs/credit-display.png', fullPage: false });
  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
