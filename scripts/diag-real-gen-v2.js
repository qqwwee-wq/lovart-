// scripts/diag-real-gen-v2.js —— 跳过 onboarding 后再发 prompt
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { downloadOne, ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[diag-v2]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // 监控所有 API（关键）
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/lovart\.ai.*api|chat|generation|task|asset|selection/i.test(u)) {
      apiCalls.push({ t: Date.now(), type: 'req', method: req.method(), url: u.slice(0, 200), body: (req.postData() || '').slice(0, 300) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/lovart\.ai.*api\/canva\/agent\/(selectionChat|runAgent|chat|generate|runTask|createThread)|\/task\/query/i.test(u)) {
      try {
        const text = await resp.text();
        apiCalls.push({ t: Date.now(), type: 'resp', status: resp.status(), url: u.slice(0, 200), bodyStart: text.slice(0, 400) });
      } catch {}
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser-err]', msg.text().slice(0, 200));
  });

  ensureDir('docs/diag2');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/diag2/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f, fullPage: false }); log('   📸 ' + f); } catch {}
  }

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap('01-fresh');

  log('2. 跳过 onboarding（点 Next 3 次）');
  for (let i = 0; i < 5; i++) {
    const nextBtn = await page.$('button:has-text("Next")');
    if (!nextBtn) {
      log('   ✓ onboarding 已结束（' + i + ' 次 Next）');
      break;
    }
    try {
      await nextBtn.click({ force: true, timeout: 5000 });
      log('   ✓ 点 Next #' + (i + 1));
      await sleep(800);
    } catch (e) {
      log('   ✗ Next 失败：' + e.message.slice(0, 80));
      break;
    }
  }
  // 也可能 onboarding 不止 Next，可能还有其他按钮
  await page.evaluate(() => {
    // 移除所有 dialog 遮罩（pointer-events:auto 的 fixed inset-0 + bg-black/20）
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });
  await snap('02-after-skip');

  log('3. 上传参考图（拖拽到画布中央）');
  const refUrl = 'https://alidocs2.oss-cn-zhangjiakou.aliyuncs.com/res/1wvqreb9zRz2znak/img/eeba87fc-4219-4390-9a46-10fac2725574.png?Expires=1782210468&OSSAccessKeyId=LTAI5tKTjg4Kq1HCdBJ8qpSp&Signature=A4hloV8U5ytcWLj05GE0gfs57B8%3D';
  const tmpDir = path.join(config.downloadsDir, '.tmp');
  ensureDir(tmpDir);
  const localRef = path.join(tmpDir, `diag2-ref-${Date.now()}.png`);
  await downloadOne(refUrl, localRef);

  const b64 = fs.readFileSync(localRef).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;
  // 拖到 canvas 主区域（中央空白处）
  const dropResult = await page.evaluate(async ({ dataUrl }) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'reference.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    // 找 canvas 主区域（最大的可见 div）
    const main = document.querySelector('main') || document.body;
    ['dragenter', 'dragover', 'drop'].forEach((ev) => {
      main.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    return { ok: true };
  }, { dataUrl });
  log('   拖拽结果: ' + JSON.stringify(dropResult));
  await sleep(2000);
  await snap('03-after-upload');

  log('4. 找输入框 + 输入 prompt');
  // 重新查找输入框（DOM 变化了）
  const inputBox = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'));
    return all
      .filter((e) => e.offsetParent !== null)
      .map((e, i) => {
        const r = e.getBoundingClientRect();
        return { i, tag: e.tagName, role: e.getAttribute('role') || '', ce: e.getAttribute('contenteditable') || '', rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, placeholder: e.placeholder || '' };
      });
  });
  log('   找到 ' + inputBox.length + ' 个输入框:');
  inputBox.forEach((b) => console.log('     ', JSON.stringify(b)));

  // 选最大的那个（主画布的）
  const mainInput = inputBox.sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
  log('   主输入框: ' + JSON.stringify(mainInput));

  const promptText = '生成1张简单的猫咪图（橙白花色）';
  const inputOk = await page.evaluate(({ text }) => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'))
      .filter((e) => e.offsetParent !== null);
    const e = all.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0];
    if (!e) return false;
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return true;
  }, { text: promptText });
  log('   输入: ' + inputOk);
  await sleep(500);
  await snap('04-after-input');

  log('5. 点 Agent');
  // 找最近的 Agent 按钮
  const agentBtn = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button'));
    return all
      .filter((b) => (b.innerText || '').includes('Agent') && b.offsetParent !== null)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { text: b.innerText, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      });
  });
  log('   Agent 按钮: ' + JSON.stringify(agentBtn));
  if (agentBtn[0]) {
    await page.mouse.click(agentBtn[0].rect.x + agentBtn[0].rect.w / 2, agentBtn[0].rect.y + agentBtn[0].rect.h / 2);
    log('   ✓ 已点');
  }
  await sleep(3000);
  await snap('05-after-send');

  log('6. 监控 8 分钟（每 30 秒）');
  const startImgCount = await page.$$eval('img', (els) => els.filter((i) => i.getBoundingClientRect().width > 100).length);
  log('   起始大图数: ' + startImgCount);
  for (let i = 1; i <= 16; i++) {
    await sleep(30_000);
    const elapsed = i * 30;
    const snap1 = await page.evaluate(() => {
      const bigImgs = Array.from(document.querySelectorAll('img'))
        .filter((im) => im.getBoundingClientRect().width > 100)
        .map((im) => ({ src: (im.src || '').slice(0, 80), w: im.getBoundingClientRect().width, h: im.getBoundingClientRect().height }));
      const visibleText = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.y > 50 && r.y < 850;
        })
        .slice(0, 100)
        .map((el) => (el.innerText || '').trim())
        .filter((t) => t.length > 0 && t.length < 80);
      return { bigImgs, visibleText: [...new Set(visibleText)].slice(0, 20) };
    });
    console.log(`[t=${elapsed}s] 大图=${snap1.bigImgs.length} (起始 ${startImgCount}) | 可见文本: ${JSON.stringify(snap1.visibleText.slice(0, 5))}`);
    if (snap1.bigImgs.length > startImgCount) {
      console.log('   🎯 新图:');
      snap1.bigImgs.forEach((im) => console.log('     ', im.src, im.w + 'x' + im.h));
    }
    await snap('t' + elapsed + 's');
    if (snap1.bigImgs.length > startImgCount + 2) break;
  }

  log('7. 关键 API 调用');
  apiCalls
    .filter((c) => /chat|generate|task|agent\/|selection/i.test(c.url))
    .slice(0, 40)
    .forEach((c) => {
      if (c.type === 'req') console.log('  →', c.method, c.url, c.body ? '\n     body: ' + c.body : '');
      else console.log('  ←', c.status, c.url, '\n     body:', c.bodyStart?.slice(0, 200));
    });

  await snap('final');
  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});