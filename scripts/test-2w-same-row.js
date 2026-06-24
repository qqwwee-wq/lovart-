// scripts/test-2w-same-row.js —— 2 worker 并行跑同一行的 2 个 prompt
'use strict';

const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep, randomMouseMove } = require('../src/utils/humanize');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[2w]', ...a);

async function runOne(label, prompt) {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true });
  log(`[${label}] browser ok`);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const cookies = auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain));
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  ensureDir('docs/2w-test');

  try {
    await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await humanSleep(4000, 6000);
    await randomMouseMove(page);

    const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
    for (let round = 1; round <= 6; round++) {
      let clicked = false;
      for (const text of dismissTexts) {
        const btns = await page.$$('button:has-text("' + text + '")');
        for (const btn of btns) {
          try { await btn.click({ force: true, timeout: 2000 }); clicked = true; await sleep(700); break; } catch (e) {}
        }
        if (clicked) break;
      }
      if (!clicked) { await page.keyboard.press('Escape'); await sleep(500); }
    }
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
      document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
    });
    await humanSleep(2000, 4000);

    const b64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff8800';
      ctx.fillRect(0, 0, 200, 200);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.evaluate(async ({ b64 }) => {
      const res = await fetch('data:image/png;base64,' + b64);
      const blob = await res.blob();
      const file = new File([blob], 'ref.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const main = document.querySelector('main') || document.body;
      ['dragenter', 'dragover', 'drop'].forEach((ev) => {
        main.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    }, { b64 });
    await humanSleep(3000, 5000);

    // 输入框等待 + 重试
    let ok = false;
    for (let i = 1; i <= 8; i++) {
      const result = await page.evaluate((text) => {
        const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'));
        const v = all.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 100 && r.height > 15; });
        if (v.length === 0) return false;
        const e = v.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        e.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, text);
        return true;
      }, prompt);
      if (result) { ok = true; break; }
      await humanSleep(2000, 3000);
    }
    if (!ok) throw new Error('找不到输入框');
    await sleep(2000);
    await page.click('[data-testid="agent-send-button"]', { force: true });
    log(`[${label}] sent`);

    for (let i = 1; i <= 6; i++) {
      await sleep(30_000);
      const state = await page.evaluate(() => {
        const iframes = Array.from(document.querySelectorAll('iframe')).filter((f) => /hcaptcha\.com|hcaptcha-/i.test(f.src || ''));
        const big = Array.from(document.querySelectorAll('img')).filter((im) => im.getBoundingClientRect().width > 100);
        return { hc: iframes.length, big: big.length };
      });
      console.log(`[${label} t=${i * 30}s] captcha=${state.hc} bigImg=${state.big}`);
      if (state.big >= 1) break;
    }
    log(`[${label}] done`);
  } finally {
    await browser.close();
  }
}

(async () => {
  const prompts = [
    '生成1张简单的橙白花色猫咪站姿图（要求3:4比例）',
    '生成1张简单的橙白花色猫咪坐姿图（要求3:4比例）',
  ];
  await Promise.all([runOne('W1', prompts[0]), runOne('W2', prompts[1])]);
  log('all done');
})().catch((e) => {
  console.error('FAIL:', e.message);
  console.error(e.stack);
  process.exit(1);
});