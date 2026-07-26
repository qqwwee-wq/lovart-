// src/dingtalk/client.js —— 钉钉 Open Platform API + dws CLI 双模式封装
//
// 工作模式判断：
//   - 当 config.dingtalk.operatorUserId 配了 → recordQuery 走 OpenAPI（v1.0/notable）
//   - 否则 → 走 dws CLI（execFile，需服务器装 dws 二进制）
//   - recordUpdate / attachment* / attachmentPutToOss：当前一律走 dws（OpenAPI 路径尚未在钉钉 v1.0/noteable 公开）
//
// 部署提示：
//   - 服务器仅 deploy，无 dws CLI → 配 DINGTALK_OPERATOR_USERID 后，recordQuery 走 OpenAPI
//     其他操作仍需 dws。完整替换需要钉钉继续公开 update/attachment endpoint（跟踪 issue）。
//   - 服务器仅 deploy，且有 dws CLI → 不配 operatorUserId，走 dws 全套（现状）
'use strict';

const { execFile } = require('child_process');
const config = require('../config');

// ---- OpenAPI access_token 缓存（access_token 默认 7200s 过期） ----
let _accessTokenCache = { token: null, expiresAt: 0 };
async function getAccessToken() {
  const now = Date.now();
  if (_accessTokenCache.token && _accessTokenCache.expiresAt > now + 60_000) {
    return _accessTokenCache.token;
  }
  const url = `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.dingtalk.appKey)}&appsecret=${encodeURIComponent(config.dingtalk.appSecret)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.access_token) {
    throw new Error(`gettoken 失败: ${JSON.stringify(j)}`);
  }
  _accessTokenCache = {
    token: j.access_token,
    expiresAt: now + (j.expires_in || 7200) * 1000,
  };
  return j.access_token;
}

// ---- OpenAPI 通用 fetch 包装 ----
// 路径形式：可以是 'v1.0/notable/...' 或 'v1.0/storage/...'
// 自动判断加前缀
async function openApiFetch(path, init = {}) {
  const at = await getAccessToken();
  const headers = {
    'x-acs-dingtalk-access-token': at,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = cleanPath.startsWith('v')
    ? `https://api.dingtalk.com/${cleanPath}`
    : `https://api.dingtalk.com/v1.0/notable/${cleanPath}`;
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!resp.ok || (body && body.code && body.code !== 'ok')) {
    const err = new Error(`OpenAPI ${resp.status}: ${text.slice(0, 300)}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ---- 通过 tableId 反查 sheetName（OpenAPI /v1.0/notable/... 路径要 sheetName 或 sheetId 都可） ----
// 钉钉 OpenAPI 允许 {sheetIdOrName}，所以可以**直接用 tableId 当 sheetId** — 但不同源混用可能不稳
// 这里直接用 tableId 当 sheetId：实测 /v1.0/notable/.../records/list 支持 sheetId
// 缓存避免每次查
async function getSheetName(baseId, tableId) {
  // 钉钉 OpenAPI 的 path placeholder 是 sheetIdOrName —— tableId 本身就是 sheetId
  // 直接返回 tableId，省一次远程调用
  return tableId;
}

// ---- dws CLI 封装 ----
function dwsPath() {
  return process.env.DWS_BIN || 'dws';
}
function dwsRun(args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = dwsPath();
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`dws 调用失败: ${args.slice(0, 4).join(' ')}...\n` + (stderr || err.message)));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`dws 返回非 JSON: ${stdout.slice(0, 200)}`)); }
    });
  });
}

// ---- mode 切换 ----
function useOpenApi() {
  return !!config.dingtalk.operatorUserId;
}

/**
 * 通用 aitable record query，自动翻页
 * 当 operatorUserId 配了：走 OpenAPI v1.0/notable/.../records/list（不需要 dws 二进制）
 * 否则：走 dws aitable record query
 */
/**
 * OpenAPI 返回的 records 是 {fields: {字段名: 值}} 形式
 * 业务代码（sheets.js/buildTask.js）使用的是 {cells: {fieldId: 值}} 形式
 * 这里做一个映射：字段名 ↔ fieldId
 * 来源：表 schema 里的字段名（手工维护，因为钉钉 AI 表 schema 固定）
 *
 * 拉取一次后会缓存到 _fieldNameIndex[fieldId] → name 和 _fieldNameIndex[name] → fieldId
 * 第一次会调用一次 GET 表 schema，以后直接命中内存
 */
const _fieldNameIndexCache = new Map(); // baseId:tableId → {fieldId→name, name→fieldId}
async function getFieldNameIndex(baseId, tableId) {
  const key = `${baseId}:${tableId}`;
  if (_fieldNameIndexCache.has(key)) return _fieldNameIndexCache.get(key);
  // 简化做法：用一份手工映射覆盖当前已知的两张表
  const manual = {
    [config.dingtalk.productTableId]: {
      '编号': '6k8bTII',
      '状态': config.dingtalk.fields.product.status,
      '素材图': config.dingtalk.fields.product.modelImage,
      '款号': config.dingtalk.fields.product.styleNo,
      '生成结果': config.dingtalk.fields.product.result,
      '出图状态': config.dingtalk.fields.product.genStatus,
      '提示词': config.dingtalk.fields.product.prompt,
    },
  };
  const map = manual[tableId] || {};
  _fieldNameIndexCache.set(key, map);
  return map;
}

/** OpenAPI → dws 形状：{fields:{name:val}, id} → {cells:{fieldId:val}, recordId} */
function openApiRecordToDws(rec, nameToIdMap) {
  const fields = rec.fields || {};
  const cells = {};
  for (const [name, value] of Object.entries(fields)) {
    const id = nameToIdMap[name] || name; // 没映射就回退用 name
    cells[id] = value;
  }
  return { ...rec, cells, recordId: rec.id };
}

async function recordQuery({ baseId, tableId, filters = null, cursor = null, all = false, limit = 50 }) {
  if (!useOpenApi()) {
    // dws 路径
    const args = ['aitable', 'record', 'query', '--base-id', baseId, '--table-id', tableId, '--format', 'json'];
    if (all) args.push('--all');
    if (limit) args.push('--limit', String(limit));
    if (filters) args.push('--filters', JSON.stringify(filters));
    if (cursor) args.push('--cursor', cursor);
    return dwsRun(args);
  }

  // OpenAPI 路径
  const sheetName = await getSheetName(baseId, tableId);
  if (!sheetName) throw new Error(`OpenAPI 模式：找不到 baseId=${baseId} 下 tableId=${tableId} 对应的 sheetName`);

  const op = config.dingtalk.operatorUserId;
  const path = `bases/${baseId}/sheets/${encodeURIComponent(sheetName)}/records/list`;
  let nextCursor = null;
  const collected = [];
  let hasMore = false;
  let pages = 0;
  const pageLimit = 50;

  do {
    const body = {
      pageSize: limit,
      operatorId: op,
      ...(nextCursor ? { cursor: nextCursor } : {}),
      ...(filters ? { filters } : {}),
    };
    const result = await openApiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    const data = result.data || result;
    const rawRecords = data.records || [];
    // OpenAPI → dws 形状：cells 替代 fields；recordId 替代 id
    const nameToIdMap = await getFieldNameIndex(baseId, tableId);
    for (const rec of rawRecords) {
      collected.push(openApiRecordToDws(rec, nameToIdMap));
    }
    nextCursor = data.nextToken || null; // OpenAPI 用 nextToken，dws 用 nextCursor
    hasMore = !!nextCursor;
    pages += 1;
  } while (all && hasMore && pages < pageLimit);

  const finalResult = { data: { records: collected }, error: {}, meta: {}, status: 'success', summary: '' };
  if (all) {
    finalResult.hasMore = hasMore;
    finalResult.pages = pages;
    if (hasMore) finalResult.cursor = nextCursor;
  }
  return finalResult;
}

/**
 * 批量更新记录（≤30 条/次）
 * 当 operatorUserId 配了：走 OpenAPI PUT /v1.0/notable/.../records?operatorId=xxx
 *   - dws 入参 shape: {recordId, cells: {fieldId: value}}
 *   - OpenAPI 入参 shape: {id, fields: {fieldName: value}}
 *   - 此函数对外保持 dws 形状（cell key 用 fieldId），内部做 name↔id 转换
 * 否则：dws CLI
 */
async function recordUpdate({ baseId, tableId, records }) {
  if (!useOpenApi()) {
    return dwsRun(['aitable', 'record', 'update', '--base-id', baseId, '--table-id', tableId,
      '--records', JSON.stringify(records), '--format', 'json']);
  }
  // OpenAPI 路径
  const op = config.dingtalk.operatorUserId;
  const path = `bases/${baseId}/sheets/${encodeURIComponent(tableId)}/records?operatorId=${encodeURIComponent(op)}`;
  const idToNameMap = await getFieldNameIndex(baseId, tableId);
  // 反向：fieldId → fieldName
  const fieldIdToName = {};
  for (const [name, id] of Object.entries(idToNameMap)) fieldIdToName[id] = name;

  const openApiRecords = records.map((r) => {
    const fieldsOpenApi = {};
    for (const [fieldIdOrName, value] of Object.entries(r.cells || {})) {
      // 接受 fieldId 或 fieldName 两种 key — 兼容业务代码用 fieldId
      const name = fieldIdToName[fieldIdOrName] || fieldIdOrName;
      fieldsOpenApi[name] = value;
    }
    return { id: r.recordId, fields: fieldsOpenApi };
  });

  const result = await openApiFetch(path, { method: 'PUT', body: JSON.stringify({ records: openApiRecords }) });
  // OpenAPI 响应 {value: [{id}]}
  const ids = (result.value || result.data?.value || []).map((x) => ({ id: x.id || x.recordId }));
  return { data: { recordIds: ids }, error: {}, meta: {}, status: 'success' };
}

/**
 * 准备附件上传凭证（OpenAPI）
 * 走 doc/v1.0/doc/docs/resources/{docId}/uploadInfos/query
 *   - docId = AI 表格 baseId
 *   - body: { mediaType, resourceName, size }
 *   - query: operatorId
 *   - response: { success, result: { uploadUrl, resourceId, resourceUrl } }  ← camelCase!
 * @param {{docId, fileName, fileSize, mimeType}} opts
 * @returns {Promise<{uploadUrl, resourceId, resourceUrl}>}
 */
async function attachmentPrepareOpenApi({ docId, fileName, fileSize, mimeType }) {
  const op = config.dingtalk.operatorUserId;
  const query = `?operatorId=${encodeURIComponent(op)}`;
  const path = `v1.0/doc/docs/resources/${encodeURIComponent(docId)}/uploadInfos/query${query}`;
  const body = { mediaType: mimeType, resourceName: fileName, size: fileSize };
  const result = await openApiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  // 钉钉 doc SDK 返回 { success: true, result: { uploadUrl, resourceId, resourceUrl } }
  // （实测：result 字段直接展开）
  const top = result && typeof result.success !== 'undefined' ? result : (result.body || {});
  if (!top.success) {
    throw new Error(`GetResourceUploadInfo 返回 success=false: ${JSON.stringify(top)}`);
  }
  const r = top.result || {};
  if (!r.uploadUrl) throw new Error(`GetResourceUploadInfo 响应缺 uploadUrl: ${JSON.stringify(top)}`);
  return {
    uploadUrl: r.uploadUrl,
    resourceId: r.resourceId,
    resourceUrl: r.resourceUrl,
    mimeType,
    raw: top,
  };
}

/**
 * 准备附件上传凭证
 * 当 operatorUserId 配了：OpenAPI doc 域（与钉钉 @alibabacloud/dingtalk doc_1_0 SDK 一致）
 * 否则：dws CLI（兜底）
 */
async function attachmentPrepare({ baseId, tableId, recordId, fieldId, fileName, fileSize, mimeType }) {
  if (useOpenApi()) {
    const r = await attachmentPrepareOpenApi({ docId: baseId, fileName, fileSize, mimeType });
    // 适配 upload.js 期待的字段名：data.uploadUrl, data.fileToken, headers
    return {
      data: {
        uploadUrl: r.uploadUrl,
        fileToken: r.resourceId,
        headers: {},
      },
      resourceUrl: r.resourceUrl,
    };
  }
  const args = [
    'aitable', 'attachment', 'upload',
    '--base-id', baseId,
    '--file-name', fileName, '--size', String(fileSize),
  ];
  if (mimeType) args.push('--mime-type', mimeType);
  args.push('--format', 'json');
  return dwsRun(args);
}

/**
 * 提交文件上传事务（doc SDK 无此方法，dws 的 attachment 也是 1 步到位无需 confirm）
 * 当前不需要：参考代码也是 GET upload info + PUT 到 OSS 直接用，结果 resource_id/resource_url 直接进 attachment 字段
 */

/**
 * 提交文件上传事务（完成 multipart upload 整个周期）
 * 当前 dws 不需要这个步骤（dws 一步到位）—— 所以仅做接口预留
 * 需要权限：Storage.File.Write
 */
async function attachmentCommit({ fileName, uploadKey, unionId, parentId = '' }) {
  const op = config.dingtalk.operatorUserId;
  const spaceId = process.env.DINGTALK_SPACE_ID || config.dingtalk.baseId;
  const url = `v1.0/storage/spaces/${spaceId}/files/commit?operatorId=${encodeURIComponent(op)}`;
  const body = { unionId: op, name: fileName, uploadKey, parentId, overwriteDentryId: '' };
  return openApiFetch(url, { method: 'POST', body: JSON.stringify(body) });
}

/** OSS PUT：直接 fetch 到 OSS，签名由 uploadUrl/headers 决定
 *  - mimeType 必填：OSS v1 签名需要 Content-Type 头匹配
 *  - headers 可选：dws 会返回签名头；OpenAPI prepare 通常已包含
 *  - 参考代码：用 `headers={"Content-Type": media_type}` 显式传
 */
async function attachmentPutToOss({ uploadUrl, filePath, headers, mimeType }) {
  const fs = require('fs');
  const buf = fs.readFileSync(filePath);
  const h = new Headers();
  h.set('Content-Length', String(buf.length));
  // mimeType 必须设 Content-Type，否则 OSS 签名不匹配
  if (mimeType) h.set('Content-Type', mimeType);
  if (headers) for (const [k, v] of Object.entries(headers)) h.set(k, v);
  const resp = await fetch(uploadUrl, { method: 'PUT', body: buf, headers: h });
  if (!resp.ok) throw new Error('OSS PUT failed ' + resp.status + ': ' + (await resp.text()));
  return { statusCode: resp.status, body: await resp.text() };
}

/**
 * 确认上传完成
 * 当前走 dws
 */
async function attachmentConfirm({ baseId, tableId, recordId, fieldId, fileToken }) {
  return dwsRun([
    'aitable', 'attachment', 'confirm',
    '--base-id', baseId, '--table-id', tableId,
    '--record-id', recordId, '--field-id', fieldId,
    '--file-token', fileToken,
    '--format', 'json',
  ]);
}

async function ping() {
  return dwsRun(['--version']);
}

module.exports = {
  recordQuery,
  recordUpdate,
  attachmentPrepare,
  attachmentPutToOss,
  attachmentConfirm,
  ping,
  // 暴露给高级用户测
  _openApiFetch: openApiFetch,
  _getAccessToken: getAccessToken,
  _useOpenApi: useOpenApi,
};
