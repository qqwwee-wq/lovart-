// src/lovart/client.js —— 单个 Worker 内的 Lovart 生图主流程
// 流程：
//   1. 创建/进入一个新对话/项目
//   2. 上传参考素材图
//   3. 输入提示词
//   4. 选择模型 Nano Banana 2、比例 3:4、画质 2K
//   5. 触发生成（5 张）
//   6. 轮询等待完成
//   7. 下载 5 张图到本地
//
// ⚠️ 选择器都是 TODO，登录后我们用 MCP 把 UI 走一遍再回填
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { makeLogger } = require('../logger');
const { downloadOne, ensureDir } = require('../utils/download');
const { sleep, waitUntil, retry } = require('../utils/sleep');
const { newContext, closeAll } = require('./browser');
const selectors = require('./selectors');

/**
 * 单行任务执行入口
 * @param {string} workerLabel
 * @param {object} task {recordId, styleNo, modelImage, prompts:[{taskType,text,folder,writeField}]}
 * @param {object} hooks {onPromptDone(prompt, localFiles), onError(err, prompt?)}
 * @returns {object} { recordId, results: [{taskType, writeField, localFiles:[], uploaded}] }
 */
async function runRow(workerLabel, task, hooks = {}) {
  const log = makeLogger(`lovart.client.${workerLabel}`);
  log.info(`开始处理 recordId=${task.recordId} 款号=${task.styleNo}`, {
    prompts: task.prompts.length,
    needHalf: task.needHalf,
  });

  const { ctx, page } = await newContext(workerLabel);

  const results = [];
  try {
    // 先在 Lovart 里建好一个新项目/对话
    await createProject(page, log);

    // 1) 上传商品素材（一次即可，每个 prompt 都会引用）
    await uploadReference(page, log, task.modelImage);

    // 2) 逐条跑 prompt
    for (let i = 0; i < task.prompts.length; i++) {
      const p = task.prompts[i];
      log.info(`生成 ${i + 1}/${task.prompts.length} | taskType=${p.taskType} | 文件夹=${p.folder}`);

      // 每条提示词都需要保证模型/比例/画质设置（先设，再输入，再生成）
      await ensureSettings(page, log);
      await inputPrompt(page, log, p.text);
      await triggerGenerate(page, log);
      await waitForCompletion(page, log);

      // 下载 5 张图到本地
      const localFiles = await downloadResults(page, log, {
        rowDir: path.join(config.downloadsDir, todayStr(), task.styleNo, p.folder),
      });

      if (hooks.onPromptDone) {
        await hooks.onPromptDone(p, localFiles, { recordId: task.recordId });
      }

      results.push({
        taskType: p.taskType,
        writeField: p.writeField,
        folder: p.folder,
        localFiles,
        uploaded: false,
      });
    }

    log.info(`完成 recordId=${task.recordId}`);
    return { recordId: task.recordId, styleNo: task.styleNo, results };
  } finally {
    await ctx.close();
  }
}

// ========== 各步骤实现（占位） ==========

async function createProject(page, log) {
  // TODO: 点击 "新对话" 或类似按钮，等待新画布加载
  // 备选：直接刷新页面也是一种"新对话"
  log.info('创建新项目（TODO: 选 model + 新对话）');
  if (selectors.home.newProjectButton) {
    await page.click(selectors.home.newProjectButton);
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
  }
}

async function uploadReference(page, log, modelImage) {
  log.info(`上传参考图 ${modelImage.filename} ← ${modelImage.url.slice(0, 80)}...`);
  // 下载参考图到本地临时文件，再用 setInputFiles 上传
  const tmpDir = path.join(config.downloadsDir, '.tmp');
  ensureDir(tmpDir);
  const localTmp = path.join(tmpDir, `${Date.now()}-${modelImage.filename || 'ref.png'}`);
  await downloadOne(modelImage.url, localTmp);

  if (!selectors.project.fileInput) {
    log.warn('selectors.project.fileInput 未配置，跳过上传（请登录后用 MCP 填选择器）');
    return;
  }
  await page.setInputFiles(selectors.project.fileInput, localTmp);
  await page.waitForTimeout(2000); // 等待上传完成
}

async function ensureSettings(page, log) {
  // 选模型 Nano Banana 2
  if (selectors.project.modelSelect && selectors.project.modelOptionNanoBanana2) {
    log.info('选择模型 Nano Banana 2');
    await page.click(selectors.project.modelSelect);
    await sleep(500);
    await page.click(selectors.project.modelOptionNanoBanana2);
    await sleep(300);
  }
  // 比例 3:4
  if (selectors.project.ratioSelect && selectors.project.ratioOption3x4) {
    log.info('设置比例 3:4');
    await page.click(selectors.project.ratioSelect);
    await sleep(300);
    await page.click(selectors.project.ratioOption3x4);
    await sleep(300);
  }
  // 画质 2K
  if (selectors.project.resolutionSelect && selectors.project.resolutionOption2K) {
    log.info('设置画质 2K');
    await page.click(selectors.project.resolutionSelect);
    await sleep(300);
    await page.click(selectors.project.resolutionOption2K);
    await sleep(300);
  }
}

async function inputPrompt(page, log, text) {
  log.info(`输入提示词（${text.length} 字）`);
  if (!selectors.project.promptInput) {
    log.warn('selectors.project.promptInput 未配置');
    return;
  }
  const sel = selectors.project.promptInput;
  await page.fill(sel, '');
  await page.fill(sel, text);
  await sleep(500);
}

async function triggerGenerate(page, log) {
  log.info('触发生成');
  if (!selectors.project.generateButton) {
    log.warn('selectors.project.generateButton 未配置');
    return;
  }
  await page.click(selectors.project.generateButton);
}

async function waitForCompletion(page, log) {
  log.info('等待生成完成');
  if (!selectors.project.generatingIndicator || !selectors.project.resultImages) {
    log.warn('等待选择器未配置，使用兜底 sleep 5 分钟');
    await sleep(5 * 60_000);
    return;
  }
  // 等 loading 出现 → 消失（完成）
  await page.waitForSelector(selectors.project.generatingIndicator, { timeout: 60_000 }).catch(() => {});
  await waitUntil(
    async () => {
      const stillGenerating = await page.$(selectors.project.generatingIndicator);
      const ready = await page.$(selectors.project.resultImages);
      return !stillGenerating && !!ready;
    },
    { timeoutMs: 10 * 60_000, intervalMs: 5000, desc: 'lovart-generation' },
  ).catch((e) => {
    log.warn('等待完成超时，将尝试读取已有结果', { err: e.message });
  });
}

async function downloadResults(page, log, { rowDir }) {
  ensureDir(rowDir);
  log.info(`下载结果到 ${rowDir}`);
  if (!selectors.project.resultImages) {
    log.warn('selectors.project.resultImages 未配置');
    return [];
  }
  // 读 <img src> 列表
  const imgUrls = await page.$$eval(selectors.project.resultImages, (imgs) =>
    imgs.map((i) => i.src || i.getAttribute('data-src')).filter(Boolean),
  );
  log.info(`找到 ${imgUrls.length} 张图片`);
  const localFiles = [];
  for (let i = 0; i < imgUrls.length; i++) {
    const ext = (imgUrls[i].match(/\.(png|jpe?g|webp)(\?|$)/i) || [null, 'png'])[1] || 'png';
    const dest = path.join(rowDir, `img${String(i + 1).padStart(2, '0')}.${ext}`);
    try {
      await downloadOne(imgUrls[i], dest);
      localFiles.push(dest);
    } catch (e) {
      log.warn(`下载失败 #${i + 1}: ${e.message}`);
    }
  }
  return localFiles;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = { runRow };
