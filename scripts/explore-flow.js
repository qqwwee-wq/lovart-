// scripts/explore-flow.js —— 跳过引导、找"新对话/项目"按钮、dump 真实画布 DOM
// 用法：node scripts/explore-flow.js > docs/lovart-flow.json 2> docs/lovart-flow.err
'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

function log(...a) { console.error('[explore]', ...a); }

async function dump(page, label) {
  const data = {
    label,
    url: page.url(),
    title: await page.title(),
    buttons: await page.$$eval('button', (els) =>
      els.map((b, i) => ({
        i,
        text: (b.innerText || '').trim().slice(0, 80),
        aria: b.getAttribute('aria-label') || '',
        classes: (b.className || '').toString().slice(0, 150),
        disabled: b.disabled,
        visible: b.offsetParent !== null,
      })),
    ),
    editables: await page.$$eval('[contenteditable]', (els) =>
      els.map((e, i) => ({
        i,
        aria: e.getAttribute('aria-label') || '',
        placeholder: e.getAttribute('data-placeholder') || '',
        classes: (e.className || '').toString().slice(0, 150),
        text: (e.innerText || '').slice(0, 80),
        visible: e.offsetParent !== null,
      })),
    ),
    inputs: await page.$$eval('input, textarea', (els) =>
      els.filter((e) => e.offsetParent !== null).map((i, idx) => ({
        idx,
        tag: i.tagName,
        type: i.type,
        placeholder: i.placeholder || '',
        accept: i.accept || '',
        aria: i.getAttribute('aria-label') || '',
        classes: (i.className || '').toString().slice(0, 150),
      })),
    ),
    // 找包含「新对话/新项目/对话」等关键词的元素
    keywords: ['新对话', '新项目', '对话', '项目', '上传', '附件', 'Nano Banana', 'Select model', 'Send', '3:4', '2K', '比例', '分辨率', '生成', '下载'],
    keywordHits: [],
  };
  // 关键词命中
  data.keywordHits = await page.$$eval(
    '*',
    (els, kws) => {
      const out = [];
      for (const el of els) {
        if (el.children.length > 3) continue;
        const txt = (el.innerText || '').trim().slice(0, 80);
        if (!txt) continue;
        for (const kw of kws) {
          if (txt.includes(kw)) {
            out.push({
              kw,
              tag: el.tagName,
              text: txt,
              classes: (el.className || '').toString().slice(0, 120),
            });
            break;
          }
        }
      }
      return out.slice(0, 40);
    },
    data.keywords,
  );
  return data;
}

(async () => {
  if (!auth.exists()) {
    console.error('❌ 没找到 cookies');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const cookies = auth.load();
  await ctx.addCookies(cookies.cookies);
  const page = await ctx.newPage();

  // 拦截 API 调用
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/\/api\//i.test(u)) {
      apiCalls.push({ method: req.method(), url: u.slice(0, 200), postData: (req.postData() || '').slice(0, 300) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/\/api\/canva\/agent|generation|task/i.test(u) && resp.status() === 200) {
      try {
        const text = await resp.text();
        apiCalls.push({ respUrl: u.slice(0, 200), status: resp.status(), body: text.slice(0, 500) });
      } catch (_) {}
    }
  });

  log('1. 打开首页');
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(5000);
  const home = await dump(page, 'home');

  log('2. 尝试点 "跳过" / "立即体验"');
  const skipBtn = await page.$('button:has-text("跳过")');
  if (skipBtn) {
    await skipBtn.click();
    log('   ✓ 已点跳过');
    await page.waitForTimeout(2000);
  } else {
    const tryBtn = await page.$('button:has-text("立即体验")');
    if (tryBtn) {
      await tryBtn.click();
      log('   ✓ 已点立即体验');
      await page.waitForTimeout(2000);
    }
  }

  // 关掉可能的弹窗（按 ESC）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const afterSkip = await dump(page, 'after-skip');

  log('3. 尝试点 "新对话" 或 "新项目"');
  const newBtn = await page.$('button:has-text("新对话"), button:has-text("新项目"), a:has-text("新对话"), a:has-text("新项目")');
  if (newBtn) {
    await newBtn.click();
    log('   ✓ 已点 新对话');
    await page.waitForTimeout(3000);
  } else {
    log('   ⚠ 没找到 新对话/新项目 按钮');
  }

  const afterNew = await dump(page, 'after-new');

  log('4. dump 完整页面 HTML（截断）');
  const html = await page.content();
  const htmlSnippet = html.slice(0, 30000);

  console.log(JSON.stringify({
    home,
    afterSkip,
    afterNew,
    apiCalls: apiCalls.slice(0, 80),
    htmlSnippet,
  }, null, 2));

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});
