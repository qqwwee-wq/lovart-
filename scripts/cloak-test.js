// scripts/cloak-test.js —— CloakBrowser 最小测试：进 Lovart 画布，看 hCaptcha 是否还弹
'use strict';

const fs = require('fs');
const config = require('../src/config');
const auth = require('../src/lovart/auth');

const log = (...a) => console.error('[cloak-test]', ...a);

(async () => {
  if (!auth.exists()) {
    console.error('❌ 没找到 cookies，请先 npm run login');
    process.exit(1);
  }

  log('启动 CloakBrowser + 注入 cookies');
  const { launch } = await import('cloakbrowser');
  const browser = await launch({
    headless: true,
    humanize: true,
  });
  log('   ✓ 启动完成');

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const cookies = auth.load();
  const filtered = cookies.cookies.filter(
    (c) => /\.lovart\.ai$/.test(c.domain) || c.domain.endsWith('.lovart.ai'),
  );
  await ctx.addCookies(filtered);
  log(`   ✓ 注入 ${filtered.length} 个 Lovart cookies`);

  fs.mkdirSync('docs/cloak-test', { recursive: true });

  const page = await ctx.newPage();

  // 拦截 canva 相关 API
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/(lovart\.ai|a\.lovart\.ai).*?(api|agent|artifacts|chat|task|hcaptcha)/i.test(u)) {
      apiCalls.push({ dir: '→', method: req.method(), url: u.slice(0, 200), body: (req.postData() || '').slice(0, 200) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/(lovart\.ai).*?(api\/canva|hcaptcha)/i.test(u)) {
      try {
        const body = await resp.text();
        apiCalls.push({ dir: '←', status: resp.status(), url: u.slice(0, 200), bodyStart: body.slice(0, 300) });
      } catch {}
    }
  });

  log('进 Lovart 画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'docs/cloak-test/s01-fresh.png', fullPage: true });
  log('   URL: ' + page.url());

  // dismiss onboarding
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try { await btn.click({ force: true, timeout: 2000 }); clicked = true; await new Promise((r) => setTimeout(r, 700)); break; } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) { await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 500)); }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'docs/cloak-test/s02-after-dismiss.png', fullPage: true });

  // 检测 hCaptcha
  const captchaCheck1 = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe')).filter((f) => /hcaptcha\.com|hcaptcha-|newcaptcha/i.test(f.src || ''));
    const captchaDiv = Array.from(document.querySelectorAll('div')).filter((d) => {
      const t = (d.innerText || '');
      return d.children.length < 3 && /hCaptcha|hcaptcha|我是真实访客|浏览器验证|请完成验证|继续之前.+安全性/i.test(t);
    }).slice(0, 3).map((d) => (d.innerText || '').slice(0, 80));
    return {
      hcIframes: iframes.length,
      hcIframeSrcs: iframes.map((f) => f.src.slice(0, 100)),
      captchaDiv,
      hcaptchaGlobal: typeof window.hcaptcha,
    };
  });
  log('Onboarding 后 captcha 检测: ' + JSON.stringify(captchaCheck1));

  // 上传小参考图 + 输入 prompt + 点 send
  log('上传小图 + 输入 prompt + send');
  const smallB64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff8800';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#fff';
    ctx.font = '30px sans-serif';
    ctx.fillText('REF', 60, 110);
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
  }, { b64: smallB64 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (e) { e.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, '生成1张简单的猫咪图（橙白花色）'); }
  });
  await page.waitForTimeout(1500);

  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('   ✓ 已点 send');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'docs/cloak-test/s03-after-send.png', fullPage: true });

  // 监控 4 分钟
  log('监控 4 分钟（每 30 秒）');
  for (let i = 1; i <= 8; i++) {
    await new Promise((r) => setTimeout(r, 30_000));
    const state = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe')).filter((f) => /hcaptcha\.com|hcaptcha-/i.test(f.src || ''));
      const captchaDiv = Array.from(document.querySelectorAll('div')).filter((d) => {
        const t = (d.innerText || '');
        return d.children.length < 3 && /hCaptcha|hcaptcha|我是真实访客|浏览器验证/i.test(t);
      }).length;
      const bigImgs = Array.from(document.querySelectorAll('img')).filter((i) => i.getBoundingClientRect().width > 100).length;
      const sidebar = Array.from(document.querySelectorAll('*')).find((e) => (e.innerText || '').includes('新对话'));
      const sidebarImgs = sidebar ? Array.from(sidebar.querySelectorAll('img')).filter((i) => i.getBoundingClientRect().width > 30).length : 0;
      return { hcIframes: iframes.length, captchaDiv, bigImgs, sidebarImgs };
    });
    console.log(`[t=${i * 30}s] captcha: iframe=${state.hcIframes} div=${state.captchaDiv} | images: big=${state.bigImgs} sidebar=${state.sidebarImgs}`);
    await page.screenshot({ path: `docs/cloak-test/t${i * 30}s.png`, fullPage: true });
    if (state.hcIframes > 0 || state.captchaDiv > 0) {
      log('   ❌ 还是弹了 hCaptcha');
    } else {
      log('   ✅ 没有 hCaptcha 弹窗');
    }
    if (state.bigImgs > 0 || state.sidebarImgs > 0) {
      log('   🎯 检测到生成的图片！');
      break;
    }
  }

  log('关键 API 调用');
  apiCalls
    .filter((c) => c.dir === '→' && (c.url.includes('/api/canva') || c.url.includes('chat') || c.url.includes('generate')))
    .slice(-15)
    .forEach((c) => {
      console.log('  ' + c.dir, c.method || c.status, c.url, c.body ? '\\n    body: ' + c.body : '');
    });

  await browser.close();
  log('✅ 测试完成');
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});