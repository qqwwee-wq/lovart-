// scripts/test-no-upload.js —— 跳过参考图上传，直接发 prompt，看 Lovart 是否能跑
'use strict';

const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep, randomMouseMove } = require('../src/utils/humanize');

const log = (...a) => console.error('[no-up]', ...a);

(async () => {
  if (!auth.exists()) { console.error('❌ 没 cookies'); process.exit(1); }
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true });
  log('✓ browser');

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addCookies(
    auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)),
  );
  const page = await ctx.newPage();

  log('进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await humanSleep(4000, 6000);
  await randomMouseMove(page);

  // dismiss onboarding
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of ['Next', 'Get started', 'Got it', '跳过', '知道了']) {
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
  await humanSleep(3000, 5000);

  // 检查页面状态
  const beforeInput = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'));
    return { inputs: inputs.filter((e) => e.offsetParent !== null).length, bodyLen: (document.body.innerText || '').length };
  });
  log(`不上传图，直接发 prompt 前的状态: 输入框=${beforeInput.inputs} bodyLen=${beforeInput.bodyLen}`);

  // 输入 prompt（不传图）
  log('输入 prompt（无参考图）');
  await page.evaluate((text) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null);
    const e = all.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (e) { e.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text); }
  }, '生成1张简单的橙白花色猫咪图');
  await sleep(2000);

  // send
  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('✓ sent');

  // 监控 2 分钟
  for (let i = 1; i <= 4; i++) {
    await sleep(30_000);
    const state = await page.evaluate(() => {
      const big = Array.from(document.querySelectorAll('img')).filter((im) => im.getBoundingClientRect().width > 100);
      const iframes = Array.from(document.querySelectorAll('iframe')).filter((f) => /hcaptcha\.com|hcaptcha-/i.test(f.src || ''));
      return { big: big.length, hc: iframes.length };
    });
    console.log(`[t=${i * 30}s] 大图=${state.big} captcha=${state.hc}`);
    if (state.big >= 1) {
      log('✅ 有图了！');
      // 抓一张下载到本地
      const imgUrls = await page.$$eval('img', (els) =>
        els.filter((im) => im.getBoundingClientRect().width > 100).map((im) => im.src).filter(Boolean),
      );
      console.log('图片 URLs:', imgUrls.slice(0, 3));
      break;
    }
  }

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});