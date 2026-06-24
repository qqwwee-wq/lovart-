// scripts/diag-after-send.js —— 详细诊断 send 后页面状态
'use strict';

const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { humanSleep, randomMouseMove } = require('../src/utils/humanize');

const log = (...a) => console.error('[diag-after]', ...a);

(async () => {
  const { launch } = await import('cloakbrowser');
  const browser = await launch({ headless: true, humanize: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addCookies(auth.load().cookies.filter((c) => /lovart\.ai$/.test(c.domain)));
  const page = await ctx.newPage();

  // 拦截网络
  const apiResponses = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/(lovart\.ai).*?(api\/canva|chat|task|agent|artifacts)/i.test(u) && resp.status() === 200) {
      try {
        const body = await resp.text();
        apiResponses.push({ url: u.slice(0, 200), bodyStart: body.slice(0, 200) });
      } catch {}
    }
  });

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

  // 输入 + send（生产 prompt）
  const promptText = '1.生成5张不同的淘宝主图姿势，每一张图片都要单张完整图片，画面中只有一位模特背景不能变，模特表情柔和，这些图片的模特姿势不要重复，要求比例3比4 需要2K高清 处理模型只能用Nano Banana 2';
  await page.evaluate((text) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null);
    const e = all.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (e) { e.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text); }
  }, promptText);
  await sleep(2000);
  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('sent, waiting 3 min and dumping state every 30s');

  // 监控 3 分钟 + 截图
  for (let i = 1; i <= 6; i++) {
    await sleep(30_000);
    const state = await page.evaluate(() => {
      // 所有 img URLs
      const allImgs = Array.from(document.querySelectorAll('img'));
      const imgUrls = allImgs.map((im) => im.src || '').filter((s) => s.length > 0);

      // 找包含 agent artifacts 的图（Lovart 生成图）
      const generatedImgs = imgUrls.filter((u) => /artifacts\/agent/.test(u));

      // iframe 中的图
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const iframeContent = iframes.map((f, idx) => {
        try {
          const idoc = f.contentDocument || f.contentWindow?.document;
          if (!idoc) return { idx, src: f.src.slice(0, 80), error: 'no access' };
          const imgs = Array.from(idoc.querySelectorAll('img'));
          return { idx, src: f.src.slice(0, 80), imgs: imgs.length };
        } catch (e) {
          return { idx, src: f.src.slice(0, 80), error: e.message.slice(0, 50) };
        }
      });

      // 找包含 "生成" / "完成" 的可见文本
      const bodyText = document.body.innerText || '';
      const statusTexts = bodyText.match(/[一-龥]{2,15}/g) || [];

      return {
        url: location.href,
        totalImgs: imgUrls.length,
        agentImgs: generatedImgs.length,
        agentImgUrls: generatedImgs.slice(0, 3),
        iframeCount: iframes.length,
        iframes: iframeContent.slice(0, 5),
        bodyLen: bodyText.length,
        statusTexts: [...new Set(statusTexts)].slice(0, 15),
      };
    });
    console.log(`[t=${i * 30}s] url=${state.url}`);
    console.log(`  img总数=${state.totalImgs} agent图=${state.agentImgs}`);
    if (state.agentImgUrls.length > 0) {
      console.log('  ✓ agent 图:', state.agentImgUrls.slice(0, 2));
    }
    console.log(`  iframe=${state.iframeCount} bodyLen=${state.bodyLen}`);
    console.log(`  文本前 200: ${state.statusTexts.slice(0, 10).join('|')}`);
    await page.screenshot({ path: `docs/diag-after-t${i * 30}s.png` });
  }

  console.log('\\n=== 关键 API 响应 ===');
  apiResponses.filter((r) => /saveAgentImage|chat|generate|task/i.test(r.url)).slice(0, 10).forEach((r) => {
    console.log('  ', r.url);
    console.log('   ', r.bodyStart);
  });

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});