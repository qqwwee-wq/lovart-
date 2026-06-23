// scripts/diag-real-gen.js —— 跑真生图 1 次，每 30 秒截图+打印网络，定位卡点
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const auth = require('../src/lovart/auth');
const { sleep } = require('../src/utils/sleep');
const { downloadOne, ensureDir } = require('../src/utils/download');

const log = (...a) => console.error('[diag]', ...a);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addCookies(auth.load().cookies);
  const page = await ctx.newPage();

  // 监听所有网络（生图相关）
  const apiCalls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/lovart\.ai.*api|chat|generation|task|asset/i.test(u)) {
      apiCalls.push({ t: Date.now(), type: 'req', method: req.method(), url: u.slice(0, 200) });
    }
  });
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/lovart\.ai.*api|task|generation/i.test(u)) {
      try {
        const text = await resp.text();
        apiCalls.push({ t: Date.now(), type: 'resp', status: resp.status(), url: u.slice(0, 200), bodyLen: text.length, bodyStart: text.slice(0, 200) });
      } catch {}
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[browser-console]', msg.text().slice(0, 200));
  });

  ensureDir('docs/diag');
  let snapIdx = 0;
  async function snap(label) {
    snapIdx++;
    const f = `docs/diag/s${String(snapIdx).padStart(3, '0')}-${label}.png`;
    try { await page.screenshot({ path: f, fullPage: false }); log('   📸 ' + f); } catch {}
  }

  log('1. 进画布');
  await page.goto('https://www.lovart.ai/canvas?newProject=true', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(6000);
  await snap('canvas-fresh');
  log('   URL:', page.url());

  log('2. 移除弹窗遮罩');
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
    document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
  });

  log('3. 上传参考图（下载到本地 + base64 DataTransfer 拖拽）');
  const refUrl = 'https://alidocs2.oss-cn-zhangjiakou.aliyuncs.com/res/1wvqreb9zRz2znak/img/eeba87fc-4219-4390-9a46-10fac2725574.png?Expires=1782210468&OSSAccessKeyId=LTAI5tKTjg4Kq1HCdBJ8qpSp&Signature=A4hloV8U5ytcWLj05GE0gfs57B8%3D';
  const tmpDir = path.join(config.downloadsDir, '.tmp');
  ensureDir(tmpDir);
  const localRef = path.join(tmpDir, `diag-ref-${Date.now()}.png`);
  await downloadOne(refUrl, localRef);
  log('   下载到: ' + localRef);

  const b64 = fs.readFileSync(localRef).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;
  const dropResult = await page.evaluate(async ({ dataUrl, dropZoneText }) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'reference.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);
    const all = Array.from(document.querySelectorAll('div'));
    const target = all.find((el) => (el.innerText || '').includes(dropZoneText) && el.offsetParent !== null);
    if (!target) return { ok: false, reason: 'no-dropzone' };
    ['dragenter', 'dragover', 'drop'].forEach((ev) => {
      target.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    return { ok: true };
  }, { dataUrl, dropZoneText: '将文件拖拽至此处添加到对话' });
  log('   拖拽结果: ' + JSON.stringify(dropResult));
  await sleep(2000);
  await snap('after-upload');

  log('4. 输入 prompt');
  const promptText = '生成1张简单的猫咪图，要求比例3比4';
  const inputOk = await page.evaluate(({ text }) => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (!e) return false;
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return true;
  }, { text: promptText });
  log('   输入: ' + inputOk);
  await sleep(500);
  await snap('after-input');

  log('5. 点击 Agent 发送');
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
  });
  const agentBtn = await page.$('button:has-text("Agent")');
  log('   找到 Agent: ' + !!agentBtn);
  if (agentBtn) {
    await agentBtn.click({ force: true });
    log('   ✓ 已点');
  } else {
    log('   ⚠ 用 Enter 兜底');
    await page.keyboard.press('Enter');
  }
  await sleep(2000);
  await snap('after-send');

  // 监控 8 分钟（每 30 秒）
  log('6. 监控 8 分钟（每 30 秒截图 + 看新 img + 打印文本）');
  const startImgCount = await page.$$eval('img', (els) => els.filter((i) => i.getBoundingClientRect().width > 100).length);
  log('   起始大图数: ' + startImgCount);
  for (let i = 1; i <= 16; i++) {
    await sleep(30_000);
    const elapsed = i * 30;
    const curImgs = await page.$$eval('img', (els) =>
      els.filter((i) => i.getBoundingClientRect().width > 100).map((i) => ({
        src: (i.src || '').slice(0, 100),
        w: i.getBoundingClientRect().width,
        h: i.getBoundingClientRect().height,
      })).slice(0, 10),
    );
    const newCount = curImgs.length;
    const visibleText = await page.evaluate(() => {
      const visible = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.y > 100 && r.y < 800;
        })
        .slice(0, 200);
      const texts = visible.map((el) => (el.innerText || '').trim()).filter((t) => t.length > 0 && t.length < 100);
      return [...new Set(texts)].slice(0, 30);
    });
    console.log(`[t=${elapsed}s] 大图数=${newCount} (起始 ${startImgCount}) | 可见文本前 10: ${JSON.stringify(visibleText.slice(0, 10))}`);
    await snap(`t${elapsed}s`);
    if (newCount > startImgCount + 2) {
      console.log('   🎯 检测到新图！');
      curImgs.forEach((im) => console.log('      src:', im.src, 'size:', im.w + 'x' + im.h));
      break;
    }
  }

  log('7. 打印所有 API 调用');
  apiCalls.forEach((c) => {
    if (c.type === 'req') console.log('  →', c.method, c.url);
    else console.log('  ←', c.status, c.url, 'bodyLen=' + c.bodyLen, 'preview:', c.bodyStart?.slice(0, 80));
  });

  log('8. 最终截图');
  await snap('final');

  await browser.close();
})().catch((e) => {
  console.error('❌', e.message);
  console.error(e.stack);
  process.exit(1);
});