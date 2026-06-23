// scripts/explore-once.js —— 一次性 dump Lovart 登录后首页的所有 UI 信息
// 用法：node scripts/explore-once.js > docs/lovart-dom.json
'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

(async () => {
  if (!auth.exists()) {
    console.error('❌ 没找到 cookies，请先 npm run login');
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

  // 收集网络请求（看 Lovart 调了哪些 API）
  const apiCalls = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/|lovart\.ai.*graphql|generate|create|upload/i.test(url)) {
      apiCalls.push({ method: req.method(), url: url.slice(0, 200), when: Date.now() });
    }
  });

  await page.goto(config.lovart.homeUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const result = {
    url: page.url(),
    title: await page.title(),
    timestamp: new Date().toISOString(),
  };

  // === 1. 所有 button ===
  result.buttons = await page.$$eval('button', (els) =>
    els.map((b, i) => ({
      idx: i,
      text: (b.innerText || '').trim().slice(0, 80),
      aria: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      disabled: b.disabled,
      type: b.type || '',
      // 提取 data-* 属性（通常前端用 data-testid 等做选择）
      dataAttrs: Object.fromEntries(
        Array.from(b.attributes)
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => [a.name, a.value.slice(0, 80)]),
      ),
      // 类名前 5 个（用于复合选择器）
      classes: (b.className || '').toString().slice(0, 200),
      // 父元素链（最近 3 层）
      parents: (() => {
        const ps = [];
        let p = b.parentElement;
        for (let i = 0; i < 3 && p; i++) {
          ps.push((p.className || '').toString().slice(0, 100));
          p = p.parentElement;
        }
        return ps;
      })(),
    })),
  );

  // === 2. 所有 input/textarea ===
  result.inputs = await page.$$eval('input, textarea', (els) =>
    els.map((i, idx) => ({
      idx,
      tag: i.tagName,
      type: i.type || '',
      placeholder: i.placeholder || '',
      accept: i.accept || '',
      aria: i.getAttribute('aria-label') || '',
      name: i.name || '',
      classes: (i.className || '').toString().slice(0, 150),
      visible: i.offsetParent !== null,
    })),
  );

  // === 3. 所有 contenteditable ===
  result.editables = await page.$$eval('[contenteditable]', (els) =>
    els.map((e, i) => ({
      idx: i,
      aria: e.getAttribute('aria-label') || '',
      placeholder: e.getAttribute('data-placeholder') || '',
      classes: (e.className || '').toString().slice(0, 150),
      text: (e.innerText || '').slice(0, 100),
    })),
  );

  // === 4. 文本里包含关键中文的可见元素（定位"新对话/上传/选模型/发送/3:4/2K/Nano Banana"等）===
  const keywords = ['新对话', '新项目', '创建', '上传', '附件', 'Select model', 'Nano Banana', '3:4', '2K', 'Send', '发送', '比例', '分辨率', '画质', '模型', '生成', '下载'];
  result.keywordHits = await page.$$eval('*', (els, kws) => {
    const out = [];
    for (const el of els) {
      if (el.children.length > 3) continue; // 太深的容器跳过
      const txt = (el.innerText || '').trim().slice(0, 60);
      if (!txt) continue;
      for (const kw of kws) {
        if (txt.includes(kw)) {
          out.push({
            keyword: kw,
            text: txt,
            tag: el.tagName,
            classes: (el.className || '').toString().slice(0, 120),
            dataAttrs: Object.fromEntries(
              Array.from(el.attributes || [])
                .filter((a) => a.name.startsWith('data-'))
                .map((a) => [a.name, a.value.slice(0, 60)]),
            ),
          });
          break;
        }
      }
    }
    return out.slice(0, 80);
  }, keywords);

  // === 5. 所有 <img> ===
  result.images = await page.$$eval('img', (els) =>
    els
      .filter((i) => i.offsetParent !== null)
      .slice(0, 30)
      .map((i, idx) => ({
        idx,
        alt: i.alt || '',
        src: (i.src || '').slice(0, 200),
        width: i.naturalWidth,
        height: i.naturalHeight,
      })),
  );

  // === 6. 主交互区域（找包含 "你想设计什么" 的祖先容器）===
  result.mainArea = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const txt = el.innerText || '';
      if (txt.includes('你想设计什么') && txt.length < 5000) {
        return {
          classes: (el.className || '').toString().slice(0, 200),
          outerHTMLStart: el.outerHTML.slice(0, 1500),
        };
      }
    }
    return null;
  });

  // === 7. Lovart API 调用 ===
  result.apiCalls = apiCalls.slice(0, 50);

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});
