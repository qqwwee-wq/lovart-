// scripts/diag-onboarding.js —— 极小心地走 onboarding，每步截图 + DOM dump
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');

const log = (...a) => console.error('[diag-onb]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  fs.mkdirSync('docs/onb', { recursive: true });

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000); // 充分等待
  log('   URL: ' + page.url());

  async function snapshot(label) {
    const f = 'docs/onb/' + label + '.png';
    await page.screenshot({ path: f });
    const stat = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[role="textbox"], [contenteditable="true"], input[type="file"], textarea, button'));
      return {
        buttons: all.filter((e) => e.tagName === 'BUTTON' && e.offsetParent !== null).length,
        textboxes: all.filter((e) => e.getAttribute('role') === 'textbox' && e.offsetParent !== null).length,
        contenteditables: all.filter((e) => e.getAttribute('contenteditable') === 'true' && e.offsetParent !== null).length,
        fileInputs: all.filter((e) => e.type === 'file').length,
        url: location.href,
        title: document.title,
        // 找所有可见的非空文本
        visibleTextSample: Array.from(document.querySelectorAll('*'))
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 50 && r.height > 20 && r.y > 50 && r.y < 850;
          })
          .slice(0, 80)
          .map((e) => (e.innerText || '').trim())
          .filter((t) => t.length > 0 && t.length < 60)
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 15),
      };
    });
    log('   [' + label + '] ' + JSON.stringify(stat));
  }

  await snapshot('00-fresh');

  log('2. 点 Next 一次（不删 overlay）');
  const btn1 = await page.$('button:has-text("Next")');
  if (btn1) {
    await btn1.click({ timeout: 5000 });
    await sleep(3000);
    await snapshot('01-after-next1');
  }

  log('3. 点 Next 第二次');
  const btn2 = await page.$('button:has-text("Next")');
  if (btn2) {
    await btn2.click({ timeout: 5000 });
    await sleep(3000);
    await snapshot('02-after-next2');
  }

  log('4. 点 Get started');
  const btn3 = await page.$('button:has-text("Get started")');
  if (btn3) {
    await btn3.click({ timeout: 5000 });
    await sleep(3000);
    await snapshot('03-after-get-started');
  }

  log('5. 再等 10s 看是否会渲染');
  await sleep(10_000);
  await snapshot('04-after-10s-wait');

  log('6. 等 30s 看是否会渲染');
  await sleep(30_000);
  await snapshot('05-after-30s-wait');

  log('7. 等 60s 看是否会渲染');
  await sleep(60_000);
  await snapshot('06-after-60s-wait');

  log('完成，URL: ' + page.url());
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});