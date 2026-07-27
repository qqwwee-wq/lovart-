// src/workers/runOne.js —— 单行任务的完整执行：钉钉状态回写 + Lovart 生成 + 上传回写
'use strict';

const config = require('../config');
const { makeLogger } = require('../logger');
const { runRow } = require('../lovart/client');
const { updateStatus, bulkUploadToField } = require('../dingtalk/upload');

const log = makeLogger('workers.runOne');

/**
 * 执行单行任务的完整流程
 * @param {string} workerLabel
 * @param {object} task
 * @param {object} [opts]
 * @returns {object} { recordId, ok, error?, status, uploadedCount, totalCount }
 */
async function executeRow(workerLabel, task, opts = {}) {
  const startTs = Date.now();
  log.info(`[${workerLabel}] 开始执行 recordId=${task.recordId} 款号=${task.styleNo}`);

  // 1) 状态置为 处理中
  try {
    await updateStatus(task.recordId, config.business.status.processing);
  } catch (e) {
    log.warn(`[${workerLabel}] 状态→处理中 失败（继续）`, { err: e.message });
  }

  const promptResults = []; // [{folder, generated, uploaded, writeField}]
  let totalGenerated = 0;
  let totalUploaded = 0;
  const collectedFiles = []; // [{folder, writeField, files}]

  // 2) Lovart 跑全部提示词（仅下载 + 镜像本地，不立刻上传）
  let runResult;
  let runRowError = null;
  try {
    runResult = await runRow(workerLabel, task, {
      onPromptDone: async (prompt, localFiles) => {
        log.info(`[${workerLabel}] prompt 完成 → 已存本地镜像`, {
          recordId: task.recordId,
          folder: prompt.folder,
          count: localFiles.length,
          files: localFiles.map(f => require('path').basename(f)),
        });
        const generated = localFiles.length;

        promptResults.push({
          folder: prompt.folder,
          taskType: prompt.taskType,
          generated,
          uploaded: 0,
          writeField: prompt.writeField,
          status: generated === 0 ? 'no_images' : 'mirrored_local',
        });
        totalGenerated += generated;
        if (generated > 0) {
          collectedFiles.push({ folder: prompt.folder, writeField: prompt.writeField, files: localFiles });
        }
      },
    });
  } catch (e) {
    log.error(`[${workerLabel}] Lovart 执行失败（部分图片已下载到本地，继续 bulkUpload）`, {
      err: e.message,
    });
    runRowError = e;
  }

  // 3) 把 collectedFiles 批量上传（统一写到「生成结果」字段）
  if (collectedFiles.length > 0) {
    const writeField = config.dingtalk.fields.product.result;
    const allFiles = collectedFiles.flatMap((c) => c.files);
    try {
      const r = await bulkUploadToField(task.recordId, writeField, allFiles);
      if (r && r.ok) {
        totalUploaded += r.totalUploaded || allFiles.length;
        promptResults.forEach((p) => {
          if (p.status === 'mirrored_local') p.uploaded = p.generated;
        });
      }
    } catch (e) {
      log.error(`[${workerLabel}] bulkUpload ${writeField} 失败`, { err: e.message });
    }
  }

  // 4) 算最终状态
  let finalStatus;
  const errMsg = runRowError?.message || '';
  const isAllTimeout = runRowError
    && totalGenerated === 0
    && /超时|timeout/i.test(errMsg);
  const isRetriesExhausted = /已达重试上限/i.test(errMsg);
  if (isRetriesExhausted) {
    finalStatus = '需人工（已重试上限）';
  } else if (isAllTimeout) {
    finalStatus = '待重试（生图超时）';
  } else if (totalUploaded === 0 && totalGenerated === 0) {
    finalStatus = config.business.status.failed;
  } else if (totalUploaded === 0 && totalGenerated > 0) {
    finalStatus = config.business.status.failed;
  } else if (totalUploaded === totalGenerated) {
    finalStatus = config.business.status.done;
  } else {
    finalStatus = '部分完成';
  }
  if (runRowError && totalGenerated > 0 && !isRetriesExhausted) {
    finalStatus = '部分完成（runRow 异常: ' + errMsg.slice(0, 80) + '）';
  }

  log.info(`[${workerLabel}] 汇总`, {
    totalGenerated,
    totalUploaded,
    finalStatus,
    prompts: promptResults.map((p) => `${p.folder}: gen=${p.generated} up=${p.uploaded}`),
  });

  try {
    await updateStatus(task.recordId, finalStatus);
    log.info(`[${workerLabel}] 状态→${finalStatus}`);

    // 成功后同步更新"出图状态"字段，防止下次扫描重复跑
    if (finalStatus === config.business.status.done) {
      try {
        const { recordUpdate } = require('../dingtalk/client');
        await recordUpdate({
          baseId: config.dingtalk.baseId,
          tableId: config.dingtalk.productTableId,
          records: [{
            recordId: task.recordId,
            cells: { [config.dingtalk.fields.product.genStatus]: '已完成' },
          }],
        });
        log.info(`[${workerLabel}] 出图状态→已完成`);
      } catch (e) {
        log.warn(`[${workerLabel}] 出图状态更新失败`, { err: e.message });
      }
    }
  } catch (e) {
    log.error(`[${workerLabel}] 状态→${finalStatus} 失败`, { err: e.message });
  }

  const sec = Math.round((Date.now() - startTs) / 1000);
  log.info(`[${workerLabel}] ✅ 完成 recordId=${task.recordId} 用时 ${sec}s`);

  return {
    recordId: task.recordId,
    ok: totalUploaded > 0,
    status: finalStatus,
    totalGenerated,
    totalUploaded,
    promptResults,
    durationSec: sec,
    results: runResult?.results || [],
  };
}

module.exports = { executeRow };
