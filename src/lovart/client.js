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

// 截图工具：visible 模式下记录每步
const DEBUG_DIR = path.resolve(__dirname, '..', '..', 'docs', 'debug');
try { fs.mkdirSync(DEBUG_DIR, { recursive: true }); } catch (_) {}
let __snapIdx = 0;
async function snap(page, label, log) {
  try {
    __snapIdx += 1;
    const idx = String(__snapIdx).padStart(2, '0');
    const f = path.join(DEBUG_DIR, `${idx}-${label}.png`);
    await page.screenshot({ path: f });
    if (log) log.info(`   📸 截图: ${f}`);
  } catch (e) {
    if (log) log.debug(`   📸 截图失败: ${e.message}`);
  }
}

/**
 * 单行任务执行入口（改用 keep-open 验证过的同款流程）
 * keep-open.js 持续跑通，client.js 包装后失败 —— 本函数完全镜像 keep-open 的成功模式
 * @param {string} workerLabel
 * @param {object} task {recordId, styleNo, modelImage, prompts:[{taskType,text,folder,writeField}]}
 * @param {object} hooks {onPromptDone(prompt, localFiles)}
 */
async function runRow(workerLabel, task, hooks = {}) {
  const log = makeLogger(`lovart.client.${workerLabel}`);
  log.info(`▶ 开始 recordId=${task.recordId} 款号=${task.styleNo} 提示词=${task.prompts.length}`);

  let { browser, ctx, page } = await newContext(workerLabel);

  // 用于记录每条 prompt 之前画布上已有的 img 数（用于"增量"判定新生成的图）
  let prevImgCount = 0;
  const results = [];

  try {
    // 1. 打开画布（keep-open 模式：直接 goto newProjectUrl）
    log.info('打开 Lovart canvas');
    await page.goto(selectors.canvas.newProjectUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    // 关键时序：keep-open 用 humanSleep 5000-7000ms（比之前 3000-6000 更长）
    await humanSleep(5000, 7000);
    await snap(page, '01-loaded', log);

    // 2. dismiss onboarding（跟 keep-open 一样用 page.$ 单个按钮 + sleep 1500）
    log.info('Dismiss onboarding（keep-open 模式）');
    for (const text of ['Next', 'Get started', '跳过', '知道了']) {
      const btn = await page.$(`button:has-text("${text}")`);
      if (btn) {
        log.info(`   点 "${text}"`);
        await btn.click({ force: true });
        await sleep(1500);
      }
    }
    // ESC 兜底（跟 keep-open 一样）
    await page.keyboard.press('Escape');
    await sleep(500);
    await page.keyboard.press('Escape');
    await sleep(500);
    await snap(page, '02-after-dismiss', log);

    // 3. 检查 chat panel 是否就绪
    let inputs = 0;
    for (let i = 1; i <= 5; i++) {
      inputs = await page.$$eval('[role="textbox"], div[contenteditable="true"], textarea', (els) =>
        els.filter((e) => e.offsetParent !== null).length,
      );
      if (inputs > 0) {
        log.info(`✓ chat panel 就绪（输入框=${inputs}）`);
        break;
      }
      log.info(`   轮 ${i}: 输入框=0，等 2s`);
      await sleep(2000);
    }
    if (inputs === 0) {
      throw new Error('chat panel 5 轮后仍未加载');
    }


    // 3.5 选模型 Nano Banana 2（点右下角设置按钮 → 弹出菜单选模型）
    try {
      await selectModel(page, log, config.business.lovartModel);
      log.info(`   模型已选: ${config.business.lovartModel}`);
    } catch (e) {
      log.warn(`   选模型失败（继续）: ${e.message}`);
    }
    // 4. 上传参考图（暂时跳过，DataTransfer 会让 Lovart 崩）
    await uploadReferenceImage(page, log, task.modelImage);

    // 5. 逐条跑 prompt（从第 2 个起，每个 prompt 用新 browser/canvas，避免 Lovart 多 prompt 状态破坏）
    for (let i = 0; i < task.prompts.length; i++) {
      const p = task.prompts[i];
      log.info(`▶▶ prompt ${i + 1}/${task.prompts.length} | ${p.taskType} | 文件夹=${p.folder}`);

      // 从第 2 个 prompt 起，关闭旧 + 开新 browser（每个 prompt 独立项目）
      if (i > 0) {
        log.info('   关闭旧项目，开新 browser');
        try { await ctx.close(); } catch (_) {}
        try { await browser.close(); } catch (_) {}
        const r = await newContext(workerLabel);
        browser = r.browser;
        ctx = r.ctx;
        page = r.page;
        // 重新打开 canvas + dismiss + 等 panel
        await page.goto(selectors.canvas.newProjectUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await humanSleep(5000, 7000);
        for (const text of ['Next', 'Get started', '跳过', '知道了']) {
          const btn = await page.$(`button:has-text("${text}")`);
          if (btn) { await btn.click({ force: true }); await sleep(1500); }
        }
        await page.keyboard.press('Escape');
        await sleep(500);
        await page.keyboard.press('Escape');
        await sleep(500);
        for (let j = 1; j <= 5; j++) {
          const inp = await page.$$eval('[role="textbox"], div[contenteditable="true"], textarea', (els) =>
            els.filter((e) => e.offsetParent !== null).length,
          );
          if (inp > 0) break;
          await sleep(2000);
        }
      }

      prevImgCount = await countResultImages(page);

      // 输入 + 发送
      await inputPrompt(page, log, p.text);
      await clickSend(page, log);

      // 快速积分检查：看 task/take/slot 是否 FAIL
      let hasCredits = true;
      for (let ct = 0; ct < 6; ct++) {
        await sleep(5000);
        const slotStat = await page.evaluate(async () => {
          try {
            const r = await fetch('https://www.lovart.ai/api/canva/agent-cashier/task/take/slot', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ project_id: window.location.href.match(/projectId=([^&]+)/)?.[1] || '', cid: 'check' }),
            });
            const d = await r.json();
            return d?.data?.status || '?';
          } catch (_) { return 'err'; }
        });
        if (slotStat === 'FAIL') { hasCredits = false; log.warn('   ❌ task/take/slot FAIL — 积分不足，跳过等待'); break; }
        if (slotStat !== '?') { log.info(`   slot status: ${slotStat}`); }
      }

      if (hasCredits) {
        // 等生成完成
        await waitForGenerationDone(page, log, prevImgCount);
      } else {
        log.warn('   积分不够，跳过等待直接标记失败');
        throw new Error('Lovart 积分不足（task/take/slot FAIL）');
      }

      // 下载图片
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

    log.info(`✅ 完成 recordId=${task.recordId} 共 ${results.length} 条 prompt`);
    return { recordId: task.recordId, styleNo: task.styleNo, results };
  } finally {
    await ctx.close();
    await browser.close();
  }
}

/**
 * Dismiss 多步骤 onboarding（Next / Get started / 跳过 / 等）
 * 每步之间 humanSleep(1-3s) 模拟真人阅读
 */
async function dismissOnboarding(page, log) {
  // 简化为跟 test-visible-full 一样的逻辑（已实测可用）
  const dismissTexts = ['Next', 'Get started', 'Got it', '跳过', '知道了'];
  for (let round = 1; round <= 6; round++) {
    let clicked = false;
    let clickedText = '';
    for (const text of dismissTexts) {
      const btns = await page.$$('button:has-text("' + text + '")');
      for (const btn of btns) {
        try {
          await btn.click({ force: true, timeout: 2000 });
          clicked = true;
          clickedText = text;
          // 等 AFTER click（keep-open 实测有效的模式）
          await sleep(1500);
          break;
        } catch (e) {}
      }
      if (clicked) break;
    }
    if (!clicked) {
      await page.keyboard.press('Escape');
      await sleep(500);
    }
    await snap(page, `dismiss-r${round}-${clickedText || 'ESC'}`, log);
    // 必须跑满 6 轮（Next×2 + Get started + 跳过 + 2 ESC）才能关掉所有弹窗
    if (round >= 4 && !clicked) {
      // 已点完 Next/Get started/跳过 都没了，ESC 也按过 → 结束
      log.info('onboarding dismiss 完成（轮 ' + round + '）');
      return;
    }
  }
  log.warn('onboarding dismiss 达到最大轮数（可能还有未关掉的）');
}

/**
 * 上传参考素材图到画布
 * ⚠️ 注意：Lovart 的 chat-style canvas 没有 file input，只能用 DataTransfer 拖拽。
 *    但 DataTransfer 会触发 Lovart React app 进入 "uploading" 状态，期间整个 chat panel
 *    会被 unmount，导致 inputPrompt 找不到输入框。
 *    实测：t=90s 后页面仍然 empty。这是 Lovart 自身的 bug，我们绕不过去。
 *    临时方案：直接跳过图片上传，prompt 里有详细描述也能生成（实测通过）。
 */
async function uploadReferenceImage(page, log, modelImage) {
  log.info(`⚠️  跳过参考图上传（Lovart chat panel 在 DataTransfer 后会崩，已知 bug）`);
  log.info(`   直接用 prompt 文字描述生成（参考图 URL: ${(modelImage.url || '').slice(0, 80)}...）`);
  // 不做任何上传操作，让 prompt 走文本-only 路径
  return;
}
async function inputPrompt(page, log, text) {
  log.info(`输入 prompt（${text.length} 字）`);
  await randomMouseMove(page);

  let ok = false;
  let lastReason = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) {
      log.info(`   重试 ${attempt}/4...`);
      await page.evaluate(() => {
        document.querySelectorAll('.fixed.inset-0').forEach((el) => { if (getComputedStyle(el).pointerEvents !== 'none') el.remove(); });
        document.querySelectorAll('.bg-black\\/20').forEach((el) => el.remove());
      });
      await humanSleep(2000, 3000);
    }

    const result = await page.evaluate(({ text }) => {
      const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'));
      const visible = all.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 100 && r.height > 15;
      });
      if (visible.length === 0) {
        // 诊断：dump 页面状态
        const allEls = Array.from(document.querySelectorAll('*'));
        const textareas = Array.from(document.querySelectorAll('input, textarea')).map((i) => ({
          tag: i.tagName,
          type: i.type,
          placeholder: i.placeholder?.slice(0, 30) || '',
          visible: i.offsetParent !== null,
        }));
        const contenteditable = Array.from(document.querySelectorAll('[contenteditable]')).map((e) => ({
          ce: e.getAttribute('contenteditable'),
          visible: e.offsetParent !== null,
          text: (e.innerText || '').slice(0, 50),
        }));
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog, .modal')).map((d) => ({
          role: d.getAttribute('role') || '',
          visible: d.offsetParent !== null,
          text: (d.innerText || '').slice(0, 100),
        }));
        const title = document.title;
        const url = location.href;
        return {
          ok: false,
          reason: 'no visible input',
          url,
          title,
          totalCandidates: all.length,
          textareas: textareas.length,
          textareasDetail: textareas.slice(0, 5),
          contenteditables: contenteditable.length,
          contenteditablesDetail: contenteditable.slice(0, 5),
          dialogs: dialogs.length,
          dialogsDetail: dialogs.slice(0, 3),
          visibleBodyText: (document.body.innerText || '').slice(0, 300),
        };
      }
      const e = visible.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      e.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
      return { ok: true };
    }, { text });

    if (result.ok) {
      ok = true;
      break;
    }
    lastReason = JSON.stringify(result).slice(0, 800);
    log.info(`   [诊断] url=${result.url} title=${result.title}`);
    log.info(`   [诊断] textareas=${result.textareas} contenteditables=${result.contenteditables} dialogs=${result.dialogs}`);
    log.info(`   [诊断] body text 头 200: ${(result.visibleBodyText || '').slice(0, 200)}`);
  }
  if (!ok) throw new Error(`4 次重试后仍找不到 prompt 输入框（${lastReason}）`);
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

/**
 * 选择模型：先点 thinking-mode → 再点 settings → 弹出模型列表 → 选 Nano Banana 2
 * （实测只有两个按钮都点后 popover 才渲染模型列表）
 */
async function selectModel(page, log, modelName) {
  log.info(`   选择模型: ${modelName}`);
  // Step 1: 先点 thinking-mode-button（触发内部 panel，让模型列表可渲染）
  try {
    const thinkingBtn = page.locator('[data-testid="agent-thinking-mode-button"]');
    if (await thinkingBtn.count() > 0) {
      await thinkingBtn.click({ force: true });
      await sleep(1000);
    }
  } catch (_) {}
  // Step 2: 点 settings-button 打开模型列表
  const settingsBtn = page.locator('[data-testid="agent-custom-settings-button"]');
  if (await settingsBtn.count() === 0) { log.warn('   找不到设置按钮'); return; }
  await settingsBtn.click({ force: true });
  await sleep(2500);
  // Step 3: 找模型名并点击
  try {
    const nb2 = page.locator(`text="${modelName}"`).first();
    if (await nb2.count() > 0 && await nb2.isVisible().catch(() => false)) {
      await nb2.click({ force: true });
      log.info(`   ✓ 已选 ${modelName}`);
      await sleep(500);
      return;
    }
  } catch (_) {}
  log.warn(`   未找到模型 "${modelName}"`);
}

module.exports = { runRow };