// scripts/explore-lovart.js —— 用已保存的 cookies 打开 Lovart，dump UI 信息到 stdout
// 用户跑 `npm run login` 保存 cookies 后，再跑这个：
//   node scripts/explore-lovart.js > docs/lovart-dom.txt
// 把输出贴给我，我把选择器填进 src/lovart/selectors.js
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

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const cookies = auth.load();
  await ctx.addCookies(cookies.cookies);
  const page = await ctx.newPage();
  await page.goto(config.lovart.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3000);

  console.log('=== URL ===');
  console.log(page.url());
  console.log('\n=== TITLE ===');
  console.log(await page.title());

  console.log('\n=== 全部 button（含 aria/text/svg）===');
  const buttons = await page.$$eval('button', (els) =>
    els.map((b, i) => ({
      idx: i,
      text: b.innerText.trim().slice(0, 50),
      aria: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      placeholder: b.getAttribute('placeholder') || '',
      disabled: b.disabled,
      classes: (b.className || '').toString().slice(0, 100),
      tag: b.outerHTML.slice(0, 250),
    })),
  );
  console.log(JSON.stringify(buttons, null, 2));

  console.log('\n=== 全部 input/textarea ===');
  const inputs = await page.$$eval('input, textarea', (els) =>
    els.map((i, idx) => ({
      idx,
      tag: i.tagName,
      type: i.type,
      placeholder: i.placeholder || '',
      accept: i.accept || '',
      aria: i.getAttribute('aria-label') || '',
      classes: (i.className || '').toString().slice(0, 100),
    })),
  );
  console.log(JSON.stringify(inputs, null, 2));

  console.log('\n=== 全部 [contenteditable] ===');
  const editables = await page.$$eval('[contenteditable]', (els) =>
    els.map((e, i) => ({
      idx: i,
      aria: e.getAttribute('aria-label') || '',
      placeholder: e.getAttribute('data-placeholder') || '',
      classes: (e.className || '').toString().slice(0, 100),
      tag: e.outerHTML.slice(0, 250),
    })),
  );
  console.log(JSON.stringify(editables, null, 2));

  console.log('\n=== 提示：现在请手动点几下，然后按回车 dump 当前页面 ===');
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (let round = 1; round <= 5; round++) {
    await new Promise((resolve) =>
      rl.question(`\n[第 ${round}/5 轮] 操作页面后按回车 dump 当前 DOM（q 退出）: `, (ans) => {
        if (ans.trim() === 'q') {
          rl.close();
          browser.close().then(() => process.exit(0));
        }
        resolve();
      }),
    );

    console.log(`\n--- 第 ${round} 轮当前可见 button ---`);
    const visibleBtns = await page.$$eval('button:visible', (els) =>
      els.map((b, i) => ({
        i,
        text: b.innerText.trim().slice(0, 60),
        aria: b.getAttribute('aria-label') || '',
      })),
    );
    console.log(JSON.stringify(visibleBtns, null, 2));

    console.log(`--- 第 ${round} 轮所有 <img> ---`);
    const imgs = await page.$$eval('img', (els) =>
      els.map((i, idx) => ({
        idx,
        alt: i.alt,
        src: (i.src || i.dataset.src || '').slice(0, 120),
        width: i.naturalWidth,
      })),
    );
    console.log(JSON.stringify(imgs, null, 2));
  }
  rl.close();
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
