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
  log.info(`▶ 开始 recordId=${task.recordId} 款号=${task.styleNo} 提示词=${task.prompts.length}段`);

  let { browser, ctx, page } = await newContext(workerLabel);

  const results = [];

  /**
   * 计算 retry 退避时间（ms）
   *   attempt 2 → base
   *   attempt 3 → base × mult
   *   attempt N → base × mult^(N-2)
   */
  function computeBackoff(attempt) {
    const base = config.business.promptRetryBaseMs || 300_000;
    const mult = config.business.promptRetryMult || 2;
    return Math.round(base * Math.pow(mult, attempt - 2));
  }

  /**
   * 判定异常是否值得重试
   * ✅ 超时（waitForGenerationDone 抛的）
   * ✅ browser 已断开 / 网络异常
   * ✅ Lovart 积分检测 FAIL
   * ❌ 找不到输入框 / 配置错 —— 立刻抛
   */
  function isRetryable(err) {
    const msg = (err && err.message) || '';
    if (/超时|timeout/i.test(msg)) return true;
    if (/Target page|context or browser has been closed|net::|ECONNRESET/i.test(msg)) return true;
    if (/积分不足|task\/take\/slot FAIL/i.test(msg)) return true;
    return false;
  }

  try {
    // 1. 打开画布（keep-open 模式：直接 goto newProjectUrl）
    log.info('打开 Lovart canvas');
    // waitUntil='commit'：HTTP 首个字节到就 resolve（实测 Lovart canvas 用 domcontentloaded 要 57s，
    //   加 cloakbrowser humanGoto 注入更慢，60s timeout 经常卡死）。
    //   后续 panel 轮询（[role="textbox"]）兜底，不需要等 dom 完整
    await page.goto(selectors.canvas.newProjectUrl, {
      waitUntil: 'commit',
      timeout: 120_000,
    });
    // 关键时序：keep-open 用 humanSleep 5000-7000ms（比之前 3000-6000 更长）
    // 加大到 15000-20000ms 给 canvas 足够时间加载完整页面
    await humanSleep(15000, 20000);
    await snap(page, '01-loaded', log);

    // 2. dismiss onboarding — 循环点 Next 直到弹窗消失
    log.info('Dismiss onboarding');
    let dismissRounds = 0;
    const maxRounds = 10;
    while (dismissRounds < maxRounds) {
      dismissRounds++;
      let clicked = false;
      // 按优先级尝试每个按钮
      for (const text of ['Next', 'Get started', 'Got it', '跳过', '知道了']) {
        try {
          const btn = page.locator(`button:has-text("${text}")`).first();
          if (await btn.count() > 0 && await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await btn.click({ force: true });
            log.info(`   点 "${text}" (round ${dismissRounds})`);
            clicked = true;
            await sleep(2000);
            break;
          }
        } catch (_) {}
      }
      if (!clicked) {
        // 没找到按钮，弹窗可能已关闭
        await page.keyboard.press('Escape');
        await sleep(500);
        break;
      }
    }
    log.info(`   onboarding dismiss 完成（${dismissRounds} 轮）`);
    await snap(page, '02-after-dismiss', log);

    // 3. 检查 chat panel 是否就绪
    let inputs = 0;
    for (let i = 1; i <= 20; i++) {
      inputs = await page.$$eval('[role="textbox"], div[contenteditable="true"], textarea', (els) =>
        els.filter((e) => e.offsetParent !== null).length,
      );
      if (inputs > 0) {
        log.info(`✓ chat panel 就绪（输入框=${inputs}, 轮 ${i}）`);
        break;
      }
      if (i === 1 || i % 5 === 0) log.info(`   轮 ${i}: 输入框=0，等 2s`);
      await sleep(2000);
    }
    if (inputs === 0) {
      await snap(page, 'error-no-input', log);
      throw new Error('chat panel 20 轮后仍未加载');
    }


    // 选择"无限低速生成"（慢速队列模式，不消耗积分）
    try {
      await selectSlowMode(page, log);
      log.info('   ✓ 已选 无限低速生成');
    } catch (e) {
      log.warn(`   选无限低速生成失败（继续）: ${e.message}`);
    }

    // 逐条跑 prompt（每行 1 个 prompt，带自适应重试）
    for (let i = 0; i < task.prompts.length; i++) {
      const p = task.prompts[i];
      log.info(`▶▶ prompt ${i + 1}/${task.prompts.length} | ${p.taskType} | 文件夹=${p.folder}`);

      // 单段自适应重试：失败 → 退避 → 重新开 browser
      let localFiles;
      let attemptCount = 0;
      const maxAttempts = config.business.promptRetryMax || 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attemptCount = attempt;
        try {
          // 每次重试开全新 browser + canvas（避免 Lovart 后台还挂着旧请求状态）
          if (attempt > 1 || i > 0) {
            log.info(`   关闭旧项目，开新 browser (attempt ${attempt}/${maxAttempts})`);
            try { await ctx.close(); } catch (_) {}
            try { await browser.close(); } catch (_) {}
            const r = await newContext(workerLabel);
            browser = r.browser;
            ctx = r.ctx;
            page = r.page;
            // 重新打开 canvas + dismiss + 等 panel
            await page.goto(selectors.canvas.newProjectUrl, {
              waitUntil: 'commit',
              timeout: 120_000,
            });
            await humanSleep(15000, 20000);
            // dismiss onboarding（循环点 Next 直到消失）
            for (let dr = 0; dr < 10; dr++) {
              let clicked = false;
              for (const text of ['Next', 'Get started', 'Got it', '跳过', '知道了']) {
                try {
                  const b = page.locator(`button:has-text("${text}")`).first();
                  if (await b.count() > 0 && await b.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await b.click({ force: true }); clicked = true; await sleep(2000); break;
                  }
                } catch (_) {}
              }
              if (!clicked) { await page.keyboard.press('Escape'); await sleep(500); break; }
            }
            for (let j = 1; j <= 20; j++) {
              const inp = await page.$$eval('[role="textbox"], div[contenteditable="true"], textarea', (els) =>
                els.filter((e) => e.offsetParent !== null).length,
              );
              if (inp > 0) break;
              await sleep(2000);
            }
            // 重试时也要选慢速模式
            try {
              await selectSlowMode(page, log);
            } catch (e) {
              log.warn(`   选无限低速生成失败（继续）: ${e.message}`);
            }
          }

          // 跑一次单段 prompt（不含开 browser 逻辑，由上面准备）
          localFiles = await executeSinglePrompt(page, log, task, p, hooks);
          // 成功（0 张也算 Lovart 正常返回；不重试）
          if (attempt > 1) {
            log.info(`   ✅ 重试成功 (attempt ${attempt}/${maxAttempts})`);
          }
          break;
        } catch (e) {
          log.warn(`   ❌ attempt ${attempt}/${maxAttempts} 失败: ${e.message.slice(0, 120)}`);
          // 不可重试错误 → 直接抛
          if (!isRetryable(e)) {
            log.error(`   不可重试错误，停止重试: ${e.message.slice(0, 120)}`);
            throw e;
          }
          // 重试用尽 → 抛
          if (attempt >= maxAttempts) {
            log.error(`   ⚠️ 已达重试上限 ${maxAttempts}，放弃`);
            throw e;
          }
          // 退避
          const backoffMs = computeBackoff(attempt + 1);
          log.info(`   ⏳ ${backoffMs / 1000}s 后重试 (${(backoffMs / 60000).toFixed(1)} min) ...`);
          await sleep(backoffMs);
        }
      }

      results.push({
        taskType: p.taskType,
        writeField: p.writeField,
        folder: p.folder,
        localFiles,
        attempts: attemptCount,
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
 * 单段 prompt 的完整执行（不含开/关 browser，由外层 retry 包装）
 * @param {Page} page
 * @param {Logger} log
 * @param {object} task
 * @param {object} p prompt 段
 * @param {object} hooks
 * @returns {string[]} 本地下载文件路径列表
 */
async function executeSinglePrompt(page, log, task, p, hooks) {
  // 发送前 baseline
  const prevImgCount = await countResultImages(page);
  const prevImgUrls = new Set(await getFinalResultUrls(page));
  log.info(`   发送前 baseline: final-img=${prevImgCount}, urls=${prevImgUrls.size}`);

  // 先上传参考图到输入框（让图片和提示词在一起）
  await uploadReferenceImage(page, log, task, task.modelImage);

  // 输入提示词
  await inputPrompt(page, log, p.text);

  if (task.uploadTest) {
    log.info('   [UPLOAD TEST] 不发送，验证输入+图片就绪');
    await snap(page, '04-upload-test', log);
    log.info('   ✅ 上传测试通过，关闭 browser');
    await sleep(2000);
    return [];
  }
  await clickSend(page, log);

  // 等待生成完成（慢速队列模式，不消耗积分）
  const targetCount = parseImageCount(p.text);
  await waitForGenerationDone(page, log, prevImgCount, prevImgUrls, targetCount);

  // 下载图片（按 URL 过滤已存在的，按 targetCount 限制张数）
  // ⚠️ 必须包含 recordId，否则同款号并发时会互相覆盖文件导致图片串位
  const localFiles = await downloadNewResults(page, log, {
    rowDir: path.join(config.downloadsDir, todayStr(), task.styleNo, p.folder, task.recordId),
    prevUrls: prevImgUrls,
    targetCount,
  });

  if (hooks.onPromptDone) {
    await hooks.onPromptDone(p, localFiles, { recordId: task.recordId });
  }

  return localFiles;
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
 * 流程：下载原图 → >2MB 压缩 → 聚焦输入框 → + → 上传文件 → fileChooser 喂文件
 * 注意：inputPrompt 已修复（不再 selectAll 删除参考图，改为光标末尾追加文本）
 */
async function uploadReferenceImage(page, log, task, modelImage) {
  log.info(`上传参考图: ${modelImage.filename || 'reference'}`);
  // Step 1: 下原图到 data/reference-images/<recordId>_<款号>.<ext>
  const ext = (modelImage.filename || 'ref.png').match(/.[^.]+$/)?.[0] || '.png';
  const localDir = path.resolve(__dirname, '..', '..', 'data', 'reference-images');
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
  const localFile = path.join(localDir, `${task.recordId}_${task.styleNo}${ext}`);
  await downloadOne(modelImage.url, localFile);
  let stat = fs.statSync(localFile);
  log.info(`   已存: ${localFile} (${(stat.size/1024/1024).toFixed(2)} MB)`);
  // Step 2: >2MB 压缩成同名 .jpg
  let fileToUpload = localFile;
  if (stat.size > 2 * 1024 * 1024) {
    log.info('   压缩到 <2MB');
    const compressedB64 = await page.evaluate(async ({ b64 }) => {
      const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64;
      await new Promise((r, j) => { img.onload = r; img.onerror = j; setTimeout(() => j(new Error('timeout')), 10000); });
      let { width, height } = img;
      const scale = Math.min(1, Math.sqrt((1.5 * 1024 * 1024) / (b64.length * 0.75)));
      width = Math.round(width * scale); height = Math.round(height * scale);
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    }, { b64: fs.readFileSync(localFile).toString('base64') });
    fileToUpload = localFile.replace(/.[^.]+$/, '') + '.jpg';
    fs.writeFileSync(fileToUpload, Buffer.from(compressedB64, 'base64'));
    log.info(`   压缩存: ${fileToUpload} (${(fs.statSync(fileToUpload).size/1024/1024).toFixed(2)} MB)`);
  }
  // Step 3: 先聚焦输入框，让 Lovart 知道正在编辑消息，图片会附加到当前消息中
  log.info('   聚焦输入框后上传图片');
  await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[role="textbox"], div[contenteditable="true"], textarea'));
    const visible = all.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 100 && r.height > 15;
    });
    if (visible.length > 0) visible[0].focus();
  });
  await sleep(800);

  // Step 4: 注册 fileChooser，点 + → 上传文件 → 喂文件
  log.info('   准备 fileChooser 监听 + 点 + 触发系统 dialog');

  // 多策略找 + 按钮（Lovart UI 可能变动）
  let plusBtn = null;
  // 策略 A: SVG path 匹配
  plusBtn = page.locator('button').filter({ has: page.locator('svg path[d^="M11.25"]') }).first();
  if (await plusBtn.count() === 0) {
    // 策略 B: 找输入框旁边最近的 button
    plusBtn = page.locator('[role="textbox"]').locator('..').locator('button').first();
  }
  if (await plusBtn.count() === 0) {
    // 策略 C: 找页面中所有 small icon button（无文本的 button）
    const btns = await page.$$('button');
    for (const b of btns) {
      const text = (await b.innerText()).trim();
      const hasSvg = await b.$('svg');
      if (!text && hasSvg) {
        plusBtn = b; break;
      }
    }
    if (!plusBtn) plusBtn = page.locator('button').first(); // 兜底
  }
  if (!plusBtn || (await plusBtn.count?.() === 0)) {
    log.warn('   找不到 + 按钮（所有策略均失败）'); return;
  }

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null);
  await plusBtn.click({ force: true });
  log.info('   ✓ 已点 + 按钮');
  await sleep(1500);

  // 点 "上传文件" 菜单项
  const up = page.locator('text=上传文件').first();
  if (await up.count() > 0) {
    await up.click({ force: true });
    log.info('   ✓ 点了 "上传文件"');
  } else {
    // fallback: 试 "上传图片" 或其他
    const alt = page.locator('text=/上传(文件|图片)/').first();
    if (await alt.count() > 0) { await alt.click({ force: true }); log.info('   ✓ 点了备用上传菜单'); }
    else { log.warn('   找不到 "上传文件" 项'); }
  }

  // 等 fileChooser 事件
  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(fileToUpload);
    log.info(`   ✓ fileChooser setFiles: ${fileToUpload}`);
    await sleep(5000); // 多等 1 秒确保 Lovart 上传完成

    // 验证：上传后检查输入框是否出现图片 capsule
    const hasCapsule = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="agent-mention-capsule-uploaded"]');
      return !!el;
    });
    if (hasCapsule) {
      log.info('   ✓ 已确认参考图 capsule 出现在输入框中');
    } else {
      log.warn('   ⚠ 上传后未在输入框检测到图片 capsule！参考图可能未发送');
      await snap(page, 'upload-no-capsule', log);
      // 不 return —— 继续跑，prompt 文字描述兜底
    }
  } else {
    log.warn('   fileChooser 未触发（超时），继续纯文本模式');
  }
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
      // 不要把已有内容（参考图）selectAll 删掉，改为追加到末尾
      // 先把光标挪到 contenteditable 末尾
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(e);
      range.collapse(false); // 折叠到末尾
      sel.addRange(range);
      // 再插入文本（不会覆盖已有内容）
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
 * 判定一张 <img> 是否为 Lovart 的"最终结果图"
 * 规则：
 *   1. URL 必须是 Lovart 结果图域名（lovart.ai 或 alidocs2.oss）—— 排除 page icon/decoration
 *   2. 自然高度 ≥ FINAL_IMG_MIN_H（240px）—— 过滤掉 icon/avatar
 *
 * 注意：img 刚插入 DOM 时 naturalHeight=0（图片未加载），要等 complete=true 才有效
 */
const FINAL_IMG_MIN_H = 240;
const FINAL_IMG_URL_PATTERN = /lovart\.ai|alidocs2\.oss-cn-zhangjiakou\.aliyuncs\.com/i;
function isFinalResultImg(imgEl) {
  if (!imgEl || !imgEl.complete) return false;
  if (!imgEl.naturalHeight) return false;
  if (imgEl.naturalHeight < FINAL_IMG_MIN_H) return false;
  const src = imgEl.src || imgEl.getAttribute('data-src') || '';
  return FINAL_IMG_URL_PATTERN.test(src);
}

/**
 * 从提示词文本中提取"生成N张"的数量
 * 默认 1 张。匹配 "N张" "N 张" 等格式
 * @param {string} prompt
 * @returns {number}
 */
function parseImageCount(prompt) {
  if (!prompt) return 1;
  const m = prompt.match(/(\d+)\s*张/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

/**
 * 等待画布上所有可见 img 完成加载（最多 waitMs）
 * 解决 naturalHeight=0 错过滤问题
 */
async function waitForImagesLoaded(page, waitMs = 3000) {
  await page.evaluate((max) => new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      const allLoaded = imgs.every((i) => i.complete && i.naturalHeight > 0);
      if (allLoaded || Date.now() - start > max) return resolve();
      setTimeout(tick, 200);
    };
    tick();
  }), waitMs);
}

/**
 * 计算画布上结果图片数量（只看最终结果图，过滤草稿缩略）
 */
async function countResultImages(page) {
  await waitForImagesLoaded(page, 3000);
  return await page.$$eval(
    'img',
    (els, minH) =>
      els.filter((i) => i.complete && i.naturalHeight && i.naturalHeight >= minH).length,
    FINAL_IMG_MIN_H,
  );
}

/**
 * 处理 Lovart 的"询问"对话框（澄清问题）
 * Lovart 有时会弹出"请确认..."对话框，需要选择选项才能继续
 * 策略：点击"保持原始"或"使用原图"等第一个默认选项
 */
async function handleClarificationDialog(page, log) {
  // 找页面里所有含"询问"图标的元素（一般是 .anticon-question 或 svg）
  const found = await page.evaluate(() => {
    // 找包含"询问"图标的容器
    const candidates = Array.from(document.querySelectorAll('div, section'));
    const dialogs = candidates.filter((el) => {
      const text = (el.innerText || '').slice(0, 50);
      return /询问|确认.*细节|请确认/.test(text) && el.querySelector('input[type="radio"], [role="radio"], [role="button"]');
    });
    if (dialogs.length === 0) return null;
    const dlg = dialogs[0];
    // 找第一个单选/选项按钮（通常是"保持..."或"使用原图..."）
    const options = dlg.querySelectorAll('input[type="radio"], [role="radio"], label, button');
    const firstOpt = options[0];
    return firstOpt ? !!firstOpt : false;
  });
  if (!found) return false;

  log.info('   检测到 Lovart 询问对话框，自动选择第一项（保持原图）');

  // 直接用 evaluate 找到第一个 radio/label 并点击
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('div, section'));
    const dialogs = candidates.filter((el) => {
      const text = (el.innerText || '').slice(0, 50);
      return /询问|确认.*细节|请确认/.test(text);
    });
    if (dialogs.length === 0) return false;
    const dlg = dialogs[0];
    const options = dlg.querySelectorAll('input[type="radio"], [role="radio"], label, button');
    if (options.length > 0) {
      options[0].click();
      return true;
    }
    return false;
  });
  if (clicked) {
    await sleep(2000);
    // 通常选项被选后会自动发送；再确认一下 send 按钮或者等待 agent 继续
    log.info('   ✓ 已点击第一项选项');
    return true;
  }
  return false;
}

/**
 * 等待生成完成（增强调试版：定期截图 + 页面文本dump + 图片检测日志）
 * 判定：loading 文本消失 + 新 img 数 > prevCount
 */
async function waitForGenerationDone(page, log, prevCount, prevUrls = new Set(), targetCount = 1) {
  log.info(`等待生成完成（prevImgCount=${prevCount}, targetCount=${targetCount}）`);

  // 先尝试处理 Lovart 的"询问"对话框（澄清问题）
  // Lovart 有时会问"请确认模特的服装和造型细节"等，需要选第一个选项才能继续
  try {
    await handleClarificationDialog(page, log);
  } catch (e) {
    log.warn(`   处理询问对话框失败: ${e.message}`);
  }

  // 先 dump 页面关键文本，帮助定位慢速模式的 loading 文案
  try {
    const texts = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*'));
      const seen = new Set();
      return all
        .filter((el) => {
          if (el.children.length > 5) return false;
          const t = (el.innerText || '').trim();
          return t.length > 0 && t.length < 200 && !seen.has(t) && seen.add(t);
        })
        .map((el) => (el.innerText || '').trim().slice(0, 150))
        .filter((t) => /生成|分析|搜索|排队|等待|处理|进行|创建|设计|队列|生成中|loading|generating/i.test(t));
    });
    if (texts.length > 0) {
      log.info(`   [DEBUG] 页面关键文本: ${JSON.stringify(texts.slice(0, 10))}`);
    } else {
      log.info('   [DEBUG] 未找到生成/loading 相关文本');
    }
  } catch (e) { log.warn(`   [DEBUG] dump 失败: ${e.message}`); }

  // 等 loading 出现（最长 30s）—— 扩展匹配词
  const loadingSelectors = [
    `:text("${selectors.status.generatingText}")`,
    `:text("${selectors.status.generatingTextAlt}")`,
    ':text("排队")',
    ':text("生成中")',
    ':text("处理中")',
    ':text("等待")',
    ':text("创建")',
    ':text("设计")',
  ].join(', ');
  const loadingAppeared = await page
    .waitForSelector(loadingSelectors, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);

  if (!loadingAppeared) {
    log.warn('   ⚠ loading 文本未出现，可能已经完成或极快');
  } else {
    log.info('   ✓ 检测到 loading 文本');
  }

  // 轮询等待完成，带定期截图和日志
  let lastSnap = Date.now();
  const SNAP_INTERVAL = 60_000; // 每 60s 截图一次
  let checkCount = 0;

  await waitUntil(
    async () => {
      checkCount++;

      // 定期截图
      if (Date.now() - lastSnap >= SNAP_INTERVAL) {
        lastSnap = Date.now();
        const mins = Math.round((Date.now() - (lastSnap - SNAP_INTERVAL + 1)) / 60000);
        await snap(page, `wait-${String(checkCount).padStart(2, '0')}-${mins}m`, log);
      }

      // 查 loading 文本是否还显示（队列状态"排队中"不算 loading）
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
        // '排队中' 已移除：慢速队列会一直显示排队状态，不是真正的 loading
        'Generating', 'Generating...',
      ]);

      // 统计画布上新生成的 img（不限高度，只要是新出现的实际图）
      // 通过 URL 对比避免被页面装饰图干扰
      const curUrls = await getFinalResultUrls(page);
      const newImgCount = curUrls.filter((u) => !prevUrls.has(u)).length;

      // 旧的高度阈值统计保留，用于日志
      const allImgCount = await page.$$eval('img', (els) => els.length);
      const finalCount = await countResultImages(page);

      if (checkCount % 6 === 1) { // 每 ~30s 输出一次
        log.info(`   [轮询 #${checkCount}] all-img=${allImgCount} final-img(≥240h)=${finalCount} new-img=${newImgCount}/${targetCount} loading=${!loadingGone}`);
      }

      // 等待指定数量的新图都生成出来
      return loadingGone && newImgCount >= targetCount;
    },
    { timeoutMs: config.business.lovartGenTimeoutSec * 1000, intervalMs: 5_000, desc: 'lovart-generation' },
  ).catch((e) => {
    log.warn('   等待完成超时：' + e.message);
  });

  // 最终状态 dump
  const finalAllImg = await page.$$eval('img', (els) => els.length);
  const finalImgs = await countResultImages(page);
  log.info(`   [最终] all-img=${finalAllImg} final-img=${finalImgs}`);
  await snap(page, 'wait-final', log);
}

/**
 * 抓画布上所有 final-img 的 src URL（用于 send 前 baseline 记录）
 * 同时应用 URL 过滤（lovart.ai / alidocs2.oss）确保只看结果图
 */
async function getFinalResultUrls(page) {
  await waitForImagesLoaded(page, 3000);
  return await page.$$eval(
    'img',
    (els, minH) =>
      els
        .filter((i) => i.complete && i.naturalHeight && i.naturalHeight >= minH)
        // 排除 page icon（域名不在 Lovart 结果图域名中）
        .filter((i) => /lovart\.ai|alidocs2\.oss-cn-zhangjiakou\.aliyuncs\.com/i.test(
          i.src || i.getAttribute('data-src') || ''
        ))
        .map((i) => i.src || i.getAttribute('data-src'))
        .filter(Boolean),
    FINAL_IMG_MIN_H,
  );
}

/**
 * 下载画布上新生成的图（只下最终结果图，过滤草稿缩略）
 * 增量用 URL set 对比：send 后抓到的 URL 里，不在 prevUrls 里的就是新生成的
 * 这样即使 Lovart 画布上残留上次的图（prevImgCount 错），也不会漏下 / 重复下
 */
async function downloadNewResults(page, log, { rowDir, prevUrls, targetCount = 999 }) {
  ensureDir(rowDir);
  // 等所有 img 加载完，避免 naturalHeight=0 错过滤
  await waitForImagesLoaded(page, 5000);
  const allUrls = await page.$$eval(
    'img',
    (els, minH) =>
      els
        .filter((i) => i.complete && i.naturalHeight && i.naturalHeight >= minH)
        // URL 过滤：只保留 Lovart 结果图域名（lovart.ai / alidocs2.oss）
        .filter((i) => /lovart\.ai|alidocs2\.oss-cn-zhangjiakou\.aliyuncs\.com/i.test(
          i.src || i.getAttribute('data-src') || ''
        ))
        .map((i) => i.src || i.getAttribute('data-src'))
        .filter(Boolean),
    FINAL_IMG_MIN_H,
  );
  // 用 URL set 差集过滤：只下载 send 前不存在的
  const newUrls = prevUrls ? allUrls.filter((u) => !prevUrls.has(u)) : allUrls;
  // 限制为目标数量（提示词中指定的张数），不要把过程图/缩略图也抓回来
  const limitedUrls = newUrls.slice(0, targetCount);
  // 调试：dump URL 域名分布
  const domainCounts = newUrls.reduce((acc, u) => {
    try {
      const d = new URL(u).hostname;
      acc[d] = (acc[d] || 0) + 1;
    } catch { acc['invalid'] = (acc['invalid'] || 0) + 1; }
    return acc;
  }, {});
  log.info(`下载 ${limitedUrls.length} 张新结果图（候选 ${newUrls.length} 张，URL 域名=${JSON.stringify(domainCounts)}，targetCount=${targetCount}）`);
  log.info(`   → 下载目录: ${rowDir}`);

  const localFiles = [];
  for (let i = 0; i < limitedUrls.length; i++) {
    const u = limitedUrls[i];
    const ext = (u.match(/\.(png|jpe?g|webp)(\?|$)/i) || [null, 'png'])[1] || 'png';
    const dest = path.join(rowDir, `img${String(i + 1).padStart(2, '0')}.${ext}`);
    try {
      await downloadOne(u, dest);
      localFiles.push(dest);
      log.info(`     ↓ img${String(i + 1).padStart(2, '0')} → ${dest}`);
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
 * 选择"无限低速生成"模式（慢速队列，不消耗积分）
 * 画布右下角有一个速度切换按钮组，button[2] 就是"无限低速生成"
 */
async function selectSlowMode(page, log) {
  log.info('   选择无限低速生成');
  const xp = '/html/body/div[1]/div/div/main/div/div/div[3]/div[3]/div[1]/span/div/button[2]';

  // 先截图看看当前页面状态
  await snap(page, '03-before-slow-mode', log);

  // 方法1: 浏览器原生 XPath 点击
  try {
    const clicked = await page.evaluate((xpath) => {
      const el = document.evaluate(xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }
      return false;
    }, xp);
    if (clicked) { log.info('   ✓ 已点 无限低速生成（XPath）'); await sleep(1500); return; }
  } catch (e) { log.warn(`   XPath 失败: ${e.message}`); }

  // 方法2: 遍历所有 button，按文本内容匹配
  try {
    const found = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const tgt = btns.find(b => /无限|低速/.test(b.textContent || ''));
      if (tgt) { tgt.scrollIntoView({ block: 'center' }); tgt.click(); return tgt.textContent?.slice(0, 50); }
      return null;
    });
    if (found) { log.info(`   ✓ 已点 "${found}"`); await sleep(1500); return; }
  } catch (e) { log.warn(`   文本匹配失败: ${e.message}`); }

  log.warn('   ⚠ 所有方法都没找到无限低速生成按钮');
}

module.exports = { runRow };