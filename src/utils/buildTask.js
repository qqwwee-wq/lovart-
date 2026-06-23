// src/utils/buildTask.js —— 把「生图表」+「提示词表」拼成 worker 可消费的任务对象
'use strict';

const { splitPrompts, segFolderName } = require('./splitPrompts');

const TASK_TYPE_FULL = 'lovart生图';
const TASK_TYPE_HALF = 'lovart生图（半身照）';

/**
 * @param {Array} productRows  生图表所有记录
 * @param {Array} promptRows   提示词表所有记录
 * @param {object} fP          生图表字段映射
 * @param {object} fR          提示词表字段映射
 * @returns {Array<{
 *   recordId, styleNo, modelImage,
 *   needHalf,                   // bool
 *   prompts: [{taskType, text, folder}],   // 这次要跑的提示词段
 * }>}
 */
function buildTasks(productRows, promptRows, fP, fR) {
  // 1) 把提示词按任务类型分组
  const byType = { [TASK_TYPE_FULL]: [], [TASK_TYPE_HALF]: [] };
  for (const r of promptRows) {
    const t = (r.cells[fR.taskType] || '').toString().trim();
    if (!byType[t]) continue;
    const rules = (r.cells[fR.rules] || '').toString().trim();
    const req = (r.cells[fR.requirements] || '').toString().trim();
    byType[t].push({ rules, requirements: req, raw: r });
  }

  // 2) 遍历生图表每一行
  const tasks = [];
  for (const row of productRows) {
    const c = row.cells || {};
    const styleNo = (c[fP.styleNo] || '').toString().trim();
    const modelImage = Array.isArray(c[fP.modelImage]) ? c[fP.modelImage][0] : c[fP.modelImage];
    const status = (c[fP.status] || '').toString().trim();
    // 只跳 已完成 / 处理中 / 失败；空白 或 「待处理」 都视为可执行
    if (['处理中', '已完成', '失败'].includes(status)) continue;
    if (!styleNo || !modelImage || !modelImage.url) continue;
    const needHalf = (() => {
      const v = c[fP.needHalf];
      if (!v) return false;
      if (typeof v === 'object' && v.name) return v.name === '是';
      return String(v).trim() === '是';
    })();

    // 3) 组装要跑的提示词段（按用户规则）
    const prompts = [];
    let segIdx = 0;
    // lovart生图（半身照）排在前面 or 后面都行，统一约定：先半身照（如果需要），再 lovart生图
    if (needHalf && byType[TASK_TYPE_HALF].length) {
      for (const promptRec of byType[TASK_TYPE_HALF]) {
        const segs = splitPrompts(promptRec.requirements);
        segs.forEach((seg, i) => {
          prompts.push({
            taskType: TASK_TYPE_HALF,
            text: combinePrompt(promptRec.rules, seg),
            folder: segFolderName(seg, ++segIdx),
            writeField: fP.resultHalf,
          });
        });
      }
    }
    for (const promptRec of byType[TASK_TYPE_FULL]) {
      const segs = splitPrompts(promptRec.requirements);
      segs.forEach((seg, i) => {
        prompts.push({
          taskType: TASK_TYPE_FULL,
          text: combinePrompt(promptRec.rules, seg),
          folder: segFolderName(seg, ++segIdx),
          writeField: fP.result,
        });
      });
    }

    if (prompts.length === 0) continue;
    tasks.push({
      recordId: row.recordId,
      styleNo,
      modelImage: { url: modelImage.url, filename: modelImage.filename, resourceId: modelImage.resourceId },
      needHalf,
      prompts,
    });
  }
  return tasks;
}

/**
 * 把通用规则 + 具体拍摄要求拼成最终提示词
 * 实际数据中 rules 和 requirements 各自已经含完整内容，提示词里也提到 "处理模型只能用Nano Banana 2"
 * 这里 rules 在前，requirements 在后（保持原表结构）
 */
function combinePrompt(rules, requirement) {
  if (!rules) return requirement;
  if (!requirement) return rules;
  return `${rules}\n${requirement}`;
}

module.exports = { buildTasks, TASK_TYPE_FULL, TASK_TYPE_HALF };
