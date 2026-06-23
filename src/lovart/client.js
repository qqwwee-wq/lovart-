// src/lovart/client.js —— 单个 Worker 内的 Lovart 生图主流程（chat-style）
//
// 实际 Lovart 是 chat-style agent 画布，流程：
//   1. 进入 /canvas?newProject=true，自动建项目并跳转
//   2. 上传商品素材图（拖拽到中央区域，或 file input）
//   3. 在右下角 contenteditable 输入框输入完整 prompt（含参考图说明）
//   4. 点击 "Agent" 按钮发送，Lovart agent 自动执行生图
//   5. 轮询等待画布上出现新生成的 <img>
//   6. 读取所有 <img src>，下载到本地
//
// 模型选择：不通过 UI（已确认画布无模型下拉），通过 prompt 文本里的
//   "处理模型只能用Nano Banana 2" 让 Lovart 后端自动选用对应模型。
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { makeLogger } = require('../logger');
const { downloadOne, ensureDir } = require('../utils/download');
const { sleep, waitUntil } = require('../utils/sleep');
const { newContext } = require('./browser');
const selectors = require('./selectors');

/**
 * 单行任务执行入口
 * @param {string} workerLabel
 * @param {object} task {recordId, styleNo, modelImage, prompts:[{taskType,text,folder,writeField}]}
 * @param {object} hooks {onPromptDone(prompt, localFiles)}
 */
async function runRow(workerLabel, task, hooks = {}) {
  const log = makeLogger(`lovart.client.${workerLabel}`);
  log.info(`开始 recordId=${task.recordId} 款号=${task.styleNo} 提示词=${task.prompts.length}`);

  const { ctx, page } = await newContext(workerLabel);

  // 用于记录每条 prompt 之前画布上已有的 img 数（用于"增量"判定新生成的图）
  let prevImgCount = 0;
  const results = [];

  try {
    log.info('打开新建项目画布');
    await page.goto(selectors.canvas.newProjectUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForTimeout(5000);

    // 移除会拦截 pointer events 的弹窗遮罩（pointer-events:auto 的 fixed inset-0）
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach((el) => {
        if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
      });
      document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
    });

    // 上传参考素材图（一次，每条 prompt 共用）
    await uploadReferenceImage(page, log, task.modelImage);

    // 逐条跑 prompt
    for (let i = 0; i < task.prompts.length; i++) {
      const p = task.prompts[i];
      log.info(`▶ ${i + 1}/${task.prompts.length} | taskType=${p.taskType} | 文件夹=${p.folder}`);

      // 记录发送前画布上的图片数（用于判定本次新生成的图）
      prevImgCount = await countResultImages(page);

      // 在输入框中输入完整 prompt
      await inputPrompt(page, log, p.text);

      // 点击 Agent 发送
      await clickSend(page, log);

      // 等待生成完成（轮询：loading 出现→消失 + 新图出现）
      await waitForGenerationDone(page, log, prevImgCount);

      // 下载本次新生成的图
      const localFiles = await downloadNewResults(page, log, {
        rowDir: path.join(config.downloadsDir, todayStr(), task.styleNo, p.folder),
        startCount: prevImgCount,
      });

      if (hooks.onPromptDone) {
        await hooks.onPromptDone(p, localFiles, { recordId: task.recordId });
      }

      results.push({
        taskType: p.taskType,
        writeField: p.writeField,
        folder: p.folder,
        localFiles,
      });
    }

    log.info(`✅ 完成 recordId=${task.recordId}`);
    return { recordId: task.recordId, styleNo: task.styleNo, results };
  } finally {
    await ctx.close();
  }
}

// ========== 步骤实现 ==========

/**
 * 上传参考素材图到画布
 * 策略：
 *   1) 先尝试把文件 setInputFiles 到隐藏 file input（如果有）
 *   2) 否则下载到本地临时路径，模拟拖拽到画布 drop 区域
 */
async function uploadReferenceImage(page, log, modelImage) {
  log.info(`上传参考图: ${modelImage.filename}`);

  // 下载到本地临时
  const tmpDir = path.join(config.downloadsDir, '.tmp');
  ensureDir(tmpDir);
  const localTmp = path.join(tmpDir, `${Date.now()}-${modelImage.filename || 'ref.png'}`);
  await downloadOne(modelImage.url, localTmp);

  // 方案 A：setInputFiles（如果画布上有 file input）
  try {
    const fileInput = await page.$(selectors.upload.fileInput);
    if (fileInput) {
      await fileInput.setInputFiles(localTmp);
      log.info('   ✓ setInputFiles 上传成功');
      await sleep(2000);
      return;
    }
  } catch (e) {
    log.debug('   file input 方式失败：' + e.message.slice(0, 100));
  }

  // 方案 B：拖拽到 drop zone（用 evaluate 模拟 DataTransfer）
  log.info('   尝试拖拽到 drop zone');
  const ok = await page.evaluate(async ({ filePath, dropZoneText }) => {
    // 读本地文件（Node 注入的路径）
    // 但 evaluate 在浏览器里，没法直接读本地文件
    // 改用 fetch URL（注意：这里 filePath 是 Node 路径，浏览器里读不到）
    return false;
  }, { filePath: localTmp, dropZoneText: selectors.upload.dropZoneText });

  if (!ok) {
    // 方案 C：直接 fetch URL 转 base64 再构造 DataTransfer
    log.info('   改用 base64 DataTransfer 注入');
    const b64 = fs.readFileSync(localTmp).toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    await page.evaluate(async ({ dataUrl, dropZoneText }) => {
      // 把 dataUrl 转成 File 对象
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'reference.png', { type: blob.type });
      const dt = new DataTransfer();
      dt.items.add(file);

      // 找 drop zone（包含指定文字的元素）
      const all = Array.from(document.querySelectorAll('div'));
      const target = all.find((el) => (el.innerText || '').includes(dropZoneText) && el.offsetParent !== null);
      if (!target) {
        // fallback：上传到 body
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
        return 'body';
      }
      ['dragenter', 'dragover', 'drop'].forEach((ev) => {
        target.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      return 'dropzone';
    }, { dataUrl, dropZoneText: selectors.upload.dropZoneText });
    await sleep(2000);
  }
}

/**
 * 在输入框中输入 prompt
 * 用 execCommand（对 contenteditable 友好），不 click（click 触发弹窗变化）
 */
async function inputPrompt(page, log, text) {
  log.info(`输入 prompt（${text.length} 字）`);
  const ok = await page.evaluate(({ text }) => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (!e) return false;
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return true;
  }, { text });
  if (!ok) throw new Error('找不到 prompt 输入框');
  await sleep(300);
}

/**
 * 点 Agent 发送按钮（也用 force 兜底）
 */
async function clickSend(page, log) {
  log.info('点击 Agent 发送');
  // 先再清一次遮罩（输入时可能又冒出弹窗）
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
  });
  const btn = await page.$(selectors.send.agentButton);
  if (!btn) {
    log.warn('   ⚠ 找不到 Agent 按钮，尝试按 Enter 发送');
    await page.keyboard.press('Enter');
  } else {
    try {
      await btn.click({ force: true, timeout: 5000 });
    } catch (e) {
      log.warn('   ⚠ 点 Agent 失败，尝试 Enter：' + e.message.slice(0, 80));
      await page.keyboard.press('Enter');
    }
  }
  await sleep(1000);
}

/**
 * 计算画布上结果图片数量
 */
async function countResultImages(page) {
  return await page.$$eval('img', (els) =>
    els.filter((i) => {
      const r = i.getBoundingClientRect();
      // 只算画布上的大图（>100x100），排除头像/logo
      return r.width > 100 && r.height > 100;
    }).length,
  );
}

/**
 * 等待生成完成
 * 判定：loading 文本消失 + 新 img 数 > prevCount
 */
async function waitForGenerationDone(page, log, prevCount) {
  log.info(`等待生成完成（prevImgCount=${prevCount}）`);

  // 等 loading 出现（最长 30s）
  const loadingAppeared = await page
    .waitForSelector(
      `:text("${selectors.status.generatingText}"), :text("${selectors.status.generatingTextAlt}")`,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!loadingAppeared) {
    log.warn('   ⚠ loading 文本未出现，可能已经完成或极快');
  }

  // 等 loading 消失 + 新 img 出现
  await waitUntil(
    async () => {
      const loadingGone = await page.evaluate((phrases) => {
        const all = Array.from(document.querySelectorAll('*'));
        return !all.some((el) => {
          if (el.children.length > 3) return false;
          const t = (el.innerText || '').trim();
          return t.length < 100 && phrases.some((p) => t.includes(p));
        });
      }, [
        selectors.status.generatingText,
        selectors.status.generatingTextAlt,
        '正在研究品牌信息',
        '正在思考',
        '正在设计',
      ]);
      const cur = await countResultImages(page);
      return loadingGone && cur > prevCount;
    },
    { timeoutMs: 10 * 60_000, intervalMs: 5_000, desc: 'lovart-generation' },
  ).catch((e) => {
    log.warn('   等待完成超时：' + e.message);
  });
}

/**
 * 下载画布上新生成的图（数量 = cur - startCount）
 */
async function downloadNewResults(page, log, { rowDir, startCount }) {
  ensureDir(rowDir);
  const imgUrls = await page.$$eval(
    'img',
    (els) =>
      els
        .filter((i) => {
          const r = i.getBoundingClientRect();
          return r.width > 100 && r.height > 100;
        })
        .map((i) => i.src || i.getAttribute('data-src'))
        .filter(Boolean),
  );
  // 取后 N 张作为本次新生成
  const newUrls = imgUrls.slice(startCount);
  log.info(`下载 ${newUrls.length} 张新图（总 ${imgUrls.length} 张，本次从第 ${startCount} 张起）`);

  const localFiles = [];
  for (let i = 0; i < newUrls.length; i++) {
    const u = newUrls[i];
    const ext = (u.match(/\.(png|jpe?g|webp)(\?|$)/i) || [null, 'png'])[1] || 'png';
    const dest = path.join(rowDir, `img${String(i + 1).padStart(2, '0')}.${ext}`);
    try {
      await downloadOne(u, dest);
      localFiles.push(dest);
    } catch (e) {
      log.warn(`下载 #${i + 1} 失败: ${e.message.slice(0, 80)}`);
    }
  }
  return localFiles;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { runRow };