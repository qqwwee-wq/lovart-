// src/dingtalk/upload.js —— 更新生图表状态 / 上传生成结果图片到附件字段
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { makeLogger } = require('../logger');
const { recordUpdate, attachmentPrepare, attachmentPutToOss, attachmentConfirm } = require('./client');

const log = makeLogger('dingtalk.upload');

/**
 * 把状态字段写回生图表单行
 */
async function updateStatus(recordId, statusText) {
  const cells = {
    [config.dingtalk.fields.product.status]: statusText,
  };
  log.info('更新记录状态', { recordId, statusText });
  return recordUpdate({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    records: [{ recordId, cells }],
  });
}

/**
 * 把状态一次性写回多行（≤30 条/批）
 */
async function updateStatusMany(items /* [{recordId, status}] */) {
  const records = items.map((it) => ({
    recordId: it.recordId,
    cells: { [config.dingtalk.fields.product.status]: it.status },
  }));
  // dws 限制单次 ≤30，自动分批
  const results = [];
  for (let i = 0; i < records.length; i += 30) {
    const batch = records.slice(i, i + 30);
    log.info('批量更新状态', { count: batch.length });
    const r = await recordUpdate({
      baseId: config.dingtalk.baseId,
      tableId: config.dingtalk.productTableId,
      records: batch,
    });
    results.push(r);
  }
  return results;
}

/**
 * 上传单张图片到生图表某行的某个 attachment 字段
 * 流程：attachmentPrepare → OSS PUT → attachmentConfirm
 */
async function uploadImageToField({ recordId, fieldId, filePath }) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);

  log.debug('准备上传', { recordId, fieldId, fileName, size: stat.size });
  const prepRes = await attachmentPrepare({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    recordId,
    fieldId,
    fileName,
    fileSize: stat.size,
  });

  // dws 返回可能用 data.* 包裹，兼容两种
  const prep = prepRes.data || prepRes;
  const uploadUrl = prep.uploadUrl || prep.upload_url || prep.url;
  const resourceId = prep.resourceId || prep.resource_id;
  const headers = prep.headers || prep.uploadHeaders || {};

  if (!uploadUrl || !resourceId) {
    throw new Error(`attachmentPrepare 返回缺字段: ${JSON.stringify(prepRes).slice(0, 300)}`);
  }

  await attachmentPutToOss({ uploadUrl, filePath, headers });
  const confirmRes = await attachmentConfirm({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    recordId,
    fieldId,
    resourceId,
  });
  log.debug('上传完成', { recordId, fieldId, resourceId });
  return confirmRes;
}

/**
 * 批量上传一组图片到同一字段（追加，不清空旧值）
 * @param {string} recordId
 * @param {string} fieldId
 * @param {string[]} filePaths
 */
async function uploadImagesToField(recordId, fieldId, filePaths) {
  const results = [];
  for (const fp of filePaths) {
    const r = await uploadImageToField({ recordId, fieldId, filePath: fp });
    results.push({ file: fp, ok: true, result: r });
  }
  return results;
}

module.exports = { updateStatus, updateStatusMany, uploadImageToField, uploadImagesToField };
