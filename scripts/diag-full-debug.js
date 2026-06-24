// scripts/diag-full-debug.js —— 全程截图 + DOM 监控，找出 send 后到底发生什么
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep, randomMouseMove } = require('../src/utils/humanize');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[diag-full]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  ensureDir('docs/diag-full');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/diag-full/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f, fullPage: true }); log('   📸 ' + f); } catch (e) { log('   📸 fail: ' + e.message); }
  }

  // 拦截所有网络
  const allReqs = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/(lovart\.ai|a\.lovart\.ai).*?(api|agent|artifacts|chat|task|hcap|google)/i.test(u)) {
      allReqs.push({ t: Date.now(), dir: '→', method: req.method(), url: u.slice(0, 200), body: (req.postData() || '').slice(0, 300) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/(lovart\.ai|a\.lovart\.ai).*?(api|agent|artifacts|chat|task|hcap)/i.test(u)) {
      try {
        const body = await resp.text();
        allReqs.push({ t: Date.now(), dir: '←', status: resp.status(), url: u.slice(0, 200), bodyStart: body.slice(0, 300) });
      } catch {}
    }
  });

  async function dumpState(label) {
    const state = await page.evaluate(() => {
      // hCaptcha 检测（包括 invisible）
      const allIframes = Array.from(document.querySelectorAll('iframe'));
      const hcIframes = allIframes.filter((f) => /hcaptcha\.com|hcaptcha-|newcaptcha/i.test(f.src || ''));
      const sitekeyEl = document.querySelector('[data-sitekey]');
      const captchaDiv = Array.from(document.querySelectorAll('div')).filter((d) => {
        const t = (d.innerText || '');
        return d.children.length < 3 && /hCaptcha|hcaptcha|我是真实访客|隐私|继续之前|安全性|robot|verify/i.test(t);
      }).slice(0, 3).map((d) => (d.innerText || '').slice(0, 80));
      // 全局对象
      const hcGlobals = {
        hcaptcha: typeof window.hcaptcha,
        grecaptcha: typeof window.grecaptcha,
        turnstile: typeof window.turnstile,
      };
      // sidebar 聊天历史
      const sidebar = Array.from(document.querySelectorAll('*')).find((e) => {
        const r = e.getBoundingClientRect();
        return r.x > 1000 && r.y < 900 && r.width > 300 && r.height > 400 && (e.innerText || '').includes('新对话');
      });
      const sidebarText = sidebar ? (sidebar.innerText || '').slice(0, 600) : '';
      const sidebarImgs = sidebar ? Array.from(sidebar.querySelectorAll('img'))
        .filter((i) => i.getBoundingClientRect().width > 30)
        .map((i) => ({ src: (i.src || '').slice(0, 100), w: i.getBoundingClientRect().width })) : [];
      // 大图
      const bigImgs = Array.from(document.querySelectorAll('img'))
        .filter((i) => i.getBoundingClientRect().width > 100)
        .map((i) => ({ src: (i.src || '').slice(0, 100), w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
      return {
        url: location.href,
        hcIframes: hcIframes.length,
        hcIframeSrcs: hcIframes.map((f) => f.src.slice(0, 100)),
        sitekey: sitekeyEl?.getAttribute('data-sitekey') || '',
        captchaDiv,
        hcGlobals,
        sidebarTextSample: sidebarText.slice(0, 200),
        sidebarImgs,
        bigImgs,
      };
    });
    log('   [' + label + '] ' + JSON.stringify({
      hcIframes: state.hcIframes,
      sitekey: state.sitekey,
      captchaDiv: state.captchaDiv,
      hcGlobals: state.hcGlobals,
      sidebarImgs: state.sidebarImgs.length,
      bigImgs: state.bigImgs.length,
      sidebarSnippet: state.sidebarTextSample.slice(0, 100),
    }));
    return state;
  }

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(4000, 6000);
  await randomMouseMove(page);
  await snap('01-fresh');

  // dismiss onboarding
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
  await snap('02-after-dismiss');
  await dumpState('after-dismiss');

  log('2. 上传参考图');
  const smallB64 = (await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#fff';
    ctx.font = '30px sans-serif';
    ctx.fillText('REF', 60, 110);
    return c.toDataURL('image/png').split(',')[1];
  }));
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
  }, { b64: smallB64 });
  await humanSleep(2000, 4000);
  await snap('03-after-upload');
  await dumpState('after-upload');

  log('3. 输入 prompt');
  await page.evaluate(({ text }) => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (e) { e.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text); }
  }, { text: '生成1张简单的猫咪图（橙白花色）' });
  await humanSleep(1000, 2000);
  await snap('04-after-input');
  await dumpState('after-input');

  log('4. 点 send');
  await randomMouseMove(page);
  await humanSleep(2000, 4000);
  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('   ✓ 已点');
  await sleep(3000);
  await snap('05-3s-after-send');
  await dumpState('3s-after-send');

  log('5. 监控 4 分钟（每 30 秒）');
  for (let i = 1; i <= 8; i++) {
    await sleep(30_000);
    const state = await dumpState('t=' + (i * 30) + 's');
    await snap('t' + (i * 30) + 's');
    if (state.hcIframes > 0 || state.captchaDiv.length > 0) {
      log('   🎯 检测到 captcha 元素！');
    }
    if (state.bigImgs.length > 0 || state.sidebarImgs.length > 0) {
      log('   🎯 检测到图片！');
      state.bigImgs.slice(0, 3).forEach((im) => console.log('     big:', im.src, im.w + 'x' + im.h));
      state.sidebarImgs.slice(0, 3).forEach((im) => console.log('     sidebar:', im.src, im.w));
      break;
    }
  }

  log('6. 最终截图 + 关键网络');
  await snap('final');
  console.log('\\n=== 关键 API 调用 ===');
  allReqs.filter((c) => c.dir === '→' && (c.url.includes('/api/canva') || c.url.includes('chat') || c.url.includes('generate'))).slice(-20).forEach((c) => {
    console.log('  ' + c.dir, c.method || c.status, c.url, c.body ? '\\n    body: ' + c.body : '');
  });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});