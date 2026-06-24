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
const { humanSleep, randomMouseMove, randomScroll } = require('../utils/humanize');
const { newContext } = require('./browser');
const selectors = require('./selectors');
const { detectAndSolveHCaptcha } = require('./captcha');

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
    await humanSleep(3000, 6000); // 等页面加载
    await randomMouseMove(page);

    // 移除会拦截 pointer events 的弹窗遮罩（pointer-events:auto 的 fixed inset-0）
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach((el) => {
        if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
      });
      document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
    });

    // dismiss onboarding（多步骤）
    await dismissOnboarding(page, log);

    // 移除弹窗后再次清遮罩
    await page.evaluate(() => {
      document.querySelectorAll('.fixed.inset-0').forEach((el) => {
        if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
      });
    });

    // 检测 hCaptcha（onboarding 后可能弹）—— 仅当用户在 .env 配了 2Captcha key
    if (config.captcha.twoCaptchaApiKey) {
      try {
        const solved = await detectAndSolveHCaptcha(page);
        if (solved) log.info('✓ onboarding 后解了 hCaptcha');
      } catch (e) {
        log.warn('onboarding 后 captcha 检测: ' + e.message);
      }
    }

    // 上传参考素材图（一次，每条 prompt 共用）
    await humanSleep(2000, 4000);
    await uploadReferenceImage(page, log, task.modelImage);

    await humanSleep(2000, 4000);

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

/**
 * Dismiss 多步骤 onboarding（Next / Get started / 跳过 / 等）
 * 每步之间 humanSleep(1-3s) 模拟真人阅读
 */
async function dismissOnboarding(page, log) {
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了', '开始使用', 'Skip'];
  for (let round = 1; round <= 8; round++) {
    await humanSleep(1000, 3000); // 模拟阅读时间
    let clicked = false;
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try {
          await btn.click({ force: true, timeout: 2000 });
          clicked = true;
          await sleep(800);
          break;
        } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) {
      await page.keyboard.press('Escape');
      await sleep(500);
    }
    // 检查是否还有 onboarding
    const onb = await page.evaluate(() => {
      const kws = ['All-New Lovart', 'Membership', 'Brand', '品牌', 'onboarding', 'Getting started', '欢迎', '应用品牌套件'];
      return Array.from(document.querySelectorAll('*'))
        .filter((e) => e.children.length < 5 && kws.some((k) => (e.innerText || '').includes(k)))
        .filter((e) => e.offsetParent !== null)
        .slice(0, 3);
    });
    if (onb.length === 0 && round > 1) {
      log.info('onboarding dismiss 完成（轮 ' + round + '）');
      return;
    }
  }
  log.warn('onboarding dismiss 达到最大轮数（可能还有未关掉的）');
}

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

  // 压缩到大 <2MB（Lovart 后端 413 限制）
  const stat = fs.statSync(localTmp);
  if (stat.size > 2 * 1024 * 1024) {
    log.warn(`   参考图 ${stat.size} bytes 过大，尝试跳过（用 base64 DataTransfer 但可能 413）`);
  }

  // 方案 A：setInputFiles（如果画布上有 file input）
  try {
    const fileInput = await page.$(selectors.upload.fileInput);
    if (fileInput) {
      await fileInput.setInputFiles(localTmp);
      log.info('   ✓ setInputFiles 上传成功');
      await humanSleep(2000, 4000);
      return;
    }
  } catch (e) {
    log.debug('   file input 方式失败：' + e.message.slice(0, 100));
  }

  // 方案 B：base64 DataTransfer（主用）
  log.info('   用 base64 DataTransfer 注入');
  const b64 = fs.readFileSync(localTmp).toString('base64');
  const dataUrl = `data:image/png;base64,${b64}`;
  await page.evaluate(async ({ dataUrl, dropZoneText }) => {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'reference.png', { type: blob.type });
    const dt = new DataTransfer();
    dt.items.add(file);

    const all = Array.from(document.querySelectorAll('div'));
    const target = all.find((el) => (el.innerText || '').includes(dropZoneText) && el.offsetParent !== null);
    if (!target) {
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      return 'body';
    }
    ['dragenter', 'dragover', 'drop'].forEach((ev) => {
      target.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    return 'dropzone';
  }, { dataUrl, dropZoneText: selectors.upload.dropZoneText });
  await humanSleep(2000, 4000);
}

/**
 * 在输入框中输入 prompt（带打字节奏）
 */
async function inputPrompt(page, log, text) {
  log.info(`输入 prompt（${text.length} 字）`);
  // focus 前做点鼠标活动
  await randomMouseMove(page);
  await humanSleep(500, 1500);

  const ok = await page.evaluate(({ text }) => {
    const e = document.querySelector('[role="textbox"], div[contenteditable="true"]');
    if (!e) return false;
    e.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    return true;
  }, { text });
  if (!ok) throw new Error('找不到 prompt 输入框');
  await humanSleep(500, 1500);
}

/**
 * 点 send 按钮（带真人节奏 + hCaptcha 兜底）
 */
async function clickSend(page, log) {
  log.info('准备发送（真人节奏模拟中...）');
  await randomMouseMove(page);
  await humanSleep(2000, 5000);

  // 先再清一次遮罩
  await page.evaluate(() => {
    document.querySelectorAll('.fixed.inset-0').forEach((el) => {
      if (getComputedStyle(el).pointerEvents !== 'none') el.remove();
    });
  });

  // 发送前检查 hCaptcha（仅当配了 2Captcha key）
  if (config.captcha.twoCaptchaApiKey) {
    try {
      const solved = await detectAndSolveHCaptcha(page);
      if (solved) log.info('   ✓ 发送前已解 hCaptcha');
    } catch (e) {
      log.warn('   发送前 captcha: ' + e.message);
    }
  }

  // 真发送按钮
  const btn = await page.$('[data-testid="agent-send-button"]');
  if (!btn) {
    log.warn('   ⚠ 找不到 send 按钮，尝试 Enter');
    await page.keyboard.press('Enter');
  } else {
    try {
      await btn.click({ force: true, timeout: 5000 });
      log.info('   ✓ 已点 send');
    } catch (e) {
      log.warn('   ⚠ 点 send 失败: ' + e.message.slice(0, 80));
      await page.keyboard.press('Enter');
    }
  }
  await humanSleep(2000, 4000);

  // 发送后再检查 captcha
  if (config.captcha.twoCaptchaApiKey) {
    try {
      const solved2 = await detectAndSolveHCaptcha(page);
      if (solved2) log.info('   ✓ 发送后已解 hCaptcha');
    } catch (e) {}
  }
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