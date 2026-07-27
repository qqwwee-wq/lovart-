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
  const buf = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  const fileType = mimeMap[ext] || 'application/octet-stream';
  log.debug("upload (inline base64)", { recordId, fieldId, fileName, size: stat.size });
  const cells = { [fieldId]: [{ fileName, fileType, data: base64 }] };
  return recordUpdate({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    records: [{ recordId, cells }],
  });
}

/**
 * 单张图准备 + OSS 上传，返回带 url+resourceId 的 attachment
 * 通过 attachmentPrepare 拿上传凭证 → PUT 文件到 OSS → 返回 OSS URL
 */
async function prepareAndOssUpload({ filePath }) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  // 1. 申请 OSS 上传凭证
  const prepRes = await attachmentPrepare({
    baseId: config.dingtalk.baseId,
    tableId: config.dingtalk.productTableId,
    recordId: 'bulk',
    fieldId: 'bulk',
    fileName,
    fileSize: stat.size,
    mimeType,
  });
  const prep = prepRes.data || prepRes;
  const uploadUrl = prep.uploadUrl || prep.upload_url || prep.url;
  const fileToken = prep.fileToken || prep.resourceId || prep.resource_id;
  const resourceUrl = prepRes.resourceUrl || prep.resource_url || prep.resourceUrl || '';
  const headers = { ...(prep.uploadHeaders || prep.headers || {}), 'Content-Type': mimeType };
  if (!uploadUrl || !fileToken) {
    throw new Error(`attachmentPrepare 返回缺字段: ${JSON.stringify(prepRes).slice(0, 300)}`);
  }

  // 2. PUT 到 OSS
  await attachmentPutToOss({ uploadUrl, filePath, headers, mimeType });

  return { fileToken, fileName, mimeType, size: stat.size, resourceUrl, uploadUrl };
}

/**
 * 批量上传一组图片到同一字段（一次性 recordUpdate，避免覆盖）
 * 采用 OSS 上传方式（attachmentPrepare + PUT + 用返回的 url+resourceId）
 * @param {string} recordId
 * @param {string} fieldId
 * @param {string[]} filePaths
 * @returns {{ok:boolean, failedFiles:string[], totalUploaded:number}}
 */
async function bulkUploadToField(recordId, fieldId, filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return { ok: false, failedFiles: [], totalUploaded: 0 };
  }
  const attachments = [];
  const failedFiles = [];
  for (const fp of filePaths) {
    try {
      const t = await prepareAndOssUpload({ filePath: fp });
      attachments.push({
        filename: t.fileName,
        size: t.size,
        type: 'image',
        // URL 必须以 '/core/api/resources' 或 'https://alidocs.dingtalk.com/i/nodes' 开头
        // resourceUrl 是 attachmentPrepare 返回的 resourceUrl（OpenAPI attachment 字段专用 URL）
        url: t.resourceUrl || t.uploadUrl.split('?')[0],
        resourceId: t.fileToken,
      });
    } catch (e) {
      log.error('bulkUpload prepareAndOssUpload 失败', { fp, err: e.message });
      failedFiles.push(fp);
    }
  }
  if (attachments.length === 0) {
    return { ok: false, failedFiles, totalUploaded: 0 };
  }
  const cells = { [fieldId]: attachments };
  try {
    const r = await recordUpdate({
      baseId: config.dingtalk.baseId,
      tableId: config.dingtalk.productTableId,
      records: [{ recordId, cells }],
    });
    log.info(`[bulkUpload] ✅ ${recordId} / ${fieldId}: 上传 ${attachments.length} 张 → ${filePaths.map(fp => require('path').basename(fp)).join(', ')}`);
    return { ok: true, failedFiles, totalUploaded: attachments.length, result: r };
  } catch (e) {
    log.error('[bulkUpload] recordUpdate 失败', { recordId, fieldId, err: e.message });
    return { ok: false, failedFiles: [...failedFiles, ...filePaths], totalUploaded: 0 };
  }
}

/**
 * 上传单张图片到生图表某行的某个 attachment 字段（兼容旧代码）
 */
async function uploadImageToField({ recordId, fieldId, filePath }) {
  const r = await bulkUploadToField(recordId, fieldId, [filePath]);
  if (!r.ok) throw new Error(`uploadImageToField 失败: ${r.failedFiles.join(', ')}`);
  return r.result;
}

/**
 * 批量上传一组图片到同一字段（兼容旧代码：别名指向 bulkUploadToField）
 */
async function uploadImagesToField(recordId, fieldId, filePaths) {
  const r = await bulkUploadToField(recordId, fieldId, filePaths);
  return filePaths.map((fp) => ({ file: fp, ok: !r.failedFiles.includes(fp) }));
}

module.exports = { updateStatus, updateStatusMany, uploadImageToField, uploadImagesToField, bulkUploadToField, prepareAndOssUpload };
