// scripts/test-visible-simple.js —— 最小可见模式测试（你应该看到浏览器窗口）
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  console.log('============================================');
  console.log('  CloakBrowser 可视模式最小测试');
  console.log('============================================');
  console.log('你应该看到一个浏览器窗口打开');
  console.log('');

  const { launch } = await import('cloakbrowser');
  console.log('启动浏览器...');
  const browser = await launch({
    headless: false,
    humanize: true,
    slowMo: 500,
  });
  console.log('✓ 浏览器启动');

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  console.log('访问 Lovart...');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log('✓ 已跳转');

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/visible-1-loaded.png', fullPage: false });
  console.log('📸 截图 1: docs/visible-1-loaded.png (页面加载后)');

  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'docs/visible-2-after-10s.png', fullPage: false });
  console.log('📸 截图 2: docs/visible-2-after-10s.png (10 秒后)');

  const state = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      bodyLen: (document.body.innerText || '').length,
      visibleText: (document.body.innerText || '').slice(0, 200),
      inputs: Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
        .filter((e) => e.offsetParent !== null).length,
      hasOnboarding: /onboarding|All-New|开始使用|应用品牌套件|Get started/i.test(document.body.innerText || ''),
    };
  });
  console.log('');
  console.log('页面状态:');
  console.log('  URL:', state.url);
  console.log('  Title:', state.title);
  console.log('  body 长度:', state.bodyLen);
  console.log('  可见输入框:', state.inputs);
  console.log('  还在 onboarding:', state.hasOnboarding);
  console.log('  body 文本:', JSON.stringify(state.visibleText));

  console.log('');
  console.log('⏰ 浏览器窗口会保持 60 秒供你查看');
  await page.waitForTimeout(60000);

  console.log('关闭');
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});