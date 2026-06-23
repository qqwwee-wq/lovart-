// scripts/explore-canvas.js —— 直接导航 /canvas?newProject=true 拿画布 DOM
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[explore-canvas]', ...a);

(async () => {
  if (!auth.exists()) { console.error('❌ 没找到 cookies'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/\/api\//i.test(u)) apiCalls.push({ method: req.method(), url: u.slice(0, 200) });
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/\/api\/canva\/(agent|project|task|selection)/i.test(u) && resp.status() === 200) {
      try { apiCalls.push({ respUrl: u.slice(0, 200), status: resp.status(), body: (await resp.text()).slice(0, 1500) }); } catch {}
    }
  });

  log('1. 直接导航 /canvas?newProject=true');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000); // 画布加载需要时间
  log('   URL:', page.url());

  const dump = {
    url: page.url(),
    title: await page.title(),
    visibleElements: await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button, [role="link"], [role="button"], input, textarea, [contenteditable]'));
      return all
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el, i) => ({
          i,
          tag: el.tagName,
          role: el.getAttribute('role') || '',
          type: el.type || '',
          text: (el.innerText || el.value || '').trim().slice(0, 60),
          placeholder: el.placeholder || '',
          accept: el.accept || '',
          aria: el.getAttribute('aria-label') || '',
          href: el.getAttribute('href') || '',
          classes: (el.className || '').toString().slice(0, 150),
          rect: (() => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          })(),
        }));
    }),
    keywordHits: await page.$$eval('*', (els) => {
      const kws = ['比例', '分辨率', '画质', 'Nano Banana', 'GPT Image', 'Seedance', 'Send', '发送', '上传', '附件', '3:4', '2K', '16:9', '1:1', '生成', '下载', '提示词', '选择模型', '你想设计', '对话', '新对话', 'Reference', '参考'];
      const out = [];
      for (const el of els) {
        if (el.children.length > 2) continue;
        const txt = (el.innerText || '').trim().slice(0, 80);
        if (!txt) continue;
        for (const kw of kws) {
          if (txt.includes(kw)) {
            out.push({ kw, tag: el.tagName, text: txt, classes: (el.className || '').toString().slice(0, 120) });
            break;
          }
        }
      }
      return out.slice(0, 60);
    }),
    apiCalls: apiCalls.slice(0, 100),
  };

  try { await page.screenshot({ path: 'docs/lovart-canvas.png', fullPage: true }); } catch (e) { log('screenshot fail:', e.message); }

  fs.writeFileSync('docs/lovart-canvas.json', JSON.stringify(dump, null, 2));
  log('   ✓ 已保存 docs/lovart-canvas.json');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});