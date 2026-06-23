// scripts/find-model-api.js —— 看 Lovart 内部 API 是否暴露其他模型（API 枚举）
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[find-model-api]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  const apiResponses = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    // 拦截所有可能含模型列表的 API
    if (/\/api\//i.test(u) && resp.status() === 200) {
      try {
        const body = await resp.text();
        apiResponses.push({
          url: u.slice(0, 200),
          body: body.slice(0, 3000),
        });
      } catch {}
    }
  });

  log('1. 打开首页触发 API');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) await skipBtn.click();
  await page.waitForTimeout(1500);

  log('2. 进入画布触发更多 API');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);

  log('3. 过滤含模型列表的响应');
  const modelApis = apiResponses.filter((r) =>
    /model|nano|banana|gpt|image|seedance|design/i.test(r.body),
  );
  log('   模型相关 API: ' + modelApis.length + ' 条');

  modelApis.forEach((r) => {
    console.log('=== ' + r.url + ' ===');
    console.log(r.body.slice(0, 1500));
    console.log();
  });

  // 同时也直接 fetch Lovart 几个可能含模型枚举的 API
  log('4. 直接 fetch 模型 API 端点');
  const apisToTry = [
    'https://api.lovart.ai/api/canva/agent/modelList',
    'https://api.lovart.ai/api/canva/agent/models',
    'https://www.lovart.ai/api/canva/agent/modelList',
    'https://api.lovart.ai/api/www/lovart/model/list',
    'https://api.lovart.ai/api/canva/agent/selectionLabel',
  ];
  for (const u of apisToTry) {
    try {
      const r = await page.evaluate(async (url) => {
        const res = await fetch(url, { credentials: 'include' });
        return { status: res.status, body: (await res.text()).slice(0, 1500) };
      }, u);
      console.log('=== ' + u + ' === [' + r.status + ']');
      console.log(r.body.slice(0, 800));
      console.log();
    } catch (e) {
      console.log('=== ' + u + ' === ERROR: ' + e.message);
    }
  }

  fs.writeFileSync('docs/lovart-model-apis.json', JSON.stringify(modelApis, null, 2));
  log('✓ 已保存');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});