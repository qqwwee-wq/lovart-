// scripts/probe-model-api.js —— 用 page context 直接 fetch 各种模型相关 API
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[probe-model-api]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // 先访问 canvas 拿到 projectId
  log('1. 进画布拿 projectId');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  const projectId = new URL(page.url()).searchParams.get('projectId');
  log('   projectId=' + projectId);

  // 尝试各种 API 看哪个返回模型列表
  log('2. 探测模型相关 API');
  const apis = [
    // 已知的项目 API
    { url: `https://www.lovart.ai/api/canva/project/queryProject`, method: 'POST', body: { projectId } },
    { url: `https://api.lovart.ai/api/canva/project/queryProject`, method: 'POST', body: { projectId } },
    // 模型列表
    { url: `https://www.lovart.ai/api/canva/agent/modelList`, method: 'GET' },
    { url: `https://api.lovart.ai/api/canva/agent/modelList`, method: 'GET' },
    { url: `https://www.lovart.ai/api/canva/agent/models`, method: 'GET' },
    { url: `https://api.lovart.ai/api/canva/agent/models`, method: 'GET' },
    { url: `https://www.lovart.ai/api/canva/model/list`, method: 'GET' },
    { url: `https://api.lovart.ai/api/canva/model/list`, method: 'GET' },
    { url: `https://www.lovart.ai/api/canva/agent/selectionLabel`, method: 'POST', body: { projectId } },
    // 项目里可能含 model
    { url: `https://www.lovart.ai/api/canva/agent/selectionChat?projectId=${projectId}`, method: 'GET' },
    // 会员专属模型列表
    { url: `https://www.lovart.ai/api/www/lovart/member/account`, method: 'GET' },
    { url: `https://www.lovart.ai/api/www/lovart/member/free/power`, method: 'GET' },
  ];

  const results = [];
  for (const a of apis) {
    try {
      const r = await page.evaluate(async ({ url, method, body }) => {
        const opts = { method, credentials: 'include', headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        return { status: res.status, body: (await res.text()).slice(0, 4000) };
      }, a);
      const found = /nano banana/i.test(r.body);
      results.push({ ...a, status: r.status, body: r.body, hasNanoBanana: found });
      console.log(`[${r.status}] ${a.method} ${a.url}${a.body ? ' body=' + JSON.stringify(a.body).slice(0, 60) : ''} ${found ? '🎯' : ''}`);
    } catch (e) {
      console.log(`[ERR] ${a.method} ${a.url}: ${e.message.slice(0, 80)}`);
    }
  }

  // 找返回里有 model 相关字段的
  log('3. 提取模型枚举（关键字 nano banana + 邻近字段）');
  results.forEach((r) => {
    if (!r.hasNanoBanana) return;
    console.log('=== ' + r.url + ' ===');
    // 抽取包含 nano banana 附近的 JSON 片段
    const matches = r.body.match(/[^\{\},\[\]]{0,80}[Nn]ano\s?[Bb]anana[^\{\},\[\]]{0,80}/g) || [];
    matches.slice(0, 10).forEach((m) => console.log('  ', JSON.stringify(m)));
    console.log();
  });

  fs.writeFileSync('docs/lovart-probe.json', JSON.stringify(results, null, 2));
  log('✓ 已保存 docs/lovart-probe.json');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});