// src/workers/runOne.js —— 单行任务的完整执行：钉钉状态回写 + Lovart 生成 + 上传回写
'use strict';

const config = require('../config');
const { makeLogger } = require('../logger');
const { runRow } = require('../lovart/client');
const { updateStatus, uploadImagesToField } = require('../dingtalk/upload');

const log = makeLogger('workers.runOne');

/**
 * 执行单行任务的完整流程
 * @param {string} workerLabel
 * @param {object} task
 * @returns {object} { recordId, ok, error? }
 */
async function executeRow(workerLabel, task) {
  const startTs = Date.now();
  log.info(`[${workerLabel}] 开始执行 recordId=${task.recordId} 款号=${task.styleNo}`);

  // 1) 状态置为 处理中
  try {
    await updateStatus(task.recordId, config.business.status.processing);
  } catch (e) {
    log.warn(`[${workerLabel}] 状态→处理中 失败（继续）`, { err: e.message });
  }

  // 2) Lovart 跑全部提示词
  let runResult;
  try {
    runResult = await runRow(workerLabel, task, {
      // 每完成一条提示词就尝试上传 + 更新状态
      onPromptDone: async (prompt, localFiles) => {
        log.info(`[${workerLabel}] prompt 完成`, {
          folder: prompt.folder,
          taskType: prompt.taskType,
          count: localFiles.length,
        });
        if (localFiles.length === 0) return;
        try {
          await uploadImagesToField(task.recordId, prompt.writeField, localFiles);
          log.info(`[${workerLabel}] 已上传到钉钉字段 ${prompt.writeField}`);
        } catch (e) {
          log.error(`[${workerLabel}] 上传到钉钉失败`, { err: e.message });
        }
      },
    });
  } catch (e) {
    log.error(`[${workerLabel}] Lovart 执行失败`, { err: e.message, stack: e.stack });
    try {
      await updateStatus(task.recordId, config.business.status.failed);
    } catch (_) {}
    return { recordId: task.recordId, ok: false, error: e.message };
  }

  // 3) 状态置为 已完成
  try {
    await updateStatus(task.recordId, config.business.status.done);
  } catch (e) {
    log.error(`[${workerLabel}] 状态→已完成 失败`, { err: e.message });
  }

  const sec = Math.round((Date.now() - startTs) / 1000);
  log.info(`[${workerLabel}] ✅ 完成 recordId=${task.recordId} 用时 ${sec}s`);
  return {
    recordId: task.recordId,
    ok: true,
    durationSec: sec,
    results: runResult?.results || [],
  };
}

module.exports = { executeRow };
