const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // 跳过登录直接看一个结果页面
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'commit', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // 找所有 img 的 src
  const urls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map(i => ({
      src: (i.src || i.getAttribute('data-src') || '').slice(0, 200),
      naturalHeight: i.naturalHeight,
      complete: i.complete,
    })).filter(x => x.naturalHeight > 100);
  });
  console.log(JSON.stringify(urls, null, 2));
  await browser.close();
})();
