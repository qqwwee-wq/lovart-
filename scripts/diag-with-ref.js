// scripts/diag-with-ref.js —— 上传参考图 + 发送 prompt + 看 sidebar 聊天历史
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[with-ref]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // 拦截所有 a.lovart.ai 图片
  const artifactImgs = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('a.lovart.ai/artifacts/agent/') && u.match(/\.(jpg|jpeg|png|webp)/i)) {
      artifactImgs.push({ url: u, status: resp.status(), ts: Date.now() });
    }
  });

  log('1. 进画布 + dismiss onboarding');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(8000);
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try { await btn.click({ force: true, timeout: 2000 }); clicked = true; await sleep(500); break; } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) { await page.keyboard.press('Escape'); await sleep(500); }
  }
  await sleep(2000);

  log('2. 上传参考图（小图，base64 DataTransfer）');
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
  await sleep(3000);

  log('3. 输入 prompt');
  await page.evaluate(({ text }) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null);
    const e = all.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0];
    if (e) {
      e.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    }
  }, { text: '生成1张简单的猫咪图（橙白花色）' });
  await sleep(1000);

  log('4. 点 send');
  await page.click('[data-testid="agent-send-button"]', { force: true });
  log('   ✓ 已点 send');

  log('5. 监控 4 分钟（每 20 秒看聊天区）');
  const startImgs = artifactImgs.length;
  for (let i = 1; i <= 12; i++) {
    await sleep(20_000);
    const elapsed = i * 20;
    // 看 sidebar（右侧）的聊天历史
    const chatState = await page.evaluate(() => {
      // 找 sidebar（"新对话" 面板）的所有 img 和文本
      const sidebar = Array.from(document.querySelectorAll('*')).find((e) => {
        const r = e.getBoundingClientRect();
        return r.x > 1000 && r.y < 900 && r.width > 300 && r.height > 400 && (e.innerText || '').includes('新对话');
      });
      if (!sidebar) return { sidebarFound: false };
      const imgs = Array.from(sidebar.querySelectorAll('img'))
        .filter((i) => i.getBoundingClientRect().width > 50)
        .map((i) => ({ src: (i.src || '').slice(0, 100), w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height }));
      // 找包含"生成"或"完成"或"正在"的元素
      const statusTexts = Array.from(sidebar.querySelectorAll('*'))
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((e) => (e.innerText || '').trim())
        .filter((t) => t.length > 0 && (t.includes('正在') || t.includes('生成') || t.includes('完成') || t.includes('设计') || t.includes('思考')))
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 10);
      return { sidebarFound: true, imgs, statusTexts, sidebarTextSample: (sidebar.innerText || '').slice(0, 300) };
    });
    console.log(`[t=${elapsed}s] sidebar.found=${chatState.sidebarFound} imgs=${chatState.imgs?.length || 0} status=${JSON.stringify(chatState.statusTexts?.slice(0, 3))}`);
    if (chatState.imgs?.length > 0) {
      chatState.imgs.slice(0, 5).forEach((im) => console.log('     img:', im.src, im.w + 'x' + im.h));
    }
    if (chatState.sidebarTextSample) {
      console.log('     sidebar 文本片段:', JSON.stringify(chatState.sidebarTextSample.slice(0, 100)));
    }
    if (artifactImgs.length > startImgs) {
      log(`   🎯 检测到 ${artifactImgs.length - startImgs} 个新生成的图片`);
      artifactImgs.slice(startImgs).forEach((im) => console.log('     ', im.url));
      break;
    }
    if (i % 3 === 0) {
      try { await page.screenshot({ path: `docs/with-ref-t${elapsed}s.png` }); } catch {}
    }
  }

  log('6. 最终截图');
  try { await page.screenshot({ path: 'docs/with-ref-final.png', fullPage: true }); } catch {}

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});