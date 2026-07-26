// src/utils/buildTask.js —— 组装任务：
//   每行 lovart慢速生图表 商品 = 1 个 task
//   提示词直接从每行的「提示词」字段（VgE7ByO）读取
'use strict';

const TASK_TYPE = 'lovart慢速生图';

/**
 * @param {Array} productRows  生图表（lovart慢速生图表）所有记录
 * @param {object} fP          生图表字段映射
 * @returns {Array<{
 *   recordId, styleNo, modelImage,
 *   taskType,                      // 固定 'lovart慢速生图'
 *   prompts: [{text, folder, writeField}]
 * }>}
 */
function buildTasks(productRows, fP) {
  const tasks = [];

  for (const row of productRows) {
    const c = row.cells || {};

    // 基本字段
    const styleNo = (c[fP.styleNo] || '').toString().trim();
    const modelImage = Array.isArray(c[fP.modelImage]) ? c[fP.modelImage][0] : c[fP.modelImage];
    const status = (c[fP.status] || '').toString().trim();
    const promptText = (c[fP.prompt] || '').toString().trim();

    // 跳过处理中/已完成（"失败"也重跑，因为可能是上传失败等可恢复错误）
    if (['处理中', '已完成'].includes(status)) continue;
    if (!styleNo || !modelImage || !modelImage.url) continue;
    if (!promptText) {
      // 提示词为空则跳过
      continue;
    }

    // 出图状态过滤（XzTcnFY / singleSelect）：
    //   - 「重试」/「待生图」 → 跑
    //   - 「已确认」/ 其他枚举值 → 跳过
    //   - 未设（运营没动过） → 视为「待生图」跑一次
    if (fP.genStatus) {
      const gs = c[fP.genStatus];
      const gsName = (gs && typeof gs === 'object' ? gs.name : gs);
      const gsStr = String(gsName || '').trim();
      if (gsStr === '') {
        // 未设值，默认可执行
      } else if (gsStr === '重试' || gsStr === '待生图') {
        // 显式标记为待跑
      } else {
        // 已确认 / 其他状态 → 跳过
        continue;
      }
    }

    // 每行 = 1 个 task，1 段 prompt，写到「生成结果」字段
    const writeField = fP.result;
    const folder = styleNo || 'unknown';

    tasks.push({
      recordId: row.recordId,
      styleNo,
      modelImage: { url: modelImage.url, filename: modelImage.filename, resourceId: modelImage.resourceId },
      taskType: TASK_TYPE,
      prompts: [{
        taskType: TASK_TYPE,
        text: promptText,
        folder,
        writeField,
      }],
    });
  }

  return tasks;
}

module.exports = { buildTasks, TASK_TYPE };
